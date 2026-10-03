import type { CliCommand, CliCommandSet, CliExecution, CliHelpEntry, CliVendor } from "./types";

/**
 * Generic CLI grammar engine (lesson-agnostic).
 *
 * The grammar is the set of CliCommand syntaxes a lesson adapter supplies
 * ("show ip interface brief", "show interfaces <interface>"), walked token
 * by token — effectively a small trie. Every feature runs on the same walk:
 *
 *   executeCli   Enter: VALID / INVALID / AMBIGUOUS / INCOMPLETE
 *   completeCli  Tab:   unique keyword → complete (+space if more syntax
 *                       follows), else longest common prefix, else list
 *   contextHelp  `?`:   next tokens for the CURRENT token, with
 *                       descriptions, plus <cr> / <[Enter]> when executable
 *
 * Matching follows IOS/Junos conventions: any unambiguous prefix of a
 * keyword is accepted, an exact keyword wins over longer ones, arguments
 * match only when the adapter's resolver accepts them, and keywords are
 * case-insensitive. Hidden commands (aliases, honest refusals) are
 * accepted but never offered by Tab or `?`.
 */

interface Token {
  text: string;
  offset: number;
}

function tokenize(line: string): Token[] {
  const tokens: Token[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) tokens.push({ text: m[0], offset: m.index });
  return tokens;
}

const isArg = (part: string) => part.startsWith("<") && part.endsWith(">");
const argName = (part: string) => part.slice(1, -1);

interface Candidate {
  cmd: CliCommand;
  parts: string[];
  args: Record<string, string>;
}

type Step = { kind: "ok"; candidates: Candidate[] } | { kind: "invalid"; tokenIndex: number } | { kind: "ambiguous"; tokenIndex: number; options: string[] };

const allCandidates = (commands: CliCommand[]): Candidate[] => commands.map((cmd) => ({ cmd, parts: cmd.syntax.split(" "), args: {} }));

/** Narrow the live candidates by one typed token at position `i`. */
function narrow(candidates: Candidate[], i: number, raw: string): Step {
  const lower = raw.toLowerCase();
  const live = candidates.filter((c) => c.parts.length > i);

  const exact = live.filter((c) => !isArg(c.parts[i]) && c.parts[i] === lower);
  if (exact.length > 0) return { kind: "ok", candidates: exact };

  const argHits = live
    .filter((c) => isArg(c.parts[i]))
    .map((c) => ({ c, value: c.cmd.args?.[argName(c.parts[i])]?.resolve(raw) }))
    .filter((h): h is { c: Candidate; value: string } => h.value !== undefined);
  if (argHits.length > 0) return { kind: "ok", candidates: argHits.map(({ c, value }) => ({ ...c, args: { ...c.args, [argName(c.parts[i])]: value } })) };

  const prefix = live.filter((c) => !isArg(c.parts[i]) && c.parts[i].startsWith(lower));
  if (prefix.length === 0) return { kind: "invalid", tokenIndex: i };
  // Visible keywords decide ambiguity; a hidden alias never makes a visible abbreviation ambiguous.
  const visibleWords = [...new Set(prefix.filter((c) => !c.cmd.hidden).map((c) => c.parts[i]))];
  const words = visibleWords.length > 0 ? visibleWords : [...new Set(prefix.map((c) => c.parts[i]))];
  if (words.length > 1) return { kind: "ambiguous", tokenIndex: i, options: words.sort() };
  return { kind: "ok", candidates: prefix.filter((c) => c.parts[i] === words[0]) };
}

function walk(set: CliCommandSet, tokens: Token[]): Step {
  let step: Step = { kind: "ok", candidates: allCandidates(set.commands) };
  for (let i = 0; i < tokens.length && step.kind === "ok"; i++) step = narrow(step.candidates, i, tokens[i].text);
  return step;
}

/** Built-ins every lesson CLI offers at the top level (handled before grammar matching). */
const BUILTINS: CliHelpEntry[] = [
  { label: "clear", description: "Clear the terminal screen" },
  { label: "help", description: "Show PacketVerse CLI help" },
];

/** Next valid tokens at position `i` that start with `partial` — visible syntax only. Keywords first (A–Z), then argument values. */
function nextOptions(set: CliCommandSet, candidates: Candidate[], i: number, partial: string): CliHelpEntry[] {
  const p = partial.toLowerCase();
  const words = new Map<string, CliHelpEntry>();
  const args = new Map<string, CliHelpEntry>();
  for (const c of candidates) {
    if (c.cmd.hidden || c.parts.length <= i) continue;
    const part = c.parts[i];
    if (!isArg(part)) {
      if (!part.startsWith(p) || words.has(part)) continue;
      const path = c.parts.slice(0, i + 1).join(" ");
      words.set(part, { label: part, description: set.help?.[path] ?? (c.parts.length === i + 1 ? c.cmd.summary : undefined) });
    } else {
      const spec = c.cmd.args?.[argName(part)];
      for (const choice of spec?.choices ?? []) {
        if (choice.toLowerCase().startsWith(p) && !args.has(choice)) args.set(choice, { label: choice, description: spec?.describe?.(choice) });
      }
    }
  }
  const out = [...[...words.values()].sort((a, b) => a.label.localeCompare(b.label)), ...args.values()];
  if (i === 0) out.push(...BUILTINS.filter((b) => b.label.startsWith(p)));
  return out;
}

/** True when the candidates allow Enter right now (a visible command ends exactly here). */
const executableAt = (candidates: Candidate[], i: number) => i > 0 && candidates.some((c) => !c.cmd.hidden && c.parts.length === i);

/** Split the input into fully typed tokens and the token currently being typed ("" after a space). */
function splitInput(line: string): { done: Token[]; partial: string } {
  const tokens = tokenize(line);
  if (line.length === 0 || /\s$/.test(line)) return { done: tokens, partial: "" };
  return { done: tokens.slice(0, -1), partial: tokens[tokens.length - 1].text };
}

// ---------------------------------------------------------------- formatting

function caretLine(prompt: string, offset: number) {
  return `${" ".repeat(prompt.length + offset)}^`;
}

/** Vendor-styled option list: Junos prints a "Possible completions:" header and <[Enter]>; IOS prints bare rows and <cr>. */
export function formatOptions(vendor: CliVendor, entries: CliHelpEntry[], executable: boolean): string {
  const rows: CliHelpEntry[] = [];
  if (vendor === "juniper" && executable) rows.push({ label: "<[Enter]>", description: "Execute this command" });
  rows.push(...entries);
  if (vendor === "cisco" && executable) rows.push({ label: "<cr>", description: "Execute the command" });
  const width = Math.max(18, ...rows.map((r) => r.label.length)) + 2;
  const body = rows.map((r) => `  ${r.description ? r.label.padEnd(width) + r.description : r.label}`).join("\n");
  return vendor === "juniper" ? `Possible completions:\n${body}` : body;
}

function formatError(set: CliCommandSet, line: string, tokens: Token[], step: Exclude<Step, { kind: "ok" }>): string {
  const tok = tokens[step.tokenIndex];
  if (step.kind === "ambiguous") {
    if (set.vendor === "cisco") return `% Ambiguous command:  "${line.trim()}"`;
    return `${caretLine(set.prompt, tok.offset)}\n'${tok.text}' is ambiguous.\nPossible completions:\n${step.options.map((o) => `  ${o}`).join("\n")}`;
  }
  return set.vendor === "cisco" ? `${caretLine(set.prompt, tok.offset)}\n% Invalid input detected at '^' marker.` : `${caretLine(set.prompt, tok.offset)}\nsyntax error, expecting <command>.`;
}

// ---------------------------------------------------------------- `?`

/**
 * Context-sensitive help for the CURRENT token — what `?` prints. Never
 * executes anything or touches state.
 *   ""                  → top-level commands (+ help/clear)
 *   "sh"  (partial)     → keywords starting "sh"
 *   "show "             → next keywords/arguments under "show"
 *   "show mac address-table " → <cr> / <[Enter]>
 */
export function contextHelp(set: CliCommandSet, line: string): string {
  const { done, partial } = splitInput(line);
  const step = walk(set, done);
  if (step.kind === "ambiguous") return set.vendor === "cisco" ? `% Ambiguous command:  "${line.trim()}"` : `'${done[step.tokenIndex].text}' is ambiguous.`;
  if (step.kind === "invalid") return set.vendor === "cisco" ? "% Unrecognized command" : `syntax error, '${done[step.tokenIndex].text}' is not valid here.`;
  const options = nextOptions(set, step.candidates, done.length, partial);
  const executable = partial === "" && executableAt(step.candidates, done.length);
  if (options.length === 0 && !executable) return set.vendor === "cisco" ? "% Unrecognized command" : "No valid completions";
  return formatOptions(set.vendor, options, executable);
}

// ---------------------------------------------------------------- Tab

export interface CliCompletion {
  /** The input after completion (unchanged when nothing could be added). */
  line: string;
  /** True when characters were added. */
  extended: boolean;
  /** Remaining candidates when the input is still ambiguous (shown on the next Tab, or now if nothing could be added). */
  options: CliHelpEntry[];
}

/**
 * Token-aware Tab completion:
 *   1. one candidate (or an exact keyword)  → complete it; add a space when more syntax can follow
 *   2. several sharing a longer prefix       → extend to the longest common prefix
 *   3. several with nothing more in common   → leave the input, return the candidates
 * An already-valid abbreviation of an argument ("fa0/1") expands to its canonical form.
 */
export function completeCli(set: CliCommandSet, line: string): CliCompletion {
  const none: CliCompletion = { line, extended: false, options: [] };
  const { done, partial } = splitInput(line);
  const step = walk(set, done);
  if (step.kind !== "ok") return none;
  const i = done.length;
  let options = nextOptions(set, step.candidates, i, partial);

  if (options.length === 0 && partial) {
    // e.g. "fa0/1" → "FastEthernet0/1"
    for (const c of step.candidates) {
      if (c.cmd.hidden || c.parts.length <= i || !isArg(c.parts[i])) continue;
      const spec = c.cmd.args?.[argName(c.parts[i])];
      const id = spec?.resolve(partial);
      const canonical = id !== undefined ? spec?.choices.find((ch) => spec.resolve(ch) === id) : undefined;
      if (canonical) options = [{ label: canonical, description: spec?.describe?.(canonical) }];
    }
  }
  if (options.length === 0) return none;

  const base = line.slice(0, line.length - partial.length);
  const pick = options.length === 1 ? options[0] : options.find((o) => o.label.toLowerCase() === partial.toLowerCase());
  if (pick) {
    const after = i === 0 && BUILTINS.some((b) => b.label === pick.label) ? "" : moreSyntaxAfter(step.candidates, i, pick.label) ? " " : "";
    const next = base + pick.label + after;
    return { line: next, extended: next !== line, options: [] };
  }

  const lcp = options.map((o) => o.label).reduce((acc, label) => {
    let n = 0;
    while (n < acc.length && n < label.length && acc[n].toLowerCase() === label[n].toLowerCase()) n++;
    return acc.slice(0, n);
  });
  if (lcp.length > partial.length) return { line: base + lcp, extended: true, options };
  return { line, extended: false, options };
}

function moreSyntaxAfter(candidates: Candidate[], i: number, label: string): boolean {
  const lower = label.toLowerCase();
  return candidates.some((c) => {
    if (c.cmd.hidden || c.parts.length <= i + 1) return false;
    const part = c.parts[i];
    if (!isArg(part)) return part === lower;
    return c.cmd.args?.[argName(part)]?.choices.some((ch) => ch.toLowerCase() === lower) ?? false;
  });
}

// ---------------------------------------------------------------- help command

/** Output of the `help` command: how to use the CLI plus every supported command. */
export function helpText(set: CliCommandSet): string {
  const listed = set.commands.filter((c) => !c.hidden).map((c) => ({ syntax: c.syntax, summary: c.summary }));
  const width = Math.max(...listed.map((r) => r.syntax.length)) + 3;
  const header = set.vendor === "cisco" ? `PacketVerse CLI help — ${set.deviceName} (IOS view)` : `PacketVerse CLI help — ${set.deviceName} (Junos view)`;
  return [
    header,
    "  ?        context help for what you are typing (try “show ?”)",
    "  Tab      complete the current keyword; Tab again lists choices",
    "  ↑ / ↓    command history     clear / cls   clear the screen",
    "",
    "Commands supported on this device in this lesson:",
    ...listed.map((r) => `  ${r.syntax.padEnd(width)}${r.summary}`),
  ].join("\n");
}

// ---------------------------------------------------------------- Enter

/**
 * Runs one typed line. Never throws for learner input: unknown, ambiguous
 * or incomplete commands come back as vendor-styled errors. A line ending
 * in "?" (e.g. pasted) is answered with context help instead of executing.
 */
export function executeCli(set: CliCommandSet, line: string): CliExecution {
  const trimmed = line.trim();
  if (!trimmed) return { kind: "empty" };
  const lowered = trimmed.toLowerCase();
  if (lowered === "clear" || lowered === "cls") return { kind: "clear" };
  if (lowered === "help") return { kind: "help", output: helpText(set) };
  if (trimmed.endsWith("?")) return { kind: "help", output: contextHelp(set, line.slice(0, line.lastIndexOf("?"))) };

  const tokens = tokenize(line);
  const step = walk(set, tokens);
  if (step.kind !== "ok") return { kind: "error", output: formatError(set, line, tokens, step) };
  const match = step.candidates.find((c) => c.parts.length === tokens.length && !c.cmd.hidden) ?? step.candidates.find((c) => c.parts.length === tokens.length);
  if (!match) {
    if (set.vendor === "cisco") return { kind: "error", output: "% Incomplete command." };
    const expecting = nextOptions(set, step.candidates, tokens.length, "").map((o) => `  ${o.label}`);
    return { kind: "error", output: `${caretLine(set.prompt, line.trimEnd().length + 1)}\nsyntax error, expecting:\n${expecting.join("\n")}` };
  }
  try {
    const result = match.cmd.run(match.args);
    return { kind: "ok", commandId: match.cmd.id, output: result.output, explanation: result.explanation, refused: result.refused };
  } catch {
    return { kind: "error", output: set.vendor === "cisco" ? "% Command failed in the simulator." : "error: command failed in the simulator." };
  }
}
