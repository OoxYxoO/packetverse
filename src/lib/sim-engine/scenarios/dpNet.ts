import { spClone, type SpBase, type SpMoment, type SpRun } from "@/components/sp-lab/spKit";

/**
 * SR-MPLS vs SRv6 Lab — one network running both Segment Routing data planes (IOS XR), one VPN service, one failure.
 *
 *                     P2 ─────10───── PE2          same topology as SRv6 TI-LFA: primary PE1–P1–P2–PE2 (10 each),
 *            10 (DWDM, BFD) │ 50      │ 70         protection P1–P3–P4 (10, 10), P4–P2 50, P4–PE2 70
 *   CE1 ─ PE1 ─10─ P1        P4 ───────┘
 *                   └─10─ P3 ─10─┘
 *
 * The values are the guided lesson's (srMplsVsSrv6.ts / guideModel.ts):
 * - Every router runs IS-IS with SR-MPLS (`segment-routing mpls`, Loopback0 prefix-sid index N, SRGB 16000 → label
 *   16000+N, N: PE1 1, P1 2, P3 3, P4 4, P2 5, PE2 6; Adj-SID 24000 + 10·N(own) + N(peer), so P4→P2 = 24045) and SRv6
 *   (locator MAIN: PEs 2001:db8:100:{1,2}::/64, P routers 2001:db8:110:{11,12,13,14}::/64; End :100::, End.X
 *   :<interface+1>:: so P4→P2 = 2001:db8:110:14:2::; PE2's CUST-A End.DT4 2001:db8:100:2:13::).
 * - VPN CUST-A (RD 65000:1 / 65000:2, RT 65000:100): PE2's VRF either allocates an MPLS VPN label (9002) or, with
 *   `segment-routing srv6`, the End.DT4 service SID. PE1 encapsulates with whatever PE2 advertised: MPLS = [transport
 *   label for PE2, VPN label]; SRv6 = H.Encaps.Red, DA = the service SID.
 * - Transit: MPLS needs a label at every hop (a router without SR-MPLS breaks the LSP); SRv6 needs only IPv6 routes to
 *   the egress locator. TI-LFA (link-protecting, both planes) at P1 for the P1–P2 cut: post-convergence path
 *   P1 → P3 → P4 → P2 → PE2; P4's own path to P2 still runs via P1, so the repair forces P4→P2: MPLS [16004, 24045]
 *   above the transport label, SRv6 one outer header to P4's End.X→P2 (USD). BFD: 150 ms + 15 ms switch.
 * - Bytes: MPLS 4 per label; SRv6 40 per IPv6 header (+ SRH if needed). Every link checks its MTU (L3 = mtu − 14).
 */

export type DR = "PE1" | "P1" | "P2" | "P3" | "P4" | "PE2";
export const D_ROUTERS: DR[] = ["PE1", "P1", "P2", "P3", "P4", "PE2"];
export const D_P: DR[] = ["P1", "P2", "P3", "P4"];
/** Prefix-SID index (also the loopback's last octet). */
export const D_N: Record<DR, number> = { PE1: 1, P1: 2, P3: 3, P4: 4, P2: 5, PE2: 6 };
const LOC_N: Record<DR, string> = { PE1: "100:1", PE2: "100:2", P1: "110:11", P2: "110:12", P3: "110:13", P4: "110:14" };
export const LO4 = (r: DR) => `10.0.0.${D_N[r]}`;
export const LO6 = (r: DR) => `2001:db8:ffff::${D_N[r]}`;
export const locOf = (r: DR) => `2001:db8:${LOC_N[r]}::`;
export const sidOf = (r: DR, fn: number) => `2001:db8:${LOC_N[r]}:${fn.toString(16)}::`;
/** Which router's locator an address falls in. */
export const locOwner = (a: string) => D_ROUTERS.find((x) => a.startsWith(`2001:db8:${LOC_N[x]}:`));
export const END_FN = 0x100;
export const SRGB = 16000;
export const nodeLbl = (r: DR) => SRGB + D_N[r];
/** Adj-SID: 24000 + 10·N(own) + N(peer) — P4 → P2 = 24045, as in the guided lesson. */
export const adjLbl = (r: DR, p: DR) => 24000 + 10 * D_N[r] + D_N[p];
export const VPN_LABEL = 9002;
export const RD: Record<"PE1" | "PE2", string> = { PE1: "65000:1", PE2: "65000:2" };
export type IfName = "ge-0/0/0" | "ge-0/0/1" | "ge-0/0/2" | "ge-0/0/3";
export const CE = { CE1: { host: "10.10.1.10", lan: "10.10.1.0/24" }, CE2: { host: "10.20.1.10", lan: "10.20.1.0/24" } };
export type Enc = "mpls" | "srv6";

export interface DLink {
  id: string;
  a: DR;
  ai: IfName;
  b: DR;
  bi: IfName;
  metric: number;
}
export const D_LINKS: DLink[] = [
  { id: "PE1-P1", a: "PE1", ai: "ge-0/0/0", b: "P1", bi: "ge-0/0/0", metric: 10 },
  { id: "P1-P2", a: "P1", ai: "ge-0/0/1", b: "P2", bi: "ge-0/0/0", metric: 10 },
  { id: "P2-PE2", a: "P2", ai: "ge-0/0/1", b: "PE2", bi: "ge-0/0/0", metric: 10 },
  { id: "P1-P3", a: "P1", ai: "ge-0/0/2", b: "P3", bi: "ge-0/0/0", metric: 10 },
  { id: "P3-P4", a: "P3", ai: "ge-0/0/1", b: "P4", bi: "ge-0/0/0", metric: 10 },
  { id: "P4-P2", a: "P4", ai: "ge-0/0/1", b: "P2", bi: "ge-0/0/2", metric: 50 },
  { id: "P4-PE2", a: "P4", ai: "ge-0/0/2", b: "PE2", bi: "ge-0/0/1", metric: 70 },
];
export interface DIfInfo {
  ifn: IfName;
  peer: DR;
  link: DLink;
}
export function dIfs(r: DR): DIfInfo[] {
  return D_LINKS.flatMap((l) => (l.a === r ? [{ ifn: l.ai, peer: l.b, link: l }] : l.b === r ? [{ ifn: l.bi, peer: l.a, link: l }] : [])).sort((x, y) => x.ifn.localeCompare(y.ifn));
}
export const dIfTo = (r: DR, p: DR) => dIfs(r).find((i) => i.peer === p);
const linkNo = (l: DLink) => D_LINKS.indexOf(l) + 1;
export const dLinkIp4 = (l: DLink, r: DR) => `10.1.${linkNo(l)}.${l.a === r ? 1 : 2}`;
export const dLinkIp6 = (l: DLink, r: DR) => `2001:db8:1:${linkNo(l)}::${l.a === r ? 1 : 2}`;
export const dLl = (r: DR) => `fe80::${D_N[r]}`;

// ---------------------------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------------------------
export interface DRtr {
  mpls: boolean; // segment-routing mpls in IS-IS ipv4
  sid: boolean; // Loopback0 prefix-sid index N
  isisLoc: boolean; // segment-routing srv6 locator MAIN in IS-IS ipv6
  mtu: Partial<Record<IfName, number>>;
  /** PE: VRF CUST-A allocates an SRv6 service SID (else an MPLS VPN label). */
  vrfSrv6?: boolean;
}
export type DCfg = Record<DR, DRtr>;
export function dHealthy(): DCfg {
  const c = {} as DCfg;
  for (const r of D_ROUTERS) {
    const mtu: DRtr["mtu"] = {};
    for (const i of dIfs(r)) mtu[i.ifn] = 9216;
    c[r] = { mpls: true, sid: true, isisLoc: true, mtu };
  }
  c.PE1.vrfSrv6 = false;
  c.PE2.vrfSrv6 = false;
  return c;
}

// ---------------------------------------------------------------------------------------------------------------
// Derived state
// ---------------------------------------------------------------------------------------------------------------
export interface DRoute {
  dst: DR;
  cost: number;
  nh?: { r: DR; ifn: IfName };
  path: DR[];
}
export interface DService {
  enc: Enc;
  label?: number;
  sid?: string;
  usable: boolean;
  /** SR-MPLS: PE1 has a transport label (PE2's Node SID) to put above the VPN label. */
  transport?: boolean;
  why?: string;
}
export interface DRepair {
  path: DR[];
  pNode: DR;
  qNode: DR;
  labels: number[] | undefined;
  sids: string[] | undefined;
  mplsWhy?: string;
  srv6Why?: string;
}
export interface DView {
  rib: Record<DR, DRoute[]>;
  svc: DService; // what PE1 uses to reach CE2
  repair: DRepair; // P1's backup for PE2 (P1–P2 / node P2)
}
type Excl = { link?: string; node?: DR };
function spf(root: DR, ex: Excl = {}): DRoute[] {
  const d = new Map<DR, { cost: number; prev?: DR; first?: { r: DR; ifn: IfName } }>([[root, { cost: 0 }]]);
  const done = new Set<DR>();
  while (done.size < D_ROUTERS.length) {
    const u = D_ROUTERS.filter((r) => !done.has(r) && d.has(r)).sort((a, b) => d.get(a)!.cost - d.get(b)!.cost || D_N[a] - D_N[b])[0];
    if (!u) break;
    done.add(u);
    for (const i of dIfs(u)) {
      if (i.link.id === ex.link || i.peer === ex.node || u === ex.node) continue;
      const cost = d.get(u)!.cost + i.link.metric;
      if (!d.has(i.peer) || cost < d.get(i.peer)!.cost) d.set(i.peer, { cost, prev: u, first: u === root ? { r: i.peer, ifn: i.ifn } : d.get(u)!.first });
    }
  }
  return D_ROUTERS.filter((r) => r !== root && d.has(r)).map((r) => {
    const path: DR[] = [r];
    let x = r;
    while (d.get(x)?.prev) path.unshift((x = d.get(x)!.prev!));
    return { dst: r, cost: d.get(r)!.cost, nh: d.get(r)!.first, path };
  });
}
export const dt4Of = (r: DR) => sidOf(r, 0x13);
export const endXOf = (r: DR, p: DR) => sidOf(r, Number(dIfTo(r, p)!.ifn.slice(-1)) + 1);
export function dView(c: DCfg): DView {
  const rib = {} as DView["rib"];
  for (const r of D_ROUTERS) rib[r] = spf(r);
  const enc: Enc = c.PE2.vrfSrv6 ? "srv6" : "mpls";
  let svc: DService;
  if (enc === "srv6") {
    const sid = dt4Of("PE2");
    svc = !c.PE2.isisLoc ? { enc, sid, usable: false, why: `service SID ${sid} is unreachable: no route to PE2's locator ${locOf("PE2")}/64` } : !c.PE1.isisLoc ? { enc, sid, usable: false, why: "PE1 has no SRv6 locator in IS-IS — this lab keeps PE1's SRv6 role with it" } : { enc, sid, usable: true };
  } else {
    const transport = c.PE2.mpls && c.PE2.sid && c.PE1.mpls;
    svc = { enc, label: VPN_LABEL, usable: true, transport, why: transport ? undefined : !c.PE1.mpls ? "PE1 does not run SR-MPLS" : `no SR-MPLS label for PE2 (${LO4("PE2")}/32 has no prefix-SID)` };
  }
  // P1's link-protecting backup for PE2 (P1–P2 removed): the post-convergence path, encoded against pre-failure SPF.
  const post = spf("P1", { link: "P1-P2" }).find((x) => x.dst === "PE2")!;
  const path: DR[] = ["P1", ...post.path.slice(1)];
  // P node: the farthest node on that path P1 still reaches without P1–P2; Q: the next one (P4 → P2 here, whose own
  // path to P2 still runs back through P1 — so the repair forces that adjacency).
  const pre = (d: DR) => rib.P1.find((x) => x.dst === d)!.path;
  let k = 1;
  while (k + 1 < path.length && path[k + 1] !== "P2" && !pre(path[k + 1]).includes("P2")) k++;
  const pn = path[k];
  const qn = path[k + 1];
  const mplsOk = path.slice(1).every((r) => c[r].mpls) && c[pn].sid;
  const srv6Ok = c[pn].isisLoc;
  const repair: DRepair = {
    path,
    pNode: pn,
    qNode: qn,
    labels: mplsOk ? [nodeLbl(pn), adjLbl(pn, qn)] : undefined,
    sids: srv6Ok ? [endXOf(pn, qn)] : undefined,
    mplsWhy: mplsOk ? undefined : `${path.slice(1).find((r) => !c[r].mpls) ?? pn} has no SR-MPLS label to encode the repair`,
    srv6Why: srv6Ok ? undefined : `${pn} has no SRv6 SIDs — no End.X to force ${pn}→${qn}`,
  };
  return { rib, svc, repair };
}

// ---------------------------------------------------------------------------------------------------------------
// The data plane
// ---------------------------------------------------------------------------------------------------------------
export interface DHop {
  at: DR | "CE1" | "CE2";
  to?: DR | "CE1" | "CE2";
  hdr: string; // labels or DA chain
  bytes: number; // packet size on this link
  note: string;
  repair?: boolean;
  drop?: boolean;
}
export interface DWalk {
  ok: boolean;
  path: string[];
  hops: DHop[];
  why?: string;
  overhead: number;
  peakOverhead: number;
  /** Smallest L3 MTU of the links this packet crossed (or tried to cross). */
  pathMtu: number;
}
const l3mtu = (c: DCfg, r: DR, peer: DR) => (c[r].mtu[dIfTo(r, peer)!.ifn] ?? 9216) - 14;
/** Forward CE1 → CE2 (`size` bytes of customer IPv4). `cut` = P1–P2 failed, P1 repairs (other routers keep old tables). */
export function dWalk(c: DCfg, v: DView, size: number, cut = false): DWalk {
  const w: DWalk = { ok: false, path: ["CE1", "PE1"], hops: [], overhead: 0, peakOverhead: 0, pathMtu: 9202 };
  w.hops.push({ at: "CE1", to: "PE1", hdr: "IPv4", bytes: size, note: `CE1 sends ${size} bytes to ${CE.CE2.host}` });
  if (!v.svc.usable) {
    w.why = `PE1: VRF CUST-A has no usable route to ${CE.CE2.lan} — ${v.svc.why}`;
    w.hops.push({ at: "PE1", hdr: "", bytes: 0, note: w.why, drop: true });
    return w;
  }
  const mpls = v.svc.enc === "mpls";
  let r = "PE1" as DR;
  // header model: MPLS label stack (top first) or IPv6 header list (outermost first)
  let labels: number[] = [];
  let das: string[] = [];
  const ovh = () => (mpls ? 4 * labels.length : 40 * das.length);
  const hdr = () => (mpls ? (labels.length ? `[${labels.join(", ")}]` : "IPv4") : das.length ? das.map((x) => `DA ${x}`).join(" › ") : "IPv4");
  const send = (to: DR, note: string, repair = false): boolean => {
    if (cut && ((r === "P1" && to === "P2") || (r === "P2" && to === "P1"))) {
      w.why = `${r} sends toward ${to}, but P1–P2 is down — lost`;
      w.hops.push({ at: r, hdr: hdr(), bytes: 0, note: w.why, drop: true });
      return false;
    }
    const bytes = size + ovh();
    w.peakOverhead = Math.max(w.peakOverhead, ovh());
    w.pathMtu = Math.min(w.pathMtu, l3mtu(c, r, to));
    if (bytes > l3mtu(c, r, to)) {
      w.why = `${r}: ${bytes} bytes exceed the ${l3mtu(c, r, to)}-byte MTU toward ${to} (${dIfTo(r, to)!.ifn}) — dropped`;
      w.hops.push({ at: r, hdr: hdr(), bytes, note: w.why, drop: true });
      return false;
    }
    w.hops.push({ at: r, to, hdr: hdr(), bytes, note, repair });
    r = to;
    w.path.push(to);
    return true;
  };
  const rt = (from: DR, dst: DR) => v.rib[from].find((x) => x.dst === dst)!;
  if (mpls) {
    const nh = rt("PE1", "PE2").nh!;
    const tl = nh.r !== "PE2" && v.svc.transport && c[nh.r].mpls;
    labels = tl ? [nodeLbl("PE2"), VPN_LABEL] : [VPN_LABEL];
    w.overhead = 4 * labels.length;
    if (!send(nh.r, tl ? `PE1: VRF CUST-A → ${CE.CE2.lan} via ${LO4("PE2")}: push VPN label ${VPN_LABEL} and PE2's Node SID ${nodeLbl("PE2")}, out to ${nh.r}` : `PE1: VRF CUST-A → ${CE.CE2.lan} via ${LO4("PE2")}: push VPN label ${VPN_LABEL} — no transport label (${v.svc.why ?? `${nh.r} does not run SR-MPLS`}), out to ${nh.r}`)) return w;
  } else {
    das = [v.svc.sid!];
    w.overhead = 40;
    const nh = rt("PE1", "PE2").nh!;
    if (!send(nh.r, `PE1: VRF CUST-A → ${CE.CE2.lan}: H.Encaps.Red, DA ${v.svc.sid} (PE2's End.DT4), out to ${nh.r}`)) return w;
  }
  for (let ttl = 0; ttl < 24; ttl++) {
    if (r === "PE2") {
      const vpn = mpls ? labels[0] === VPN_LABEL && labels.length === 1 : das.length === 1 && das[0] === v.svc.sid;
      if (!vpn) {
        w.why = `PE2: unexpected header ${hdr()} — dropped`;
        w.hops.push({ at: "PE2", hdr: hdr(), bytes: 0, note: w.why, drop: true });
        return w;
      }
      w.hops.push({ at: "PE2", hdr: hdr(), bytes: size + ovh(), note: mpls ? `PE2: VPN label ${VPN_LABEL} → pop, look up ${CE.CE2.host} in CUST-A` : `PE2: ${v.svc.sid} is its End.DT4 → decapsulate, look up ${CE.CE2.host} in CUST-A` });
      w.hops.push({ at: "PE2", to: "CE2", hdr: "IPv4", bytes: size, note: "PE2 → CE2: delivered" });
      w.path.push("CE2");
      w.ok = true;
      return w;
    }
    if (mpls) {
      const top = labels[0];
      if (top === VPN_LABEL) {
        w.why = `${r} received VPN label ${VPN_LABEL} without a transport label — it has no entry for it — dropped`;
        w.hops.push({ at: r, hdr: hdr(), bytes: 0, note: w.why, drop: true });
        return w;
      }
      if (!c[r].mpls) {
        w.why = `${r} does not run SR-MPLS: no entry for label ${top} — dropped`;
        w.hops.push({ at: r, hdr: hdr(), bytes: 0, note: w.why, drop: true });
        return w;
      }
      // own node SID
      if (top === nodeLbl(r)) {
        labels = labels.slice(1);
        w.hops.push({ at: r, hdr: hdr(), bytes: size + ovh(), note: `${r}: ${top} is its own Node SID → pop` });
        continue;
      }
      const adjPeer = dIfs(r).find((i) => adjLbl(r, i.peer) === top)?.peer;
      if (adjPeer) {
        labels = labels.slice(1);
        if (!send(adjPeer, `${r}: ${top} is its Adj-SID toward ${adjPeer} → pop, out to ${adjPeer}`, true)) return w;
        continue;
      }
      const dst = D_ROUTERS.find((x) => nodeLbl(x) === top)!;
      const pr = rt(r, dst);
      if (cut && r === "P1" && pr.nh!.r === "P2" && dst === "PE2") {
        if (!v.repair.labels) {
          w.why = `P1: no TI-LFA backup (${v.repair.mplsWhy}) — traffic waits for convergence`;
          w.hops.push({ at: r, hdr: hdr(), bytes: 0, note: w.why, drop: true });
          return w;
        }
        labels = [...v.repair.labels, ...labels];
        // The backup neighbor (P3) receives P4's Node SID on top and pops it (PHP).
        if (!send(v.repair.path[1], `P1: next hop P2 is gone → TI-LFA: push [${v.repair.labels.join(", ")}] above ${top}, out to ${v.repair.path[1]}`, true)) return w;
        continue;
      }
      const nh = pr.nh!.r;
      if (nh === dst) {
        labels = labels.slice(1);
        if (!send(nh, `${r}: ${top} → pop (PHP), out to ${nh}`)) return w;
      } else if (!c[nh].mpls) {
        labels = labels.slice(1);
        if (!send(nh, `${r}: ${top} → Unlabelled (${nh} does not run SR-MPLS), out to ${nh}`)) return w;
      } else if (!send(nh, `${r}: ${top} → swap ${top}, out to ${nh}`)) return w;
      continue;
    }
    // SRv6
    const top = das[0];
    const owner = locOwner(top);
    if (owner === r) {
      // the repair's End.X (the only SRv6 instruction a transit router executes in this lab)
      const xp = dIfs(r).find((i) => endXOf(r, i.peer) === top)?.peer;
      if (xp && das.length > 1) {
        das = das.slice(1);
        if (!send(xp, `${r}: ${top} is its End.X → ${xp} (USD) → remove the repair header, out to ${xp}`, true)) return w;
        continue;
      }
      w.why = `${r}: no local SID ${top} — dropped`;
      w.hops.push({ at: r, hdr: hdr(), bytes: 0, note: w.why, drop: true });
      return w;
    }
    if (!owner || !c[owner].isisLoc) {
      w.why = `${r}: no route to ${top} — dropped`;
      w.hops.push({ at: r, hdr: hdr(), bytes: 0, note: w.why, drop: true });
      return w;
    }
    const pr = rt(r, owner);
    if (cut && r === "P1" && pr.nh!.r === "P2" && owner === "PE2") {
      if (!v.repair.sids) {
        w.why = `P1: no TI-LFA backup (${v.repair.srv6Why}) — traffic waits for convergence`;
        w.hops.push({ at: r, hdr: hdr(), bytes: 0, note: w.why, drop: true });
        return w;
      }
      das = [...v.repair.sids, ...das];
      if (!send(v.repair.path[1], `P1: next hop P2 is gone → TI-LFA: H.Encaps.Red with [${v.repair.sids.join(", ")}] around the VPN packet, out to ${v.repair.path[1]}`, true)) return w;
      continue;
    }
    if (!send(pr.nh!.r, `${r}: DA ${top} → ${owner}'s locator → ${pr.nh!.r}`)) return w;
  }
  w.why = "hop limit exceeded";
  return w;
}

// ---------------------------------------------------------------------------------------------------------------
// State and actions
// ---------------------------------------------------------------------------------------------------------------
export interface DSnap {
  view: DView;
}
export interface DTest {
  id: number;
  size: number;
  enc: Enc;
  cut: boolean;
  walk: DWalk;
  lossMs?: number;
  cfgSeq: number;
}
export interface DSys {
  t: number;
  dev: DR;
  kind: "commit" | "adj-up";
  peer?: string;
}
export interface DState extends SpBase<DSnap> {
  cfg: DCfg;
  hist: Record<DR, DRtr[]>;
  view: DView;
  sys: DSys[];
  tests: DTest[];
}
export type DTicketId = "locator" | "p2mpls" | "p4srv6" | "mtu" | "nosid";
export type DAction =
  | { type: "cfg"; dev: DR; cfg: DRtr; text: string }
  | { type: "set"; changes: { dev: DR; f: (c: DRtr) => void }[]; text: string }
  | { type: "ping"; size: number }
  | { type: "drill"; size: number }
  | { type: "ticket"; id: DTicketId };

const cl = (o: DState): DState => ({ ...spClone(o), runs: o.runs, last: o.last });
export function createDNet(seq = 0): DState {
  const cfg = dHealthy();
  const s: DState = { seq, cfgSeq: 0, clock: 3600, runs: [], log: [{ seq, t: 3600, text: "Both data planes run everywhere: SR-MPLS and SRv6. VRF CUST-A on PE2 allocates MPLS VPN label 9002 — CUST-A rides SR-MPLS.", tone: "info" }], cfg, hist: Object.fromEntries(D_ROUTERS.map((r) => [r, []])) as unknown as Record<DR, DRtr[]>, view: dView(cfg), sys: [], tests: [] };
  for (const l of D_LINKS) s.sys.push({ t: 15, dev: l.a, kind: "adj-up", peer: l.b }, { t: 15, dev: l.b, kind: "adj-up", peer: l.a });
  return s;
}
const tokColor = (h: DHop, mpls: boolean) => (h.repair ? "amber" : h.hdr === "IPv4" ? "green" : mpls ? "cyan" : "violet");
export const lossText = (ms?: number) => (ms === undefined ? "—" : ms === Infinity ? "until repaired" : `~${ms} ms`);
function run(s0: DState, size: number, cut: boolean): DState {
  const s = cl(s0);
  s.clock += 2;
  const w = dWalk(s.cfg, s.view, size, cut);
  const enc = s.view.svc.enc;
  const repaired = cut && w.ok;
  const noBackup = cut && !w.ok && /waits for convergence/.test(w.why ?? "");
  const lossMs = cut ? (repaired ? 165 : noBackup ? 950 : Infinity) : undefined;
  const t: DTest = { id: s.tests.length + 1, size, enc, cut, walk: w, lossMs, cfgSeq: s.cfgSeq };
  s.tests = [...s.tests, t].slice(-40);
  const snap = { view: s.view };
  const label = `${cut ? "Drill (P1–P2 cut): " : ""}CE1 → CE2 ${size} B over ${enc === "mpls" ? "SR-MPLS" : "SRv6"}`;
  const moments: SpMoment<DSnap>[] = w.hops.map((h) => ({ tokens: h.to && h.at !== h.to ? [{ from: h.at, to: h.to, label: h.hdr.length > 28 ? h.hdr.slice(0, 26) + "…" : h.hdr, color: tokColor(h, enc === "mpls") }] : [], lines: [{ text: h.note, tone: h.drop ? "warn" : h.repair ? "learn" : "info" }], snap }));
  moments.push({ tokens: [], lines: [{ text: w.ok ? `${label}: delivered${cut ? ` — repaired locally, ~${lossMs} ms lost` : ""}.` : `${label}: ${cut && noBackup ? `no local repair — ~950 ms lost (${w.why})` : `failed — ${w.why}`}`, tone: w.ok ? "ok" : "bad" }], snap });
  const runRec: SpRun<DSnap> = { id: s.runs.length + 1 + s.seq * 1000, cmd: label, kind: "test", moments, ok: w.ok };
  s.runs = [...s.runs, runRec];
  s.last = runRec;
  s.log = [...s.log, { seq: s.seq, t: s.clock, text: `${label}: ${w.ok ? "delivered" : w.why}`, tone: w.ok ? "ok" : "warn" }];
  return s;
}
function converge(prev: DState, s: DState, why: string, show = true): DState {
  const view = dView(s.cfg);
  s.view = view;
  const lines: { text: string; tone: "ok" | "bad" | "learn" }[] = [];
  const good = (x: DService) => x.usable && x.transport !== false;
  if (prev.view.svc.enc !== view.svc.enc || good(prev.view.svc) !== good(view.svc)) lines.push({ text: `PE1: CUST-A now rides ${view.svc.enc === "mpls" ? "SR-MPLS (VPN label 9002)" : `SRv6 (service SID ${view.svc.sid})`} — ${good(view.svc) ? "usable" : view.svc.usable ? `no transport label: ${view.svc.why}` : `NOT usable: ${view.svc.why}`}.`, tone: good(view.svc) ? "learn" : "bad" });
  const k = (v: DView) => `${v.repair.labels?.join(",")}|${v.repair.sids?.join(",")}`;
  if (k(prev.view) !== k(view)) lines.push({ text: `P1's TI-LFA backup for PE2: SR-MPLS ${view.repair.labels ? `[${view.repair.labels.join(", ")}]` : "none"} · SRv6 ${view.repair.sids ? `[${view.repair.sids.join(", ")}]` : "none"}.`, tone: "learn" });
  if (show && lines.length) {
    const r: SpRun<DSnap> = { id: s.runs.length + 1 + s.seq * 1000, cmd: why, kind: "converge", moments: [{ tokens: [], lines, snap: { view } }] };
    s.runs = [...s.runs, r];
    s.last = r;
  }
  return s;
}

// ---------------------------------------------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------------------------------------------
export interface DTicketDef {
  id: DTicketId;
  title: string;
  report: string;
  reproLabel: string;
  repro: DAction[];
  fault: (c: DCfg) => void;
}
const p100: DAction = { type: "ping", size: 100 };
export const D_TICKETS: DTicketDef[] = [
  {
    id: "locator",
    title: "Migrated to SRv6, and it broke",
    report: "“We moved CUST-A from SR-MPLS to SRv6 last night (VRF CUST-A on PE2 now allocates an SRv6 SID). Since then CE1 can't reach CE2. BGP is up, the route is there, and PE2's loopback pings fine. Under SR-MPLS it worked.”",
    reproLabel: "ping 100 B",
    repro: [p100],
    fault: (c) => {
      c.PE2.vrfSrv6 = true;
      c.PE2.isisLoc = false;
    },
  },
  {
    id: "p2mpls",
    title: "CUST-A died after P2's upgrade",
    report: "“After P2's software upgrade CUST-A (on SR-MPLS) is down. Customers already on SRv6 through the same P2 are fine. P2's IS-IS adjacencies are all up.”",
    reproLabel: "ping 100 B",
    repro: [p100],
    fault: (c) => {
      c.P2.mpls = false;
    },
  },
  {
    id: "p4srv6",
    title: "SRv6 isn't protected, SR-MPLS was",
    report: "“Since CUST-A moved to SRv6, a P1–P2 cut costs it about a second. On SR-MPLS the same drill used to cost ~165 ms. P4 was upgraded recently.”",
    reproLabel: "drill the P1–P2 cut",
    repro: [{ type: "drill", size: 100 }],
    fault: (c) => {
      c.PE2.vrfSrv6 = true;
      c.P4.isisLoc = false;
    },
  },
  {
    id: "mtu",
    title: "Big packets vanish during a cut",
    report: "“CUST-A on SRv6: 1460-byte packets are fine normally, but during the last P1–P2 cut they all disappeared while small packets were repaired. The optics on P1–P3 were swapped last week.”",
    reproLabel: "ping 1460 B, then drill with 1460 B",
    repro: [{ type: "ping", size: 1460 }, { type: "drill", size: 1460 }],
    fault: (c) => {
      c.PE2.vrfSrv6 = true;
      c.P1.mtu["ge-0/0/2"] = 1514;
      c.P3.mtu["ge-0/0/0"] = 1514;
    },
  },
  {
    id: "nosid",
    title: "No label to PE2",
    report: "“CUST-A (still on SR-MPLS) can't reach site 2 since PE2's loopback configuration was cleaned up. IS-IS is up everywhere, BGP is up, and the VPN route is there.”",
    reproLabel: "ping 100 B",
    repro: [p100],
    fault: (c) => {
      c.PE2.sid = false;
    },
  },
];
export const dTicket = (id: string) => D_TICKETS.find((t) => t.id === id)!;
export function dTicketState(id: DTicketId, seq = 0): DState {
  const s = createDNet(seq);
  const nx = cl(s);
  dTicket(id).fault(nx.cfg);
  const out = converge(s, nx, "", false);
  out.ticket = id;
  out.runs = [];
  out.last = undefined;
  out.log = [...out.log, { seq, t: out.clock, text: `Ticket opened: ${dTicket(id).title}.`, tone: "warn" }];
  return out;
}
export function dApply(s0: DState, a: DAction): DState {
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
    case "ping":
      return run(s0, a.size, false);
    case "drill":
      return run(s0, a.size, true);
    case "ticket":
      return dTicketState(a.id, s0.seq + 1);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Diagnosis, proofs, ladder
// ---------------------------------------------------------------------------------------------------------------
export const D_CAUSES: { id: string; label: string }[] = [
  { id: "locator", label: "PE2's SRv6 locator is not in IS-IS" },
  { id: "p2mpls", label: "P2 no longer runs SR-MPLS" },
  { id: "p4srv6", label: "P4 has no SRv6 SIDs for the repair" },
  { id: "mtu", label: "The P1–P3 link has a 1514-byte MTU" },
  { id: "nosid", label: "PE2's loopback lost its prefix-SID" },
  { id: "rt", label: "The VRF's route target changed" },
  { id: "bgp", label: "The BGP session flapped" },
];
export function dCauseFeedback(s: DState, cause: string): { right: boolean; text: string } {
  const t = s.ticket as DTicketId | undefined;
  if (cause === t) {
    const txt: Record<DTicketId, string> = {
      locator: "Yes. CUST-A now rides SRv6: PE1 must reach PE2's End.DT4 SID, which lives under PE2's locator 2001:db8:100:2::/64 — and PE2's IS-IS no longer advertises it. PE2's loopbacks (IPv4 for SR-MPLS, IPv6 for BGP) are still there, so BGP and the VPN route look perfect. SR-MPLS never needed the locator; SRv6 needs nothing else.",
      p2mpls: "Yes. P2 lost “segment-routing mpls”. P1's label toward PE2 via P2 becomes Unlabelled: P1 pops the transport label and P2 receives the bare VPN label 9002, which only PE2 understands — dropped. SRv6 customers cross P2 untouched: P2 only routes the IPv6 destination, it needs no SR state at all.",
      p4srv6: "Yes. P4's IS-IS lost its SRv6 locator, so P4 has no End.X SIDs. The repair must force P4 → P2 (P4's own path to P2 runs back through P1); SR-MPLS can (P4's Adj-SID 24045), SRv6 can't. P1 has an SR-MPLS backup but no SRv6 backup — CUST-A, now on SRv6, waits for convergence.",
      mtu: "Yes. The new optics came with mtu 1514 on P1–P3 (1500 bytes of IP). Normally a 1460-byte packet over SRv6 is 1500 bytes and goes via P2. During the cut P1's repair adds a second IPv6 header: 1540 bytes over P1–P3 — dropped. SR-MPLS would add only 8 bytes for its two repair labels: 1476.",
      nosid: "Yes. PE2's Loopback0 lost “prefix-sid index 6”. Nobody has a label for 10.0.0.6/32, so PE1 sends CUST-A's packets with the VPN label alone — and P1, which has no entry for 9002, drops them. IS-IS still routes 10.0.0.6 (it pings), and BGP still has the route. SRv6 wouldn't care: it reaches PE2 through the locator, not a prefix-SID.",
    };
    return { right: true, text: txt[t] };
  }
  switch (cause) {
    case "rt":
      return { right: false, text: "The route target is unchanged (65000:100) and PE1 imports the route." };
    case "bgp":
      return { right: false, text: "The BGP session to RR1 is up; the VPN route is present." };
    case "locator":
      return { right: false, text: s.cfg.PE2.isisLoc ? "PE2's locator is in IS-IS." : "The locator is missing — but does the current data plane even use it?" };
    case "p2mpls":
      return { right: false, text: "P2 runs SR-MPLS." };
    case "p4srv6":
      return { right: false, text: "P4 has its SRv6 SIDs." };
    case "mtu":
      return { right: false, text: "Every core link has mtu 9216." };
    case "nosid":
      return { right: false, text: "PE2's loopback has its prefix-SID (16006)." };
  }
  return { right: false, text: "That doesn't match the evidence." };
}
export function dProofs(s: DState): { label: string; ok: boolean; detail: string }[] {
  const t = s.ticket as DTicketId | undefined;
  if (!t) return [];
  const fresh = (pred: (x: DTest) => boolean) => s.tests.some((x) => x.cfgSeq === s.cfgSeq && x.walk.ok && pred(x));
  switch (t) {
    case "locator":
      return [{ label: "CUST-A rides SRv6 and the service SID is usable", ok: s.view.svc.enc === "srv6" && s.view.svc.usable, detail: "show cef vrf CUST-A 10.20.1.10 on PE1" }, { label: "A fresh ping CE1 → CE2 over SRv6", ok: fresh((x) => x.enc === "srv6" && !x.cut), detail: "ping after the fix" }];
    case "p2mpls":
    case "nosid":
      return [{ label: "CUST-A rides SR-MPLS and the LSP to PE2 is complete", ok: s.view.svc.enc === "mpls" && !!s.view.svc.transport && D_P.every((r) => s.cfg[r].mpls), detail: "show mpls forwarding labels 16006 on P1" }, { label: "A fresh ping CE1 → CE2 over SR-MPLS", ok: fresh((x) => x.enc === "mpls" && !x.cut), detail: "ping after the fix" }];
    case "p4srv6":
      return [{ label: "P1 has an SRv6 TI-LFA backup", ok: !!s.view.repair.sids, detail: "show isis fast-reroute 2001:db8:100:2::/64 detail on P1" }, { label: "A fresh SRv6 drill is repaired locally", ok: fresh((x) => x.enc === "srv6" && x.cut), detail: "drill after the fix" }];
    case "mtu":
      return [{ label: "P1–P3 carries 9216-byte frames", ok: s.cfg.P1.mtu["ge-0/0/2"] === 9216 && s.cfg.P3.mtu["ge-0/0/0"] === 9216, detail: "show ipv6 interface brief on P1" }, { label: "A fresh 1460-byte SRv6 drill is repaired locally", ok: fresh((x) => x.enc === "srv6" && x.cut && x.size === 1460), detail: "drill with 1460 bytes after the fix" }];
  }
}
export function dLadder(s: DState): { k: string; title: string; text: string }[] {
  const v = s.view;
  const c = s.cfg;
  const t = [...s.tests].reverse().find((x) => x.cfgSeq === s.cfgSeq && !x.walk.ok) ?? s.tests.at(-1);
  return [
    { k: "symptom", title: "What does the customer see?", text: t ? `${t.cut ? "drill, " : ""}${t.size} B over ${t.enc === "mpls" ? "SR-MPLS" : "SRv6"}: ${t.walk.ok ? `delivered${t.cut ? `, ${lossText(t.lossMs)} lost` : ""}` : t.walk.why}.` : "Ping first." },
    { k: "plane", title: "Which data plane does CUST-A use?", text: v.svc.enc === "mpls" ? `SR-MPLS — PE2 allocates VPN label ${VPN_LABEL}.` : `SRv6 — PE2 allocates End.DT4 ${v.svc.sid}.` },
    { k: "egress", title: "Can PE1 reach PE2 in that plane?", text: v.svc.enc === "mpls" ? (v.svc.transport ? `yes — PE2's Node SID ${nodeLbl("PE2")}.` : `no — ${v.svc.why}.`) : v.svc.usable ? `yes — via PE2's locator ${locOf("PE2")}/64.` : `no — ${v.svc.why}.` },
    { k: "transit", title: "Does every router on the path support that plane?", text: v.svc.enc === "mpls" ? D_P.map((r) => `${r} ${c[r].mpls ? "SR-MPLS" : "NO SR-MPLS"}`).join(" · ") : "SRv6 transit needs only IPv6 routes — every router has them." },
    { k: "repair", title: "Does P1 have a backup in that plane?", text: v.svc.enc === "mpls" ? (v.repair.labels ? `SR-MPLS [${v.repair.labels.join(", ")}]` : `none — ${v.repair.mplsWhy}`) : v.repair.sids ? `SRv6 [${v.repair.sids.join(", ")}]` : `none — ${v.repair.srv6Why}` },
    { k: "mtu", title: "Do the links carry the header budget?", text: D_LINKS.filter((l) => (c[l.a].mtu[l.ai] ?? 9216) < 9216 || (c[l.b].mtu[l.bi] ?? 9216) < 9216).map((l) => `${l.id} mtu ${Math.min(c[l.a].mtu[l.ai] ?? 9216, c[l.b].mtu[l.bi] ?? 9216)}`).join(" · ") || "every core link is 9216." },
  ];
}
export const spCloneCfg = (c: DCfg): DCfg => spClone(c);
