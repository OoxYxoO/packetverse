import type { NodeExplanation } from "@/components/network3d/types";
import { BRIDGE_PRIO, L2_IP, L2_MAC, L2_PORTS, MGMT, MGMT_VLAN, USER_VLAN, allowedText, liveFdb, stpState, vlanMembers, type L2Device, type L2Host, type L2State, type L2Sw } from "@/lib/sim-engine/scenarios/troubleshootingLayer2";

type Table = { title: string; rows: { label: string; value: string }[] };
const macName = (m: string) => (m === L2_MAC["HOST-A"] ? "HOST-A" : m === L2_MAC["HOST-B"] ? "HOST-B" : m === MGMT.SW1.mac ? "SW1 mgmt" : m === MGMT.SW2.mac ? "SW2 mgmt" : m === MGMT.SW3.mac ? "SW3 mgmt" : m);

export function l2Tables(d: L2Device, s: L2State): Table[] {
  if (d === "HOST-A" || d === "HOST-B") {
    const h = d as L2Host;
    return [{ title: "Host", rows: [{ label: "IPv4", value: `${L2_IP[h]}/24` }, { label: "MAC", value: L2_MAC[h] }, { label: "VLAN (via access port)", value: String(USER_VLAN) }] }, ...(h === "HOST-A" ? [{ title: "ARP cache", rows: Object.entries(s.arpA).map(([ip, mac]) => ({ label: ip, value: mac })) }, { title: "Pings", rows: s.pings.map((p) => ({ label: `${p.label} (VLAN ${p.vlan})`, value: `${p.received}/${p.sent}` })) }] : [])];
  }
  const sw = d as L2Sw;
  return [
    { title: "VLAN membership", rows: [USER_VLAN, MGMT_VLAN].map((v) => ({ label: `VLAN ${v}`, value: vlanMembers(s, sw, v).join(", ") || "no ports" })) },
    { title: "Trunks", rows: L2_PORTS.filter((p) => p.sw === sw && p.mode === "trunk").map((p) => ({ label: p.port, value: `allowed ${allowedText(s, sw, p.port)} · native 1 · → ${p.peer}` })) },
    { title: "RSTP", rows: [{ label: "Bridge priority", value: String(BRIDGE_PRIO[sw]) }, { label: "Root bridge", value: "SW2 (4096)" }, ...L2_PORTS.filter((p) => p.sw === sw).map((p) => ({ label: p.port, value: `${p.role} / ${stpState(p)}` }))] },
    { title: "MAC table (live entries)", rows: liveFdb(s, sw).map((e) => ({ label: `VLAN ${e.vlan} · ${macName(e.mac)}`, value: `${e.port} · ${e.mac}` })) },
  ];
}

export function explainL2(s: L2State, id: string, stepId: string): NodeExplanation {
  const d = id as L2Device;
  const hop = [...s.hops].reverse().find((h) => h.device === d && h.stepId === stepId);
  const sw = d.startsWith("SW");
  return {
    id,
    name: d,
    deviceType: sw ? `Ethernet switch${d === "SW2" ? " (RSTP root)" : ""}` : "Host",
    role: sw ? `VLANs ${USER_VLAN}, ${MGMT_VLAN} · mgmt ${MGMT[d as L2Sw].ip}` : `${L2_IP[d as L2Host]}/24 · VLAN ${USER_VLAN}`,
    currentAction: hop ? `${hop.action}: ${hop.reason}` : "Idle this step.",
    controlPlaneRole: sw ? "RSTP, MAC learning and aging." : "ARP and ping.",
    dataPlaneRole: sw ? "Bridges frames per VLAN: classify, learn, look up, check egress membership and STP state, tag/untag." : "Sends and receives untagged frames.",
    packetBefore: hop?.input,
    packetAfter: hop?.output,
    tables: l2Tables(d, s),
  };
}
