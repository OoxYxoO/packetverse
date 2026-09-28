"use client";

import { useState } from "react";
import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { numToIp } from "@/lib/sim-engine/scenarios/fundamentalsPackets";
import { PARENT, alignedBlocks, blockSize, checkCandidate, describe, freeRanges, maskOf, prefixFor, sdAllocationRows, usableHosts, type Allocation, type CandidateCheck, type SegId } from "@/lib/sim-engine/scenarios/subnettingDesign";

const VERDICT: Record<CandidateCheck["verdict"], { label: string; cls: string }> = {
  ok: { label: "✓ Valid", cls: "border-pv-success/40 bg-pv-success/5 text-pv-success" },
  misaligned: { label: "✕ Not a network boundary", cls: "border-pv-danger/40 bg-pv-danger/5 text-pv-danger" },
  "too-small": { label: "✕ Too small", cls: "border-pv-danger/40 bg-pv-danger/5 text-pv-danger" },
  overlap: { label: "✕ Overlaps", cls: "border-pv-danger/40 bg-pv-danger/5 text-pv-danger" },
  "outside-parent": { label: "✕ Outside the parent", cls: "border-pv-danger/40 bg-pv-danger/5 text-pv-danger" },
};
const CANDIDATES: { network: string; prefix: number }[] = [
  { network: "10.44.0.200", prefix: 27 },
  { network: "10.44.0.160", prefix: 27 },
  { network: "10.44.0.192", prefix: 27 },
  { network: "10.44.0.192", prefix: 28 },
  { network: "10.44.0.224", prefix: 27 },
];

/** Interactive planner: inspect every requirement's arithmetic and test LAN-C candidates against the CURRENT plan. */
export function SubnetPlanPanel({ plan, showTester }: { plan: Allocation[]; showTester: boolean }) {
  const [seg, setSeg] = useState<SegId>("LAN-A");
  const [cand, setCand] = useState(0);
  const a = plan.find((x) => x.id === seg)!;
  // Arithmetic is shown only once the scenario has sized this network — the planner never answers ahead of the lesson.
  const sized = a.prefix !== undefined;
  const { hostBits, prefix } = prefixFor(a.hosts);
  const placed = a.network && a.prefix !== undefined ? describe(a.network, a.prefix) : undefined;
  const c = CANDIDATES[cand];
  const check = checkCandidate(plan, "LAN-C", c.network, c.prefix);
  const rows = [
    { k: "Hosts needed", v: String(a.hosts) },
    { k: "Host bits", v: sized ? `${hostBits} (2^${hostBits} − 2 = ${2 ** hostBits - 2})` : "not sized yet" },
    { k: "Prefix / mask", v: sized ? `/${prefix} = ${maskOf(prefix)}` : "—" },
    { k: "Block size", v: sized ? `${blockSize(prefix)} addresses` : "—" },
    { k: "Network", v: placed ? `${placed.network}/${placed.prefix}` : "not placed yet" },
    { k: "First host", v: placed?.firstHost ?? "—" },
    { k: "Last host", v: placed?.lastHost ?? "—" },
    { k: "Broadcast", v: placed?.broadcast ?? "—" },
    { k: "Status", v: placed ? `allocated · ${usableHosts(placed.prefix)} usable` : a.prefix !== undefined ? "sized, awaiting placement" : "not sized yet" },
  ];
  return (
    <GlassPanel className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-pv-cyan-soft">Subnet planner</h3>
        <span className="pv-mono text-xs text-pv-text-muted">
          parent {PARENT.network}/{PARENT.prefix}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Choose a network to inspect">
        {plan.map((x) => (
          <button key={x.id} type="button" aria-pressed={x.id === seg} onClick={() => setSeg(x.id)} className={clsx("cursor-pointer rounded-full border px-3 py-1 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pv-cyan", x.id === seg ? "border-pv-cyan/60 bg-pv-cyan/15 text-pv-cyan-soft" : "border-pv-border text-pv-text-muted hover:text-pv-text")}>
            {x.id} · {x.hosts}
          </button>
        ))}
      </div>
      <div className="grid gap-1.5 sm:grid-cols-3">
        {rows.map((r) => (
          <div key={r.k} className="rounded-lg border border-pv-border px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-pv-text-faint">{r.k}</p>
            <p className="pv-mono break-all text-xs text-pv-text">{r.v}</p>
          </div>
        ))}
      </div>
      {showTester && (
      <div className="rounded-lg border border-pv-border p-3">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">Test a LAN-C candidate against the current plan</p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="LAN-C candidates">
          {CANDIDATES.map((x, i) => (
            <button key={`${x.network}/${x.prefix}`} type="button" aria-pressed={i === cand} onClick={() => setCand(i)} className={clsx("cursor-pointer rounded-full border px-2.5 py-0.5 pv-mono text-[11px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pv-cyan", i === cand ? "border-pv-violet/60 bg-pv-violet/15 text-pv-violet" : "border-pv-border text-pv-text-muted hover:text-pv-text")}>
              {x.network}/{x.prefix}
            </button>
          ))}
        </div>
        <p className={clsx("mt-2 rounded-lg border px-3 py-2 text-xs", VERDICT[check.verdict].cls)}>
          <span className="font-semibold">{VERDICT[check.verdict].label}</span> — {check.reason}
        </p>
      </div>
      )}
    </GlassPanel>
  );
}

/** Compact plan (historical-aware: fed the SHOWN state) with free space shown as ranges, not fake prefixes. */
export function PlanSummary({ plan, faulty }: { plan: Allocation[]; faulty: boolean }) {
  const free = freeRanges(plan);
  return (
    <GlassPanel className={clsx("p-4", faulty && "border-pv-danger/40")}>
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">Address plan · {PARENT.network}/{PARENT.prefix}</p>
      <div className="space-y-1.5 text-[11px]">
        {sdAllocationRows(plan).map((r) => (
          <div key={r.id}>
            <div className="flex flex-wrap justify-between gap-x-3">
              <span className="text-pv-text-muted">
                {r.id} · {r.hosts}
              </span>
              <span className={clsx("pv-mono", faulty && r.id === "LAN-C" ? "text-pv-danger" : "text-pv-text")}>{r.text}</span>
            </div>
            <p className="pv-mono text-[10px] text-pv-text-faint">{r.detail}</p>
          </div>
        ))}
        <div className="border-t border-pv-border pt-1.5">
          <p className="text-pv-text-muted">Free space</p>
          {free.length === 0 ? (
            <p className="pv-mono text-[10px] text-pv-text-faint">none</p>
          ) : (
            free.map((f) => (
              <p key={f.first} className="pv-mono text-[10px] text-pv-text-faint">
                {numToIp(f.first)} – {numToIp(f.last)} ({f.last - f.first + 1}) = {alignedBlocks(f).map((b) => `${b.network.split(".")[3]}/${b.prefix}`).join(" + ")}
              </p>
            ))
          )}
        </div>
      </div>
    </GlassPanel>
  );
}
