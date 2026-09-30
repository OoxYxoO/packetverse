import type { NodeExplanation } from "@/components/network3d/types";
import { L3, L3_MAC, R1_ROUTES, R2_ROUTES, clientRoutes, maskOf, routeText, rtText, type L3Device, type L3State } from "@/lib/sim-engine/scenarios/troubleshootingLayer3";

type Table = { title: string; rows: { label: string; value: string }[] };

export function l3Tables(d: L3Device, s: L3State): Table[] {
  if (d === "CLIENT")
    return [
      { title: "eth0", rows: [{ label: "IPv4", value: `${L3.client}/${s.clientPrefix}` }, { label: "Mask", value: maskOf(s.clientPrefix) }, { label: "Gateway", value: L3.gw }, { label: "MAC", value: L3_MAC.CLIENT }] },
      { title: "Routing table", rows: clientRoutes(s.clientPrefix).map((r) => ({ label: `${r.prefix}/${r.len}`, value: routeText(r) })) },
      { title: "ARP cache", rows: [...Object.entries(s.clientArp).map(([ip, mac]) => ({ label: ip, value: mac })), ...Object.entries(s.arpPending).map(([ip, n]) => ({ label: ip, value: `INCOMPLETE (${n} request${n === 1 ? "" : "s"}, no reply)` }))] },
      { title: "Pings", rows: s.pings.map((p) => ({ label: `${p.label} → ${p.dst}`, value: `${p.received}/${p.sent}${p.note ? ` · ${p.note}` : ""}` })) },
    ];
  if (d === "R1")
    return [
      { title: "Routes", rows: R1_ROUTES.map((r) => ({ label: `${r.prefix}/${r.len}`, value: rtText(r) })) },
      { title: "ARP / proxy ARP", rows: [{ label: "Proxy ARP", value: "disabled" }, ...Object.entries(s.r1Stats.arpForOthers).map(([ip, n]) => ({ label: `ARP heard for ${ip}`, value: `${n} (not my address — ignored)` }))] },
      { title: "IPv4 from CLIENT (lesson traffic)", rows: Object.entries(s.r1Stats.ipFromClient).map(([ip, n]) => ({ label: `→ ${ip}`, value: String(n) })) },
    ];
  if (d === "R2") return [{ title: "Routes", rows: R2_ROUTES.map((r) => ({ label: `${r.prefix}/${r.len}`, value: rtText(r) })) }];
  if (d === "SW1") return [{ title: "MAC table", rows: [{ label: L3_MAC.CLIENT, value: "ge-0/0/1" }, { label: L3_MAC.R1_LAN, value: "ge-0/0/24" }] }];
  const ip = d === "SERVER" ? L3.server : L3.remote;
  return [{ title: "Host", rows: [{ label: "IPv4", value: `${ip}/24` }, { label: "Gateway", value: d === "SERVER" ? L3.r2Srv : L3.r2Rem }] }];
}

export function explainL3(s: L3State, id: string, stepId: string): NodeExplanation {
  const d = id as L3Device;
  const hop = [...s.hops].reverse().find((h) => h.device === d && h.stepId === stepId);
  const router = d === "R1" || d === "R2";
  return {
    id,
    name: d,
    deviceType: router ? "Router" : d === "SW1" ? "Access switch" : "Host",
    role: d === "CLIENT" ? `${L3.client}/${s.clientPrefix} · gw ${L3.gw}` : d === "SERVER" ? `${L3.server}/24` : d === "REMOTE-SERVER" ? `${L3.remote}/24` : router ? "Routes between subnets" : "Layer 2 only",
    currentAction: hop ? `${hop.action}: ${hop.reason}` : "Idle this step.",
    controlPlaneRole: router ? "Static/connected routes; ARP for its own addresses." : d === "SW1" ? "MAC learning." : "Own routing table + ARP.",
    dataPlaneRole: router ? "Longest-prefix match, TTL − 1, new Ethernet addresses." : d === "SW1" ? "Forwards frames unchanged; floods broadcasts." : "Sends to the next hop's MAC.",
    packetBefore: hop?.input,
    packetAfter: hop?.output,
    tables: l3Tables(d, s),
  };
}
