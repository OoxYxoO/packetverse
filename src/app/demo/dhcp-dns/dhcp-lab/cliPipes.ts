/**
 * Output modifiers ("pipes"): the part after `|`. They work on the real output of the command before the pipe, so
 * they teach the habit engineers rely on: cut a long output down to the evidence you need.
 *
 *   IOS   show running-config | include helper        one pipe; the rest of the line is a (case-sensitive) regex
 *         include · exclude · begin · section · count
 *   Junos show configuration | display set | match dhcp-relay      pipes chain; patterns can be quoted
 *         match · except · find · count · last · no-more · display set · compare [rollback n]
 */

export type PipeOs = "ios" | "junos";
export interface PipeCtx {
  os: PipeOs;
  /** The command before the first pipe, as typed. */
  left: string;
  /** Junos: configuration mode (where `show` is the candidate). */
  edit?: boolean;
  /** Junos: the configuration text under `path`: the committed one, or rollback n. */
  config?: (which: "committed" | number, path: string[]) => string | undefined;
  /** Junos: how many rollbacks exist (for help and completion). */
  rollbacks?: number;
}
type Filter = { name: string; summary: string; arg?: string };

const IOS_FILTERS: Filter[] = [
  { name: "begin", summary: "Begin with the line that matches", arg: "LINE" },
  { name: "count", summary: "Count number of lines which match regexp", arg: "LINE" },
  { name: "exclude", summary: "Exclude lines that match", arg: "LINE" },
  { name: "include", summary: "Include lines that match", arg: "LINE" },
  { name: "section", summary: "Filter a section of output", arg: "LINE" },
];
const JUNOS_FILTERS: Filter[] = [
  { name: "compare", summary: "Compare configuration changes with prior version" },
  { name: "count", summary: "Count occurrences" },
  { name: "display", summary: "Show additional kinds of information" },
  { name: "except", summary: "Show only text that does not match a pattern", arg: "<pattern>" },
  { name: "find", summary: "Search for first occurrence of pattern", arg: "<pattern>" },
  { name: "last", summary: "Display end of output only" },
  { name: "match", summary: "Show only text that matches a pattern", arg: "<pattern>" },
  { name: "no-more", summary: "Don't paginate output" },
];
const filtersOf = (os: PipeOs) => (os === "ios" ? IOS_FILTERS : JUNOS_FILTERS);

/** Split a line into the command and its pipes. IOS: only the first `|` counts. Junos: every `|` outside quotes. */
export function splitPipes(os: PipeOs, line: string): { cmd: string; pipes: string[]; at: number } {
  if (os === "ios") {
    const i = line.indexOf("|");
    return i < 0 ? { cmd: line, pipes: [], at: -1 } : { cmd: line.slice(0, i), pipes: [line.slice(i + 1)], at: i };
  }
  const parts: string[] = [];
  let cur = "";
  let q = false;
  let at = -1;
  for (let k = 0; k < line.length; k++) {
    const ch = line[k];
    if (ch === '"') q = !q;
    if (ch === "|" && !q) {
      if (at < 0) at = k;
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  return { cmd: parts[0], pipes: parts.slice(1), at };
}

/** Which filter a (possibly abbreviated) word names. */
function resolve(os: PipeOs, word: string): { f?: Filter; ambiguous?: string[] } {
  const w = word.toLowerCase();
  const exact = filtersOf(os).find((f) => f.name === w);
  if (exact) return { f: exact };
  const hits = filtersOf(os).filter((f) => f.name.startsWith(w));
  return hits.length === 1 ? { f: hits[0] } : hits.length ? { ambiguous: hits.map((h) => h.name) } : {};
}

const unquote = (s: string) => s.trim().replace(/^"(.*)"$/, "$1");
function rx(pattern: string, os: PipeOs): RegExp | undefined {
  try {
    return new RegExp(pattern, os === "junos" ? "i" : "");
  } catch {
    return undefined;
  }
}

/** The configuration path a `show` command is looking at (Junos), so `display set` and `compare` know where they are. */
export function configPath(ctx: PipeCtx): string[] | undefined {
  const w = ctx.left.trim().split(/\s+/);
  if (w[0] === "run") w.shift();
  if (w[0] !== "show") return undefined;
  if (w[1] === "configuration") return w.slice(2);
  if (ctx.edit && ctx.left.trim().split(/\s+/)[0] !== "run") return w.slice(1);
  return undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// Junos configuration text → set statements, and differences between two configurations
// ---------------------------------------------------------------------------------------------------------------
export interface SetStmt {
  path: string[];
  stmt: string;
}
/** Read Junos curly-brace configuration text (as printed) into statements with their full hierarchy. */
export function junosStatements(text: string, prefix: string[] = []): SetStmt[] {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/#.*$/gm, "");
  const tokens = src.match(/"[^"]*"|[{};]|[^\s{};]+/g) ?? [];
  const stack: string[] = [...prefix];
  const out: SetStmt[] = [];
  let words: string[] = [];
  for (const t of tokens) {
    if (t === "{") {
      stack.push(words.join(" "));
      words = [];
    } else if (t === ";") {
      if (words.length) out.push({ path: [...stack], stmt: words.join(" ") });
      words = [];
    } else if (t === "}") {
      if (words.length) out.push({ path: [...stack], stmt: words.join(" ") });
      words = [];
      if (stack.length > prefix.length) stack.pop();
    } else words.push(t);
  }
  return out;
}
export const displaySet = (text: string, prefix: string[] = []) => junosStatements(text, prefix).map((s) => `set ${[...s.path, s.stmt].join(" ")}`);

/** `show | compare`: what changed from `from` to `to`, grouped under [edit …] headers like Junos prints it. */
export function junosCompare(from: string, to: string, prefix: string[] = []): string {
  const a = junosStatements(from, prefix);
  const b = junosStatements(to, prefix);
  const key = (s: SetStmt) => `${s.path.join(" ")}|${s.stmt}`;
  const ka = new Set(a.map(key));
  const kb = new Set(b.map(key));
  const groups = new Map<string, string[]>();
  const add = (s: SetStmt, sign: "+" | "-") => {
    const h = s.path.join(" ");
    if (!groups.has(h)) groups.set(h, []);
    groups.get(h)!.push(`${sign}    ${s.stmt};`);
  };
  for (const s of a) if (!kb.has(key(s))) add(s, "-");
  for (const s of b) if (!ka.has(key(s))) add(s, "+");
  return [...groups].flatMap(([h, l]) => [h ? `[edit ${h}]` : "[edit]", ...l]).join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// Applying the pipes
// ---------------------------------------------------------------------------------------------------------------
function iosSection(lines: string[], re: RegExp): string[] {
  const out: string[] = [];
  let block: string[] = [];
  const flush = () => {
    if (block.some((l) => re.test(l))) out.push(...block);
    block = [];
  };
  for (const l of lines) {
    if (!l.startsWith(" ")) flush();
    block.push(l);
  }
  flush();
  return out;
}

export function applyPipes(output: string, pipes: string[], ctx: PipeCtx): { output: string } | { error: string } {
  let text = output;
  for (const raw of pipes) {
    const seg = raw.trim();
    const [word, ...rest] = seg.split(/\s+/);
    const argText = seg.slice(word.length).trim();
    if (!word) return { error: ctx.os === "ios" ? "% Incomplete command." : "syntax error, expecting <command>." };
    const r = resolve(ctx.os, word);
    if (r.ambiguous) return { error: ctx.os === "ios" ? `% Ambiguous command:  "| ${seg}"` : `'${word}' is ambiguous.\nPossible completions:\n${r.ambiguous.map((n) => `  ${n}`).join("\n")}` };
    if (!r.f) return { error: ctx.os === "ios" ? "% Invalid input detected at '^' marker." : `syntax error, expecting <command>: ${word}` };
    const lines = text.split("\n");
    const f = r.f.name;
    if (ctx.os === "ios") {
      if (!argText && f !== "count") return { error: "% Incomplete command." };
      const re = rx(argText || ".*", "ios");
      if (!re) return { error: `% Invalid regular expression: ${argText}` };
      if (f === "include") text = lines.filter((l) => re.test(l)).join("\n");
      else if (f === "exclude") text = lines.filter((l) => !re.test(l)).join("\n");
      else if (f === "begin") {
        const i = lines.findIndex((l) => re.test(l));
        text = i < 0 ? "" : lines.slice(i).join("\n");
      } else if (f === "section") text = iosSection(lines, re).join("\n");
      else if (f === "count") text = `Number of lines which match regexp = ${lines.filter((l) => re.test(l)).length}`;
      continue;
    }
    // Junos
    const pattern = unquote(argText);
    if (["match", "except", "find"].includes(f)) {
      if (!pattern) return { error: "syntax error, expecting <pattern>." };
      const re = rx(pattern, "junos");
      if (!re) return { error: `error: invalid regular expression: ${pattern}` };
      if (f === "match") text = lines.filter((l) => re.test(l)).join("\n");
      else if (f === "except") text = lines.filter((l) => !re.test(l)).join("\n");
      else {
        const i = lines.findIndex((l) => re.test(l));
        text = i < 0 ? "" : lines.slice(i).join("\n");
      }
    } else if (f === "count") text = `Count: ${lines.filter((l) => l.trim()).length} lines`;
    else if (f === "last") {
      const n = rest[0] ? Number(rest[0]) : 10;
      if (!Number.isInteger(n) || n < 1) return { error: `error: invalid value: ${rest[0]}` };
      text = lines.slice(-n).join("\n");
    } else if (f === "no-more") continue;
    else if (f === "display") {
      if (!/^set$/i.test(pattern)) return { error: pattern ? `syntax error, expecting 'set': ${pattern}` : "syntax error, expecting 'set'." };
      const path = configPath(ctx);
      if (!path) return { error: "error: display set is only available for configuration output" };
      text = displaySet(text, path).join("\n");
    } else if (f === "compare") {
      const path = configPath(ctx);
      if (!path || !ctx.config) return { error: "error: compare is only available for configuration output" };
      let which: "committed" | number;
      if (!pattern) {
        if (!ctx.edit) return { error: "syntax error, expecting <filename> or rollback." };
        which = "committed";
      } else {
        const m = /^rollback\s+(\d+)$/i.exec(pattern);
        if (!m) return { error: `syntax error, expecting rollback <number>: ${pattern}` };
        which = Number(m[1]);
      }
      const base = ctx.config(which, path);
      if (base === undefined) return { error: `error: rollback ${which} does not exist` };
      text = junosCompare(base, text, path);
    }
  }
  return { output: text };
}

// ---------------------------------------------------------------------------------------------------------------
// ? and Tab after a pipe
// ---------------------------------------------------------------------------------------------------------------
const rows = (os: PipeOs, r: { label: string; description?: string }[]) => {
  const w = Math.max(18, ...r.map((x) => x.label.length)) + 2;
  const body = r.map((x) => `  ${x.description ? x.label.padEnd(w) + x.description : x.label}`).join("\n");
  return os === "junos" ? `Possible completions:\n${body}` : body;
};

/** `?` typed after a pipe: the filters, or what the filter being typed expects next. */
export function pipeHelp(os: PipeOs, line: string, ctx: PipeCtx): string {
  const { pipes } = splitPipes(os, line);
  const seg = pipes[pipes.length - 1] ?? "";
  const trailing = /\s$/.test(seg) || seg === "";
  const words = seg.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || (words.length === 1 && !trailing)) {
    const list = filtersOf(os).filter((f) => !words[0] || f.name.startsWith(words[0].toLowerCase()));
    if (!list.length) return os === "ios" ? "% Unrecognized command" : "No valid completions";
    return rows(os, list.map((f) => ({ label: f.name, description: f.summary })));
  }
  const r = resolve(os, words[0]);
  if (!r.f) return os === "ios" ? "% Unrecognized command" : "No valid completions";
  if (os === "ios") return rows(os, [{ label: "LINE", description: "Regular Expression" }]);
  if (r.f.name === "display") return rows(os, [{ label: "set", description: "Show 'set' commands that create configuration" }]);
  if (r.f.name === "compare") {
    if (words[1] === "rollback" || (words[1] && "rollback".startsWith(words[1]) && !trailing)) {
      if (words[1] !== "rollback") return rows(os, [{ label: "rollback", description: "Compare against a rollback configuration" }]);
      return rows(os, Array.from({ length: ctx.rollbacks ?? 0 }, (_, n) => ({ label: String(n), description: n === 0 ? "the committed configuration" : `${n} commit(s) ago` })));
    }
    return rows(os, [...(ctx.edit ? [{ label: "<[Enter]>", description: "Compare with the committed configuration" }] : []), { label: "rollback", description: "Compare against a rollback configuration" }]);
  }
  if (r.f.name === "last") return rows(os, [{ label: "<[Enter]>", description: "Last 10 lines" }, { label: "<number>", description: "Number of lines to display from the end" }]);
  if (r.f.arg) return rows(os, [{ label: r.f.arg, description: "Pattern to match against (a regular expression; quote it if it has spaces)" }]);
  return rows(os, [{ label: "<[Enter]>", description: "Execute this command" }, { label: "|", description: "Pipe through a command" }]);
}

/** Tab after a pipe: complete the filter name (and `display set`, `compare rollback`). */
export function pipeComplete(os: PipeOs, line: string): { line: string; extended: boolean; options: string[] } {
  const { pipes } = splitPipes(os, line);
  const seg = pipes[pipes.length - 1] ?? "";
  const base = line.slice(0, line.length - seg.length);
  const lead = seg.match(/^\s*/)![0];
  const words = seg.trim().split(/\s+/).filter(Boolean);
  const trailing = /\s$/.test(seg);
  const done = (next: string) => ({ line: next, extended: next !== line, options: [] as string[] });
  if (words.length <= 1 && !trailing) {
    const list = filtersOf(os).filter((f) => f.name.startsWith((words[0] ?? "").toLowerCase()));
    if (list.length === 1) return done(`${base}${lead || " "}${list[0].name} `);
    return { line, extended: false, options: list.map((f) => f.name) };
  }
  const r = resolve(os, words[0]);
  if (os === "junos" && r.f?.name === "display" && (words.length === 1 || "set".startsWith(words[1] ?? "")) && !(words.length === 2 && trailing)) return done(`${base}${lead}display set`);
  if (os === "junos" && r.f?.name === "compare" && (words.length === 1 || "rollback".startsWith(words[1] ?? "")) && !(words.length === 2 && trailing)) return done(`${base}${lead}compare rollback `);
  return { line, extended: false, options: [] };
}
