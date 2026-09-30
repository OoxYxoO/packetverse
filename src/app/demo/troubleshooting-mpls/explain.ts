import type { NodeExplanation } from "@/components/network3d/types";
import { CUST, LDP_SESSIONS, LFIB, LOOP, RD, RT_INTENDED, VRF, VRF_IMPORT, importable, vpnKey, type MpDevice, type MpState, type VrfEntry } from "@/lib/sim-engine/scenarios/troubleshootingMpls";

type Table = { title: string; rows: { label: string; value: string }[] };
const vrfRows = (v: VrfEntry[]) => v.map((e) => ({ label: `${e.prefix}/${e.len}`, value: e.source === "imported" ? `via ${e.via} · VPN ${e.vpnLabel} · LDP ${e.transport}` : e.via }));

export function mpTables(d: MpDevice, s: MpState): Table[] {
  const ldp = { title: "LDP sessions", rows: LDP_SESSIONS.filter((l) => l.a === d || l.b === d).map((l) => ({ label: `${l.a}–${l.b}`, value: "Operational" })) };
  if (d === "PE1")
    return [
      { title: `VRF ${VRF}`, rows: [{ label: "RD", value: RD.PE1 }, { label: "Import RT", value: VRF_IMPORT.join(", ") }, { label: "Export RT", value: RT_INTENDED }, ...vrfRows(s.pe1Vrf)] },
      { title: "VPNv4 table (received from PE2)", rows: s.pe1Vpnv4.filter((r) => r.from === "PE2").map((r) => ({ label: vpnKey(r), value: `NH ${r.nextHop} · label ${r.label} · RT ${r.rts.join(",")} · ${importable(r) ? "imported" : "not imported"}` })) },
      { title: "MP-BGP", rows: [{ label: `${LOOP.PE1} ↔ ${LOOP.PE2}`, value: `${s.bgp} · VPNv4` }] },
      ldp,
      { title: "LFIB", rows: LFIB.PE1.map((x, i) => ({ label: String(i + 1), value: x })) },
      { title: "Counters (lesson traffic)", rows: [{ label: `${VRF} no-route drops`, value: String(s.pe1VrfDrops) }] },
    ];
  if (d === "PE2")
    return [
      { title: `VRF ${VRF}`, rows: [{ label: "RD", value: RD.PE2 }, { label: "Import RT", value: RT_INTENDED }, { label: "Export RT", value: s.pe2ExportRt }, ...vrfRows(s.pe2Vrf)] },
      { title: "MP-BGP", rows: [{ label: `${LOOP.PE2} ↔ ${LOOP.PE1}`, value: `${s.bgp} · VPNv4` }] },
      ldp,
      { title: "LFIB", rows: LFIB.PE2.map((x, i) => ({ label: String(i + 1), value: x })) },
    ];
  if (d === "P1" || d === "P2") return [{ title: "Role", rows: [{ label: "Customer routes", value: "none (no VRF, no VPNv4)" }, { label: "Loopback", value: LOOP[d] }] }, ldp, { title: "LFIB", rows: LFIB[d].map((x, i) => ({ label: String(i + 1), value: x })) }];
  return [{ title: "Customer router", rows: [{ label: "LAN", value: d === "CE1" ? `${CUST.ce1Lan}/24` : `${CUST.ce2Lan}/24` }, { label: "Default route", value: `via ${d === "CE1" ? CUST.pe1Ce : CUST.pe2Ce}` }] }, ...(d === "CE1" ? [{ title: "Pings", rows: s.pings.map((p) => ({ label: `${p.label} → ${p.to}`, value: `${p.received}/${p.sent}` })) }] : [])];
}

export function explainMp(s: MpState, id: string, stepId: string): NodeExplanation {
  const d = id as MpDevice;
  const hop = [...s.hops].reverse().find((h) => h.device === d && h.stepId === stepId);
  const pe = d === "PE1" || d === "PE2";
  const p = d === "P1" || d === "P2";
  return {
    id,
    name: d,
    deviceType: pe ? "Provider edge (PE)" : p ? "Provider core (P)" : "Customer edge (CE)",
    role: pe ? `VRF ${VRF} · loopback ${LOOP[d]}` : p ? `label switching · loopback ${LOOP[d]}` : `site ${d === "CE1" ? CUST.ce1Lan : CUST.ce2Lan}/24`,
    currentAction: hop ? `${hop.action}: ${hop.reason}` : "Idle this step.",
    controlPlaneRole: pe ? "IGP + LDP (transport), MP-BGP VPNv4 (routes, VPN labels, RTs), VRF import/export." : p ? "IGP + LDP only — no customer state." : "Customer routing only.",
    dataPlaneRole: pe ? "VRF lookup; impose VPN + transport labels / dispose the VPN label." : p ? "Swap or pop the TOP label." : "Plain IPv4.",
    packetBefore: hop?.input,
    packetAfter: hop?.output,
    tables: mpTables(d, s),
  };
}
