import { CliPanel } from "@/components/lesson/GuideCli";
import { VOICE, type DiscState } from "@/lib/sim-engine/scenarios/ccna/discovery";
import { showCdp, showLldp } from "./discoveryCli";

/** Side panel: SW1's live CDP and LLDP tables (holdtimes from the lesson clock) and PHONE-1's VLAN. */
export function DiscPanel({ s }: { s: DiscState }) {
  return (
    <div className="space-y-3 text-xs">
      <p className="rounded-lg border border-pv-border bg-pv-surface/60 px-3 py-2 text-pv-text-muted">
        Lesson clock <span className="font-mono text-pv-text">t = {s.now} s</span> · CDP <span className={s.sw1.CDP ? "text-pv-success" : "text-pv-danger"}>{s.sw1.CDP ? "on" : "off"}</span> · LLDP{" "}
        <span className={s.sw1.LLDP ? "text-pv-success" : "text-pv-danger"}>{s.sw1.LLDP ? "on" : "off"}</span>
      </p>
      <CliPanel run={showCdp(s)} caption="SW1 · CDP" />
      <CliPanel run={showLldp(s)} caption="SW1 · LLDP" />
      {s.phoneUp ? (
        <p className={`rounded-lg border px-3 py-2 ${s.phoneVoiceVlan ? "border-pv-success/40 text-pv-success" : "border-pv-danger/40 text-pv-danger"}`}>
          PHONE-1: {s.phoneVoiceVlan ? `voice VLAN ${s.phoneVoiceVlan} · registered` : `untagged → data VLAN ${VOICE.dataVlan} · no service`}
        </p>
      ) : null}
    </div>
  );
}
