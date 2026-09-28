import type { NodeExplanation } from "@/components/network3d/types";
import { ECHO_IDENTIFIER, IC_ADDR, INITIAL_TTL, ROUTES, mtuOf, type IcDevice, type IcmpState } from "@/lib/sim-engine/scenarios/icmpDiagnostics";

type Table = { title: string; rows: { label: string; value: string }[] };

export function icTables(device: IcDevice, s: IcmpState): Table[] {
  if (device === "R1" || device === "R2") {
    return [
      { title: "Routing table", rows: ROUTES[device].map((r) => ({ label: `${r.prefix}/${r.len}`, value: `${r.via}${r.nextHop ? ` via ${r.nextHop}` : ""} · ${r.iface}` })) },
      { title: "IP MTU", rows: (["ge-0/0/0", "ge-0/0/1"] as const).map((i) => ({ label: i, value: `${mtuOf(s, device, i)} bytes` })) },
    ];
  }
  const a = device === "HOST-A";
  const rows = [
    { label: "IPv4", value: a ? `${IC_ADDR["HOST-A"]}/24` : `${IC_ADDR["HOST-B"]}/24` },
    { label: "Gateway", value: a ? IC_ADDR["R1:LAN"] : IC_ADDR["R2:LAN"] },
    { label: "Echo identifier", value: `${ECHO_IDENTIFIER}` },
    { label: "Initial TTL", value: `${INITIAL_TTL}` },
  ];
  if (a) rows.push({ label: "Probe data", value: `${s.probe.dataLength} bytes · ${s.probe.df ? "DF set" : "DF clear"} · ${20 + 8 + s.probe.dataLength} B total` });
  const tables: Table[] = [{ title: "Host", rows }];
  if (a && s.traceResults.length) tables.push({ title: "Traceroute (ICMP Echo)", rows: s.traceResults.map((t) => ({ label: `hop ${t.ttl}`, value: `${t.from} (${t.device}) · ${t.message}` })) });
  return tables;
}

export function explainIc(s: IcmpState, id: string, stepId: string): NodeExplanation {
  const device = id as IcDevice;
  const hop = [...s.hops].reverse().find((h) => h.device === device && h.stepId === stepId);
  const tables = icTables(device, s);
  const act = hop ? `${hop.action}: ${hop.reason}` : "Idle this step.";
  if (device === "R1" || device === "R2") {
    return {
      id,
      name: device,
      deviceType: "IPv4 router (static routes)",
      role: device === "R1" ? "HOST-A's gateway; transit toward R2" : "HOST-B's gateway; transit toward R1",
      currentAction: act,
      controlPlaneRole: `Knows connected + static routes only. Transit IP MTU ${s.transitMtu} bytes.`,
      dataPlaneRole: hop ? `Received: ${hop.input}. Lookup: ${hop.lookupResult}. Result: ${hop.output}.` : "Decrements TTL when forwarding; generates ICMP Time Exceeded or Fragmentation Needed when it cannot forward.",
      packetBefore: hop?.input,
      packetAfter: hop?.output,
      note: s.faultActive && device === "R1" ? `The transit link now has an IP MTU of ${s.transitMtu}.` : undefined,
      tables,
    };
  }
  return {
    id,
    name: device,
    deviceType: "IPv4 host",
    role: device === "HOST-A" ? "Runs ping, traceroute and PMTU probes" : "Destination — answers Echo Requests",
    currentAction: act,
    controlPlaneRole: "Knows its own address and default gateway.",
    dataPlaneRole: hop ? `Result: ${hop.output}.` : "Does not decrement TTL on packets it receives.",
    packetBefore: hop?.input,
    packetAfter: hop?.output,
    tables,
  };
}
