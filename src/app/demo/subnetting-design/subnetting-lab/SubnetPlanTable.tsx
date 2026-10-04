"use client";

import { clsx } from "clsx";
import { blockSize } from "@/lib/sim-engine/scenarios/subnettingDesign";
import { ipToNum, numToIp } from "@/lib/sim-engine/scenarios/fundamentalsPackets";
import { fitStatus, slDescribe, slUsable, validateRow, type SlRow, type SlRowCheck, type SlSeg } from "@/lib/sim-engine/scenarios/subnettingLab";
import { SEG_COLOR } from "./SubnetRuler";

/**
 * The allocation table. Every status chip comes from the lab model (validateRow / fitStatus) — none is typed here.
 * Desktop: a table. Phones: stacked cards. While `conceal` is set (incident, before the mask is applied) rows show
 * the spreadsheet's WRITTEN range and the status UNVERIFIED.
 */

type Chip = { text: string; tone: "ok" | "bad" | "warn" | "muted" };
const TONE: Record<Chip["tone"], string> = {
  ok: "border-pv-success/50 bg-pv-success/10 text-pv-success",
  bad: "border-pv-danger/50 bg-pv-danger/10 text-pv-danger",
  warn: "border-pv-warning/50 bg-pv-warning/10 text-pv-warning",
  muted: "border-pv-border text-pv-text-faint",
};

interface RowView {
  id: SlSeg;
  hosts: number;
  prefix?: number;
  network: string;
  realNote?: string;
  first: string;
  last: string;
  broadcast: string;
  total: string;
  usable: string;
  chips: Chip[];
  violations: string[];
}

/** The range as the spreadsheet documents it: written start + block size (exactly what an admin would read). */
function writtenView(c: SlRowCheck) {
  const s = ipToNum(c.written);
  const n = blockSize(c.prefix);
  return { first: numToIp(s + 1), last: numToIp(s + n - 2), broadcast: numToIp(s + n - 1) };
}

export function rowView(rows: SlRow[], r: SlRow, conceal: boolean): RowView {
  const base = { id: r.id, hosts: r.hosts, prefix: r.prefix, first: "—", last: "—", broadcast: "—", total: r.prefix !== undefined ? String(blockSize(r.prefix)) : "—", usable: r.prefix !== undefined ? String(slUsable(r.prefix)) : "—", violations: [] as string[] };
  if (r.prefix === undefined) return { ...base, network: "not sized", chips: [{ text: "NOT SIZED", tone: "muted" }] };
  const c = validateRow(rows, r.id);
  if (!c) {
    const fit = fitStatus(r.hosts, r.prefix);
    return { ...base, network: "not placed", chips: [{ text: fit === "TOO_SMALL" ? "TOO SMALL" : fit, tone: fit === "TOO_SMALL" ? "bad" : fit === "OVERSIZED" ? "warn" : "ok" }, { text: "NOT PLACED", tone: "muted" }] };
  }
  if (conceal) return { ...base, network: `${c.written}/${c.prefix}`, ...writtenView(c), chips: [{ text: "UNVERIFIED", tone: "muted" }] };
  const d = slDescribe(c.real, c.prefix);
  const chips: Chip[] = c.valid ? [{ text: "VALID", tone: "ok" }] : c.violations.map((v) => ({ text: v.code === "OVERLAP" ? `OVERLAP · ${v.with}` : v.code.replace("_", " "), tone: "bad" as const }));
  if (c.oversized) chips.push({ text: "OVERSIZED (advisory)", tone: "warn" });
  return { ...base, network: `${c.written}/${c.prefix}`, realNote: c.aligned ? undefined : `real ${c.real}/${c.prefix}`, first: d.firstHost, last: d.lastHost, broadcast: d.broadcast, chips, violations: [...c.violations.map((v) => v.text), ...(c.oversized ? [c.oversized] : [])] };
}

const Chips = ({ chips }: { chips: Chip[] }) => (
  <span className="flex flex-wrap gap-1">
    {chips.map((c) => (
      <span key={c.text} className={clsx("rounded border px-1 py-px text-[9.5px] font-bold uppercase tracking-wide", TONE[c.tone])}>
        {c.text}
      </span>
    ))}
  </span>
);

export function SubnetPlanTable({ rows, conceal = false, selected, onSelect }: { rows: SlRow[]; conceal?: boolean; selected?: SlSeg; onSelect?: (s: SlSeg) => void }) {
  const views = rows.map((r) => rowView(rows, r, conceal));
  return (
    <div id="sl-plan" className="space-y-2">
      {conceal && <p className="text-[11px] text-pv-text-muted">Ranges as written in the spreadsheet. Nothing has been verified yet.</p>}
      <div className="hidden overflow-x-auto rounded-lg border border-pv-border xl:block">
        <table className="w-full text-left text-[11px]">
          <thead className="text-[9.5px] uppercase tracking-wide text-pv-text-faint">
            <tr className="border-b border-pv-border">
              {["Segment", "Need", "Prefix", "Network", "First", "Last", "Broadcast", "Total", "Usable", "Status"].map((h) => (
                <th key={h} className="px-1.5 py-1 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {views.map((v) => (
              <tr key={v.id} onClick={() => onSelect?.(v.id)} className={clsx("cursor-pointer border-b border-pv-border/50 align-top last:border-0", selected === v.id && "bg-pv-cyan/[0.06]")}>
                <td className="px-1.5 py-1 font-semibold" style={{ color: SEG_COLOR[v.id] }}>
                  {v.id}
                </td>
                <td className="px-1.5 py-1 pv-mono">{v.hosts}</td>
                <td className="px-1.5 py-1 pv-mono">{v.prefix !== undefined ? `/${v.prefix}` : "—"}</td>
                <td className="px-1.5 py-1 pv-mono">
                  {v.network}
                  {v.realNote && <span className="block text-pv-danger">{v.realNote}</span>}
                </td>
                <td className="px-1.5 py-1 pv-mono">{v.first}</td>
                <td className="px-1.5 py-1 pv-mono">{v.last}</td>
                <td className="px-1.5 py-1 pv-mono">{v.broadcast}</td>
                <td className="px-1.5 py-1 pv-mono">{v.total}</td>
                <td className="px-1.5 py-1 pv-mono">{v.usable}</td>
                <td className="px-1.5 py-1">
                  <Chips chips={v.chips} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="space-y-1.5 xl:hidden">
        {views.map((v) => (
          <li key={v.id}>
            <button type="button" onClick={() => onSelect?.(v.id)} aria-pressed={selected === v.id} className={clsx("w-full rounded-lg border p-2 text-left", selected === v.id ? "border-pv-cyan/60 bg-pv-cyan/[0.05]" : "border-pv-border")}>
              <span className="flex flex-wrap items-center justify-between gap-1.5">
                <span className="text-[12px] font-semibold" style={{ color: SEG_COLOR[v.id] }}>
                  {v.id} <span className="font-normal text-pv-text-faint">· needs {v.hosts}</span>
                </span>
                <Chips chips={v.chips} />
              </span>
              <span className="mt-1 block break-all pv-mono text-[11.5px] text-pv-text">
                {v.network}
                {v.realNote && <span className="ml-1.5 text-pv-danger">({v.realNote})</span>}
              </span>
              <span className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10.5px]">
                {[
                  ["First", v.first],
                  ["Last", v.last],
                  ["Broadcast", v.broadcast],
                  ["Total / usable", `${v.total} / ${v.usable}`],
                ].map(([k, val]) => (
                  <span key={k} className="min-w-0">
                    <span className="text-pv-text-faint">{k} </span>
                    <span className="break-all pv-mono text-pv-text-muted">{val}</span>
                  </span>
                ))}
              </span>
              {v.violations.length > 0 && (
                <span className="mt-1 block space-y-0.5">
                  {v.violations.map((t) => (
                    <span key={t} className="block text-[10.5px] leading-snug text-pv-text-muted">
                      · {t}
                    </span>
                  ))}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
