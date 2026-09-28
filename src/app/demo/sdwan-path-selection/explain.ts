import type { NodeExplanation } from "@/components/network3d/types";
import { APP_POLICY, BULK_FLOW, HYSTERESIS_INTERVALS, SD, TUN_IDS, TUNNELS, VOICE_FLOW, VOICE_SLA, metricText, slaChecks, tunStatus, type SdDevice, type SdState } from "@/lib/sim-engine/scenarios/sdwanPathSelection";

type Table = { title: string; rows: { label: string; value: string }[] };

export function sdTables(device: SdDevice, s: SdState): Table[] {
  if (device === "BRANCH-EDGE") {
    return [
      ...TUN_IDS.map((t) => {
        const x = s.tun[t];
        return {
          title: `${t} (over ${TUNNELS[t].isp})`,
          rows: [
            { label: "Underlay circuit", value: x.underlay },
            { label: "Overlay", value: x.overlay },
            { label: "Probe target", value: x.target },
            { label: "Interval / replies", value: `#${x.last.interval} · ${x.last.received}/${x.last.sent}` },
            { label: "RTT / jitter / loss", value: metricText(x.last) },
            ...slaChecks(x.last).map((c) => ({ label: `Voice ${c.metric} ${c.threshold}`, value: `${c.value} ${c.pass ? "PASS" : "FAIL"}` })),
            { label: "Voice SLA", value: x.sla },
            { label: "Eligibility", value: tunStatus(x) },
          ],
        };
      }),
      { title: "Application policy", rows: (["VOICE", "BULK"] as const).map((c) => ({ label: c, value: `${APP_POLICY[c].match} · ${APP_POLICY[c].slaRequired ? "SLA required" : "no SLA"} · prefer ${APP_POLICY[c].prefer.join(" → ")}` })) },
      { title: "Current selection", rows: [{ label: "VOICE", value: s.selection.VOICE === "NONE" ? "no eligible path → drop (configured)" : s.selection.VOICE }, { label: "BULK", value: s.selection.BULK }, { label: "Eligible for Voice", value: TUN_IDS.filter((t) => s.tun[t].eligible).join(", ") || "none" }] },
      { title: "Model", rows: [{ label: "Voice SLA", value: `RTT ≤ ${VOICE_SLA.rtt} ms · jitter ≤ ${VOICE_SLA.jitter} ms · loss ≤ ${VOICE_SLA.loss.toFixed(1)}%` }, { label: "Recovery (PacketVerse model)", value: `${HYSTERESIS_INTERVALS} consecutive passing intervals` }] },
    ];
  }
  if (device === "HUB-EDGE") {
    const lp = s.lastProbe;
    return [
      { title: "Overlay paths", rows: TUN_IDS.map((t) => ({ label: t, value: `${s.tun[t].overlay} · endpoint ${TUNNELS[t].hubWan}` })) },
      { title: "Monitoring", rows: [{ label: "Loopback", value: SD.hubLo }, { label: "Last probe seen", value: lp ? `${lp.tun} seq ${lp.seq} → ${lp.target}${lp.target === SD.hubLo ? " (answered)" : " (not a local address — no reply)"}` : "none" }] },
    ];
  }
  if (device === "ISP-A" || device === "ISP-B") return [{ title: "Underlay", rows: [{ label: "Circuit", value: "UP" }, { label: "Carries", value: `${device === "ISP-A" ? "TUN-A" : "TUN-B"} (encapsulated; inner packets untouched)` }] }];
  if (device === "CLIENT") return [{ title: "Flows", rows: [{ label: "VOICE", value: `UDP ${SD.client}:${VOICE_FLOW.sport} → ${SD.app}:${VOICE_FLOW.dport} · DSCP EF` }, { label: "BULK", value: `TCP ${SD.client}:${BULK_FLOW.sport} → ${SD.app}:${BULK_FLOW.dport}` }] }];
  return [{ title: "Received", rows: [{ label: "Voice packets", value: String(s.app.voice) }, { label: "Bulk packets", value: String(s.app.bulk) }] }];
}

const TYPE: Record<SdDevice, string> = { CLIENT: "Branch client", "BRANCH-EDGE": "SD-WAN edge (branch)", "ISP-A": "Underlay provider A", "ISP-B": "Underlay provider B", "HUB-EDGE": "SD-WAN edge (hub)", APP: "Application server" };

export function explainSd(s: SdState, id: string, stepId: string): NodeExplanation {
  const device = id as SdDevice;
  const hop = [...s.hops].reverse().find((h) => h.device === device && h.stepId === stepId);
  return {
    id,
    name: device,
    deviceType: TYPE[device],
    role: device === "BRANCH-EDGE" ? `VOICE → ${s.selection.VOICE} · BULK → ${s.selection.BULK}` : device === "HUB-EDGE" ? `Terminates TUN-A and TUN-B · loopback ${SD.hubLo}` : device === "CLIENT" ? `${SD.client} · unaware of paths` : device === "APP" ? SD.app : "Transport only",
    currentAction: hop ? `${hop.action}: ${hop.reason}` : "Idle this step.",
    controlPlaneRole: device === "BRANCH-EDGE" ? "Installed application policy (e.g. from a controller); an SLA monitor per path." : undefined,
    dataPlaneRole: device === "BRANCH-EDGE" ? "Per-packet local steering onto an eligible overlay path." : hop ? `In: ${hop.input}. Result: ${hop.output}.` : "Ordinary IPv4.",
    packetBefore: hop?.input,
    packetAfter: hop?.output,
    tables: sdTables(device, s),
  };
}
