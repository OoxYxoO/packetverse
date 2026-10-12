import { spClone, type SpBase, type SpMoment, type SpRun } from "@/components/sp-lab/spKit";
import { CES, IMPLICIT_NULL, VS_CES, VS_LINKS, VS_LO, VS_PES, VS_ROUTERS, acKey, ceIfs, coreIfs, ldpLabel, pathBetween, vsTransport, type IfName, type VsCe, type VsR, type VsView } from "./vsNet";
import { AS, BV_LO, BV_ROUTERS, peOfLo, type BvR } from "./bvNet";

/**
 * EVPN-MPLS Lab network (the L2VPN Evolution capstone's EVPN stage) — the same CUST-A network as the VPLS and BGP VPLS
 * labs: PE1–PE3 and P1–P3 (IS-IS + LDP), route reflector RR1 (9.9.9.9) in the control plane, CE1–CE3 on VLAN 100 (CE4
 * spare on PE2). The service is an EVPN instance (EVI 100) instead of a VPLS:
 *
 * - IOS XR: evpn → evi 100 → bgp → rd / route-target, advertise-mac; l2vpn bridge group CUST-A → bridge-domain EVPN-A →
 *   interface …, evi 100. Junos: routing-instances EVPN-A instance-type evpn, vlan-id 100, interface …,
 *   route-distinguisher, vrf-target, protocols evpn. Both peer with RR1 for the EVPN family (l2vpn evpn / evpn signaling).
 * - Each PE advertises a Type 3 route (its inclusive-multicast label: where to send BUM) and a Type 2 route for every MAC
 *   it has learned locally (with the IP once it has seen the host's ARP), carrying its unicast EVI label. RR1 reflects
 *   client routes to everyone. A PE keeps routes whose route target it imports.
 * - Data plane: there are no pseudowires. A known remote MAC is sent with [transport label, the owner's unicast label];
 *   broadcast and unknown unicast are replicated to every PE with a usable Type 3 route with [transport, its IM label]
 *   (ingress replication). Remote MACs come from Type 2 routes only. A PE never sends a frame from the core back into
 *   the core. Junos keeps an EVPN route usable only with an LSP to its next hop in inet.3.
 */

export type EmR = BvR;
export const EM_ROUTERS: EmR[] = BV_ROUTERS;
export const EM_PES: VsR[] = VS_PES;
export const EVI = 100;
export const EM_RT = "65000:100";
export type EmOs = "xr" | "junos";
const IDX: Record<string, number> = { PE1: 1, PE2: 2, PE3: 3 };
export const RD: Record<string, string> = { PE1: "65000:1", PE2: "65000:2", PE3: "65000:3" };
export function uniLabel(os: EmOs, pe: VsR) {
  return os === "xr" ? 23000 + 1000 * IDX[pe] + 10 : 301000 + 10 * IDX[pe];
}
export function imLabel(os: EmOs, pe: VsR) {
  return uniLabel(os, pe) + 1;
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------------------------
export interface EmAc {
  vlan?: number;
  /** IOS XR l2transport; Junos encapsulation vlan-bridge. */
  l2: boolean;
}
export interface EmCfg {
  acs: Record<string, EmAc>;
  /** IOS XR: the bridge domain (and the EVI it references). Junos: the EVPN routing instance (and its vlan-id). */
  bd?: { group: string; name: string; acs: string[]; evi?: number; vlanId?: number };
  /** IOS XR: evpn → evi 100. Junos: the instance's RD / vrf-target (advertise-mac is implicit). */
  evi?: { id: number; rd?: string; rt?: string; advMac: boolean };
  nbr?: { ip: string; evpn: boolean };
  rr?: { clients: { ip: string; evpn: boolean; client: boolean }[] };
  ldp: Partial<Record<IfName, boolean>>;
}
export type EmConfig = Record<EmR, EmCfg>;
export function emHealthy(os: EmOs): EmConfig {
  const c = {} as EmConfig;
  for (const r of EM_ROUTERS) {
    const ldp: Partial<Record<IfName, boolean>> = {};
    if (r !== "RR1") for (const x of coreIfs(r)) ldp[x.ifn] = true;
    c[r] = { acs: {}, ldp };
  }
  for (const pe of EM_PES) {
    const ce = ceIfs(pe).find((x) => x.ce !== "CE4")!;
    const k = acKey(ce.ifn, ce.vlan);
    c[pe].acs[k] = { vlan: 100, l2: true };
    c[pe].bd = { group: "CUST-A", name: "EVPN-A", acs: [k], evi: os === "xr" ? EVI : undefined, vlanId: os === "junos" ? 100 : undefined };
    c[pe].evi = { id: EVI, rd: RD[pe], rt: EM_RT, advMac: true };
    c[pe].nbr = { ip: BV_LO.RR1, evpn: true };
  }
  c.RR1.rr = { clients: EM_PES.map((p) => ({ ip: BV_LO[p], evpn: true, client: true })) };
  return c;
}
/** Does this PE run the EVI at all (bridge domain bound to the EVI, RD and RT set)? */
export function emLive(os: EmOs, c: EmCfg): boolean {
  if (!c.bd || !c.evi?.rd || !c.evi.rt) return false;
  return os === "junos" || (c.bd.evi === c.evi.id && c.evi.id === EVI);
}

// ---------------------------------------------------------------------------------------------------------------
// The control plane
// ---------------------------------------------------------------------------------------------------------------
export interface EmRoute {
  type: 2 | 3;
  pe: VsR;
  rd: string;
  rt: string;
  nh: string;
  label: number;
  mac?: string;
  ip?: string;
}
export interface EmMac {
  mac: string;
  ip?: string;
  port: string;
  t: number;
}
export type EmFdb = Record<VsR, EmMac[]>;
export interface EmView extends Pick<VsView, "ldp" | "lsp"> {
  bgp: Record<string, { up: boolean; evpn: boolean }>;
  adv: EmRoute[];
  rrTable: EmRoute[];
  received: Record<string, EmRoute[]>;
  /** Kept: the route target is imported. Usable: kept, and (Junos) an LSP to the next hop exists. */
  kept: Record<string, EmRoute[]>;
  usable: Record<string, EmRoute[]>;
}
export const emRouteKey = (r: EmRoute) => `${r.type}|${r.rd}|${r.mac ?? ""}|${r.ip ?? ""}|${r.nh}`;
export function emCompute(c: EmConfig, fdb: EmFdb, os: EmOs): EmView {
  const { ldp, lsp } = vsTransport(c as unknown as Record<VsR, { ldp: Partial<Record<IfName, boolean>> }>, os);
  const rr = c.RR1.rr;
  const bgp: EmView["bgp"] = {};
  for (const pe of EM_PES) {
    const cl = rr?.clients.find((x) => x.ip === BV_LO[pe]);
    const up = c[pe].nbr?.ip === BV_LO.RR1 && !!cl;
    bgp[pe] = { up, evpn: up && !!c[pe].nbr?.evpn && !!cl?.evpn };
  }
  const isClient = (pe: VsR) => !!rr?.clients.find((x) => x.ip === BV_LO[pe])?.client;
  const adv: EmRoute[] = [];
  for (const pe of EM_PES) {
    const cf = c[pe];
    if (!emLive(os, cf)) continue;
    const base = { pe, rd: cf.evi!.rd!, rt: cf.evi!.rt!, nh: BV_LO[pe] };
    adv.push({ type: 3, ...base, label: imLabel(os, pe) });
    if (os === "xr" && !cf.evi!.advMac) continue;
    for (const m of fdb[pe]) {
      adv.push({ type: 2, ...base, label: uniLabel(os, pe), mac: m.mac });
      if (m.ip) adv.push({ type: 2, ...base, label: uniLabel(os, pe), mac: m.mac, ip: m.ip });
    }
  }
  const rrTable = adv.filter((r) => bgp[r.pe].evpn);
  const received: Record<string, EmRoute[]> = {};
  const kept: Record<string, EmRoute[]> = {};
  const usable: Record<string, EmRoute[]> = {};
  for (const pe of EM_PES) {
    received[pe] = rrTable.filter((r) => r.pe !== pe && bgp[pe].evpn && (isClient(r.pe) || isClient(pe)));
    const rt = c[pe].evi?.rt;
    kept[pe] = emLive(os, c[pe]) ? received[pe].filter((r) => r.rt === rt) : [];
    usable[pe] = kept[pe].filter((r) => os === "xr" || lsp[pe][r.nh]?.out !== undefined);
  }
  return { ldp, lsp, bgp, adv, rrTable, received, kept, usable };
}
/** The forwarding table of a PE: local MACs, then remote ones from usable Type 2 routes. */
export function emMacTable(v: EmView, fdb: EmFdb, pe: VsR): { mac: string; where: string; remote?: string; label?: number; ip?: string }[] {
  const out: { mac: string; where: string; remote?: string; label?: number; ip?: string }[] = fdb[pe].map((m) => ({ mac: m.mac, where: m.port, ip: m.ip }));
  for (const r of v.usable[pe].filter((x) => x.type === 2 && !x.ip))
    if (!out.some((x) => x.mac === r.mac)) out.push({ mac: r.mac!, where: r.nh, remote: r.nh, label: r.label, ip: v.usable[pe].find((y) => y.type === 2 && y.mac === r.mac && y.ip)?.ip });
  return out;
}
export const floodList = (v: EmView, pe: VsR) => v.usable[pe].filter((r) => r.type === 3);
export function emWhyNoPeer(c: EmConfig, v: EmView, pe: VsR, peer: VsR, os: EmOs): string {
  if (!emLive(os, c[pe])) return `${pe} doesn't run EVI ${EVI}`;
  if (!emLive(os, c[peer])) return `${peer} doesn't run EVI ${EVI}`;
  if (!v.bgp[pe].up) return `${pe}'s BGP session to RR1 is down`;
  if (!v.bgp[pe].evpn) return `${pe} doesn't exchange EVPN routes with RR1: the family isn't negotiated`;
  if (!v.bgp[peer].evpn) return `${peer} doesn't exchange EVPN routes with RR1`;
  if (!v.received[pe].some((r) => r.pe === peer && r.type === 3)) return `RR1 doesn't reflect ${peer}'s routes to ${pe}`;
  const r3 = v.received[pe].find((r) => r.pe === peer && r.type === 3)!;
  if (r3.rt !== c[pe].evi?.rt) return `${pe} receives ${peer}'s Type 3 route with RT ${r3.rt} but imports ${c[pe].evi?.rt}`;
  return os === "junos" ? `no LSP to ${BV_LO[peer]} in inet.3` : "no usable Type 3 route";
}

// ---------------------------------------------------------------------------------------------------------------
// The data plane
// ---------------------------------------------------------------------------------------------------------------
export const BCAST = "ff:ff:ff:ff:ff:ff";
interface Delivery {
  hops: { from: string; to: string; labels: number[]; note: string }[];
  reached: VsCe[];
  flooded: boolean;
  drops: string[];
}
function sendFrame(c: EmConfig, fdb: EmFdb, os: EmOs, f: { src: VsCe; dstMac: string; what: string; arp?: boolean }, clock: number): Delivery {
  const out: Delivery = { hops: [], reached: [], flooded: false, drops: [] };
  const ce = CES[f.src];
  const pe = ce.pe;
  const k = acKey(ce.ifn, ce.vlan);
  out.hops.push({ from: f.src, to: pe, labels: [], note: `${f.src} sends ${f.what} (to ${f.dstMac === BCAST ? "broadcast" : f.dstMac}), VLAN ${ce.vlan}` });
  const ac = c[pe].acs[k];
  if (!ac || ac.vlan !== ce.vlan || !c[pe].bd?.acs.includes(k) || !emLive(os, c[pe])) {
    out.drops.push(`${pe} has no attachment circuit for VLAN ${ce.vlan} on ${ce.ifn} in EVI ${EVI} — the frame is dropped`);
    return out;
  }
  fdb[pe] = [...fdb[pe].filter((m) => m.mac !== ce.mac), { mac: ce.mac, ip: f.arp ? ce.ip : fdb[pe].find((m) => m.mac === ce.mac)?.ip, port: k, t: clock }];
  const v = emCompute(c, fdb, os);
  const toLocal = (r: VsR, except?: string) => {
    for (const x of ceIfs(r)) {
      const kk = acKey(x.ifn, x.vlan);
      if (kk === except || !c[r].bd?.acs.includes(kk) || !c[r].acs[kk]) continue;
      out.hops.push({ from: r, to: x.ce, labels: [], note: `${r}: out of ${kk}` });
      if (c[r].acs[kk].vlan !== x.vlan) {
        out.drops.push(`${x.ce} receives the frame tagged VLAN ${c[r].acs[kk].vlan}, but uses VLAN ${x.vlan} — dropped`);
        continue;
      }
      if (f.dstMac === BCAST || f.dstMac === x.mac) out.reached.push(x.ce);
    }
  };
  const overCore = (from: VsR, nh: string, label: number, bum: boolean) => {
    const peer = peOfLo(nh) as VsR;
    const path = pathBetween(from, peer);
    let stack = [label];
    const t0 = v.lsp[from][nh];
    const pushT = t0?.out !== undefined && t0.out !== IMPLICIT_NULL;
    if (pushT) stack = [t0!.out!, ...stack];
    out.hops.push({ from, to: path[1], labels: stack, note: `${from}: push ${bum ? "the inclusive-multicast label" : "the EVPN label"} ${label} (${peer}'s, from its Type ${bum ? 3 : 2} route)${pushT ? ` and transport label ${t0!.out}` : t0?.out === IMPLICIT_NULL ? "" : " — no transport label (Unlabelled)"}` });
    for (let i = 1; i < path.length - 1; i++) {
      const rr = path[i];
      const top = stack[0];
      if (top !== ldpLabel(os, rr, nh)) {
        out.drops.push(`${rr} receives label ${top} — ${peer}'s EVPN label, which ${rr} never allocated — and drops the frame`);
        return;
      }
      const t = v.lsp[rr][nh];
      stack = t?.out === undefined || t.out === IMPLICIT_NULL ? stack.slice(1) : [t.out, ...stack.slice(1)];
      out.hops.push({ from: rr, to: path[i + 1], labels: stack, note: t?.out === undefined ? `${rr}: no label for ${nh} (Unlabelled) → removes ${top}` : t.out === IMPLICIT_NULL ? `${rr}: pops ${top} (PHP)` : `${rr}: swaps ${top} → ${t.out}` });
    }
    if (bum) {
      out.hops.push({ from: peer, to: peer, labels: [], note: `${peer}: label ${label} = its inclusive-multicast label → flood to its local attachment circuits only (never back into the core)` });
      toLocal(peer);
      return;
    }
    const hit = fdb[peer].find((m) => m.mac === f.dstMac);
    out.hops.push({ from: peer, to: peer, labels: [], note: `${peer}: label ${label} = its EVPN unicast label → ${hit ? `${f.dstMac} is local on ${hit.port}` : `${f.dstMac} not known locally: flood to local attachment circuits`}` });
    if (hit) {
      const x = ceIfs(peer).find((y) => acKey(y.ifn, y.vlan) === hit.port);
      if (x) {
        out.hops.push({ from: peer, to: x.ce, labels: [], note: `${peer}: out of ${hit.port}` });
        out.reached.push(x.ce);
      }
    } else toLocal(peer);
  };
  const table = emMacTable(v, fdb, pe);
  const hit = f.dstMac === BCAST ? undefined : table.find((m) => m.mac === f.dstMac);
  if (hit) {
    if (!hit.remote) {
      out.hops.push({ from: pe, to: pe, labels: [], note: `${pe}: ${f.dstMac} is local on ${hit.where} → switched locally` });
      const x = ceIfs(pe).find((y) => acKey(y.ifn, y.vlan) === hit.where);
      if (x && x.ce !== f.src) {
        out.hops.push({ from: pe, to: x.ce, labels: [], note: `${pe}: out of ${hit.where}` });
        out.reached.push(x.ce);
      }
      return out;
    }
    out.hops.push({ from: pe, to: pe, labels: [], note: `${pe}: ${f.dstMac} is behind ${hit.remote} (EVPN Type 2, label ${hit.label})` });
    overCore(pe, hit.remote, hit.label!, false);
    return out;
  }
  out.flooded = true;
  const fl = floodList(v, pe);
  out.hops.push({ from: pe, to: pe, labels: [], note: `${pe}: ${f.dstMac === BCAST ? "broadcast" : `${f.dstMac} unknown`} → local attachment circuits + one copy per PE on its flood list (${fl.map((r) => r.pe).join(", ") || "empty: no usable Type 3 route"})` });
  toLocal(pe, k);
  for (const r of fl) overCore(pe, r.nh, r.label, true);
  if (!fl.length) out.drops.push(`${pe} has no remote PE on its flood list — the frame never leaves ${pe}`);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------
export interface EmSnap {
  view: EmView;
  fdb: EmFdb;
}
export interface EmTest {
  id: number;
  from: VsCe;
  dst: string;
  ok: boolean;
  reached?: VsCe;
  why?: string;
  flooded: boolean;
  path: string[];
  cfgSeq: number;
  t: number;
}
export interface EmSys {
  t: number;
  dev: EmR;
  kind: "commit" | "ldp-up" | "ldp-down" | "bgp-up" | "bgp-down" | "clear";
  peer?: string;
}
export interface EmState extends SpBase<EmSnap> {
  os: EmOs;
  cfg: EmConfig;
  hist: Record<EmR, EmCfg[]>;
  view: EmView;
  fdb: EmFdb;
  arp: Record<VsCe, Record<string, string>>;
  sys: EmSys[];
  tests: EmTest[];
  cleared?: number;
  wiped?: boolean;
}
export type EmAction =
  | { type: "cfg"; dev: EmR; cfg: EmCfg; text: string }
  | { type: "set"; changes: { dev: EmR; f: (c: EmCfg) => void }[]; text: string }
  | { type: "test"; from: VsCe; dst: string }
  | { type: "clear"; dev?: VsR }
  | { type: "os"; os: EmOs }
  | { type: "ticket"; id: EmTicketId }
  | { type: "wipe-pe3" };

const cl = (o: EmState): EmState => ({ ...spClone(o), runs: o.runs, last: o.last });
const emptyFdb = (): EmFdb => Object.fromEntries(VS_ROUTERS.map((r) => [r, []])) as unknown as EmFdb;
export function createEmNet(seq = 0, os: EmOs = "xr"): EmState {
  const cfg = emHealthy(os);
  const fdb = emptyFdb();
  const view = emCompute(cfg, fdb, os);
  const s: EmState = { seq, os, cfgSeq: 0, clock: 3600, runs: [], log: [{ seq, t: 3600, text: "IS-IS and LDP are up; PE1, PE2 and PE3 peer with RR1 for the EVPN family and have exchanged their Type 3 routes for EVI 100. No MAC is known yet.", tone: "info" }], cfg, hist: Object.fromEntries(EM_ROUTERS.map((r) => [r, []])) as unknown as Record<EmR, EmCfg[]>, view, fdb, arp: { CE1: {}, CE2: {}, CE3: {}, CE4: {} }, sys: [], tests: [] };
  for (const l of VS_LINKS) s.sys.push({ t: 20, dev: l.a, kind: "ldp-up", peer: VS_LO[l.b] }, { t: 20, dev: l.b, kind: "ldp-up", peer: VS_LO[l.a] });
  for (const pe of EM_PES) s.sys.push({ t: 25, dev: pe, kind: "bgp-up", peer: BV_LO.RR1 }, { t: 25, dev: "RR1", kind: "bgp-up", peer: BV_LO[pe] });
  return s;
}
export function emTest(s0: EmState, from: VsCe, dst: string): EmState {
  const s = cl(s0);
  s.clock += 2;
  const snap = () => ({ view: spClone(emCompute(s.cfg, s.fdb, s.os)), fdb: spClone(s.fdb) });
  const moments: SpMoment<EmSnap>[] = [];
  const target = VS_CES.find((x) => CES[x].ip === dst);
  let flooded = false;
  let why: string | undefined;
  const path: string[] = [from];
  const send = (src: VsCe, dstMac: string, what: string, color: string, want: VsCe, arp?: boolean) => {
    const d = sendFrame(s.cfg, s.fdb, s.os, { src, dstMac, what, arp }, s.clock);
    s.view = emCompute(s.cfg, s.fdb, s.os);
    for (const h of d.hops) {
      if (h.from !== h.to) path.push(h.to);
      moments.push({ tokens: h.from !== h.to ? [{ from: h.from, to: h.to, label: h.labels.length ? h.labels.join(" / ") : "frame", color: h.labels.length > 1 ? "violet" : h.labels.length ? "cyan" : color }] : [], lines: [{ text: h.note, tone: h.labels.length ? "learn" : "info" }], snap: snap() });
    }
    for (const x of d.drops) moments.push({ tokens: [], lines: [{ text: x, tone: "warn" }], snap: snap() });
    if (d.flooded) flooded = true;
    if (!d.reached.includes(want)) {
      const a = CES[src].pe;
      const b = CES[want].pe;
      const k = acKey(CES[want].ifn, CES[want].vlan);
      const attached = !!s.cfg[b].bd?.acs.includes(k) && !!s.cfg[b].acs[k];
      const relevant = d.drops.find((x) => /label|VLAN|attachment circuit/.test(x));
      why ??= `${what} never reaches ${want}: ${!attached ? `its port on ${b} isn't part of EVI ${EVI}` : relevant ?? (a !== b && !floodList(s.view, a).some((r) => r.pe === b) ? `${a} has no route to ${b} for EVI ${EVI} — ${emWhyNoPeer(s.cfg, s.view, a, b, s.os)}` : d.drops[d.drops.length - 1] ?? "it is delivered nowhere")}`;
    }
    return d.reached.includes(want);
  };
  let ok = false;
  if (!target || target === from) why = `nobody on the service has ${dst}`;
  else {
    let mac = s.arp[from][dst];
    let step = true;
    if (!mac) {
      step = send(from, BCAST, `an ARP request for ${dst}`, "amber", target, true);
      if (step) {
        s.arp[target][CES[from].ip] = CES[from].mac;
        step = send(target, CES[from].mac, "the ARP reply", "amber", from, true);
        if (step) mac = s.arp[from][dst] = CES[target].mac;
      }
    }
    if (step && mac) step = send(from, mac, "an ICMP echo request", "green", target);
    if (step) {
      s.arp[target][CES[from].ip] ??= CES[from].mac;
      step = send(target, CES[from].mac, "the echo reply", "green", from);
    }
    ok = step;
    if (ok) why = undefined;
  }
  s.view = emCompute(s.cfg, s.fdb, s.os);
  if (ok) moments.push({ tokens: [], lines: [{ text: `${from} ↔ ${dst} (${target}): success${flooded ? " — part of it flooded" : ", every frame unicast"}.`, tone: "ok" }], snap: snap() });
  else moments.push({ tokens: [], lines: [{ text: why ?? "failed", tone: "bad" }], snap: snap() });
  const t: EmTest = { id: s.tests.length + 1, from, dst, ok, reached: ok ? target : undefined, why, flooded, path, cfgSeq: s.cfgSeq, t: s.clock };
  s.tests = [...s.tests, t].slice(-40);
  const run: SpRun<EmSnap> = { id: s.runs.length + 1 + s.seq * 1000, cmd: `ping ${dst} from ${from}`, kind: "test", moments, ok };
  s.runs = [...s.runs, run];
  s.last = run;
  s.log = [...s.log, { seq: s.seq, t: s.clock, text: `ping ${dst} from ${from}: ${ok ? `success (${target})${flooded ? ", flooded" : ""}` : why}`, tone: ok ? "ok" : "warn" }];
  return s;
}
export function emConverge(prev: EmState, s: EmState, why: string, show = true): EmState {
  for (const pe of EM_PES) s.fdb[pe] = s.fdb[pe].filter((m) => !!s.cfg[pe].bd?.acs.includes(m.port) && !!s.cfg[pe].acs[m.port] && emLive(s.os, s.cfg[pe]));
  const view = emCompute(s.cfg, s.fdb, s.os);
  s.view = view;
  const snap = { view: spClone(view), fdb: spClone(s.fdb) };
  const moments: SpMoment<EmSnap>[] = [];
  for (const l of VS_LINKS)
    if (prev.view.ldp[l.id] !== view.ldp[l.id]) {
      moments.push({ tokens: [], lines: [{ text: `LDP ${l.a}–${l.b} ${view.ldp[l.id] ? "Operational" : "goes down"}.`, tone: view.ldp[l.id] ? "ok" : "bad" }], snap });
      s.sys.push({ t: s.clock, dev: l.a, kind: view.ldp[l.id] ? "ldp-up" : "ldp-down", peer: VS_LO[l.b] }, { t: s.clock, dev: l.b, kind: view.ldp[l.id] ? "ldp-up" : "ldp-down", peer: VS_LO[l.a] });
    }
  for (const pe of EM_PES)
    if (prev.view.bgp[pe].up !== view.bgp[pe].up) {
      moments.push({ tokens: [], lines: [{ text: `${pe} ↔ RR1: BGP ${view.bgp[pe].up ? "Established" : "down"}.`, tone: view.bgp[pe].up ? "ok" : "bad" }], snap });
      s.sys.push({ t: s.clock, dev: pe, kind: view.bgp[pe].up ? "bgp-up" : "bgp-down", peer: BV_LO.RR1 });
    }
  const lines: { text: string; tone: "ok" | "bad" }[] = [];
  for (const pe of EM_PES) {
    const was = new Set(prev.view.usable[pe].map(emRouteKey));
    const now = new Set(view.usable[pe].map(emRouteKey));
    for (const r of view.usable[pe].filter((x) => !was.has(emRouteKey(x)) && (x.type === 3 || !x.ip))) lines.push({ text: `${pe} imports ${r.type === 3 ? `${r.pe}'s Type 3 route: ${r.pe} joins its flood list (label ${r.label})` : `${r.mac} behind ${r.pe} (Type 2, label ${r.label})`}.`, tone: "ok" });
    for (const r of prev.view.usable[pe].filter((x) => !now.has(emRouteKey(x)) && (x.type === 3 || !x.ip))) lines.push({ text: `${pe} loses ${r.type === 3 ? `${r.pe}'s Type 3 route` : `${r.mac} behind ${r.pe}`}.`, tone: "bad" });
  }
  if (lines.length) moments.push({ tokens: [], lines: lines.slice(0, 10), snap });
  if (show && moments.length) {
    const run: SpRun<EmSnap> = { id: s.runs.length + 1 + s.seq * 1000, cmd: why, kind: "converge", moments };
    s.runs = [...s.runs, run];
    s.last = run;
  }
  return s;
}
export function emApply(s0: EmState, a: EmAction): EmState {
  switch (a.type) {
    case "cfg": {
      const s = cl(s0);
      s.hist[a.dev] = [spClone(s0.cfg[a.dev]), ...s.hist[a.dev]].slice(0, 20);
      s.cfg[a.dev] = spClone(a.cfg);
      s.cfgSeq += 1;
      s.clock += 1;
      s.sys.push({ t: s.clock, dev: a.dev, kind: "commit" });
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: `${a.dev}: ${a.text}`, tone: "info", dev: a.dev }];
      return emConverge(s0, s, `${a.dev}: ${a.text}`);
    }
    case "set": {
      const s = cl(s0);
      for (const ch of a.changes) ch.f(s.cfg[ch.dev]);
      s.cfgSeq += 1;
      s.clock += 1;
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: a.text, tone: "info" }];
      return emConverge(s0, s, a.text);
    }
    case "test":
      return emTest(s0, a.from, a.dst);
    case "clear": {
      const s = cl(s0);
      s.clock += 1;
      for (const r of a.dev ? [a.dev] : EM_PES) s.fdb[r] = [];
      for (const ce of VS_CES) s.arp[ce] = {};
      s.cleared = s.clock;
      s.sys.push({ t: s.clock, dev: a.dev ?? "PE1", kind: "clear" });
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: `${a.dev ? `${a.dev}'s` : "Every PE's"} locally learned MACs cleared — their Type 2 routes are withdrawn (and the CEs' ARP caches aged out).`, tone: "info" }];
      return emConverge(s0, s, "MAC tables cleared");
    }
    case "os":
      return createEmNet(s0.seq + 1, a.os);
    case "ticket":
      return emTicketState(a.id, s0.seq + 1, s0.os);
    case "wipe-pe3": {
      const s = cl(s0);
      s.cfg.PE3.bd = undefined;
      s.cfg.PE3.evi = undefined;
      s.cfg.PE3.acs = {};
      s.wiped = true;
      s.cfgSeq += 1;
      s.clock += 1;
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: "PE3's EVPN service was deleted: its EVI, its bridge domain / instance and its sub-interface are gone. Its BGP session to RR1 stays.", tone: "warn" }];
      return emConverge(s0, s, "PE3 loses its EVPN configuration");
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------------------------------------------
export type EmTicketId = "rt" | "family" | "rr" | "ac" | "transport";
export interface EmTicketDef {
  id: EmTicketId;
  title: string;
  report: string;
  reproLabel: string;
  repro: EmAction[];
  fault: (c: EmConfig) => void;
}
const ping = (from: VsCe, dst: string): EmAction => ({ type: "test", from, dst });
export const EM_TICKETS: EmTicketDef[] = [
  {
    id: "rt",
    title: "PE3 after the migration",
    report: "“PE3 was the last PE moved from BGP VPLS to EVPN. Its EVI is configured and its session to the route reflector is up, but CE3 reaches nobody. CE1 ↔ CE2 works.”",
    reproLabel: "ping 192.168.100.3 from CE1",
    repro: [ping("CE1", "192.168.100.3")],
    fault: (c) => {
      c.PE3.evi!.rt = "65000:999";
    },
  },
  {
    id: "family",
    title: "PE2 hears nothing",
    report: "“PE2's BGP neighbor configuration was copied from an old VPLS router. The session to RR1 is Established, but CE2 reaches nobody. CE1 ↔ CE3 is fine.”",
    reproLabel: "ping 192.168.100.1 from CE2",
    repro: [ping("CE2", "192.168.100.1")],
    fault: (c) => {
      c.PE2.nbr!.evpn = false;
    },
  },
  {
    id: "rr",
    title: "A new route reflector",
    report: "“RR1 was rebuilt for the EVPN migration. Every session is Established and RR1 holds every PE's routes, but no site reaches any other.”",
    reproLabel: "ping 192.168.100.2 from CE1",
    repro: [ping("CE1", "192.168.100.2")],
    fault: (c) => {
      for (const x of c.RR1.rr!.clients) x.client = false;
    },
  },
  {
    id: "ac",
    title: "The control plane looks perfect",
    report: "“After a port change on PE2, CE2 reaches nobody. Every PE has every other PE's Type 3 route, and CE1 ↔ CE3 is fine.”",
    reproLabel: "ping 192.168.100.1 from CE2",
    repro: [ping("CE2", "192.168.100.1")],
    fault: (c) => {
      c.PE2.acs["ge-0/0/1.100"].vlan = 200;
    },
  },
  {
    id: "transport",
    title: "After the P1 upgrade",
    report: "“Since P1 was upgraded, CE3 reaches nobody. Every BGP session is up, RR1 reflects every EVPN route, and PE3's loopback pings.”",
    reproLabel: "ping 192.168.100.3 from CE1",
    repro: [ping("CE1", "192.168.100.3")],
    fault: (c) => {
      c.P1.ldp["ge-0/0/2"] = false;
    },
  },
];
export const emTicket = (id: string) => EM_TICKETS.find((t) => t.id === id)!;
export function emTicketState(id: EmTicketId, seq = 0, os: EmOs = "xr"): EmState {
  const s = createEmNet(seq, os);
  const nx = cl(s);
  emTicket(id).fault(nx.cfg);
  const out = emConverge(s, nx, "", false);
  out.ticket = id;
  out.runs = [];
  out.last = undefined;
  out.log = [...out.log, { seq, t: out.clock, text: `Ticket opened: ${emTicket(id).title}.`, tone: "warn" }];
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Diagnosis, proofs, ladder
// ---------------------------------------------------------------------------------------------------------------
export const EM_CAUSES: { id: string; label: string }[] = [
  { id: "rt", label: "A PE's EVI uses a route target the others don't import" },
  { id: "family", label: "A PE doesn't exchange the EVPN family with the route reflector" },
  { id: "rr", label: "The route reflector doesn't reflect (its PEs aren't route-reflector clients)" },
  { id: "ac", label: "A CE's VLAN doesn't land in the EVI (attachment circuit)" },
  { id: "transport", label: "A transport LSP between the PEs is broken (LDP)" },
  { id: "pw", label: "A pseudowire between two PEs is down" },
  { id: "mac", label: "The PEs never learned the MAC addresses from the data plane" },
];
const lastTest = (s: EmState) => s.tests[s.tests.length - 1];
/** Every PE has every other PE on its flood list. */
export const emMeshOk = (s: EmState) => EM_PES.every((pe) => EM_PES.filter((x) => x !== pe).every((x) => floodList(s.view, pe).some((r) => r.pe === x)));
export function emCauseFeedback(s: EmState, cause: string): { right: boolean; text: string } {
  const t = s.ticket as EmTicketId | undefined;
  const xr = s.os === "xr";
  if (cause === t) {
    const txt: Record<EmTicketId, string> = {
      rt: "Yes. PE3's EVI exports and imports 65000:999. RR1 reflects everything, but PE1 and PE2 drop PE3's Type 3 and Type 2 routes (not their RT) and PE3 drops theirs. Nobody has PE3 on its flood list and nobody learns CE3's MAC. The BGP session is not the problem.",
      family: `Yes. PE2's copied neighbor configuration activates no EVPN family (${xr ? "address-family l2vpn evpn" : "family evpn signaling"}). The session comes up, but no EVPN route crosses it: PE2 neither advertises its Type 3 route nor hears anyone's. Its flood list is empty.`,
      rr: `Yes. The rebuilt RR1 treats its neighbors as plain iBGP peers (${xr ? "no route-reflector-client" : "no cluster in the group"}). iBGP doesn't pass one peer's routes to another, so RR1 holds every Type 3 route and reflects none: every PE's flood list is empty.`,
      ac: "Yes. PE2's sub-interface toward CE2 now accepts VLAN 200, but CE2 sends VLAN 100: PE2 drops CE2's frames at the attachment circuit. The EVPN control plane can be perfect — Type 3 routes everywhere — and still carry nothing for a CE whose VLAN doesn't land in the EVI.",
      transport: xr ? "Yes. P1 no longer runs LDP toward P3, so P1 has no label for 3.3.3.3 (Unlabelled). PE1 pushes PE3's EVPN label under the transport label; P1 removes the transport label and P3 receives PE3's EVPN label — meaningless to P3 — and drops the frame. BGP runs over plain IP and doesn't notice." : "Yes. P1 no longer runs LDP toward P3; with ordered control there is no LSP to 3.3.3.3 from PE1 or PE2, and Junos keeps EVPN routes whose next hop has no LSP in inet.3 unusable. PE3 drops off the flood lists while BGP still shows its routes.",
    };
    return { right: true, text: txt[t] };
  }
  const lt = lastTest(s);
  switch (cause) {
    case "pw":
      return { right: false, text: "EVPN has no pseudowires. PEs reach each other with EVPN labels from Type 2 and Type 3 routes, carried over the transport LSPs." };
    case "mac":
      return { right: false, text: "Remote MACs never come from the data plane in EVPN: each PE learns its own CEs' MACs locally and advertises them as Type 2 routes. Look at why a route isn't arriving or isn't kept." };
    case "rt":
      return { right: false, text: "Every PE's EVI uses route target 65000:100." };
    case "family":
      return { right: false, text: "Every PE exchanges EVPN routes with RR1." };
    case "rr":
      return { right: false, text: "RR1 reflects: every PE is a route-reflector client." };
    case "ac":
      return { right: false, text: "Every CE's VLAN 100 lands in the EVI on its PE." };
    case "transport":
      return { right: false, text: "LDP runs on every core link: the PEs have complete LSPs to each other." };
  }
  return { right: false, text: lt ? "That doesn't match the evidence." : "Run the user's test first." };
}
export function emProofs(s: EmState): { label: string; ok: boolean; detail: string }[] {
  const t = s.ticket as EmTicketId | undefined;
  if (!t) return [];
  const fresh = s.tests.filter((x) => x.cfgSeq === s.cfgSeq);
  const p0 = emTicket(t).repro[0] as { from: VsCe; dst: string };
  const proof = { label: `A fresh ping ${p0.dst} from ${p0.from} succeeds`, ok: fresh.some((x) => x.from === p0.from && x.dst === p0.dst && x.ok), detail: "run the test again after the fix" };
  const xr = s.os === "xr";
  const im = xr ? "show evpn evi vpn-id 100 inclusive-multicast" : "show evpn instance EVPN-A extensive";
  switch (t) {
    case "rt":
      return [{ label: "PE3 uses RT 65000:100 and every PE floods to every other", ok: s.cfg.PE3.evi?.rt === EM_RT && emMeshOk(s), detail: `${im} on PE1` }, proof];
    case "family":
      return [{ label: "PE2 exchanges EVPN routes with RR1 and every PE floods to every other", ok: s.view.bgp.PE2.evpn && emMeshOk(s), detail: xr ? "show bgp l2vpn evpn summary on PE2" : "show bgp summary on PE2" }, proof];
    case "rr":
      return [{ label: "RR1 reflects to every PE: the flood lists are complete", ok: emMeshOk(s), detail: xr ? "show bgp l2vpn evpn on PE1" : "show route table bgp.evpn.0 on PE1" }, proof];
    case "ac":
      return [{ label: "PE2's attachment circuit toward CE2 accepts VLAN 100", ok: s.cfg.PE2.acs["ge-0/0/1.100"]?.vlan === 100 && !!s.cfg.PE2.bd?.acs.includes("ge-0/0/1.100"), detail: xr ? "show l2vpn bridge-domain on PE2" : "show evpn instance EVPN-A extensive on PE2" }, proof];
    case "transport":
      return [{ label: "LDP runs on P1–P3", ok: s.view.ldp["P1-P3"], detail: xr ? "show mpls ldp neighbor brief on P1" : "show ldp session on P1" }, proof];
  }
}
export function emLadder(s: EmState): { k: string; title: string; text: string }[] {
  const t = lastTest(s);
  const v = s.view;
  const acBad = VS_CES.filter((x) => x !== "CE4").filter((ce) => {
    const d = CES[ce];
    const k = acKey(d.ifn, d.vlan);
    return s.cfg[d.pe].acs[k]?.vlan !== d.vlan || !s.cfg[d.pe].bd?.acs.includes(k);
  }).map((ce) => `${CES[ce].pe}: no attachment circuit in the EVI for ${ce}'s VLAN ${CES[ce].vlan}`);
  const bgpBad = EM_PES.filter((pe) => !v.bgp[pe].evpn).map((pe) => `${pe} ↔ RR1: ${v.bgp[pe].up ? "Established, no EVPN family" : "down"}`);
  const t3 = EM_PES.flatMap((pe) => EM_PES.filter((x) => x !== pe && !v.kept[pe].some((r) => r.pe === x && r.type === 3)).map((x) => `${pe} has no Type 3 route from ${x}: ${emWhyNoPeer(s.cfg, v, pe, x, s.os)}`));
  const unusable = EM_PES.flatMap((pe) => v.kept[pe].filter((r) => r.type === 3 && !v.usable[pe].some((y) => emRouteKey(y) === emRouteKey(r))).map((r) => `${pe}: ${r.pe}'s Type 3 route is kept but unusable (no LSP to ${r.nh})`));
  const brokenLdp = VS_LINKS.filter((l) => !v.ldp[l.id]).map((l) => l.id);
  const t2 = EM_PES.map((pe) => `${pe} ${emMacTable(v, s.fdb, pe).filter((m) => m.remote).length}`).join(", ");
  return [
    { k: "test", title: "What did the test show?", text: t ? `ping ${t.dst} from ${t.from}: ${t.ok ? `success (${t.reached})` : t.why}.` : "Run the user's test first." },
    { k: "ac", title: "Does every CE's VLAN land in the EVI?", text: acBad.join(" · ") || "Yes." },
    { k: "bgp", title: "Does every PE exchange EVPN routes with RR1?", text: bgpBad.join(" · ") || "Yes: three sessions, EVPN family negotiated." },
    { k: "t3", title: "Does every PE keep every other PE's Type 3 route?", text: t3.join(" · ") || "Yes: every PE keeps both other PEs' Type 3 routes." },
    { k: "t2", title: "Are the remote MACs arriving as Type 2 routes?", text: `Remote MACs known — ${t2}.${s.tests.length ? "" : " (Nothing has been sent yet: no MAC to advertise.)"}` },
    { k: "lsp", title: "Is the transport LSP complete?", text: brokenLdp.length ? `No LDP on ${brokenLdp.join(", ")}.${unusable.length ? ` ${unusable.join(" · ")}.` : ""}` : "Yes: LDP on every core link." },
  ];
}
export { AS };
