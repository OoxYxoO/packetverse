"use client";

import { clsx } from "clsx";
import { useEffect, useRef, useState } from "react";

/**
 * GNU nano, inside the terminal: what `sudo nano /etc/dhcp/dhcpd.conf` opens on a real Ubuntu server. It takes over
 * the terminal screen (like the real one) and gives it back on exit. The keys are nano's: ^O writes the file out (with
 * the file-name prompt), ^X exits (asking to save a modified buffer), ^K/^U cut and paste a line, ^C shows the
 * cursor position, ^G a short help. The shortcut bar is clickable, for phones and for anyone who doesn't know the keys.
 * Writing goes through `save`, which is the server's real file: nothing is checked or fixed here. Errors show when the
 * file is used (dhcpd -t, a restart, named-checkzone, a reload), exactly as on the real server.
 */

export interface EditorSpec {
  path: string;
  /** The file as it is now (read when nano opens). */
  text: string;
  /** Write the file. Returns an error (e.g. "Permission denied") when it can't. */
  save: (text: string) => string | undefined;
  /** Shown in the status bar when the file opens (e.g. it is not writable by this user). */
  openNote?: string;
}

type Mode = { kind: "edit" } | { kind: "write"; exitAfter: boolean } | { kind: "confirm" };

export function NanoEditor({ spec, buffer, orig, setBuffer, setOrig, onExit, className }: { spec: EditorSpec; buffer: string; orig: string; setBuffer: (t: string) => void; setOrig: (t: string) => void; onExit: () => void; className?: string }) {
  const area = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<Mode>({ kind: "edit" });
  const [status, setStatus] = useState<string | undefined>(spec.openNote ?? `[ Read ${lines(spec.text)} lines ]`);
  const [cut, setCut] = useState<string[]>([]);
  const modified = buffer !== orig;
  useEffect(() => {
    area.current?.focus({ preventScroll: true });
  }, []);

  const write = (exitAfter: boolean) => {
    const err = spec.save(buffer);
    if (err) {
      setStatus(`[ Error writing ${spec.path}: ${err} ]`);
      setMode({ kind: "edit" });
      return;
    }
    setOrig(buffer);
    setStatus(`[ Wrote ${lines(buffer)} lines ]`);
    setMode({ kind: "edit" });
    if (exitAfter) onExit();
  };
  const cancel = () => {
    setMode({ kind: "edit" });
    setStatus("[ Canceled ]");
  };
  const exit = () => {
    if (modified) setMode({ kind: "confirm" });
    else onExit();
  };
  const caretLine = () => {
    const el = area.current;
    const pos = el?.selectionStart ?? 0;
    const before = buffer.slice(0, pos);
    const row = before.split("\n").length - 1;
    const col = pos - (before.lastIndexOf("\n") + 1);
    return { row, col, pos };
  };
  const setCaret = (pos: number) => requestAnimationFrame(() => area.current?.setSelectionRange(pos, pos));
  const cutLine = () => {
    const { row } = caretLine();
    const ls = buffer.split("\n");
    const [gone] = ls.splice(row, 1);
    setCut((c) => [...c, gone]);
    const next = ls.join("\n");
    setBuffer(next);
    setCaret(ls.slice(0, row).join("\n").length + (row ? 1 : 0));
    setStatus(undefined);
  };
  const paste = () => {
    if (!cut.length) return setStatus("[ Cutbuffer is empty ]");
    const { row } = caretLine();
    const ls = buffer.split("\n");
    ls.splice(row, 0, ...cut);
    setBuffer(ls.join("\n"));
    setCut([]);
    setCaret(ls.slice(0, row + cut.length).join("\n").length + 1);
    setStatus(undefined);
  };
  const where = () => {
    const { row, col, pos } = caretLine();
    const ls = buffer.split("\n");
    setStatus(`[ line ${row + 1}/${ls.length} (${Math.round(((row + 1) / ls.length) * 100)}%), col ${col + 1}/${ls[row].length + 1} (${Math.round((pos / Math.max(1, buffer.length)) * 100)}%), char ${pos}/${buffer.length} ]`);
  };
  const help = () => setStatus("^O write the file (Enter confirms the name) · ^X exit (asks to save) · ^K cut line · ^U paste · ^C position");

  // The answer to a prompt (Y/N, Enter) can arrive as an input event instead of a key (phone keyboards, IMEs).
  const answer = (ch: string) => {
    const k = ch.toLowerCase();
    if (mode.kind === "confirm") {
      if (k === "y") setMode({ kind: "write", exitAfter: true });
      else if (k === "n") onExit();
    } else if (mode.kind === "write" && (k === "\n" || k === "\r")) write(mode.exitAfter);
  };
  const onKey = (e: React.KeyboardEvent<HTMLElement>) => {
    const ctrl = e.ctrlKey || e.metaKey;
    // Physical key first (e.code), so ^X, Y, N and Enter work whatever the layout, Caps Lock or an active IME (which
    // reports letters as "Process"/"Unidentified").
    const byCode = /^Key([A-Z])$/.exec(e.code)?.[1]?.toLowerCase() ?? (e.code === "Enter" || e.code === "NumpadEnter" ? "enter" : e.code === "Escape" ? "escape" : e.code === "Tab" ? "tab" : undefined);
    const k = (e.key.length === 1 || ["Enter", "Escape", "Tab"].includes(e.key) ? e.key.toLowerCase() : undefined) ?? byCode ?? e.key.toLowerCase();
    const kk = ctrl || mode.kind !== "edit" ? (byCode ?? k) : k;
    // Inside nano, Escape belongs to nano (it cancels a prompt; in real nano it's the Meta prefix). It must not reach the
    // device window, which would minimize it and leave the keyboard nowhere with nano still open.
    if (kk === "escape") {
      e.stopPropagation();
      e.preventDefault();
      if (mode.kind !== "edit") cancel();
      return;
    }
    if (mode.kind === "confirm") {
      e.preventDefault();
      if ((ctrl && kk === "c") || kk === "escape") cancel();
      else if (!ctrl && (kk === "y" || kk === "n")) answer(kk);
      return;
    }
    if (mode.kind === "write") {
      e.preventDefault();
      if ((ctrl && kk === "c") || kk === "escape") cancel();
      else if (kk === "enter") write(mode.exitAfter);
      return;
    }
    if (k === "tab" && !ctrl) {
      e.preventDefault();
      const { pos } = caretLine();
      setBuffer(buffer.slice(0, pos) + "\t" + buffer.slice(pos));
      setCaret(pos + 1);
      return;
    }
    if (!ctrl) {
      if (status && !e.key.startsWith("Arrow")) setStatus(undefined);
      return;
    }
    const act: Record<string, () => void> = { o: () => setMode({ kind: "write", exitAfter: false }), x: exit, k: cutLine, u: paste, c: where, g: help };
    if (act[kk]) {
      e.preventDefault();
      act[kk]();
    }
  };

  return (
    <div
      className={clsx("flex flex-col bg-[#0b0f14] pv-mono text-[12px] leading-[1.45] text-[#d6dee7]", className)}
      data-nano={spec.path}
      data-nano-mode={mode.kind}
      // Clicking anywhere in nano (header, status line, margins) keeps the keyboard in nano, like a terminal window.
      onMouseUp={(e) => {
        if (e.target !== area.current && !window.getSelection()?.toString()) area.current?.focus({ preventScroll: true });
      }}
    >
      <div className="flex justify-between gap-2 bg-[#d6dee7] px-2 text-[#0b0f14]">
        <span>GNU nano 6.2</span>
        <span className="truncate">{spec.path}</span>
        <span className="w-14 text-right">{modified ? "Modified" : ""}</span>
      </div>
      <textarea
        ref={area}
        value={buffer}
        onChange={(e) => {
          if (mode.kind === "edit") return setBuffer(e.target.value);
          // At a prompt the text is not edited; a typed character (phone keyboard, IME) answers the prompt instead.
          const v = e.target.value;
          const at = [...v].findIndex((ch, i) => ch !== buffer[i]);
          if (v.length > buffer.length && at >= 0) answer(v.slice(at, at + v.length - buffer.length).slice(-1));
        }}
        onKeyDown={onKey}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        wrap="off"
        aria-label={`nano: editing ${spec.path}`}
        className="min-h-0 flex-1 resize-none bg-transparent px-2 py-1 text-[#d6dee7] caret-[#d6dee7] outline-none"
        style={{ tabSize: 8 }}
      />
      <div className="min-h-[1.45em] px-2 text-center" aria-live="polite">
        {mode.kind === "confirm" ? (
          <span className="bg-[#d6dee7] px-1 text-[#0b0f14]">Save modified buffer?</span>
        ) : mode.kind === "write" ? (
          <span className="block bg-[#d6dee7] px-1 text-left text-[#0b0f14]">File Name to Write: {spec.path}</span>
        ) : (
          status && <span className="bg-[#d6dee7] px-1 text-[#0b0f14]">{status}</span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-x-2 gap-y-0.5 px-2 pb-1 text-[11.5px] text-[#aeb9c5] sm:grid-cols-6">
        {mode.kind === "confirm" ? (
          <>
            <Key k=" Y" label="Yes" onClick={() => setMode({ kind: "write", exitAfter: true })} />
            <Key k=" N" label="No" onClick={onExit} />
            <Key k="^C" label="Cancel" onClick={cancel} />
          </>
        ) : mode.kind === "write" ? (
          <>
            <Key k="⏎" label="Write" onClick={() => write(mode.exitAfter)} />
            <Key k="^C" label="Cancel" onClick={cancel} />
          </>
        ) : (
          <>
            <Key k="^G" label="Help" onClick={help} />
            <Key k="^O" label="Write Out" onClick={() => setMode({ kind: "write", exitAfter: false })} />
            <Key k="^K" label="Cut" onClick={cutLine} />
            <Key k="^X" label="Exit" onClick={exit} />
            <Key k="^U" label="Paste" onClick={paste} />
            <Key k="^C" label="Location" onClick={where} />
          </>
        )}
      </div>
    </div>
  );
}

/** One entry of nano's shortcut bar; clicking it does what the key does (focus stays in the text). */
function Key({ k, label, onClick }: { k: string; label: string; onClick: () => void }) {
  return (
    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onClick} className="flex items-center gap-1 whitespace-nowrap text-left hover:text-white">
      <span className="bg-[#d6dee7] px-0.5 text-[#0b0f14]">{k}</span>
      <span>{label}</span>
    </button>
  );
}

function lines(t: string) {
  const ls = t.split("\n");
  return ls[ls.length - 1] === "" ? ls.length - 1 : ls.length;
}
