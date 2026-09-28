import type { NodeExplanation } from "@/components/network3d/types";
import { HOST_ATTACH, SWF_MAC, SWF_PORTS, macName, portForwarding, swfFdbRows, type SwfDevice, type SwfHost, type SwfState, type SwfSwitch } from "@/lib/sim-engine/scenarios/switchingFundamentals";

type Table = { title: string; rows: { label: string; value: string }[] };

export function swfTables(device: SwfDevice, s: SwfState): Table[] {
  if (device === "SW1" || device === "SW2") {
    const sw = device as SwfSwitch;
    const tables: Table[] = [
      { title: "FDB", rows: swfFdbRows(s, sw) },
      { title: "Ports", rows: SWF_PORTS[sw].map((p) => ({ label: p.port, value: `${p.peer} · ${portForwarding(s, sw, p.port) ? "forwarding" : "disabled"}` })) },
    ];
    const moves = s.loop?.moves.filter((m) => m.sw === sw) ?? [];
    if (moves.length) tables.push({ title: "MAC moves", rows: moves.map((m, i) => ({ label: `${i + 1}. ${macName(m.mac)} (wave ${m.wave})`, value: `${m.from} → ${m.to}` })) });
    return tables;
  }
  const host = device as SwfHost;
  const rows = [
    { label: "MAC", value: SWF_MAC[host] },
    { label: "Attached to", value: `${HOST_ATTACH[host].sw} ${HOST_ATTACH[host].port}` },
  ];
  if (s.loop) rows.push({ label: "Copies of the looping broadcast received", value: String(s.loop.received[host]) });
  return [{ title: "Host", rows }];
}

export function explainSwf(s: SwfState, id: string, stepId: string): NodeExplanation {
  const device = id as SwfDevice;
  const hop = [...s.hops].reverse().find((h) => h.device === device && h.stepId === stepId);
  const tables = swfTables(device, s);
  const act = hop ? `${hop.action}: ${hop.reason}` : "Idle this step.";
  if (device === "SW1" || device === "SW2") {
    const sw = device as SwfSwitch;
    const moves = s.loop?.moves.filter((m) => m.sw === sw).length ?? 0;
    return {
      id,
      name: sw,
      deviceType: "Learning bridge (Ethernet switch)",
      role: sw === "SW1" ? "Access switch for HOST-A and HOST-D" : "Access switch for HOST-B and HOST-C",
      currentAction: act,
      controlPlaneRole: `Keeps its OWN FDB, learned only from source MACs arriving on its own ports (${s.fdb[sw].length} entr${s.fdb[sw].length === 1 ? "y" : "ies"}). Nothing is shared with the other switch. Inter-switch links forwarding: ${s.secondaryUp ? "2" : "1"}.`,
      dataPlaneRole: hop ? `In: ${hop.input}. Lookup: ${hop.lookupResult}. Out: ${hop.output}.` : "Known unicast → one port; unknown unicast and broadcast → every other forwarding port. The frame is never changed.",
      packetBefore: hop?.input,
      packetAfter: hop?.output,
      note: moves ? `${moves} MAC move${moves === 1 ? "" : "s"} recorded on this switch during the loop.` : undefined,
      tables,
    };
  }
  const host = device as SwfHost;
  return {
    id,
    name: host,
    deviceType: "Ethernet host",
    role: `Attached to ${HOST_ATTACH[host].sw} ${HOST_ATTACH[host].port}`,
    currentAction: act,
    controlPlaneRole: `NIC MAC ${SWF_MAC[host]}.`,
    dataPlaneRole: hop ? `Decision: ${hop.lookupResult}.` : "Accepts frames for its own MAC or the broadcast address; discards other flooded unicast.",
    packetBefore: hop?.input,
    packetAfter: hop?.output,
    tables,
  };
}
