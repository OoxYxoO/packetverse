import { dhcpRunning, type DlPacket, type DlState } from "@/lib/sim-engine/scenarios/dhcpDnsLab";
import { evalDhcp, evalDns, parseZone } from "@/lib/sim-engine/scenarios/dhcpDnsBuild";

/**
 * The change journal: every configuration change the student makes, and how far it has been CONFIRMED.
 *   1 accepted   the device took the command / the file was saved (says nothing about effect)
 *   2 active     the device is running it (Cisco: on Enter · Junos: commit · dhcpd: restart · named: reload)
 *   3 on device  the student looked, on that device, after it became active (running config, service status, dig)
 *   4 traffic    traffic since activation shows the device doing its part (relay / OFFER / A answer)
 *   5 service    a laptop, after the change, gets the whole service (the test bench's checks)
 * Every stage is earned from what really happened (commands, events, captured packets), never assumed. The journal
 * shows WHETHER a stage is confirmed and asks how to confirm it; it never says what is wrong.
 */

export type VDev = "R1" | "DHCP-SRV" | "DNS-SRV";
export interface Change {
  id: number;
  device: VDev;
  kind: "cli" | "candidate" | "file";
  lines: string[];
  /** What the activation step reported: ok, failed, or "claimed" (the command succeeded, but it doesn't say whether the content loaded). */
  activation?: "ok" | "failed" | "claimed";
  activationNote?: string;
  /** Last packet number when it became active: traffic after this is traffic under the new configuration. */
  mark?: number;
  /** The student checked the device after activation; ok = what the device showed matches the change being in effect. */
  checked?: { ok: boolean; how: string };
  closed?: boolean;
}

const VERIFY: Record<VDev, string[]> = {
  R1: ["b-run", "b-do-run", "b-jrun", "b-jrun-sub", "r1-run-int", "r1-ip-int", "r1-ip-int-all", "r1-relay-conf", "r1-relay-stats", "view-config"],
  "DHCP-SRV": ["s-status", "s-log", "s-ss", "s-leases", "view-status"],
  "DNS-SRV": ["d-status", "d-log", "d-dig", "d-ss", "view-status"],
};
/** `do show …` (IOS configuration mode) and `run show …` (Junos configuration mode) verify just like the plain command. */
export const isVerifyCommand = (d: string, id: string) => (VERIFY[d as VDev] ?? []).includes(id.replace(/^(do|run):/, ""));

const lastNo = (s: DlState) => (s.capture.length ? s.capture[s.capture.length - 1].no : 0);
const open = (j: Change[], d: VDev) => [...j].reverse().find((c) => c.device === d && !c.closed);

/** A change was accepted by the device. Junos edits gather in one candidate; a new save replaces an unapplied one. */
export function logChange(j: Change[], device: VDev, kind: Change["kind"], line: string): Change[] {
  const cur = open(j, device);
  if (cur && !cur.activation && cur.kind === kind && kind !== "cli") return j.map((c) => (c === cur ? { ...c, lines: kind === "file" ? [line] : [...c.lines, line] } : c));
  const id = j.length ? j[j.length - 1].id + 1 : 1;
  return [...j.map((c) => (c.device === device && !c.closed ? { ...c, closed: true } : c)), { id, device, kind, lines: [line] }];
}

/** The activation step ran (commit / restart / reload). */
export function activate(j: Change[], device: VDev, lab: DlState, result: "ok" | "failed" | "claimed", note?: string, fallback?: string): Change[] {
  let cur = open(j, device);
  if (!cur || cur.activation) {
    j = logChange(j, device, device === "R1" ? "candidate" : "file", fallback ?? "(no new edits)");
    cur = j[j.length - 1];
  }
  return j.map((c) => (c === cur ? { ...c, activation: result, activationNote: note, mark: lastNo(lab), checked: undefined } : c));
}

/** The candidate was put back to what runs (Junos `rollback`/`rollback 0`): the pending candidate change is gone. */
export const discardCandidate = (j: Change[]) => j.map((c) => (c.device === "R1" && c.kind === "candidate" && !c.closed && !c.activation ? { ...c, closed: true } : c));

/** A Junos commit that failed its check-out: the candidate stays a candidate. */
export const commitFailed = (j: Change[], note: string) => {
  const cur = open(j, "R1");
  return cur && !cur.activation ? j.map((c) => (c === cur ? { ...c, activationNote: note } : c)) : j;
};

/** The student ran a verification on the device. Counts only once the change is active (or claimed active). */
export function checked(j: Change[], device: VDev, how: string, ok: boolean): Change[] {
  const cur = open(j, device);
  if (!cur || !cur.activation || cur.activation === "failed") return j;
  return j.map((c) => (c === cur ? { ...c, checked: { ok, how } } : c));
}

/** Does the device really run the change? (Used when the student looks.) */
export function deviceTruth(device: VDev, lab: DlState, zoneText: string): boolean {
  if (device === "R1") return true;
  if (device === "DHCP-SRV") return dhcpRunning(lab.config);
  const z = parseZone(zoneText);
  if (z.error || !lab.config.dnsUp) return false;
  const a = Object.entries(z.records).sort().join();
  return a === Object.entries(lab.records).sort().join();
}

export type StageState = "ok" | "bad" | "wait" | "claimed";
export interface Stage {
  n: 1 | 2 | 3 | 4 | 5;
  label: string;
  state: StageState;
  seen: string;
  /** The question to ask yourself, then (on request) how to answer it. */
  ask?: string;
  how?: string;
}

const relayedToServer = (p: DlPacket) => (p.msg === "DISCOVER" || p.msg === "REQUEST") && p.hops[0]?.node === "R1" && p.hops[p.hops.length - 1]?.node === "DHCP-SRV";
const fromClient = (p: DlPacket) => p.hops[0]?.node === "CLIENT";

function traffic(c: Change, lab: DlState): Pick<Stage, "state" | "seen"> {
  const ps = lab.capture.filter((p) => p.no > (c.mark ?? Infinity));
  if (c.device === "R1") {
    const asks = ps.filter((p) => (p.msg === "DISCOVER" || p.msg === "REQUEST") && fromClient(p) && p.dst === "255.255.255.255");
    const rel = ps.filter(relayedToServer);
    if (rel.length) return { state: "ok", seen: `${rel.length} request(s) relayed by R1 arrived at DHCP-SRV` };
    if (asks.length) return { state: "bad", seen: `${asks.length} broadcast request(s) reached R1 since the change; none arrived at DHCP-SRV` };
    return { state: "wait", seen: "no laptop broadcast has reached R1 since the change" };
  }
  if (c.device === "DHCP-SRV") {
    const arrived = ps.filter((p) => (p.msg === "DISCOVER" || p.msg === "REQUEST") && p.hops.some((h) => h.node === "DHCP-SRV"));
    const answers = ps.filter((p) => (p.msg === "OFFER" || p.msg === "ACK") && p.hops[0]?.node === "DHCP-SRV");
    if (answers.length) return { state: "ok", seen: `DHCP-SRV answered: ${[...new Set(answers.map((p) => p.msg))].join(" + ")}` };
    if (arrived.length) return { state: "bad", seen: `${arrived.length} request(s) arrived at DHCP-SRV since the change; it sent no OFFER or ACK` };
    return { state: "wait", seen: "no DHCP request has reached DHCP-SRV since the change" };
  }
  const queries = ps.filter((p) => p.msg === "DNS query" && p.hops.some((h) => h.node === "DNS-SRV"));
  const answers = ps.filter((p) => p.msg === "DNS response" && p.hops[0]?.node === "DNS-SRV");
  const good = answers.filter((p) => !/No such name/.test(p.info));
  if (good.length) return { state: "ok", seen: `DNS-SRV answered with ${good.length} A record(s)${answers.length > good.length ? `, and ${answers.length - good.length} “No such name”` : ""}` };
  if (queries.length) return { state: "bad", seen: answers.length ? `${answers.length} query(ies) answered “No such name”` : `${queries.length} query(ies) arrived; none answered` };
  return { state: "wait", seen: "no DNS query has reached DNS-SRV since the change" };
}

function service(c: Change, lab: DlState): Pick<Stage, "state" | "seen"> {
  const ps = lab.capture.filter((p) => p.no > (c.mark ?? Infinity));
  if (c.device === "DNS-SRV") {
    const tried = ps.some((p) => p.msg === "DNS query" && fromClient(p));
    if (!tried) return { state: "wait", seen: "no laptop has looked up a name since the change" };
    const r = evalDns(lab, c.mark!);
    return r.pass ? { state: "ok", seen: "a laptop resolves both names and reaches www by name" } : { state: "bad", seen: `a laptop tried since the change; not yet shown: ${r.checks.filter((k) => !k.ok).map((k) => k.label.toLowerCase()).join("; ")}` };
  }
  const tried = ps.some((p) => p.msg === "DISCOVER" && fromClient(p));
  if (!tried) return { state: "wait", seen: ps.some((p) => p.msg === "REQUEST" && fromClient(p)) ? "only a renewal since the change: a renewal goes straight to the server and skips the relay" : "no laptop has asked for a new lease since the change" };
  const r = evalDhcp(lab, c.mark!);
  return r.pass ? { state: "ok", seen: "a laptop got a full, correct lease and reaches its gateway" } : { state: "bad", seen: `a laptop tried since the change; not yet shown: ${r.checks.filter((k) => !k.ok).map((k) => k.label.toLowerCase()).join("; ")}` };
}

const ASK: Record<VDev, { active: string; device: string; deviceHow: string; traffic: string; trafficHow: string }> = {
  R1: {
    active: "You changed the candidate configuration. What makes a Junos candidate become what R1 runs?",
    device: "You changed the relay configuration. How could you prove R1 is now using it?",
    deviceHow: "On R1: show running-config (IOS) or show configuration (Junos) — read the interface section. show ip interface GigabitEthernet0/0 / show dhcp relay statistics also tell you.",
    traffic: "R1 runs it — but does it do the job? Has a laptop's broadcast crossed R1 since, and where did R1 send it?",
    trafficHow: "From CLIENT: ipconfig /release then ipconfig /renew. Then R1's Traffic tab (or Follow): did a relayed DISCOVER arrive at DHCP-SRV?",
  },
  "DHCP-SRV": {
    active: "The file is saved on disk. When does dhcpd read its configuration file?",
    device: "You restarted the service. How could you prove dhcpd is actually running your file?",
    deviceHow: "On DHCP-SRV: systemctl status isc-dhcp-server, then journalctl -u isc-dhcp-server (it logs the subnet and range it loaded).",
    traffic: "dhcpd runs — but does it answer? Has a request reached it since the restart, and did it reply?",
    trafficHow: "From CLIENT: ipconfig /release then ipconfig /renew. Then journalctl -u isc-dhcp-server, or DHCP-SRV's Traffic tab.",
  },
  "DNS-SRV": {
    active: "The zone file is saved on disk. When does named read it?",
    device: "rndc said the reload request was accepted. How could you prove named loaded your zone and serves the records?",
    deviceHow: "On DNS-SRV: dig @127.0.0.1 www.packetverse.test (ask named directly), journalctl -u named (it logs whether the zone loaded).",
    traffic: "named serves the zone — but do laptops' queries get the answer?",
    trafficHow: "From CLIENT: nslookup www.packetverse.test. Then journalctl -u named, or DNS-SRV's Traffic tab.",
  },
};

export function stagesOf(c: Change, lab: DlState): Stage[] {
  const a = ASK[c.device];
  const accepted: Stage = { n: 1, label: c.kind === "cli" ? "Command accepted" : c.kind === "candidate" ? "In the candidate configuration" : "File saved", state: "ok", seen: c.lines[c.lines.length - 1] };
  const act: Stage =
    c.activation === "ok"
      ? { n: 2, label: "Active", state: "ok", seen: c.kind === "cli" ? "IOS applies a configuration line the moment you press Enter" : c.device === "R1" ? "commit complete" : "the service restarted with the saved file" }
      : c.activation === "failed"
        ? { n: 2, label: "Active", state: "bad", seen: c.activationNote ?? "the activation step failed", ask: "The device refused to run it. What did it say, and where does it say why?", how: c.device === "DHCP-SRV" ? "systemctl status isc-dhcp-server and journalctl -u isc-dhcp-server give the reason; sudo dhcpd -t checks the file without starting anything." : "Read the error under the command." }
        : c.activation === "claimed"
          ? { n: 2, label: "Active?", state: c.checked ? (c.checked.ok ? "ok" : "bad") : "claimed", seen: c.checked ? (c.checked.ok ? "named loaded the zone" : `what you saw with ${c.checked.how} says otherwise`) : "rndc: server reload successful — the request was accepted; whether the zone loaded is a separate question", ...(!c.checked ? { ask: a.device, how: a.deviceHow } : {}), ...(c.checked && !c.checked.ok ? { ask: "named isn't serving what you saved. Where does named say what it did with your file?", how: "On DNS-SRV: journalctl -u named (the reload and the zone's fate), named-checkzone packetverse.test /etc/bind/db.packetverse.test (checks the file itself)." } : {}) }
          : { n: 2, label: "Active", state: "wait", seen: c.activationNote ?? "not active yet", ask: a.active, how: c.device === "R1" ? "commit (it checks the candidate first, then activates it)." : c.device === "DHCP-SRV" ? "Only when it starts: sudo systemctl restart isc-dhcp-server." : "Only when told to: sudo rndc reload." };
  const live = c.activation === "ok" || c.activation === "claimed";
  const dev: Stage = !live ? { n: 3, label: "Confirmed on the device", state: "wait", seen: "first it must be active" } : c.checked ? { n: 3, label: "Confirmed on the device", state: c.checked.ok ? "ok" : "bad", seen: c.checked.ok ? `you checked (${c.checked.how})` : `you checked (${c.checked.how}): read what it showed — it doesn't match the change` } : { n: 3, label: "Confirmed on the device", state: "wait", seen: "not checked yet", ask: a.device, how: a.deviceHow };
  const tr = live ? traffic(c, lab) : { state: "wait" as const, seen: "first it must be active" };
  const trS: Stage = { n: 4, label: "Traffic behaves", ...tr, ...(live && tr.state !== "ok" ? { ask: a.traffic, how: a.trafficHow } : {}) };
  const sv = live ? service(c, lab) : { state: "wait" as const, seen: "first it must be active" };
  const svS: Stage = { n: 5, label: "Service works end to end", ...sv, ...(live && sv.state !== "ok" ? { ask: "Does a laptop now get the whole service?", how: "The test bench (a brand-new laptop), or from CLIENT yourself: ipconfig /release, ipconfig /renew, ping 10.10.10.1, nslookup www.packetverse.test, ping www.packetverse.test." } : {}) };
  return [accepted, act, dev, trS, svS];
}

/** The first stage not yet confirmed (where the student's attention belongs). */
export const nextStage = (st: Stage[]) => st.find((s) => s.state !== "ok");
