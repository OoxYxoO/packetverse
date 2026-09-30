import type { NodeExplanation } from "@/components/network3d/types";
import { IP, R2_RIB, R3_RIB, RID, fibLookup, routeKey, routeText, type RibRoute, type RtDevice, type RtState } from "@/lib/sim-engine/scenarios/troubleshootingRouting";

type Table = { title: string; rows: { label: string; value: string }[] };
const ribRows = (rib: RibRoute[]) => rib.map((r) => ({ label: routeKey(r), value: routeText(r) }));
const lookupRows = (rib: RibRoute[]) =>
  [IP.srvA, IP.srvB].map((d) => {
    const { matches, chosen } = fibLookup(rib, d);
    return { label: `lookup ${d}`, value: `matches ${matches.map(routeKey).join(", ")} → ${chosen ? `${routeKey(chosen)} ${chosen.action === "discard" ? "DISCARD" : `via ${chosen.nextHop ?? "connected"}`}` : "none"}` };
  });

export function rtTables(d: RtDevice, s: RtState): Table[] {
  if (d === "R1" || d === "R2" || d === "R3") {
    const rib = d === "R1" ? s.r1Rib : d === "R2" ? R2_RIB : R3_RIB;
    return [
      { title: "OSPF", rows: [{ label: "Router ID", value: RID[d] }, ...s.ospf.neighbors.filter((n) => n.router === d).map((n) => ({ label: `neighbor ${n.peer}`, value: `${n.state} on ${n.iface}` })), { label: "LSDB", value: s.ospf.lsas.map((l) => `${l.adv} ${l.seq}`).join(", ") }] },
      { title: "Routing table (RIB)", rows: ribRows(rib) },
      { title: "FIB lookups", rows: lookupRows(rib) },
      ...(d === "R1" ? [{ title: "Counters (lesson traffic)", rows: [{ label: `discarded → ${IP.srvA}`, value: String(s.r1Discards[IP.srvA] ?? 0) }] }] : []),
      ...(d === "R2" ? [{ title: "Received (lesson traffic)", rows: [IP.srvA, IP.srvB].map((x) => ({ label: `→ ${x}`, value: String(s.r2Rx[x] ?? 0) })) }] : []),
    ];
  }
  if (d === "CLIENT")
    return [
      { title: "Host", rows: [{ label: "IPv4", value: `${IP.client}/24` }, { label: "Gateway", value: IP.r1Lan }] },
      { title: "Pings", rows: s.pings.map((p) => ({ label: `${p.label} → ${p.dst}`, value: `${p.received}/${p.sent}` })) },
      { title: "Traceroutes", rows: s.traces.map((t) => ({ label: `${t.label} → ${t.dst}`, value: t.hops.join(" → ") })) },
    ];
  return [{ title: "Host", rows: [{ label: "IPv4", value: `${d === "SERVER-A" ? IP.srvA : IP.srvB}/24` }, { label: "Gateway", value: IP.r3Lan }] }];
}

export function explainRt(s: RtState, id: string, stepId: string): NodeExplanation {
  const d = id as RtDevice;
  const hop = [...s.hops].reverse().find((h) => h.device === d && h.stepId === stepId);
  const router = d === "R1" || d === "R2" || d === "R3";
  return {
    id,
    name: d,
    deviceType: router ? "OSPF router" : "Host",
    role: router ? `router ID ${RID[d as "R1"]}` : d === "CLIENT" ? `${IP.client}/24` : `${d === "SERVER-A" ? IP.srvA : IP.srvB}/24`,
    currentAction: hop ? `${hop.action}: ${hop.reason}` : "Idle this step.",
    controlPlaneRole: router ? "OSPF adjacency, LSDB, SPF → RIB (plus connected and static routes)." : "—",
    dataPlaneRole: router ? "FIB lookup: longest prefix, then forward or discard." : "Sends and answers pings.",
    packetBefore: hop?.input,
    packetAfter: hop?.output,
    tables: rtTables(d, s),
  };
}
