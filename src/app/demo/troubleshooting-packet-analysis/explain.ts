import type { NodeExplanation } from "@/components/network3d/types";
import { CAPTURES, FLOW, PA, PA_IFACES, PA_MAC, SERVICE_PORT, ifKey, type PaDevice, type PaState } from "@/lib/sim-engine/scenarios/troubleshootingPacketAnalysis";

type Table = { title: string; rows: { label: string; value: string }[] };

const counterRows = (s: PaState, d: PaDevice) =>
  PA_IFACES.filter((i) => i.device === d && d !== "SW1").map((i) => {
    const c = s.counters[ifKey(d, i.name)];
    return { label: i.name, value: `in ${c.inPkts} · out ${c.outPkts} · output drops ${c.outDrops}` };
  });

export function paTables(d: PaDevice, s: PaState): Table[] {
  const cap = CAPTURES.find((c) => c.device === d);
  const capTable: Table[] = cap ? [{ title: `Capture: ${cap.label}`, rows: [{ label: "Where", value: cap.where }, { label: "Frames recorded", value: String(s.captures[cap.id].length) }, { label: "Flagged retransmissions", value: String(s.captures[cap.id].filter((r) => r.analysis).length) }] }] : [];
  if (d === "CLIENT")
    return [
      { title: "Addressing", rows: [{ label: "IPv4", value: `${PA.client}/24` }, { label: "Default gateway", value: PA.gw }, { label: "MAC", value: PA_MAC.CLIENT }] },
      { title: "ARP cache", rows: Object.entries(s.clientArp).map(([ip, mac]) => ({ label: ip, value: mac })) },
      { title: "TCP", rows: [{ label: "Latest socket state", value: s.clientTcp }, ...(["healthy", "incident", "verify"] as const).flatMap((f) => (s.flows[f] ? [{ label: `:${FLOW[f].sport}`, value: `SYN retransmissions ${s.flows[f]!.synRetransmits}${s.flows[f]!.established !== undefined ? ` · established after ${((s.flows[f]!.established! - s.flows[f]!.synSent) / 1000).toFixed(2)} ms` : " · not established yet"}` }] : []))] },
      { title: "Interface counters", rows: counterRows(s, d) },
    ];
  if (d === "SERVER") return [{ title: "Service", rows: [{ label: "Listening", value: `${PA.server}:${SERVICE_PORT}/TCP` }, { label: "Latest socket state", value: s.serverTcp }, { label: "Gateway", value: PA.r1Srv }] }, { title: "Interface counters", rows: counterRows(s, d) }, ...capTable];
  if (d === "R1") return [{ title: "Routes (connected)", rows: [{ label: "10.10.10.0/24", value: `ge-0/0/0 (${PA.gw})` }, { label: "10.20.20.0/24", value: `ge-0/0/1 (${PA.r1Srv})` }] }, { title: "ARP", rows: [{ label: PA.client, value: PA_MAC.CLIENT }, { label: PA.server, value: PA_MAC.SERVER }] }, { title: "Interface counters", rows: counterRows(s, d) }, ...capTable];
  return [{ title: "MAC table", rows: [{ label: PA_MAC.CLIENT, value: "ge-0/0/1" }, { label: PA_MAC.R1_LAN, value: "ge-0/0/24" }] }, { title: "Port mirroring", rows: [{ label: "Source", value: "ge-0/0/1 (both directions)" }, { label: "Destination", value: "capture host" }] }, ...capTable];
}

const ROLE: Record<PaDevice, string> = { CLIENT: "TCP client", SW1: "Access switch (mirrors CLIENT's port)", R1: "Router (the only routing hop)", SERVER: `TCP/${SERVICE_PORT} server` };

export function explainPa(s: PaState, id: string, stepId: string): NodeExplanation {
  const d = id as PaDevice;
  const hop = [...s.hops].reverse().find((h) => h.device === d && h.stepId === stepId);
  return {
    id,
    name: d,
    deviceType: ROLE[d],
    role: d === "CLIENT" ? `${PA.client}/24 · gw ${PA.gw}` : d === "SERVER" ? `${PA.server}/24 · listening :${SERVICE_PORT}` : d === "R1" ? `${PA.gw}/24 · ${PA.r1Srv}/24` : "Layer 2 only",
    currentAction: hop ? `${hop.action}: ${hop.reason}` : "Idle this step.",
    controlPlaneRole: d === "R1" ? "Connected routes for both LANs; ARP for next hops." : d === "SW1" ? "MAC learning; SPAN session for the CLIENT-side capture." : "TCP state machine and ARP.",
    dataPlaneRole: d === "R1" ? "Routes IPv4: TTL − 1, new MACs, same IPs and ports." : d === "SW1" ? "Forwards frames unchanged." : "Sends and receives TCP segments.",
    packetBefore: hop?.input,
    packetAfter: hop?.output,
    tables: paTables(d, s),
  };
}
