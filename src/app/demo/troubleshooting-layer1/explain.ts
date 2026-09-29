import type { NodeExplanation } from "@/components/network3d/types";
import { L1_IP, L1_MAC, MEDIA, UPLINK, counterLine, dbm, deltaOf, type L1Device, type L1State, type Sw } from "@/lib/sim-engine/scenarios/troubleshootingLayer1";

type Table = { title: string; rows: { label: string; value: string }[] };

export function l1Tables(d: L1Device, s: L1State): Table[] {
  if (d === "CLIENT" || d === "SERVER") {
    const series = s.pings.map((p) => ({ label: `ping (${p.series})`, value: `${p.sent} sent · ${p.received} received · ${p.sent - p.received}% loss${p.lost.length ? ` · lost seq ${p.lost.join(", ")}` : ""}` }));
    return [{ title: "Host", rows: [{ label: "IPv4", value: `${L1_IP[d]}/24` }, { label: "MAC", value: L1_MAC[d] }] }, ...(d === "CLIENT" ? [{ title: "Ping results", rows: series }] : [])];
  }
  const sw = d as Sw;
  const delta = deltaOf(s, sw);
  return [
    { title: `${UPLINK} state`, rows: [{ label: "Admin / oper", value: `${s.admin[sw]} / ${s.oper[sw]}` }, { label: "Media", value: MEDIA }, { label: "Speed / duplex", value: "1000 Mb/s · full" }, { label: "Last change", value: s.lastFlap[sw] }] },
    { title: `${UPLINK} optics (device DOM)`, rows: [{ label: "Tx", value: dbm(s.optics[sw].tx) }, { label: "Rx", value: dbm(s.optics[sw].rx) }] },
    { title: `${UPLINK} counters (since last clear)`, rows: [{ label: "Now", value: counterLine(s.counters[sw]) }, ...(delta ? [{ label: `Δ ${delta.from.label} → ${delta.to.label}`, value: `CRC +${delta.crc} · input errors +${delta.inErrors} · in pkts +${delta.inPkts.toLocaleString("en-US")} over ${delta.to.t - delta.from.t} s` }] : [])] },
  ];
}

export function explainL1(s: L1State, id: string, stepId: string): NodeExplanation {
  const d = id as L1Device;
  const hop = [...s.hops].reverse().find((h) => h.device === d && h.stepId === stepId);
  const sw = d === "ACCESS-SW" || d === "DIST-SW";
  return {
    id,
    name: d,
    deviceType: sw ? "Ethernet switch" : "Host",
    role: sw ? `${UPLINK} ↔ ${d === "ACCESS-SW" ? "DIST-SW" : "ACCESS-SW"} (fiber uplink)` : `${L1_IP[d as "CLIENT" | "SERVER"]}/24`,
    currentAction: hop ? `${hop.action}: ${hop.reason}` : "Idle this step.",
    controlPlaneRole: sw ? "MAC learning; interface monitoring (state, counters, optics)." : "Pings its peer.",
    dataPlaneRole: sw ? "Checks every frame's FCS on receive; forwards good frames by MAC." : "Sends and receives Ethernet/IPv4/ICMP.",
    packetBefore: hop?.input,
    packetAfter: hop?.output,
    tables: l1Tables(d, s),
  };
}
