"use client";

import { useEffect, useLayoutEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { clsx } from "clsx";
import { blockSize, maskOf } from "@/lib/sim-engine/scenarios/subnettingDesign";
import { ipToNum, numToIp } from "@/lib/sim-engine/scenarios/fundamentalsPackets";
import {
  SS_BRIEFS,
  SS_CAUSES,
  SS_PREFIX_MAX,
  SS_PREFIX_MIN,
  SS_TICKETS,
  ssBrief,
  ssBuildSteps,
  ssCanFit,
  ssCauseFeedback,
  ssCheck,
  ssDevName,
  ssDevice,
  ssDevices,
  ssInside,
  ssMatch,
  ssMinPrefix,
  ssNetOf,
  ssParent,
  ssPing,
  ssR1Routes,
  ssProofs,
  ssRangeText,
  ssShort,
  ssShortIf,
  ssStateReport,
  ssTicket,
  ssUsable,
  type SsAction,
  type SsCause,
  type SsCheck,
  type SsPing,
  type SsReport,
  type SsState,
} from "@/lib/sim-engine/scenarios/subnetStudio";
import { SEG_COLOR } from "./SubnetRuler";
import { AddressGrid, Legend, type SnapOverlay } from "./SubnetGrid";
import { Btn, Idea, Lead, MOTION_CSS, Now, Scene, alpha, blank, paint } from "./SubnetKit";
import { SubnetTopology, deviceMarks } from "./SubnetTopology";

/**
 * ENGINEER — the Subnet Studio, on the generic studio model (subnetStudio.ts):
 *   12 · Design          a brief (requirements + parent /24) → the learner writes every network freely (size + start),
 *                        the board shows the REAL blocks, the verification explains each rule row by row, free space
 *                        says honestly what can still fit
 *   13 · Build & test    the plan becomes device configuration (R1 + one device per network, in their own windows with
 *                        terminals); Test all walks every ping through the own-mask decision and R1's connected routes
 *   14 · Troubleshoot    four tickets (misaligned spreadsheet, wrong mask, wrong gateway, fragmented free space):
 *                        reproduce → investigate rung by rung → name the root cause → fix → prove
 * Every number on screen comes from the model; nothing here compares the learner's plan with a stored answer.
 */

const PALETTE = ["#22d3ee", "#a78bfa", "#34d399", "#fbbf24", "#f472b6", "#fb923c", "#60a5fa"];
export const ssColor = (s: SsState, id: string) => (SEG_COLOR as Record<string, string>)[id] ?? PALETTE[Math.max(0, s.needs.findIndex((n) => n.id === id)) % PALETTE.length];
/** A short board label: LAN-A → A, WAN-1 → W1, TRANSIT → TR. */
const tagOf = (id: string) => (id.startsWith("LAN-") ? id.slice(4) : id.includes("-") ? id[0] + id.split("-").pop() : id.slice(0, 2));
const base = (s: SsState) => ssParent(s).network.split(".").slice(0, 3).join(".") + ".";
const P0 = (s: SsState) => ipToNum(ssParent(s).network);
export interface StudioProps {
  ss: SsState;
  act: (a: SsAction) => SsState;
  openWin: (id: string) => void;
  go: (k: "design" | "apply" | "trouble") => void;
  /** Troubleshoot only: the investigation, kept by the workspace so it survives a trip to Design or Build & test. */
  desk?: [TroubleDesk, Dispatch<SetStateAction<TroubleDesk>>];
}
/** What the learner has found on the current ticket: opened evidence rungs, the last root-cause guess, solved. */
export interface TroubleDesk {
  shown: Record<string, boolean>;
  /** The feedback is the one given when the guess was made, against the evidence the learner saw then. */
  guess?: { cause: SsCause; seq: number; fb: ReturnType<typeof ssCauseFeedback> };
  found: boolean;
}
export const EMPTY_DESK: TroubleDesk = { shown: {}, found: false };

// =============================================================================================================
// The board (the plan on the parent /24)
// =============================================================================================================
function studioBoard(s: SsState, mode: "real" | "written", opts: { sel?: string; hover?: number; slide?: boolean } = {}) {
  const r = ssStateReport(s);
  const p0 = P0(s);
  const cells = blank();
  const overlays: SnapOverlay[] = [];
  for (const c of r.checks) {
    const range = mode === "written" ? c.writtenRange : c.realRange;
    const color = ssColor(s, c.id);
    paint(cells, range.first - p0, range.last - range.first + 1, (i) => ({ fill: alpha(color, opts.sel === c.id ? 0.55 : 0.4), group: c.id, groupColor: color, pour: i, tag: i === 0 ? tagOf(c.id) : undefined }));
    if (mode === "real" && !c.aligned) for (let o = c.writtenRange.first - p0; o <= c.writtenRange.last - p0; o++) if (o >= 0 && o < 256) cells[o] = { ...cells[o], dashed: color };
    if (opts.slide && mode === "real" && !c.aligned && c.realRange.first >= p0 && c.realRange.last < p0 + 256) overlays.push({ key: `${c.id}-${c.written}-${c.prefix}`, first: c.realRange.first - p0, size: c.block, color, from: c.rem, label: `${c.id}: real ${ssShort(ssParent(s), c.realRange.first)}/${c.prefix}`, labelRight: true });
  }
  if (mode === "real") for (const o of r.overlaps) for (let x = o.shared.first - p0; x <= o.shared.last - p0; x++) if (x >= 0 && x < 256) cells[x] = { ...cells[x], clash: true };
  const row = opts.sel ? s.rows.find((x) => x.id === opts.sel) : undefined;
  if (row?.prefix !== undefined && opts.hover !== undefined) {
    const size = blockSize(row.prefix);
    const start = Math.floor(opts.hover / size) * size;
    paint(cells, start, size, () => ({ dashed: "#e8edf9" }));
  }
  return { cells, overlays, report: r };
}
function OutsideNote({ s, r }: { s: SsState; r: SsReport }) {
  const out = r.checks.filter((c) => c.violations.some((v) => v.code === "OUTSIDE_PARENT"));
  if (!out.length) return null;
  return (
    <p className="mt-1.5 rounded-lg border border-pv-danger/40 bg-pv-danger/[0.06] px-2 py-1 text-[12.5px] text-pv-text">
      Not on this board: {out.map((c) => <b key={c.id} style={{ color: ssColor(s, c.id) }} className="pv-mono">{c.id} {c.real}/{c.prefix} </b>)}— outside {ssParent(s).network}/{ssParent(s).prefix}.
    </p>
  );
}

// =============================================================================================================
// 12 · Design
// =============================================================================================================
export function StudioDesign({ ss, act, go, openWin }: StudioProps) {
  const [sel, setSel] = useState<string | undefined>(ss.needs[0]?.id);
  const [view, setView] = useState<"board" | "network">("board");
  const narrow = useNarrow();
  const [hover, setHover] = useState<number | undefined>(undefined);
  const [hint, setHint] = useState<string | undefined>(undefined);
  const parent = ssParent(ss);
  const brief = ssBrief(ss.brief);
  const { cells, overlays, report } = studioBoard(ss, "real", { sel, hover, slide: true });
  const selRow = ss.rows.find((r) => r.id === sel);
  const tap = (o: number) => {
    if (!sel) return;
    if (selRow?.prefix === undefined) return setHint(`Choose a size for ${sel} first: how many addresses does it need?`);
    setHint(undefined);
    act({ type: "place", id: sel, network: numToIp(P0(ss) + o) });
  };
  const growth = brief.growth && !ss.needs.some((n) => n.id === brief.growth!.id) ? brief.growth : undefined;
  return (
    <Scene
      board={
        <>
          <div className="mb-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="View">
            <Btn tone="quiet" pressed={view === "board"} onClick={() => setView("board")}>
              Address space
            </Btn>
            <Btn tone="quiet" pressed={view === "network"} onClick={() => setView("network")}>
              Network
            </Btn>
            <span className="text-[12px] text-pv-text-faint">{view === "board" ? "tap a square to place the selected network" : "each LAN shows the block your plan gives it"}</span>
          </div>
          {view === "board" ? (
            <AddressGrid cells={cells} base={base(ss)} onTap={tap} onHover={setHover} overlays={overlays} label={`Address board ${parent.network}/${parent.prefix}: 256 addresses, 16 per row`} footer={<Legend items={[...ss.needs.map((n) => ({ color: ssColor(ss, n.id), label: n.id })), { color: "#e8edf9", label: "where it would land", dashed: true }, { color: "#f87171", label: "claimed twice", clash: true }]} />} />
          ) : (
            <SubnetTopology ss={ss} color={(id) => ssColor(ss, id)} focus={sel} setFocus={(w) => w && setSel(w)} onOpen={openWin} narrow={narrow} />
          )}
          <OutsideNote s={ss} r={report} />
        </>
      }
      hint={sel ? (hover !== undefined ? `Tap to start ${sel} at ${base(ss)}${hover} — it lands on the dashed block` : `Selected: ${sel}. Tap the board where it should start.`) : "Select a network in the plan"}
      side={
        <>
          <Lead kicker="Engineer · Design" title="Design the address plan yourself">
            <p>Start from the requirements. For every network choose a size, then a start. Nothing stops you from making mistakes: the board shows each block where devices will really put it, and the verification explains every rule.</p>
          </Lead>
          {ss.ticket && <TicketBanner ss={ss} go={go} />}
          <div className="rounded-2xl border border-pv-border bg-pv-bg-elevated/30 p-3">
            <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-pv-text-faint">Brief</p>
            <div className="mt-1 flex flex-wrap gap-1.5" role="group" aria-label="Design brief">
              {SS_BRIEFS.map((b) => (
                <Btn key={b.id} tone="quiet" pressed={ss.brief === b.id && !ss.ticket} onClick={() => (act({ type: "brief", id: b.id }), setSel(b.needs[0].id), setHint(undefined))}>
                  {b.title}
                </Btn>
              ))}
            </div>
            <p className="mt-1.5 text-[13.5px] text-pv-text-muted">
              <b className="pv-mono text-pv-text">{parent.network}/{parent.prefix}</b> · {brief.story} <span className="text-pv-text-faint">Counts include the router&apos;s own address.</span>
            </p>
            {growth && (
              <Btn tone="quiet" onClick={() => (act({ type: "grow" }), setSel(growth.id))}>
                + New requirement: {growth.id} ({growth.hosts})
              </Btn>
            )}
          </div>
          <PlanEditor ss={ss} act={act} sel={sel} setSel={setSel} report={report} />
          {hint && (
            <p className="sl-pop rounded-xl border border-pv-warning/40 bg-pv-warning/[0.07] px-3 py-2 text-[13.5px] text-pv-text" role="status">
              {hint}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Btn tone="quiet" onClick={() => setHint(nextHint(ss, report))}>
              Hint: what next?
            </Btn>
            <Btn tone="quiet" onClick={() => (act({ type: "clear-all" }), setHint(undefined))}>
              Clear the board
            </Btn>
          </div>
          <VerifyPanel ss={ss} report={report} />
          <FreeSpace ss={ss} report={report} />
          <Idea>
            <p>A plan is valid when the RULES hold, not when it matches someone&apos;s answer: every network fits, starts on its own boundary, stays inside the parent, and shares no address. Several different plans can all be valid.</p>
            <p className="text-pv-text-muted">Largest first is a convenient order (big blocks have the fewest legal starts), not the only correct one.</p>
          </Idea>
          {report.allValid && (
            <Btn onClick={() => go("apply")}>Now build the network from it →</Btn>
          )}
        </>
      }
    />
  );
}

function nextHint(s: SsState, r: SsReport): string {
  const parent = ssParent(s);
  for (const c of r.checks) {
    const v = c.violations[0];
    if (!v) continue;
    if (v.code === "TOO_SMALL") return `${c.id} needs ${c.hosts} addresses. /${c.prefix} gives 2^${32 - c.prefix} − 2 = ${c.usable}. Find the smallest h with 2^h − 2 ≥ ${c.hosts}.`;
    if (v.code === "MISALIGNED") return `${c.id} is written at ${ssShort(parent, ipToNum(c.written))}. A /${c.prefix} starts every ${c.block}: ${ssShort(parent, ipToNum(c.written))} is ${c.rem} past ${ssShort(parent, c.realRange.first)}. Devices will use ${ssShort(parent, c.realRange.first)}–${ssShort(parent, c.realRange.last)} whatever you write.`;
    if (v.code === "OUTSIDE_PARENT") return `${c.id}'s real block ${c.real}/${c.prefix} is not inside ${parent.network}/${parent.prefix}. Use only addresses you own.`;
    if (v.code === "OVERLAP") return `${c.id} and ${v.with} both claim ${ssRangeText(parent, v.shared!)}. Move one of them to a free boundary (see Free space below).`;
  }
  const next = s.needs.filter((n) => r.unplaced.includes(n.id)).sort((a, b) => b.hosts - a.hosts)[0];
  if (!next) return r.allValid ? "Every rule passes. Check the free space, then apply the plan to the devices." : "Check the verification below.";
  const row = s.rows.find((x) => x.id === next.id);
  const p = ssMinPrefix(next.hosts);
  if (row?.prefix === undefined) return `Size ${next.id} first (the biggest network still unplaced): ${next.hosts} addresses → the smallest h with 2^h − 2 ≥ ${next.hosts} is ${32 - p}, so /${p} (${blockSize(p)} addresses).`;
  const f = ssCanFit(r.space, next.hosts);
  const size = blockSize(row.prefix);
  const cands = ssCanFit(r.space, Math.max(1, size - 2)).candidates;
  return cands.length ? `${next.id} (/${row.prefix}) can only start on a multiple of ${size}. Free boundaries right now: ${cands.slice(0, 6).map((x) => ssShort(parent, ipToNum(x))).join(", ")}${cands.length > 6 ? " …" : ""}.` : `No free /${row.prefix} boundary is left for ${next.id}${f.enough ? ` — even though ${r.space.free} addresses are free. They are in pieces: move a small block to open an aligned gap.` : "."}`;
}

function PlanEditor({ ss, act, sel, setSel, report }: { ss: SsState; act: (a: SsAction) => SsState; sel?: string; setSel: (s: string) => void; report: SsReport }) {
  return (
    <div className="space-y-2 rounded-2xl border border-pv-border bg-pv-bg-elevated/30 p-3">
      <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-pv-text-faint">Your plan</p>
      {ss.needs.map((n) => (
        <PlanRow key={`${n.id}-${ss.brief}`} ss={ss} act={act} id={n.id} on={sel === n.id} select={() => setSel(n.id)} check={report.checks.find((c) => c.id === n.id)} />
      ))}
      <p className="text-[12px] text-pv-text-faint">Type a start address, use ◀ ▶ to move by one block, or select a network and tap the board.</p>
    </div>
  );
}

function PlanRow({ ss, act, id, on, select, check }: { ss: SsState; act: (a: SsAction) => SsState; id: string; on: boolean; select: () => void; check?: SsCheck }) {
  const n = ss.needs.find((x) => x.id === id)!;
  const row = ss.rows.find((r) => r.id === id)!;
  const parent = ssParent(ss);
  const [text, setText] = useState(row.network ?? base(ss));
  const [hostsT, setHostsT] = useState(String(n.hosts));
  const [seen, setSeen] = useState(row.network);
  if (seen !== row.network) {
    setSeen(row.network);
    setText(row.network ?? base(ss));
  }
  const color = ssColor(ss, id);
  const place = () => act({ type: "place", id, network: text });
  const step = (d: 1 | -1) => {
    if (row.prefix === undefined) return;
    const cur = row.network ? ipToNum(row.network) : P0(ss) - (d === 1 ? blockSize(row.prefix) : 0);
    act({ type: "place", id, network: numToIp(Math.max(0, cur + d * blockSize(row.prefix))) });
  };
  const fit = row.prefix === undefined ? undefined : ssUsable(row.prefix) < n.hosts ? "small" : row.prefix < ssMinPrefix(n.hosts) ? "big" : "ok";
  return (
    <div onClick={select} className={clsx("space-y-1.5 rounded-xl border-2 p-2", on ? "ring-2 ring-white/70" : "")} style={{ borderColor: alpha(color, on ? 0.95 : 0.5), background: alpha(color, on ? 0.12 : 0.05) }}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <button type="button" onClick={select} aria-pressed={on} className="text-[14px] font-bold text-pv-text" style={{ color }}>
          {id}
        </button>
        <span className="text-[12px] text-pv-text-muted">{n.what}</span>
        <label className="ml-auto flex items-center gap-1 text-[12px] text-pv-text-muted">
          needs
          <input value={hostsT} onChange={(e) => setHostsT(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))} onBlur={() => Number(hostsT) !== n.hosts && hostsT !== "" && act({ type: "hosts", id, hosts: Number(hostsT) })} onKeyDown={(e) => e.key === "Enter" && Number(hostsT) !== n.hosts && act({ type: "hosts", id, hosts: Number(hostsT) })} inputMode="numeric" aria-label={`${id} addresses needed`} className="h-7 w-14 rounded-md border border-pv-border bg-pv-bg px-1.5 pv-mono text-[13px] text-pv-text" />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <select value={row.prefix ?? ""} onChange={(e) => act({ type: "size", id, prefix: Number(e.target.value) })} aria-label={`${id} prefix`} className="h-8 rounded-lg border border-pv-border bg-pv-bg px-1.5 pv-mono text-[13.5px] text-pv-text">
          <option value="" disabled>
            size…
          </option>
          {Array.from({ length: SS_PREFIX_MAX - SS_PREFIX_MIN + 1 }, (_, i) => SS_PREFIX_MIN + i).map((p) => (
            <option key={p} value={p}>
              /{p} · {blockSize(p)} ({ssUsable(p)} usable)
            </option>
          ))}
        </select>
        <span className="flex min-w-0 items-center gap-1.5">
        <button type="button" onClick={() => step(-1)} disabled={row.prefix === undefined} aria-label={`Move ${id} one block down`} className="h-8 rounded-lg border border-pv-border px-2 text-[13px] text-pv-text-muted hover:text-pv-text disabled:opacity-40">
          ◀
        </button>
        <input value={text} onChange={(e) => setText(e.target.value.replace(/[^0-9.]/g, "").slice(0, 15))} onKeyDown={(e) => e.key === "Enter" && place()} aria-label={`${id} start address`} className="h-8 w-[8.6rem] min-w-0 shrink rounded-lg border border-pv-border bg-pv-bg px-1.5 pv-mono text-[13.5px] text-pv-text" />
        <button type="button" onClick={() => step(1)} disabled={row.prefix === undefined} aria-label={`Move ${id} one block up`} className="h-8 rounded-lg border border-pv-border px-2 text-[13px] text-pv-text-muted hover:text-pv-text disabled:opacity-40">
          ▶
        </button>
        <button type="button" onClick={place} disabled={row.prefix === undefined} className="h-8 rounded-lg bg-pv-cyan/80 px-2.5 text-[13px] font-semibold text-[#03131a] disabled:opacity-40">
          Place
        </button>
        </span>
        {row.network && (
          <button type="button" onClick={() => act({ type: "clear", id })} className="h-8 rounded-lg border border-pv-border px-2 text-[12.5px] text-pv-text-muted hover:text-pv-text">
            Remove
          </button>
        )}
      </div>
      <p className="text-[12.5px] leading-snug">
        {row.prefix === undefined ? (
          <span className="text-pv-text-muted">
            {n.hosts} addresses → smallest block: <span className="text-pv-text-faint">2^h − 2 ≥ {n.hosts}</span>
          </span>
        ) : (
          <span className={fit === "small" ? "text-pv-danger" : fit === "big" ? "text-pv-warning" : "text-pv-success"}>
            /{row.prefix}: 2^{32 - row.prefix} − 2 = {ssUsable(row.prefix)} {fit === "small" ? `< ${n.hosts}: too small` : fit === "big" ? `≥ ${n.hosts}, but /${ssMinPrefix(n.hosts)} would do (advice)` : `≥ ${n.hosts} ✓ smallest fit`}
          </span>
        )}
        {check && (
          <>
            <br />
            <span className={check.valid ? "text-pv-success" : "text-pv-danger"}>
              {check.valid ? `✓ ${ssRangeText(parent, check.realRange)}` : `✕ ${check.violations.map((v) => (v.code === "OVERLAP" ? `overlaps ${v.with}` : v.code === "MISALIGNED" ? `off boundary → real ${ssShort(parent, check.realRange.first)}` : v.code === "TOO_SMALL" ? "too small" : "outside parent")).join(" · ")}`}
            </span>
          </>
        )}
      </p>
    </div>
  );
}

const Rule = ({ ok, title, children }: { ok: boolean; title: string; children: ReactNode }) => (
  <details className="group rounded-xl border border-pv-border/70 px-2.5 py-1.5" open={!ok}>
    <summary className="flex cursor-pointer items-center gap-2 text-[13.5px] font-semibold outline-none">
      <span className={ok ? "text-pv-success" : "text-pv-danger"}>{ok ? "✓" : "✕"}</span>
      <span className="text-pv-text">{title}</span>
    </summary>
    <div className="mt-1 space-y-0.5 pv-mono text-[12px] leading-snug text-pv-text-muted">{children}</div>
  </details>
);;
/** Verification: each rule, why it passes or fails, row by row — not just a tick. */
export function VerifyPanel({ ss, report: r }: { ss: SsState; report: SsReport }) {
  const parent = ssParent(ss);
  const S = (n: number) => ssShort(parent, n);
  const line = (ok: boolean, k: string, t: ReactNode) => (
    <p key={k} className={ok ? "" : "text-pv-danger"}>
      {ok ? "✓" : "✕"} {t}
    </p>
  );
  return (
    <div className={clsx("space-y-1.5 rounded-2xl border p-3", r.allValid ? "border-pv-success/50 bg-pv-success/[0.06]" : "border-pv-border bg-pv-bg-elevated/30")} aria-live="polite">
      <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-pv-text-faint">Verify the plan</p>
      <p className={clsx("text-[15px] font-semibold", r.allValid ? "text-pv-success" : "text-pv-text")}>
        {r.allValid ? "✓ Valid — every rule holds, and here is why:" : `Not valid yet: ${[!r.allPlaced && `${r.unplaced.length} unplaced`, !r.capacity && "too small", !r.aligned && "off boundary", !r.inside && "outside the parent", !r.noOverlap && "overlap"].filter(Boolean).join(", ")}.`}
      </p>
      <Rule ok={r.allPlaced} title="1 · Every requirement has a block">
        {ss.needs.map((n) => line(!r.unplaced.includes(n.id), n.id, r.unplaced.includes(n.id) ? `${n.id}: not placed yet` : `${n.id}: placed`))}
      </Rule>
      <Rule ok={r.capacity} title="2 · Every block holds its hosts (2^h − 2 ≥ needed)">
        {r.checks.map((c) => line(c.usable >= c.hosts, c.id, `${c.id}: /${c.prefix} → 2^${32 - c.prefix} − 2 = ${c.usable} ${c.usable >= c.hosts ? "≥" : "<"} ${c.hosts}${c.oversized ? ` (advice: /${c.minPrefix} is enough; ${c.oversized} extra addresses)` : ""}`))}
      </Rule>
      <Rule ok={r.aligned} title="3 · Every start is on its own boundary">
        {r.checks.map((c) => line(c.aligned, c.id, c.aligned ? `${c.id}: ${S(c.writtenRange.first)} = ${(c.realRange.first - ipToNum(parent.network)) / c.block} × ${c.block}` : `${c.id}: ${S(c.writtenRange.first)} is ${c.rem} past ${S(c.realRange.first)} (blocks of ${c.block}) → devices use ${S(c.realRange.first)}–${S(c.realRange.last)}`))}
      </Rule>
      <Rule ok={r.inside} title={`4 · Everything is inside ${parent.network}/${parent.prefix}`}>
        {r.checks.map((c) => line(!c.violations.some((v) => v.code === "OUTSIDE_PARENT"), c.id, `${c.id}: ${c.real}/${c.prefix}`))}
      </Rule>
      <Rule ok={r.noOverlap} title="5 · No address belongs to two networks (real blocks)">
        {r.overlaps.map((o) => line(false, o.a + o.b, `${o.a} and ${o.b} share ${ssRangeText(parent, o.shared)}`))}
        {r.adjacent.map((a) => line(true, a.a + a.b, `${a.a} | ${a.b}: adjacent — they touch, nothing shared`))}
        {r.noOverlap && !r.adjacent.length && <p>✓ no two blocks touch or share</p>}
      </Rule>
      <Rule ok={r.checks.length > 0} title="6 · Each subnet's addresses">
        {r.checks.map((c) => (
          <p key={c.id}>
            <b style={{ color: ssColor(ss, c.id) }}>{c.id}</b> net {S(c.realRange.first)} · hosts {S(c.realRange.first + 1)}–{S(c.realRange.last - 1)} · bcast {S(c.realRange.last)} · mask {c.mask}
          </p>
        ))}
        {!r.checks.length && <p>Nothing placed yet.</p>}
      </Rule>
    </div>
  );
}

/** Free space, honestly: ranges, the aligned blocks they hold, and whether a new requirement could really fit. */
export function FreeSpace({ ss, report: r }: { ss: SsState; report: SsReport }) {
  const parent = ssParent(ss);
  const [ask, setAsk] = useState("14");
  const n = Number(ask);
  const fit = ask !== "" && n >= 1 && n <= 254 ? ssCanFit(r.space, n) : undefined;
  return (
    <div className="space-y-1.5 rounded-2xl border border-pv-border bg-pv-bg-elevated/30 p-3">
      <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-pv-text-faint">Free space</p>
      <p className="text-[13.5px] text-pv-text">
        {r.space.allocated} of {r.space.total} used · <b>{r.space.free} free</b>
        {r.space.largestPrefix !== undefined && <> · biggest free block: /{r.space.largestPrefix} ({blockSize(r.space.largestPrefix)})</>}
      </p>
      <ul className="space-y-0.5 pv-mono text-[12.5px] text-pv-text-muted">
        {r.space.ranges.map((x) => (
          <li key={x.first}>
            {ssRangeText(parent, x)} ({x.last - x.first + 1}) = {x.blocks.map((b) => `${ssShort(parent, ipToNum(b.network))}/${b.prefix}`).join(" + ")}
          </li>
        ))}
      </ul>
      <label className="flex flex-wrap items-center gap-2 text-[13px] text-pv-text-muted">
        Could a new network of
        <input value={ask} onChange={(e) => setAsk(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))} inputMode="numeric" aria-label="Hosts for a new network" className="h-8 w-16 rounded-lg border border-pv-border bg-pv-bg px-2 pv-mono text-[14px] text-pv-text" />
        hosts still fit?
      </label>
      {fit && (
        <p className={clsx("text-[13px] leading-snug", fit.fits ? "text-pv-success" : "text-pv-danger")}>
          {fit.hosts} hosts → /{fit.prefix} ({fit.size} addresses, on a multiple of {fit.size}).{" "}
          {fit.fits ? `Yes: free aligned blocks at ${fit.candidates.map((c) => ssShort(parent, ipToNum(c))).join(", ")}.` : fit.enough ? `No — although ${fit.free} addresses are free, no /${fit.prefix} boundary has ${fit.size} free addresses after it. Free count ≠ a free aligned block.` : `No: only ${fit.free} addresses are free.`}
        </p>
      )}
    </div>
  );
}

// =============================================================================================================
// 13 · Build & test (the plan applied to the real topology)
// =============================================================================================================
export function PingTrace({ ss, p }: { ss: SsState; p: SsPing }) {
  const legs = [p.there, ...(p.back ? [p.back] : [])];
  return (
    <ol className="space-y-1 text-[13px] leading-snug">
      {legs.flatMap((l, li) =>
        l.hops.map((h, i) => (
          <li key={`${li}-${i}`} className={clsx("sl-pop rounded-lg border px-2 py-1", h.tone === "bad" ? "border-pv-danger/50 bg-pv-danger/[0.06] text-pv-text" : h.tone === "ok" ? "border-pv-success/40 text-pv-text-muted" : "border-pv-border text-pv-text-muted")}>
            <b className="text-pv-text">{h.at}</b> · {h.text}
            {h.decision && (
              <span className="mt-0.5 block pv-mono text-[12px]">
                {h.decision.ip} AND {maskOf(h.decision.prefix)} = <b className="text-pv-text">{h.decision.srcNet}</b> · {h.decision.dst} AND {maskOf(h.decision.prefix)} = <b className="text-pv-text">{h.decision.dstNet}</b> → <b className={h.decision.local ? "text-pv-warning" : "text-pv-cyan-soft"}>{h.decision.local ? "LOCAL" : "REMOTE"}</b>
              </span>
            )}
          </li>
        )),
      )}
      <li className={clsx("font-semibold", p.ok ? "text-pv-success" : "text-pv-danger")}>{p.ok ? `✓ ${ssDevName(ss.needs, p.src)} got its reply — from ${ssDevName(ss.needs, p.there.arrived ?? "")}.` : "✕ No reply."}</li>
    </ol>
  );
}

function useNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(max-width: 639px)");
    const f = () => setNarrow(m.matches);
    f();
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return narrow;
}

/** One LAN, end to end: its block on the board → its devices and the addresses they really use. */
function MappingStrip({ ss, wire }: { ss: SsState; wire: string }) {
  const parent = ssParent(ss);
  const n = ss.needs.find((x) => x.id === wire);
  if (!n) return null;
  const row = ssCheck(parent, ss.needs, ss.rows, wire);
  const m = ssMatch(parent, ss.needs, ss.rows, ss.net).find((x) => x.id === wire)!;
  const i = ss.net.r1[wire];
  const color = ssColor(ss, wire);
  return (
    <div className="mt-2 rounded-xl border-2 p-2 text-[12.5px]" style={{ borderColor: alpha(color, 0.7) }}>
      <p className="font-bold" style={{ color }}>
        {wire} · needs {n.hosts}
      </p>
      <p className="pv-mono text-pv-text">
        block {row ? `${row.real}/${row.prefix} (${ssRangeText(parent, row.realRange)}, ${row.usable} usable)` : "— not in the plan yet"}
      </p>
      <ul className="mt-0.5 space-y-0.5 pv-mono">
        <li className={m.r1.length ? "text-pv-danger" : "text-pv-success"}>
          {m.r1.length ? "✕" : "✓"} R1 {ssShortIf(n.iface)} {i?.ip ? `${i.ip}/${i.prefix}` : "unassigned"} <span className="font-sans text-pv-text-muted">{m.r1[0] ?? "gateway of this LAN"}</span>
        </li>
        {m.devices.map((d) => {
          const h = ss.net.hosts[d.id];
          return (
            <li key={d.id} className={d.problems.length ? "text-pv-danger" : "text-pv-success"}>
              {d.problems.length ? "✕" : "✓"} {ssDevName(ss.needs, d.id)} {h?.ip ? `${h.ip}/${h.prefix} gw ${h.gw ?? "none"}` : "no address"} <span className="font-sans text-pv-text-muted">{d.problems[0] ?? ""}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Size of an element (for fitting the square board into the desk). */
function useSize() {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | undefined>(undefined);
  useLayoutEffect(() => {
    if (!el) return;
    const upd = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    upd();
    const ro = new ResizeObserver(upd);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, size] as const;
}
function useWide() {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(min-width: 1024px)");
    const f = () => setWide(m.matches);
    f();
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return wide;
}
/** The height the desk may use: the lab's scroll area minus its pinned chapter rail (so the page itself doesn't scroll). */
function useDeskHeight() {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [h, setH] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const sec = el?.closest("section");
    if (!el || !sec) return;
    const pinned = sec.firstElementChild as HTMLElement | null;
    const upd = () => setH(Math.max(560, sec.clientHeight - (pinned?.getBoundingClientRect().height ?? 0) - 26));
    upd();
    const ro = new ResizeObserver(upd);
    ro.observe(sec);
    if (pinned) ro.observe(pinned);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, h] as const;
}

/**
 * THE ENGINEERING DESK (Build & test, Troubleshoot on desktop): full lab width, two columns that fill the viewport
 * height — the network on the left (scaled to the space), the workspace on the right with its own scroll — so the
 * page itself stays still. Below lg it stacks like every other chapter.
 */
function Desk({ left, right, hint }: { left: (fill: boolean) => ReactNode; right: ReactNode; hint?: ReactNode }) {
  const [ref, h] = useDeskHeight();
  const wide = useWide();
  return (
    <div ref={ref} className="mx-auto grid w-full max-w-[2400px] gap-4 lg:grid-cols-[minmax(0,1.75fr)_minmax(380px,1fr)] 2xl:grid-cols-[minmax(0,1.6fr)_minmax(520px,1fr)]" style={wide && h ? { height: h } : undefined}>
      <style>{MOTION_CSS}</style>
      <div className="flex min-w-0 flex-col rounded-2xl border border-pv-cyan/25 bg-pv-bg-elevated/30 p-2.5 sm:p-3 lg:min-h-0">
        <div className={wide ? "min-h-0 flex-1" : undefined}>{left(wide)}</div>
        {hint && <div className="mt-1.5 shrink-0 text-center text-[12.5px] text-pv-text-faint">{hint}</div>}
      </div>
      <div className="min-w-0 space-y-3 lg:min-h-0 lg:overflow-y-auto lg:pr-2">{right}</div>
    </div>
  );
}

/** The same design seen two ways: the network (devices, links, live config, packets) and the address space (blocks + the squares devices use). */
export function TwoViews({ ss, openWin, ping, pingKey, initial = "network", written, marks, fill = false, below }: { ss: SsState; openWin: (id: string) => void; ping?: SsPing; pingKey?: string | number; initial?: "network" | "board"; written?: boolean; marks?: { o: number; ring: "ok" | "bad" | "info" }[]; /** Fill the Engineer desk's height (desktop). */ fill?: boolean; below?: ReactNode }) {
  const [main, size] = useSize();
  const [view, setView] = useState<"network" | "board">(initial);
  const [focus, setFocus] = useState<string | undefined>(undefined);
  const [pinned, setPinned] = useState<string | undefined>(undefined);
  const narrow = useNarrow();
  const parent = ssParent(ss);
  const wire = focus ?? pinned;
  const { cells, overlays, report } = studioBoard(ss, written ? "written" : "real", { slide: !written });
  for (const d of deviceMarks(ss)) cells[d.o] = { ...cells[d.o], tag: d.tag, ring: d.ok ? "ok" : "bad" };
  for (const m of marks ?? []) if (m.o >= 0 && m.o < 256) cells[m.o] = { ...cells[m.o], ring: m.ring };
  if (wire) {
    const row = report.checks.find((c) => c.id === wire);
    if (row) paint(cells, row.realRange.first - P0(ss), row.block, () => ({ groupColor: "#ffffff" }));
  }
  // The square address board fits the space left for it: never taller than the desk can show.
  const side = fill && size ? Math.max(260, Math.min(size.w, size.h - 64)) : undefined;
  return (
    <div className={fill ? "flex h-full min-h-0 flex-col" : undefined}>
      <div className="mb-2 flex shrink-0 flex-wrap items-center gap-1.5" role="group" aria-label="View">
        <Btn tone="quiet" pressed={view === "network"} onClick={() => setView("network")}>
          Network
        </Btn>
        <Btn tone="quiet" pressed={view === "board"} onClick={() => setView("board")}>
          Address space
        </Btn>
        <span className="text-[12px] text-pv-text-faint">two views of one design — pick a LAN:</span>
        <span className="flex flex-wrap gap-1">
          {ss.needs.map((n) => (
            <button key={n.id} type="button" aria-pressed={pinned === n.id} onClick={() => setPinned((p) => (p === n.id ? undefined : n.id))} className={clsx("rounded-full border px-2 py-0.5 text-[11.5px] font-semibold", pinned === n.id ? "text-[#03131a]" : "text-pv-text-muted")} style={{ borderColor: ssColor(ss, n.id), background: pinned === n.id ? ssColor(ss, n.id) : "transparent" }}>
              {n.id}
            </button>
          ))}
        </span>
      </div>
      <div ref={main} className={fill ? "min-h-0 flex-1" : undefined}>
        {view === "network" ? (
          <SubnetTopology ss={ss} color={(id) => ssColor(ss, id)} focus={wire} setFocus={setFocus} onOpen={openWin} ping={ping} pingKey={pingKey} narrow={narrow} fill={fill} />
        ) : (
          <div className="mx-auto" style={side ? { width: side } : undefined}>
            <AddressGrid cells={cells} base={base(ss)} overlays={overlays} label={`Address board ${parent.network}/${parent.prefix} with device addresses`} footer={<Legend items={[...ss.needs.map((n) => ({ color: ssColor(ss, n.id), label: n.id })), { color: "#34d399", label: "R / 1 / 2: a device's address (green ring = inside its block)" }, { color: "#f87171", label: "claimed twice", clash: true }]} />} />
            <OutsideNote s={ss} r={report} />
          </div>
        )}
      </div>
      <div className={fill ? "shrink-0" : undefined}>
        <div className={fill ? "h-[150px] overflow-y-auto" : undefined}>
          {wire ? <MappingStrip ss={ss} wire={wire} /> : <p className="mt-1.5 text-center text-[12px] text-pv-text-faint">Point at a LAN (or pick one above) to see its block, its interface and its devices together.</p>}
        </div>
        {below}
      </div>
    </div>
  );
}

/** Device verification: did I apply the plan correctly? (A valid plan can still be configured wrongly.) */
function DeviceCheck({ ss }: { ss: SsState }) {
  const parent = ssParent(ss);
  const m = ssMatch(parent, ss.needs, ss.rows, ss.net);
  const r = ssStateReport(ss);
  const bad = m.filter((x) => !x.ok);
  return (
    <div className="space-y-1.5 rounded-2xl border border-pv-border bg-pv-bg-elevated/30 p-3">
      <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-pv-text-faint">Two different questions</p>
      <p className={clsx("text-[13.5px]", r.allValid ? "text-pv-success" : "text-pv-danger")}>
        {r.allValid ? "✓" : "✕"} <b>1 · Is the plan valid?</b> {r.allValid ? "Every rule holds (see Design → Verify)." : "No — fix it in Design first, or apply it anyway and watch what breaks."}
      </p>
      <p className={clsx("text-[13.5px]", bad.length ? "text-pv-danger" : "text-pv-success")}>
        {bad.length ? "✕" : "✓"} <b>2 · Do the devices match the plan?</b> {bad.length ? `${bad.length} network${bad.length > 1 ? "s" : ""} not yet:` : "Every interface, address, mask and gateway agrees with the design."}
      </p>
      {bad.length > 0 && (
        <ul className="space-y-0.5 pl-4 text-[12.5px] text-pv-text-muted">
          {bad.map((x) => (
            <li key={x.id}>
              <b style={{ color: ssColor(ss, x.id) }}>{x.id}</b>: {[...x.r1, ...x.host].slice(0, 2).join("; ")}
              {[...x.r1, ...x.host].length > 2 ? " …" : ""}
            </li>
          ))}
        </ul>
      )}
      <p className="text-[12px] text-pv-text-faint">A correct plan can be configured wrongly, and a configuration the devices accept can still break the plan. Check both — then prove it with traffic.</p>
    </div>
  );
}

function buildHint(ss: SsState): string {
  const parent = ssParent(ss);
  const r = ssStateReport(ss);
  const steps = ssBuildSteps(ss);
  const next = steps.find((x) => !x.ok);
  if (!next) return "Everything is built and proven. Try breaking one thing on purpose (a host mask, an R1 address) and watch the test show exactly where.";
  if (next.k === "plan") return `First the plan (Design). ${nextHint(ss, r)}`;
  const m = ssMatch(parent, ss.needs, ss.rows, ss.net);
  if (next.k === "r1") {
    const x = m.find((y) => y.r1.length)!;
    const n = ss.needs.find((y) => y.id === x.id)!;
    const row = r.checks.find((c) => c.id === x.id)!;
    return `R1 ${ssShortIf(n.iface)} faces ${x.id}. Its address must be a usable address of your ${x.id} block (${ssRangeText(parent, row.realRange)}: not the network, not the broadcast); by convention a router takes the first usable one. The mask must be the block's: /${row.prefix} = ${row.mask}. Open R1 → Configure or Console. Now: ${x.r1[0]}.`;
  }
  if (next.k === "hosts") {
    const x = m.find((y) => y.host.length)!;
    const d = x.devices.find((y) => y.problems.length)!;
    const row = r.checks.find((c) => c.id === x.id)!;
    return `${ssDevName(ss.needs, d.id)} is on ${x.id}. It needs an unused usable address of ${ssRangeText(parent, row.realRange)}, the same mask as the block (/${row.prefix}), and R1's ${x.id} address as its gateway. Open it → Network settings. Now: ${d.problems[0]}.`;
  }
  return "Run Test all paths. A red cell shows the path that fails; click it to see each device's decision, and play it on the topology.";
}

function BuildMission({ ss }: { ss: SsState }) {
  const [hint, setHint] = useState<string | undefined>(undefined);
  const steps = ssBuildSteps(ss);
  const done = steps.every((x) => x.ok);
  return (
    <div className={clsx("space-y-1.5 rounded-2xl border p-3", done ? "border-pv-success/50 bg-pv-success/[0.07]" : "border-pv-cyan/40 bg-pv-cyan/[0.04]")}>
      <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-pv-text-faint">Build it yourself</p>
      <ol className="space-y-0.5">
        {steps.map((x, i) => (
          <li key={x.k} className={clsx("text-[13.5px]", x.ok ? "text-pv-success" : "text-pv-text")}>
            {x.ok ? "✓" : `${i + 1}.`} {x.label} <span className="text-[12px] text-pv-text-faint">— {x.detail}</span>
          </li>
        ))}
      </ol>
      {done ? (
        <p className="text-[13.5px] font-semibold text-pv-success">✓ You subnetted this network, configured it from your own plan, and proved every path works.</p>
      ) : (
        <Btn tone="quiet" onClick={() => setHint(buildHint(ss))}>
          Hint: what next?
        </Btn>
      )}
      {hint && !done && <p className="sl-pop rounded-lg bg-pv-bg/60 px-2.5 py-1.5 text-[13px] leading-snug text-pv-text">{hint}</p>}
    </div>
  );
}

export function StudioApply({ ss, act, openWin, go }: StudioProps) {
  const [pick, setPick] = useState<{ src: string; dst: string } | undefined>(undefined);
  const devs = ssDevices(ss.needs).filter((d) => ss.net.hosts[d.id]?.ip);
  const all = ssDevices(ss.needs);
  const [src, setSrc] = useState(all[0]?.id ?? "");
  const [dst, setDst] = useState("");
  const traced = pick ? ss.test?.results.find((x) => x.src === pick.src && x.dstDev === pick.dst)?.ping : undefined;
  const [shown, setShown] = useState<{ p: SsPing; key: string } | undefined>(undefined);
  const addrs = [...all.map((d) => ss.net.hosts[d.id]?.ip && { ip: ss.net.hosts[d.id].ip!, label: `${d.name} (${d.wire})` }), ...ss.needs.map((n) => ss.net.r1[n.id]?.ip && { ip: ss.net.r1[n.id].ip!, label: `R1 ${ssShortIf(n.iface)}` })].filter((x): x is { ip: string; label: string } => !!x);
  const ping = () => {
    const d = dst || addrs[0]?.ip;
    if (!src || !d) return;
    const n = act({ type: "ping", src, dst: d });
    if (n.lastPing) setShown({ p: n.lastPing, key: `p${n.seq}` });
  };
  const stale = ss.test && ss.test.seq < ss.changeSeq;
  const choose = (s: string, d: string) => {
    setPick({ src: s, dst: d });
    const p = ss.test?.results.find((x) => x.src === s && x.dstDev === d)?.ping;
    if (p) setShown({ p, key: `t${ss.test!.seq}-${s}-${d}` });
  };
  return (
    <Desk
      left={(fill) => <TwoViews ss={ss} openWin={openWin} ping={shown?.p} pingKey={shown?.key} fill={fill} />}
      hint="Click R1 or any device to open it · a ping plays on the topology"
      right={
        <>
          <Lead kicker="Engineer · Build & test" title="Configure the network from your plan — then prove it">
            <p>Every device starts empty. Open R1 and give each interface an address from its LAN&apos;s block; open each PC and server and give it an address, mask and gateway from the same block. Then test every path and watch the packets.</p>
          </Lead>
          {ss.ticket ? <TicketBanner ss={ss} go={go} /> : <BuildMission ss={ss} />}
          <div className="flex flex-wrap gap-2">
            <Btn onClick={() => (act({ type: "test-all" }), setPick(undefined))} disabled={devs.length < 2}>
              Test all paths
            </Btn>
          </div>
          {ss.test && (
            <div className="rounded-2xl border border-pv-border bg-pv-bg-elevated/30 p-3">
              <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-pv-text-faint">Test all {stale && <span className="text-pv-warning">· out of date: something changed since</span>}</p>
              <div className="mt-1 overflow-x-auto">
                <table className="text-[12px]">
                  <thead>
                    <tr>
                      <th className="px-1 text-left text-pv-text-faint">from ↓ to →</th>
                      {devs.map((d) => (
                        <th key={d.id} className="px-0.5 font-semibold" style={{ color: ssColor(ss, d.wire) }}>
                          {d.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {devs.map((s) => (
                      <tr key={s.id}>
                        <th className="whitespace-nowrap px-1 text-left font-semibold" style={{ color: ssColor(ss, s.wire) }}>
                          {s.name}
                        </th>
                        {devs.map((d) => {
                          const res = ss.test!.results.find((x) => x.src === s.id && x.dstDev === d.id);
                          return (
                            <td key={d.id} className="px-0.5 py-0.5 text-center">
                              {s.id === d.id ? (
                                <span className="text-pv-text-faint">—</span>
                              ) : res ? (
                                <button type="button" onClick={() => choose(s.id, d.id)} aria-label={`${s.name} to ${d.name}: ${res.ok ? "reply" : res.wrong ? "answered by the wrong device" : "failed"}`} className={clsx("h-7 w-8 rounded-md border font-bold", res.ok ? "border-pv-success/50 text-pv-success" : res.wrong ? "border-pv-warning/70 bg-pv-warning/10 text-pv-warning" : "border-pv-danger/60 bg-pv-danger/10 text-pv-danger", pick?.src === s.id && pick.dst === d.id && "ring-2 ring-white/70")}>
                                  {res.ok ? "✓" : res.wrong ? "?" : "✕"}
                                </button>
                              ) : (
                                "·"
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-1 text-[12.5px] text-pv-text-muted">
                {ss.test.results.filter((x) => x.ok).length}/{ss.test.results.length} answered by the right device{ss.test.results.some((x) => x.wrong) ? " (? = a reply came from a different device)" : ""}. Click a cell to see why and play it on the topology.
              </p>
              {traced && pick && (
                <div className="mt-2">
                  <p className="mb-1 text-[13px] font-semibold text-pv-text">
                    {ssDevName(ss.needs, pick.src)} → {ssDevName(ss.needs, pick.dst)}
                  </p>
                  <PingTrace ss={ss} p={traced} />
                </div>
              )}
            </div>
          )}
          <DeviceCheck ss={ss} />
          <div className="space-y-1.5 rounded-2xl border border-pv-border bg-pv-bg-elevated/30 p-3">
            <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-pv-text-faint">One ping</p>
            <div className="flex flex-wrap items-center gap-1.5 text-[13px] text-pv-text-muted">
              from
              <select value={src} onChange={(e) => setSrc(e.target.value)} aria-label="Ping from" className="h-8 rounded-lg border border-pv-border bg-pv-bg px-1.5 text-[13px] text-pv-text">
                {all.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              to
              <select value={dst} onChange={(e) => setDst(e.target.value)} aria-label="Ping to" className="h-8 max-w-[13rem] rounded-lg border border-pv-border bg-pv-bg px-1.5 text-[13px] text-pv-text">
                {addrs.map((a) => (
                  <option key={a.ip + a.label} value={a.ip}>
                    {a.ip} · {a.label}
                  </option>
                ))}
              </select>
              <Btn tone="quiet" onClick={ping} disabled={!addrs.length}>
                Ping
              </Btn>
            </div>
            {shown && shown.key.startsWith("p") && <PingTrace ss={ss} p={shown.p} />}
          </div>
          {!ss.ticket && (
            <details className="rounded-2xl border border-pv-border px-3 py-2">
              <summary className="cursor-pointer text-[13px] font-semibold text-pv-text-muted outline-none">Shortcut: fill every device from the plan (skips the exercise)</summary>
              <p className="mt-1 text-[12.5px] text-pv-text-muted">Gives R1 the first address after each written start, each device the 10th, 11th … with the row&apos;s mask and R1 as gateway — exactly what an admin would do from your table, including its mistakes.</p>
              <Btn tone="quiet" onClick={() => act({ type: "apply" })} disabled={!ss.rows.some((x) => x.network && x.prefix !== undefined)}>
                Fill the devices from the plan
              </Btn>
              {ss.last && /^Plan applied/.test(ss.last.text) && <p className={clsx("mt-1 text-[12.5px]", ss.last.tone === "warn" ? "text-pv-warning" : "text-pv-text-muted")}>{ss.last.text}</p>}
            </details>
          )}
          <Idea>
            <p>Every host decides LOCAL or REMOTE with its OWN address and mask, then ARPs for the destination (local) or for its gateway (remote). If the plan, R1&apos;s interface and the host all describe the same block, every path works; if any one disagrees, the packets show exactly where.</p>
          </Idea>
        </>
      }
    />
  );
}

// =============================================================================================================
// 14 · Troubleshoot
// =============================================================================================================
function TicketBanner({ ss, go }: { ss: SsState; go: (k: "design" | "apply" | "trouble") => void }) {
  const t = ssTicket(ss.ticket!);
  const solved = ssProofs(ss).every((p) => p.ok);
  return (
    <div className={clsx("flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-[13px]", solved ? "border-pv-success/50 bg-pv-success/[0.07]" : "border-pv-warning/50 bg-pv-warning/[0.07]")}>
      <span className="text-pv-text">
        Ticket: <b>{t.title}</b> {solved ? "· ✓ solved" : "· open"}
      </span>
      <button type="button" onClick={() => go("trouble")} className="ml-auto text-[12.5px] font-semibold text-pv-cyan-soft underline-offset-2 hover:underline">
        Back to the ticket →
      </button>
    </div>
  );
}

type Rung = { k: string; title: string; text: (s: SsState) => ReactNode };
const tk = (s: SsState) => ssTicket(s.ticket!);
const wireOf = (s: SsState, dev: string) => ssDevice(s.needs, dev)?.wire ?? dev;
const RUNGS: Rung[] = [
  {
    k: "symptom",
    title: "Symptom: what exactly fails?",
    text: (s) => {
      const t = tk(s);
      const d = s.net.hosts[t.dst]?.ip;
      if (!s.net.hosts[t.src]?.ip) return `${ssDevName(s.needs, t.src)} has no address at all: ${wireOf(s, t.src)} has no subnet in the plan.`;
      const p = d ? ssPing(s.needs, s.net, t.src, d) : undefined;
      if (!p) return "No destination address.";
      if (p.ok && p.there.arrived !== t.dst) return `${ssDevName(s.needs, t.src)} → ${d} gets a reply — but from ${ssDevName(s.needs, p.there.arrived ?? "")}, not ${ssDevName(s.needs, t.dst)}.`;
      return p.ok ? `${ssDevName(s.needs, t.src)} → ${d} works now.` : `${ssDevName(s.needs, t.src)} → ${d} fails: ${[...p.there.hops, ...(p.back?.hops ?? [])].find((h) => h.tone === "bad")?.text}`;
    },
  },
  {
    k: "plan",
    title: "What should these networks be? (the plan)",
    text: (s) => {
      const t = tk(s);
      const parent = ssParent(s);
      return [t.src, t.dst]
        .map((d) => wireOf(s, d))
        .filter((w, i, a) => a.indexOf(w) === i)
        .map((w) => {
          const c = ssCheck(parent, s.needs, s.rows, w);
          const n = s.needs.find((x) => x.id === w)!;
          return c ? `${w} needs ${n.hosts}: written ${c.written}/${c.prefix} → real block ${c.real}/${c.prefix} (${ssRangeText(parent, c.realRange)}, ${c.usable} usable)` : `${w} needs ${n.hosts}: no block in the plan`;
        })
        .join(" · ");
    },
  },
  {
    k: "config",
    title: "What did we actually configure?",
    text: (s) => {
      const t = tk(s);
      return [t.src, t.dst]
        .map((d) => {
          const h = s.net.hosts[d];
          const i = s.net.r1[wireOf(s, d)];
          return `${ssDevName(s.needs, d)}: ${h?.ip ? `${h.ip}/${h.prefix} (${maskOf(h.prefix!)}), gateway ${h.gw ?? "none"}` : "no address"} — R1 on ${wireOf(s, d)}: ${i?.ip ? `${i.ip}/${i.prefix}` : "unassigned"}`;
        })
        .join(" · ");
    },
  },
  {
    k: "believes",
    title: "What does each host believe?",
    text: (s) => {
      const t = tk(s);
      return [t.src, t.dst]
        .map((d) => {
          const h = s.net.hosts[d];
          if (!h?.ip || h.prefix === undefined) return `${ssDevName(s.needs, d)} believes nothing (no address)`;
          const net = ssNetOf(h.ip, h.prefix);
          const row = ssCheck(ssParent(s), s.needs, s.rows, wireOf(s, d));
          return `${ssDevName(s.needs, d)}: ${h.ip} AND ${maskOf(h.prefix)} = ${net} → "my wire is ${net}/${h.prefix}"${row ? (row.real === net && row.prefix === h.prefix ? " (= the plan's block)" : ` — the plan's block is ${row.real}/${row.prefix}: NOT the same`) : ""}`;
        })
        .join(" · ");
    },
  },
  {
    k: "router",
    title: "What does the router believe?",
    text: (s) => {
      const parent = ssParent(s);
      const routes = ssR1Routes(s.needs, s.net);
      const lines = s.needs.map((n) => {
        const r = routes.find((x) => x.id === n.id);
        const c = ssCheck(parent, s.needs, s.rows, n.id);
        return `${ssShortIf(n.iface)} ${n.id}: ${r ? `connected ${r.network}/${r.prefix}` : "no connected route"}${c ? (r && r.network === c.real && r.prefix === c.prefix ? " ✓" : ` ≠ plan ${c.real}/${c.prefix}`) : ""}`;
      });
      return `R1's connected routes (all it can deliver to): ${lines.join(" · ")}`;
    },
  },
  {
    k: "decision",
    title: "Local or remote?",
    text: (s) => {
      const t = tk(s);
      const h = s.net.hosts[t.src];
      const d = s.net.hosts[t.dst];
      if (!d?.ip || !h?.ip || h.prefix === undefined) return "No decision possible without addresses.";
      const local = ssNetOf(d.ip, h.prefix) === ssNetOf(h.ip, h.prefix);
      const same = wireOf(s, t.src) === wireOf(s, t.dst);
      return local ? `LOCAL (${d.ip} AND /${h.prefix} = ${ssNetOf(d.ip, h.prefix)}) — so it ARPs for ${d.ip} on its own wire.${same ? " Both really are on the same switch, so that's correct." : " But the destination is on another wire behind R1: nobody answers. The host is obeying its mask; ask why its mask/plan says local."}` : `REMOTE — it must reach its gateway ${h.gw ?? "(none!)"}${h.gw ? `, which is ${ssNetOf(h.gw, h.prefix) === ssNetOf(h.ip, h.prefix) ? "on its subnet" : "NOT on its subnet"}` : ""}.${same ? " But the destination is on the SAME switch: a correct mask would have said LOCAL." : ""}`;
    },
  },
  {
    k: "path",
    title: "What path did the packet take?",
    text: (s) => {
      const t = tk(s);
      const d = s.net.hosts[t.dst]?.ip;
      if (!d || !s.net.hosts[t.src]?.ip) return "Nothing was sent.";
      const p = ssPing(s.needs, s.net, t.src, d);
      return `${p.frames.map((f, i) => `${i + 1}. ${f.text}`).join(" → ")}. (Re-run the failing ping to watch it on the topology.)`;
    },
  },
  {
    k: "overlap",
    title: "Rule check: do any subnets overlap?",
    text: (s) => {
      const r = ssStateReport(s);
      const parent = ssParent(s);
      return r.overlaps.length ? `Yes: ${r.overlaps.map((o) => `${o.a} and ${o.b} share ${ssRangeText(parent, o.shared)}`).join("; ")} (real blocks). Overlap is a consequence — something made a block bigger or put it somewhere it shouldn't be.` : `No: no two real blocks share an address${r.adjacent.length ? ` (${r.adjacent.map((a) => `${a.a}|${a.b}`).join(", ")} are adjacent, which is fine)` : ""}.`;
    },
  },
  {
    k: "aligned",
    title: "Rule check: is every network address aligned?",
    text: (s) => {
      const r = ssStateReport(s);
      const parent = ssParent(s);
      const mis = r.checks.filter((c) => !c.aligned);
      return mis.length ? mis.map((c) => `${c.id} is written ${c.written}/${c.prefix}: /${c.prefix} boundaries are every ${c.block}, and ${ssShort(parent, c.writtenRange.first)} is ${c.rem} past ${ssShort(parent, c.realRange.first)}. Real block: ${ssRangeText(parent, c.realRange)}.`).join(" ") : `Yes: ${r.checks.map((c) => `${c.id} ${ssShort(parent, c.writtenRange.first)} rem ${c.rem}`).join(", ")}.`;
    },
  },
  {
    k: "capacity",
    title: "Rule check: is every block big enough, and is every device inside its block?",
    text: (s) => {
      const r = ssStateReport(s);
      const parent = ssParent(s);
      const small = r.checks.filter((c) => c.usable < c.hosts).map((c) => `${c.id} needs ${c.hosts} but a /${c.prefix} holds ${c.usable}`);
      const out = ssDevices(s.needs)
        .filter((d) => s.net.hosts[d.id]?.ip)
        .map((d) => ({ d, c: r.checks.find((c) => c.id === d.wire) }))
        .filter((x) => x.c && !ssInside(s.net.hosts[x.d.id].ip!, x.c.real, x.c.prefix))
        .map((x) => `${x.d.name} ${s.net.hosts[x.d.id].ip} is outside ${x.c!.id} (${ssRangeText(parent, x.c!.realRange)})`);
      const dup = ssDevices(s.needs).filter((d) => s.net.hosts[d.id]?.ip && ssDevices(s.needs).some((o) => o.id !== d.id && s.net.hosts[o.id]?.ip === s.net.hosts[d.id].ip));
      return [small.length ? `${small.join("; ")}.` : "Every block holds its requirement.", out.length ? `${out.join("; ")}.` : "Every device is inside its block.", dup.length ? `${dup.map((d) => d.name).join(" and ")} use the same address ${s.net.hosts[dup[0].id].ip}.` : "Every address is unique."].join(" ");
    },
  },
  {
    k: "mask",
    title: "What does the mask really mean?",
    text: (s) => {
      const t = tk(s);
      const h = s.net.hosts[t.src];
      const row = ssCheck(ssParent(s), s.needs, s.rows, wireOf(s, t.src));
      if (!h?.prefix) return "No mask to read.";
      return `/${h.prefix} = ${maskOf(h.prefix)}: ${32 - h.prefix} host bits, a block of ${blockSize(h.prefix)} addresses.${row ? ` The plan's /${row.prefix} is a block of ${row.block}. ${row.prefix === h.prefix ? "Same size." : `The host's block is ${blockSize(h.prefix) > row.block ? `${blockSize(h.prefix) / row.block}× bigger than its real subnet: it thinks addresses far outside its wire are next door.` : "smaller than its real subnet."}`}` : ""}`;
    },
  },
  {
    k: "gateway",
    title: "Is the gateway inside the host's subnet, and is it R1?",
    text: (s) => {
      const t = tk(s);
      const h = s.net.hosts[t.src];
      const i = s.net.r1[wireOf(s, t.src)];
      if (!h?.ip || h.prefix === undefined) return "No address, no gateway.";
      if (!h.gw) return "No gateway configured.";
      const on = ssNetOf(h.gw, h.prefix) === ssNetOf(h.ip, h.prefix);
      return `${h.gw} AND /${h.prefix} = ${ssNetOf(h.gw, h.prefix)} — ${on ? "on its subnet" : `NOT its subnet (${ssNetOf(h.ip, h.prefix)})`}. R1's address on ${wireOf(s, t.src)}: ${i?.ip ?? "unassigned (R1 refused or has no address there)"}${i?.ip ? (i.ip === h.gw ? " — matches." : " — does not match.") : ""}`;
    },
  },
  {
    k: "free",
    title: "Is there an aligned block free for every requirement?",
    text: (s) => {
      const r = ssStateReport(s);
      const parent = ssParent(s);
      const un = s.needs.filter((n) => r.unplaced.includes(n.id));
      if (!un.length) return `Every requirement has a block. Free: ${r.space.free} (${r.space.ranges.map((x) => ssRangeText(parent, x)).join(", ") || "none"}).`;
      return un
        .map((n) => {
          const f = ssCanFit(r.space, n.hosts);
          return `${n.id} needs ${n.hosts} → /${f.prefix} (${f.size}). Free: ${f.free} addresses in ${r.space.ranges.length} pieces (${r.space.ranges.map((x) => `${ssRangeText(parent, x)}`).join(", ")}). Aligned /${f.prefix} blocks free: ${f.candidates.length ? f.candidates.map((c) => ssShort(parent, ipToNum(c))).join(", ") : "none"}.`;
        })
        .join(" ");
    },
  },
];

export function StudioTrouble({ ss, act, openWin, go, desk: kept }: StudioProps) {
  const own = useState<TroubleDesk>(EMPTY_DESK);
  const [{ shown, guess, found }, setDesk] = kept ?? own;
  const [view, setView] = useState<"real" | "written">("real");
  const [shownPing, setShownPing] = useState<{ p: SsPing; key: string } | undefined>(undefined);
  const t = ss.ticket ? ssTicket(ss.ticket) : undefined;
  const { report } = studioBoard(ss, view, { slide: view === "real" });
  const proofs = t ? ssProofs(ss) : [];
  const solved = !!t && proofs.every((p) => p.ok);
  const fb = guess && t ? guess.fb : undefined;
  const parent = ssParent(ss);
  const start = (id: (typeof SS_TICKETS)[number]["id"]) => {
    act({ type: "ticket", id });
    setDesk(EMPTY_DESK);
    setView("real");
    setShownPing(undefined);
  };
  const marks: { o: number; ring: "ok" | "bad" | "info" }[] = [];
  if (t) {
    const d = ss.net.hosts[t.dst]?.ip;
    if (d) marks.push({ o: ipToNum(d) - P0(ss), ring: "info" });
    const sip = ss.net.hosts[t.src]?.ip;
    if (sip) marks.push({ o: ipToNum(sip) - P0(ss), ring: "bad" });
  }
  const rerun = () => {
    if (!t || !ss.net.hosts[t.dst]?.ip) return;
    const n = act({ type: "ping", src: t.src, dst: ss.net.hosts[t.dst].ip! });
    if (n.lastPing) setShownPing({ p: n.lastPing, key: `tp${n.seq}` });
  };
  const mis = report.checks.filter((c) => !c.aligned);
  return (
    <Desk
      left={(fill) =>
        t ? (
          <TwoViews
            key={t.id}
            ss={ss}
            openWin={openWin}
            ping={shownPing?.p}
            pingKey={shownPing?.key}
            written={view === "written"}
            marks={marks}
            fill={fill}
            below={
              <div className="mt-2 flex flex-wrap justify-center gap-1.5" role="group" aria-label="Board view">
                <span className="text-[12px] text-pv-text-faint">Address space shows:</span>
                <Btn tone="quiet" pressed={view === "written"} onClick={() => setView("written")}>
                  The plan as written
                </Btn>
                <Btn tone="quiet" pressed={view === "real"} onClick={() => setView("real")}>
                  As devices compute it
                </Btn>
              </div>
            }
          />
        ) : (
          <p className="p-6 text-center text-[14px] text-pv-text-muted">Pick a ticket: its network appears here, as a topology and as address space.</p>
        )
      }
      hint={t ? "Red ring: the failing host · white ring: its destination · click a device to open it" : "Pick a ticket"}
      right={
        <>
          <Lead kicker="Engineer · Troubleshoot" title="Troubleshoot addressing from evidence">
            <p>Each ticket is a real network with one addressing mistake. Reproduce the symptom, climb the evidence ladder, name the root cause, fix it in the plan or on the devices, then prove it.</p>
          </Lead>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {SS_TICKETS.map((x) => (
              <button key={x.id} type="button" onClick={() => start(x.id)} aria-pressed={ss.ticket === x.id} className={clsx("rounded-xl border px-3 py-2 text-left", ss.ticket === x.id ? "border-pv-cyan bg-pv-cyan/10" : "border-pv-border hover:border-pv-cyan/50")}>
                <span className="block text-[13.5px] font-semibold text-pv-text">{x.title}</span>
                <span className="block text-[12px] text-pv-text-muted">{ssBrief(x.brief).parent.network}/24</span>
              </button>
            ))}
          </div>
          {!t ? (
            <Now k="none" title="Pick a ticket to load its network." />
          ) : (
            <>
              <Now k={t.id} tone="warn" title={t.title}>
                <p>{t.report}</p>
              </Now>
              <Btn onClick={rerun} disabled={!ss.net.hosts[t.dst]?.ip}>
                Reproduce it: run the failing ping
              </Btn>
              <div className="space-y-1.5 rounded-2xl border border-pv-border bg-pv-bg-elevated/30 p-3">
                <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-pv-text-faint">Evidence ladder — check one rung at a time</p>
                {RUNGS.filter((r) => (t.id === "fragmented" ? ["symptom", "plan", "overlap", "aligned", "free"].includes(r.k) : r.k !== "free")).map((r, i) => (
                  <div key={r.k} className="rounded-lg border border-pv-border/70 px-2 py-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] text-pv-text-faint">{i + 1}</span>
                      <span className="flex-1 text-[13.5px] font-semibold text-pv-text">{r.title}</span>
                      <button type="button" onClick={() => setDesk((d) => ({ ...d, shown: { ...d.shown, [r.k]: !d.shown[r.k] } }))} className="rounded-full border border-pv-cyan/50 px-2.5 py-0.5 text-[12px] font-semibold text-pv-cyan-soft hover:bg-pv-cyan/10">
                        {shown[r.k] ? "Hide" : "Check"}
                      </button>
                    </div>
                    {shown[r.k] && <p className="sl-pop mt-1 text-[13px] leading-snug text-pv-text-muted">{r.text(ss)}</p>}
                  </div>
                ))}
                <p className="text-[12px] text-pv-text-faint">
                  More evidence: open the devices in <button type="button" onClick={() => go("apply")} className="font-semibold text-pv-cyan-soft underline-offset-2 hover:underline">Build &amp; test</button> (their terminals, R1&apos;s console) or the full verification in <button type="button" onClick={() => go("design")} className="font-semibold text-pv-cyan-soft underline-offset-2 hover:underline">Design</button>. <button type="button" onClick={() => openWin(t.src)} className="font-semibold text-pv-cyan-soft underline-offset-2 hover:underline">Open {ssDevName(ss.needs, t.src)}</button>.
                </p>
              </div>
              <div className="space-y-1.5 rounded-2xl border border-pv-border bg-pv-bg-elevated/30 p-3">
                <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-pv-text-faint">Root cause — what started it?</p>
                <div className="flex flex-wrap gap-1.5">
                  {SS_CAUSES.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        const fb = ssCauseFeedback(ss, c.id);
                        setDesk((d) => ({ ...d, guess: { cause: c.id, seq: ss.seq, fb }, found: d.found || fb.right }));
                      }}
                      aria-pressed={guess?.cause === c.id}
                      className={clsx("rounded-full border px-2.5 py-1 text-[12.5px] font-semibold", guess?.cause === c.id ? "border-pv-warning bg-pv-warning/15 text-pv-text" : "border-pv-border text-pv-text-muted hover:text-pv-text")}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
                {fb && (
                  <p className={clsx("sl-pop rounded-lg px-2.5 py-1.5 text-[13px] leading-snug", fb.right ? "bg-pv-success/10 text-pv-text" : fb.consequence ? "bg-pv-warning/10 text-pv-text" : "bg-pv-bg/60 text-pv-text-muted")}>
                    {fb.consequence && <b className="text-pv-warning">Consequence, not cause. </b>}
                    {fb.text}
                  </p>
                )}
                {found && t.id === "misaligned" && mis.length > 0 && (
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    <div className="rounded-xl border-2 border-pv-danger/60 p-2 text-[12.5px]">
                      <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-pv-danger">Root cause</p>
                      <p className="text-pv-text">Invalid subnet boundary: {mis.map((c) => `${c.id} written ${ssShort(parent, c.writtenRange.first)}/${c.prefix}, real ${ssRangeText(parent, c.realRange)}`).join("; ")}.</p>
                    </div>
                    <div className="rounded-xl border-2 border-pv-warning/60 p-2 text-[12.5px]">
                      <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-pv-warning">Consequences</p>
                      <ul className="list-disc pl-4 text-pv-text-muted">
                        {report.overlaps.map((o) => (
                          <li key={o.a + o.b}>overlap: {o.a} + {o.b} share {ssRangeText(parent, o.shared)}</li>
                        ))}
                        {ss.needs.filter((n) => ss.net.hosts[n.id]?.ip && !ss.net.r1[n.id]?.ip).map((n) => (
                          <li key={n.id}>R1 refused {ssShortIf(n.iface)} ({n.id}): “overlaps with” another interface</li>
                        ))}
                        <li>{ssDevName(ss.needs, t.src)} decides {ssDevName(ss.needs, t.dst)} is LOCAL</li>
                      </ul>
                    </div>
                  </div>
                )}
              </div>
              <div className="space-y-1.5 rounded-2xl border border-pv-border bg-pv-bg-elevated/30 p-3">
                <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-pv-text-faint">Fix, then prove it</p>
                <p className="text-[13px] text-pv-text-muted">
                  Fix the plan in <button type="button" onClick={() => go("design")} className="font-semibold text-pv-cyan-soft underline-offset-2 hover:underline">Design</button> (then re-apply it), or fix a device in <button type="button" onClick={() => go("apply")} className="font-semibold text-pv-cyan-soft underline-offset-2 hover:underline">Build &amp; test</button>. The ticket stays loaded.
                </p>
                <ul className="space-y-0.5 text-[13px]">
                  {proofs.map((p) => (
                    <li key={p.label} className={p.ok ? "text-pv-success" : "text-pv-text-muted"}>
                      {p.ok ? "✓" : "○"} <b className={p.ok ? "" : "text-pv-text"}>{p.label}</b> <span className="text-[12px] text-pv-text-faint">— {p.detail}</span>
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-2">
                  <Btn tone="quiet" onClick={() => act({ type: "test-all" })}>
                    Test all paths
                  </Btn>
                  {ss.net.hosts[t.dst]?.ip && (
                    <Btn tone="quiet" onClick={rerun}>
                      Run the failing ping (watch it)
                    </Btn>
                  )}
                </div>
                {shownPing && <PingTrace ss={ss} p={shownPing.p} />}
                {solved && (
                  <Now k="solved" tone="ok" title="✓ Solved, and proven.">
                    <p>The plan passes every rule, the devices match it, the reported path works and every other path still does.{!found ? " Now name the root cause above — fixing it is not the same as knowing why it broke." : ""}</p>
                  </Now>
                )}
              </div>
            </>
          )}
          <Idea>
            <p>Separate the root cause from its consequences. An overlap, a refused router interface or a host that decides “local” are what you SEE; the cause is the one wrong number that produced them.</p>
          </Idea>
        </>
      }
    />
  );
}
