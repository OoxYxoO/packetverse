"use client";

import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { ISIS_ROUTERS, LINKS, adjOf, circuitOf, commonLevel, hex8s, lspIn, routeTo, type IsisState } from "@/lib/sim-engine/scenarios/isisFundamentals";

/** Per-link physical vs IS-IS state, each router's own-LSP sequence and route to 10.0.0.4 — from the SHOWN state. */
export function IsisPanel({ s }: { s: IsisState }) {
  return (
    <GlassPanel className="space-y-3 p-4 text-[11px]">
      <div>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">Links: Ethernet vs IS-IS</p>
        {LINKS.map((l) => {
          const a = adjOf(s, l.a, l.b).state;
          const b = adjOf(s, l.b, l.a).state;
          return (
            <div key={l.id} className="mb-1 last:mb-0">
              <div className="flex flex-wrap justify-between gap-x-2">
                <span className="pv-mono text-pv-text">
                  {l.a}–{l.b}
                </span>
                <span className={clsx("pv-mono", s.physUp[l.id] ? "text-pv-success" : "text-pv-danger")}>Ethernet {s.physUp[l.id] ? "UP" : "DOWN"}</span>
              </div>
              <div className="flex flex-wrap justify-between gap-x-2 pv-mono text-[10.5px]">
                <span className="text-pv-text-faint">
                  levels {circuitOf(s, l.a, l.b)} | {circuitOf(s, l.b, l.a)} · common {commonLevel(s, l.a, l.b)}
                </span>
                <span className={a === "UP" && b === "UP" ? "text-pv-success" : a === "DOWN" && b === "DOWN" ? "text-pv-danger" : "text-pv-warning"}>
                  adj {l.a} {a} · {l.b} {b}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="border-t border-pv-border pt-2">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">LSDB · own LSP · route to 10.0.0.4/32</p>
        {ISIS_ROUTERS.map((r) => {
          const own = lspIn(s, r, r);
          const rt = routeTo(s, r, "10.0.0.4/32");
          return (
            <div key={r} className="flex flex-wrap justify-between gap-x-2 pv-mono text-[10.5px]">
              <span className="text-pv-text">
                {r} <span className="text-pv-text-faint">· {s.lsdb[r].length} LSPs · own {own ? hex8s(own.seq) : "—"}</span>
              </span>
              <span className={r === "PE2" ? "text-pv-text-faint" : rt ? "text-pv-success" : s.spf[r] ? "text-pv-danger" : "text-pv-text-faint"}>{r === "PE2" ? "local" : rt ? `m${rt.metric} via ${rt.nextHop}` : s.spf[r] ? "no route" : "SPF not run"}</span>
            </div>
          );
        })}
      </div>
      <p className="border-t border-pv-border pt-2 text-[10px] text-pv-text-faint">IS-IS PDUs: 802.3 + LLC 0xFE/0xFE/0x03, discriminator 0x83 — no IP. Point-to-point circuits: no DIS, no pseudonode.</p>
    </GlassPanel>
  );
}
