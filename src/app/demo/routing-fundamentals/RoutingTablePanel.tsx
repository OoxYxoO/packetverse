"use client";

import type { ReactNode } from "react";
import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { ipBits, routeKey, type Route, type RtRouter, type RtState } from "@/lib/sim-engine/scenarios/routingFundamentals";

const via = (r: Route) => (r.source === "connected" ? `connected · ${r.iface}` : r.discard ? "static · discard" : `static · via ${r.nextHop}`);

/** One router's table; when it owns the SHOWN lookup, matching rows are ticked and the winner is highlighted. */
function RibTable({ s, r }: { s: RtState; r: RtRouter }) {
  const lk = s.lookup?.router === r ? s.lookup : undefined;
  return (
    <div>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">{r} routing table</p>
      <div className="space-y-0.5 pv-mono text-[11px]">
        {s.rib[r].map((rt) => {
          const key = routeKey(rt);
          const match = lk?.matches.includes(key);
          const win = lk?.selected === key;
          return (
            <div key={key} className={clsx("flex flex-wrap justify-between gap-x-2 rounded px-1", win && (rt.discard ? "bg-pv-danger/15 text-pv-danger" : "bg-pv-success/15 text-pv-success"))}>
              <span className={clsx(!win && "text-pv-text")}>
                {lk ? (match ? "✓ " : "  ") : ""}
                {key}
              </span>
              <span className={clsx(!win && "text-pv-text-muted")}>
                {via(rt)}
                {win ? " ← selected" : ""}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Destination bits vs each route's prefix bits: fixed bits green when they match, red at a mismatch, · for host bits. */
function PrefixBits({ s }: { s: RtState }) {
  const lk = s.lookup;
  if (!lk) return null;
  const d = ipBits(lk.dst);
  const group = (chars: ReactNode[]) => chars.flatMap((c, i) => (i > 0 && i % 8 === 0 ? [<span key={`d${i}`}>.</span>, c] : [c]));
  const dstRow = group(d.split("").map((b, i) => <span key={i}>{b}</span>));
  return (
    <div className="space-y-1 border-t border-pv-border pt-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">Longest prefix match · {lk.router}</p>
      <div className="pv-mono text-[10px] leading-snug">
        <p className="text-pv-text-faint">destination {lk.dst}</p>
        <p className="whitespace-nowrap text-pv-text">{dstRow}</p>
      </div>
      {s.rib[lk.router].map((rt) => {
        const p = ipBits(rt.prefix);
        const firstBad = [...Array(rt.len).keys()].find((i) => p[i] !== d[i]);
        const matches = firstBad === undefined;
        const cells = p.split("").map((b, i) => (
          <span key={i} className={i >= rt.len ? "text-pv-text-faint" : firstBad === i ? "font-bold text-pv-danger" : matches ? "text-pv-success" : i < (firstBad ?? 0) ? "text-pv-text-muted" : "text-pv-text-faint"}>
            {i >= rt.len ? "·" : b}
          </span>
        ));
        const key = routeKey(rt);
        return (
          <div key={key} className="pv-mono text-[10px] leading-snug">
            <p className={clsx(lk.selected === key ? "font-bold text-pv-text" : "text-pv-text-faint")}>
              {key} · {rt.len} fixed bit{rt.len === 1 ? "" : "s"} · {matches ? (lk.selected === key ? "match — longest" : "match") : `no match (bit ${firstBad! + 1})`}
            </p>
            <p className="whitespace-nowrap">{group(cells)}</p>
          </div>
        );
      })}
    </div>
  );
}

export function RoutingTablePanel({ s }: { s: RtState }) {
  return (
    <GlassPanel className="space-y-3 p-4">
      <RibTable s={s} r="R1" />
      <RibTable s={s} r="R2" />
      <PrefixBits s={s} />
      <div className="space-y-0.5 border-t border-pv-border pt-2 text-[11px]">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">Probe results (from HOST-A)</p>
        <Row k="SERVER-A 172.16.50.50" v={s.results["SERVER-A"]} />
        <Row k="SERVER-B 172.16.50.200" v={s.results["SERVER-B"]} />
        {s.results.outside && <Row k="203.0.113.80" v={s.results.outside} />}
      </div>
    </GlassPanel>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-3">
      <span className="text-pv-text-faint">{k}</span>
      <span className="pv-mono text-pv-text">{v}</span>
    </div>
  );
}
