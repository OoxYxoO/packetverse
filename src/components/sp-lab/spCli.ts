import type { CliArgSpec, CliCommand, CliCommandSet, CliResult } from "@/lib/cli/types";
import type { CliQuestion } from "@/app/demo/dhcp-dns/dhcp-lab/dhcpBuildCli";
import { junosCurly, spClone, xrDiff, xrPending, type JStmt } from "./spKit";

/**
 * Commit-based command lines for the Service Provider labs: Cisco IOS XR and Junos.
 *
 * Both platforms edit a CANDIDATE configuration and activate it only on `commit` — the habit SP engineers live by.
 * A lesson describes its configuration statements once (the XR mode and syntax, the Junos `set` syntax, and how each
 * changes its configuration object) plus its operational show commands; this module builds the real command sets:
 *
 *   IOS XR   exec: show … · configure [terminal] · rollback configuration last <n>
 *            config modes: the lesson's statements and their `no` forms, nested sub-modes with lesson prompts
 *            ("config-isis-if"), exit · root · end · abort · commit · show configuration (the uncommitted target) ·
 *            show commit changes diff · do <exec command>. Leaving with uncommitted changes asks, as XR does.
 *   Junos    operational: show … · show configuration [path] · configure
 *            configuration: set / delete <statement> · show [path] (the candidate) · commit [check | and-quit] ·
 *            rollback [n] · run <command> · top · exit / quit (asks about uncommitted changes) · `| compare`,
 *            `| display set` through the shared pipes.
 *
 * Nothing changes the network until commit; the lesson's `commit` callback applies the new configuration to the model.
 */

export type Args = Record<string, string>;
export interface XrFrame {
  mode: string;
  ctx: Args;
}
/** Empty = exec; [{ mode: "config" }] = global configuration; deeper frames are sub-modes. */
export type XrStack = XrFrame[];

export interface SpCfgStmt<C> {
  id: string;
  summary: string;
  args?: Record<string, CliArgSpec>;
  /** IOS XR: valid in `mode`; `enter` opens a sub-mode whose context is the parent's plus these arguments. */
  xr?: {
    mode: string;
    syntax: string;
    enter?: string;
    /** Closes the current sub-mode after applying ("end-set", "end-policy"). */
    exits?: boolean;
    apply?: (c: C, a: Args, ctx: Args) => C | string;
    /** The `no` form (not offered when undefined). */
    no?: (c: C, a: Args, ctx: Args) => C | string;
    /** The `no` form's own syntax when it takes fewer words ("no metric" for "metric <n>"). */
    noSyntax?: string;
  };
  /** Junos: the words after `set` / `delete`. */
  junos?: {
    syntax: string;
    set?: (c: C, a: Args) => C | string;
    del?: (c: C, a: Args) => C | string;
  };
}
export interface SpCmd {
  id: string;
  summary: string;
  syntax: string;
  args?: Record<string, CliArgSpec>;
  hidden?: boolean;
  run: (a: Args) => string | CliResult;
}

/** One device's configuration session, as the workspace holds it. */
export interface SpDevCli<C> {
  host: string;
  running: C;
  /** Earlier committed configurations, newest first: rollback 1 = hist[0]. */
  hist: C[];
  cand?: C;
  setCand: (c: C | undefined) => void;
  xr: XrStack;
  setXr: (s: XrStack) => void;
  edit: boolean;
  setEdit: (b: boolean) => void;
  /** Apply a committed configuration to the network (the only way configuration reaches the model). */
  commit: (c: C, text: string) => void;
  ask?: (q: CliQuestion | undefined) => void;
  /** Refuse a commit that the OS would refuse (returns the error text). */
  validate?: (c: C) => string | undefined;
}

const res = (output: string, explanation?: string): CliResult => ({ output, explanation });
const refuse = (output: string, explanation?: string): CliResult => ({ output, refused: true, explanation });
const same = <C>(a: C | undefined, b: C | undefined) => JSON.stringify(a) === JSON.stringify(b);
const prefixed = (cmds: CliCommand[], word: string): CliCommand[] => cmds.map((c) => ({ ...c, id: `${word}:${c.id}`, syntax: `${word} ${c.syntax}` }));
const toCmd = (c: SpCmd): CliCommand => ({ id: c.id, syntax: c.syntax, summary: c.summary, args: c.args, hidden: c.hidden, run: (a) => {
  const r = c.run(a);
  return typeof r === "string" ? res(r) : r;
} });
/** Path words after `show configuration` (any configuration word; Junos prints nothing for a path that isn't there). */
const pathArg = (choices: string[]): CliArgSpec => ({ choices, describe: () => "Configuration hierarchy", resolve: (raw) => (/^[\w./:-]+$/.test(raw) ? raw : undefined) });

// ---------------------------------------------------------------------------------------------------------------
// IOS XR
// ---------------------------------------------------------------------------------------------------------------
export interface SpXrSpec<C> {
  stmts: SpCfgStmt<C>[];
  /** Exec show commands (also reachable as `do …` in configuration modes). */
  shows: SpCmd[];
  /** Other exec commands: ping, traceroute, clear … */
  exec?: SpCmd[];
  /** Mode → prompt word ("isis" → "config-isis"). */
  prompts: Record<string, string>;
  /** The running configuration as XR prints it (top-level sections separated by "!"). */
  lines: (c: C) => string[];
  help?: Record<string, string>;
}
export const xrPrompt = (host: string) => `RP/0/RP0/CPU0:${host}`;

/**
 * `?` descriptions for intermediate keywords ("show route advertising-protocol"): when every visible command under a
 * keyword path shares one summary, that summary describes the keyword too — as on a real router. Explicit help wins.
 */
function autoHelp(set: CliCommandSet): CliCommandSet {
  const help: Record<string, string> = { ...set.help };
  const groups = new Map<string, Set<string>>();
  for (const c of set.commands) {
    if (c.hidden) continue;
    const w = c.syntax.split(" ");
    for (let i = 1; i < w.length && !w[i - 1].startsWith("<"); i++) {
      const path = w.slice(0, i).join(" ");
      if (!groups.has(path)) groups.set(path, new Set());
      groups.get(path)!.add(c.summary);
    }
  }
  for (const [path, sums] of groups) if (!(path in help) && sums.size === 1) help[path] = [...sums][0];
  return { ...set, help };
}

export function buildXrSet<C>(d: SpDevCli<C>, spec: SpXrSpec<C>): CliCommandSet {
  return autoHelp(xrSet(d, spec));
}
function xrSet<C>(d: SpDevCli<C>, spec: SpXrSpec<C>): CliCommandSet {
  const base = xrPrompt(d.host);
  const top = d.xr[d.xr.length - 1];
  const pending = !!d.cand && !same(d.cand, d.running);
  const runningText = (c: C, filter?: string[]) => {
    const lines = spec.lines(c);
    if (!filter?.length) return ["Building configuration...", "!! IOS XR Configuration 7.9.2", ...lines, "end"].join("\n");
    const want = filter.join(" ");
    const out: string[] = [];
    let keep = false;
    for (const l of lines) {
      if (!l.startsWith(" ") && l !== "!") keep = l === want || l.startsWith(`${want} `);
      if (keep) out.push(l);
    }
    return out.length ? [...out, "!"].join("\n") : "% No such configuration item(s)";
  };
  const rcWords = [...new Set(spec.lines(d.running).filter((l) => !l.startsWith(" ") && l !== "!").map((l) => l.split(" ")[0]))];
  const runCfg: CliCommand[] = [
    { id: "xr:show-run", syntax: "show running-config", summary: "Current operating configuration", run: () => res(runningText(d.running)) },
    { id: "xr:show-run-1", syntax: "show running-config <w1>", summary: "Current operating configuration", args: { w1: pathArg(rcWords) }, run: (a) => res(runningText(d.running, [a.w1])) },
    { id: "xr:show-run-2", syntax: "show running-config <w1> <w2>", summary: "Current operating configuration", args: { w1: pathArg(rcWords), w2: pathArg([]) }, run: (a) => res(runningText(d.running, [a.w1, a.w2])) },
  ];
  const execCmds: CliCommand[] = [...spec.shows.map(toCmd), ...runCfg, ...(spec.exec ?? []).map(toCmd)];
  const help = { show: "Show commands", "show running-config": "Current operating configuration", configure: "Enter configuration mode", ...spec.help };

  if (!top) {
    return {
      vendor: "cisco",
      deviceId: d.host,
      deviceName: d.host,
      prompt: `${base}#`,
      help: { ...help, rollback: "Rollback configuration changes" },
      commands: [
        ...execCmds,
        {
          id: "xr:configure",
          syntax: "configure",
          summary: "Enter configuration mode",
          run: () => {
            d.setCand(spClone(d.running));
            d.setXr([{ mode: "config", ctx: {} }]);
            return res("", "Configuration mode edits a candidate (the target configuration). Nothing changes until you type commit.");
          },
        },
        { id: "xr:configure-t", syntax: "configure terminal", summary: "Configure from the terminal", hidden: true, run: () => (d.setCand(spClone(d.running)), d.setXr([{ mode: "config", ctx: {} }]), res("")) },
        {
          id: "xr:rollback",
          syntax: "rollback configuration last <n>",
          summary: "Roll back the last <n> commits",
          args: { n: { choices: ["1", "2"], describe: () => "Number of commits to roll back", resolve: (r) => (/^\d+$/.test(r) && +r >= 1 && +r <= 100 ? String(+r) : undefined) } },
          run: (a) => {
            const n = +a.n;
            const target = d.hist[n - 1];
            if (!target) return refuse(`% Requested rollback point is not available: only ${d.hist.length} commit(s) to roll back.`);
            d.commit(spClone(target), `rollback configuration last ${n}`);
            return res(["Loading Rollback Changes.", "Loaded Rollback Changes in 1 sec", "Committing.", "1 items committed in 1 sec (0)items/sec", "Updating.", "Updated Commit database in 1 sec", `Configuration successfully rolled back ${n} commit${n > 1 ? "s" : ""}.`].join("\n"));
          },
        },
      ],
    };
  }

  const mode = top.mode;
  const cand = d.cand ?? spClone(d.running);
  const toExec = () => {
    d.setCand(undefined);
    d.setXr([]);
  };
  const doCommit = (): CliResult => {
    if (!pending) return res("% No configuration changes to commit.");
    const err = d.validate?.(cand);
    if (err) return refuse(`% Failed to commit one or more configuration items during a pseudo-atomic operation. All changes made have been reverted.\n${err}`);
    d.commit(spClone(cand), "commit");
    d.setCand(spClone(cand));
    return res("", "Committed: the candidate is now the running configuration, and the network reacts to it.");
  };
  const leave = (): CliResult => {
    if (!pending) return (toExec(), res(""));
    d.ask?.({
      node: d.host,
      prompt: "Uncommitted changes found, commit them before exiting(yes/no/cancel)? [cancel]:",
      answer: (line) => {
        const w = line.trim().toLowerCase();
        d.ask?.(undefined);
        if (w === "yes" || w === "y") {
          const err = d.validate?.(cand);
          if (err) return { output: `% Failed to commit one or more configuration items. All changes made have been reverted.\n${err}`, refused: true };
          d.commit(spClone(cand), "commit");
          toExec();
          return { output: "" };
        }
        if (w === "no" || w === "n") {
          toExec();
          return { output: "", explanation: "The uncommitted changes were discarded." };
        }
        return { output: "" };
      },
      cancel: () => (d.ask?.(undefined), ""),
    });
    return res("");
  };
  const stmts: CliCommand[] = [];
  for (const st of spec.stmts) {
    const x = st.xr;
    if (!x || x.mode !== mode) continue;
    stmts.push({
      id: `xr:${st.id}`,
      syntax: x.syntax,
      summary: st.summary,
      args: st.args,
      run: (a) => {
        let next = cand;
        if (x.apply) {
          const r = x.apply(spClone(cand), a, top.ctx);
          if (typeof r === "string") return refuse(r);
          next = r;
        }
        d.setCand(next);
        if (x.enter) d.setXr([...d.xr, { mode: x.enter, ctx: { ...top.ctx, ...a } }]);
        else if (x.exits && d.xr.length > 1) d.setXr(d.xr.slice(0, -1));
        return res("");
      },
    });
    if (x.no) {
      const no = x.no;
      stmts.push({
        id: `xr:no-${st.id}`,
        syntax: `no ${x.noSyntax ?? x.syntax}`,
        summary: st.summary,
        args: st.args,
        run: (a) => {
          const r = no(spClone(cand), a, top.ctx);
          if (typeof r === "string") return refuse(r);
          d.setCand(r);
          return res("");
        },
      });
    }
  }
  const modeWord = spec.prompts[mode] ?? "config";
  return {
    vendor: "cisco",
    deviceId: d.host,
    deviceName: d.host,
    prompt: `${base}(${modeWord})#`,
    help: { ...help, no: "Negate a command or set its defaults", do: "Run an exec mode command", commit: "Commit the configuration changes to running", abort: "Discard the uncommitted changes and exit to exec mode", exit: "Exit from this submode", end: "Exit to the exec mode", root: "Exit to the global configuration mode" },
    commands: [
      ...stmts,
      { id: "xr:commit", syntax: "commit", summary: "Commit the configuration changes to running", run: doCommit },
      { id: "xr:abort", syntax: "abort", summary: "Discard the uncommitted changes and exit to exec mode", run: () => (toExec(), res("", pending ? "The uncommitted changes were discarded." : undefined)) },
      { id: "xr:exit", syntax: "exit", summary: "Exit from this submode", run: () => (d.xr.length > 1 ? (d.setXr(d.xr.slice(0, -1)), res("")) : leave()) },
      { id: "xr:root", syntax: "root", summary: "Exit to the global configuration mode", run: () => (d.setXr([{ mode: "config", ctx: {} }]), res("")) },
      { id: "xr:end", syntax: "end", summary: "Exit to the exec mode", run: leave },
      { id: "xr:show-config", syntax: "show configuration", summary: "Show the uncommitted target configuration", run: () => res(pending ? xrPending(spec.lines(d.running), spec.lines(cand)) : "Building configuration...\n!! IOS XR Configuration 7.9.2\nend") },
      { id: "xr:show-diff", syntax: "show commit changes diff", summary: "Display the uncommitted changes as a diff", run: () => res(pending ? `Building configuration...\n!! IOS XR Configuration 7.9.2\n${xrDiff(spec.lines(d.running), spec.lines(cand))}\nend` : "% No such configuration item(s)") },
      ...prefixed(execCmds, "do"),
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Junos
// ---------------------------------------------------------------------------------------------------------------
export interface SpJunosSpec<C> {
  stmts: SpCfgStmt<C>[];
  shows: SpCmd[];
  /** Other operational commands: ping, traceroute, clear … */
  op?: SpCmd[];
  /** The configuration as statements (the lesson's part of it). */
  jstmts: (c: C) => JStmt[];
  help?: Record<string, string>;
}
export const junosPrompt = (host: string, edit: boolean) => `admin@${host}${edit ? "#" : ">"} `;

/** For the console's `| compare` and `| display set`: the committed configuration, or rollback n, under a path. */
export function junosPipeConfig<C>(d: Pick<SpDevCli<C>, "running" | "hist">, spec: Pick<SpJunosSpec<C>, "jstmts">) {
  return (which: "committed" | number, path: string[]) => {
    const c = which === "committed" || which === 0 ? d.running : d.hist[which - 1];
    return c === undefined ? undefined : junosCurly(spec.jstmts(c), path);
  };
}

export function buildJunosSet<C>(d: SpDevCli<C>, spec: SpJunosSpec<C>): CliCommandSet {
  return autoHelp(junosSet(d, spec));
}
function junosSet<C>(d: SpDevCli<C>, spec: SpJunosSpec<C>): CliCommandSet {
  const pending = !!d.cand && !same(d.cand, d.running);
  const words = (c: C, depth: number) => [...new Set(spec.jstmts(c).map((s) => [...s.path, s.leaf].join(" ").split(" ")[depth]).filter(Boolean))];
  const pathCmds = (head: string, id: string, c: () => C, summary: string): CliCommand[] =>
    [0, 1, 2, 3, 4].map((n) => {
      const args: Record<string, CliArgSpec> = {};
      const parts = [head];
      for (let i = 0; i < n; i++) {
        args[`p${i}`] = pathArg(words(c(), i));
        parts.push(`<p${i}>`);
      }
      return {
        id: `${id}-${n}`,
        syntax: parts.join(" "),
        summary,
        args,
        hidden: n > 1,
        run: (a: Args) => res(junosCurly(spec.jstmts(c()), Object.keys(a).sort().map((k) => a[k]))),
      };
    });
  const opCmds: CliCommand[] = [...spec.shows.map(toCmd), ...pathCmds("show configuration", "jn:show-conf", () => d.running, "Show current configuration"), ...(spec.op ?? []).map(toCmd)];
  const help = { show: "Show system information", "show configuration": "Show current configuration", configure: "Manipulate software configuration information", ...spec.help };

  if (!d.edit) {
    return {
      vendor: "juniper",
      deviceId: d.host,
      deviceName: d.host,
      prompt: junosPrompt(d.host, false),
      help,
      commands: [
        ...opCmds,
        {
          id: "jn:configure",
          syntax: "configure",
          summary: "Manipulate software configuration information",
          run: () => {
            d.setCand(spClone(d.running));
            d.setEdit(true);
            return res("Entering configuration mode", "set and delete change the candidate configuration. Nothing changes until commit.");
          },
        },
      ],
    };
  }

  const cand = d.cand ?? spClone(d.running);
  const leave = (): CliResult => {
    const out = () => {
      d.setEdit(false);
      d.setCand(undefined);
    };
    if (!pending) return (out(), res("Exiting configuration mode"));
    d.ask?.({
      node: d.host,
      prompt: "The configuration has been changed but not committed\nExit with uncommitted changes? [yes,no] (yes)",
      answer: (line) => {
        const w = line.trim().toLowerCase();
        d.ask?.(undefined);
        if (w === "" || w === "yes" || w === "y") {
          // Junos keeps the uncommitted candidate in the shared database; this lab discards it on exit.
          out();
          return { output: "Exiting configuration mode", explanation: "In this lab the uncommitted candidate is discarded when you leave configuration mode." };
        }
        return { output: "" };
      },
      cancel: () => (d.ask?.(undefined), ""),
    });
    return res("");
  };
  const edits: CliCommand[] = [];
  for (const st of spec.stmts) {
    const j = st.junos;
    if (!j) continue;
    if (j.set) {
      const set = j.set;
      edits.push({
        id: `jn:set-${st.id}`,
        syntax: `set ${j.syntax}`,
        summary: st.summary,
        args: st.args,
        run: (a) => {
          const r = set(spClone(cand), a);
          if (typeof r === "string") return refuse(r);
          d.setCand(r);
          return res("");
        },
      });
    }
    if (j.del) {
      const del = j.del;
      edits.push({
        id: `jn:del-${st.id}`,
        syntax: `delete ${j.syntax}`,
        summary: st.summary,
        args: st.args,
        run: (a) => {
          const before = JSON.stringify(cand);
          const r = del(spClone(cand), a);
          if (typeof r === "string") return refuse(r);
          if (JSON.stringify(r) === before) return refuse("warning: statement not found");
          d.setCand(r);
          return res("");
        },
      });
    }
  }
  const doCommit = (andQuit: boolean): CliResult => {
    const err = d.validate?.(cand);
    if (err) return refuse(`[edit]\n  ${err}\nerror: configuration check-out failed`);
    if (pending) d.commit(spClone(cand), andQuit ? "commit and-quit" : "commit");
    if (andQuit) {
      d.setEdit(false);
      d.setCand(undefined);
      return res("commit complete\nExiting configuration mode");
    }
    d.setCand(spClone(cand));
    return res("commit complete", pending ? "Committed: the candidate is now the active configuration, and the network reacts to it." : undefined);
  };
  return {
    vendor: "juniper",
    deviceId: d.host,
    deviceName: d.host,
    prompt: junosPrompt(d.host, true),
    help: { ...help, set: "Set a parameter", delete: "Delete a data element", commit: "Commit current set of changes", rollback: "Roll back to previous committed configuration", run: "Run an operational-mode command", exit: "Exit from this level", quit: "Quit from this level", top: "Exit to top level of configuration" },
    commands: [
      ...edits,
      ...pathCmds("show", "jn:show-cand", () => cand, "Show a parameter"),
      { id: "jn:commit", syntax: "commit", summary: "Commit current set of changes", run: () => doCommit(false) },
      { id: "jn:commit-check", syntax: "commit check", summary: "Check correctness of syntax; do not apply changes", run: () => {
        const err = d.validate?.(cand);
        return err ? refuse(`[edit]\n  ${err}\nerror: configuration check-out failed`) : res("configuration check succeeds");
      } },
      { id: "jn:commit-quit", syntax: "commit and-quit", summary: "Quit configuration mode if commit succeeds", run: () => doCommit(true) },
      {
        id: "jn:rollback",
        syntax: "rollback",
        summary: "Roll back to previous committed configuration",
        run: () => (d.setCand(spClone(d.running)), res("load complete", "rollback (= rollback 0) throws away the uncommitted changes. Nothing is active until commit.")),
      },
      {
        id: "jn:rollback-n",
        syntax: "rollback <n>",
        summary: "Roll back to previous committed configuration",
        args: { n: { choices: ["0", "1", "2"], describe: (c) => (c === "0" ? "The active configuration" : `${c} commit${c === "1" ? "" : "s"} ago`), resolve: (r) => (/^\d+$/.test(r) && +r <= 49 ? String(+r) : undefined) } },
        run: (a) => {
          const n = +a.n;
          const c = n === 0 ? d.running : d.hist[n - 1];
          if (!c) return refuse(`error: rollback ${n} does not exist`);
          d.setCand(spClone(c));
          return res("load complete", "The candidate now holds that earlier configuration. Review it with show | compare, then commit to make it active.");
        },
      },
      { id: "jn:exit", syntax: "exit", summary: "Exit from this level", run: leave },
      { id: "jn:quit", syntax: "quit", summary: "Quit from this level", run: leave },
      { id: "jn:top", syntax: "top", summary: "Exit to top level of configuration", run: () => res("") },
      ...prefixed(opCmds, "run"),
    ],
  };
}

/** Choices that resolve case-sensitively-ish (keywords are lowercase; values like keys keep their case). */
export function choiceArg(choices: string[], describe?: (c: string) => string | undefined): CliArgSpec {
  return { choices, describe, resolve: (raw) => choices.find((c) => c.toLowerCase() === raw.toLowerCase()) };
}
export function numArg(lo: number, hi: number, choices: string[], what: string): CliArgSpec {
  return { choices, describe: () => what, resolve: (raw) => (/^\d+$/.test(raw) && +raw >= lo && +raw <= hi ? String(+raw) : undefined) };
}
export const wordArg = (choices: string[], what: string, re = /^[\w.:/-]+$/): CliArgSpec => ({ choices, describe: () => what, resolve: (raw) => (re.test(raw) ? raw : undefined) });
