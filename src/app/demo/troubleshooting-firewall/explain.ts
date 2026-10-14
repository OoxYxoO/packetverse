import type { NodeExplanation } from "@/components/network3d/types";
import { IP, POLICY, sessionText, type Fw, type FwDevice, type FwState } from "@/lib/sim-engine/scenarios/troubleshootingFirewall";

type Table = { title: string; rows: { label: string; value: string }[] };

export function fwTables(d: FwDevice, s: FwState): Table[] {
  if (d === "FW1" || d === "FW2") {
    const fw = d as Fw;
    return [
      { title: "Policy", rows: [{ label: POLICY.name, value: `${POLICY.from} → ${POLICY.to} · ${POLICY.src} → ${POLICY.dst} · ${POLICY.service} · ${POLICY.action}` }, { label: "dmz → trust", value: "no rule (replies admitted by session state)" }, { label: "NAT", value: "none" }, { label: "State sync with peer", value: "none" }] },
      { title: "Session table", rows: s.sessions[fw].map((x) => ({ label: x.flow, value: sessionText(x) })) },
      { title: "Policy log", rows: s.policyLog[fw].map((x, i) => ({ label: String(i + 1), value: `${x.flow}: ${x.rule} ${x.action}` })) },
      { title: "Drop log", rows: s.drops[fw].map((x, i) => ({ label: String(i + 1), value: `${x.what} — ${x.reason}` })) },
    ];
  }
  if (d === "EDGE-R1") return [{ title: "Routes", rows: [{ label: "10.10.10.0/24", value: "connected ge-0/0/0" }, { label: "10.20.20.0/24", value: `via FW1 ${IP.fw1In}` }] }];
  if (d === "EDGE-R2") return [{ title: "Routes", rows: [{ label: "10.20.20.0/24", value: "connected ge-0/0/0" }, { label: "10.10.10.0/24", value: `via ${s.r2Return} ${s.r2Return === "FW1" ? IP.fw1Out : IP.fw2Out}` }] }];
  if (d === "SERVER") return [{ title: "Service", rows: [{ label: "Listening", value: `${IP.server}:443/TCP` }] }, { title: "Capture: received", rows: s.serverRx.map((x, i) => ({ label: String(i + 1), value: `${x.flow}: ${x.what}` })) }, { title: "Capture: sent", rows: s.serverTx.map((x, i) => ({ label: String(i + 1), value: `${x.flow}: ${x.what}` })) }];
  return [{ title: "TCP", rows: Object.entries(s.clientTcp).map(([f, st]) => ({ label: f, value: `${st}${s.synRetx[f as "incident"] ? ` · ${s.synRetx[f as "incident"]} SYN retransmission(s)` : ""}` })) }];
}

export function explainFw(s: FwState, id: string, stepId: string): NodeExplanation {
  const d = id as FwDevice;
  const hop = [...s.hops].reverse().find((h) => h.device === d && h.stepId === stepId);
  const fw = d === "FW1" || d === "FW2";
  return {
    id,
    name: d,
    deviceType: fw ? "Stateful firewall (routed, no NAT)" : d.startsWith("EDGE") ? "Edge router" : "Host",
    role: fw ? `zones trust / dmz · ${s.sessions[d as Fw].length} session(s)` : d === "CLIENT" ? `${IP.client}/24` : d === "SERVER" ? `${IP.server}:443` : "routing",
    currentAction: hop ? `${hop.action}: ${hop.reason}` : "Idle this step.",
    controlPlaneRole: fw ? "Policy for new flows; session table for everything after." : d.startsWith("EDGE") ? "Static routes toward the other side." : "TCP.",
    dataPlaneRole: fw ? "Session match → forward; new SYN → route + policy → create session; otherwise drop." : "Forwards / answers packets.",
    packetBefore: hop?.input,
    packetAfter: hop?.output,
    tables: fwTables(d, s),
  };
}
