import { CliPanel } from "@/components/lesson/GuideCli";
import { VIP, VMAC, effPrio, type FhrpState, type Rid } from "@/lib/sim-engine/scenarios/ccna/fhrp";

/** Cisco-style `show standby brief` for one router, from the model. */
export function showStandby(s: FhrpState, id: Rid) {
  const r = s.r[id];
  const state = !r.up ? "Init" : s.active === id ? "Active" : s.standby === id ? "Standby" : "Listen";
  return {
    prompt: `${id}#`,
    command: "show standby brief",
    output: [
      "Interface   Grp  Pri P State   Active          Standby         Virtual IP",
      r.up ? `Gi0/0       10   ${String(effPrio(r)).padEnd(4)}${r.preempt ? "P" : " "} ${state.padEnd(8)}${(s.active === id ? "local" : s.active ? s.r[s.active].ip : "unknown").padEnd(16)}${(s.standby === id ? "local" : s.standby ? s.r[s.standby].ip : "unknown").padEnd(16)}${VIP}` : "(router down)",
      r.track && r.up ? `  Track ${r.track.iface} decrement ${r.track.decrement} · ${r.wanUp ? "up" : "DOWN"}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

/** Side panel: both routers' HSRP state, PC1's gateway ARP entry and the event log. */
export function FhrpPanel({ s }: { s: FhrpState }) {
  return (
    <div className="space-y-3 text-xs">
      {s.active ? (
        <>
          <CliPanel run={showStandby(s, "R1")} caption="R1 · HSRP" />
          <CliPanel run={showStandby(s, "R2")} caption="R2 · HSRP" />
        </>
      ) : (
        <p className="rounded-lg border border-pv-border px-3 py-2 text-pv-text-muted">HSRP group 10 · VIP {VIP} · not yet elected</p>
      )}
      <p className="rounded-lg border border-pv-border px-3 py-2 text-pv-text-muted">
        PC1 ARP: <span className="font-mono text-pv-text">{s.pcArp ? `${VIP} → ${s.pcArp}` : "empty"}</span>
        {s.vmacOn ? (
          <>
            {" "}
            · switch learned <span className="font-mono text-pv-text">{VMAC}</span> on {s.vmacOn}&apos;s port
          </>
        ) : null}
      </p>
      {s.log.length ? (
        <ul className="space-y-0.5 rounded-xl border border-pv-border p-3 font-mono text-[10.5px] text-pv-text-muted" aria-label="HSRP events">
          {s.log.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
