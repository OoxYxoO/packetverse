import type { CliArgSpec, CliCommand, CliCommandSet, CliResult, CliVendor } from "@/lib/cli/types";
import { columns } from "@/lib/cli/format";
import type { CliQuestion } from "@/app/demo/dhcp-dns/dhcp-lab/dhcpBuildCli";
import { withShellHistory } from "@/lib/cli/shellHistory";
import { SD_IP, SD_TUNS, TUN, sdClone, selectPath, slaChecks, type SdAction, type SdCfg, type SdClass, type SdNet, type SdTun } from "@/lib/sim-engine/scenarios/sdNet";

/**
 * Command lines of the SD-WAN Lab — the same edge in two architectures:
 *   Cisco (Catalyst SD-WAN)  BRANCH is a cEdge: it measures each tunnel with BFD and applies the app-route policy it
 *                            received from the controller. Policy is written on the CONTROLLER (vSmart, Viptela CLI:
 *                            config → policy … → commit); the edge itself only takes local settings (bfd app-route
 *                            multiplier) and shows what it measured and installed.
 *   Junos (SRX)              BRANCH measures with RPM probes and steers with advanced policy-based routing (APBR)
 *                            and an SLA rule (AppQoE-style; leaf names simplified), each application into a routing
 *                            instance whose qualified next hops (st0.1, st0.2) carry its path preference.
 * CLIENT has a Linux shell (iperf3 for a voice-marked UDP stream, rsync for the backup); the ISPs are read-only.
 */
export type SdEdgeMode = { kind: "exec" } | { kind: "config" };
export interface SdCliApi {
  view: SdNet;
  act: (a: SdAction) => SdNet;
  edge: SdEdgeMode;
  setEdge: (m: SdEdgeMode) => void;
  junosEdit: boolean;
  setJunosEdit: (b: boolean) => void;
  ctrlEdit: boolean;
  setCtrlEdit: (b: boolean) => void;
  cand: SdCfg;
  setCand: (c: SdCfg) => void;
  ask?: (q: CliQuestion | undefined) => void;
  history?: string[];
}
const refuse = (output: string, explanation?: string): CliResult => ({ output, refused: true, explanation });
const prefixed = (cmds: CliCommand[], word: "do" | "run"): CliCommand[] => cmds.map((c) => ({ ...c, id: `${word}:${c.id}`, syntax: `${word} ${c.syntax}` }));
const fixedName = (n: string, what?: string): CliArgSpec => ({ choices: [n], describe: what ? () => what : undefined, resolve: (raw) => (raw.toUpperCase() === n ? n : undefined) });
/** Keywords with capitals (object names such as VOICE-SLA, APP-RT) become fixed-value arguments: the parser compares keywords in lowercase. */
function upperAsArgs(cmd: CliCommand): CliCommand {
  let n = 0;
  const args: Record<string, CliArgSpec> = { ...(cmd.args ?? {}) };
  const syntax = cmd.syntax
    .split(" ")
    .map((w) => {
      if (w.startsWith("<") || !/[A-Z]/.test(w)) return w;
      const key = `_k${n++}`;
      args[key] = fixedName(w);
      return `<${key}>`;
    })
    .join(" ");
  return n ? { ...cmd, syntax, args } : cmd;
}
const upper = (set: CliCommandSet): CliCommandSet => ({ ...set, commands: set.commands.map(upperAsArgs) });
const numArg = (choices: string[], min: number, max: number, what: string): CliArgSpec => ({ choices, describe: () => what, resolve: (raw) => (/^\d+(\.\d+)?$/.test(raw) && +raw >= min && +raw <= max ? raw : undefined) });
const colorOf = (t: SdTun) => TUN[t].color;
const tunOfColor = (c: string) => SD_TUNS.find((t) => TUN[t].color === c.toLowerCase());
const colorArg: CliArgSpec = { choices: SD_TUNS.map(colorOf), describe: (c) => `${tunOfColor(c)} via ${TUN[tunOfColor(c)!].isp}`, resolve: (raw) => (tunOfColor(raw) ? raw.toLowerCase() : undefined) };
const stArg: CliArgSpec = { choices: SD_TUNS.map((t) => TUN[t].junosIf), describe: (c) => `${SD_TUNS.find((t) => TUN[t].junosIf === c)} via ${TUN[SD_TUNS.find((t) => TUN[t].junosIf === c)!].isp}`, resolve: (raw) => (SD_TUNS.some((t) => TUN[t].junosIf === raw) ? raw : undefined) };
const tunOfSt = (st: string) => SD_TUNS.find((t) => TUN[t].junosIf === st)!;
const GROUP: Record<SdClass, string> = { VOICE: "VOICE-PREF", BULK: "BULK-PREF" };
const RI: Record<SdClass, string> = { VOICE: "RI-VOICE", BULK: "RI-BULK" };
const SEQ: Record<SdClass, number> = { VOICE: 10, BULK: 20 };
const classOfGroup = (g: string): SdClass | undefined => (Object.keys(GROUP) as SdClass[]).find((k) => GROUP[k] === g.toUpperCase());

// ---------------------------------------------------------------------------------------------------------------
// Shared outputs
// ---------------------------------------------------------------------------------------------------------------
function ctrlPolicyText(c: SdCfg): string {
  const grp = (k: SdClass) => [` preferred-color-group ${GROUP[k]}`, `  primary-preference`, `   color-preference ${colorOf(c.pref[k][0])}`, ...(c.pref[k][1] ? [`  !`, `  secondary-preference`, `   color-preference ${colorOf(c.pref[k][1])}`] : []), `  !`, ` !`];
  const seq = (k: SdClass) => [`  sequence ${SEQ[k]}`, `   match`, `    ${k === "VOICE" ? "dscp 46" : "destination-port 873"}`, `   !`, `   action`, `    sla-class ${c.slaReq[k] ? k : "ANY-PATH"}${c.slaReq[k] ? (c.fallback[k] ? " fallback-to-best-path" : " strict") : ""}`, `    preferred-color-group ${GROUP[k]}`, `   !`, `  !`];
  return ["policy", ` sla-class VOICE`, `  loss    ${c.sla.loss}`, `  latency ${c.sla.rtt}`, `  jitter  ${c.sla.jitter}`, ` !`, ` sla-class ANY-PATH`, `  loss    100`, `  latency 1000`, `  jitter  1000`, ` !`, ...grp("VOICE"), ...grp("BULK"), ` app-route-policy APP-RT`, `  vpn-list CORP`, ...seq("VOICE").map((x) => ` ${x}`), ...seq("BULK").map((x) => ` ${x}`), `  !`, ` !`, "!"].join("\n");
}
function junosTree(c: SdCfg): { name: string; kids?: unknown[] }[] {
  type N = { name: string; kids?: N[] };
  const ri = (k: SdClass): N => ({ name: `${RI[k]}`, kids: [{ name: "instance-type forwarding" }, { name: "routing-options", kids: [{ name: "static", kids: [{ name: `route ${"10.40.40.0/24"}`, kids: c.pref[k].map((t, i) => ({ name: `qualified-next-hop ${TUN[t].junosIf}`, kids: [{ name: `preference ${i === 0 ? 5 : 10}` }] })) }] }] }] });
  const tree: N[] = [
    {
      name: "security",
      kids: [
        {
          name: "advance-policy-based-routing",
          kids: [
            { name: "metrics-profile VOICE-SLA", kids: [{ name: "sla-threshold", kids: [{ name: `delay-round-trip ${c.sla.rtt * 1000}` }, { name: `jitter ${c.sla.jitter * 1000}` }, { name: `packet-loss ${c.sla.loss}` }] }] },
            { name: "sla-rule VOICE-SLA", kids: [{ name: "metrics-profile VOICE-SLA" }, { name: `switch-idle-time ${c.hold * 10}` }, { name: `violation-action ${c.fallback.VOICE ? "best-path" : "drop"}` }] },
            { name: "profile SDWAN", kids: [{ name: "rule VOICE", kids: [{ name: "match", kids: [{ name: "dscp 46" }] }, { name: "then", kids: [{ name: `routing-instance ${RI.VOICE}` }, ...(c.slaReq.VOICE ? [{ name: "sla-rule VOICE-SLA" }] : [])] }] }, { name: "rule BULK", kids: [{ name: "match", kids: [{ name: "destination-port 873" }] }, { name: "then", kids: [{ name: `routing-instance ${RI.BULK}` }] }] }] },
          ],
        },
      ],
    },
    { name: "services", kids: [{ name: "rpm", kids: SD_TUNS.map((t) => ({ name: `probe ${t === "TUN-A" ? "probe-a" : "probe-b"}`, kids: [{ name: `test ${t.toLowerCase()}`, kids: [{ name: "probe-type icmp-ping" }, { name: `target address ${SD_IP.hubSys}` }, { name: "probe-count 500" }, { name: "test-interval 10" }, { name: `destination-interface ${TUN[t].junosIf}` }] }] })) }] },
    { name: "routing-instances", kids: [ri("VOICE"), ri("BULK")] },
  ];
  return tree;
}
type JN = { name: string; kids?: JN[] };
const render = (nodes: JN[], d = 0): string[] => nodes.flatMap((n) => (n.kids ? [`${"    ".repeat(d)}${n.name} {`, ...render(n.kids, d + 1), `${"    ".repeat(d)}}`] : [`${"    ".repeat(d)}${n.name};`]));
function walk(nodes: JN[], path: string[]): string {
  const want = [...path];
  while (want.length) {
    let hit: JN | undefined;
    for (let k = Math.min(want.length, 3); k >= 1 && !hit; k--) {
      hit = nodes.find((n) => n.name === want.slice(0, k).join(" "));
      if (hit) want.splice(0, k);
    }
    if (!hit?.kids) return "";
    nodes = hit.kids;
  }
  return render(nodes).join("\n");
}
export const sdJunosText = (c: SdCfg, path: string[] = []) => walk(junosTree(c) as JN[], path);
const prefOf = (pref: SdTun[]) => Object.fromEntries(pref.map((t, i) => [t, i === 0 ? 5 : 10])) as Partial<Record<SdTun, number>>;
const orderPref = (m: Partial<Record<SdTun, number>>): SdTun[] => (Object.keys(m) as SdTun[]).sort((a, b) => m[a]! - m[b]! || SD_TUNS.indexOf(a) - SD_TUNS.indexOf(b));

// ---------------------------------------------------------------------------------------------------------------
// Cisco Catalyst SD-WAN edge
// ---------------------------------------------------------------------------------------------------------------
function ciscoEdgeExec(api: SdCliApi): CliCommand[] {
  const s = api.view;
  const c = s.cfg;
  const p = s.paths;
  return [
    { id: "bfd", syntax: "show sdwan bfd sessions", summary: "BFD sessions on each tunnel (reachability)", run: () => ({ output: columns([["SYSTEM IP", "SITE ID", "STATE", "SOURCE TLOC COLOR", "REMOTE TLOC COLOR", "SOURCE IP", "DST PUBLIC IP", "ENCAP", "MULTIPLIER", "TX INTERVAL(msec)", "UPTIME", "TRANSITIONS"], ...SD_TUNS.map((t) => [SD_IP.hubSys, "100", p[t].quality === "down" ? "down" : "up", colorOf(t), colorOf(t), TUN[t].local, TUN[t].remote, "ipsec", "7", "1000", p[t].quality === "down" ? "NA" : "0:01:12:45", p[t].quality === "down" ? "1" : "0"])], [17, 8, 6, 18, 18, 14, 15, 6, 11, 18, 11]), explanation: "BFD up = the tunnel is reachable. It says nothing yet about whether the path is good enough for voice — that is app-route." }) },
    {
      id: "ar",
      syntax: "show sdwan app-route stats",
      summary: "Loss / latency / jitter per tunnel, and the SLA classes it meets",
      run: () => ({
        output: SD_TUNS.map((t) => {
          const m = p[t].last;
          const meets = m.rtt === null ? "" : `0${slaChecks(c, m).every((x) => x.ok) ? ",1" : ""}`;
          return [`Generating output, this might take time, please wait ...`, `app-route statistics ${TUN[t].local} ${TUN[t].remote} ipsec 12346 12346`, ` remote-system-ip         ${SD_IP.hubSys}`, ` local-color              ${colorOf(t)}`, ` remote-color             ${colorOf(t)}`, ` mean-loss                ${m.rtt === null ? 100 : m.loss}`, ` mean-latency             ${m.rtt ?? 0}`, ` mean-jitter              ${m.jitter ?? 0}`, ` sla-class-index          ${meets || "None"}`, ` eligible for VOICE       ${p[t].eligible ? "yes" : p[t].sla === "PASS" ? `recovering (${p[t].streak}/${c.hold} intervals)` : "no"}`].join("\n");
        }).join("\n\n"),
        explanation: "sla-class-index lists the classes the tunnel currently meets (0 = ANY-PATH, 1 = VOICE). A tunnel that leaves class 1 is no longer used for voice.",
      }),
    },
    { id: "sla", syntax: "show sdwan app-route sla-class", summary: "The SLA classes received from the controller", run: () => ({ output: columns([["INDEX", "NAME", "LOSS", "LATENCY", "JITTER"], ["0", "ANY-PATH", "100", "1000", "1000"], ["1", "VOICE", String(c.sla.loss), String(c.sla.rtt), String(c.sla.jitter)]], [7, 11, 6, 9]) }) },
    { id: "pol", syntax: "show sdwan policy from-vsmart", summary: "The centralized policy installed on this edge", run: () => ({ output: `from-vsmart ${ctrlPolicyText(c).replace(/^policy\n/, "")}`, explanation: "Pushed by the controller: the edge applies it locally, packet by packet, using its own measurements." }) },
    { id: "filt", syntax: "show sdwan policy app-route-policy-filter", summary: "Packets per policy sequence and color", run: () => ({ output: ["NAME     VPN-LIST  COUNTER-NAME      PACKETS", ...(["VOICE", "BULK"] as SdClass[]).flatMap((k) => SD_TUNS.map((t) => `APP-RT   CORP      seq${SEQ[k]}-${colorOf(t).padEnd(16)} ${s.counters[t][k]}`)), `APP-RT   CORP      seq10-dropped          ${s.drops.VOICE}`, `APP-RT   CORP      seq20-dropped          ${s.drops.BULK}`].join("\n"), explanation: "Which path each class really used — and how many packets were dropped because no path was allowed." }) },
    { id: "run", syntax: "show running-config", summary: "This edge's local configuration", run: () => ({ output: ["system", " system-ip 10.255.1.1", " site-id 200", "!", "bfd app-route multiplier " + c.hold, "bfd app-route poll-interval 10000", "!", ...SD_TUNS.flatMap((t) => [`interface ${TUN[t].ciscoIf}`, ` ip unnumbered GigabitEthernet0/${t === "TUN-A" ? 1 : 2}`, ` tunnel source GigabitEthernet0/${t === "TUN-A" ? 1 : 2}`, " tunnel mode sdwan", "!"]), "sdwan", ...SD_TUNS.flatMap((t) => [` interface GigabitEthernet0/${t === "TUN-A" ? 1 : 2}`, "  tunnel-interface", "   encapsulation ipsec", `   color ${colorOf(t)}`]), "!"].join("\n"), explanation: "No app-route policy here: it comes from the controller. bfd app-route multiplier = how many poll intervals a tunnel must stay good before it is trusted again." }) },
    { id: "hist", syntax: "show history", summary: "The commands you typed in this session", run: () => ({ output: [...(api.history ?? []), "show history"].map((x) => `  ${x}`).join("\n") }) },
  ];
}
function ciscoEdgeSet(api: SdCliApi): CliCommandSet {
  const s = api.view;
  const base = { vendor: "cisco" as const, deviceId: "BRANCH", deviceName: "BRANCH" };
  const exec = ciscoEdgeExec(api);
  const toCtrl = refuse("% This policy is centralized: edit it on the CONTROLLER (vSmart) — open its console in this window.", "Catalyst SD-WAN edges receive app-route policy from the controller; the edge applies it with its own measurements.");
  if (api.edge.kind === "exec") return { ...base, prompt: "BRANCH#", commands: [...exec, { id: "ct", syntax: "config-transaction", summary: "Enter configuration mode (local settings)", run: () => (api.setEdge({ kind: "config" }), { output: "admin connected from 127.0.0.1 using console on BRANCH" }) }] };
  return {
    ...base,
    prompt: "BRANCH(config)#",
    commands: [
      { id: "mult", syntax: "bfd app-route multiplier <n>", summary: "Poll intervals a recovered tunnel must stay good (hysteresis)", args: { n: numArg(["3"], 1, 6, "intervals") }, run: ({ n }) => (api.setCand({ ...sdClone(api.cand), hold: +n }), { output: "", explanation: "Takes effect on commit." }) },
      { id: "commit", syntax: "commit", summary: "Apply the change", run: () => { if (api.cand.hold !== s.cfg.hold) api.act({ type: "cfg", cfg: { ...sdClone(s.cfg), hold: api.cand.hold }, text: `BRANCH: bfd app-route multiplier ${api.cand.hold}` }); return { output: "Commit complete." }; } },
      { id: "pol", syntax: "policy", summary: "", hidden: true, run: () => toCtrl },
      { id: "pol2", syntax: "policy sla-class <name>", summary: "", hidden: true, args: { name: { choices: ["VOICE"], resolve: (raw) => raw } }, run: () => toCtrl },
      { id: "end", syntax: "end", summary: "Leave configuration mode", run: () => (api.setEdge({ kind: "exec" }), { output: "" }) },
      ...prefixed(exec, "do"),
    ],
  };
}
// The controller (vSmart, Viptela CLI)
function ctrlSet(api: SdCliApi): CliCommandSet {
  const s = api.view;
  const c = s.cfg;
  const cand = api.cand;
  const base = { vendor: "cisco" as const, deviceId: "CTRL", deviceName: "vsmart" };
  const dirty = JSON.stringify(cand) !== JSON.stringify(c);
  const op: CliCommand[] = [
    { id: "pol", syntax: "show running-config policy", summary: "The centralized policy", run: () => ({ output: ctrlPolicyText(c) }) },
    { id: "app", syntax: "show running-config apply-policy", summary: "Where it is applied", run: () => ({ output: ["apply-policy", " site-list BRANCHES", "  app-route-policy APP-RT", " !", "!"].join("\n") }) },
  ];
  if (!api.ctrlEdit) return { ...base, prompt: "vsmart# ", commands: [...op, { id: "conf", syntax: "config", summary: "Enter configuration mode", run: () => (!dirty && api.setCand(sdClone(c)), api.setCtrlEdit(true), { output: "Entering configuration mode terminal" }) }] };
  const put = (patch: (x: SdCfg) => void): CliResult => {
    const n = sdClone(cand);
    patch(n);
    api.setCand(n);
    return { output: "" };
  };
  const pre = "policy app-route-policy APP-RT vpn-list CORP sequence <seq> action sla-class";
  const seqArg: CliArgSpec = { choices: ["10", "20"], describe: (x) => (x === "10" ? "VOICE (dscp 46)" : "BULK (port 873)"), resolve: (raw) => (raw === "10" || raw === "20" ? raw : undefined) };
  const klass = (seq: string): SdClass => (seq === "10" ? "VOICE" : "BULK");
  const grpArg: CliArgSpec = { choices: ["VOICE-PREF", "BULK-PREF"], resolve: (raw) => (classOfGroup(raw) ? raw.toUpperCase() : undefined) };
  const doCommit = (): CliResult => {
    if (dirty) api.act({ type: "cfg", cfg: sdClone(cand), text: "CONTROLLER: policy committed and pushed to the edge" });
    return { output: "Commit complete.", explanation: dirty ? "Pushed to BRANCH: check show sdwan policy from-vsmart on the edge, then test." : undefined };
  };
  return {
    ...base,
    prompt: "vsmart(config)# ",
    commands: [
      { id: "lat", syntax: "policy sla-class VOICE latency <ms>", summary: "VOICE: maximum latency", args: { ms: numArg(["100"], 1, 1000, "milliseconds") }, run: ({ ms }) => put((x) => (x.sla.rtt = +ms)) },
      { id: "jit", syntax: "policy sla-class VOICE jitter <ms>", summary: "VOICE: maximum jitter", args: { ms: numArg(["30"], 1, 1000, "milliseconds") }, run: ({ ms }) => put((x) => (x.sla.jitter = +ms)) },
      { id: "loss", syntax: "policy sla-class VOICE loss <pct>", summary: "VOICE: maximum loss", args: { pct: numArg(["1"], 0, 100, "percent") }, run: ({ pct }) => put((x) => (x.sla.loss = +pct)) },
      { id: "cls", syntax: `${pre} <cls>`, summary: "Which SLA class the sequence requires (VOICE, or ANY-PATH = no SLA)", args: { seq: seqArg, cls: { choices: ["VOICE", "ANY-PATH"], resolve: (raw) => (["VOICE", "ANY-PATH"].includes(raw.toUpperCase()) ? raw.toUpperCase() : undefined) } }, run: ({ seq, cls }) => (klass(seq) === "BULK" && cls === "VOICE" ? refuse("", "In this lab the backup sequence keeps ANY-PATH: backups need no voice SLA.") : put((x) => (x.slaReq[klass(seq)] = cls === "VOICE"))) },
      { id: "strict", syntax: `${pre} VOICE strict`, summary: "No compliant path → drop", args: { seq: seqArg }, run: ({ seq }) => (klass(seq) !== "VOICE" ? refuse("", "Only the VOICE sequence uses the VOICE class.") : put((x) => ((x.slaReq.VOICE = true), (x.fallback.VOICE = false)))) },
      { id: "fb", syntax: `${pre} VOICE fallback-to-best-path`, summary: "No compliant path → use the best path", args: { seq: seqArg }, run: ({ seq }) => (klass(seq) !== "VOICE" ? refuse("", "Only the VOICE sequence uses the VOICE class.") : put((x) => ((x.slaReq.VOICE = true), (x.fallback.VOICE = true)))) },
      {
        id: "pri",
        syntax: "policy preferred-color-group <grp> primary-preference color-preference <color>",
        summary: "First-choice color",
        args: { grp: grpArg, color: colorArg },
        run: ({ grp, color }) => put((x) => { const k = classOfGroup(grp)!; const t = tunOfColor(color)!; x.pref[k] = [t, ...x.pref[k].filter((y) => y !== t)]; }),
      },
      {
        id: "sec",
        syntax: "policy preferred-color-group <grp> secondary-preference color-preference <color>",
        summary: "Second-choice color",
        args: { grp: grpArg, color: colorArg },
        run: ({ grp, color }) => { const k = classOfGroup(grp)!; const t = tunOfColor(color)!; if (cand.pref[k][0] === t) return refuse("", `${color} is already the primary preference of ${grp}.`); return put((x) => (x.pref[k] = [x.pref[k][0], t])); },
      },
      { id: "nsec", syntax: "no policy preferred-color-group <grp> secondary-preference", summary: "Remove the second choice", args: { grp: grpArg }, run: ({ grp }) => { const k = classOfGroup(grp)!; return cand.pref[k].length < 2 ? refuse("Error: element does not exist") : put((x) => (x.pref[k] = [x.pref[k][0]])); } },
      { id: "show", syntax: "show full-configuration policy", summary: "The candidate policy", run: () => ({ output: ctrlPolicyText(cand) }) },
      { id: "commit", syntax: "commit", summary: "Commit and push to the edges", run: doCommit },
      { id: "abort", syntax: "abort", summary: "Discard uncommitted changes and leave", run: () => (api.setCand(sdClone(c)), api.setCtrlEdit(false), { output: "" }) },
      {
        id: "end",
        syntax: "end",
        summary: "Leave configuration mode",
        run: () => {
          if (!dirty || !api.ask) return (api.setCtrlEdit(false), { output: "" });
          api.ask({ node: "CTRL", prompt: "Uncommitted changes found, commit them? [yes/no/CANCEL] ", answer: (line) => { api.ask?.(undefined); if (/^y/i.test(line.trim())) { doCommit(); api.setCtrlEdit(false); return { output: "Commit complete." }; } if (/^n/i.test(line.trim())) { api.setCand(sdClone(c)); api.setCtrlEdit(false); return { output: "" }; } return { output: "Aborted: by user" }; }, cancel: () => (api.ask?.(undefined), "") });
          return { output: "" };
        },
      },
      ...prefixed(op, "do"),
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Junos SRX edge
// ---------------------------------------------------------------------------------------------------------------
function junosOp(api: SdCliApi): CliCommand[] {
  const s = api.view;
  const c = s.cfg;
  const p = s.paths;
  return [
    {
      id: "rpm",
      syntax: "show services rpm probe-results",
      summary: "The probe results on each tunnel",
      run: () => ({
        output: SD_TUNS.map((t) => {
          const m = p[t].last;
          return [`    Owner: ${t === "TUN-A" ? "probe-a" : "probe-b"}, Test: ${t.toLowerCase()}`, `    Target address: ${SD_IP.hubSys}, Probe type: icmp-ping, Test size: 500 probes`, `    Destination interface name: ${TUN[t].junosIf}`, `    Results over current test:`, `      Probes sent: 500, Probes received: ${m.received}, Loss percentage: ${m.loss}`, ...(m.rtt === null ? ["      Measurement: no probe responses"] : [`      Measurement: Round trip time`, `        Average: ${m.rtt * 1000} usec, Jitter: ${(m.jitter ?? 0) * 1000} usec`])].join("\n");
        }).join("\n\n"),
        explanation: "RPM measures each tunnel to the hub. The SLA rule compares these numbers with the VOICE metrics profile (in microseconds).",
      }),
    },
    {
      id: "apbr",
      syntax: "show security advance-policy-based-routing",
      summary: "The APBR profile, SLA compliance and the path each rule uses",
      run: () => {
        const v = selectPath(c, p, "VOICE");
        const b = selectPath(c, p, "BULK");
        return { output: ["Profile: SDWAN", `  Rule: VOICE   match dscp 46            routing-instance ${RI.VOICE}${c.slaReq.VOICE ? "  sla-rule VOICE-SLA" : "  (no SLA rule)"}`, `  Rule: BULK    match destination-port 873   routing-instance ${RI.BULK}`, "", "SLA rule VOICE-SLA (metrics-profile VOICE-SLA)", ...SD_TUNS.map((t) => `  ${TUN[t].junosIf}  ${p[t].quality === "down" ? "unreachable" : p[t].eligible ? "compliant" : p[t].sla === "PASS" ? `compliant, waiting switch-idle-time (${p[t].streak}/${c.hold})` : "violated"}`), "", `Active path  VOICE: ${v.tun === "NONE" ? "none — traffic dropped" : `${TUN[v.tun].junosIf}${v.fallback ? " (violation-action best-path)" : ""}`}`, `             BULK:  ${b.tun === "NONE" ? "none — traffic dropped" : TUN[b.tun].junosIf}`].join("\n"), explanation: v.why };
      },
    },
    { id: "rt", syntax: "show route table <ri>", summary: "A routing instance's path preference", args: { ri: { choices: ["RI-VOICE.inet.0", "RI-BULK.inet.0"], resolve: (raw) => (/^RI-(VOICE|BULK)\.inet\.0$/i.test(raw) ? raw.toUpperCase().replace(".INET.0", ".inet.0") : undefined) } }, run: ({ ri }) => {
        const k: SdClass = ri.startsWith("RI-VOICE") ? "VOICE" : "BULK";
        const up = c.pref[k].filter((t) => p[t].quality !== "down");
        const down = c.pref[k].filter((t) => p[t].quality === "down");
        const n = up.length ? 1 : 0;
        const rows = up.map((t, i) => `10.40.40.0/24      ${i === 0 ? "*" : " "}[Static/${c.pref[k].indexOf(t) === 0 ? 5 : 10}] 1d 00:00:00\n                    ${i === 0 ? ">" : " "}  via ${TUN[t].junosIf}`);
        const gone = down.length ? ` ${down.map((t) => TUN[t].junosIf).join(", ")} ${down.length > 1 ? "are" : "is"} down, so ${down.length > 1 ? "their" : "its"} qualified next hop is not installed${up.length ? "" : ": this class has no route at all"}.` : "";
        return { output: [`${ri}: ${n} destinations, ${up.length} routes (${n} active, 0 holddown, 0 hidden)`, "+ = Active Route, - = Last Active, * = Both", ...(rows.length ? ["", ...rows] : [])].join("\n"), explanation: `Lower preference wins: ${c.pref[k].map((t) => TUN[t].junosIf).join(" before ")}${c.pref[k].length < 2 ? " — and nothing else" : ""}.${gone}` };
      } },
    { id: "cfg", syntax: "show configuration security advance-policy-based-routing", summary: "APBR configuration", run: () => ({ output: sdJunosText(c, ["security", "advance-policy-based-routing"]) }) },
    { id: "cfg", syntax: "show configuration routing-instances", summary: "Routing instances (path preference)", run: () => ({ output: sdJunosText(c, ["routing-instances"]) }) },
    { id: "cfg", syntax: "show configuration services rpm", summary: "RPM probes", run: () => ({ output: sdJunosText(c, ["services", "rpm"]) }) },
    { id: "cfg", syntax: "show configuration", summary: "The committed configuration", run: () => ({ output: sdJunosText(c) }) },
    { id: "log", syntax: "show log messages", summary: "Path state changes", run: () => ({ output: s.events.length ? s.events.slice(-30).map((e) => `Mar  1 ${String(Math.floor(e.clock / 3600) % 24).padStart(2, "0")}:${String(Math.floor(e.clock / 60) % 60).padStart(2, "0")}:${String(e.clock % 60).padStart(2, "0")}  BRANCH apbr: ${e.text}`).join("\n") : "(no path changes yet)" }) },
    { id: "hist", syntax: "show cli history", summary: "The commands you typed in this session", run: () => ({ output: [...(api.history ?? []), "show cli history"].map((x, n) => `${String(n + 1).padStart(4)}  ${x}`).join("\n") }) },
  ];
}
function junosSet(api: SdCliApi): CliCommandSet {
  const s = api.view;
  const base = { vendor: "juniper" as const, deviceId: "BRANCH", deviceName: "BRANCH" };
  const op = junosOp(api);
  const active = s.cfg;
  const rbHist = s.rb ?? [];
  const cand = api.cand;
  const dirty = JSON.stringify(cand) !== JSON.stringify(active);
  if (!api.junosEdit) return { ...base, prompt: "admin@BRANCH> ", commands: [...op, { id: "conf", syntax: "configure", summary: "Enter configuration mode", run: () => (!dirty && api.setCand(sdClone(active)), api.setJunosEdit(true), { output: dirty ? "Entering configuration mode\nThe configuration has been changed but not committed\n" : "Entering configuration mode\n" }) }] };
  const put = (patch: (x: SdCfg) => void): CliResult => {
    const n = sdClone(cand);
    patch(n);
    api.setCand(n);
    return { output: "" };
  };
  const mp = "security advance-policy-based-routing metrics-profile VOICE-SLA sla-threshold";
  const riArg: CliArgSpec = { choices: ["RI-VOICE", "RI-BULK"], resolve: (raw) => (/^RI-(VOICE|BULK)$/i.test(raw) ? raw.toUpperCase() : undefined) };
  const kOf = (ri: string): SdClass => (ri === "RI-VOICE" ? "VOICE" : "BULK");
  const doCommit = (quit: boolean): CliResult => {
    if (dirty) api.act({ type: "cfg", cfg: sdClone(cand), text: "BRANCH: Junos commit", junosCommit: true });
    if (quit) api.setJunosEdit(false);
    return { output: quit ? "commit complete\nExiting configuration mode" : "commit complete", explanation: dirty ? "Active now. Check show security advance-policy-based-routing, then send traffic." : undefined };
  };
  return {
    ...base,
    prompt: "admin@BRANCH# ",
    commands: [
      { id: "rtt", syntax: `set ${mp} delay-round-trip <us>`, summary: "VOICE: maximum round-trip time (microseconds)", args: { us: numArg(["100000"], 1000, 1000000, "microseconds") }, run: ({ us }) => put((x) => (x.sla.rtt = Math.round(+us / 1000))) },
      { id: "jit", syntax: `set ${mp} jitter <us>`, summary: "VOICE: maximum jitter (microseconds)", args: { us: numArg(["30000"], 1000, 1000000, "microseconds") }, run: ({ us }) => put((x) => (x.sla.jitter = Math.round(+us / 1000))) },
      { id: "loss", syntax: `set ${mp} packet-loss <pct>`, summary: "VOICE: maximum loss (percent)", args: { pct: numArg(["1"], 0, 100, "percent") }, run: ({ pct }) => put((x) => (x.sla.loss = +pct)) },
      { id: "slar", syntax: "set security advance-policy-based-routing profile SDWAN rule VOICE then sla-rule VOICE-SLA", summary: "VOICE requires the SLA rule", args: {}, run: () => put((x) => (x.slaReq.VOICE = true)) },
      { id: "dslar", syntax: "delete security advance-policy-based-routing profile SDWAN rule VOICE then sla-rule", summary: "VOICE without an SLA rule", run: () => (!cand.slaReq.VOICE ? refuse("warning: statement not found") : put((x) => (x.slaReq.VOICE = false))) },
      { id: "va", syntax: "set security advance-policy-based-routing sla-rule VOICE-SLA violation-action <act>", summary: "No compliant path: best-path or drop", args: { act: { choices: ["best-path", "drop"], resolve: (raw) => (raw === "best-path" || raw === "drop" ? raw : undefined) } }, run: ({ act }) => put((x) => (x.fallback.VOICE = act === "best-path")) },
      { id: "sit", syntax: "set security advance-policy-based-routing sla-rule VOICE-SLA switch-idle-time <s>", summary: "How long a recovered path must stay compliant (seconds; 10 per interval)", args: { s: numArg(["30"], 10, 60, "seconds") }, run: ({ s: sec }) => put((x) => (x.hold = Math.max(1, Math.round(+sec / 10)))) },
      {
        id: "qnh",
        syntax: "set routing-instances <ri> routing-options static route 10.40.40.0/24 qualified-next-hop <st> preference <n>",
        summary: "Allow a tunnel for this class, with a preference (lower wins)",
        args: { ri: riArg, st: stArg, n: numArg(["5", "10"], 1, 255, "preference (lower wins)") },
        run: ({ ri, st, n }) => put((x) => { const k = kOf(ri); const m = prefOf(x.pref[k]); m[tunOfSt(st)] = +n; x.pref[k] = orderPref(m); }),
      },
      { id: "dqnh", syntax: "delete routing-instances <ri> routing-options static route 10.40.40.0/24 qualified-next-hop <st>", summary: "Stop using a tunnel for this class", args: { ri: riArg, st: stArg }, run: ({ ri, st }) => { const k = kOf(ri); const t = tunOfSt(st); if (!cand.pref[k].includes(t)) return refuse("warning: statement not found"); if (cand.pref[k].length === 1) return refuse("", "Keep at least one path for the class."); return put((x) => (x.pref[k] = x.pref[k].filter((y) => y !== t))); } },
      { id: "show", syntax: "show", summary: "The candidate configuration (try show | compare)", run: () => ({ output: sdJunosText(cand) }) },
      { id: "commit", syntax: "commit", summary: "Activate the candidate configuration", run: () => doCommit(false) },
      { id: "commit", syntax: "commit check", summary: "Check the candidate", run: () => ({ output: "configuration check succeeds" }) },
      { id: "commit", syntax: "commit and-quit", summary: "Commit, then leave configuration mode", run: () => doCommit(true) },
      { id: "rollback", syntax: "rollback", summary: "Discard your uncommitted changes (= rollback 0)", run: () => (api.setCand(sdClone(active)), { output: "load complete" }) },
      {
        id: "rollback",
        syntax: "rollback <n>",
        summary: "Load an earlier committed configuration into the candidate (then commit)",
        args: { n: { choices: ["0", ...rbHist.map((_, i) => String(i + 1))], describe: (x) => (x === "0" ? "the active configuration" : x === "1" ? "before the last commit" : `before the last ${x} commits`), resolve: (raw) => (/^\d{1,2}$/.test(raw) ? String(+raw) : undefined) } },
        run: ({ n }) => {
          if (n === "0") return (api.setCand(sdClone(active)), { output: "load complete" });
          const json = rbHist[Number(n) - 1];
          if (!json) return refuse(`error: rollback ${n} does not exist${rbHist.length ? ` (1–${rbHist.length} available)` : " (no commits yet)"}`);
          api.setCand(JSON.parse(json) as SdCfg);
          return { output: "load complete", explanation: `The candidate now holds the configuration from before the last ${n === "1" ? "commit" : `${n} commits`}. show | compare, then commit to activate it.` };
        },
      },
      ...prefixed(op, "run"),
      {
        id: "exit",
        syntax: "exit",
        summary: "Leave configuration mode",
        run: () => {
          if (!dirty || !api.ask) return (api.setJunosEdit(false), { output: "Exiting configuration mode" });
          api.ask({ node: "BRANCH", prompt: "The configuration has been changed but not committed\nExit with uncommitted changes? [yes,no] (yes) ", answer: (line) => { api.ask?.(undefined); if (/^n(o)?$/i.test(line.trim())) return { output: "" }; api.setJunosEdit(false); return { output: "Exiting configuration mode" }; }, cancel: () => (api.ask?.(undefined), "") });
          return { output: "" };
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// ISPs and CLIENT
// ---------------------------------------------------------------------------------------------------------------
function ispSet(vendor: CliVendor, isp: "ISP-A" | "ISP-B", api: Pick<SdCliApi, "view">): CliCommandSet {
  const t: SdTun = isp === "ISP-A" ? "TUN-A" : "TUN-B";
  const q = api.view.paths[t].quality;
  return {
    vendor,
    deviceId: isp,
    deviceName: isp,
    prompt: `lg-${isp.toLowerCase()}> `,
    commands: [
      { id: "st", syntax: "show status", summary: "Circuit status", run: () => ({ output: `Circuit to the branch (${TUN[t].local}): ${q === "down" ? "DOWN" : "up"}\nCondition: ${q}`, explanation: q === "healthy" ? "No incident." : q === "down" ? "Circuit outage: the tunnel over this ISP is unreachable." : "The circuit is up but degraded — up is not the same as good." }) },
      { id: "conf", syntax: "configure terminal", summary: "", hidden: true, run: () => refuse("% This is the provider's router: read-only.", "You can't fix the ISP — you can only steer around it.") },
    ],
  };
}
function clientSet(api: SdCliApi): CliCommandSet {
  const send = (k: SdClass): CliResult => {
    const r = api.act({ type: "traffic", kinds: [k] }).last!.results[0];
    if (k === "VOICE") return r.delivered ? { output: [`Connecting to host ${SD_IP.app}, port 16400`, `[  5] local ${SD_IP.client} port 16400 connected to ${SD_IP.app} port 16400`, "[ ID] Interval           Transfer     Bitrate         Jitter    Lost/Total Datagrams", `[  5]   0.00-10.00  sec  86.0 KBytes  70.4 Kbits/sec  ${r.quality === "good" ? "2.9" : "41.0"} ms  ${r.quality === "good" ? "1/500 (0.2%)" : "10/500 (2%)"}`].join("\n"), explanation: `Voice took ${r.tun}${r.fallback ? " (fallback — no path met the SLA)" : ""}: quality ${r.quality}.` } : { output: `iperf3: error - unable to receive results: no reply from ${SD_IP.app} (all datagrams lost)`, explanation: r.fail };
    return r.delivered ? { output: ["sending incremental file list", "./", "db-backup.tar", "", "sent 1,204,881 bytes  received 35 bytes  481,966.40 bytes/sec", "total size is 1,203,200  speedup is 1.00"].join("\n"), explanation: `The backup took ${r.tun}.` } : { output: `rsync: failed to connect to ${SD_IP.app} (${SD_IP.app}): Connection timed out (110)\nrsync error: error in socket IO (code 10) at clientserver.c(137)`, explanation: r.fail };
  };
  const ipA: CliArgSpec = { choices: [SD_IP.app], resolve: (raw) => (raw === SD_IP.app ? raw : undefined) };
  const cmds: CliCommand[] = [
    { id: "addr", syntax: "ip addr", summary: "This host's address", run: () => ({ output: `2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 state UP\n    inet ${SD_IP.client}/24 scope global eth0` }) },
    { id: "route", syntax: "ip route", summary: "This host's routes", run: () => ({ output: `default via ${SD_IP.branchLan} dev eth0\n10.30.30.0/24 dev eth0 proto kernel scope link src ${SD_IP.client}`, explanation: "The host knows nothing about paths: the edge chooses per application." }) },
    { id: "voice", syntax: "iperf3 -u -c <ip> -p 16400 --dscp 46", summary: "A voice-like UDP stream marked EF", args: { ip: ipA }, run: () => send("VOICE") },
    { id: "bulk", syntax: "rsync -av /backup/ <url>", summary: "Run the backup (TCP 873)", args: { url: { choices: [`rsync://${SD_IP.app}/backup`], describe: () => "the hub's rsync daemon", resolve: (raw) => (raw.replace(/\/$/, "") === `rsync://${SD_IP.app}/backup` ? raw : undefined) } }, run: () => send("BULK") },
  ];
  return withShellHistory({ vendor: "cisco", deviceId: "CLIENT", deviceName: "client", prompt: "admin@client:~$ ", commands: cmds }, "linux", api.history);
}
export function sdEdgeSets(api: SdCliApi): Partial<Record<CliVendor, CliCommandSet>> {
  return { cisco: upper(ciscoEdgeSet(api)), juniper: upper(junosSet(api)) };
}
export const sdCtrlSets = (api: SdCliApi): Partial<Record<CliVendor, CliCommandSet>> => ({ cisco: upper(ctrlSet(api)), juniper: upper(ctrlSet(api)) });
export const sdIspSets = (isp: "ISP-A" | "ISP-B", api: Pick<SdCliApi, "view">): Partial<Record<CliVendor, CliCommandSet>> => ({ cisco: ispSet("cisco", isp, api), juniper: ispSet("juniper", isp, api) });
export const sdClientSet = clientSet;
export const sdJunosConfig = (api: Pick<SdCliApi, "view">) => (which: "committed" | number, path: string[]) => (which === "committed" || which === 0 ? sdJunosText(api.view.cfg, path) : undefined);
