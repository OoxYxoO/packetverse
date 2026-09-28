"use client";

import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { BIT_ORDER, FLOWS, LAG_NAME, MEMBERS, bitsByte, eligible, hex2, lagStatus, type FlowId, type LacpBits, type LacpSide, type LacpState } from "@/lib/sim-engine/scenarios/lacpLinkAggregation";

/** Eight LACP state flags as short letters: A T G S C D F E (on = bright, off = faint). */
function Flags({ b }: { b: LacpBits }) {
  return (
    <span className="pv-mono">
      {BIT_ORDER.map(([k, name]) => (
        <span key={k} title={name} className={clsx(b[k] ? "text-pv-success" : "text-pv-text-faint")}>
          {name === "Synchronization" ? "S" : name === "Aggregation" ? "G" : name === "Defaulted" ? "F" : name[0]}
        </span>
      ))}
    </span>
  );
}

/** LAG1, each member's Actor/Partner state on both switches, and the flow → member map — from the SHOWN state. */
export function LacpBundlePanel({ s }: { s: LacpState }) {
  const st = lagStatus(s);
  return (
    <GlassPanel className="space-y-3 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">{LAG_NAME} · logical link</p>
        <p className={clsx("pv-mono text-[11px]", st.members === 2 ? "text-pv-success" : st.members === 1 ? "text-pv-warning" : "text-pv-text-muted")}>{st.text}</p>
      </div>
      {MEMBERS.map((m) => (
        <div key={m} className="space-y-0.5 rounded-lg border border-pv-border p-2 text-[11px]">
          <div className="flex flex-wrap justify-between gap-x-2">
            <span className="pv-mono text-pv-text">{m}</span>
            <span className={clsx("pv-mono", !s.up[m] ? "text-pv-danger" : eligible(s, "SW1").includes(m) && eligible(s, "SW2").includes(m) ? "text-pv-success" : "text-pv-warning")}>
              {!s.up[m] ? "LINK DOWN" : eligible(s, "SW1").includes(m) && eligible(s, "SW2").includes(m) ? "distributing" : "up · not distributing"}
            </span>
          </div>
          {(["SW1", "SW2"] as LacpSide[]).map((side) => {
            const l = s.lacp[side][m];
            return (
              <div key={side} className="flex flex-wrap justify-between gap-x-2">
                <span className="text-pv-text-faint">
                  {side} actor key {s.key[side][m]} · {hex2(bitsByte(l.actor))}
                </span>
                <span>
                  <Flags b={l.actor} />
                  <span className="pv-mono text-pv-text-faint"> · partner {l.partner ? `key ${l.partner.key}` : "—"}</span>
                </span>
              </div>
            );
          })}
        </div>
      ))}
      <p className="text-[10px] text-pv-text-faint">A Activity · T short Timeout · G aGgregation · S Sync · C Collecting · D Distributing · F deFaulted · E Expired</p>
      <div className="space-y-0.5 border-t border-pv-border pt-2 text-[11px]">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">Flows · PacketVerse modeled LAG hash</p>
        {(Object.keys(FLOWS) as FlowId[]).map((f) => (
          <div key={f} className="flex flex-wrap justify-between gap-x-3">
            <span className="text-pv-text-faint">
              {f} {FLOWS[f].src} → {FLOWS[f].dst}
            </span>
            <span className="pv-mono text-pv-text">{s.flowMap[f] ?? "— (hashed on next packet)"}</span>
          </div>
        ))}
        <p className="pt-1 text-[10px] text-pv-text-faint">Implementation-specific: real switches choose their own hash inputs. One flow stays on one member.</p>
      </div>
    </GlassPanel>
  );
}
