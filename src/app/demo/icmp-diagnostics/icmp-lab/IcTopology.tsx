"use client";

import { clsx } from "clsx";
import type { ReactNode } from "react";
import { LabTopology, type LabPacketView } from "@/components/practice-lab/LabTopology";
import type { GraphEdge, GraphNode, GraphRegion } from "@/components/network/GraphTopologyViewer";
import { IC_KIND, icJunosIf, icShortIf, type IcDev, type IcIf, type IcPkt, type IcState } from "@/lib/sim-engine/scenarios/icmpNet";
import { isErr, isRouter, pktCode, pktName, type Beat } from "./icStory";
import { markerLabel, nbsp, type IcMoment } from "./icMoments";

/**
 * The ICMP lab's topology and its moment views, built exactly like the ARP lab's: the shared practice-lab topology
 * (LabTopology — subnet regions, device cards, the moving packet marker riding above the path one hop per moment, the
 * outcome left on the device it reached), a decision chain for the device that sent or stopped the packet, and the
 * packet's fields header by header.
 */

export const KIND_COLOR: Record<string, string> = { "echo-req": "#38bdf8", "echo-rep": "#34d399", ttl: "#fbbf24", net: "#f87171", host: "#fb923c", port: "#a78bfa", frag: "#fb7185", udp: "#c4b5fd", tcp: "#60a5fa" };
export const pktColor = (p: IcPkt) => (p.proto === "icmp" ? KIND_COLOR[p.kind!] : KIND_COLOR[p.proto]);
export const pktLabel = (p: IcPkt) => (p.proto === "icmp" ? `${IC_KIND[p.kind!].type}/${IC_KIND[p.kind!].code} ${IC_KIND[p.kind!].short}` : p.proto === "udp" ? `UDP :${p.dport}` : `TCP ${p.tcp}`);
const OUTCOME = { ok: "#34d399", bad: "#f87171", icmp: "#fbbf24" };

const POS: Record<IcDev, { x: number; y: number }> = { "HOST-A": { x: 12, y: 52 }, R1: { x: 38, y: 52 }, R2: { x: 62, y: 52 }, "HOST-B": { x: 88, y: 52 } };
const COMPACT: Record<IcDev, { x: number; y: number }> = { "HOST-A": { x: 22, y: 24 }, R1: { x: 76, y: 24 }, R2: { x: 76, y: 80 }, "HOST-B": { x: 22, y: 80 } };
const REGIONS: GraphRegion[] = [
  { id: "la", label: "HOST-A's LAN 192.0.2.0/24", x: 2, y: 16, width: 21, height: 70, tone: "cyan" },
  { id: "tr", label: "transit 203.0.113.0/30", x: 28, y: 22, width: 44, height: 60, tone: "muted" },
  { id: "lb", label: "HOST-B's LAN 198.51.100.0/24", x: 77, y: 16, width: 21, height: 70, tone: "violet" },
];
const COMPACT_REGIONS: GraphRegion[] = [
  { id: "la", label: "192.0.2.0/24", x: 3, y: 4, width: 40, height: 40, tone: "cyan" },
  { id: "tr", label: "transit /30", x: 56, y: 4, width: 41, height: 92, tone: "muted" },
  { id: "lb", label: "198.51.100.0/24", x: 3, y: 60, width: 40, height: 36, tone: "violet" },
];

export function IcLabTopology({ s, moment, prev, runKey, cursor, compact, labels, vendor, tags, onNode, selected }: { s: IcState; moment?: IcMoment; prev?: IcMoment; runKey: string | number; cursor: number; compact: boolean; labels: boolean; vendor: "cisco" | "juniper"; tags?: Record<string, string>; onNode?: (d: IcDev) => void; selected?: IcDev }) {
  const c = s.cfg;
  const ifn = (i: IcIf) => (vendor === "cisco" ? icShortIf(i) : icJunosIf(i));
  const pos = compact ? COMPACT : POS;
  const nodes: GraphNode[] = (["HOST-A", "R1", "R2", "HOST-B"] as IcDev[]).map((d) => ({
    id: d,
    label: d,
    subLabel: d === "HOST-A" ? c["HOST-A"].ip : d === "HOST-B" ? `${c["HOST-B"].ip}${!c["HOST-B"].power ? " · off" : ""}` : compact ? "gateway" : d === "R1" ? "HOST-A's gateway" : "HOST-B's gateway",
    kind: d === "HOST-A" ? "laptop" : d === "HOST-B" ? "server" : "router",
    ...pos[d],
  }));
  const mtu = (a: number, b: number) => (a !== b ? `MTU ${a} ≠ ${b}` : a < 1500 ? `MTU ${a}` : "");
  const lab = (ifs: string, m: string) => [labels && !compact ? ifs : "", m].filter(Boolean).join(" · ") || undefined;
  const edges: GraphEdge[] = [
    { id: "a", a: "HOST-A", b: "R1", label: lab(`eth0 ↔ ${ifn("ge0")}`, mtu(c["HOST-A"].mtu, c.R1.ifs.ge0.mtu)), state: !c.R1.ifs.ge0.up ? "down" : "full" },
    { id: "t", a: "R1", b: "R2", label: lab(`${ifn("ge1")} ↔ ${ifn("ge1")}`, mtu(c.R1.ifs.ge1.mtu, c.R2.ifs.ge1.mtu)), state: !(c.R1.ifs.ge1.up && c.R2.ifs.ge1.up) ? "down" : c.R1.ifs.ge1.mtu < 1500 || c.R2.ifs.ge1.mtu < 1500 ? "forming" : "full" },
    { id: "b", a: "R2", b: "HOST-B", label: lab(`${ifn("ge0")} ↔ eth0`, mtu(c.R2.ifs.ge0.mtu, c["HOST-B"].mtu)), state: !(c.R2.ifs.ge0.up && c["HOST-B"].power) ? "down" : "full" },
  ];
  const packets: LabPacketView[] = [];
  if (moment?.copy) {
    const p = moment.copy.pkt;
    packets.push({ id: `${runKey}:${cursor}`, path: [moment.copy.from, moment.copy.to], hop: 0, done: false, label: markerLabel(p), color: pktColor(p), description: `${pktLabel(p)}: ${moment.copy.from} → ${moment.copy.to}, TTL ${p.ttl}` });
  }
  if (prev?.copy && prev.outcome) packets.push({ id: `${runKey}:${cursor}:done`, path: [prev.copy.from, prev.outcome.at], hop: 1, done: true, label: nbsp(prev.outcome.label), color: OUTCOME[prev.outcome.tone], description: `${prev.outcome.at}: ${prev.outcome.label}` });
  const moving = moment?.copy ? [moment.copy.from, moment.copy.to] : moment?.decision ? [moment.decision.at] : [];
  return (
    <LabTopology
      nodes={nodes}
      edges={edges}
      regions={compact ? COMPACT_REGIONS : REGIONS}
      activeNodeIds={moving}
      selectedNodeId={selected}
      dimmedNodeIds={(["HOST-A", "HOST-B"] as const).filter((h) => !c[h].power)}
      onNodeClick={onNode ? (id) => onNode(id as IcDev) : undefined}
      packets={packets}
      segmentMs={950}
      nodeTags={tags}
    />
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The decision chain — what the device checked, in order (the ARP lab's DecisionChain, for a router or a host)
// ---------------------------------------------------------------------------------------------------------------
interface Check {
  k: string;
  v: ReactNode;
  sub?: string;
  tone: string;
}
const Mono = ({ children, className }: { children: ReactNode; className?: string }) => <span className={clsx("pv-mono", className)}>{children}</span>;
function checks(b: Beat, ifn: (i?: IcIf) => string): Check[] {
  const d = b.dec ?? {};
  const ok = "border-pv-success/50";
  const bad = "border-pv-danger/70 bg-pv-danger/10";
  const skip = "border-dashed border-pv-border opacity-50";
  const out: Check[] = [];
  if (d.gen && !d.ttl && !d.route) return [{ k: "Writes", v: <b className="text-pv-warning">ICMP {IC_KIND[d.gen.kind].type}/{IC_KIND[d.gen.kind].code}</b>, sub: `${IC_KIND[d.gen.kind].short}, from ${d.gen.src} to ${d.gen.dst}`, tone: "border-pv-warning/60" }];
  if (isRouter(b.at)) {
    out.push({ k: "Arrives on", v: <Mono>{d.inIf ? ifn(d.inIf) : d.originated ? "—" : "?"}</Mono>, sub: d.originated ? "built by the router itself" : "the interface it came in on", tone: "border-pv-border" });
    if (d.filter) out.push({ k: "Inbound filter", v: d.filter.ok ? <b className="text-pv-success">permit</b> : <b className="text-pv-danger">discard</b>, sub: `WAN-IN ${d.filter.rule}`, tone: d.filter.ok ? ok : bad });
    if (d.fit?.at === "ingress") out.push({ k: "Fits this port?", v: <b className="text-pv-danger">giant</b>, sub: `${d.fit.len} B > MTU ${d.fit.mtu}, dropped without ICMP`, tone: bad });
    if (d.local) return [...out, { k: "Addressed to me", v: <Mono>{b.pkt.dst}</Mono>, sub: "the router answers it itself", tone: ok }];
    let dead = out.some((x) => x.tone === bad);
    const add = (k: string, c?: Check) => {
      if (dead) out.push({ k, v: "—", sub: "not reached", tone: skip });
      else if (c) {
        out.push(c);
        if (c.tone === bad) dead = true;
      }
    };
    add("TTL", d.ttl ? (d.ttl.out === 0 ? { k: "TTL", v: <b className="text-pv-danger">{d.ttl.in} → 0</b>, sub: "can't be forwarded: it must die here", tone: bad } : { k: "TTL", v: <Mono>{`${d.ttl.in} → ${d.ttl.out}`}</Mono>, sub: "every router takes 1 off", tone: ok }) : d.originated ? { k: "TTL", v: <Mono>{b.pkt.ttl}</Mono>, sub: "a new packet starts fresh", tone: "border-pv-border" } : undefined);
    add("Route lookup", d.route === null ? { k: "Route lookup", v: <b className="text-pv-danger">no route</b>, sub: `nothing matches ${b.pkt.dst}`, tone: bad } : d.route ? { k: "Route lookup", v: <Mono>{`${d.route.prefix}/${d.route.len}`}</Mono>, sub: `${d.route.via ? `via ${d.route.via}` : "connected"} → out ${ifn(d.route.out)}`, tone: ok } : undefined);
    add("Fits the next link?", d.fit && d.fit.at !== "ingress" ? (d.fit.ok ? { k: "Fits the next link?", v: <Mono>{d.fit.frags && d.fit.frags > 1 ? `${d.fit.frags} fragments` : `${d.fit.len} ≤ ${d.fit.mtu}`}</Mono>, sub: d.fit.frags && d.fit.frags > 1 ? `bigger than MTU ${d.fit.mtu}, DF clear: split` : `MTU of that link: ${d.fit.mtu}`, tone: ok } : { k: "Fits the next link?", v: <b className="text-pv-danger">{d.fit.len} &gt; {d.fit.mtu}</b>, sub: "too big, and DF forbids splitting it", tone: bad }) : undefined);
    add("Next hop", d.arp ? (d.arp.ok ? { k: "Next hop", v: <Mono>{d.arp.nh}</Mono>, sub: "answers ARP: send it", tone: ok } : { k: "Next hop", v: <b className="text-pv-danger">no ARP answer</b>, sub: `nobody answers for ${d.arp.nh}`, tone: bad }) : undefined);
    return out;
  }
  if (b.k === "stop" && !b.dirIn) return [{ k: d.arp ? "Gateway" : "Fits the path?", v: <b className="text-pv-danger">{d.arp ? "no ARP answer" : "too big"}</b>, sub: d.arp ? `${d.arp.nh} doesn't answer: nothing is sent` : b.text.replace(/^.*?: /, ""), tone: bad }];
  out.push({ k: "Arrives on", v: <Mono>eth0</Mono>, sub: "the host's only interface", tone: "border-pv-border" });
  if (d.fw) out.push({ k: "Firewall", v: d.fw.ok ? <b className="text-pv-success">accepted</b> : <b className="text-pv-danger">DROP</b>, sub: d.fw.ok ? "no iptables rule matches" : `${d.fw.rule ?? ""} — silently`, tone: d.fw.ok ? ok : bad });
  return out;
}
export function DecisionChain({ b, vendor }: { b: Beat; vendor: "cisco" | "juniper" }) {
  const ifn = (i?: IcIf) => (!i ? "eth0" : vendor === "cisco" ? icShortIf(i) : icJunosIf(i));
  const cs = checks(b, ifn);
  return (
    <div>
      <p className="mb-1 text-[11px] text-pv-text-faint">
        {b.at} — {pktName(b.pkt)} {b.pkt.src} → {b.pkt.dst}
      </p>
      <ol className="grid grid-cols-2 gap-1 sm:grid-cols-5" aria-label={`${b.at}'s decision`}>
        {cs.map((x, i) => (
          <li key={x.k} className={clsx("pv-pop min-w-0 rounded-lg border px-2 py-1", x.tone)} style={{ animationDelay: `${i * 110}ms` }}>
            <p className="text-[9.5px] font-bold uppercase tracking-wide text-pv-text-faint">{x.k}</p>
            <p className="truncate text-[12.5px] text-pv-text">{x.v}</p>
            {x.sub && <p className="text-[10.5px] leading-snug text-pv-text-muted">{x.sub}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The packet, header by header (the ARP lab's FrameView)
// ---------------------------------------------------------------------------------------------------------------
export function PacketFields({ p }: { p: IcPkt }) {
  const cell = (k: string, v: string, sub: string, tone = "border-pv-border") => (
    <div key={k} className={clsx("min-w-0 rounded-md border px-1.5 py-1", tone)}>
      <p className="text-[9.5px] font-bold uppercase tracking-wide text-pv-text-faint">{k}</p>
      <p className="truncate pv-mono text-[11.5px] text-pv-text">{v}</p>
      <p className="truncate text-[10.5px] text-pv-text-muted">{sub}</p>
    </div>
  );
  const q = p.quote;
  return (
    <div className="space-y-1" aria-label="Packet fields">
      <p className="text-[12px] font-semibold" style={{ color: pktColor(p) }}>
        {pktLabel(p)} · {p.src} → {p.dst}
      </p>
      <p className="text-[10px] font-bold uppercase tracking-wide text-pv-cyan-soft">IPv4 header</p>
      <div className="grid grid-cols-3 gap-1 sm:grid-cols-6">
        {cell("Source IP", p.src, isErr(p) ? "the device reporting" : "the sender")}
        {cell("Destination IP", p.dst, "unchanged end to end")}
        {cell("TTL", String(p.ttl), "−1 at each router", "border-pv-warning/60 bg-pv-warning/10")}
        {cell("Protocol", p.proto === "icmp" ? "1 (ICMP)" : p.proto === "udp" ? "17 (UDP)" : "6 (TCP)", p.proto === "icmp" ? "no ports" : "carries ports")}
        {cell("Total length", `${p.len} B`, p.frags ? `in ${p.frags} fragments` : "header + data")}
        {cell("DF", p.df ? "1" : "0", p.df ? "don't fragment" : "may be fragmented", p.df ? "border-pv-cyan/50" : "border-pv-border")}
      </div>
      {p.proto === "icmp" && (
        <>
          <p className="text-[10px] font-bold uppercase tracking-wide text-pv-violet">ICMP</p>
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
            {cell("Type / code", pktCode(p), IC_KIND[p.kind!].short, isErr(p) ? "border-pv-warning/60" : "border-pv-success/50")}
            {cell("Kind", isErr(p) ? "error" : "query", isErr(p) ? "a report about a packet" : "Echo: id + seq match it")}
            {p.mtu ? cell("Next-hop MTU", String(p.mtu), "what would have fit", "border-pv-warning/60 bg-pv-warning/10") : null}
            {q ? cell("Quoted header", `${q.src} → ${q.dst}`, `the dead packet: ${q.proto === "icmp" ? IC_KIND[q.kind!].short : q.proto.toUpperCase()}, TTL ${q.ttl}`, "border-dashed border-pv-warning/60") : null}
          </div>
        </>
      )}
      {p.proto === "udp" && <p className="text-[11px] text-pv-text-muted">UDP to port {p.dport}: nothing listens there, so the destination will answer 3/3 Port Unreachable.</p>}
    </div>
  );
}
