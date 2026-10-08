"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { clsx } from "clsx";
import { blockSize } from "@/lib/sim-engine/scenarios/subnettingDesign";
import { slParentRange } from "@/lib/sim-engine/scenarios/subnettingLab";
import type { CellView } from "./SubnetGrid";

/**
 * Shared pieces of the Subnet Explorer: board painting helpers, the BIT BAR (the last octet as eight bits with a
 * movable network|host line — the picture that makes "what the mask does" visible), and the small teaching
 * primitives every chapter uses (Scene layout, live narration, "Try this" exploration lists, Predict-then-test
 * cards). Nothing here computes subnet arithmetic beyond bit display; numbers come from the lab model.
 */

export const P0 = slParentRange.first;
export const ip = (o: number) => `10.44.0.${o}`;
export const off = (n: number) => n - P0;
export const blank = (): CellView[] => Array.from({ length: 256 }, () => ({}));
export const alpha = (hex: string, a: number) => `${hex}${Math.round(a * 255).toString(16).padStart(2, "0")}`;
export const NET = "#a78bfa"; // network-side bits
export const HOST = "#34d399"; // host bits
export const SHADE = ["rgba(34,211,238,0.10)", "rgba(34,211,238,0.30)"];
export const START = "rgba(34,211,238,0.62)";

export function paint(cells: CellView[], first: number, size: number, cv: (i: number) => CellView) {
  for (let i = 0; i < size; i++) {
    const o = first + i;
    if (o >= 0 && o < 256) cells[o] = { ...cells[o], ...cv(i) };
  }
}
/** Tile the board into equal blocks: alternating shades, an outline per block, the first square of each lit. */
export function tile(cells: CellView[], prefix: number, opts: { lit?: boolean; tags?: boolean } = {}) {
  const b = blockSize(prefix);
  const n = prefix - 24;
  for (let s = 0; s < 256; s += b) {
    const k = s / b;
    paint(cells, s, b, (i) => ({
      fill: i === 0 && opts.lit !== false && b > 1 ? START : SHADE[k % 2],
      group: `t${s}`,
      groupColor: "rgba(34,211,238,0.6)",
      pour: i + k,
      tag: i !== 0 || b === 256 ? undefined : opts.tags && n <= 3 ? k.toString(2).padStart(n, "0") : opts.lit !== false && b >= 16 ? String(s) : undefined,
    }));
  }
}
export const bits8 = (o: number) => o.toString(2).padStart(8, "0");
export const maskOctet = (prefix: number) => 256 - blockSize(Math.max(24, prefix));

// ---------------------------------------------------------------------------------------------------------------
// The bit bar
// ---------------------------------------------------------------------------------------------------------------
const PLACE = [128, 64, 32, 16, 8, 4, 2, 1];

/**
 * The last octet of an address as 8 bits. Bits left of the line are network bits (they choose the block); bits right
 * of it are host bits (they choose the address inside the block). The line sits at prefix − 24 and slides when the
 * prefix changes. Optional rows: the mask, and "host bits cleared" (address AND mask = the block's start).
 */
export function BitBar({ octet, prefix, clear, showMask, caption, flashBorrowed }: { octet?: number; prefix: number; clear?: boolean; showMask?: boolean; caption?: ReactNode; flashBorrowed?: boolean }) {
  const n = Math.max(0, Math.min(8, prefix - 24));
  const b = octet === undefined ? undefined : bits8(octet);
  const start = octet === undefined ? undefined : octet & maskOctet(prefix);
  const cell = (on: string, i: number, k: string, flash?: boolean) => (
    <span
      key={k}
      className={clsx("flex h-8 items-center justify-center rounded-md border pv-mono text-[15px] font-bold transition-colors duration-500 motion-reduce:transition-none sm:h-9 sm:text-[17px]", flash && "sl-flip")}
      style={{ borderColor: alpha(i < n ? NET : HOST, 0.6), background: alpha(i < n ? NET : HOST, on === "1" ? 0.32 : 0.08), color: i < n ? "#ddd6fe" : "#bbf7d0" }}
    >
      {on}
    </span>
  );
  const row = (label: ReactNode, content: ReactNode, k: string) => (
    <div key={k} className="grid items-center gap-x-2" style={{ gridTemplateColumns: "3.4rem minmax(0,1fr)" }}>
      <span className="text-right pv-mono text-[12.5px] font-semibold text-pv-text-muted">{label}</span>
      <div className="relative grid grid-cols-8 gap-1">{content}</div>
    </div>
  );
  return (
    <div className="space-y-1.5" aria-label={`Last octet bits${octet !== undefined ? ` of 10.44.0.${octet}` : ""} at /${prefix}`} role="group">
      <p className="text-[12.5px] text-pv-text-muted">
        <span className="pv-mono text-pv-text">10.44.0.</span> = the first 24 bits, fixed by the /24. Below: the <b className="text-pv-text">last 8 bits</b>.
      </p>
      {row(
        "",
        PLACE.map((p, i) => (
          <span key={p} className={clsx("text-center pv-mono text-[10.5px] transition-colors duration-500 sm:text-[11.5px]", n > 0 && i === n - 1 ? "font-bold text-pv-cyan-soft" : "text-pv-text-faint")}>
            {p}
          </span>
        )),
        "pv",
      )}
      <div className="relative">
        {row(octet === undefined ? "" : `.${octet}`, (b ?? "········").split("").map((x, i) => cell(x, i, flashBorrowed && i === n - 1 ? `a${i}-${prefix}` : `a${i}`, flashBorrowed && i === n - 1)), "addr")}
        {/* The line between network and host bits. */}
        <div className="pointer-events-none absolute inset-y-0 right-0" style={{ left: "calc(3.4rem + 0.5rem)" }} aria-hidden>
          <div className="absolute -inset-y-1 w-[3px] -translate-x-1/2 rounded bg-white shadow-[0_0_10px_rgba(255,255,255,0.7)] transition-[left] duration-500 ease-out motion-reduce:transition-none" style={{ left: `calc(${n / 8} * (100% - 28px) + ${n * 4 - 2}px)` }}>
            <span className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-pv-bg px-1 pv-mono text-[11px] font-bold text-white">/{prefix}</span>
          </div>
        </div>
      </div>
      {showMask && row(`mask`, PLACE.map((_, i) => cell(i < n ? "1" : "0", i, flashBorrowed && i === n - 1 ? `m${i}-${prefix}` : `m${i}`, flashBorrowed && i === n - 1)), "mask")}
      {clear && b && start !== undefined && row(`→ .${start}`, b.split("").map((x, i) => cell(i < n ? x : "0", i, `c${i}-${octet}-${prefix}`, i >= n && x === "1")), "clear")}
      <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-pv-text-muted">
        <span>
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: NET }} />
          network bits: pick the block
        </span>
        <span>
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: HOST }} />
          host bits: pick the address inside it
        </span>
      </p>
      {caption && <div className="text-[13px] leading-snug text-pv-text-muted">{caption}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Layout + teaching primitives
// ---------------------------------------------------------------------------------------------------------------
/** Height of the shell's pinned header (sticky on desktop only), so the board can stick just below it. */
export function usePinnedOffset() {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [top, setTop] = useState(8);
  useLayoutEffect(() => {
    const pinned = el?.closest("section")?.firstElementChild as HTMLElement | null;
    if (!pinned) return;
    const update = () => setTop(window.matchMedia("(min-width: 1024px)").matches ? pinned.getBoundingClientRect().height + 8 : 8);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(pinned);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [el]);
  return [setEl, top] as const;
}

export const MOTION_CSS = `
  @media (prefers-reduced-motion: no-preference) {
    .sl-pop { animation: slPop .32s ease-out both; }
    .sl-flip { animation: slFlip .7s ease-out both; }
    .sl-pulse { animation: slPulse 1.6s ease-in-out infinite; }
  }
  @keyframes slPop { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
  @keyframes slFlip { 0% { transform: rotateX(0); background: rgba(52,211,153,.55); } 50% { transform: rotateX(90deg); } 100% { transform: rotateX(0); } }
  @keyframes slPulse { 0%,100% { opacity: 1; } 50% { opacity: .55; } }
`;

/** Board on the left (sticky on desktop, always fully on screen), the explanation beside it. */
export function Scene({ board, side, hint, extra = 0 }: { board: ReactNode; side: ReactNode; hint?: ReactNode; /** px of non-board content stacked above the board */ extra?: number }) {
  const [pinRef, pinTop] = usePinnedOffset();
  return (
    <div ref={pinRef} className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)] lg:items-start">
      <style>{MOTION_CSS}</style>
      <div className="min-w-0 lg:sticky" style={{ top: pinTop }}>
        <div className="mx-auto rounded-2xl border border-pv-cyan/25 bg-pv-bg-elevated/30 p-2.5 sm:p-3" style={{ maxWidth: `max(320px, calc(100dvh - ${pinTop + 110 + extra}px))` }}>
          {board}
        </div>
        {hint && <div className="mt-1.5 text-center text-[12.5px] text-pv-text-faint">{hint}</div>}
      </div>
      <div className="min-w-0 space-y-3">{side}</div>
    </div>
  );
}

/** Chapter opener: what this chapter is about, in one or two sentences. */
export function Lead({ kicker, title, children }: { kicker: string; title: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-pv-cyan-soft">{kicker}</p>
      <h3 className="text-[19px] font-semibold leading-tight text-pv-text">{title}</h3>
      <div className="mt-1.5 space-y-1.5 text-[14.5px] leading-snug text-pv-text-muted">{children}</div>
    </div>
  );
}

/** Live narration: describes exactly what the board shows right now. Re-animates when `k` changes. */
export function Now({ k, title, children, tone = "info" }: { k: string | number; title?: ReactNode; children?: ReactNode; tone?: "info" | "ok" | "warn" | "bad" }) {
  const c = { info: "border-pv-cyan/30 bg-pv-cyan/[0.05]", ok: "border-pv-success/45 bg-pv-success/[0.07]", warn: "border-pv-warning/45 bg-pv-warning/[0.07]", bad: "border-pv-danger/45 bg-pv-danger/[0.07]" }[tone];
  const t = { info: "text-pv-text", ok: "text-pv-success", warn: "text-pv-warning", bad: "text-pv-danger" }[tone];
  return (
    <div key={k} className={clsx("sl-pop rounded-2xl border p-3", c)} aria-live="polite">
      <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-pv-text-faint">What you&apos;re seeing</p>
      {title && <p className={clsx("mt-0.5 text-[16px] font-semibold leading-snug", t)}>{title}</p>}
      {children && <div className="mt-1 space-y-1.5 text-[14px] leading-snug text-pv-text-muted">{children}</div>}
    </div>
  );
}

export function Idea({ children, title = "The idea to keep" }: { children: ReactNode; title?: string }) {
  return (
    <div className="rounded-2xl border border-pv-violet/40 bg-pv-violet/[0.07] p-3">
      <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-pv-violet">{title}</p>
      <div className="mt-1 space-y-1 text-[14.5px] leading-snug text-pv-text">{children}</div>
    </div>
  );
}

/** Things worth trying. They tick themselves when the learner does them; nothing is required. */
export function TryList({ items }: { items: { text: ReactNode; done: boolean }[] }) {
  return (
    <div className="rounded-2xl border border-pv-border bg-pv-bg-elevated/30 p-3">
      <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-pv-text-faint">Try this</p>
      <ul className="mt-1.5 space-y-1">
        {items.map((it, i) => (
          <li key={i} className={clsx("flex gap-2 text-[14px] leading-snug", it.done ? "text-pv-text-muted" : "text-pv-text")}>
            <span aria-hidden className={clsx("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px]", it.done ? "border-pv-success bg-pv-success/20 text-pv-success" : "border-pv-border")}>
              {it.done ? "✓" : ""}
            </span>
            <span>
              {it.text}
              {it.done && <span className="sr-only"> (done)</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Predict, then test it on the board. Optional: never blocks anything. */
export function Predict({ q, options, answer, onTest, explain }: { q: ReactNode; options: string[]; answer: number; onTest: () => void; explain: ReactNode }) {
  const [pick, setPick] = useState<number | undefined>(undefined);
  const [tested, setTested] = useState(false);
  return (
    <div className="rounded-2xl border border-pv-warning/35 bg-pv-warning/[0.05] p-3">
      <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-pv-warning">Predict, then test</p>
      <p className="mt-0.5 text-[14.5px] font-semibold leading-snug text-pv-text">{q}</p>
      <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Your prediction">
        {options.map((o, i) => (
          <button key={o} type="button" aria-pressed={pick === i} onClick={() => setPick(i)} className={clsx("rounded-full border px-3 py-1.5 text-[13.5px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-cyan", pick === i ? "border-pv-warning bg-pv-warning/15 text-pv-text" : "border-pv-border text-pv-text-muted hover:text-pv-text")}>
            {o}
          </button>
        ))}
        <Btn
          tone="quiet"
          onClick={() => {
            setTested(true);
            onTest();
          }}
        >
          {pick === undefined ? "Just show me" : "Test it on the board"}
        </Btn>
      </div>
      {tested && (
        <div className="sl-pop mt-2 space-y-1 text-[14px] leading-snug text-pv-text-muted">
          {pick !== undefined && <p className={pick === answer ? "font-semibold text-pv-success" : "font-semibold text-pv-text"}>{pick === answer ? "✓ Your prediction holds." : `You guessed ${options[pick]}; the board says ${options[answer]}.`}</p>}
          {explain}
        </div>
      )}
    </div>
  );
}

const btn = "rounded-full px-4 py-2 text-[14px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-cyan disabled:cursor-not-allowed disabled:opacity-40";
export function Btn({ children, onClick, disabled, tone = "primary", pressed }: { children: ReactNode; onClick: () => void; disabled?: boolean; tone?: "primary" | "quiet"; pressed?: boolean }) {
  return (
    <button type="button" aria-pressed={pressed} onClick={onClick} disabled={disabled} className={clsx(btn, tone === "primary" ? "bg-pv-cyan text-[#03131a] hover:brightness-110" : pressed ? "border border-pv-cyan/70 bg-pv-cyan/15 text-pv-cyan-soft" : "border border-pv-border text-pv-text-muted hover:text-pv-text")}>
      {children}
    </button>
  );
}

/** The prefix slider: /min … /max, with the current value large. */
export function PrefixSlider({ value, onChange, min = 24, max = 30, label = "Prefix length" }: { value: number; onChange: (p: number) => void; min?: number; max?: number; label?: string }) {
  return (
    <div className="rounded-2xl border border-pv-cyan/35 bg-pv-cyan/[0.05] p-3">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor="sl-prefix" className="text-[13px] font-semibold text-pv-text-muted">
          {label}
        </label>
        <span className="pv-mono text-[24px] font-bold text-pv-cyan-soft">/{value}</span>
      </div>
      <input id="sl-prefix" type="range" min={min} max={max} step={1} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-1 w-full accent-[#22d3ee]" aria-valuetext={`/${value}`} />
      <div className="mt-0.5 flex justify-between pv-mono text-[11.5px] text-pv-text-faint" aria-hidden>
        {Array.from({ length: max - min + 1 }, (_, i) => (
          <button key={i} type="button" tabIndex={-1} onClick={() => onChange(min + i)} className={clsx("px-0.5", min + i === value && "font-bold text-pv-cyan-soft")}>
            /{min + i}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Readout({ items }: { items: { k: ReactNode; v: ReactNode; sub?: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {items.map((it, i) => (
        <div key={i} className="rounded-xl border border-pv-border bg-pv-bg-elevated/40 px-2.5 py-2">
          <dt className="text-[11.5px] text-pv-text-faint">{it.k}</dt>
          <dd className="pv-mono text-[17px] font-bold leading-tight text-pv-text">{it.v}</dd>
          {it.sub && <dd className="text-[11.5px] leading-tight text-pv-text-muted">{it.sub}</dd>}
        </div>
      ))}
    </dl>
  );
}

/** A set of "seen" flags for TryList ticks (chapter-local, never progress). */
export function useSeen() {
  const [seen, setSeen] = useState<Record<string, boolean>>({});
  const mark = useCallback((k: string) => setSeen((s) => (s[k] ? s : { ...s, [k]: true })), []);
  return [seen, mark] as const;
}

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
/** Step through a sequence with a delay (instantly under reduced motion). Returns [play, stop, playing]. */
export function useStepper() {
  const t = useRef<number | undefined>(undefined);
  const [playing, setPlaying] = useState(false);
  const stop = useCallback(() => {
    window.clearTimeout(t.current);
    setPlaying(false);
  }, []);
  const play = useCallback(
    <T,>(seq: T[], ms: number, onStep: (v: T, i: number) => void, onDone?: () => void) => {
      window.clearTimeout(t.current);
      if (reduced() || seq.length === 0) {
        seq.forEach((v, i) => onStep(v, i));
        onDone?.();
        return;
      }
      setPlaying(true);
      let i = 0;
      const tick = () => {
        onStep(seq[i], i);
        i++;
        if (i < seq.length) t.current = window.setTimeout(tick, ms);
        else {
          setPlaying(false);
          onDone?.();
        }
      };
      tick();
    },
    [],
  );
  useEffect(() => () => window.clearTimeout(t.current), []);
  return [play, stop, playing] as const;
}

// ---------------------------------------------------------------------------------------------------------------
// The whole address: 32 bits with the prefix line
// ---------------------------------------------------------------------------------------------------------------
/**
 * All 32 bits of an IPv4 address in four octets, the decimal number under each octet, and the prefix line.
 * Network bits (left of the line) are violet, host bits green. `lead` outlines the first bits (used for the old
 * classful leading-bit rule).
 */
export function FullBits({ octets, prefix, title, lead, mask, neutral }: { octets: number[]; prefix: number; title?: ReactNode; lead?: number; mask?: boolean; /** plain bits: no network/host coloring, no line */ neutral?: boolean }) {
  const bits = octets.map(bits8).join("");
  const dotted = octets.join(".");
  return (
    <div role="group" aria-label={`${mask ? "Mask" : "Address"} ${dotted} as 32 bits, ${prefix} network bits and ${32 - prefix} host bits`}>
      {title && <p className="mb-1 text-[12.5px] font-semibold text-pv-text-muted">{title}</p>}
      <div className="grid grid-cols-2 gap-x-2.5 gap-y-2 sm:grid-cols-4">
        {[0, 1, 2, 3].map((g) => {
          const allNet = g * 8 + 8 <= prefix;
          const allHost = g * 8 >= prefix;
          return (
            <div key={g}>
              <div className="grid grid-cols-8 gap-px" aria-hidden>
                {bits
                  .slice(g * 8, g * 8 + 8)
                  .split("")
                  .map((bit, j) => {
                    const i = g * 8 + j;
                    const net = i < prefix;
                    return (
                      <span
                        key={j}
                        className="relative flex h-6 items-center justify-center rounded-[3px] pv-mono text-[10.5px] font-bold transition-colors duration-500 motion-reduce:transition-none sm:h-7 sm:text-[12px]"
                        style={{ background: neutral ? (bit === "1" ? "rgba(226,232,240,0.30)" : "rgba(148,163,184,0.10)") : alpha(net ? NET : HOST, bit === "1" ? 0.42 : 0.12), color: neutral ? "#e2e8f0" : net ? "#ddd6fe" : "#bbf7d0", boxShadow: lead !== undefined && i < lead ? "inset 0 0 0 2px #fbbf24" : undefined }}
                      >
                        {bit}
                        {!neutral && i === prefix && <span className="absolute -inset-y-1.5 -left-[3px] w-[3px] rounded bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)]" />}
                      </span>
                    );
                  })}
              </div>
              <p className="mt-0.5 text-center pv-mono text-[15px] font-bold sm:text-[17px]" style={{ color: neutral ? "#e8edf9" : allNet ? "#c4b5fd" : allHost ? "#6ee7b7" : "#e8edf9" }}>
                {octets[g]}
              </p>
            </div>
          );
        })}
      </div>
      {neutral ? (
        <p className="mt-0.5 text-center text-[12px] font-semibold text-pv-text-muted">8 + 8 + 8 + 8 = 32 bits</p>
      ) : (
      <p className="mt-0.5 flex justify-between gap-2 text-[12px] font-semibold">
        <span style={{ color: "#c4b5fd" }}>◀ {prefix} network bits{mask ? " (1s)" : ""}</span>
        <span style={{ color: "#6ee7b7" }}>
          {32 - prefix} host bits{mask ? " (0s)" : ""} ▶
        </span>
      </p>
      )}
    </div>
  );
}

/**
 * The chain that ties the prefix to everything else, as one connected strip: network bits ↑ · host bits ↓ ·
 * blocks ×2 · addresses per block ÷2 — and the product that never changes (blocks × size = 256).
 */
export function ChainStrip({ prefix, prev }: { prefix: number; prev?: number }) {
  const n = prefix - 24;
  const h = 32 - prefix;
  const d = prev === undefined ? 0 : prefix - prev;
  const arrow = (up: boolean) => (d === 0 ? "" : (d > 0) === up ? "▲" : "▼");
  const cells = [
    { k: "Network bits", v: prefix, a: arrow(true), c: "#c4b5fd", note: d === 0 ? "" : d > 0 ? `+${d}` : `${d}` },
    { k: "Host bits", v: h, a: arrow(false), c: "#6ee7b7", note: d === 0 ? "" : d > 0 ? `−${d}` : `+${-d}` },
    { k: "Subnet blocks", v: 2 ** n, a: arrow(true), c: "#67e8f9", note: d === 0 ? "" : d > 0 ? `×${2 ** d}` : `÷${2 ** -d}` },
    { k: "Addresses each", v: 2 ** h, a: arrow(false), c: "#fde68a", note: d === 0 ? "" : d > 0 ? `÷${2 ** d}` : `×${2 ** -d}` },
  ];
  return (
    <div className="rounded-2xl border border-pv-cyan/35 bg-pv-bg-elevated/40 p-2.5" aria-live="polite">
      <div className="grid grid-cols-4 gap-1.5">
        {cells.map((c, i) => (
          <div key={c.k} className="relative rounded-xl border border-pv-border bg-pv-bg/60 px-1.5 py-1.5 text-center">
            <p className="text-[10.5px] leading-tight text-pv-text-faint sm:text-[11px]">{c.k}</p>
            <p key={`${c.k}-${prefix}`} className="sl-pop pv-mono text-[19px] font-bold leading-tight sm:text-[22px]" style={{ color: c.c }}>
              {c.v}
            </p>
            <p className="h-4 pv-mono text-[11px] font-bold" style={{ color: c.c }}>
              {c.a} {c.note}
            </p>
            {i < 3 && (
              <span aria-hidden className="absolute -right-[9px] top-1/2 z-10 -translate-y-1/2 text-[12px] text-pv-text-faint">
                →
              </span>
            )}
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-center pv-mono text-[13px] text-pv-text-muted">
        {2 ** n} block{n ? "s" : ""} × {2 ** h} addresses = <b className="text-pv-text">256</b> <span className="font-sans text-[12px]">(always the same 256: divided, never created)</span>
      </p>
    </div>
  );
}
