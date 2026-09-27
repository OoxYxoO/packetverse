import type { PacketLayer, PacketVisual } from "@/lib/sim-engine/types";
import type { PacketCallout3D } from "@/components/network3d/types";
import { PROTOCOL_HEX } from "./packetCallout";
import { evpnCallout, type EvpnName } from "./evpnCallout";

/**
 * Readable 2D bubbles / 3D callouts for the EVPN multihoming lessons (Multihoming, Aliasing + Mass Withdrawal,
 * EVPN-VPWS). Additive to `evpnCallout` — it only handles what that helper does not model (Type 4, Type 1 per-ES /
 * per-EVI, a multihomed Type 2 without a next-hop field, VPWS MPLS stacks) and delegates everything else unchanged.
 * Every value is read back from the PacketVisual the scenario built; control-plane fields (route type, ESI, RD, RT,
 * ES-Import RT, Single-Active flag, service label advertisement, withdraw action) only ever appear when the packet IS a
 * BGP UPDATE. Tenant/customer frames are described strictly from their own wire layers.
 */
const layer = (p: PacketVisual, re: RegExp) => p.layers.find((l) => re.test(l.name));
const field = (l: PacketLayer | undefined, re: RegExp) => l?.fields.find((f) => re.test(f.label))?.value;
const nm = (name: EvpnName, v: string | undefined) => (v ? (name(v) ?? v) : "?");
const shortEsi = (esi: string | undefined) => (esi && esi.includes(":") ? `…${esi.slice(-8)}` : (esi ?? "?"));

function bgpCallout(p: PacketVisual, bgp: PacketLayer, name: EvpnName): PacketCallout3D | undefined {
  const color = PROTOCOL_HEX[p.protocol];
  const routeType = field(bgp, /^Route Type/) ?? "";
  const esi = field(bgp, /^Ethernet Segment Identifier$|^ESI$/);
  const rd = field(bgp, /^RD$/);
  const rt = field(bgp, /^Route Target$/);
  const withdraw = field(bgp, /^Action$/) === "WITHDRAW";
  const verb = withdraw ? "BGP EVPN WITHDRAW" : "BGP EVPN UPDATE";
  const origin = nm(name, p.from);

  if (routeType.startsWith("4")) {
    const importRt = field(bgp, /^ES-Import Route Target/);
    return { title: `${verb} · Type 4 (Ethernet Segment) · ${origin} · ESI ${shortEsi(esi)}`, detail: [`originator ${nm(name, field(bgp, /^Originating PE/))}`, importRt ? `ES-Import RT ${importRt}` : undefined, rd ? `RD ${rd}` : undefined].filter(Boolean).join(" · "), color };
  }
  if (routeType.startsWith("1")) {
    const tag = field(bgp, /^Ethernet Tag ID/) ?? "?";
    const perEs = /per ES|per-ES/i.test(routeType) || tag.startsWith("0xFFFFFFFF");
    const serviceId = field(bgp, /^Ethernet Tag ID \(VPWS Service ID\)/);
    const vni = field(bgp, /^VNI \(Label field\)/);
    const sa = field(bgp, /Single-Active flag/);
    const serviceLabel = field(bgp, /^Service Label$/);
    const form = perEs ? "A-D per-ES" : "A-D per-EVI";
    const scope = serviceId ? `VPWS service ${serviceId}` : `ESI ${shortEsi(esi)}`;
    const extras = [
      serviceId ? `ESI ${esi && esi.startsWith("0") && !esi.includes(":") ? "0 (single-homed)" : shortEsi(esi)}` : undefined,
      `Ethernet Tag ${tag}`,
      vni ? `VNI ${vni} (label field)` : undefined,
      serviceLabel ? `service label ${serviceLabel}` : undefined,
      sa ? `Single-Active flag ${sa}` : undefined,
      rd ? `RD ${rd}` : undefined,
      rt ? `RT ${rt}` : undefined,
    ].filter(Boolean);
    return { title: `${verb} · Type 1 ${form} · ${origin} · ${scope}`, detail: extras.join(" · "), color };
  }
  if (routeType.startsWith("2") && esi && !field(bgp, /^Next Hop/)) {
    const mac = field(bgp, /^MAC Address/);
    return { title: `${verb} · Type 2 · ${nm(name, mac)} · ESI ${shortEsi(esi)}`, detail: [`${mac} / ${field(bgp, /^IP Address/) ?? "?"}`, `originated by ${origin}`, "usable next hops come from the A-D routes, not this route", rd ? `RD ${rd}` : undefined, rt ? `RT ${rt}` : undefined].filter(Boolean).join(" · "), color };
  }
  return undefined;
}

/** MPLS VPWS packet: transport label (toward the disposition PE) over the VPWS service label over the customer frame. */
function mplsCallout(p: PacketVisual, name: EvpnName): PacketCallout3D | undefined {
  const transport = layer(p, /^MPLS Shim \(transport\)/);
  const service = layer(p, /^MPLS Shim \(service\)/);
  const cust = layer(p, /^Ethernet \(Customer Frame\)/);
  if (!cust) return undefined;
  const src = field(cust, /^Source MAC/);
  const dst = field(cust, /^Destination MAC/);
  const frame = `customer Ethernet ${nm(name, src)} → ${nm(name, dst)}`;
  if (!transport && !service) return { title: `Customer Ethernet · ${nm(name, src)} → ${nm(name, dst)}`, detail: `${src} → ${dst} · no MPLS labels on the attachment circuit`, color: PROTOCOL_HEX.ETHERNET };
  const t = field(transport, /^Label$/);
  const s = field(service, /^Label$/);
  return {
    title: `MPLS · transport ${t ?? "—"}${t && name(t) ? ` (${name(t)})` : ""} · VPWS service ${s ?? "—"}`,
    detail: [s && name(s) ? `service label ${s} → ${name(s)}` : undefined, frame].filter(Boolean).join(" · "),
    color: PROTOCOL_HEX[p.protocol],
  };
}

export function evpnMhCallout(p: PacketVisual, name: EvpnName): PacketCallout3D {
  const bgp = layer(p, /^BGP UPDATE/);
  if (bgp) {
    const c = bgpCallout(p, bgp, name);
    if (c) return c;
  }
  const m = mplsCallout(p, name);
  if (m) return m;
  // One VXLAN visual standing for every ingress-replication copy (no single outer destination): say so instead of "→ —".
  const vx = layer(p, /^VXLAN Header/);
  const outer = layer(p, /^Outer IP/);
  if (vx && outer && field(outer, /^Outer Dst/) === "—") {
    const inner = layer(p, /^Original Ethernet Frame/);
    return { title: `VXLAN replicas · VNI ${field(vx, /^VNI/) ?? "?"} · from ${nm(name, field(outer, /^Outer Src/))} · one copy per flood-list VTEP`, detail: `inner frame ${nm(name, field(inner, /Src MAC/))} → ${nm(name, field(inner, /Dst MAC/))} · each copy gets its own outer destination VTEP`, color: PROTOCOL_HEX.VXLAN };
  }
  return evpnCallout(p, name);
}

/** Callout for one VXLAN BUM replica drawn from the scenario's replica stage (no packet of its own): outer VTEPs + VNI only. */
export function vxlanCopyCallout(vni: number, srcVtep: string, dstVtep: string, name: EvpnName): PacketCallout3D {
  return { title: `VXLAN copy · VNI ${vni} · ${nm(name, srcVtep)} → ${nm(name, dstVtep)}`, detail: `outer ${srcVtep} → ${dstVtep} · inner broadcast frame unchanged`, color: PROTOCOL_HEX.VXLAN };
}
