"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { clsx } from "clsx";
import { completeCli, contextHelp, executeCli, formatOptions } from "@/lib/cli/parser";
import { CLI_VENDOR_LABEL, type CliCommandSet, type CliVendor } from "@/lib/cli/types";

type Entry =
  | { id: number; kind: "note"; text: string }
  | { id: number; kind: "command"; prompt: string; text: string; output?: string; explanation?: string; tone: "ok" | "error" | "refused" | "help" };

/**
 * One console = one vendor × device. Everything a learner would expect a
 * separate console to keep separately lives here: transcript, history,
 * history cursor, draft input, temporary Tab/`?` output, and the network
 * revision its last command saw (for the stale-output hint).
 */
export interface CliSession {
  /** Frozen "Connected to …" line, written once when the session is first used. */
  welcome?: string;
  entries: Entry[];
  nextId: number;
  history: string[];
  historyIndex: number | null;
  /** Text typed before ↑ started browsing history. */
  draft: string;
  input: string;
  /** Temporary Tab/`?` output under the input — never part of the transcript. */
  assist?: string;
  /** `stateVersion` when this session last executed a command. */
  lastRunVersion?: number | string;
}

/** Sessions keyed by `cliSessionKey(vendor, deviceName)`. Each surface (ARP Lab, guided lesson, …) owns its own map — there is no global CLI state. */
export type CliSessionMap = Record<string, CliSession>;

export const cliSessionKey = (vendor: CliVendor, deviceName: string) => `${vendor}:${deviceName}`;

const blankSession = (welcome?: string): CliSession => ({ welcome, entries: [], nextId: 0, history: [], historyIndex: null, draft: "", input: "" });

/** Put text into one session's input without running it (e.g. a "Put in terminal" hint). */
export function withSessionInput(map: CliSessionMap, key: string, text: string): CliSessionMap {
  const s = map[key] ?? blankSession();
  return { ...map, [key]: { ...s, input: text, historyIndex: null, assist: undefined } };
}

export interface CliExecutedEvent {
  vendor: CliVendor;
  deviceId: string;
  commandId: string;
}

interface CLITerminalProps {
  /** One command set per vendor for the SAME device + snapshot — built by a lesson adapter, never by this component. */
  commandSets: Partial<Record<CliVendor, CliCommandSet>>;
  vendor: CliVendor;
  onVendorChange: (vendor: CliVendor) => void;
  /**
   * Lifted session map (optional). Pass it when sessions must survive this
   * component unmounting (e.g. a tab that remounts) or be reset/filled by
   * the parent; otherwise the terminal keeps its own map.
   */
  sessions?: CliSessionMap;
  onSessionsChange?: (update: (prev: CliSessionMap) => CliSessionMap) => void;
  /** Human device role shown next to the hostname ("Access Switch"). */
  deviceRole?: string;
  /** What snapshot the commands read ("ARP Lab · T1 ARP Request") — used in a session's first "Connected to …" line. */
  contextLabel?: string;
  /** Extra header badge (e.g. "Historical snapshot"). */
  badge?: ReactNode;
  footer?: ReactNode;
  onExecuted?: (e: CliExecutedEvent) => void;
  /** Bump to move keyboard focus into the input (e.g. after a parent filled it). */
  focusRequest?: number;
  /**
   * Network revision. Old output is never rewritten: a session whose last
   * command ran at an older revision shows `staleHint` until it queries again.
   * Sessions that never ran anything are never marked stale.
   */
  stateVersion?: number | string;
  staleHint?: string;
  className?: string;
  /** For hosts (e.g. "Linux shell"): hides the network-OS vendor selector and labels the session with this instead. */
  shellLabel?: string;
}

const VENDORS: CliVendor[] = ["cisco", "juniper"];
const VENDOR_SHORT: Record<CliVendor, string> = { cisco: "IOS", juniper: "Junos" };

/**
 * Interactive, read-only CLI terminal (generic — reused by any lesson).
 * It owns only terminal concerns: vendor selector, prompt, input, history
 * (↑/↓), Tab completion, `?` help, clear/cls and transcript rendering —
 * separately per vendor × device session. What a command prints comes
 * entirely from the supplied CliCommandSet (the lesson's network state,
 * which all sessions share).
 */
export function CLITerminal({ commandSets, vendor, onVendorChange, sessions: lifted, onSessionsChange, deviceRole, contextLabel, badge, footer, onExecuted, focusRequest, stateVersion, staleHint = "Network state changed — rerun a command to inspect it.", className, shellLabel }: CLITerminalProps) {
  const set = commandSets[vendor];
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const [own, setOwn] = useState<CliSessionMap>({});
  const sessions = lifted ?? own;
  const setSessions = onSessionsChange ?? setOwn;
  const [showExplanations, setShowExplanations] = useState(true);
  /** Esc arms one un-intercepted Tab so keyboard users can always leave the input. */
  const [tabRelease, setTabRelease] = useState(false);

  const key = cliSessionKey(vendor, set?.deviceName ?? "device");
  const welcomeNow = `Connected to ${set?.deviceName ?? "device"} · ${shellLabel ?? CLI_VENDOR_LABEL[vendor]}${contextLabel ? ` · ${contextLabel}` : ""}. Press ? for context help and Tab to complete.`;
  // An untouched session is shown fresh; it is written to the map (welcome line frozen) on its first change.
  const session = sessions[key] ?? blankSession(welcomeNow);
  const update = (fn: (s: CliSession) => CliSession) => setSessions((prev) => ({ ...prev, [key]: fn(prev[key] ?? blankSession(welcomeNow)) }));
  const stale = stateVersion !== undefined && session.lastRunVersion !== undefined && session.lastRunVersion !== stateVersion;

  useEffect(() => {
    if (focusRequest) inputRef.current?.focus();
  }, [focusRequest]);

  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [key, session.entries.length]);

  function run(line: string) {
    if (!set) return;
    const result = executeCli(set, line);
    const trimmed = line.trim();
    update((s) => {
      const history = trimmed && s.history[s.history.length - 1] !== trimmed ? [...s.history, trimmed] : s.history;
      const base = { ...s, history, historyIndex: null, draft: "", input: "", assist: undefined, lastRunVersion: result.kind === "ok" ? stateVersion : s.lastRunVersion };
      if (result.kind === "clear") return { ...base, welcome: undefined, entries: [] };
      const entry: Entry =
        result.kind === "empty"
          ? { id: s.nextId, kind: "command", prompt: set.prompt, text: line, tone: "ok" }
          : result.kind === "help"
            ? { id: s.nextId, kind: "command", prompt: set.prompt, text: line, output: result.output, tone: "help" }
            : result.kind === "error"
              ? { id: s.nextId, kind: "command", prompt: set.prompt, text: line, output: result.output, tone: "error" }
              : { id: s.nextId, kind: "command", prompt: set.prompt, text: line, output: result.output, explanation: result.explanation, tone: result.refused ? "refused" : "ok" };
      return { ...base, entries: [...s.entries, entry], nextId: s.nextId + 1 };
    });
    if (result.kind === "ok" && !result.refused) onExecuted?.({ vendor, deviceId: set.deviceId, commandId: result.commandId });
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      run(session.input);
    } else if (e.key === "ArrowUp") {
      if (session.history.length === 0) return;
      e.preventDefault();
      update((s) => {
        const next = s.historyIndex === null ? s.history.length - 1 : Math.max(0, s.historyIndex - 1);
        return { ...s, draft: s.historyIndex === null ? s.input : s.draft, historyIndex: next, input: s.history[next], assist: undefined };
      });
    } else if (e.key === "ArrowDown") {
      if (session.historyIndex === null) return;
      e.preventDefault();
      update((s) => {
        if (s.historyIndex === null) return s;
        const next = s.historyIndex + 1;
        return next >= s.history.length ? { ...s, historyIndex: null, input: s.draft, assist: undefined } : { ...s, historyIndex: next, input: s.history[next], assist: undefined };
      });
    } else if (e.key === "Tab" && !e.shiftKey) {
      if (tabRelease) {
        setTabRelease(false);
        return; // Esc was pressed: let focus move on
      }
      e.preventDefault();
      if (!set) return;
      // First Tab completes as much as possible; when nothing more can be added, the candidates are listed.
      const r = completeCli(set, session.input);
      update((s) => (r.extended ? { ...s, input: r.line, historyIndex: null, assist: undefined } : { ...s, assist: r.options.length > 0 ? formatOptions(set.vendor, r.options, false) : undefined }));
    } else if (e.key === "?") {
      e.preventDefault();
      showHelp();
    } else if (e.key === "Escape") {
      update((s) => ({ ...s, assist: undefined }));
      setTabRelease(true);
    } else if (tabRelease) {
      setTabRelease(false);
    }
  }

  /** `?` — context help for the current token. Shared by the keyboard and the touch button; never executes or records anything. */
  function showHelp() {
    if (!set) return;
    const help = contextHelp(set, session.input);
    update((s) => ({ ...s, assist: help }));
    inputRef.current?.focus();
  }

  const prompt = set?.prompt ?? "> ";

  return (
    <div className={clsx("min-w-0 overflow-hidden rounded-xl border border-pv-border bg-[#05080d] shadow-inner", className)}>
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-white/[0.03] px-3 py-2">
        {!shellLabel && (
        <div role="radiogroup" aria-label="CLI vendor" className="flex gap-0.5 rounded-full border border-pv-border p-0.5">
          {VENDORS.map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={vendor === v}
              disabled={!commandSets[v]}
              onClick={() => onVendorChange(v)}
              className={clsx(
                "rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-cyan",
                vendor === v ? "bg-pv-cyan/15 text-pv-cyan-soft" : "text-pv-text-faint hover:text-pv-text",
              )}
            >
              {CLI_VENDOR_LABEL[v]}
            </button>
          ))}
        </div>
        )}
        <span className="rounded-md border border-pv-border px-2 py-0.5 pv-mono text-[10px] font-bold text-pv-text-muted" aria-label={`Device ${set?.deviceName ?? ""}`}>
          {set?.deviceName ?? "—"}
          {deviceRole && <span className="font-normal text-pv-text-faint"> · {deviceRole}</span>}
        </span>
        <span className="rounded-md bg-white/5 px-2 py-0.5 pv-mono text-[10px] uppercase tracking-wide text-pv-text-faint">{shellLabel ?? VENDOR_SHORT[vendor]} · read-only</span>
        {badge}
        <button
          type="button"
          aria-pressed={showExplanations}
          onClick={() => setShowExplanations((v) => !v)}
          className="ml-auto rounded-full border border-pv-border px-2 py-0.5 text-[10px] font-semibold text-pv-text-faint transition-colors hover:text-pv-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-cyan"
        >
          Explanations: {showExplanations ? "on" : "off"}
        </button>
      </div>

      <div
        ref={transcriptRef}
        role="log"
        aria-live="polite"
        aria-label={`${set?.deviceName ?? "Device"} ${shellLabel ?? CLI_VENDOR_LABEL[vendor]} terminal transcript`}
        data-session={key}
        onClick={() => {
          if (!window.getSelection()?.toString()) inputRef.current?.focus();
        }}
        className="h-64 space-y-2 overflow-y-auto overflow-x-hidden px-3 py-2 pv-mono text-[11px] leading-relaxed sm:h-72"
      >
        {session.welcome && <p className="text-[10.5px] italic text-pv-text-faint">— {session.welcome}</p>}
        {session.entries.map((entry) =>
          entry.kind === "note" ? (
            <p key={entry.id} className="text-[10.5px] italic text-pv-text-faint">
              — {entry.text}
            </p>
          ) : (
            <div key={entry.id} className="min-w-0">
              <pre className="overflow-x-auto whitespace-pre">
                <span className="text-pv-success">{entry.prompt}</span>
                <span className="text-pv-text">{entry.text}</span>
              </pre>
              {entry.output !== undefined && entry.output !== "" && (
                <pre
                  className={clsx(
                    "overflow-x-auto whitespace-pre pb-1",
                    entry.tone === "error" ? "text-pv-danger" : entry.tone === "refused" ? "text-pv-warning" : entry.tone === "help" ? "text-pv-cyan-soft" : "text-pv-text-muted",
                  )}
                >
                  {entry.output}
                </pre>
              )}
              {showExplanations && entry.explanation && (
                <p className="mt-1 border-l-2 border-pv-cyan/40 pl-2 font-sans text-[11px] leading-snug text-pv-text-muted">
                  <span className="font-semibold text-pv-cyan-soft">Why it matters: </span>
                  {entry.explanation}
                </p>
              )}
            </div>
          ),
        )}
      </div>

      {stale && (
        <p role="status" className="border-t border-pv-warning/30 bg-pv-warning/5 px-3 py-1 text-[10.5px] text-pv-warning">
          ↻ {staleHint}
        </p>
      )}
      <div className="flex items-center gap-1 border-t border-white/10 px-3 py-2 focus-within:bg-white/[0.03]">
        <label htmlFor={inputId} className="shrink-0 pv-mono text-[12px] text-pv-success">
          <span className="whitespace-pre">{prompt}</span>
          <span className="sr-only"> — type a {CLI_VENDOR_LABEL[vendor]} command and press Enter</span>
        </label>
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          value={session.input}
          onChange={(e) => {
            const value = e.target.value;
            update((s) => ({ ...s, input: value, historyIndex: null, assist: undefined }));
          }}
          onKeyDown={onKeyDown}
          aria-describedby={`${inputId}-keys`}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="send"
          placeholder="type a command…"
          className="min-w-0 flex-1 rounded bg-transparent pv-mono text-[16px] text-pv-text caret-pv-cyan outline-none placeholder:text-pv-text-faint/60 focus-visible:ring-1 focus-visible:ring-pv-cyan/60 sm:text-[12px]"
        />
        <span id={`${inputId}-keys`} className="sr-only">
          Press question mark for context help, Tab to complete the current word. Press Escape, then Tab, to move focus out of the terminal.
        </span>
        <button
          type="button"
          onClick={showHelp}
          aria-label="Context help (same as typing ?)"
          className="shrink-0 rounded-md border border-pv-border px-2 py-1 pv-mono text-[11px] font-bold text-pv-text-faint transition-colors hover:text-pv-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-cyan"
        >
          ?
        </button>
        <button
          type="button"
          onClick={() => {
            run(session.input);
            inputRef.current?.focus();
          }}
          className="shrink-0 rounded-md border border-pv-border px-2 py-1 text-[10px] font-semibold text-pv-text-faint transition-colors hover:text-pv-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-cyan"
        >
          Run ⏎
        </button>
      </div>
      {session.assist && (
        <pre role="status" aria-live="polite" className="max-h-48 overflow-auto border-t border-white/10 px-3 py-1.5 pv-mono text-[11px] leading-relaxed text-pv-cyan-soft">
          {session.assist}
        </pre>
      )}
      {footer && <div className="border-t border-white/10 px-3 py-2 text-[10.5px] leading-snug text-pv-text-faint">{footer}</div>}
    </div>
  );
}
