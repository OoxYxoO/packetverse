import type { ReactNode } from "react";
import type { TopoView } from "@/components/presentation/Visuals";
import type { CliVendor } from "@/lib/cli/types";

/**
 * Service Provider lab kit — the generic contract between the shared SP practice-lab workspace and one lesson.
 *
 * The kit knows nothing about IS-IS, MPLS, BGP or VPNs. A lesson supplies its own model (configuration, derived
 * protocol state, runs made of moments), its topology, device windows, tools, Learn levels, challenges and tickets;
 * the workspace only plays runs, hosts windows and walks the student through Learn → Engineering workspace.
 */

export type SpTone = "ok" | "bad" | "learn" | "info" | "warn";
export interface SpLine {
  text: string;
  tone?: SpTone;
}
/** One message travelling over one link during a moment (a hello, an LSP, a labeled packet…). */
export interface SpTok {
  from: string;
  to: string;
  label: string;
  color?: string;
  /** Stays at the receiver (just before it) after arriving — e.g. a packet that was dropped there. */
  stay?: boolean;
  delay?: number;
  /** Small perpendicular offset, so two messages on one link in opposite directions don't overlap. */
  lane?: number;
}
/** One step of a run: what moved, what each device decided, and (optionally) the tables as they were afterwards. */
export interface SpMoment<Snap = unknown> {
  tokens: SpTok[];
  lines: SpLine[];
  views?: Record<string, TopoView>;
  /** Links drawn as active during this moment. */
  hot?: string[];
  /** Links drawn as failing during this moment. */
  bad?: string[];
  snap?: Snap;
}
export interface SpRun<Snap = unknown> {
  id: number;
  cmd: string;
  kind: string;
  moments: SpMoment<Snap>[];
  ok?: boolean;
}
export interface SpLog {
  seq: number;
  t: number;
  text: string;
  tone?: "info" | "warn" | "ok";
  dev?: string;
}
/** What every SP lab state carries (the lesson's state extends it). */
export interface SpBase<Snap = unknown> {
  seq: number;
  cfgSeq: number;
  clock: number;
  runs: SpRun<Snap>[];
  last?: SpRun<Snap>;
  log: SpLog[];
  ticket?: string;
}

// ---------------------------------------------------------------------------------------------------------------
// Learn, practice, troubleshoot
// ---------------------------------------------------------------------------------------------------------------
export interface SpStep<A> {
  title: string;
  body: ReactNode;
  /** Actions applied to a fresh network when the step is entered. */
  pre?: A[];
  runs?: { label: string; actions: A[]; keep?: boolean }[];
  /** Evidence blocks shown under the step (lesson-defined keys). */
  show: string[];
  check?: { q: string; options: { id: string; label: string }[]; answer: string; why: string };
}
export interface SpLevel<A> {
  n: number;
  title: string;
  idea: string;
  steps: SpStep<A>[];
}
export interface SpChallenge<S> {
  id: string;
  title: string;
  how: string;
  done: (s: S) => boolean;
  /** What is still missing, read from the network (shown once the student has done something). */
  next: (s: S) => string;
}
export interface SpTicket<A> {
  id: string;
  title: string;
  report: string;
  reproLabel: string;
  repro: A[];
}
export interface SpCause {
  id: string;
  label: string;
}
export interface SpFeedback {
  right: boolean;
  consequence?: boolean;
  text: string;
}
export interface SpProof {
  label: string;
  ok: boolean;
  detail: string;
}
export interface SpRung {
  k: string;
  title: string;
  text: string;
}

// ---------------------------------------------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------------------------------------------
export const spClone = <T>(c: T): T => JSON.parse(JSON.stringify(c)) as T;
/** The lab clock as both OSes print it in logs (the lab starts at 09:00:00 on Oct 11). */
export function spStamp(clock: number) {
  const t = 9 * 3600 + clock;
  const hh = String(Math.floor(t / 3600) % 24).padStart(2, "0");
  const mm = String(Math.floor(t / 60) % 60).padStart(2, "0");
  const ss = String(Math.floor(t) % 60).padStart(2, "0");
  return { xr: `Oct 11 ${hh}:${mm}:${ss}.000 UTC`, junos: `Oct 11 ${hh}:${mm}:${ss}`, hms: `${hh}:${mm}:${ss}` };
}
/** Uptime-style age ("00:04:12") of something that started at `since` on the lab clock. */
export function spAge(clock: number, since: number) {
  const d = Math.max(0, clock - since);
  return `${String(Math.floor(d / 3600)).padStart(2, "0")}:${String(Math.floor(d / 60) % 60).padStart(2, "0")}:${String(d % 60).padStart(2, "0")}`;
}
export const pad = (s: string | number, n: number) => String(s).padEnd(n);
export const lpad = (s: string | number, n: number) => String(s).padStart(n);

/** One Junos statement: its container path (each element one hierarchy level, e.g. "interface ge-0/0/0.0") and leaf. */
export interface JStmt {
  path: string[];
  /** Empty for a container that exists with nothing inside (e.g. "family iso"). */
  leaf: string;
}
export const jSet = (s: JStmt) => [...s.path, s.leaf].filter(Boolean).join(" ");
/**
 * Junos configuration text from statements: the curly-brace hierarchy Junos prints, optionally only the part under
 * `path` (the words typed after `show configuration`, e.g. ["protocols", "isis"]).
 */
export function junosCurly(stmts: JStmt[], path: string[] = []): string {
  type Node = { name: string; kids: Node[]; leaves: string[] };
  const root: Node = { name: "", kids: [], leaves: [] };
  const want = path.join(" ");
  for (const st of stmts) {
    // Match the typed path against the statement's words (a typed path may cut a multi-word level in half).
    const words = jSet(st);
    if (want && !(words === want || words.startsWith(`${want} `))) continue;
    let consumed = want ? want.split(" ").length : 0;
    const levels: string[] = [];
    for (const lvl of st.path) {
      const n = lvl.split(" ").length;
      if (consumed >= n) {
        consumed -= n;
        continue;
      }
      levels.push(lvl.split(" ").slice(consumed).join(" "));
      consumed = 0;
    }
    let leaf = st.leaf;
    if (consumed > 0) leaf = leaf.split(" ").slice(consumed).join(" ");
    let n = root;
    for (const part of levels) {
      let k = n.kids.find((x) => x.name === part);
      if (!k) n.kids.push((k = { name: part, kids: [], leaves: [] }));
      n = k;
    }
    if (leaf && !n.leaves.includes(leaf)) n.leaves.push(leaf);
  }
  const out: string[] = [];
  const walk = (n: Node, ind: string) => {
    // Junos prints a policy's "then" after its terms and a term's "then" after "from", and policy-options'
    // communities after its policy-statements, and a BGP group's cluster and neighbors after its family blocks;
    // every other leaf comes first.
    const isThen = (x: string) => x.startsWith("then ");
    const isComm = (x: string) => /^community \S+ members /.test(x);
    const isLate = (x: string) => isThen(x) || isComm(x) || (/^group /.test(n.name) && /^(cluster|neighbor) /.test(x));
    for (const l of n.leaves) if (!isLate(l)) out.push(`${ind}${l};`);
    for (const k of [...n.kids.filter((x) => !isThen(x.name)), ...n.kids.filter((x) => isThen(x.name))]) {
      // An empty container prints as a statement ("family iso;"), as Junos does.
      if (!k.kids.length && !k.leaves.length) {
        out.push(`${ind}${k.name};`);
        continue;
      }
      out.push(`${ind}${k.name} {`);
      walk(k, `${ind}    `);
      out.push(`${ind}}`);
    }
    for (const l of n.leaves) if (isLate(l)) out.push(`${ind}${l};`);
  };
  walk(root, "");
  return out.join("\n");
}

/** IOS XR running-config sections: top-level blocks separated by "!" lines. */
export function xrSections(lines: string[]): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  for (const l of lines) {
    if (l === "!") {
      if (cur.length) out.push(cur);
      cur = [];
    } else cur.push(l);
  }
  if (cur.length) out.push(cur);
  return out;
}
/** Each configuration line with the chain of parent lines above it (by indentation), so equal lines in different blocks differ. */
function xrPaths(lines: string[]): { key: string; line: string; anc: string[] }[] {
  const stack: { d: number; line: string }[] = [];
  const out: { key: string; line: string; anc: string[] }[] = [];
  for (const line of lines) {
    if (line.trim() === "!" || line.trim() === "") continue;
    const d = line.length - line.trimStart().length;
    while (stack.length && stack[stack.length - 1].d >= d) stack.pop();
    const anc = stack.map((x) => x.line);
    out.push({ key: [...anc, line].join("\u0000"), line, anc });
    stack.push({ d, line });
  }
  return out;
}
/** `show commit changes diff`: only the changed lines, under the parent lines that lead to them, XR-style +/- markers. */
export function xrDiff(running: string[], cand: string[]): string {
  const a = xrPaths(running);
  const b = xrPaths(cand);
  const ka = new Set(a.map((x) => x.key));
  const kb = new Set(b.map((x) => x.key));
  const out: string[] = [];
  const printed = new Set<string>();
  const emit = (anc: string[], line: string, mark: "+" | "-") => {
    anc.forEach((p, i) => {
      const k = anc.slice(0, i + 1).join("\u0000");
      if (!printed.has(k)) {
        printed.add(k);
        out.push(`  ${p}`);
      }
    });
    out.push(`${mark} ${line}`);
  };
  for (const x of b) if (!ka.has(x.key)) emit(x.anc, x.line, "+");
  for (const x of a) if (!kb.has(x.key)) emit(x.anc, x.line, "-");
  return out.join("\n");
}
/**
 * `show configuration` inside XR config mode: only what this session changes (the target configuration's delta),
 * each change under the parent lines that lead to it — added lines as typed, removed lines as `no …` (a removed
 * parent hides its removed children).
 */
export function xrPending(running: string[], cand: string[]): string {
  const a = xrPaths(running);
  const b = xrPaths(cand);
  const ka = new Set(a.map((x) => x.key));
  const kb = new Set(b.map((x) => x.key));
  const head = (l: string) => l.trim().split(/\s+/).slice(0, -1).join(" ");
  const isLeaf = (x: { key: string }, all: { anc: string[] }[]) => !all.some((y) => y.anc.join("\u0000").startsWith(x.key));
  // A single-valued leaf given a new value ("encapsulation dot1q 200" → "100") is a replacement, not a removal. A
  // neighbor's pw-id is part of its identity: changing it removes one pseudowire and adds another.
  const replaced = (x: { key: string; line: string; anc: string[] }) => isLeaf(x, a) && /^[a-z]/i.test(head(x.line)) && !/^neighbor /.test(x.line.trim()) && b.some((y) => !ka.has(y.key) && y.anc.join("\u0000") === x.anc.join("\u0000") && head(y.line) === head(x.line) && isLeaf(y, b));
  const gone = a.filter((x) => !kb.has(x.key) && !replaced(x));
  const goneKeys = new Set(gone.map((x) => x.key));
  const changes = [
    ...b.filter((x) => !ka.has(x.key)).map((x) => ({ anc: x.anc, line: x.line })),
    ...gone.filter((x) => !x.anc.some((_, i) => goneKeys.has(x.anc.slice(0, i + 1).join("\u0000")))).map((x) => ({ anc: x.anc, line: `${x.line.slice(0, x.line.length - x.line.trimStart().length)}no ${x.line.trimStart()}` })),
  ];
  const out: string[] = [];
  const printed = new Set<string>();
  let top: string | undefined;
  for (const c of changes) {
    const root = c.anc[0] ?? c.line;
    if (top !== undefined && root !== top) out.push("!");
    top = root;
    c.anc.forEach((p, i) => {
      const k = c.anc.slice(0, i + 1).join("\u0000");
      if (!printed.has(k)) {
        printed.add(k);
        out.push(p);
      }
    });
    // An added line can also be the parent of later added lines: print it once.
    const own = [...c.anc, c.line].join("\u0000");
    if (!printed.has(own)) out.push(c.line);
    printed.add(own);
  }
  if (out.length) out.push("!");
  return ["Building configuration...", "!! IOS XR Configuration 7.9.2", ...out, "end"].join("\n");
}

export type SpVendor = CliVendor;
