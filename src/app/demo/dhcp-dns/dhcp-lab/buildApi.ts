import type { Dispatch, SetStateAction } from "react";
import { DL_BUILD_CONFIG, type DlAction, type DlConfig, type DlState } from "@/lib/sim-engine/scenarios/dhcpDnsLab";
import { DHCPD_START, ZONE, ZONE_START, parseDhcpd, parseZone, relayFromHelpers, type R1Helpers } from "@/lib/sim-engine/scenarios/dhcpDnsBuild";
import type { BuildCliApi, CiscoMode, CliQuestion, JunosCandidate, JunosCommit, JunosMode } from "./dhcpBuildCli";
import { EMPTY_JUNOS, helpersToCandidate, sameCfg } from "./routerConfig";
import { activate, checked, commitFailed, deviceTruth, discardCandidate, isVerifyCommand, logChange, type Change, type VDev } from "./verify";

/**
 * The build's state (what every device holds) and the operations the device consoles use to change it. Each operation
 * changes the simulation the way the real device would, and records the change in the journal. Kept free of React so
 * the whole CLI can be exercised by the audits exactly as the browser does.
 */

export interface BuildSnap {
  /** What the devices run (the model's view). */
  config: DlConfig;
  records: Record<string, string>;
  /** Files as saved on the servers. */
  files: { dhcpd: string; zone: string };
  /** R1's running helper addresses per interface (what the simulation uses), and the Junos candidate configuration. */
  r1: R1Helpers;
  junos: JunosCandidate;
  /** Junos commit history: [0] is the active configuration (rollback 0), then older commits (rollback 1, 2, …). */
  junosHist: JunosCommit[];
  /** IOS NVRAM: the startup configuration (what `copy running-config startup-config` saved). */
  startup: R1Helpers;
  /** Highest hint level opened, per hint. */
  hints: Record<string, number>;
  /** Every configuration change and how far it has been confirmed. */
  journal: Change[];
}
export const INITIAL_BUILD: BuildSnap = { config: { ...DL_BUILD_CONFIG }, records: {}, files: { dhcpd: DHCPD_START, zone: ZONE_START }, r1: {}, junos: EMPTY_JUNOS, junosHist: [{ cfg: EMPTY_JUNOS, at: 0, by: "root", via: "other" }], startup: {}, hints: {}, journal: [] };

export interface BuildApi extends BuildCliApi {
  saveDhcpd: (t: string) => void;
  saveZone: (t: string) => void;
  cisco: CiscoMode;
  setCisco: (m: CiscoMode) => void;
  junosMode: JunosMode;
  setJunosMode: (m: JunosMode) => void;
  act: (a: DlAction) => void;
  journal: Change[];
  /** A command ran (or a view opened) on a device: counts as a check if it verifies that device. */
  noteCheck: (node: string, commandId: string, how: string) => void;
}

export function makeBuildApi(o: { lab: DlState; snap: BuildSnap; setSnap: Dispatch<SetStateAction<BuildSnap>>; act: (a: DlAction) => void; cisco: CiscoMode; setCisco: (m: CiscoMode) => void; junosMode: JunosMode; setJunosMode: (m: JunosMode) => void; question?: CliQuestion; setQuestion?: (q: CliQuestion | undefined) => void }): BuildApi {
  const { lab, snap, setSnap, act } = o;
  const applyR1 = (h: R1Helpers) => {
    const relay = relayFromHelpers(h);
    act({ type: "build-apply", device: "R1", config: relay });
    return relay;
  };
  const active = snap.junosHist[0].cfg;
  const dirty = !sameCfg(snap.junos, active);
  return {
    helpers: snap.r1,
    // IOS: a configuration line changes the running configuration at once. The same router seen as Junos shows it
    // too: rollback 0 (the active configuration) follows, and so does an untouched candidate.
    setHelpers: (h, line) => {
      const relay = applyR1(h);
      setSnap((s) => {
        const cfg = helpersToCandidate(h, s.junosHist[0].cfg);
        const clean = sameCfg(s.junos, s.junosHist[0].cfg);
        return { ...s, r1: h, junos: clean ? cfg : s.junos, junosHist: [{ ...s.junosHist[0], cfg }, ...s.junosHist.slice(1)], config: { ...s.config, ...relay }, journal: activate(logChange(s.journal, "R1", "cli", line), "R1", lab, "ok") };
      });
    },
    junos: snap.junos,
    junosHist: snap.junosHist,
    setJunos: (j, line) => setSnap((s) => ({ ...s, junos: j, journal: logChange(s.journal, "R1", "candidate", line) })),
    loadCandidate: (j) => setSnap((s) => ({ ...s, junos: j })),
    rollbackCandidate: (n) => {
      const entry = snap.junosHist[n];
      if (!entry) return `error: rollback ${n} does not exist`;
      if (sameCfg(entry.cfg, active)) setSnap((s) => ({ ...s, junos: entry.cfg, journal: discardCandidate(s.journal) }));
      else setSnap((s) => ({ ...s, junos: entry.cfg, journal: logChange(s.journal, "R1", "candidate", `rollback ${n}`) }));
      return undefined;
    },
    // commit: the candidate becomes the active configuration and the newest entry of the history.
    commitJunos: (h, comment) => {
      const relay = applyR1(h);
      setSnap((s) => ({ ...s, r1: h, config: { ...s.config, ...relay }, junosHist: [{ cfg: s.junos, at: Date.now(), by: "admin", via: "cli", comment }, ...s.junosHist].slice(0, 50), journal: activate(s.journal, "R1", lab, "ok", undefined, "commit (no new edits)") }));
    },
    commitFailed: (note) => setSnap((s) => ({ ...s, journal: commitFailed(s.journal, note) })),
    junosDirty: dirty,
    startup: snap.startup,
    saveStartup: () => setSnap((s) => ({ ...s, startup: s.r1 })),
    question: o.question,
    ask: (q) => o.setQuestion?.(q),
    dhcpdText: snap.files.dhcpd,
    saveDhcpd: (t) => setSnap((s) => ({ ...s, files: { ...s.files, dhcpd: t }, journal: logChange(s.journal, "DHCP-SRV", "file", "saved /etc/dhcp/dhcpd.conf") })),
    restartDhcp: (text) => {
      const p = parseDhcpd(text ?? snap.files.dhcpd);
      act({ type: "build-apply", device: "DHCP-SRV", config: p.config });
      setSnap((s) => ({ ...s, config: { ...s.config, ...p.config }, journal: activate(s.journal, "DHCP-SRV", lab, p.error ? "failed" : "ok", p.error ? "systemctl restart failed: the service did not start" : undefined, "restarted with the saved file") }));
      return { error: p.error };
    },
    zoneText: snap.files.zone,
    saveZone: (t) => setSnap((s) => ({ ...s, files: { ...s.files, zone: t }, journal: logChange(s.journal, "DNS-SRV", "file", `saved /etc/bind/db.${ZONE}`) })),
    reloadZone: (text) => {
      const p = parseZone(text ?? snap.files.zone);
      // Like BIND: rndc accepts the reload either way; a broken zone is only visible in named's log and its answers.
      act(p.error ? { type: "build-apply", device: "DNS-SRV", zoneError: p.error } : { type: "build-apply", device: "DNS-SRV", records: p.records });
      setSnap((s) => ({ ...s, ...(p.error ? {} : { records: p.records }), journal: activate(s.journal, "DNS-SRV", lab, "claimed", undefined, "reloaded the saved zone") }));
      return { error: p.error };
    },
    journal: snap.journal,
    noteCheck: (node, id, how) => {
      if (!isVerifyCommand(node, id)) return;
      const d = node as VDev;
      // What the device shows is read at the moment of the check (the zone file as saved vs what named loaded).
      setSnap((s) => ({ ...s, journal: checked(s.journal, d, how, deviceTruth(d, lab, s.files.zone)) }));
    },
    cisco: o.cisco,
    setCisco: o.setCisco,
    junosMode: o.junosMode,
    setJunosMode: o.setJunosMode,
    act,
  };
}
