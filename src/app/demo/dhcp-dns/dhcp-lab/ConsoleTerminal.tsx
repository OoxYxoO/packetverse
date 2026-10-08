"use client";

import { clsx } from "clsx";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CliCommandSet, CliVendor } from "@/lib/cli/types";
import { completeCli, contextHelp, executeCli } from "@/lib/cli/parser";
import { NanoEditor, type EditorSpec } from "./NanoEditor";
import { applyPipes, pipeComplete, pipeHelp, splitPipes, type PipeCtx, type PipeOs } from "./cliPipes";
import type { CliQuestion } from "./dhcpBuildCli";

/**
 * A console session, the way an engineer meets a device through a terminal program: one surface, a prompt, a
 * blinking cursor, typing inline, output underneath, the next prompt. Click anywhere in it and type. ↑/↓ history,
 * Tab completion, `?` context help answered instantly with the line kept (IOS/Junos keyword help; on host shells,
 * the commands that fit what is typed),
 * Ctrl+C abandons the line, Ctrl+L clears the screen. Errors are the device's own: Cisco caret markers, Junos syntax
 * errors, bash "command not found", Windows "is not recognized".
 */

export type ConsoleOs = "ios" | "junos" | "linux" | "windows";
export interface ConsoleLine {
  kind: "in" | "out" | "err" | "note" | "sys";
  text: string;
  prompt?: string;
}
export interface ConsoleSession {
  lines: ConsoleLine[];
  history: string[];
  /** A file open in nano (kept with the session, so it survives switching tabs or minimizing the window). */
  edit?: { id: string; text: string; orig: string };
}
export const EMPTY_SESSION: ConsoleSession = { lines: [], history: [] };

const BANNER: Record<ConsoleOs, (host: string) => string[]> = {
  ios: (h) => [`Connected to ${h} (console, 9600 8N1).`, "", `${h} con0 is now available`, "", "Press RETURN to get started.", ""],
  junos: (h) => [`Connected to ${h} (console, 9600 8N1).`, "", `--- JUNOS ${h} console ---`, ""],
  linux: (h) => [`Connected to ${h.toLowerCase()} (ssh admin@${h.toLowerCase()}).`, "Welcome to Ubuntu 22.04 LTS (GNU/Linux x86_64)", ""],
  windows: () => ["Microsoft Windows [Version 10.0.22631]", "(c) Microsoft Corporation. All rights reserved.", ""],
};

/** Host shells word their errors like the host, not like a router. */
function hostError(os: ConsoleOs, set: CliCommandSet, line: string): string | undefined {
  if (os !== "linux" && os !== "windows") return undefined;
  const first = line.trim().split(/\s+/)[0];
  const known = set.commands.some((c) => c.syntax.split(" ")[0].toLowerCase() === first.toLowerCase());
  const arg = line.trim().split(/\s+/)[1];
  // sudo runs the next word: the complaint comes from that command, not from sudo.
  if (os === "linux" && first === "sudo" && known && arg) return `${arg}: invalid option or argument (try: help)`;
  if (os === "linux") return !known ? `${first}: command not found` : first === "cat" && arg ? `cat: ${arg}: No such file or directory` : `${first}: invalid option or argument (try: help)`;
  return known ? "The syntax of the command is incorrect." : `'${first}' is not recognized as an internal or external command,\noperable program or batch file.`;
}

/**
 * `?` on a host shell (the servers' bash, the laptop's cmd.exe). Shells have no IOS-style keyword help, so this lists
 * the whole commands this terminal really supports that fit what is typed so far, each with what it is for, and the
 * values the next argument can take. Nothing is invented: it reads the same command set that Enter runs.
 */
function hostHelp(set: CliCommandSet, line: string, host: string, cols: number): ConsoleLine {
  const typed = line.trimStart();
  const words = typed.split(/\s+/).filter(Boolean);
  const partial = typed === "" || /\s$/.test(typed) ? "" : words.pop()!;
  const isArg = (t: string) => /^<.+>$/.test(t);
  // Exact-case keywords (iptables -D INPUT …) are stored as one-choice arguments named after the word ("-D#2"):
  // show them as the word itself, never as a placeholder.
  const literal = (cmd: CliCommandSet["commands"][number], t: string) => {
    if (!isArg(t)) return undefined;
    const name = t.slice(1, -1);
    const ch = cmd.args?.[name]?.choices;
    return ch?.length === 1 && (name === ch[0] || name.startsWith(`${ch[0]}#`)) ? ch[0] : undefined;
  };
  const shown = (cmd: CliCommandSet["commands"][number]) => cmd.syntax.split(" ").map((t) => literal(cmd, t) ?? t).join(" ");
  // A typed word fits a keyword (any case), an exact-case keyword (exactly), or any value an argument accepts.
  const fits = (t: string, w: string, cmd: CliCommandSet["commands"][number]) => {
    const lit = literal(cmd, t);
    if (lit) return lit === w;
    return isArg(t) ? (cmd.args?.[t.slice(1, -1)]?.resolve(w) ?? w) !== undefined : t.toLowerCase() === w.toLowerCase();
  };
  const rows: { syntax: string; summary: string; next?: string }[] = [];
  for (const c of set.commands) {
    if (c.hidden) continue;
    const toks = c.syntax.split(" ");
    if (toks.length < words.length + (partial ? 1 : 0) || !words.every((w, i) => fits(toks[i], w, c))) continue;
    const t = toks[words.length];
    const lit = literal(c, t);
    if (partial && !(lit ? lit.startsWith(partial) : isArg(t) || t.toLowerCase().startsWith(partial.toLowerCase()))) continue;
    // What the argument being typed (or the next one) can be, when the command offers a list.
    const at = toks[words.length] && isArg(toks[words.length]) && !literal(c, toks[words.length]) ? toks[words.length] : undefined;
    const choices = at ? c.args?.[at.slice(1, -1)]?.choices : undefined;
    rows.push({ syntax: shown(c), summary: c.summary, next: at ? (choices?.length ? `${at}: ${choices.join(", ")}` : `${at}: type a value`) : undefined });
  }
  const builtins = typed === "" || "help".startsWith(typed) || "clear".startsWith(typed) ? [{ syntax: "help", summary: "Everything this terminal supports, and how to use it" }, { syntax: "clear", summary: "Clear the screen" }].filter((b) => b.syntax.startsWith(typed.trim())) : [];
  const all = [...rows, ...builtins];
  if (!all.length) return { kind: "err", text: `Nothing available on ${host.toLowerCase()} starts with “${typed.trim()}”. Press ? on an empty line to list the commands here.` };
  const width = Math.min(46, Math.max(...all.map((r) => r.syntax.length))) + 3;
  // Too narrow for two columns (a phone): each command on its own line, what it does indented under it.
  if (width + 24 > cols) return { kind: "out", text: [typed === "" ? `Commands available on ${host.toLowerCase()}:` : `Matching “${typed.trim()}”:`, ...all.flatMap((r) => [`  ${r.syntax}`, `      ${r.summary}`, ...("next" in r && r.next ? [`      ${r.next}`] : [])])].join("\n") };
  // A command longer than the column gets its description on the next line, like man-page option lists.
  const body = all.flatMap((r) => [...(r.syntax.length >= width ? [`  ${r.syntax}`, `  ${"".padEnd(width)}${r.summary}`] : [`  ${r.syntax.padEnd(width)}${r.summary}`]), ...("next" in r && r.next ? [`  ${"".padEnd(width)}${r.next}`] : [])]);
  const head = typed === "" ? `Commands available on ${host.toLowerCase()} (Tab completes · Enter runs):` : `Matching “${typed.trim()}”:`;
  return { kind: "out", text: [head, ...body].join("\n") };
}

export function ConsoleTerminal({
  sets,
  vendor,
  setVendor,
  os,
  host,
  session,
  setSession,
  onExecuted,
  notes,
  setNotes,
  editor,
  question,
  pipeCtx,
  className,
}: {
  sets: Partial<Record<CliVendor, CliCommandSet>>;
  vendor: CliVendor;
  setVendor?: (v: CliVendor) => void;
  os: ConsoleOs;
  host: string;
  session: ConsoleSession;
  setSession: (u: (s: ConsoleSession) => ConsoleSession) => void;
  onExecuted?: (commandId: string, ok: boolean, line: string) => void;
  notes: boolean;
  setNotes: (b: boolean) => void;
  /** Commands that open a file in the terminal's editor (e.g. sudo nano /etc/dhcp/dhcpd.conf). */
  editor?: (commandId: string) => EditorSpec | undefined;
  /** The device is asking something ("Destination filename [startup-config]?"): the next line answers it. */
  question?: CliQuestion;
  /** What the pipes need to know about this device (Junos: its configurations, for compare). */
  pipeCtx?: Pick<PipeCtx, "config" | "rollbacks">;
  className?: string;
}) {
  const set = sets[vendor] ?? Object.values(sets)[0]!;
  const input = useRef<HTMLInputElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  const [line, setLine] = useState("");
  const [caret, setCaret] = useState(0);
  const [hIdx, setHIdx] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  const network = os === "ios" || os === "junos";
  // Junos shows where you are in the hierarchy above the configuration-mode prompt.
  const editMode = os === "junos" && set.prompt.trim().endsWith("#");
  const prompt = question?.prompt ?? (editMode ? `[edit]\n${set.prompt}` : set.prompt);
  // Network OSes take output modifiers after a | (include/section… on IOS; match/display set/compare… on Junos).
  const pos: PipeOs | undefined = os === "ios" ? "ios" : os === "junos" ? "junos" : undefined;
  const ctxFor = (left: string): PipeCtx => ({ os: pos!, left, edit: editMode, ...pipeCtx });
  const isShow = (l: string) => /^\s*((do|run)\s+)?show\b/i.test(l);
  const lines = session.lines.length ? session.lines : BANNER[os](host).map((t) => ({ kind: "sys" as const, text: t }));
  // Scroll-follow, like a terminal program: the view sticks to the bottom (the live prompt) unless the reader has
  // scrolled up into the scrollback. Typing, Enter, Tab, ?, history and Ctrl+C bring the prompt back into view.
  const body = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [away, setAway] = useState(false);
  const toBottom = useCallback(() => {
    const el = screen.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);
  const resume = () => {
    follow.current = true;
    setAway(false);
    toBottom();
  };
  // After every render (new output, the line being typed, a prompt change): stay on the prompt if following.
  useLayoutEffect(() => {
    if (follow.current) toBottom();
  });
  // Resizes (window resize, a device window dragged larger, the phone keyboard opening, text re-wrapping) too.
  useEffect(() => {
    const el = screen.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => follow.current && toBottom());
    ro.observe(el);
    if (body.current) ro.observe(body.current);
    return () => ro.disconnect();
  }, [toBottom]);
  const onScroll = () => {
    const el = screen.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 6;
    follow.current = atBottom;
    setAway(!atBottom);
  };
  const push = (add: ConsoleLine[], keep = true) =>
    setSession((s) => ({
      ...s,
      lines: [...(s.lines.length || !keep ? s.lines : BANNER[os](host).map((t) => ({ kind: "sys" as const, text: t }))), ...add].slice(-400),
    }));
  const setInput = (v: string, c = v.length) => {
    setLine(v);
    setCaret(c);
    requestAnimationFrame(() => input.current?.setSelectionRange(c, c));
  };
  const run = () => {
    const typed = line;
    const echo: ConsoleLine = { kind: "in", prompt, text: typed };
    if (question) {
      // An answer to the device's question, not a command: no history, no parsing.
      setInput("");
      const a = question.answer(typed);
      return push([echo, ...(a.output ? [{ kind: a.refused ? "err" : "out", text: a.output } as ConsoleLine] : []), ...(notes && a.explanation ? [{ kind: "note" as const, text: a.explanation }] : [])]);
    }
    const sp = pos ? splitPipes(pos, typed) : undefined;
    const piped = !!sp && sp.pipes.length > 0;
    if (typed.trim())
      setSession((s) => ({
        ...s,
        // Like bash (ignoredups) and IOS: an immediate repeat is stored once; earlier occurrences stay where they were.
        history: (s.history.at(-1) === typed ? s.history : [...s.history, typed]).slice(-60),
      }));
    setHIdx(null);
    setInput("");
    if (piped && !isShow(sp!.cmd)) {
      // Output modifiers belong to show commands; anywhere else the | is a syntax error at that position, and the
      // command before it does not run.
      const caret = `${" ".repeat(set.prompt.length + sp!.at)}^`;
      return push([echo, { kind: "err", text: pos === "ios" ? `${caret}\n% Invalid input detected at '^' marker.` : `${caret}\nsyntax error, expecting <command>.` }]);
    }
    const r = executeCli(set, piped ? sp!.cmd : typed);
    if (r.kind === "clear") return setSession((s) => ({ ...s, lines: [{ kind: "sys", text: "" }] }));
    if (r.kind === "empty") return push([echo]);
    if (r.kind === "help") return push([echo, { kind: "out", text: r.output }]);
    if (r.kind === "error") return push([echo, { kind: "err", text: hostError(os, set, typed) ?? r.output }]);
    onExecuted?.(r.commandId, !r.refused, typed.trim());
    if (piped && !r.refused) {
      const f = applyPipes(r.output, sp!.pipes, ctxFor(sp!.cmd));
      if ("error" in f) return push([echo, { kind: "err", text: f.error }]);
      return push([echo, ...(f.output ? [{ kind: "out" as const, text: f.output }] : [])]);
    }
    const spec = !r.refused ? editor?.(r.commandId) : undefined;
    if (spec) {
      // nano takes over the screen; the session continues underneath and comes back when it exits.
      push([echo]);
      return setSession((s) => ({ ...s, edit: { id: r.commandId, text: spec.text, orig: spec.text } }));
    }
    push([echo, ...(r.output ? [{ kind: r.refused ? "err" : "out", text: r.output } as ConsoleLine] : []), ...(notes && r.explanation ? [{ kind: "note" as const, text: r.explanation }] : [])]);
  };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Any key aimed at the prompt (not a modifier on its own, not a copy shortcut) returns the view to the prompt.
    if (!["Shift", "Control", "Alt", "Meta", "PageUp", "PageDown"].includes(e.key) && !((e.ctrlKey || e.metaKey) && (e.key === "c" || e.key === "C") && window.getSelection()?.toString())) resume();
    if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      const el = screen.current;
      if (el) el.scrollTop += (e.key === "PageUp" ? -1 : 1) * (el.clientHeight - 24);
      return;
    }
    if (e.key === "Enter") return (e.preventDefault(), run());
    if (e.key === "Tab") {
      e.preventDefault();
      if (question) return;
      if (pos && splitPipes(pos, line).pipes.length) {
        const pc = pipeComplete(pos, line);
        if (pc.extended) setInput(pc.line);
        else if (pc.options.length)
          push([
            { kind: "in", prompt, text: line },
            { kind: "out", text: pc.options.join("   ") },
          ]);
        return;
      }
      const c = completeCli(set, line);
      if (c.extended) setInput(c.line);
      else if (c.options.length)
        push([
          { kind: "in", prompt, text: line },
          { kind: "out", text: c.options.map((o) => o.label).join("   ") },
        ]);
      return;
    }
    if (e.key === "?") {
      e.preventDefault();
      if (question) return;
      let help: ConsoleLine;
      if (pos && splitPipes(pos, line).pipes.length) help = { kind: "out", text: pipeHelp(pos, line, ctxFor(splitPipes(pos, line).cmd)) };
      else if (network) {
        let t = contextHelp(set, line);
        // A complete show command can also take output modifiers: say so, as the real CLI does.
        if (isShow(line) && /<cr>|<\[Enter\]>/.test(t)) t += pos === "ios" ? `\n  ${"|".padEnd(20)}Output modifiers` : `\n  ${"|".padEnd(20)}Pipe through a command`;
        help = { kind: "out", text: t };
      } else help = hostHelp(set, line, host, Math.floor((screen.current?.clientWidth ?? 640) / 7.3));
      return push([{ kind: "in", prompt, text: `${line}?` }, help]);
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const h = session.history;
      if (!h.length) return;
      const i = e.key === "ArrowUp" ? (hIdx === null ? h.length - 1 : Math.max(0, hIdx - 1)) : hIdx === null ? null : hIdx + 1 >= h.length ? null : hIdx + 1;
      setHIdx(i);
      return setInput(i === null ? "" : h[i]);
    }
    if (e.ctrlKey && (e.key === "c" || e.key === "C")) {
      e.preventDefault();
      const msg = question?.cancel?.();
      push([{ kind: "in", prompt, text: `${line}^C` }, ...(msg ? [{ kind: "err" as const, text: msg }] : [])]);
      return setInput("");
    }
    if (e.ctrlKey && (e.key === "l" || e.key === "L")) return (e.preventDefault(), setSession((s) => ({ ...s, lines: [{ kind: "sys", text: "" }] })));
  };
  const edit = session.edit;
  const editing = edit ? editor?.(edit.id) : undefined;
  const closeEditor = () => setSession((s) => ({ ...s, edit: undefined }));
  // When nano exits, the keyboard goes back to the prompt (as the real terminal gives the screen back to the shell).
  const wasEditing = useRef(!!edit);
  useEffect(() => {
    if (wasEditing.current && !edit) input.current?.focus({ preventScroll: true });
    wasEditing.current = !!edit;
  }, [edit]);
  const before = line.slice(0, caret);
  const at = line.slice(caret, caret + 1) || " ";
  const after = line.slice(caret + 1);
  return (
    <div className={clsx("flex min-h-0 flex-col overflow-hidden rounded-lg border border-[#1f2a37] bg-[#0b0f14]", className)}>
      <div className="flex items-center gap-2 border-b border-[#1f2a37] bg-[#111821] px-2 py-1 text-[11px]">
        <span className="h-2 w-2 rounded-full bg-pv-success" aria-hidden />
        <span className="pv-mono text-[#c8d3df]">
          {host} · {os === "ios" ? "Cisco IOS" : os === "junos" ? "Junos" : os === "linux" ? "bash" : "cmd.exe"}
        </span>
        {setVendor && Object.keys(sets).length > 1 && (
          <span className="ml-1 flex gap-0.5 rounded border border-[#1f2a37] p-0.5" role="radiogroup" aria-label="Operating system view">
            {(["cisco", "juniper"] as CliVendor[]).map((v) => (
              <button key={v} type="button" role="radio" aria-checked={vendor === v} onClick={() => setVendor(v)} className={clsx("rounded px-1.5", vendor === v ? "bg-[#1f2a37] text-white" : "text-[#7d8a99] hover:text-white")}>
                {v === "cisco" ? "IOS" : "Junos"}
              </button>
            ))}
          </span>
        )}
        <button type="button" aria-pressed={notes} onClick={() => setNotes(!notes)} className="ml-auto rounded px-1.5 text-[#7d8a99] hover:text-white" title="Short explanations under command output">
          notes {notes ? "on" : "off"}
        </button>
      </div>
      {edit && editing && (
        <NanoEditor
          spec={editing}
          buffer={edit.text}
          orig={edit.orig}
          setBuffer={(t) => setSession((s) => (s.edit ? { ...s, edit: { ...s.edit, text: t } } : s))}
          setOrig={(t) => setSession((s) => (s.edit ? { ...s, edit: { ...s.edit, orig: t } } : s))}
          onExit={closeEditor}
          className="h-[min(24rem,58vh)]"
        />
      )}
      <div
        ref={screen}
        hidden={!!(edit && editing)}
        role="log"
        aria-label={`${host} console`}
        data-console={host}
        onMouseUp={() => {
          // Clicking only focuses; it never moves the view (you may be reading the scrollback). Typing does.
          if (!window.getSelection()?.toString()) input.current?.focus({ preventScroll: true });
        }}
        onScroll={onScroll}
        className="relative h-[min(24rem,58vh)] cursor-text overflow-y-auto px-2.5 py-2 pv-mono text-[12px] leading-[1.45] text-[#d6dee7]"
      >
        <div ref={body}>
          {lines.map((l, i) => (
            <div key={i} className={clsx("whitespace-pre-wrap break-words", l.kind === "err" && "text-[#ff8a80]", l.kind === "note" && "italic text-[#7fb8d6]", l.kind === "sys" && "text-[#8b98a8]")}>
              {l.kind === "in" ? (
                <>
                  <span className="text-[#9be3a7]">{l.prompt}</span>
                  {l.text}
                </>
              ) : l.kind === "note" ? (
                `  ↳ ${l.text}`
              ) : (
                l.text
              )}
            </div>
          ))}
          {/* The live line. The (invisible) input sits on it, so whatever the browser scrolls into view is the prompt. */}
          <div className="relative whitespace-pre-wrap break-words" data-live-line>
            <span className="text-[#9be3a7]">{prompt}</span>
            {before}
            <span className={clsx(focused ? "pv-console-caret bg-[#d6dee7] text-[#0b0f14]" : "outline outline-1 outline-[#d6dee7]/60")}>{at}</span>
            {after}
            <input
              ref={input}
              value={line}
              onChange={(e) => {
                resume();
                const v = e.target.value.replace(/[\r\n]+/g, " ");
                setLine(v);
                setCaret(e.target.selectionStart ?? v.length);
              }}
              onSelect={(e) => setCaret((e.target as HTMLInputElement).selectionStart ?? line.length)}
              onKeyDown={onKey}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              aria-label={`Type a command on ${host}`}
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              className="absolute bottom-0 left-0 h-px w-px opacity-0"
            />
          </div>
          {!focused && !session.lines.length && <div className="mt-1 text-[11px] text-[#5d6b7a]">(click here and type)</div>}
        </div>
      </div>
      {away && (
        <button
          type="button"
          onClick={() => (resume(), input.current?.focus({ preventScroll: true }))}
          className="relative z-10 -mt-8 mb-1.5 mr-3 self-end rounded-full border border-[#1f2a37] bg-[#111821]/95 px-2.5 py-0.5 text-[11px] text-[#c8d3df] shadow hover:text-white"
        >
          ↓ Back to the prompt
        </button>
      )}
      <style>{`.pv-console-caret{animation:pvcaret 1.05s steps(1) infinite}@keyframes pvcaret{50%{background:transparent;color:inherit}}`}</style>
    </div>
  );
}
