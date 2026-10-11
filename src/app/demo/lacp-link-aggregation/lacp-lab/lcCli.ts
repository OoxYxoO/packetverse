import type { CliArgSpec, CliCommand, CliCommandSet, CliResult, CliVendor } from "@/lib/cli/types";
import { ciscoMac, columns, interfaceArg } from "@/lib/cli/format";
import type { CliQuestion } from "@/app/demo/dhcp-dns/dhcp-lab/dhcpBuildCli";
import { withSelfPing } from "@/lib/cli/selfPing";
import { withShellHistory } from "@/lib/cli/shellHistory";
import { HOST_IP, HOST_MAC, LC_HOSTS, LC_MEMBERS, LC_PORTS, SYS_MAC, lcClone, lcTable, otherSw, pk, portNum, type LcAction, type LcHost, type LcMember, type LcMemberCfg, type LcMode, type LcPort, type LcState, type LcSw, type LcSwCfg } from "@/lib/sim-engine/scenarios/lacpNet";
import { CISCO_IF, CISCO_SHORT } from "./lcNames";

/**
 * Command lines of the LACP Lab — Cisco IOS or Junos (EX) on SW1/SW2, a Linux shell on the hosts. Every output is
 * printed from the lab state (the computed bundle, spanning tree over the logical links, the tables, counters, log);
 * every change goes through a lab action (IOS on Enter; Junos on commit).
 *
 *   IOS    show etherchannel summary · show etherchannel load-balance · show lacp neighbor | internal | sys-id ·
 *          show interfaces port-channel <n> | status | <if> · show spanning-tree · show mac address-table ·
 *          show logging · show running-config · configure terminal → interface <if> → channel-group <n> mode
 *          active | passive | on · no channel-group · lacp rate fast | normal · shutdown
 *   Junos  show lacp interfaces · show interfaces ae0 | ae1 | terse · show ethernet-switching table ·
 *          show spanning-tree interface · show log messages · show configuration interfaces · configure →
 *          set interfaces <if> ether-options 802.3ad ae0 | ae1 · set interfaces ae0 aggregated-ether-options lacp
 *          active | passive | periodic fast | slow · delete … lacp (static LAG) · set interfaces <if> disable → commit
 */

export type LcIosMode = { kind: "exec" } | { kind: "config" } | { kind: "if"; port: LcPort } | { kind: "po"; group: number };
export type LcCand = Record<LcSw, LcSwCfg>;
export interface LcCliApi {
  view: LcState;
  act: (a: LcAction) => LcState;
  ios: Record<LcSw, LcIosMode>;
  setIos: (d: LcSw, m: LcIosMode) => void;
  junosEdit: Record<LcSw, boolean>;
  setJunosEdit: (d: LcSw, b: boolean) => void;
  cand: LcCand;
  setCand: (c: LcCand) => void;
  ask?: (q: CliQuestion | undefined) => void;
  history?: string[];
}
const refuse = (output: string, explanation?: string): CliResult => ({ output, refused: true, explanation });
const prefixed = (cmds: CliCommand[], word: "do" | "run"): CliCommand[] => cmds.map((c) => ({ ...c, id: `${word}:${c.id}`, syntax: `${word} ${c.syntax}` }));
const stamp = (clock: number) => {
  const hh = String(Math.floor(clock / 3600) % 24).padStart(2, "0");
  const mm = String(Math.floor(clock / 60) % 60).padStart(2, "0");
  const ss = String(Math.floor(clock) % 60).padStart(2, "0");
  return { ios: `*Mar  1 ${hh}:${mm}:${ss}.000`, junos: `Mar  1 ${hh}:${mm}:${ss}` };
};
export const PORT_DESC: Record<LcSw, Record<LcPort, string>> = {
  SW1: { "ge-0/0/1": "HOST-A", "ge-0/0/2": "HOST-D", "ge-0/0/22": "uplink-SW2-c", "ge-0/0/23": "uplink-SW2-a", "ge-0/0/24": "uplink-SW2-b" },
  SW2: { "ge-0/0/1": "HOST-B", "ge-0/0/2": "HOST-C", "ge-0/0/22": "uplink-SW1-c", "ge-0/0/23": "uplink-SW1-a", "ge-0/0/24": "uplink-SW1-b" },
};
const isMember = (p: string): p is LcMember => (LC_MEMBERS as readonly string[]).includes(p);
const groupsUsed = (c: LcSwCfg) => [1, 2].filter((g) => LC_MEMBERS.some((m) => c.members[m].group === g && c.members[m].mode !== "off"));
function setSw(api: LcCliApi, sw: LcSw, c: LcSwCfg, text: string, junosCommit = false) {
  const cfg = lcClone(api.view.cfg);
  cfg.sw[sw] = lcClone(c);
  api.act({ type: "cfg", cfg, text: `${sw}: ${text}`, junosCommit: junosCommit ? sw : undefined });
}
const memberStatus = (s: LcState, sw: LcSw, p: string) => {
  if (!isMember(p)) return "connected";
  const i = s.bundle.members[pk(sw, p)];
  return i.state === "down" ? (s.cfg.sw[sw].members[p].shut ? "disabled" : "notconnect") : i.state === "suspended" ? "suspended" : i.state === "errdis" ? "err-disabled" : "connected";
};
const poMembers = (s: LcState, sw: LcSw, g: number) => LC_MEMBERS.filter((m) => s.cfg.sw[sw].members[m].group === g && s.cfg.sw[sw].members[m].mode !== "off");
/** The members THIS switch has bundled. A static ("on") member counts whatever the far end does: with no protocol, the switch can't know. */
const bundledIn = (s: LcState, sw: LcSw, g: number) => poMembers(s, sw, g).filter((m) => s.bundle.members[pk(sw, m)].state === "bundled" && (s.cfg.sw[sw].members[m].mode === "on" || s.bundle.members[pk(otherSw(sw), m)].state === "bundled"));
const poUp = (s: LcState, sw: LcSw, g: number) => bundledIn(s, sw, g).length > 0 && !s.bundle.poErr.includes(pk(sw, `Po${g}`));

// ---------------------------------------------------------------------------------------------------------------
// Cisco IOS
// ---------------------------------------------------------------------------------------------------------------
function iosRunning(s: LcState, sw: LcSw): string {
  const c = s.cfg.sw[sw];
  const lines = [
    `hostname ${sw}`,
    "!",
    "port-channel load-balance src-dst-ip",
    "spanning-tree mode rapid-pvst",
    "spanning-tree pathcost method long",
    ...(sw === "SW1" ? ["spanning-tree vlan 1 priority 24576"] : []),
    "!",
    ...groupsUsed(c).flatMap((g) => [`interface Port-channel${g}`, " switchport mode trunk", "!"]),
    ...LC_PORTS.flatMap((p) => {
      const m = isMember(p) ? c.members[p] : undefined;
      return [`interface ${CISCO_IF[p]}`, ` description ${PORT_DESC[sw][p]}`, ...(m ? [" switchport mode trunk", ...(m.mode !== "off" ? [` channel-group ${m.group} mode ${m.mode}`] : []), ...(m.fast ? [" lacp rate fast"] : []), ...(m.shut ? [" shutdown"] : [])] : [" switchport mode access", " spanning-tree portfast"]), "!"];
    }),
    "end",
  ];
  return `Building configuration...\n\nCurrent configuration : ${lines.join("\n").length} bytes\n!\n${lines.join("\n")}`;
}
const FLAG: Record<string, string> = { bundled: "P", suspended: "s", individual: "I", down: "D", errdis: "D", hot: "H" };
function iosExec(api: LcCliApi, sw: LcSw): CliCommand[] {
  const s = api.view;
  const c = s.cfg.sw[sw];
  const ifArg = { interface: interfaceArg("cisco", CISCO_IF, PORT_DESC[sw]) };
  const gArg: CliArgSpec = { choices: groupsUsed(c).map(String), describe: (x) => `Port-channel${x}`, resolve: (raw) => (/^[12]$/.test(raw) ? raw : undefined) };
  const nb = (m: LcMember) => s.cfg.sw[otherSw(sw)].members[m];
  const st = (m: LcMember) => {
    const me = s.cfg.sw[sw].members[m];
    const inSync = s.bundle.members[pk(sw, m)].state === "bundled" && s.bundle.members[pk(otherSw(sw), m)].state === "bundled";
    return (me.mode === "active" ? 0x1 : 0) | (me.fast ? 0x2 : 0) | 0x4 | (inSync ? 0x8 | 0x10 | 0x20 : 0) | (s.bundle.members[pk(sw, m)].lacp ? 0 : 0x40);
  };
  const hex = (n: number) => `0x${n.toString(16).toUpperCase()}`;
  return [
    {
      id: "ec-sum",
      syntax: "show etherchannel summary",
      summary: "Every Port-channel, its protocol, and each member's flag (P bundled · s suspended · D down)",
      run: () => {
        const gs = groupsUsed(c);
        const rows = gs.map((g) => {
          const ms = poMembers(s, sw, g);
          const proto = ms.every((m) => c.members[m].mode === "on") ? "-" : "LACP";
          const err = s.bundle.poErr.includes(pk(sw, `Po${g}`));
          return [String(g), `Po${g}(S${poUp(s, sw, g) ? "U" : "D"})`, proto, ms.map((m) => `${CISCO_SHORT[m]}(${s.bundle.members[pk(sw, m)].state === "bundled" && !bundledIn(s, sw, g).includes(m) && !err ? "s" : FLAG[s.bundle.members[pk(sw, m)].state]})`).join("  ")];
        });
        return {
          output: ["Flags:  D - down        P - bundled in port-channel", "        I - stand-alone s - suspended", "        H - Hot-standby (LACP only)", "        R - Layer3      S - Layer2", "        U - in use      f - failed to allocate aggregator", "", "        M - not in use, minimum links not met", "        u - unsuitable for bundling", "        w - waiting to be aggregated", "        d - default port", "", "", `Number of channel-groups in use: ${gs.length}`, `Number of aggregators:           ${gs.length}`, "", columns([["Group", "Port-channel", "Protocol", "Ports"], ["------+", "-------------+", "-----------+", "-----------------------------------------------"], ...rows], [7, 14, 12]), ...(gs.length ? [] : ["", "(no channel-group is configured)"])].join("\n"),
          explanation: "(SU) = Layer 2, in use. (P) = bundled: the member carries traffic. (s) = suspended: configured in the group but not aggregated (no LACP partner, or a partner mismatch). (D) = down / err-disabled.",
        };
      },
    },
    { id: "ec-lb", syntax: "show etherchannel load-balance", summary: "How flows are spread over the members", run: () => ({ output: ["EtherChannel Load-Balancing Configuration:", "        src-dst-ip", "", "EtherChannel Load-Balancing Addresses Used Per-Protocol:", "Non-IP: Source XOR Destination MAC address", "  IPv4: Source XOR Destination IP address", "  IPv6: Source XOR Destination IP address"].join("\n"), explanation: "Each flow (source + destination) always lands on the same member; different flows spread out. The lab draws a simplified, labeled hash: (last octet of source + last octet of destination) mod number-of-members." }) },
    {
      id: "lacp-nb",
      syntax: "show lacp neighbor",
      summary: "What LACP hears from the partner on each member (system, key, state)",
      run: () => {
        const ms = LC_MEMBERS.filter((m) => c.members[m].mode === "active" || c.members[m].mode === "passive");
        if (!ms.length) return { output: "", explanation: "No member runs LACP on this switch." };
        const out = ["Flags:  S - Device is requesting Slow LACPDUs", "        F - Device is requesting Fast LACPDUs", "        A - Device is in Active mode       P - Device is in Passive mode", ""];
        for (const g of [1, 2]) {
          const gm = ms.filter((m) => c.members[m].group === g);
          if (!gm.length) continue;
          out.push(`Channel group ${g} neighbors`, "");
          const rows = gm.flatMap((m) => {
            const info = s.bundle.members[pk(sw, m)];
            if (!info.lacp) return [];
            const p = nb(m);
            return [[CISCO_SHORT[m], `${p.fast ? "F" : "S"}${p.mode === "active" ? "A" : "P"}`, "32768", ciscoMac(SYS_MAC[otherSw(sw)]), `${12 + portNum(m) % 7}s`, "0x0", hex(p.group), hex(0x100 + portNum(m)), hex(stOf(s, otherSw(sw), m))]];
          });
          out.push(columns([["", "", "LACP port", "", "", "Admin", "Oper", "Port", "Port"], ["Port", "Flags", "Priority", "Dev ID", "Age", "key", "Key", "Number", "State"], ...rows], [10, 7, 10, 16, 6, 6, 6, 8]));
          if (!rows.length) out.push("(no LACP partner heard on these ports)");
          out.push("");
        }
        return { output: out.join("\n"), explanation: "Oper Key = the partner's channel group. All members of one Port-channel must see the SAME partner (Dev ID and key). No line = no LACPDU heard on that port." };
      },
    },
    {
      id: "lacp-int",
      syntax: "show lacp internal",
      summary: "This switch's own LACP state on each member",
      run: () => {
        const ms = LC_MEMBERS.filter((m) => c.members[m].mode === "active" || c.members[m].mode === "passive");
        if (!ms.length) return { output: "", explanation: "No member runs LACP on this switch." };
        const out = ["Flags:  S - Device is requesting Slow LACPDUs", "        F - Device is requesting Fast LACPDUs", "        A - Device is in Active mode       P - Device is in Passive mode", ""];
        for (const g of [1, 2]) {
          const gm = ms.filter((m) => c.members[m].group === g);
          if (!gm.length) continue;
          out.push(`Channel group ${g}`, columns([["", "", "", "LACP port", "Admin", "Oper", "Port", "Port"], ["Port", "Flags", "State", "Priority", "Key", "Key", "Number", "State"], ...gm.map((m) => [CISCO_SHORT[m], `${c.members[m].fast ? "F" : "S"}${c.members[m].mode === "active" ? "A" : "P"}`, s.bundle.members[pk(sw, m)].state === "bundled" && bundledIn(s, sw, g).includes(m) ? "bndl" : s.bundle.members[pk(sw, m)].state === "down" ? "down" : "susp", "32768", hex(g), hex(g), hex(0x100 + portNum(m)), hex(st(m))])], [10, 7, 7, 10, 7, 6, 8]), "");
        }
        return { output: out.join("\n"), explanation: "State bndl = bundled; susp = suspended. Port State is the LACP state byte: 0x3D = Active, Aggregation, Synchronization, Collecting, Distributing." };
      },
    },
    { id: "lacp-sys", syntax: "show lacp sys-id", summary: "This switch's LACP system ID", run: () => ({ output: `32768, ${ciscoMac(SYS_MAC[sw])}`, explanation: "System priority + MAC: how the partner recognizes THIS switch in its LACPDUs." }) },
    {
      id: "po",
      syntax: "show interfaces port-channel <group>",
      summary: "One Port-channel: state, bandwidth, members",
      args: { group: gArg },
      run: ({ group }) => {
        const g = +group;
        if (!groupsUsed(c).includes(g)) return refuse("                                    ^\n% Invalid input detected at '^' marker.", `Port-channel${g} doesn't exist on ${sw}.`);
        const b = bundledIn(s, sw, g);
        const up = poUp(s, sw, g);
        return { output: [`Port-channel${g} is ${s.bundle.poErr.includes(pk(sw, `Po${g}`)) ? "down, line protocol is down (err-disabled)" : up ? "up, line protocol is up (connected)" : "down, line protocol is down (notconnect)"}`, `  Hardware is EtherChannel, address is ${ciscoMac(SYS_MAC[sw])}`, `  MTU 1500 bytes, BW ${(b.length * 1000000).toLocaleString("en-US").replace(/,/g, "")} Kbit/sec, DLY 10 usec,`, "  Full-duplex, 1000Mb/s, link type is auto, media type is N/A", `  Members in this channel: ${b.map((m) => CISCO_SHORT[m]).join(" ")}`].join("\n"), explanation: `BW = the sum of the bundled members (${b.length} × 1 Gb/s). One flow still uses one member (1 Gb/s max); many flows use them all.` };
      },
    },
    { id: "status", syntax: "show interfaces status", summary: "Link state of every port and Port-channel", run: () => ({ output: columns([["Port", "Name", "Status", "Vlan", "Duplex", "Speed", "Type"], ...LC_PORTS.map((p) => [CISCO_SHORT[p], PORT_DESC[sw][p], memberStatus(s, sw, p), isMember(p) ? "trunk" : "1", "a-full", "a-1000", "10/100/1000BaseTX"]), ...groupsUsed(c).map((g) => [`Po${g}`, "", s.bundle.poErr.includes(pk(sw, `Po${g}`)) ? "err-disabled" : poUp(s, sw, g) ? "connected" : "notconnect", "trunk", "a-full", `a-${bundledIn(s, sw, g).length || 1}G`, ""])], [10, 14, 13, 6, 8, 8]), explanation: "suspended = the cable is up but LACP keeps the port out of the bundle. A silently broken member still shows connected." }) },
    { id: "if", syntax: "show interfaces <interface>", summary: "One port: link and counters", args: ifArg, run: ({ interface: p }) => { const k = s.counters[pk(sw, p)]; const stt = memberStatus(s, sw, p); return { output: [`${CISCO_IF[p as LcPort]} is ${stt === "disabled" ? "administratively down" : stt === "notconnect" ? "down" : "up"}, line protocol is ${stt === "connected" ? "up (connected)" : `down (${stt})`}`, `  Description: ${PORT_DESC[sw][p as LcPort]}`, ...(isMember(p) && c.members[p].mode !== "off" ? [`  Member of Port-channel${c.members[p].group}`] : []), `     ${k.inF} packets input, ${k.outF} packets output`, `     ${k.lacpIn} LACPDUs received, ${k.lacpOut} LACPDUs sent`, `     ${k.drops} input frames discarded`].join("\n"), explanation: "Packets input/output per member show how the hash spread the flows. LACPDUs: is LACP really talking on this cable?" }; } },
    {
      id: "stp",
      syntax: "show spanning-tree",
      summary: "Spanning tree over the logical links (a Port-channel is ONE port)",
      run: () => {
        const ls = s.bundle.logical;
        const rows = [...LC_PORTS.filter((p) => !isMember(p)).map((p) => [CISCO_SHORT[p], "Desg", "FWD", "20000", `128.${portNum(p)}`, "P2p Edge"]), ...ls.map((l) => [l.kind === "po" ? l.ends[sw] : CISCO_SHORT[l.ends[sw] as LcPort], sw === "SW1" ? "Desg" : l.stp === "fwd" ? "Root" : "Altn", l.stp === "fwd" || sw === "SW1" ? "FWD" : "BLK", String(l.cost), l.kind === "po" ? `128.${2047 + +l.ends[sw].slice(2)}` : `128.${portNum(l.ends[sw])}`, "P2p"])];
        const root = ls.find((l) => l.stp === "fwd");
        return { output: ["VLAN0001", "  Spanning tree enabled protocol rstp", `  Root ID    Priority    24577`, `             Address     ${ciscoMac(SYS_MAC.SW1)}`, ...(sw === "SW1" ? ["             This bridge is the root"] : root ? [`             Cost        ${root.cost}`, `             Port        ${root.kind === "po" ? `${2047 + +root.ends.SW2.slice(2)} (Port-channel${root.ends.SW2.slice(2)})` : `${portNum(root.ends.SW2)} (${CISCO_IF[root.ends.SW2 as LcPort]})`}`] : []), "", `  Bridge ID  Priority    ${sw === "SW1" ? "24577  (priority 24576 sys-id-ext 1)" : "32769  (priority 32768 sys-id-ext 1)"}`, `             Address     ${ciscoMac(SYS_MAC[sw])}`, "", columns([["Interface", "Role", "Sts", "Cost", "Prio.Nbr", "Type"], ["-------------------", "----", "---", "---------", "--------", "--------------------------------"], ...rows], [20, 5, 4, 10, 9])].join("\n"), explanation: "The members of a Port-channel never appear here: spanning tree sees Po1 as ONE port (cost 20000 / members). Separate cables between the same switches are separate ports — all but one are blocked." };
      },
    },
    { id: "mac", syntax: "show mac address-table", summary: `${sw}'s MAC table (bundled members appear as the Port-channel)`, run: () => { const rows = lcTable(s.fdb, sw); return { output: ["          Mac Address Table", "-------------------------------------------", "", columns([["Vlan", "Mac Address", "Type", "Ports"], ["----", "-----------", "--------", "-----"], ...rows.map((e) => ["   1", ciscoMac(e.mac), "DYNAMIC", /^Po/.test(e.port) ? e.port : CISCO_SHORT[e.port as LcPort]])], [8, 18, 12]), `Total Mac Addresses for this criterion: ${rows.length}`].join("\n"), explanation: "MACs behind the bundle are learned on Po1, whatever member their frames arrived on." }; } },
    {
      id: "log",
      syntax: "show logging",
      summary: "The log: members joining and leaving, suspensions, err-disable",
      run: () => {
        const l = s.syslog.filter((x) => x.sw === sw).slice(-40).flatMap((x) => {
          const t = stamp(x.clock).ios;
          const P = CISCO_SHORT[x.port as LcPort] ?? x.port;
          switch (x.ev) {
            case "bundle":
              return [`${t}: %EC-5-BUNDLE: Interface ${P} joined port-channel ${x.text}`];
            case "unbundle":
            case "timeout":
              return [`${t}: %EC-5-UNBUNDLE: Interface ${P} left the port-channel ${x.text}`];
            case "suspend":
              return [/LACP currently not enabled|no LACPDUs|nobody starts|stopped arriving/.test(x.text ?? "") ? `${t}: %EC-5-L3DONTBNDL2: ${P} suspended: LACP currently not enabled on the remote port.` : `${t}: %EC-5-CANNOT_BUNDLE2: ${P} is not compatible with ${x.text?.match(/Po\d/)?.[0] ?? "the aggregator"} and will be suspended (partner mismatch)`];
            case "errdis":
              return [`${t}: %PM-4-ERR_DISABLE: channel-misconfig (STP) error detected on ${x.port}, putting ${x.port} in err-disable state`];
            case "up":
              return [`${t}: %LINK-3-UPDOWN: Interface ${CISCO_IF[x.port as LcPort]}, changed state to up`];
            case "down":
              return [`${t}: %LINK-3-UPDOWN: Interface ${CISCO_IF[x.port as LcPort]}, changed state to down`];
            default:
              return [];
          }
        });
        return { output: ["Syslog logging: enabled", "", "Log Buffer (8192 bytes):", ...(l.length ? l : ["(no messages)"])].join("\n") };
      },
    },
    { id: "run", syntax: "show running-config", summary: `${sw}'s configuration`, run: () => ({ output: iosRunning(s, sw) }) },
    { id: "clear", syntax: "clear mac address-table dynamic", summary: "Forget every learned entry", run: () => (api.act({ type: "clear", sw }), { output: "" }) },
    { id: "clr", syntax: "clear counters", summary: "Reset the interface counters", run: () => (api.act({ type: "clear-counters" }), { output: "" }) },
    { id: "hist", syntax: "show history", summary: "The commands you typed in this session", run: () => ({ output: [...(api.history ?? []), "show history"].map((x) => `  ${x}`).join("\n") }) },
  ];
}
function stOf(s: LcState, sw: LcSw, m: LcMember): number {
  const me = s.cfg.sw[sw].members[m];
  const inSync = s.bundle.members[pk(sw, m)].state === "bundled" && s.bundle.members[pk(otherSw(sw), m)].state === "bundled";
  return (me.mode === "active" ? 0x1 : 0) | (me.fast ? 0x2 : 0) | 0x4 | (inSync ? 0x38 : 0);
}
function iosSet(api: LcCliApi, sw: LcSw): CliCommandSet {
  const s = api.view;
  const c = s.cfg.sw[sw];
  const exec = iosExec(api, sw);
  const base = { vendor: "cisco" as const, deviceId: sw, deviceName: sw };
  const mode = api.ios[sw];
  const ifArg = { interface: interfaceArg("cisco", CISCO_IF, PORT_DESC[sw]) };
  const end: CliCommand = { id: "end", syntax: "end", summary: "Leave configuration mode", run: () => (api.setIos(sw, { kind: "exec" }), { output: "%SYS-5-CONFIG_I: Configured from console by console" }) };
  if (mode.kind === "exec") return { ...base, prompt: `${sw}#`, commands: [...exec, { id: "conf", syntax: "configure terminal", summary: "Enter configuration mode", run: () => (api.setIos(sw, { kind: "config" }), { output: "Enter configuration commands, one per line.  End with CNTL/Z." }) }] };
  const doCmds = prefixed(exec, "do");
  const poArg: CliArgSpec = { choices: ["Port-channel1", "Port-channel2"], describe: (x) => x, resolve: (raw) => { const m = /^(port-channel|po)([12])$/i.exec(raw); return m ? m[2] : undefined; } };
  const common: CliCommand[] = [
    { id: "if", syntax: "interface <interface>", summary: "Configure one port", args: ifArg, run: ({ interface: p }) => (api.setIos(sw, { kind: "if", port: p as LcPort }), { output: "" }) },
    { id: "po", syntax: "interface <po>", summary: "Configure a Port-channel interface", args: { po: poArg }, run: ({ po }) => (api.setIos(sw, { kind: "po", group: +po }), { output: "" }) },
  ];
  if (mode.kind === "config")
    return { ...base, prompt: `${sw}(config)#`, commands: [...common, { id: "lb", syntax: "port-channel load-balance src-dst-ip", summary: "Hash flows on source and destination IP (already the setting)", run: () => ({ output: "", explanation: "Already configured. The hash decides which member each flow uses; it never adds bandwidth to a single flow." }) }, { id: "exit", syntax: "exit", summary: "Back to privileged mode", run: () => (api.setIos(sw, { kind: "exec" }), { output: "" }) }, end, ...doCmds] };
  if (mode.kind === "po") return { ...base, prompt: `${sw}(config-if)#`, commands: [{ id: "trunk", syntax: "switchport mode trunk", summary: "", hidden: true, run: () => ({ output: "", explanation: "Already a trunk. Port-channel settings are copied to its members." }) }, ...common, { id: "exit", syntax: "exit", summary: "Back to global configuration", run: () => (api.setIos(sw, { kind: "config" }), { output: "" }) }, end, ...doCmds] };
  const p = mode.port;
  const member = isMember(p);
  const pc = member ? c.members[p] : undefined;
  const setMember = (patch: Partial<LcMemberCfg>, line: string) => setSw(api, sw, { ...c, members: { ...c.members, [p]: { ...pc!, ...patch } } }, `interface ${CISCO_IF[p]} · ${line}`);
  const notMember: CliResult = refuse("% Not available in this lab: this port connects a host.", "Only the uplink ports (Gi1/0/22–24) lead to the other switch.");
  const groupArg: CliArgSpec = { choices: ["1", "2"], describe: (x) => `Port-channel${x}`, resolve: (raw) => (/^\d+$/.test(raw) && +raw >= 1 && +raw <= 128 ? raw : undefined) };
  const cg = (g: string, mo: LcMode): CliResult => {
    if (!member) return notMember;
    if (+g > 2) return refuse(`% Not available in this lab: use channel-group 1 or 2.`);
    const exists = groupsUsed(c).includes(+g);
    const otherMode = LC_MEMBERS.find((m) => m !== p && c.members[m].group === +g && c.members[m].mode !== "off");
    if (otherMode && ((c.members[otherMode].mode === "on") !== (mo === "on"))) return refuse(`Command rejected (Port-channel${g}, ${CISCO_IF[p]}): Invalid etherchnl mode`, "All members of one Port-channel must use the same protocol: static (on) or LACP (active/passive).");
    setMember({ group: +g as 1 | 2, mode: mo }, `channel-group ${g} mode ${mo}`);
    return { output: exists ? "" : `Creating a port-channel interface Port-channel ${g}`, explanation: mo === "on" ? "Static: this port joins the bundle without LACP — the far end must also be static, or it will never agree." : mo === "passive" ? "Passive: this port answers LACPDUs but never starts. The far end must be active." : "Active: this port starts LACP and bundles as soon as the partner agrees." };
  };
  return {
    ...base,
    prompt: `${sw}(config-if)#`,
    commands: [
      { id: "cg", syntax: "channel-group <group> mode active", summary: "Join Port-channel <group>, LACP active", args: { group: groupArg }, run: ({ group }) => cg(group, "active") },
      { id: "cg", syntax: "channel-group <group> mode passive", summary: "Join Port-channel <group>, LACP passive", args: { group: groupArg }, run: ({ group }) => cg(group, "passive") },
      { id: "cg", syntax: "channel-group <group> mode on", summary: "Join Port-channel <group>, static (no LACP)", args: { group: groupArg }, run: ({ group }) => cg(group, "on") },
      { id: "nocg", syntax: "no channel-group", summary: "Leave the Port-channel (become a normal port)", run: () => (!member ? notMember : pc!.mode === "off" ? { output: "" } : (setMember({ mode: "off" }, "no channel-group"), { output: "", explanation: "A normal switch port again: spanning tree now sees it as its own link to the other switch." })) },
      { id: "nocg", syntax: "no channel-group <group>", hidden: true, args: { group: groupArg }, summary: "", run: () => (!member ? notMember : pc!.mode === "off" ? { output: "" } : (setMember({ mode: "off" }, "no channel-group"), { output: "", explanation: "A normal switch port again: spanning tree now sees it as its own link to the other switch." })) },
      { id: "rate", syntax: "lacp rate fast", summary: "Ask the partner for an LACPDU every second (timeout 3 s)", run: () => (!member ? notMember : (setMember({ fast: true }, "lacp rate fast"), { output: "", explanation: "This port now detects a partner that stops talking in 3 s instead of 90 s." })) },
      { id: "rate", syntax: "lacp rate normal", summary: "Back to the slow rate (every 30 s, timeout 90 s)", run: () => (!member ? notMember : (setMember({ fast: false }, "lacp rate normal"), { output: "" })) },
      { id: "shut", syntax: "shutdown", summary: "Disable this port", run: () => (!member ? notMember : (setMember({ shut: true }, "shutdown"), { output: `${stamp(s.clock).ios}: %LINK-5-CHANGED: Interface ${CISCO_IF[p]}, changed state to administratively down` })) },
      { id: "noshut", syntax: "no shutdown", summary: "Enable this port", run: () => (!member ? notMember : (setMember({ shut: false }, "no shutdown"), { output: "" })) },
      ...common,
      { id: "exit", syntax: "exit", summary: "Back to global configuration", run: () => (api.setIos(sw, { kind: "config" }), { output: "" }) },
      end,
      ...doCmds,
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Junos
// ---------------------------------------------------------------------------------------------------------------
const aeMode = (c: LcSwCfg, g: number): LcMode | undefined => LC_MEMBERS.map((m) => c.members[m]).find((x) => x.group === g && x.mode !== "off")?.mode;
interface JNode {
  name: string;
  kids?: JNode[];
}
function junosTree(sw: LcSw, c: LcSwCfg): JNode[] {
  const gs = groupsUsed(c);
  return [
    { name: "system", kids: [{ name: `host-name ${sw}` }] },
    { name: "chassis", kids: [{ name: "aggregated-devices", kids: [{ name: "ethernet", kids: [{ name: "device-count 2" }] }] }] },
    {
      name: "interfaces",
      kids: [
        ...LC_PORTS.map((p) => {
          const m = isMember(p) ? c.members[p] : undefined;
          return { name: p, kids: [...(m?.shut ? [{ name: "disable" }] : []), { name: `description ${PORT_DESC[sw][p]}` }, ...(m && m.mode !== "off" ? [{ name: "ether-options", kids: [{ name: `802.3ad ae${m.group - 1}` }] }] : [{ name: "unit 0", kids: [{ name: "family ethernet-switching", kids: [{ name: `interface-mode ${m ? "trunk" : "access"}` }] }] }])] };
        }),
        ...gs.map((g) => {
          const mo = aeMode(c, g)!;
          const fast = LC_MEMBERS.some((m) => c.members[m].group === g && c.members[m].mode !== "off" && c.members[m].fast);
          return { name: `ae${g - 1}`, kids: [{ name: "aggregated-ether-options", kids: mo === "on" ? [{ name: "link-speed 1g" }] : [{ name: "lacp", kids: [{ name: mo }, ...(fast ? [{ name: "periodic fast" }] : [])] }] }, { name: "unit 0", kids: [{ name: "family ethernet-switching", kids: [{ name: "interface-mode trunk" }] }] }] };
        }),
      ],
    },
  ];
}
const render = (nodes: JNode[], d = 0): string[] => nodes.flatMap((n) => (n.kids ? [`${"    ".repeat(d)}${n.name} {`, ...render(n.kids, d + 1), `${"    ".repeat(d)}}`] : [`${"    ".repeat(d)}${n.name};`]));
function walk(nodes: JNode[], path: string[]): string {
  const want = [...path];
  while (want.length) {
    const two = want.length > 1 ? `${want[0]} ${want[1]}` : undefined;
    const hit = nodes.find((n) => n.name === two) ?? nodes.find((n) => n.name === want[0]);
    if (!hit?.kids) return "";
    want.splice(0, hit.name.split(" ").length);
    nodes = hit.kids;
  }
  return render(nodes).join("\n");
}
export const lcJunosText = (sw: LcSw, c: LcSwCfg, path: string[] = []) => walk(junosTree(sw, c), path);
function junosOp(api: LcCliApi, sw: LcSw): CliCommand[] {
  const s = api.view;
  const c = s.cfg.sw[sw];
  const aeArg: CliArgSpec = { choices: groupsUsed(c).map((g) => `ae${g - 1}`), resolve: (raw) => (/^ae[01]$/.test(raw) ? raw : undefined) };
  const ifArg: CliArgSpec = { choices: [...LC_PORTS], describe: (x) => PORT_DESC[sw][x as LcPort], resolve: (raw) => ((LC_PORTS as string[]).includes(raw.replace(/\.0$/, "")) ? raw.replace(/\.0$/, "") : undefined) };
  const yn = (b: boolean) => (b ? "Yes" : "No");
  const lacpIfs = () => {
    const out: string[] = [];
    for (const g of groupsUsed(c)) {
      const ms = poMembers(s, sw, g);
      const mo = aeMode(c, g);
      out.push(`Aggregated interface: ae${g - 1}`);
      if (mo === "on") {
        out.push("    LACP is not configured on this interface (static LAG)", "");
        continue;
      }
      out.push("    LACP state:       Role   Exp   Def  Dist  Col  Syn  Aggr  Timeout  Activity");
      for (const m of ms) {
        const info = s.bundle.members[pk(sw, m)];
        const sync = info.state === "bundled" && bundledIn(s, sw, g).includes(m);
        const me = c.members[m];
        const p = s.cfg.sw[otherSw(sw)].members[m];
        const exp = /expired|timed out/.test(info.why);
        out.push(`      ${m.padEnd(13)} Actor   No   ${yn(!info.lacp).padEnd(4)} ${yn(sync).padEnd(4)} ${yn(sync).padEnd(4)} ${yn(sync).padEnd(4)}  Yes     ${me.fast ? "Fast" : "Slow"}   ${me.mode === "active" ? "Active" : "Passive"}`);
        out.push(`      ${m.padEnd(13)}Partner  ${yn(exp).padEnd(4)} ${yn(!info.lacp).padEnd(4)} ${yn(sync).padEnd(4)} ${yn(sync).padEnd(4)} ${yn(sync).padEnd(4)}  Yes     ${p.fast ? "Fast" : "Slow"}   ${p.mode === "active" ? "Active" : "Passive"}`);
      }
      out.push("    LACP protocol:        Receive State  Transmit State          Mux State");
      for (const m of ms) {
        const info = s.bundle.members[pk(sw, m)];
        const sync = info.state === "bundled" && bundledIn(s, sw, g).includes(m);
        out.push(`      ${m.padEnd(13)}         ${(info.state === "down" ? "Port disabled" : /expired|timed out/.test(info.why) ? "Expired" : info.lacp ? "Current" : "Defaulted").padEnd(14)} ${(c.members[m].fast ? "Fast periodic" : "Slow periodic").padEnd(16)} ${sync ? "Collecting distributing" : info.state === "down" ? "Detached" : "Attached"}`);
      }
      out.push("");
    }
    return out.join("\n");
  };
  return [
    { id: "lacp", syntax: "show lacp interfaces", summary: "LACP on each member: actor and partner state, mux state", run: () => ({ output: groupsUsed(c).length ? lacpIfs() : "", explanation: groupsUsed(c).length ? "Mux State “Collecting distributing” = the member carries traffic. “Attached” = configured but not aggregated. Def Yes = no LACPDU from the partner (defaulted)." : "No aggregated interface uses these ports." }) },
    { id: "ae", syntax: "show interfaces <ae>", summary: "An aggregated interface: speed, members", args: { ae: aeArg }, run: ({ ae }) => { const g = +ae.slice(2) + 1; if (!groupsUsed(c).includes(g)) return refuse(`error: device ${ae} not found`); const b = bundledIn(s, sw, g); return { output: [`Physical interface: ${ae}, Enabled, Physical link is ${poUp(s, sw, g) ? "Up" : "Down"}`, `  Link-level type: Ethernet, MTU: 1514, Speed: ${b.length}Gbps, BPDU Error: None,`, `  Minimum links needed: 1, Minimum bandwidth needed: 1bps`, `  Current address: ${SYS_MAC[sw].toLowerCase()}`, `  Logical interface ${ae}.0`, `    Protocol eth-switch, MTU: 1514`, `  Member links: ${b.join(", ") || "none"}`].join("\n"), explanation: `Speed = ${b.length} × 1 Gb/s of distributing members.` }; } },
    { id: "terse", syntax: "show interfaces terse", summary: "Link state of every port and ae", run: () => ({ output: columns([["Interface", "Admin", "Link", "Proto"], ...LC_PORTS.flatMap((p) => { const st = memberStatus(s, sw, p); const inAe = isMember(p) && c.members[p].mode !== "off"; return [[p, st === "disabled" ? "down" : "up", st === "notconnect" || st === "disabled" ? "down" : "up", ""], ...(inAe ? [[`${p}.0`, "up", st === "connected" || st === "suspended" ? "up" : "down", `aenet --> ae${c.members[p as LcMember].group - 1}.0`]] : [[`${p}.0`, "up", st === "connected" ? "up" : "down", "eth-switch"]])]; }), ...groupsUsed(c).flatMap((g) => [[`ae${g - 1}`, "up", poUp(s, sw, g) ? "up" : "down", ""], [`ae${g - 1}.0`, "up", poUp(s, sw, g) ? "up" : "down", "eth-switch"]])], [16, 6, 6]), explanation: "aenet --> ae0.0: the port belongs to ae0. A member whose link is up can still not be aggregated: check show lacp interfaces." }) },
    { id: "if", syntax: "show interfaces <iface>", summary: "One port: link and counters", args: { iface: ifArg }, run: ({ iface }) => { const k = s.counters[pk(sw, iface)]; return { output: [`Physical interface: ${iface}, Enabled, Physical link is ${memberStatus(s, sw, iface) === "notconnect" || memberStatus(s, sw, iface) === "disabled" ? "Down" : "Up"}`, `  Description: ${PORT_DESC[sw][iface as LcPort]}`, `  Input packets: ${k.inF}  Output packets: ${k.outF}`, `  LACP packets: received ${k.lacpIn}, sent ${k.lacpOut}`].join("\n") }; } },
    { id: "table", syntax: "show ethernet-switching table", summary: `${sw}'s MAC table`, run: () => { const rows = lcTable(s.fdb, sw); return { output: [`Ethernet switching table : ${rows.length} entries, ${rows.length} learned`, "Routing instance : default-switch", columns([["   Vlan", "MAC", "MAC", "Age", "Logical"], ["   name", "address", "flags", "", "interface"], ...rows.map((e) => ["   default", e.mac.toLowerCase(), "D", "-", /^Po/.test(e.port) ? `ae${+e.port.slice(2) - 1}.0` : `${e.port}.0`])], [13, 20, 8, 6])].join("\n") }; } },
    { id: "stp", syntax: "show spanning-tree interface", summary: "Spanning tree over the logical links", run: () => ({ output: ["Spanning tree interface parameters for instance 0", "", columns([["Interface", "Port ID", "Designated", "Designated", "Port", "State", "Role"], ["", "", "port ID", "bridge ID", "Cost", "", ""], ...s.bundle.logical.map((l) => [l.kind === "po" ? `ae${+l.ends[sw].slice(2) - 1}` : l.ends[sw], l.kind === "po" ? `128:${2047 + +l.ends[sw].slice(2)}` : `128:${portNum(l.ends[sw])}`, l.kind === "po" ? `128:${2047 + +l.ends.SW1.slice(2)}` : `128:${portNum(l.ends.SW1)}`, `24576.${SYS_MAC.SW1.replace(/:/g, "").toLowerCase()}`, String(l.cost), sw === "SW1" || l.stp === "fwd" ? "FWD" : "BLK", sw === "SW1" ? "DESG" : l.stp === "fwd" ? "ROOT" : "ALT"])], [12, 9, 11, 20, 8, 6])].join("\n"), explanation: "ae0 is one spanning-tree port; its members never appear. Two separate cables would be two ports — one of them ALT/BLK." }) },
    { id: "log", syntax: "show log messages", summary: "System log", run: () => { const l = s.syslog.filter((x) => x.sw === sw).slice(-40).flatMap((x) => { const t = stamp(x.clock).junos; switch (x.ev) { case "bundle": return [`${t}  ${sw} lacpd[1720]: ${x.port}: Collecting distributing on ae${+(x.text ?? "Po1").slice(2) - 1}`]; case "unbundle": return [`${t}  ${sw} lacpd[1720]: ${x.port}: removed from ae${+(x.text ?? "Po1").slice(2) - 1}`]; case "timeout": return [`${t}  ${sw} lacpd[1720]: LACPD_TIMEOUT: ${x.port}: lacp current while timer expired current Receive State: CURRENT`]; case "up": return [`${t}  ${sw} mib2d[1734]: SNMP_TRAP_LINK_UP: ifName ${x.port}`]; case "down": return [`${t}  ${sw} mib2d[1734]: SNMP_TRAP_LINK_DOWN: ifName ${x.port}`]; default: return []; } }); return { output: l.length ? l.join("\n") : "(no messages)" }; } },
    { id: "cfg", syntax: "show configuration interfaces", summary: "Interfaces and aggregated interfaces", run: () => ({ output: lcJunosText(sw, c, ["interfaces"]) }) },
    { id: "cfg", syntax: "show configuration interfaces <ae>", summary: "One aggregated interface", args: { ae: aeArg }, run: ({ ae }) => ({ output: lcJunosText(sw, c, ["interfaces", ae]) }) },
    { id: "cfg", syntax: "show configuration", summary: `${sw}'s committed configuration`, run: () => ({ output: lcJunosText(sw, c) }) },
    { id: "clear", syntax: "clear ethernet-switching table", summary: "Forget every learned entry", run: () => (api.act({ type: "clear", sw }), { output: "" }) },
    { id: "hist", syntax: "show cli history", summary: "The commands you typed in this session", run: () => ({ output: [...(api.history ?? []), "show cli history"].map((x, n) => `${String(n + 1).padStart(4)}  ${x}`).join("\n") }) },
  ];
}
function junosSet(api: LcCliApi, sw: LcSw): CliCommandSet {
  const s = api.view;
  const base = { vendor: "juniper" as const, deviceId: sw, deviceName: sw };
  const op = junosOp(api, sw);
  const active = s.cfg.sw[sw];
  const rbHist = s.rb?.[sw] ?? [];
  const cand = api.cand[sw];
  const dirty = JSON.stringify(cand) !== JSON.stringify(active);
  const configure: CliCommand = { id: "conf", syntax: "configure", summary: "Enter configuration mode (the candidate configuration)", run: () => (!dirty && api.setCand({ ...api.cand, [sw]: lcClone(active) }), api.setJunosEdit(sw, true), { output: dirty ? "Entering configuration mode\nThe configuration has been changed but not committed\n" : "Entering configuration mode\n" }) };
  if (!api.junosEdit[sw]) return { ...base, prompt: `admin@${sw}> `, commands: [...op, configure] };
  const set = (c: LcSwCfg) => api.setCand({ ...api.cand, [sw]: c });
  const memArg: CliArgSpec = { choices: [...LC_MEMBERS], describe: (x) => PORT_DESC[sw][x as LcPort], resolve: (raw) => ((LC_MEMBERS as readonly string[]).includes(raw) ? raw : undefined) };
  const aeArg: CliArgSpec = { choices: ["ae0", "ae1"], resolve: (raw) => (/^ae[01]$/.test(raw) ? raw : undefined) };
  const g = (ae: string) => (+ae.slice(2) + 1) as 1 | 2;
  const forAe = (ae: string, patch: Partial<LcMemberCfg>) => set({ members: Object.fromEntries(LC_MEMBERS.map((m) => [m, cand.members[m].group === g(ae) && cand.members[m].mode !== "off" ? { ...cand.members[m], ...patch } : cand.members[m]])) as LcSwCfg["members"] });
  const check = (): string | undefined => {
    for (const gg of [1, 2]) {
      const modes = new Set(LC_MEMBERS.filter((m) => cand.members[m].group === gg && cand.members[m].mode !== "off").map((m) => cand.members[m].mode));
      if (modes.size > 1) return `[edit interfaces ae${gg - 1}]\n  members of ae${gg - 1} disagree on LACP`;
    }
    return undefined;
  };
  const doCommit = (quit: boolean): CliResult => {
    const err = check();
    if (err) return refuse(`${err}\nerror: configuration check-out failed`);
    if (dirty) setSw(api, sw, cand, "Junos commit", true);
    if (quit) api.setJunosEdit(sw, false);
    return { output: quit ? "commit complete\nExiting configuration mode" : "commit complete", explanation: dirty ? "Active now. Check show lacp interfaces, then prove it with traffic." : undefined };
  };
  return {
    ...base,
    prompt: `admin@${sw}# `,
    commands: [
      { id: "ad", syntax: "set interfaces <member> ether-options 802.3ad <ae>", summary: "Make a port a member of ae0 / ae1", args: { member: memArg, ae: aeArg }, run: ({ member, ae }) => (set({ members: { ...cand.members, [member]: { ...cand.members[member as LcMember], group: g(ae), mode: aeMode(cand, g(ae)) ?? "active" } } }), { output: "", explanation: aeMode(cand, g(ae)) === undefined ? `${ae} has no members yet: it will run LACP active (the lab's default for a new ae). Change it with set interfaces ${ae} aggregated-ether-options lacp …` : undefined }) },
      { id: "ad", syntax: "delete interfaces <member> ether-options 802.3ad", summary: "Take a port out of its ae (a normal port again)", args: { member: memArg }, run: ({ member }) => (cand.members[member as LcMember].mode === "off" ? refuse("warning: statement not found") : (set({ members: { ...cand.members, [member]: { ...cand.members[member as LcMember], mode: "off" } } }), { output: "" })) },
      { id: "lacp", syntax: "set interfaces <ae> aggregated-ether-options lacp active", summary: "The ae runs LACP and starts it", args: { ae: aeArg }, run: ({ ae }) => (forAe(ae, { mode: "active" }), { output: "" }) },
      { id: "lacp", syntax: "set interfaces <ae> aggregated-ether-options lacp passive", summary: "The ae runs LACP but only answers", args: { ae: aeArg }, run: ({ ae }) => (forAe(ae, { mode: "passive" }), { output: "" }) },
      { id: "lacp", syntax: "delete interfaces <ae> aggregated-ether-options lacp", summary: "No LACP: a static LAG", args: { ae: aeArg }, run: ({ ae }) => (forAe(ae, { mode: "on" }), { output: "", explanation: "Without an lacp stanza the ae is a static LAG: its members bundle without asking the far end." }) },
      { id: "per", syntax: "set interfaces <ae> aggregated-ether-options lacp periodic fast", summary: "LACPDUs every second (timeout 3 s)", args: { ae: aeArg }, run: ({ ae }) => (forAe(ae, { fast: true }), { output: "" }) },
      { id: "per", syntax: "set interfaces <ae> aggregated-ether-options lacp periodic slow", summary: "LACPDUs every 30 s (timeout 90 s)", args: { ae: aeArg }, run: ({ ae }) => (forAe(ae, { fast: false }), { output: "" }) },
      { id: "dis", syntax: "set interfaces <member> disable", summary: "Disable a port", args: { member: memArg }, run: ({ member }) => (set({ members: { ...cand.members, [member]: { ...cand.members[member as LcMember], shut: true } } }), { output: "" }) },
      { id: "dis", syntax: "delete interfaces <member> disable", summary: "Enable a port", args: { member: memArg }, run: ({ member }) => (cand.members[member as LcMember].shut ? (set({ members: { ...cand.members, [member]: { ...cand.members[member as LcMember], shut: false } } }), { output: "" }) : refuse("warning: statement not found")) },
      { id: "show", syntax: "show", summary: "The candidate configuration (try show | compare)", run: () => ({ output: lcJunosText(sw, cand) }) },
      { id: "show", syntax: "show interfaces", summary: "Candidate interfaces", run: () => ({ output: lcJunosText(sw, cand, ["interfaces"]) }) },
      { id: "commit", syntax: "commit", summary: "Activate the candidate configuration", run: () => doCommit(false) },
      { id: "commit", syntax: "commit check", summary: "Check the candidate", run: () => { const err = check(); return err ? refuse(`${err}\nerror: configuration check-out failed`) : { output: "configuration check succeeds" }; } },
      { id: "commit", syntax: "commit and-quit", summary: "Commit, then leave configuration mode", run: () => doCommit(true) },
      { id: "rollback", syntax: "rollback", summary: "Discard your uncommitted changes (= rollback 0)", run: () => (set(lcClone(active)), { output: "load complete" }) },
      {
        id: "rollback",
        syntax: "rollback <n>",
        summary: "Load an earlier committed configuration into the candidate (then commit)",
        args: { n: { choices: ["0", ...rbHist.map((_, i) => String(i + 1))], describe: (x) => (x === "0" ? "the active configuration" : x === "1" ? "before the last commit" : `before the last ${x} commits`), resolve: (raw) => (/^\d{1,2}$/.test(raw) ? String(+raw) : undefined) } },
        run: ({ n }) => {
          if (n === "0") return (set(lcClone(active)), { output: "load complete" });
          const json = rbHist[Number(n) - 1];
          if (!json) return refuse(`error: rollback ${n} does not exist${rbHist.length ? ` (1–${rbHist.length} available)` : " (no commits yet)"}`);
          set(JSON.parse(json) as LcSwCfg);
          return { output: "load complete", explanation: `The candidate now holds the configuration from before the last ${n === "1" ? "commit" : `${n} commits`}. show | compare, then commit to activate it.` };
        },
      },
      ...prefixed(op, "run"),
      {
        id: "exit",
        syntax: "exit",
        summary: "Leave configuration mode",
        run: () => {
          if (!dirty || !api.ask) return (api.setJunosEdit(sw, false), { output: "Exiting configuration mode" });
          api.ask({ node: sw, prompt: "The configuration has been changed but not committed\nExit with uncommitted changes? [yes,no] (yes) ", answer: (line) => { api.ask?.(undefined); if (/^n(o)?$/i.test(line.trim())) return { output: "" }; api.setJunosEdit(sw, false); return { output: "Exiting configuration mode" }; }, cancel: () => (api.ask?.(undefined), "") });
          return { output: "" };
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Hosts
// ---------------------------------------------------------------------------------------------------------------
function hostSet(api: LcCliApi, h: LcHost): CliCommandSet {
  const s = api.view;
  const name = h.toLowerCase();
  const others = LC_HOSTS.filter((x) => x !== h);
  const ipArg: CliArgSpec = { choices: others.map((x) => HOST_IP[x]), describe: (c) => LC_HOSTS.find((x) => HOST_IP[x] === c), resolve: (raw) => (/^(\d{1,3}\.){3}\d{1,3}$/.test(raw) ? raw : undefined) };
  const ping = (ip: string, n: number): CliResult => {
    const to = LC_HOSTS.find((x) => HOST_IP[x] === ip);
    if (!to) return { output: [`PING ${ip} (${ip}) 56(84) bytes of data.`, "", `--- ${ip} ping statistics ---`, `${n} packets transmitted, 0 received, 100% packet loss`].join("\n"), explanation: "No host has that address in this lab." };
    const ns = api.act({ type: "traffic", sends: [{ from: h, to, kind: "ping" }] });
    const r = ns.last!.results[0];
    if (r.replied) return { output: [`PING ${ip} (${ip}) 56(84) bytes of data.`, ...Array.from({ length: n }, (_, i) => `64 bytes from ${ip}: icmp_seq=${i + 1} ttl=64 time=0.${4 + i} ms`), "", `--- ${ip} ping statistics ---`, `${n} packets transmitted, ${n} received, 0% packet loss`].join("\n"), explanation: r.memberOut ? `Between the switches: out on ${r.memberOut}, back on ${r.memberBack}.` : "Same switch: it never crossed the uplink." };
    return { output: [`PING ${ip} (${ip}) 56(84) bytes of data.`, "", `--- ${ip} ping statistics ---`, `${n} packets transmitted, 0 received, 100% packet loss`].join("\n"), explanation: r.fail };
  };
  const cmds: CliCommand[] = [
    { id: "addr", syntax: "ip addr", summary: "This host's address", run: () => ({ output: ["2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 state UP", `    link/ether ${HOST_MAC[h].toLowerCase()} brd ff:ff:ff:ff:ff:ff`, `    inet ${HOST_IP[h]}/24 scope global eth0`].join("\n") }) },
    { id: "neigh", syntax: "ip neigh", summary: "ARP cache", run: () => ({ output: Object.entries(s.arp[h]).map(([ip, mac]) => `${ip} dev eth0 lladdr ${mac.toLowerCase()} REACHABLE`).join("\n"), explanation: Object.keys(s.arp[h]).length ? undefined : "Empty: this host hasn't resolved anyone yet." }) },
    { id: "ping", syntax: "ping <ip>", summary: "Ping (4 echo requests)", args: { ip: ipArg }, run: ({ ip }) => ping(ip, 4) },
    { id: "ping", syntax: "ping -c <count> <ip>", summary: "Ping <count> times", args: { count: { choices: ["1", "3"], resolve: (raw) => (/^\d+$/.test(raw) && +raw >= 1 && +raw <= 10 ? raw : undefined) }, ip: ipArg }, run: ({ count, ip }) => ping(ip, +count) },
  ];
  return withShellHistory(withSelfPing({ vendor: "cisco", deviceId: h, deviceName: name, prompt: `admin@${name}:~$ `, commands: cmds }, "linux", [HOST_IP[h]]), "linux", api.history);
}

export function lcSwitchSets(api: LcCliApi, sw: LcSw): Partial<Record<CliVendor, CliCommandSet>> {
  return { cisco: iosSet(api, sw), juniper: junosSet(api, sw) };
}
export const lcHostSet = hostSet;
export const lcJunosConfig = (api: Pick<LcCliApi, "view">, sw: LcSw) => (which: "committed" | number, path: string[]) => (which === "committed" || which === 0 ? lcJunosText(sw, api.view.cfg.sw[sw], path) : undefined);
