import type { NodeExplanation } from "@/components/network3d/types";
import { ECHO_ID, HOST_PREFIX, INITIAL_TTL, RT_ARP, routeRow, type RtDevice, type RtHost, type RtRouter, type RtState } from "@/lib/sim-engine/scenarios/routingFundamentals";

type Table = { title: string; rows: { label: string; value: string }[] };

export function rtTables(device: RtDevice, s: RtState): Table[] {
  if (device === "R1" || device === "R2") {
    const r = device as RtRouter;
    const tables: Table[] = [{ title: "Routing table", rows: s.rib[r].map(routeRow) }];
    if (s.lookup?.router === r) {
      tables.push({
        title: "Current lookup",
        rows: [
          { label: "Destination", value: s.lookup.dst },
          { label: "Matching routes", value: s.lookup.matches.length ? s.lookup.matches.join(", ") : "none" },
          { label: "Selected", value: s.lookup.selected ?? "none" },
          { label: "Result", value: s.lookup.outcome === "forward" ? `forward via ${s.lookup.nextHop} out ${s.lookup.iface}` : s.lookup.outcome === "discard" ? "discard route — dropped here" : "no route — dropped" },
        ],
      });
    }
    tables.push({ title: "ARP cache", rows: Object.entries(RT_ARP[r]).map(([ip, e]) => ({ label: ip, value: `${e.mac} (${e.dev})` })) });
    return tables;
  }
  const h = HOST_PREFIX[device as RtHost];
  const rows = [
    { label: "IPv4", value: `${h.ip}/${h.len}` },
    { label: "Default gateway", value: h.gw },
    { label: "Echo identifier", value: String(ECHO_ID) },
    { label: "Initial TTL", value: String(INITIAL_TTL) },
  ];
  if (device === "HOST-A") {
    rows.push({ label: "SERVER-A result", value: s.results["SERVER-A"] });
    rows.push({ label: "SERVER-B result", value: s.results["SERVER-B"] });
  }
  return [{ title: "Host", rows }];
}

export function explainRt(s: RtState, id: string, stepId: string): NodeExplanation {
  const device = id as RtDevice;
  const hop = [...s.hops].reverse().find((h) => h.device === device && h.stepId === stepId);
  const tables = rtTables(device, s);
  const act = hop ? `${hop.action}: ${hop.reason}` : "Idle this step.";
  if (device === "R1" || device === "R2") {
    const r = device as RtRouter;
    return {
      id,
      name: r,
      deviceType: "IPv4 router (connected + static routes)",
      role: r === "R1" ? "HOST-A's gateway; static routes toward the servers and a default" : "The servers' gateway; static return route to HOST-A's LAN",
      currentAction: act,
      controlPlaneRole: `${s.rib[r].length} installed routes (${s.rib[r].filter((x) => x.source === "connected").length} connected, ${s.rib[r].filter((x) => x.source === "static").length} static). No routing protocol.`,
      dataPlaneRole: hop ? `In: ${hop.input}. Lookup: ${hop.lookupResult}. Out: ${hop.output}.` : "Longest prefix match on the IPv4 destination; new Ethernet frame and TTL − 1 per forwarded packet.",
      packetBefore: hop?.input,
      packetAfter: hop?.output,
      tables,
    };
  }
  const h = HOST_PREFIX[device as RtHost];
  return {
    id,
    name: device,
    deviceType: "IPv4 host",
    role: device === "HOST-A" ? "Client — runs the test pings" : "Server on 172.16.50.0/24",
    currentAction: act,
    controlPlaneRole: `${h.ip}/${h.len} · gateway ${h.gw}.`,
    dataPlaneRole: hop ? `${hop.lookupResult} → ${hop.output}.` : "Sends off-link traffic to its gateway's MAC; never changes the IPv4 destination.",
    packetBefore: hop?.input,
    packetAfter: hop?.output,
    tables,
  };
}
