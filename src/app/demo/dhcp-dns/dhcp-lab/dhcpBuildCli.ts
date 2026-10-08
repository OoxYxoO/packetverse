import type { CliArgSpec, CliCommand, CliCommandSet, CliVendor } from "@/lib/cli/types";
import { interfaceArg } from "@/lib/cli/format";
import { withSelfPing } from "@/lib/cli/selfPing";
import { DL_LAB_MODEL, configured, isIp, type DlAction, type DlState } from "@/lib/sim-engine/scenarios/dhcpDnsLab";
import { parseDhcpd, parseZone, r1RunningConfig, ZONE, type R1Helpers } from "@/lib/sim-engine/scenarios/dhcpDnsBuild";
import { dlCliSets } from "./dhcpCli";
import { JUNOS_PATHS, candidateHelpers, iosDiff, junosText } from "./routerConfig";
import { junosCompare } from "./cliPipes";

/**
 * Build it yourself: CLI command sets that CAN change the network. R1 gets real configuration modes and the tools an
 * engineer uses around a change: IOS running vs startup configuration, `show archive config differences`,
 * `configure replace`; Junos candidate vs committed configuration, `show | compare`, commit history and `rollback`.
 * Every view is generated from the same state the simulation runs (routerConfig.ts), and every change goes through
 * the build API, which applies it to the simulation. Anything not understood is refused the way the real device would.
 */

export type R1Iface = "ge-0/0/0" | "ge-0/0/1" | "ge-0/0/2";
export type CiscoMode = { kind: "exec" } | { kind: "config" } | { kind: "if"; iface: R1Iface };
export type JunosMode = "op" | "edit";
export interface JunosCandidate {
  serverGroups: Record<string, string[]>;
  groups: Record<string, { sg?: string; iface?: R1Iface }>;
}
/** One committed Junos configuration (rollback n). `at` is when it was committed (epoch ms; 0 = factory). */
export interface JunosCommit {
  cfg: JunosCandidate;
  at: number;
  by: string;
  via: string;
  comment?: string;
}
/** A question the device asks before it acts ("Destination filename [startup-config]?"); the next line answers it. */
export interface CliQuestion {
  node: string;
  prompt: string;
  answer: (line: string) => { output: string; refused?: boolean; explanation?: string };
  cancel?: () => string;
}
export interface BuildCliApi {
  helpers: R1Helpers;
  /** An IOS configuration line changed the helpers: running config, active on Enter. */
  setHelpers: (h: R1Helpers, line: string) => void;
  junos: JunosCandidate;
  /** A Junos edit changed the candidate (nothing active until commit). */
  setJunos: (j: JunosCandidate, line: string) => void;
  /** Load a configuration into the candidate without recording an edit (entering configuration mode). */
  loadCandidate: (j: JunosCandidate) => void;
  /** rollback n: load commit n into the candidate. Returns an error when it doesn't exist. */
  rollbackCandidate: (n: number) => string | undefined;
  /** commit: the candidate's relay becomes R1's active configuration, and the newest commit in the history. */
  commitJunos: (h: R1Helpers, comment?: string) => void;
  commitFailed: (note: string) => void;
  /** Junos commit history: [0] is what runs (rollback 0). */
  junosHist: JunosCommit[];
  /** The candidate differs from the active configuration. */
  junosDirty: boolean;
  /** IOS startup configuration (NVRAM), and saving the running configuration into it. */
  startup: R1Helpers;
  saveStartup: () => void;
  /** The question waiting for an answer, and asking one. */
  question?: CliQuestion;
  ask: (q: CliQuestion | undefined) => void;
  /** This console's command history (show history / show cli history). */
  history?: string[];
  dhcpdText: string;
  /** Restart dhcpd with the given file text (default: the saved file). */
  restartDhcp: (text?: string) => { error?: string };
  zoneText: string;
  /** Reload the zone from the given text (default: the saved file). */
  reloadZone: (text?: string) => { error?: string };
}

const anyArg: CliArgSpec = { choices: [], resolve: (raw) => raw };
const IFS: R1Iface[] = ["ge-0/0/0", "ge-0/0/1", "ge-0/0/2"];
const ciscoName = (i: R1Iface) => `GigabitEthernet0/${i.slice(-1)}`;
const refuse = (output: string, explanation?: string) => ({ output, refused: true, explanation });
const IP: Record<R1Iface, [string, string, number]> = { "ge-0/0/0": ["10.10.10.1", "255.255.255.0", 24], "ge-0/0/1": ["10.20.20.1", "255.255.255.0", 24], "ge-0/0/2": ["198.51.100.2", "255.255.255.252", 30] };
const listArg = (choices: string[], describe?: (c: string) => string): CliArgSpec => ({ choices, resolve: (raw) => raw, describe });
// Commit times are real (wall clock); the factory configuration (at 0) dates from an hour before the lab opened.
const BOOT = Date.now() - 3_600_000;
const when = (at: number) => new Date(at || BOOT).toISOString().replace("T", " ").slice(0, 19) + " UTC";
/** The prefix (`do …` in IOS configuration mode, `run …` in Junos configuration mode) that runs an exec/operational command. */
const prefixed = (cmds: CliCommand[], word: "do" | "run"): CliCommand[] => cmds.map((c) => ({ ...c, id: `${word}:${c.id}`, syntax: `${word} ${c.syntax}`, hidden: c.hidden }));

// ---------------------------------------------------------------------------------------------------------------
// Cisco IOS
// ---------------------------------------------------------------------------------------------------------------
function iosRunning(h: R1Helpers) {
  const body = r1RunningConfig(h, "cisco");
  return `Building configuration...\n\nCurrent configuration : ${body.length + 40} bytes\n!\n${body}`;
}
function iosIpInterface(h: R1Helpers, i: R1Iface) {
  const list = h[i] ?? [];
  const helper = list.length === 0 ? "  Helper address is not set" : list.length === 1 ? `  Helper address is ${list[0]}` : `  Helper addresses are ${list[0]}\n${list.slice(1).map((x) => `                       ${x}`).join("\n")}`;
  return [`${ciscoName(i)} is up, line protocol is up`, `  Internet address is ${IP[i][0]}/${IP[i][2]}`, "  Broadcast address is 255.255.255.255", helper, "  Directed broadcast forwarding is disabled", "  Outgoing access list is not set", "  Inbound  access list is not set", "  Proxy ARP is enabled"].join("\n");
}

function r1Cisco(lab: DlState, api: BuildCliApi, mode: CiscoMode, setMode: (m: CiscoMode) => void): CliCommandSet {
  const base = dlCliSets(lab, "R1").cisco!;
  const names = Object.fromEntries(IFS.map((i) => [i, ciscoName(i)]));
  const ifArg = { iface: interfaceArg("cisco", names, { "ge-0/0/0": "faces the laptops' network", "ge-0/0/1": "faces the servers' network", "ge-0/0/2": "faces the internet" }) };
  const h = api.helpers;
  const replace = () => {
    api.setHelpers(api.startup, "configure replace nvram:startup-config");
    return { output: "Total number of passes: 1\nRollback Done", explanation: "The running configuration now matches the startup configuration: lines that weren't in it were removed, lines missing were added. It's active at once." };
  };
  const exec: CliCommand[] = [
    ...base.commands.filter((c) => !["boundary-config", "r1-ip-int", "r1-run-int"].includes(c.id)),
    { id: "b-run", syntax: "show running-config", summary: "R1's whole running configuration", run: () => ({ output: iosRunning(h), explanation: "This is what R1 is actually running right now. Long? Filter it: show running-config | include helper, or | section interface." }) },
    {
      id: "r1-run-int",
      syntax: "show running-config interface <iface>",
      summary: "The running configuration of one interface",
      args: ifArg,
      run: ({ iface }) => {
        const i = iface as R1Iface;
        const body = [`interface ${ciscoName(i)}`, ` ip address ${IP[i][0]} ${IP[i][1]}`, ...(h[i] ?? []).map((x) => ` ip helper-address ${x}`), " no shutdown", "end"].join("\n");
        return { output: `Building configuration...\n\nCurrent configuration : ${body.length} bytes\n!\n${body}` };
      },
    },
    { id: "r1-ip-int", syntax: "show ip interface <iface>", summary: "Layer 3 settings of one interface, including its DHCP helper addresses", args: ifArg, run: ({ iface }) => ({ output: iosIpInterface(h, iface as R1Iface) }) },
    { id: "r1-ip-int-all", syntax: "show ip interface", summary: "Layer 3 settings of every interface (try | include line protocol|Helper)", run: () => ({ output: IFS.map((i) => iosIpInterface(h, i)).join("\n"), explanation: "Long output on purpose: real routers print pages of it. A filter keeps only the evidence: | include Helper." }) },
    { id: "b-start", syntax: "show startup-config", summary: "The configuration saved in NVRAM (what R1 would boot with)", run: () => ({ output: `Using ${r1RunningConfig(api.startup, "cisco").length + 40} out of 262144 bytes\n!\n${r1RunningConfig(api.startup, "cisco")}`, explanation: "Saved is not the same as running: changes are live at once but only survive a reload once you save them (copy running-config startup-config)." }) },
    { id: "b-diff", syntax: "show archive config differences", summary: "What differs between the startup and the running configuration", run: () => ({ output: iosDiff(r1RunningConfig(api.startup, "cisco"), r1RunningConfig(h, "cisco")), explanation: "+ lines are in the running configuration but not saved; - lines are saved but no longer running. This is how you see exactly what a change did." }) },
    { id: "b-diff", syntax: "show archive config differences nvram:startup-config system:running-config", summary: "The same comparison, with the two files named", run: () => ({ output: iosDiff(r1RunningConfig(api.startup, "cisco"), r1RunningConfig(h, "cisco")) }) },
    {
      id: "b-copy",
      syntax: "copy running-config startup-config",
      summary: "Save the running configuration to NVRAM",
      run: () => {
        api.ask({
          node: "R1",
          prompt: "Destination filename [startup-config]? ",
          answer: (line) => {
            api.ask(undefined);
            const name = line.trim();
            if (name && name !== "startup-config") return refuse(`%Error opening nvram:${name} (Permission denied)`);
            api.saveStartup();
            return { output: "Building configuration...\n[OK]", explanation: "Saved. show archive config differences now finds no difference." };
          },
          cancel: () => (api.ask(undefined), "%Copy aborted"),
        });
        return { output: "" };
      },
    },
    { id: "b-wr", syntax: "write memory", summary: "Save the running configuration to NVRAM (the classic short form)", run: () => (api.saveStartup(), { output: "Building configuration...\n[OK]" }) },
    { id: "b-wr", syntax: "wr", summary: "", hidden: true, run: () => (api.saveStartup(), { output: "Building configuration...\n[OK]" }) },
    {
      id: "b-replace",
      syntax: "configure replace nvram:startup-config",
      summary: "Undo everything since the last save: make the running configuration the startup one",
      run: () => {
        api.ask({
          node: "R1",
          prompt: "This will apply all necessary additions and deletions\nto replace the current running configuration with the\ncontents of the specified configuration file, which is\nassumed to be a complete configuration, not a partial\nconfiguration. Enter Y if you are sure you want to proceed. ? [no]: ",
          answer: (line) => {
            api.ask(undefined);
            return /^y(es)?$/i.test(line.trim()) ? replace() : { output: "" };
          },
          cancel: () => (api.ask(undefined), ""),
        });
        return { output: "" };
      },
    },
    { id: "b-replace", syntax: "configure replace nvram:startup-config force", summary: "The same, without asking", run: replace },
    { id: "b-hist", syntax: "show history", summary: "The commands you typed in this session", run: () => ({ output: [...(api.history ?? []), "show history"].map((x) => `  ${x}`).join("\n") }) },
  ];
  const end: CliCommand = { id: "b-end", syntax: "end", summary: "Leave configuration mode", run: () => (setMode({ kind: "exec" }), { output: "%SYS-5-CONFIG_I: Configured from console by console" }) };
  const doCmds = prefixed(exec, "do");
  if (mode.kind === "exec")
    return {
      ...base,
      commands: [
        ...exec,
        { id: "b-conf", syntax: "configure terminal", summary: "Enter configuration mode", run: () => (setMode({ kind: "config" }), { output: "Enter configuration commands, one per line.  End with CNTL/Z.", explanation: "Configuration mode: commands now change R1. The prompt shows where you are." }) },
        { id: "b-conf", syntax: "conf t", summary: "", hidden: true, run: () => (setMode({ kind: "config" }), { output: "Enter configuration commands, one per line.  End with CNTL/Z." }) },
      ],
    };
  if (mode.kind === "config")
    return {
      ...base,
      prompt: "R1(config)#",
      commands: [
        { id: "b-if", syntax: "interface <iface>", summary: "Configure one interface", args: ifArg, run: ({ iface }) => (setMode({ kind: "if", iface: iface as R1Iface }), { output: "" }) },
        { id: "b-exit", syntax: "exit", summary: "Back to privileged mode", run: () => (setMode({ kind: "exec" }), { output: "" }) },
        end,
        ...doCmds,
      ],
    };
  const i = mode.iface;
  const cur = h[i] ?? [];
  const curArg = listArg(cur, () => "configured on this interface");
  return {
    ...base,
    prompt: "R1(config-if)#",
    commands: [
      {
        id: "b-helper",
        syntax: "ip helper-address <address>",
        summary: "Relay DHCP broadcasts arriving on this interface to a server",
        args: { address: anyArg },
        run: ({ address }) => {
          if (!isIp(address)) return refuse(`ip helper-address ${address}\n                  ^\n% Invalid input detected at '^' marker.`, "The helper address must be an IPv4 address.");
          if (!cur.includes(address)) api.setHelpers({ ...h, [i]: [...cur, address] }, `interface ${ciscoName(i)} · ip helper-address ${address}`);
          return { output: "", explanation: `IOS took the line and applied it to the running configuration of ${ciscoName(i)}. IOS prints nothing when a configuration line is accepted.` };
        },
      },
      { id: "b-nohelper", syntax: "no ip helper-address <address>", summary: "Remove one helper address", args: { address: curArg }, run: ({ address }) => (api.setHelpers({ ...h, [i]: cur.filter((x) => x !== address) }, `interface ${ciscoName(i)} · no ip helper-address ${address}`), { output: "" }) },
      { id: "b-nohelper-all", syntax: "no ip helper-address", summary: "Remove all helper addresses from this interface", run: () => (api.setHelpers({ ...h, [i]: [] }, `interface ${ciscoName(i)} · no ip helper-address`), { output: "" }) },
      { id: "b-if", syntax: "interface <iface>", summary: "Move to another interface", args: ifArg, run: ({ iface }) => (setMode({ kind: "if", iface: iface as R1Iface }), { output: "" }) },
      { id: "b-exit", syntax: "exit", summary: "Back to global configuration", run: () => (setMode({ kind: "config" }), { output: "" }) },
      end,
      ...doCmds,
      { id: "b-shut", syntax: "shutdown", summary: "", hidden: true, run: () => refuse("% Not available in this lab: shutting an interface would cut the network you are building.") },
      { id: "b-ipaddr", syntax: "ip address <a> <b>", summary: "", hidden: true, args: { a: anyArg, b: anyArg }, run: () => refuse("% Not available in this lab: R1's addresses are part of the network plan.") },
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Junos
// ---------------------------------------------------------------------------------------------------------------
function r1Junos(lab: DlState, api: BuildCliApi, mode: JunosMode, setMode: (m: JunosMode) => void): CliCommandSet {
  const base = dlCliSets(lab, "R1").juniper!;
  const jIf: CliArgSpec = {
    choices: IFS.map((x) => `${x}.0`),
    resolve: (raw) => {
      const r = raw.toLowerCase().replace(/\.0$/, "");
      return (IFS as string[]).includes(r) ? r : undefined;
    },
  };
  const cand = api.junos;
  const hist = api.junosHist;
  const active = hist[0].cfg;
  const rbArg: CliArgSpec = { choices: hist.map((_, n) => String(n)), resolve: (raw) => (/^\d+$/.test(raw) ? raw : undefined), describe: (n) => `${when(hist[Number(n)].at)} by ${hist[Number(n)].by} via ${hist[Number(n)].via}${hist[Number(n)].comment ? ` (${hist[Number(n)].comment})` : ""}` };
  const sgArg = listArg(Object.keys(cand.serverGroups), (n) => `server group: ${cand.serverGroups[n].join(", ")}`);
  const grArg = listArg(Object.keys(cand.groups), (n) => `relay group on ${cand.groups[n].iface ?? "?"}`);
  const stats = (c: typeof cand) => (Object.keys(c.groups).length ? `${Object.keys(c.groups).length} relay group(s)` : "no relay");
  const op: CliCommand[] = [
    ...base.commands.filter((c) => !["boundary-config", "r1-relay-conf"].includes(c.id)),
    { id: "b-jrun", syntax: "show configuration", summary: "R1's committed (active) configuration", run: () => ({ output: junosText(active), explanation: "The committed configuration: what R1 runs. Try | display set to see it as set commands, or | match dhcp-relay." }) },
    ...JUNOS_PATHS.map((p): CliCommand => ({ id: "b-jrun-sub", syntax: `show configuration ${p.path}`, summary: p.summary, run: () => emptyLevel(junosText(active, p.path.split(" ")), p.path, "active") })),
    {
      id: "b-jcommits",
      syntax: "show system commit",
      summary: "The commit history (each entry is a rollback number)",
      run: () => ({ output: hist.map((c, n) => `${String(n).padEnd(4)}${when(c.at)} by ${c.by} via ${c.via}${c.comment ? `\n    ${c.comment}` : ""}`).join("\n"), explanation: "0 is the active configuration. rollback n (in configuration mode) loads entry n into the candidate; commit makes it active again." }),
    },
    { id: "b-jrb", syntax: "show system rollback <n>", summary: "A configuration from the history", args: { n: rbArg }, run: ({ n }) => (hist[Number(n)] ? { output: junosText(hist[Number(n)].cfg) } : refuse(`error: rollback ${n} does not exist`)) },
    {
      id: "b-jrbcmp",
      syntax: "show system rollback compare <from> <to>",
      summary: "What changed between two configurations of the history",
      args: { from: rbArg, to: rbArg },
      run: ({ from, to }) => {
        const a = hist[Number(from)];
        const b = hist[Number(to)];
        if (!a || !b) return refuse(`error: rollback ${!a ? from : to} does not exist`);
        const diff = junosCompare(junosText(a.cfg), junosText(b.cfg));
        return diff ? { output: diff } : { output: "", explanation: `Rollback ${from} and rollback ${to} are the same configuration: there is no difference to show.` };
      },
    },
    { id: "b-jhist", syntax: "show cli history", summary: "The commands you typed in this session", run: () => ({ output: [...(api.history ?? []), "show cli history"].map((x, n) => `${String(n + 1).padStart(4)}  ${x}`).join("\n") }) },
  ];
  if (mode === "op")
    return {
      ...base,
      commands: [
        ...op,
        {
          id: "b-jconf",
          syntax: "configure",
          summary: "Enter configuration mode (the candidate configuration)",
          run: () => {
            // The candidate starts as the active configuration, unless it still holds uncommitted changes.
            if (!api.junosDirty) api.loadCandidate(active);
            setMode("edit");
            return { output: api.junosDirty ? "Entering configuration mode\nThe configuration has been changed but not committed\n" : "Entering configuration mode\n", explanation: "Changes you make here go into the candidate configuration: R1 keeps running the committed one until you commit." };
          },
        },
      ],
    };

  const commit = (comment?: string, quit?: boolean) => {
    const r = candidateHelpers(cand);
    if ("error" in r) return (api.commitFailed(r.note), refuse(r.error));
    api.commitJunos(r.helpers, comment);
    if (quit) setMode("op");
    return { output: quit ? "commit complete\nExiting configuration mode" : "commit complete", explanation: Object.keys(r.helpers).length ? `Active now: DHCP broadcasts arriving on ${Object.keys(r.helpers).join(", ")} are relayed to ${Object.values(r.helpers).flat().join(", ")}. It is rollback 0 in show system commit.` : "No relay is configured." };
  };
  const setCand = (next: typeof cand, line: string) => api.setJunos(next, line);
  return {
    ...base,
    prompt: "admin@R1# ",
    commands: [
      {
        id: "b-jsg",
        syntax: "set forwarding-options dhcp-relay server-group <name> <address>",
        summary: "Add a DHCP server to a server group",
        args: { name: sgArg, address: anyArg },
        run: ({ name, address }) => {
          if (!isIp(address)) return refuse(`error: invalid ip address or hostname: ${address}`);
          setCand({ ...cand, serverGroups: { ...cand.serverGroups, [name]: [...new Set([...(cand.serverGroups[name] ?? []), address])] } }, `set forwarding-options dhcp-relay server-group ${name} ${address}`);
          return { output: "", explanation: "Candidate configuration changed (not active until commit). show | compare shows what commit would change." };
        },
      },
      { id: "b-jasg", syntax: "set forwarding-options dhcp-relay group <name> active-server-group <group>", summary: "Which server group a relay group uses", args: { name: grArg, group: sgArg }, run: ({ name, group }) => (setCand({ ...cand, groups: { ...cand.groups, [name]: { ...cand.groups[name], sg: group } } }, `set forwarding-options dhcp-relay group ${name} active-server-group ${group}`), { output: "" }) },
      { id: "b-jif", syntax: "set forwarding-options dhcp-relay group <name> interface <iface>", summary: "Which interface the relay group listens on", args: { name: grArg, iface: jIf }, run: ({ name, iface }) => (setCand({ ...cand, groups: { ...cand.groups, [name]: { ...cand.groups[name], iface: iface as R1Iface } } }, `set forwarding-options dhcp-relay group ${name} interface ${iface}.0`), { output: "" }) },
      { id: "b-jdel", syntax: "delete forwarding-options dhcp-relay", summary: "Remove the whole DHCP relay configuration (candidate)", run: () => (setCand({ serverGroups: {}, groups: {} }, "delete forwarding-options dhcp-relay"), { output: "" }) },
      {
        id: "b-jdel",
        syntax: "delete forwarding-options dhcp-relay server-group <name>",
        summary: "Remove one server group",
        args: { name: sgArg },
        run: ({ name }) => {
          if (!cand.serverGroups[name]) return refuse("warning: statement not found");
          const rest = { ...cand.serverGroups };
          delete rest[name];
          setCand({ ...cand, serverGroups: rest }, `delete forwarding-options dhcp-relay server-group ${name}`);
          return { output: "" };
        },
      },
      {
        id: "b-jdel",
        syntax: "delete forwarding-options dhcp-relay server-group <name> <address>",
        summary: "Remove one server from a server group",
        args: { name: sgArg, address: anyArg },
        run: ({ name, address }) => {
          if (!cand.serverGroups[name]?.includes(address)) return refuse("warning: statement not found");
          setCand({ ...cand, serverGroups: { ...cand.serverGroups, [name]: cand.serverGroups[name].filter((x) => x !== address) } }, `delete forwarding-options dhcp-relay server-group ${name} ${address}`);
          return { output: "" };
        },
      },
      {
        id: "b-jdel",
        syntax: "delete forwarding-options dhcp-relay group <name>",
        summary: "Remove one relay group",
        args: { name: grArg },
        run: ({ name }) => {
          if (!cand.groups[name]) return refuse("warning: statement not found");
          const rest = { ...cand.groups };
          delete rest[name];
          setCand({ ...cand, groups: rest }, `delete forwarding-options dhcp-relay group ${name}`);
          return { output: "" };
        },
      },
      { id: "b-jshow", syntax: "show", summary: "The candidate configuration (try show | compare)", run: () => ({ output: junosText(cand), explanation: api.junosDirty ? "This is the candidate, with your uncommitted changes. show | compare lists exactly what commit would change." : "The candidate, identical to the committed configuration (nothing to commit)." }) },
      ...JUNOS_PATHS.map((p): CliCommand => ({ id: "b-jshow", syntax: `show ${p.path}`, summary: `${p.summary} (candidate)`, run: () => emptyLevel(junosText(cand, p.path.split(" ")), p.path, "candidate") })),
      { id: "b-jcommit", syntax: "commit", summary: "Activate the candidate configuration", run: () => commit() },
      {
        id: "b-jcheck",
        syntax: "commit check",
        summary: "Check the candidate without activating it",
        run: () => {
          const r = candidateHelpers(cand);
          return "error" in r ? refuse(r.error) : { output: "configuration check succeeds", explanation: "Valid, but nothing changed on R1: only commit activates it." };
        },
      },
      { id: "b-jcommit", syntax: "commit and-quit", summary: "Commit, then leave configuration mode", run: () => commit(undefined, true) },
      { id: "b-jcommit", syntax: "commit comment <text>", summary: "Commit with a note shown in show system commit (one word, or quoted)", args: { text: anyArg }, run: ({ text }) => commit(text.replace(/^"|"$/g, "")) },
      {
        id: "b-jrollback",
        syntax: "rollback",
        summary: "Discard your uncommitted changes (= rollback 0)",
        run: () => (api.rollbackCandidate(0), { output: "load complete", explanation: "The candidate is the committed configuration again. Nothing on R1 changed." }),
      },
      {
        id: "b-jrollback",
        syntax: "rollback <n>",
        summary: "Load an earlier committed configuration into the candidate",
        args: { n: rbArg },
        run: ({ n }) => {
          const err = api.rollbackCandidate(Number(n));
          if (err) return refuse(err);
          return { output: "load complete", explanation: `rollback ${n} only loads that configuration into the candidate (${stats(hist[Number(n)].cfg)}). show | compare shows what would change; commit makes it active.` };
        },
      },
      ...prefixed(op, "run"),
      {
        id: "b-jexit",
        syntax: "exit",
        summary: "Leave configuration mode",
        run: () => {
          if (!api.junosDirty) return (setMode("op"), { output: "Exiting configuration mode" });
          api.ask({
            node: "R1",
            prompt: "The configuration has been changed but not committed\nExit with uncommitted changes? [yes,no] (yes) ",
            answer: (line) => {
              api.ask(undefined);
              if (/^n(o)?$/i.test(line.trim())) return { output: "" };
              setMode("op");
              return { output: "Exiting configuration mode", explanation: "Junos keeps your candidate (show | compare next time you configure), but R1 still runs the last committed configuration." };
            },
            cancel: () => (api.ask(undefined), ""),
          });
          return { output: "" };
        },
      },
    ],
  };
}

function srvShell(lab: DlState, node: "DHCP-SRV" | "DNS-SRV", api: BuildCliApi, vendor: CliVendor): CliCommandSet {
  const base0 = dlCliSets(lab, node)[vendor]!;
  // bash history, numbered, listing itself like the real one.
  const base = { ...base0, commands: [...base0.commands, { id: "b-shist", syntax: "history", summary: "The commands you typed in this session", run: () => ({ output: [...(api.history ?? []), "history"].map((x, n) => `${String(n + 1).padStart(5)}  ${x}`).join("\n") }) }] };
  if (node === "DHCP-SRV")
    return {
      ...base,
      commands: [
        ...base.commands.filter((c) => c.id !== "s-conf"),
        { id: "b-cat", syntax: "cat /etc/dhcp/dhcpd.conf", summary: "The configuration file, as saved", run: () => ({ output: api.dhcpdText, explanation: "The file as saved on disk. The running service only reads it when it (re)starts." }) },
        { id: "b-nano", syntax: "sudo nano /etc/dhcp/dhcpd.conf", summary: "Edit the configuration file (^O saves, ^X exits)", run: () => ({ output: "", explanation: "Saving changes the file on disk only. dhcpd reads it when it (re)starts." }) },
        { id: "b-nano-ro", syntax: "nano /etc/dhcp/dhcpd.conf", summary: "Open it as your own user: the file belongs to root, so you can read it but not save it", run: () => ({ output: "" }) },
        { id: "b-test", syntax: "sudo dhcpd -t", summary: "Check the configuration file without starting the service", run: () => { const r = parseDhcpd(api.dhcpdText); return r.error ? refuse(`Internet Systems Consortium DHCP Server\nConfig file: /etc/dhcp/dhcpd.conf\n/etc/dhcp/dhcpd.conf: ${r.error}\nConfiguration file errors encountered -- exiting`) : { output: `Internet Systems Consortium DHCP Server\nConfig file: /etc/dhcp/dhcpd.conf\nDatabase file: /var/lib/dhcp/dhcpd.leases\n(no errors: subnets ${r.subnets.join(", ")})`, explanation: "The file is valid. It isn't running yet: restart the service to use it." }; } },
        { id: "b-restart", syntax: "sudo systemctl restart isc-dhcp-server", summary: "Restart the DHCP service with the saved file", run: () => { const r = api.restartDhcp(); return r.error ? refuse(`Job for isc-dhcp-server.service failed because the control process exited with error code.\nSee "systemctl status isc-dhcp-server" and "journalctl -xe" for details.`, `dhcpd refused to start: ${r.error}`) : { output: "", explanation: "systemctl prints nothing when the restart succeeds." }; } },
      ],
    };
  return {
    ...base,
    commands: [
      ...base.commands.filter((c) => c.id !== "d-zone"),
      { id: "b-zcat", syntax: `cat /etc/bind/db.${ZONE}`, summary: "The zone file, as saved", run: () => ({ output: api.zoneText, explanation: "The file as saved. named answers from the version it last loaded." }) },
      { id: "b-nano", syntax: `sudo nano /etc/bind/db.${ZONE}`, summary: "Edit the zone file (^O saves, ^X exits)", run: () => ({ output: "", explanation: "Saving changes the file on disk only. named answers from the version it last loaded until you reload it." }) },
      { id: "b-nano-ro", syntax: `nano /etc/bind/db.${ZONE}`, summary: "Open it as your own user: the file belongs to root, so you can read it but not save it", run: () => ({ output: "" }) },
      { id: "b-zcheck", syntax: `named-checkzone ${ZONE} /etc/bind/db.${ZONE}`, summary: "Check the zone file", run: () => { const r = parseZone(api.zoneText); return r.error ? refuse(`zone ${ZONE}/IN: ${r.error}\nzone ${ZONE}/IN: not loaded due to errors.`) : { output: `zone ${ZONE}/IN: loaded serial 1\nOK`, explanation: `Valid: ${Object.keys(r.records).length} host record(s). Reload named to serve them.` }; } },
      { id: "b-zreload", syntax: "sudo rndc reload", summary: "Make named load the saved zone file", run: () => (api.reloadZone(), { output: "server reload successful", explanation: "rndc reports that named accepted the request. It does not report whether each zone loaded." }) },
    ],
  };
}

/** An empty hierarchy prints nothing on Junos; say why, so silence isn't mistaken for a broken command. */
const emptyLevel = (output: string, level: string, which: "active" | "candidate") => (output ? { output } : { output, explanation: `Nothing is configured under ${level} in the ${which} configuration yet.` });

export function dlBuildCliSets(lab: DlState, node: string, api: BuildCliApi, cisco: CiscoMode, setCisco: (m: CiscoMode) => void, junos: JunosMode, setJunosMode: (m: JunosMode) => void): Partial<Record<CliVendor, CliCommandSet>> {
  if (node === "R1") return { cisco: r1Cisco(lab, api, cisco, setCisco), juniper: r1Junos(lab, api, junos, setJunosMode) };
  if (node === "DHCP-SRV" || node === "DNS-SRV") return { cisco: srvShell(lab, node, api, "cisco"), juniper: srvShell(lab, node, api, "juniper") };
  const sets = dlCliSets(lab, node as Parameters<typeof dlCliSets>[1]);
  // The switches: the right conclusion is that nothing needs configuring for DHCP or DNS. Say that, in each OS's voice.
  if (node === "SW1" || node === "SW2")
    for (const v of ["cisco", "juniper"] as CliVendor[]) {
      const set = sets[v];
      if (!set) continue;
      sets[v] = {
        ...set,
        commands: set.commands.map((c) =>
          c.id === "boundary-config"
            ? { ...c, run: () => refuse(v === "cisco" ? `% ${node} needs no configuration for DHCP or DNS: it forwards every frame, broadcasts included, without reading them.\n% Its show commands prove what it learned (show mac address-table, show interfaces).` : `error: ${node} needs no configuration for DHCP or DNS: it forwards every frame, broadcasts included, without reading them.\nIts show commands prove what it learned (show ethernet-switching table, show interfaces).`, "Not every device needs configuring. A switch carries DHCP and DNS like any other traffic; checking what it learned is the useful step here.") }
            : c,
        ),
      };
    }
  return sets;
}

// ---------------------------------------------------------------------------------------------------------------
// The PC's Command Prompt: commands that act on the network. Each one computes its output from the same pure model
// step the lab then applies, so what the prompt prints is exactly what the network did.
// ---------------------------------------------------------------------------------------------------------------
export function clientPromptSet(lab: DlState, act: (a: DlAction) => void): CliCommandSet {
  const step = (a: DlAction) => {
    const next = DL_LAB_MODEL.start(lab, a);
    act(a);
    return next;
  };
  const ipShort = (s: DlState) => {
    const c = s.client;
    return ["Ethernet adapter Ethernet:", "", `   IPv4 Address. . . . . . . . . . . : ${c.ip ?? "(none)"}${c.phase === "APIPA" ? " (self-assigned)" : ""}`, `   Subnet Mask . . . . . . . . . . . : ${c.mask ?? ""}`, `   Default Gateway . . . . . . . . . : ${c.gw ?? ""}`].join("\n");
  };
  const allOf = (s: DlState) => dlCliSets(s, "CLIENT").cisco!.commands.find((x) => x.id === "c-ipconfig")!.run({}).output;
  const nameArg: CliArgSpec = { choices: ["www.packetverse.test", "mail.packetverse.test"], resolve: (raw) => (/^[a-z0-9.-]+$/i.test(raw) ? raw.toLowerCase() : undefined) };
  const cmds: CliCommand[] = [
    { id: "p-ip", syntax: "ipconfig", summary: "This PC's address, mask and gateway", run: () => ({ output: ipShort(lab) }) },
    { id: "p-all", syntax: "ipconfig /all", summary: "Everything DHCP gave this PC", run: () => ({ output: allOf(lab) }) },
    {
      id: "p-renew",
      syntax: "ipconfig /renew",
      summary: "Ask DHCP for settings (or extend the lease)",
      run: () => {
        const next = step(configured(lab.client) ? { type: "renew" } : { type: "dhcp-all" });
        return configured(next.client) ? { output: ipShort(next), explanation: "The DHCP exchange completed: these settings came from the server's ACK." } : refuse(`An error occurred while renewing interface Ethernet : unable to contact your DHCP server. Request has timed out.\n\n${ipShort(next)}`, "No DHCP server answered. Follow the DISCOVER to see where it stopped.");
      },
    },
    { id: "p-release", syntax: "ipconfig /release", summary: "Give the address back", run: () => { const next = step({ type: "release" }); return { output: ipShort(next) }; } },
    { id: "p-flush", syntax: "ipconfig /flushdns", summary: "Empty the DNS cache", run: () => (step({ type: "flush" }), { output: "Windows IP Configuration\n\nSuccessfully flushed the DNS Resolver Cache." }) },
    { id: "p-dns", syntax: "ipconfig /displaydns", summary: "The DNS cache", run: () => ({ output: dlCliSets(lab, "CLIENT").cisco!.commands.find((x) => x.id === "c-dns")!.run({}).output }) },
    { id: "p-arp", syntax: "arp -a", summary: "This PC's ARP cache", run: () => ({ output: dlCliSets(lab, "CLIENT").cisco!.commands.find((x) => x.id === "c-arp")!.run({}).output }) },
    {
      id: "p-nslookup",
      syntax: "nslookup <name>",
      summary: "Ask this PC's DNS server for a name",
      args: { name: nameArg },
      run: ({ name }) => {
        const dns = lab.client.dns;
        if (!configured(lab.client) || !dns) return refuse("*** Default servers are not available\nServer:  UnKnown\nAddress:  127.0.0.1", "This PC has no DNS server: it never got settings from DHCP.");
        // nslookup always asks the server (never the laptop's cache); ping and applications use the cache.
        const next = step({ type: "resolve", name, direct: true });
        const r = next.lastResult?.text ?? "";
        const head = `Server:  ${dns}\nAddress:  ${dns}\n`;
        if (next.lastResult?.ok) return { output: `${head}\nName:    ${name}\nAddress:  ${r.split("→ ")[1]?.split(" ")[0] ?? ""}` };
        if (/NXDOMAIN/.test(r)) return refuse(`${head}\n*** ${dns} can't find ${name}: Non-existent domain`, "The DNS server answered: it has no record for that name.");
        if (/refused/.test(r)) return refuse(`${head}\n*** ${dns} can't find ${name}: Server failed (connection refused)`, `${dns} is reachable, but no DNS service answers there.`);
        return refuse(`DNS request timed out.\n    timeout was 2 seconds.\nServer:  UnKnown\nAddress:  ${dns}\n\n*** Request to UnKnown timed-out`, `Nothing answered at ${dns}. Follow the DNS query to see where it stopped.`);
      },
    },
    {
      id: "p-ping",
      syntax: "ping <target>",
      summary: "Ping an address or a name",
      args: { target: { choices: ["10.10.10.1", "www.packetverse.test"], resolve: (raw) => raw.toLowerCase() } },
      run: ({ target }) => {
        const byName = !isIp(target);
        const next = step(byName ? { type: "ping-name", name: target } : { type: "ping", dst: target });
        const r = next.lastResult;
        if (byName && r && /could not find host/.test(r.text)) return refuse(`Ping request could not find host ${target}. Please check the name and try again.`);
        const ip = byName ? (next.cache.find((e) => e.name === target)?.ip ?? target) : target;
        const head = `Pinging ${byName ? `${target} [${ip}]` : ip} with 32 bytes of data:`;
        if (r?.ok) return { output: `${head}\n${Array(4).fill(`Reply from ${ip}: bytes=32 time<1ms TTL=${/TTL=(\d+)/.exec(r.text)?.[1] ?? 64}`).join("\n")}\n\nPing statistics for ${ip}:\n    Packets: Sent = 4, Received = 4, Lost = 0 (0% loss)` };
        const line = /Destination host unreachable/.test(r?.text ?? "") ? `Reply from ${next.client.ip}: Destination host unreachable.` : "Request timed out.";
        return refuse(`${head}\n${Array(4).fill(line).join("\n")}\n\nPing statistics for ${ip}:\n    Packets: Sent = 4, Received = ${line.startsWith("Reply") ? 4 : 0}, Lost = ${line.startsWith("Reply") ? 0 : 4}`, r?.text);
      },
    },
  ];
  return withSelfPing({ vendor: "cisco", deviceId: "CLIENT", deviceName: "CLIENT", prompt: "C:\\Users\\student>", commands: cmds }, "windows", [lab.client.ip]);
}
