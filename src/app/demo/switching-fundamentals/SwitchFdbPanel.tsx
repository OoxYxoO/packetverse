"use client";

import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { LOOP_WAVES_SHOWN, PRIMARY_PORT, SECONDARY_PORT, SWF_HOSTS, isTrunk, macName, type SwfState, type SwfSwitch } from "@/lib/sim-engine/scenarios/switchingFundamentals";

/** Both switches' FDBs side by side, the SW1↔SW2 link states and (during the incident) the loop monitor — from the SHOWN state. */
export function SwitchFdbPanel({ s }: { s: SwfState }) {
  const table = (sw: SwfSwitch) => (
    <div key={sw} className="min-w-0">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">{sw} FDB</p>
      {s.fdb[sw].length === 0 ? (
        <p className="pv-mono text-[11px] text-pv-text-faint">empty</p>
      ) : (
        <div className="space-y-0.5 pv-mono text-[11px]">
          {s.fdb[sw].map((e) => (
            <div key={e.mac} className="flex flex-wrap justify-between gap-x-2">
              <span className="text-pv-text">{macName(e.mac)}</span>
              <span className={clsx(isTrunk(e.port) ? "text-pv-violet" : "text-pv-text-muted")}>{e.port}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
  const loop = s.loop;
  return (
    <GlassPanel className="space-y-3 p-4">
      <div className="grid grid-cols-2 gap-3">
        {table("SW1")}
        {table("SW2")}
      </div>
      <p className="text-[10px] text-pv-text-faint">Two independent tables · learned from source MACs · a port shown in violet leads to the other switch</p>
      <div className="space-y-0.5 border-t border-pv-border pt-2 text-[11px]">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">SW1 ↔ SW2 links</p>
        <Row k={`${PRIMARY_PORT} (primary)`} v="forwarding" />
        <Row k={`${SECONDARY_PORT} (secondary)`} v={s.secondaryUp ? "forwarding" : "disabled"} />
      </div>
      {loop && (
        <div className="space-y-0.5 border-t border-pv-border pt-2 text-[11px]">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-warning">Loop monitor · HOST-A&apos;s one broadcast</p>
          <Row k="Wave shown" v={loop.drained ? "drained after repair" : `${loop.wave} of ${LOOP_WAVES_SHOWN} (visualization limit)`} />
          <Row k="Copies sent by switches" v={String(loop.framesSent)} />
          <Row k="Copies still between switches" v={String(loop.circulating)} />
          {SWF_HOSTS.map((h) => (
            <Row key={h} k={`${h} received`} v={`${loop.received[h]}×`} />
          ))}
          <Row k="HOST-A MAC moves" v={String(loop.moves.length)} />
          {!loop.drained && <p className="pt-1 text-[10px] text-pv-text-faint">Ethernet has no TTL: nothing in the frame ends this loop.</p>}
        </div>
      )}
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
