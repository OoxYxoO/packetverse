"use client";

import { clsx } from "clsx";
import type { CliVendor } from "@/lib/cli/types";
import type { SwitchPortId } from "@/lib/sim-engine/scenarios/firstConnection";
import { interfaceAlias } from "../cliAdapter";
import { whyLearned, type ArpLabState, type ArpLabTable } from "@/lib/sim-engine/scenarios/arpLab";

const portName = (vendor: CliVendor, id: SwitchPortId) => interfaceAlias(vendor, { kind: "switch", id });

interface Row {
  key: string;
  primary: string;
  secondary: string;
}

function TableCard({
  title,
  maps,
  table,
  rows,
  lab,
  openWhy,
  onWhy,
}: {
  title: string;
  maps: string;
  table: ArpLabTable;
  rows: Row[];
  lab: ArpLabState;
  openWhy?: string;
  onWhy: (id: string | undefined) => void;
}) {
  const changed = lab.learned.some((l) => l.table === table);
  return (
    <section
      key={changed ? `pulse-${lab.transit?.id}` : "steady"}
      className={clsx("min-w-0 rounded-xl border bg-white/[0.02] p-2.5 transition-colors", changed ? "pv-lab-card-pulse border-pv-success/50" : "border-pv-border")}
      aria-label={`${title} table`}
    >
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <h4 className="text-[11px] font-bold text-pv-text">{title}</h4>
        <span className="pv-mono text-[9.5px] font-semibold tracking-wide text-pv-text-faint">{maps}</span>
      </div>
      {rows.length === 0 ? (
        <p className="pv-mono text-[11px] text-pv-text-faint">EMPTY</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((r) => {
            const fresh = lab.learned.some((l) => l.table === table && l.key === r.key);
            const id = `${table}:${r.key}`;
            return (
              <li key={`${id}:${fresh ? lab.transit?.id : "old"}`} className={clsx("rounded-md px-1.5 py-1", fresh ? "pv-lab-flash bg-pv-success/10 ring-1 ring-pv-success/40" : "bg-black/20")}>
                <div className="flex items-start justify-between gap-1">
                  <div className="min-w-0 pv-mono text-[10.5px] leading-tight">
                    <p className="truncate text-pv-text">
                      {fresh && <span className="text-pv-success">+ </span>}
                      {r.primary}
                    </p>
                    <p className="truncate text-pv-cyan-soft">{r.secondary}</p>
                  </div>
                  <button
                    type="button"
                    aria-expanded={openWhy === id}
                    aria-label={`Why does ${title} have ${r.primary}?`}
                    onClick={() => onWhy(openWhy === id ? undefined : id)}
                    className="shrink-0 rounded px-1 text-[10px] font-semibold text-pv-text-faint hover:text-pv-cyan-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-cyan"
                  >
                    Why?
                  </button>
                </div>
                {fresh && <p className="mt-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-pv-success">Learned this step</p>}
                {openWhy === id && (
                  <p className="mt-1 border-l-2 border-pv-cyan/40 pl-1.5 text-[10.5px] leading-snug text-pv-text-muted">
                    <span className="block font-semibold text-pv-cyan-soft">Why did {title.split(" ")[0]} learn this?</span>
                    {whyLearned(table, r.key)}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Compact live state: three small tables, changes highlighted per event. Reads only ArpLabState. */
export function ArpLabTables({ lab, vendor, openWhy, onWhy }: { lab: ArpLabState; vendor: CliVendor; openWhy?: string; onWhy: (id: string | undefined) => void }) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3">
      <style>{`@keyframes pv-lab-flash { 0%,100% { box-shadow: 0 0 0 0 rgba(16,185,129,0); } 30% { box-shadow: 0 0 0 4px rgba(16,185,129,.35); } } .pv-lab-flash { animation: pv-lab-flash 1.2s ease-out 2; } @keyframes pv-lab-card { 0% { box-shadow: 0 0 0 0 rgba(16,185,129,0); } 25% { box-shadow: 0 0 18px 2px rgba(16,185,129,.45); } 100% { box-shadow: 0 0 0 0 rgba(16,185,129,0); } } .pv-lab-card-pulse { animation: pv-lab-card 1.6s ease-out 1; } @media (prefers-reduced-motion: reduce) { .pv-lab-flash, .pv-lab-card-pulse { animation: none; } }`}</style>
      <TableCard title="Laptop ARP" maps="IP → MAC" table="laptop-arp" rows={Object.entries(lab.laptopArp).map(([ip, mac]) => ({ key: ip, primary: ip, secondary: mac }))} lab={lab} openWhy={openWhy} onWhy={onWhy} />
      <TableCard title="SW1 MAC" maps="MAC → PORT" table="switch-mac" rows={Object.entries(lab.switchMac).map(([mac, port]) => ({ key: mac, primary: mac, secondary: portName(vendor, port) }))} lab={lab} openWhy={openWhy} onWhy={onWhy} />
      <TableCard title="R1 ARP" maps="IP → MAC" table="router-arp" rows={Object.entries(lab.routerArp).map(([ip, mac]) => ({ key: ip, primary: ip, secondary: mac }))} lab={lab} openWhy={openWhy} onWhy={onWhy} />
    </div>
  );
}
