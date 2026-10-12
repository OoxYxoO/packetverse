import { spClone, type SpBase, type SpMoment, type SpRun } from "@/components/sp-lab/spKit";

/**
 * MPLS L3VPN Lab network — the guided lesson's provider core with two customers that use the same addresses.
 *
 *   CE1A (CUST-A) ─┐                                  ┌─ CE2A (CUST-A)   10.2.2.0/24
 *   10.1.1.0/24     PE1 ── P1 ── P2 ── PE2 ─────────── ┼─ CE2B (CUST-B)   10.2.2.0/24
 *   CE1B (CUST-B) ─┘  1.1.1.1 2.2.2.2 3.3.3.3 4.4.4.4   └─ CE2S (SHARED)  10.9.9.0/24
 *   10.1.1.0/24
 *
 * Both customers use 10.1.1.0/24 at site 1 and 10.2.2.0/24 at site 2, and even the same PE–CE link subnets
 * (172.16.1.0/29 at PE1, 172.16.2.0/29 at PE2). CE1A also has a second LAN, 10.1.2.0/24, that the provider does not
 * announce yet. CE2S is a shared service in its own VRF on PE2.
 *
 * Modeled (RFC 4364, RFC 4659 not needed — IPv4 only):
 * - VRFs on the PEs: interfaces bound to a VRF, static routes toward the CEs (installed when the next hop is in a
 *   connected subnet of an up interface in that VRF), redistributed into BGP for the VRF (`redistribute static`).
 * - MP-BGP VPNv4 between the PE loopbacks (iBGP, AS 65000): the session needs both neighbors configured; VPNv4 routes
 *   are exchanged only if both sides activate the vpnv4 unicast family. A VPNv4 route = RD:prefix, next hop = the
 *   advertising PE's loopback, export route targets, a VPN label (per prefix, or per VRF).
 * - Import: a PE installs a VPNv4 route (remote or from another local VRF) in every VRF that imports one of its route
 *   targets. RDs only make routes unique; they never decide import.
 * - Transport: LDP on core interfaces (IS-IS underneath reaches every loopback). Label control follows the lab's OS like
 *   the MPLS + LDP lesson: IOS XR independent (a router with no label from its next hop forwards unlabeled — removing
 *   the transport label and exposing the VPN label to the next router, which drops it); Junos ordered (no LSP to the
 *   BGP next hop → the VPN route is hidden on the ingress PE).
 * - Data plane: ingress PE looks up the destination in the CE interface's VRF, pushes the VPN label and the transport
 *   label; P routers swap / pop (PHP) the transport label without knowing any customer route; the egress PE maps the
 *   VPN label to the VRF and forwards to its CE. A ping needs the reply to make it back.
 */

export type L3R = "PE1" | "P1" | "P2" | "PE2";
export type L3Ce = "CE1A" | "CE1B" | "CE2A" | "CE2B" | "CE2S";
export const L3_ROUTERS: L3R[] = ["PE1", "P1", "P2", "PE2"];
export const L3_PES: L3R[] = ["PE1", "PE2"];
export const L3_LO: Record<L3R, string> = { PE1: "1.1.1.1", P1: "2.2.2.2", P2: "3.3.3.3", PE2: "4.4.4.4" };
export const AS = 65000;
export type IfName = "ge-0/0/0" | "ge-0/0/1" | "ge-0/0/2" | "ge-0/0/3";
export interface L3CeDef {
  pe: L3R;
  ifn: IfName;
  vrf: string;
  peIp: string;
  ceIp: string;
  nets: string[];
  host: string;
}
export const CES: Record<L3Ce, L3CeDef> = {
  CE1A: { pe: "PE1", ifn: "ge-0/0/1", vrf: "CUST-A", peIp: "172.16.1.1", ceIp: "172.16.1.2", nets: ["10.1.1.0/24", "10.1.2.0/24"], host: "10.1.1.10" },
  CE1B: { pe: "PE1", ifn: "ge-0/0/2", vrf: "CUST-B", peIp: "172.16.1.1", ceIp: "172.16.1.2", nets: ["10.1.1.0/24"], host: "10.1.1.10" },
  CE2A: { pe: "PE2", ifn: "ge-0/0/1", vrf: "CUST-A", peIp: "172.16.2.1", ceIp: "172.16.2.2", nets: ["10.2.2.0/24"], host: "10.2.2.20" },
  CE2B: { pe: "PE2", ifn: "ge-0/0/2", vrf: "CUST-B", peIp: "172.16.2.1", ceIp: "172.16.2.2", nets: ["10.2.2.0/24"], host: "10.2.2.20" },
  CE2S: { pe: "PE2", ifn: "ge-0/0/3", vrf: "SHARED", peIp: "172.16.9.1", ceIp: "172.16.9.2", nets: ["10.9.9.0/24"], host: "10.9.9.10" },
};
export const L3_CES = Object.keys(CES) as L3Ce[];
export const VRF_ORDER = ["CUST-A", "CUST-B", "SHARED"];
export const RT: Record<string, string> = { "CUST-A": "65001:100", "CUST-B": "65001:200", SHARED: "65001:900" };
export interface L3Link {
  id: string;
  a: L3R;
  ai: IfName;
  aip: string;
  b: L3R;
  bi: IfName;
  bip: string;
}
export const L3_LINKS: L3Link[] = [
  { id: "PE1-P1", a: "PE1", ai: "ge-0/0/0", aip: "192.0.2.0", b: "P1", bi: "ge-0/0/0", bip: "192.0.2.1" },
  { id: "P1-P2", a: "P1", ai: "ge-0/0/1", aip: "192.0.2.2", b: "P2", bi: "ge-0/0/0", bip: "192.0.2.3" },
  { id: "P2-PE2", a: "P2", ai: "ge-0/0/1", aip: "192.0.2.4", b: "PE2", bi: "ge-0/0/0", bip: "192.0.2.5" },
];
export const PATH: L3R[] = ["PE1", "P1", "P2", "PE2"];
export const coreIfs = (r: L3R) => L3_LINKS.filter((l) => l.a === r || l.b === r).map((l) => (l.a === r ? { ifn: l.ai, ip: l.aip, peer: l.b, link: l } : { ifn: l.bi, ip: l.bip, peer: l.a, link: l }));
export const ceIfs = (r: L3R) => L3_CES.filter((c) => CES[c].pe === r).map((c) => ({ ce: c, ...CES[c] }));
export const ipOn = (r: L3R, peer: L3R) => coreIfs(r).find((x) => x.peer === peer)!.ip;

// ---------------------------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------------------------
export interface L3Static {
  prefix: string;
  nh: string;
}
export interface L3Vrf {
  rd?: string;
  imp: string[];
  exp: string[];
  statics: L3Static[];
  redist: boolean;
  perVrfLabel: boolean;
  /** Junos only: a vrf-import policy; when set it decides import instead of vrf-target. */
  vrfImport?: string;
  /** Junos only: routing-options auto-export — needed to leak routes between VRFs on the same PE. */
  autoExport?: boolean;
}
/** Junos only: policy-options communities (name → route target) and policy-statements (name → term → match / action). */
export interface L3JnPolicy {
  comms: Record<string, string>;
  pols: Record<string, Record<string, { from: string[]; accept: boolean }>>;
}
export interface L3IfCfg {
  /** VRF the interface belongs to (undefined = global table). */
  vrf?: string;
  ldp: boolean;
  shut: boolean;
}
export interface L3Cfg {
  vrfs: Record<string, L3Vrf>;
  ifs: Partial<Record<IfName, L3IfCfg>>;
  /** The iBGP neighbor (the other PE's loopback) and its families. */
  nbr?: { ip: string; vpnv4: boolean };
  jpol?: L3JnPolicy;
}
export type L3Config = Record<L3R, L3Cfg>;
/** The route targets a VRF actually imports: its import list, or (Junos) the communities its vrf-import policy accepts. */
export function vrfImports(c: L3Cfg, v: L3Vrf): string[] {
  if (!v.vrfImport) return v.imp;
  const terms = c.jpol?.pols[v.vrfImport];
  if (!terms) return [];
  return [...new Set(Object.values(terms).filter((t) => t.accept).flatMap((t) => t.from.map((n) => c.jpol!.comms[n]).filter((x): x is string => !!x)))];
}

const rdOf = (pe: L3R, vrf: string) => `65001:${{ "CUST-A": 1, "CUST-B": 2, SHARED: 9 }[vrf]}0${pe === "PE1" ? 1 : 2}`;
export function l3Healthy(): L3Config {
  const c = {} as L3Config;
  for (const r of L3_ROUTERS) {
    const ifs: Partial<Record<IfName, L3IfCfg>> = {};
    for (const x of coreIfs(r)) ifs[x.ifn] = { ldp: true, shut: false };
    for (const x of ceIfs(r)) ifs[x.ifn] = { vrf: x.vrf, ldp: false, shut: false };
    c[r] = { vrfs: {}, ifs };
  }
  for (const pe of L3_PES) {
    for (const x of ceIfs(pe)) {
      c[pe].vrfs[x.vrf] = { rd: rdOf(pe, x.vrf), imp: [RT[x.vrf]], exp: [RT[x.vrf]], statics: [{ prefix: x.nets[0], nh: x.ceIp }], redist: true, perVrfLabel: false };
    }
    c[pe].nbr = { ip: L3_LO[pe === "PE1" ? "PE2" : "PE1"], vpnv4: true };
  }
  return c;
}

// ---------------------------------------------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------------------------------------------
export const ipNum = (ip: string) => ip.split(".").reduce((a, o) => a * 256 + Number(o), 0);
export const inPrefix = (ip: string, prefix: string) => {
  const [net, len] = prefix.split("/");
  const L = Number(len);
  return L === 0 || Math.floor(ipNum(ip) / 2 ** (32 - L)) === Math.floor(ipNum(net) / 2 ** (32 - L));
};
const plen = (p: string) => Number(p.split("/")[1]);
export const connectedOf = (ce: L3CeDef) => `${ce.peIp.split(".").slice(0, 3).join(".")}.0/29`;

// ---------------------------------------------------------------------------------------------------------------
// The control plane
// ---------------------------------------------------------------------------------------------------------------
export type L3Os = "xr" | "junos";
export const LABEL_BASE: Record<L3Os, number> = { xr: 24000, junos: 299776 };
const FEC_ORDER = ["1.1.1.1", "4.4.4.4", "2.2.2.2", "3.3.3.3"];
export const IMPLICIT_NULL = 3;
/** LDP local label of router r for a loopback FEC (P routers as in the MPLS + LDP lab; PEs above 24500). */
export function ldpLabel(os: L3Os, r: L3R, fec: string) {
  if (L3_LO[r] === fec) return IMPLICIT_NULL;
  const idx = L3_ROUTERS.indexOf(r);
  return LABEL_BASE[os] + (r.startsWith("PE") ? 500 : 0) + 101 * idx + FEC_ORDER.indexOf(fec);
}
export function vpnLabel(os: L3Os, pe: L3R, vrf: string, pfxIdx: number, perVrf: boolean) {
  return LABEL_BASE[os] + (pe === "PE1" ? 1 : 2) + 10 * VRF_ORDER.indexOf(vrf) + (perVrf ? 50 : 100 * pfxIdx);
}
export interface L3Route {
  vrf: string;
  prefix: string;
  via: "connected" | "static" | "bgp";
  /** CE next hop (static) or the advertising PE (bgp). */
  nh?: string;
  ifn?: IfName;
  /** BGP: where it came from. */
  from?: L3R;
  srcVrf?: string;
  rd?: string;
  rts?: string[];
  label?: number;
  /** Junos: unusable because there is no LSP to the BGP next hop. */
  hidden?: boolean;
}
export interface L3Vpnv4 {
  pe: L3R;
  vrf: string;
  rd: string;
  prefix: string;
  rts: string[];
  label: number;
  nh: string;
}
export interface L3View {
  ldp: Record<string, boolean>;
  /** Transport labels per router for each PE loopback (what it pushes / swaps to toward that FEC); undefined = none. */
  lsp: Record<L3R, Partial<Record<string, { out?: number; nh?: L3R }>>>;
  bgpUp: boolean;
  vpnv4Up: boolean;
  /** Every VPNv4 route each PE originates. */
  vpnv4: L3Vpnv4[];
  vrfRoutes: Record<L3R, L3Route[]>;
}
export const ldpUp = (c: L3Config, l: L3Link) => c[l.a].ifs[l.ai]!.ldp && c[l.b].ifs[l.bi]!.ldp && !c[l.a].ifs[l.ai]!.shut && !c[l.b].ifs[l.bi]!.shut;
function vrfInstalled(c: L3Config, pe: L3R): L3Route[] {
  const out: L3Route[] = [];
  for (const x of ceIfs(pe)) {
    const ic = c[pe].ifs[x.ifn]!;
    if (ic.vrf && !ic.shut && c[pe].vrfs[ic.vrf]) out.push({ vrf: ic.vrf, prefix: connectedOf(x), via: "connected", ifn: x.ifn });
  }
  for (const [vrf, v] of Object.entries(c[pe].vrfs)) {
    for (const st of v.statics) {
      // Installed when the next hop resolves through a connected subnet of the VRF (ARP is the data plane's problem).
      const ifn = ceIfs(pe).find((x) => c[pe].ifs[x.ifn]!.vrf === vrf && !c[pe].ifs[x.ifn]!.shut && inPrefix(st.nh, connectedOf(x)))?.ifn;
      if (ifn) out.push({ vrf, prefix: st.prefix, via: "static", nh: st.nh, ifn });
    }
  }
  return out;
}
export function l3Compute(c: L3Config, os: L3Os): L3View {
  const ldp: Record<string, boolean> = Object.fromEntries(L3_LINKS.map((l) => [l.id, ldpUp(c, l)]));
  const lsp = Object.fromEntries(L3_ROUTERS.map((r) => [r, {}])) as L3View["lsp"];
  for (const fec of [L3_LO.PE1, L3_LO.PE2]) {
    const dst = fec === L3_LO.PE2 ? "PE2" : "PE1";
    const order = dst === "PE2" ? PATH : [...PATH].reverse();
    // Walk upstream from the egress (Junos ordered control stops at the first broken session).
    let chain = true;
    for (let i = order.length - 2; i >= 0; i--) {
      const r = order[i];
      const nh = order[i + 1];
      const link = L3_LINKS.find((l) => (l.a === r && l.b === nh) || (l.b === r && l.a === nh))!;
      const has = ldp[link.id] && (os === "xr" || chain);
      if (!ldp[link.id]) chain = false;
      lsp[r][fec] = has ? { out: ldpLabel(os, nh, fec), nh } : { nh };
    }
  }
  const nbr = (pe: L3R) => c[pe].nbr;
  const bgpUp = nbr("PE1")?.ip === L3_LO.PE2 && nbr("PE2")?.ip === L3_LO.PE1;
  const vpnv4Up = bgpUp && !!nbr("PE1")?.vpnv4 && !!nbr("PE2")?.vpnv4;
  const installed = Object.fromEntries(L3_PES.map((pe) => [pe, vrfInstalled(c, pe)])) as Record<L3R, L3Route[]>;
  const vpnv4: L3Vpnv4[] = [];
  for (const pe of L3_PES) {
    for (const [vrf, v] of Object.entries(c[pe].vrfs)) {
      if (!v.rd || (!v.redist && os === "xr")) continue;
      installed[pe].filter((r) => r.vrf === vrf && r.via === "static").forEach((r, i) => vpnv4.push({ pe, vrf, rd: v.rd!, prefix: r.prefix, rts: v.exp, label: vpnLabel(os, pe, vrf, i, v.perVrfLabel), nh: L3_LO[pe] }));
    }
  }
  const vrfRoutes = Object.fromEntries(L3_ROUTERS.map((r) => [r, [] as L3Route[]])) as Record<L3R, L3Route[]>;
  for (const pe of L3_PES) {
    vrfRoutes[pe].push(...installed[pe]);
    for (const [vrf, v] of Object.entries(c[pe].vrfs)) {
      for (const route of vpnv4) {
        const local = route.pe === pe;
        if (local && route.vrf === vrf) continue;
        if (!local && !vpnv4Up) continue;
        if (!route.rts.some((rt) => vrfImports(c[pe], v).includes(rt))) continue;
        // Junos doesn't import a route from another VRF of the same PE unless both instances run auto-export.
        if (local && os === "junos" && !(v.autoExport && c[pe].vrfs[route.vrf]?.autoExport)) continue;
        const hidden = !local && os === "junos" && lsp[pe][route.nh]?.out === undefined;
        vrfRoutes[pe].push({ vrf, prefix: route.prefix, via: "bgp", nh: route.nh, from: route.pe, srcVrf: route.vrf, rd: route.rd, rts: route.rts, label: route.label, hidden });
      }
    }
  }
  return { ldp, lsp, bgpUp, vpnv4Up, vpnv4, vrfRoutes };
}
/** Best route in a VRF for an address (longest match; local routes win over BGP; hidden routes are unusable). */
export function vrfLookup(v: L3View, pe: L3R, vrf: string, ip: string): L3Route | undefined {
  return v.vrfRoutes[pe].filter((r) => r.vrf === vrf && !r.hidden && inPrefix(ip, r.prefix)).sort((a, b) => plen(b.prefix) - plen(a.prefix) || (a.via === "bgp" ? 1 : 0) - (b.via === "bgp" ? 1 : 0))[0];
}

// ---------------------------------------------------------------------------------------------------------------
// The data plane
// ---------------------------------------------------------------------------------------------------------------
export interface L3Hop {
  from: string;
  to: string;
  labels: number[];
  note: string;
}
export interface L3Trace {
  ok: boolean;
  hops: L3Hop[];
  path: string[];
  dstCe?: L3Ce;
  why?: string;
}
/** One direction: from a CE to an address, as the network forwards it. */
export function l3Forward(c: L3Config, v: L3View, os: L3Os, from: L3Ce, dst: string): L3Trace {
  const ce = CES[from];
  const pe = ce.pe;
  const hops: L3Hop[] = [{ from, to: pe, labels: [], note: `${from} sends to ${dst} (default route to ${pe})` }];
  const path: string[] = [from, pe];
  const ic = c[pe].ifs[ce.ifn]!;
  if (ic.shut) return { ok: false, hops, path, why: `${pe}'s interface toward ${from} is shut down` };
  if (!ic.vrf) return { ok: false, hops, path, why: `${pe}'s interface toward ${from} is in the global table, not in a VRF — ${pe} has no route to ${dst} there` };
  const vrf = ic.vrf;
  const r = vrfLookup(v, pe, vrf, dst);
  if (!r) {
    const hid = v.vrfRoutes[pe].find((x) => x.vrf === vrf && x.hidden && inPrefix(dst, x.prefix));
    return { ok: false, hops, path, why: hid ? `${pe} has ${hid.prefix} in VRF ${vrf} but cannot use it: no LSP to the BGP next hop ${hid.nh} (hidden)` : `${pe} has no route to ${dst} in VRF ${vrf}` };
  }
  if (r.via !== "bgp" || r.from === pe) {
    // Local: the destination CE hangs off this PE (directly, or through local import from another VRF).
    const target = L3_CES.find((x) => CES[x].pe === pe && CES[x].vrf === (r.srcVrf ?? vrf) && CES[x].nets.some((n) => inPrefix(dst, n)));
    if (!target || r.via === "connected") return { ok: false, hops, path, why: `${pe} has no customer behind ${r.prefix} in VRF ${vrf}` };
    const localStatic = v.vrfRoutes[pe].find((x) => x.vrf === (r.srcVrf ?? vrf) && x.via === "static" && CES[target].nets.some((n) => inPrefix(dst, n)) && inPrefix(dst, x.prefix));
    if (localStatic && localStatic.nh !== CES[target].ceIp) return { ok: false, hops, path, why: `${pe}: VRF ${r.srcVrf ?? vrf} → ${localStatic.prefix} via ${localStatic.nh} — nobody answers ARP for ${localStatic.nh} on that link, the packet is dropped` };
    hops.push({ from: pe, to: target, labels: [], note: `${pe}: VRF ${vrf} → ${r.prefix} ${r.srcVrf && r.srcVrf !== vrf ? `(imported from VRF ${r.srcVrf})` : `via ${r.nh}`}` });
    return { ok: true, hops, path: [...path, target], dstCe: target };
  }
  const egress = r.from!;
  const fec = L3_LO[egress];
  const order = egress === "PE2" ? PATH : [...PATH].reverse();
  let stack: number[] = [r.label!];
  const t0 = v.lsp[pe][fec];
  if (t0?.out === undefined && os === "junos") return { ok: false, hops, path, why: `${pe} has no LSP to ${fec}` };
  if (t0?.out !== undefined && t0.out !== IMPLICIT_NULL) stack = [t0.out, ...stack];
  hops.push({ from: pe, to: order[1], labels: stack, note: `${pe}: VRF ${vrf} → ${r.prefix} via ${fec} (RD ${r.rd}); push VPN label ${r.label}${t0?.out !== undefined && t0.out !== IMPLICIT_NULL ? ` and transport label ${t0.out}` : " — no transport label (Unlabelled)"}` });
  path.push(order[1]);
  for (let i = 1; i < order.length - 1; i++) {
    const rr = order[i];
    const nx = order[i + 1];
    const top = stack[0];
    const mine = ldpLabel(os, rr, fec);
    if (top !== mine) {
      return { ok: false, hops, path, why: `${rr} receives label ${top} — the VPN label ${egress} allocated, which ${rr} never allocated and knows nothing about — and drops the packet` };
    }
    const t = v.lsp[rr][fec];
    if (t?.out === undefined) stack = stack.slice(1);
    else if (t.out === IMPLICIT_NULL) stack = stack.slice(1);
    else stack = [t.out, ...stack.slice(1)];
    hops.push({ from: rr, to: nx, labels: stack, note: t?.out === undefined ? `${rr}: no label from ${nx} for ${fec} (Unlabelled) → removes ${top}; the VPN label is now on top` : t.out === IMPLICIT_NULL ? `${rr}: pops ${top} (PHP) — the VPN label is left` : `${rr}: swaps ${top} → ${t.out}` });
    path.push(nx);
  }
  // Egress PE: the VPN label selects the VRF.
  const vlabel = stack[0];
  const owner = v.vpnv4.find((x) => x.pe === egress && x.label === vlabel);
  if (!owner || stack.length !== 1) return { ok: false, hops, path, why: `${egress} receives label stack ${stack.join("/")} it can't map to a VRF` };
  const target = L3_CES.find((x) => CES[x].pe === egress && CES[x].vrf === owner.vrf && CES[x].nets.some((n) => inPrefix(dst, n)));
  const ce2 = target ? CES[target] : undefined;
  if (!target || !ce2 || c[egress].ifs[ce2.ifn]?.shut || c[egress].ifs[ce2.ifn]?.vrf !== owner.vrf) return { ok: false, hops, path, why: `${egress}: VPN label ${vlabel} → VRF ${owner.vrf}, but no route to ${dst} there` };
  const st = v.vrfRoutes[egress].find((x) => x.vrf === owner.vrf && x.via === "static" && x.prefix === owner.prefix);
  if (st && st.nh !== ce2.ceIp) return { ok: false, hops, path, why: `${egress}: VPN label ${vlabel} → VRF ${owner.vrf} → ${owner.prefix} via ${st.nh} — nobody answers ARP for ${st.nh}, the packet is dropped` };
  hops.push({ from: egress, to: target, labels: [], note: `${egress}: VPN label ${vlabel} → VRF ${owner.vrf} → ${owner.prefix} via ${ce2.ceIp}` });
  return { ok: true, hops, path: [...path, target], dstCe: target };
}

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------
export interface L3Snap {
  view: L3View;
}
export interface L3Test {
  id: number;
  from: L3Ce;
  dst: string;
  ok: boolean;
  path: string[];
  reached?: L3Ce;
  why?: string;
  cfgSeq: number;
}
export interface L3Sys {
  t: number;
  dev: L3R;
  kind: "commit" | "bgp-up" | "bgp-down" | "ldp-up" | "ldp-down";
  peer?: string;
}
export interface L3State extends SpBase<L3Snap> {
  os: L3Os;
  cfg: L3Config;
  hist: Record<L3R, L3Cfg[]>;
  view: L3View;
  sys: L3Sys[];
  tests: L3Test[];
  wiped?: boolean;
}
export type L3Action =
  | { type: "cfg"; dev: L3R; cfg: L3Cfg; text: string }
  | { type: "set"; changes: { dev: L3R; f: (c: L3Cfg) => void }[]; text: string }
  | { type: "test"; from: L3Ce; dst: string }
  | { type: "ticket"; id: L3TicketId }
  | { type: "os"; os: L3Os }
  | { type: "wipe-b" };

const cl = (o: L3State): L3State => ({ ...spClone(o), runs: o.runs, last: o.last });
export function createL3Net(seq = 0, os: L3Os = "xr"): L3State {
  const cfg = l3Healthy();
  const view = l3Compute(cfg, os);
  const s: L3State = { seq, os, cfgSeq: 0, clock: 3600, runs: [], log: [{ seq, t: 3600, text: "IS-IS, LDP and MP-BGP VPNv4 are up: CUST-A and CUST-B reach their own other site, with the same addresses.", tone: "info" }], cfg, hist: Object.fromEntries(L3_ROUTERS.map((r) => [r, []])) as unknown as Record<L3R, L3Cfg[]>, view, sys: [], tests: [] };
  for (const l of L3_LINKS) {
    s.sys.push({ t: 20, dev: l.a, kind: "ldp-up", peer: L3_LO[l.b] });
    s.sys.push({ t: 20, dev: l.b, kind: "ldp-up", peer: L3_LO[l.a] });
  }
  s.sys.push({ t: 30, dev: "PE1", kind: "bgp-up", peer: L3_LO.PE2 }, { t: 30, dev: "PE2", kind: "bgp-up", peer: L3_LO.PE1 });
  return s;
}

function testRun(s: L3State, t: L3Test, fwd: L3Trace, back?: L3Trace): SpRun<L3Snap> {
  const snap = { view: spClone(s.view) };
  const moments: SpMoment<L3Snap>[] = [];
  const leg = (tr: L3Trace, reply: boolean) => {
    for (const h of tr.hops) moments.push({ tokens: [{ from: h.from, to: h.to, label: h.labels.length ? h.labels.join(" / ") : reply ? "reply" : "IP", color: reply ? "amber" : h.labels.length > 1 ? "violet" : h.labels.length ? "cyan" : "green" }], lines: [{ text: h.note, tone: h.labels.length ? "learn" : "info" }], snap });
    if (!tr.ok) moments.push({ tokens: [], lines: [{ text: tr.why ?? "dropped", tone: "bad" }], views: { [tr.path[tr.path.length - 1]]: { ring: "bad", bubble: { text: "dropped", tone: "bad" } } }, snap });
  };
  leg(fwd, false);
  if (back) leg(back, true);
  if (t.ok) moments.push({ tokens: [], lines: [{ text: `${t.from} ↔ ${t.dst} (${t.reached}): success.`, tone: "ok" }], snap });
  return { id: s.runs.length + 1 + s.seq * 1000, cmd: `ping ${t.dst} from ${t.from}`, kind: "test", moments, ok: t.ok };
}
export function l3Test(s0: L3State, from: L3Ce, dst: string): L3State {
  const s = cl(s0);
  s.clock += 2;
  const fwd = l3Forward(s.cfg, s.view, s.os, from, dst);
  let back: L3Trace | undefined;
  let ok = fwd.ok;
  if (fwd.ok && fwd.dstCe && fwd.dstCe !== from) {
    back = l3Forward(s.cfg, s.view, s.os, fwd.dstCe, CES[from].host);
    ok = back.ok && back.dstCe === from;
    if (back.ok && back.dstCe !== from) back = { ...back, ok: false, why: `the reply reaches ${back.dstCe}, not ${from}` };
  }
  const t: L3Test = { id: s.tests.length + 1, from, dst, ok, path: fwd.path, reached: fwd.dstCe, why: !fwd.ok ? fwd.why : back && !back.ok ? `the reply fails — ${back.why}` : undefined, cfgSeq: s.cfgSeq };
  s.tests = [...s.tests, t].slice(-40);
  const run = testRun(s, t, fwd, back);
  s.runs = [...s.runs, run];
  s.last = run;
  s.log = [...s.log, { seq: s.seq, t: s.clock, text: `ping ${dst} from ${from}: ${ok ? `success (${fwd.dstCe})` : t.why}`, tone: ok ? "ok" : "warn" }];
  return s;
}

function converge(prev: L3State, s: L3State, why: string, show = true): L3State {
  const view = l3Compute(s.cfg, s.os);
  s.view = view;
  const snap = { view: spClone(view) };
  const moments: SpMoment<L3Snap>[] = [];
  for (const l of L3_LINKS) {
    if (prev.view.ldp[l.id] !== view.ldp[l.id]) {
      moments.push({ tokens: view.ldp[l.id] ? [{ from: l.a, to: l.b, label: "LDP", color: "cyan" }] : [], lines: [{ text: `LDP ${l.a}–${l.b} ${view.ldp[l.id] ? "Operational — labels are exchanged again" : "goes down — the labels learned over it are withdrawn"}.`, tone: view.ldp[l.id] ? "ok" : "bad" }], snap });
      s.sys.push({ t: s.clock, dev: l.a, kind: view.ldp[l.id] ? "ldp-up" : "ldp-down", peer: L3_LO[l.b] }, { t: s.clock, dev: l.b, kind: view.ldp[l.id] ? "ldp-up" : "ldp-down", peer: L3_LO[l.a] });
    }
  }
  if (prev.view.bgpUp !== view.bgpUp || prev.view.vpnv4Up !== view.vpnv4Up) {
    moments.push({ tokens: view.bgpUp ? [{ from: "PE1", to: "PE2", label: "OPEN", color: "amber" }] : [], lines: [{ text: !view.bgpUp ? "The PE1–PE2 iBGP session goes down: every VPNv4 route is withdrawn." : view.vpnv4Up ? "PE1 ↔ PE2: OPEN with the VPNv4 capability on both sides — VPN routes are exchanged." : "PE1 ↔ PE2: the session is up, but VPNv4 isn't negotiated on both sides — no VPN routes are exchanged.", tone: view.vpnv4Up ? "ok" : "bad" }], snap });
    for (const pe of L3_PES) s.sys.push({ t: s.clock, dev: pe, kind: view.bgpUp ? "bgp-up" : "bgp-down", peer: L3_LO[pe === "PE1" ? "PE2" : "PE1"] });
  }
  const key = (r: L3Vpnv4) => `${r.pe}|${r.rd}|${r.prefix}|${r.rts.join()}|${r.label}`;
  const added = view.vpnv4.filter((r) => !prev.view.vpnv4.some((x) => key(x) === key(r)));
  const gone = prev.view.vpnv4.filter((r) => !view.vpnv4.some((x) => key(x) === key(r)));
  if (added.length && view.vpnv4Up) moments.push({ tokens: added.map((r) => ({ from: r.pe, to: r.pe === "PE1" ? "PE2" : "PE1", label: `UPDATE ${r.rd}:${r.prefix}`, color: "violet" })).slice(0, 3), lines: added.map((r) => ({ text: `${r.pe} advertises ${r.rd}:${r.prefix} — RT ${r.rts.join(" ") || "none"}, VPN label ${r.label}, next hop ${r.nh}.`, tone: "learn" as const })), snap });
  if (gone.length) moments.push({ tokens: [], lines: gone.map((r) => ({ text: `${r.pe} withdraws ${r.rd}:${r.prefix}.`, tone: "warn" as const })), snap });
  const vk = (r: L3Route) => `${r.vrf}|${r.prefix}|${r.via}|${r.from ?? ""}|${r.hidden ? "h" : ""}`;
  for (const pe of L3_PES) {
    const a = view.vrfRoutes[pe].filter((r) => !prev.view.vrfRoutes[pe].some((x) => vk(x) === vk(r)) && r.via === "bgp");
    const g = prev.view.vrfRoutes[pe].filter((r) => !view.vrfRoutes[pe].some((x) => vk(x) === vk(r)) && r.via === "bgp");
    if (a.length || g.length) moments.push({ tokens: [], lines: [...a.map((r) => ({ text: `${pe} imports ${r.prefix} into VRF ${r.vrf}${r.hidden ? " — hidden: no LSP to the next hop" : ""} (RT ${r.rts?.join(" ")} matches its import).`, tone: (r.hidden ? "warn" : "ok") as "warn" | "ok" })), ...g.map((r) => ({ text: `${pe}: ${r.prefix} leaves VRF ${r.vrf}.`, tone: "warn" as const }))].slice(0, 6), snap });
  }
  if (show && moments.length) {
    const run: SpRun<L3Snap> = { id: s.runs.length + 1 + s.seq * 1000, cmd: why, kind: "converge", moments };
    s.runs = [...s.runs, run];
    s.last = run;
  }
  return s;
}

// ---------------------------------------------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------------------------------------------
export type L3TicketId = "rt" | "vpnv4" | "static" | "transport" | "ifvrf";
export interface L3TicketDef {
  id: L3TicketId;
  title: string;
  report: string;
  reproLabel: string;
  repro: L3Action[];
  fault: (c: L3Config) => void;
}
const ping = (from: L3Ce, dst: string): L3Action => ({ type: "test", from, dst });
export const L3_TICKETS: L3TicketDef[] = [
  {
    id: "rt",
    title: "CUST-A site 1 lost site 2",
    report: "“Since this morning CUST-A's site 1 can't reach 10.2.2.0/24. CUST-B, with the very same addresses, works fine. An engineer touched PE1's VRF configuration overnight.”",
    reproLabel: "ping 10.2.2.20 from CE1A",
    repro: [ping("CE1A", "10.2.2.20")],
    fault: (c) => {
      c.PE1.vrfs["CUST-A"].imp = ["65001:999"];
    },
  },
  {
    id: "vpnv4",
    title: "Every VPN is cut in half",
    report: "“Neither customer can reach its other site. The NOC says the BGP session between PE1 and PE2 is Established. PE2's BGP configuration was regenerated from a template yesterday.”",
    reproLabel: "ping 10.2.2.20 from CE1B",
    repro: [ping("CE1B", "10.2.2.20")],
    fault: (c) => {
      c.PE2.nbr!.vpnv4 = false;
    },
  },
  {
    id: "static",
    title: "CUST-B site 2 is invisible",
    report: "“CUST-B's site 1 can't reach site 2 (10.2.2.0/24) since PE2's CUST-B static routes were re-typed during a cleanup. PE1 has the route in VRF CUST-B. CUST-A, with the very same addresses, works fine.”",
    reproLabel: "ping 10.2.2.20 from CE1B",
    repro: [ping("CE1B", "10.2.2.20")],
    fault: (c) => {
      c.PE2.vrfs["CUST-B"].statics = [{ prefix: "10.2.2.0/24", nh: "172.16.2.3" }];
    },
  },
  {
    id: "transport",
    title: "The core pings, the VPNs don't",
    report: "“No customer traffic gets across the core since P1 was upgraded. PE1 pings PE2's loopback fine, BGP is up, and every VRF has its remote routes.”",
    reproLabel: "ping 10.2.2.20 from CE1A",
    repro: [ping("CE1A", "10.2.2.20")],
    fault: (c) => {
      c.P1.ifs["ge-0/0/1"]!.ldp = false;
    },
  },
  {
    id: "ifvrf",
    title: "A new port for CUST-A site 2",
    report: "“CUST-A site 2 was moved to a new port on PE2 last night. Since then nobody reaches it, and it reaches nobody. The port is up and the CE answers ARP.”",
    reproLabel: "ping 10.2.2.20 from CE1A",
    repro: [ping("CE1A", "10.2.2.20")],
    fault: (c) => {
      c.PE2.ifs["ge-0/0/1"]!.vrf = undefined;
    },
  },
];
export const l3Ticket = (id: string) => L3_TICKETS.find((t) => t.id === id)!;
export function l3TicketState(id: L3TicketId, seq = 0, os: L3Os = "xr"): L3State {
  const s = createL3Net(seq, os);
  const nx = cl(s);
  l3Ticket(id).fault(nx.cfg);
  const out = converge(s, nx, "", false);
  out.ticket = id;
  out.runs = [];
  out.last = undefined;
  out.log = [...out.log, { seq, t: out.clock, text: `Ticket opened: ${l3Ticket(id).title}.`, tone: "warn" }];
  return out;
}

export function l3Apply(s0: L3State, a: L3Action): L3State {
  switch (a.type) {
    case "cfg": {
      const s = cl(s0);
      s.hist[a.dev] = [spClone(s0.cfg[a.dev]), ...s.hist[a.dev]].slice(0, 20);
      s.cfg[a.dev] = spClone(a.cfg);
      s.cfgSeq += 1;
      s.clock += 1;
      s.sys.push({ t: s.clock, dev: a.dev, kind: "commit" });
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: `${a.dev}: ${a.text}`, tone: "info", dev: a.dev }];
      return converge(s0, s, `${a.dev}: ${a.text}`);
    }
    case "set": {
      const s = cl(s0);
      for (const ch of a.changes) ch.f(s.cfg[ch.dev]);
      s.cfgSeq += 1;
      s.clock += 1;
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: a.text, tone: "info" }];
      return converge(s0, s, a.text);
    }
    case "test":
      return l3Test(s0, a.from, a.dst);
    case "ticket":
      return l3TicketState(a.id, s0.seq + 1, s0.os);
    case "os":
      return createL3Net(s0.seq + 1, a.os);
    case "wipe-b": {
      const s = cl(s0);
      delete s.cfg.PE2.vrfs["CUST-B"];
      s.cfg.PE2.ifs["ge-0/0/2"]!.vrf = undefined;
      s.wiped = true;
      s.cfgSeq += 1;
      s.clock += 1;
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: "PE2's VRF CUST-B was deleted (and its interface left in the global table).", tone: "warn" }];
      return converge(s0, s, "PE2 loses VRF CUST-B");
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Diagnosis, proofs, ladder
// ---------------------------------------------------------------------------------------------------------------
export const L3_CAUSES: { id: string; label: string }[] = [
  { id: "rt", label: "A VRF's import route target doesn't match the other site's export" },
  { id: "vpnv4", label: "The VPNv4 address family isn't active on the BGP session" },
  { id: "static", label: "A VRF's static route points at the wrong CE address" },
  { id: "transport", label: "The transport LSP between the PEs is broken (LDP)" },
  { id: "ifvrf", label: "The customer-facing interface is not in the VRF" },
  { id: "rd", label: "The two customers' RDs collide" },
  { id: "pce", label: "The P routers don't know the customer routes" },
];
const lastTest = (s: L3State) => s.tests[s.tests.length - 1];
export function l3CauseFeedback(s: L3State, cause: string): { right: boolean; consequence?: boolean; text: string } {
  const t = s.ticket as L3TicketId | undefined;
  const xr = s.os === "xr";
  if (cause === t) {
    const txt: Record<L3TicketId, string> = {
      rt: "Yes. PE1's VRF CUST-A now imports 65001:999. PE2 still advertises CUST-A's 10.2.2.0/24 with RT 65001:100, but no VRF on PE1 imports that route target any more, so PE1 discards the route on arrival (route-target filtering) — it isn't even in PE1's VPNv4 table. CUST-B's identical prefix carries 65001:200 and still imports fine: the RD never decides import, the RT does.",
      vpnv4: `Yes. PE2's regenerated neighbor configuration no longer activates ${xr ? "address-family vpnv4 unicast" : "family inet-vpn unicast"}. The TCP session and the IPv4 family come up, but the VPNv4 capability isn't negotiated, so no VPN route crosses in either direction — every customer loses its other site.`,
      static: `Yes. PE2's static route for CUST-B's 10.2.2.0/24 now points to 172.16.2.3 — an address nobody owns on the PE2–CE2B link (CE2B is 172.16.2.2). The next hop is inside the connected /29, so ${xr ? "IOS XR" : "Junos"} installs and advertises the route and PE1 has it — but PE2's ARP for 172.16.2.3 never gets an answer, and every packet for site 2 dies at PE2.`,
      transport: xr ? "Yes. P1 no longer runs LDP toward P2, so P1 has no label for 4.4.4.4 from P2 (Unlabelled). PE1 still pushes VPN label + transport label; P1 removes the transport label and forwards — P2 now sees the VPN label 24002 on top, a label only PE2 understands, and drops it. Loopback pings travel as plain IP and work." : "Yes. P1 no longer runs LDP toward P2. With ordered label control, no LSP to 4.4.4.4 is built back to PE1, so PE1's VPN routes via 4.4.4.4 are hidden (no inet.3 route) and customer traffic is dropped at PE1. Loopback pings travel as plain IP and work.",
      ifvrf: "Yes. The new port on PE2 is in the global routing table, not in VRF CUST-A. The VRF's static route to 172.16.2.2 can't resolve (no connected subnet in the VRF), so it isn't installed or advertised; and CE2A's traffic arrives in the global table, where there is no route to CUST-A's networks.",
    };
    return { right: true, text: txt[t] };
  }
  const lt = lastTest(s);
  switch (cause) {
    case "rd":
      return { right: false, text: "Every VRF has its own RD (65001:101, 65001:201, …). And RDs never decide where a route is imported — RTs do." };
    case "pce":
      return { right: false, text: "That's by design: the core is BGP-free. P routers only switch the transport label; they never need customer routes." };
    case "rt":
      return { right: false, text: "Every VRF imports the route target its other site exports." };
    case "vpnv4":
      return { right: false, text: "The VPNv4 family is up on the PE1–PE2 session (show bgp vpnv4 unicast summary)." };
    case "static":
      return { right: false, text: "Every VRF's static routes point to their CE and are installed (show route vrf …)." };
    case "transport":
      return { right: false, text: "The transport LSPs are complete: LDP runs on every core link and the PEs push transport labels." };
    case "ifvrf":
      return { right: false, text: "Every customer-facing interface is in its VRF." };
  }
  return { right: false, text: lt ? "That doesn't match the evidence." : "Run the user's test first." };
}
export function l3Proofs(s: L3State): { label: string; ok: boolean; detail: string }[] {
  const t = s.ticket as L3TicketId | undefined;
  if (!t) return [];
  const fresh = s.tests.filter((x) => x.cfgSeq === s.cfgSeq);
  const ping = l3Ticket(t).repro[0] as { from: L3Ce; dst: string };
  const pingOk = fresh.some((x) => x.from === ping.from && x.dst === ping.dst && x.ok);
  const proof = { label: `A fresh ping ${ping.dst} from ${ping.from} succeeds`, ok: pingOk, detail: "run the test again after the fix" };
  const has = (pe: L3R, vrf: string, prefix: string) => s.view.vrfRoutes[pe].some((r) => r.vrf === vrf && r.prefix === prefix && !r.hidden);
  const xr = s.os !== "junos";
  const vrfShow = (vrf: string, pe: L3R) => (xr ? `show route vrf ${vrf} on ${pe}` : `show route table ${vrf}.inet.0 on ${pe}`);
  switch (t) {
    case "rt":
      return [{ label: "PE1's VRF CUST-A has 10.2.2.0/24 again", ok: has("PE1", "CUST-A", "10.2.2.0/24"), detail: vrfShow("CUST-A", "PE1") }, proof];
    case "vpnv4":
      return [{ label: "VPNv4 is negotiated between PE1 and PE2", ok: s.view.vpnv4Up, detail: xr ? "show bgp vpnv4 unicast summary" : "show bgp summary" }, proof];
    case "static":
      return [{ label: "PE2's static route points to CE2B (172.16.2.2)", ok: s.view.vrfRoutes.PE2.some((r) => r.vrf === "CUST-B" && r.via === "static" && r.nh === "172.16.2.2") && !s.view.vrfRoutes.PE2.some((r) => r.vrf === "CUST-B" && r.via === "static" && r.nh !== "172.16.2.2"), detail: vrfShow("CUST-B", "PE2") }, proof];
    case "transport":
      return [{ label: "LDP runs on P1–P2", ok: s.view.ldp["P1-P2"], detail: xr ? "show mpls ldp neighbor brief on P1" : "show ldp session on P1" }, proof];
    case "ifvrf":
      return [{ label: "PE2's port toward CE2A is in VRF CUST-A", ok: s.cfg.PE2.ifs["ge-0/0/1"]?.vrf === "CUST-A", detail: `${vrfShow("CUST-A", "PE2")}: the connected 172.16.2.0/29 is back` }, proof];
  }
}
export function l3Ladder(s: L3State): { k: string; title: string; text: string }[] {
  const t = lastTest(s);
  const v = s.view;
  const missing = L3_PES.flatMap((pe) =>
    Object.keys(s.cfg[pe].vrfs).flatMap((vrf) => {
      const want = L3_CES.filter((c) => CES[c].vrf === vrf && CES[c].pe !== pe).flatMap((c) => [CES[c].nets[0]]);
      return want.filter((p) => !v.vrfRoutes[pe].some((r) => r.vrf === vrf && r.prefix === p && !r.hidden)).map((p) => `${pe} ${vrf}: ${p}${v.vrfRoutes[pe].some((r) => r.vrf === vrf && r.prefix === p && r.hidden) ? " (hidden)" : ""}`);
    }),
  );
  const brokenLdp = L3_LINKS.filter((l) => !v.ldp[l.id]).map((l) => l.id);
  return [
    { k: "test", title: "What did the test show?", text: t ? `ping ${t.dst} from ${t.from}: ${t.ok ? `success (${t.reached})` : t.why}.` : "Run the user's test first." },
    { k: "vrf", title: "Is every customer interface in its VRF?", text: L3_PES.flatMap((pe) => ceIfs(pe).filter((x) => s.cfg[pe].ifs[x.ifn]?.vrf !== x.vrf).map((x) => `${pe} ${x.ifn} (toward ${x.ce}) is ${s.cfg[pe].ifs[x.ifn]?.vrf ? `in ${s.cfg[pe].ifs[x.ifn]!.vrf}` : "in the global table"}`)).join(" · ") || "Yes." },
    { k: "bgp", title: "Is VPNv4 up between the PEs?", text: !v.bgpUp ? "No: the iBGP session is down." : v.vpnv4Up ? `Yes: ${v.vpnv4.length} VPNv4 routes exist.` : "The session is Established, but VPNv4 isn't negotiated on both sides." },
    { k: "routes", title: "Does each VRF have its other site's prefix?", text: missing.length ? missing.map((m) => (m.endsWith(" (hidden)") ? m : `missing ${m}`)).join(" · ") : "Yes, in every VRF." },
    { k: "lsp", title: "Is the transport LSP complete?", text: brokenLdp.length ? `No LDP on ${brokenLdp.join(", ")}.` : "Yes: LDP on every core link." },
  ];
}
