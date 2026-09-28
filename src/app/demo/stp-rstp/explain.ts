import type { NodeExplanation } from "@/components/network3d/types";
import { HOST_ATTACH, HOST_IP, HOST_MAC, bidName, bidText, bridgeIdOf, bridgeInfo, fdbRows, portSummary, roleShort, vectorText, type StpDevice, type StpHost, type StpState, type StpSw } from "@/lib/sim-engine/scenarios/stpRstp";

type Table = { title: string; rows: { label: string; value: string }[] };

export function stpTables(device: StpDevice, s: StpState): Table[] {
  if (device === "SW1" || device === "SW2" || device === "SW3") {
    const sw = device as StpSw;
    const b = bridgeInfo(s, sw);
    return [
      {
        title: "Bridge",
        rows: [
          { label: "Bridge ID", value: bidText(bridgeIdOf(sw)) },
          { label: "Root ID", value: `${bidText(b.rootId)} (${bidName(b.rootId)})` },
          { label: "Root Path Cost", value: String(b.cost) },
          { label: "Root Port", value: b.rootPort ?? "none — this bridge is the root it knows" },
        ],
      },
      { title: "RSTP ports", rows: portSummary(s, sw).map((p) => ({ label: p.port, value: `${p.peer} · link ${p.up ? "up" : "down"} · ${p.link === "edge" ? "edge" : p.rstp ? "RSTP" : "RSTP OFF"} · ${roleShort(p.role)} / ${p.state}` })) },
      { title: "Received BPDUs", rows: portSummary(s, sw).filter((p) => p.link !== "edge").map((p) => ({ label: p.port, value: p.rx ? vectorText(p.rx) : "none" })) },
      { title: "FDB", rows: fdbRows(s, sw) },
    ];
  }
  const h = device as StpHost;
  const rows = [
    { label: "MAC", value: HOST_MAC[h] },
    { label: "IPv4", value: HOST_IP[h] },
    { label: "Attached to", value: `${HOST_ATTACH[h].sw} ${HOST_ATTACH[h].port} (edge port)` },
  ];
  if (s.loop) rows.push({ label: "Copies of the looping broadcast", value: String(s.loop.received[h]) });
  return [{ title: "Host", rows }];
}

export function explainStp(s: StpState, id: string, stepId: string): NodeExplanation {
  const device = id as StpDevice;
  const hop = [...s.hops].reverse().find((h) => h.device === device && h.stepId === stepId);
  const tables = stpTables(device, s);
  const act = hop ? `${hop.action}: ${hop.reason}` : "Idle this step.";
  if (device === "SW1" || device === "SW2" || device === "SW3") {
    const sw = device as StpSw;
    const b = bridgeInfo(s, sw);
    const off = portSummary(s, sw).filter((p) => !p.rstp);
    return {
      id,
      name: sw,
      deviceType: "RSTP bridge (Ethernet switch)",
      role: b.rootPort ? `Non-root bridge · Root Port ${b.rootPort} · cost ${b.cost}` : bidName(b.rootId) === sw ? "Root bridge (as far as it knows) · no Root Port" : "—",
      currentAction: act,
      controlPlaneRole: `Bridge ID ${bidText(bridgeIdOf(sw))}. Root ${bidName(b.rootId)}. BPDUs select each port's role and state.`,
      dataPlaneRole: hop ? `In: ${hop.input}. Result: ${hop.output}.` : "Customer frames use only Forwarding ports; Discarding ports drop them and don't learn.",
      packetBefore: hop?.input,
      packetAfter: hop?.output,
      note: off.length ? `RSTP participation is DISABLED on ${off.map((p) => p.port).join(", ")} — an unsafe teaching misconfiguration.` : undefined,
      tables,
    };
  }
  const h = device as StpHost;
  return {
    id,
    name: h,
    deviceType: "Ethernet host",
    role: `Attached to ${HOST_ATTACH[h].sw} (edge port)`,
    currentAction: act,
    controlPlaneRole: "Hosts don't take part in RSTP.",
    dataPlaneRole: hop ? `${hop.lookupResult}.` : "Sends and receives ordinary customer frames.",
    packetBefore: hop?.input,
    packetAfter: hop?.output,
    tables,
  };
}
