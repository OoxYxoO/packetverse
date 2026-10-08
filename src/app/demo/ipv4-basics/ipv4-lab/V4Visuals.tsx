"use client";

import { clsx } from "clsx";
import type { ReactNode } from "react";
import type { CliVendor } from "@/lib/cli/types";
import { broadcastOf, ipToNum, maskOf, networkOf } from "@/lib/sim-engine/scenarios/ipv4Basics";
import { V4_BCAST, V4_DEV_NAME, V4_HOSTS, V4_HOST_IDS, V4_R1, V4_ZERO, hex4, v4MacOwner, type V4Capture, type V4CacheOwner, type V4Decision, type V4Dev, type V4Frame, type V4NetState, type V4R1If, type V4RouterStep } from "@/lib/sim-engine/scenarios/ipv4Net";
import { v4IfLabel } from "./v4Cli";

/**
 * The IPv4 Lab's visual vocabulary, all drawn from lab state: an address and its prefix (bits), where addresses fall
 * relative to a host's own network, a host's local/remote decision (the AND), R1's forwarding pipeline, a packet's
 * header before and after R1, frames, caches and captures.
 */

const Mono = ({ children, className }: { children: ReactNode; className?: string }) => <span className={clsx("pv-mono", className)}>{children}</span>;
const octets = (ip: string) => ip.split(".").map((o) => Number(o).toString(2).padStart(8, "0"));
export const frameTitle = (f: V4Frame) =>
  f.type === "ARP" ? (f.arp!.op === "request" ? `ARP request · who has ${f.arp!.tip}?` : `ARP reply · ${f.arp!.sip} is at ${f.arp!.smac}`) : f.ip!.icmp === "echo-request" ? `Ping · ${f.ip!.src} → ${f.ip!.dst} · TTL ${f.ip!.ttl}` : f.ip!.icmp === "echo-reply" ? `Echo reply · ${f.ip!.src} → ${f.ip!.dst} · TTL ${f.ip!.ttl}` : f.ip!.icmp === "time-exceeded" ? `ICMP time exceeded · ${f.ip!.src} → ${f.ip!.dst}` : `ICMP net unreachable · ${f.ip!.src} → ${f.ip!.dst}`;
export const ifLabel = (dev: string, iface: string, vendor: CliVendor) => (dev === "r1" ? v4IfLabel(vendor, iface as V4R1If) : iface);

/** An address, bit by bit: network bits (set by the prefix) vs host bits, and what that makes the network. */
export function AddressLens({ ip, prefix, name, compact }: { ip: string; prefix: number; name?: string; compact?: boolean }) {
  const bits = octets(ip);
  const net = networkOf(ip, prefix);
  const size = 2 ** (32 - prefix);
  return (
    <div className="space-y-1 rounded-xl border border-pv-border p-2" aria-label={`${name ?? ip} address bits`}>
      <p className="text-[11.5px] text-pv-text">
        {name && <b>{name} · </b>}
        <Mono>
          {ip}/{prefix}
        </Mono>{" "}
        <span className="text-pv-text-faint">mask {maskOf(prefix)}</span>
      </p>
      <div className="flex flex-wrap gap-x-1.5 gap-y-1 pv-mono text-[11.5px]">
        {bits.map((o, oi) => (
          <span key={oi} className="flex">
            {[...o].map((b, bi) => {
              const n = oi * 8 + bi;
              return (
                <span key={bi} className={clsx("w-[11px] text-center", n < prefix ? "rounded-[2px] bg-pv-cyan/20 font-bold text-pv-cyan-soft" : "text-pv-warning")}>
                  {b}
                </span>
              );
            })}
            {oi < 3 && <span className="text-pv-text-faint">.</span>}
          </span>
        ))}
      </div>
      {!compact && (
        <p className="text-[11px] text-pv-text-muted">
          <span className="text-pv-cyan-soft">{prefix} network bits</span> · <span className="text-pv-warning">{32 - prefix} host bits</span> → network <Mono className="text-pv-text">{net}</Mono>, {size} addresses (<Mono>{net}</Mono> – <Mono>{broadcastOf(ip, prefix)}</Mono>), {Math.max(0, size - 2)} usable by hosts.
        </p>
      )}
    </div>
  );
}

/**
 * The 192.168.10.0/24 space as a line: the block a host believes is its own network (from ITS prefix), R1's two real
 * networks underneath, and where every device's address falls.
 */
export function NetworkStrip({ s, owner, prefixOverride, ipOverride }: { s: V4NetState; owner: "hosta" | "hostc" | "hostb"; prefixOverride?: number; ipOverride?: string }) {
  const ip = ipOverride ?? s.cfg[owner].ip;
  const prefix = prefixOverride ?? s.cfg[owner].prefix;
  const base = ipToNum("192.168.10.0");
  const pos = (a: string) => Math.max(0, Math.min(100, ((ipToNum(a) - base) / 256) * 100));
  const net = ipToNum(networkOf(ip, prefix)) - base;
  const size = 2 ** (32 - prefix);
  const left = Math.max(0, (net / 256) * 100);
  const width = Math.min(100 - left, (size / 256) * 100);
  const marks: { label: string; ip: string; tone: string }[] = [
    ...V4_HOST_IDS.map((h) => ({ label: V4_HOSTS[h].name, ip: s.cfg[h].ip, tone: h === owner ? "#22d3ee" : "#e2e8f0" })),
    { label: "R1 left", ip: s.r1.ge0.ip, tone: "#a78bfa" },
    { label: "R1 right", ip: s.r1.ge1.ip, tone: "#a78bfa" },
  ];
  return (
    <div className="space-y-1 rounded-xl border border-pv-border p-2" aria-label={`${V4_HOSTS[owner].name}'s network on the address line`}>
      <p className="text-[11px] text-pv-text-muted">
        <b className="text-pv-text">{V4_HOSTS[owner].name}</b> believes its own network is <Mono className="text-pv-cyan-soft">{networkOf(ip, prefix)}/{prefix}</Mono>
        {size > 256 ? " (larger than the whole line)" : ""}. Inside: local. Outside: through the gateway.
      </p>
      <div className="relative h-9">
        {/* R1's real networks */}
        <div className="absolute inset-x-0 bottom-0 flex h-4 text-[9.5px]">
          {[0, 1, 2, 3].map((q) => (
            <div key={q} className={clsx("flex-1 truncate border-l border-pv-border px-1 text-pv-text-faint", q === 0 && "bg-pv-cyan/[0.06]", q === 1 && "bg-pv-violet/[0.08]")}>
              .{q * 64}/26{q === 0 ? " · LAN A" : q === 1 ? " · LAN B" : ""}
            </div>
          ))}
        </div>
        {/* the host's own belief */}
        <div className="absolute top-0 h-4 rounded border border-pv-cyan/70 bg-pv-cyan/20" style={{ left: `${left}%`, width: `${Math.max(width, 0.8)}%` }} title={`${networkOf(ip, prefix)}/${prefix}`} />
        {marks.map((m) => (
          <span key={m.label} className="absolute top-0 h-4 w-[2px] -translate-x-1/2" style={{ left: `${pos(m.ip)}%`, background: m.tone }} aria-hidden />
        ))}
      </div>
      <div className="flex justify-between pv-mono text-[9.5px] text-pv-text-faint">
        <span>192.168.10.0</span>
        <span>.255</span>
      </div>
      <ul className="flex flex-wrap gap-1" aria-label="Local or remote for each device">
        {marks.map((m) => {
          const inside = networkOf(m.ip, prefix) === networkOf(ip, prefix);
          return (
            <li key={m.label} className={clsx("rounded-full border px-2 py-0.5 text-[10.5px]", inside ? "border-pv-success/50 text-pv-success" : "border-pv-border text-pv-text-muted")}>
              <span style={{ color: m.tone }}>●</span> {m.label} <span className="pv-mono">{m.ip.replace("192.168.10", "")}</span> · {inside ? "local" : "remote"}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The AND, both ways: my address and the destination, each masked with MY mask, compared. */
export function DecisionMath({ d, name }: { d: Pick<V4Decision, "src" | "dst" | "prefix" | "srcNet" | "dstNet" | "local" | "gw" | "nextHop" | "cache">; name: string }) {
  const row = (label: string, ip: string, net: string) => (
    <div className="grid grid-cols-[minmax(0,5.5rem)_minmax(0,1fr)] items-baseline gap-x-2 text-[11.5px] sm:grid-cols-[6.5rem_minmax(0,1fr)]">
      <span className="text-pv-text-faint">{label}</span>
      <span className="pv-mono text-pv-text">
        {ip} <span className="text-pv-text-faint">AND</span> {maskOf(d.prefix)} = <b className={d.local ? "text-pv-success" : "text-pv-warning"}>{net}</b>
      </span>
    </div>
  );
  return (
    <div className="space-y-1 rounded-xl border border-pv-cyan/40 bg-pv-cyan/[0.03] p-2" aria-label={`${name}'s local or remote decision`}>
      <p className="text-[10.5px] font-bold uppercase tracking-wide text-pv-text-faint">{name}&apos;s decision, with its own mask /{d.prefix}</p>
      {row("my address", d.src, d.srcNet)}
      {row("destination", d.dst, d.dstNet)}
      <p className="text-[12.5px]">
        {d.cache === "no-route" ? (
          <b className="text-pv-danger">different networks → REMOTE · no default gateway: nothing can be sent</b>
        ) : d.local ? (
          <>
            <b className="text-pv-success">same network → LOCAL</b> <span className="text-pv-text-muted">· next hop = the destination itself, {d.nextHop}</span>
          </>
        ) : (
          <>
            <b className="text-pv-warning">different networks → REMOTE</b> <span className="text-pv-text-muted">· next hop = the default gateway, {d.nextHop}</span>
          </>
        )}
      </p>
    </div>
  );
}

/** The decision as the four addresses that matter on the wire. */
export function AddressChain({ d }: { d: V4Decision }) {
  const cells: { k: string; v: ReactNode; sub: string; tone: string }[] = [
    { k: "IPv4 destination", v: <Mono>{d.dst}</Mono>, sub: "the final host · never changes", tone: "border-pv-violet/50" },
    { k: "Local or remote", v: d.cache === "no-route" ? <b className="text-pv-danger">no route</b> : d.local ? <b className="text-pv-success">local</b> : <b className="text-pv-warning">remote</b>, sub: d.dev === "r1" ? `connected ${d.dstNet}/${d.prefix}` : `my network ${d.srcNet}/${d.prefix}`, tone: d.local ? "border-pv-success/50" : "border-pv-warning/50" },
    { k: "Next hop = ARP target", v: d.nextHop ? <Mono>{d.nextHop}</Mono> : "—", sub: !d.nextHop ? "nothing to resolve" : d.local ? "the destination itself" : "the default gateway", tone: "border-pv-cyan/50" },
    { k: "Ethernet destination", v: d.ethDst ? <Mono>{d.ethDst}</Mono> : <Mono className="text-pv-text-faint">??:??:??:??:??:??</Mono>, sub: d.ethDst ? v4MacOwner(d.ethDst) : d.cache === "hit" ? "from the ARP cache" : "unknown until ARP answers", tone: d.ethDst ? "border-pv-success/50" : "border-dashed border-pv-border" },
  ];
  return (
    <ol className="grid grid-cols-2 gap-1 sm:grid-cols-4" aria-label="Where the frame goes">
      {cells.map((c, i) => (
        <li key={c.k} className={clsx("pv-pop min-w-0 rounded-lg border px-2 py-1", c.tone)} style={{ animationDelay: `${i * 100}ms` }}>
          <p className="text-[9.5px] font-bold uppercase tracking-wide text-pv-text-faint">{c.k}</p>
          <p className="truncate text-[12.5px] text-pv-text">{c.v}</p>
          <p className="text-[10.5px] text-pv-text-muted">{c.sub}</p>
        </li>
      ))}
    </ol>
  );
}

/** What R1 did with one packet, in the order it does it. */
export function RouterPipeline({ r, vendor }: { r: V4RouterStep; vendor: CliVendor }) {
  const ip = r.inFrame.ip!;
  const steps: { k: string; v: ReactNode; tone?: string; off?: boolean }[] = [
    { k: "Frame arrives", v: <>on {v4IfLabel(vendor, r.inIface)} — destination MAC <Mono>{r.inFrame.ethDst}</Mono> is R1&apos;s own → accepted</> },
    { k: "Ethernet header removed", v: <>what&apos;s left is the IPv4 packet: <Mono>{ip.src}</Mono> → <Mono>{ip.dst}</Mono>, TTL {r.ttlIn}</> },
    {
      k: "Look up the destination",
      v: r.forMe ? <>{ip.dst} is one of R1&apos;s own addresses → R1 answers it itself</> : r.route ? <>{ip.dst} ∈ <Mono>{r.route.net}/{r.route.prefix}</Mono> — connected on {v4IfLabel(vendor, r.route.iface)}</> : <b className="text-pv-danger">no route to {ip.dst} → dropped · “destination net unreachable” sent back</b>,
      tone: r.outcome === "no-route" ? "border-pv-danger/50" : undefined,
    },
    {
      k: "TTL",
      v: r.outcome === "ttl-expired" ? <b className="text-pv-danger">{r.ttlIn} − 1 = 0 → dropped · “time exceeded” sent back</b> : r.ttlOut !== undefined ? <><Mono>{r.ttlIn}</Mono> → <Mono className="text-pv-warning">{r.ttlOut}</Mono> — one less per router</> : "—",
      tone: r.outcome === "ttl-expired" ? "border-pv-danger/50" : "border-pv-warning/40",
      off: r.forMe || r.outcome === "no-route",
    },
    { k: "Header checksum", v: r.csumOut !== undefined ? <><Mono>{hex4(r.csumIn)}</Mono> → <Mono className="text-pv-warning">{hex4(r.csumOut)}</Mono> — recomputed because the TTL changed</> : "—", off: r.csumOut === undefined },
    { k: "Next hop's MAC", v: r.arp === "hit" ? <>{ip.dst} found in R1&apos;s ARP table</> : r.arp === "resolved" ? <>ARP on {r.route && v4IfLabel(vendor, r.route.iface)}: {ip.dst} answered</> : r.arp === "failed" ? <b className="text-pv-danger">ARP for {ip.dst} got no reply → dropped</b> : "—", off: !r.arp, tone: r.arp === "failed" ? "border-pv-danger/50" : undefined },
    { k: "New frame sent", v: r.outFrame ? <><Mono>{r.outFrame.ethSrc}</Mono> → <Mono>{r.outFrame.ethDst}</Mono> out {r.route && v4IfLabel(vendor, r.route.iface)} — a brand-new Ethernet header around the same packet</> : "—", off: !r.outFrame, tone: r.outFrame ? "border-pv-success/50" : undefined },
  ];
  return (
    <ol className="space-y-1" aria-label="R1's forwarding pipeline">
      {steps.map((x, i) => (
        <li key={x.k} className={clsx("pv-pop flex gap-2 rounded-lg border px-2 py-1", x.tone ?? "border-pv-border", x.off && "opacity-40")} style={{ animationDelay: `${i * 120}ms` }}>
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[11px] font-bold text-pv-text">{i + 1}</span>
          <div className="min-w-0 text-[12.5px] leading-snug">
            <span className="mr-1 text-[10.5px] font-bold uppercase tracking-wide text-pv-text-faint">{x.k}</span>
            <span className="text-pv-text">{x.v}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** The packet as it arrived at R1 and as it left: what stays, what changes. */
export function HeaderDiff({ inF, outF }: { inF: V4Frame; outF: V4Frame }) {
  const a = inF.ip!, b = outF.ip!;
  const rows: [string, string, string][] = [
    ["Ethernet source", inF.ethSrc, outF.ethSrc],
    ["Ethernet destination", inF.ethDst, outF.ethDst],
    ["IPv4 source", a.src, b.src],
    ["IPv4 destination", a.dst, b.dst],
    ["TTL", String(a.ttl), String(b.ttl)],
    ["Header checksum", hex4(a.checksum), hex4(b.checksum)],
    ["Identification", hex4(a.id), hex4(b.id)],
    ["Total length", String(a.len), String(b.len)],
  ];
  return (
    <div className="overflow-x-auto rounded-xl border border-pv-border">
      <table className="w-full min-w-[420px] text-left text-[12px]">
        <thead className="text-[10.5px] text-pv-text-faint">
          <tr>
            <th className="px-2 py-1 font-normal">field</th>
            <th className="px-2 font-normal">arriving at R1</th>
            <th className="px-2 font-normal">leaving R1</th>
            <th className="px-2 font-normal" />
          </tr>
        </thead>
        <tbody className="pv-mono">
          {rows.map(([k, x, y]) => (
            <tr key={k} className={clsx("border-t border-pv-border/50", x !== y && "bg-pv-warning/[0.07]")}>
              <td className="px-2 py-0.5 font-sans text-pv-text-muted">{k}</td>
              <td className="px-2">{x}</td>
              <td className={clsx("px-2", x !== y && "font-bold text-pv-warning")}>{y}</td>
              <td className="px-2 font-sans text-[11px]">{x !== y ? <span className="text-pv-warning">changed</span> : <span className="text-pv-text-faint">same</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A frame, header by header. */
export function FrameView({ f, note }: { f: V4Frame; note?: string }) {
  const cell = (k: string, v: string, sub: string, tone = "border-pv-border") => (
    <div key={k} className={clsx("min-w-0 rounded-md border px-1.5 py-1", tone)}>
      <p className="text-[9.5px] font-bold uppercase tracking-wide text-pv-text-faint">{k}</p>
      <p className="truncate pv-mono text-[11.5px] text-pv-text">{v}</p>
      <p className="truncate text-[10.5px] text-pv-text-muted">{sub}</p>
    </div>
  );
  return (
    <div className="space-y-1" aria-label="Frame fields">
      <p className="text-[12px] font-semibold text-pv-text">{frameTitle(f)}</p>
      <p className="text-[10px] font-bold uppercase tracking-wide text-pv-cyan-soft">Ethernet header · this link only</p>
      <div className="grid grid-cols-3 gap-1">
        {cell("Destination MAC", f.ethDst, f.ethDst === V4_BCAST ? "broadcast" : v4MacOwner(f.ethDst), "border-pv-cyan/50")}
        {cell("Source MAC", f.ethSrc, v4MacOwner(f.ethSrc))}
        {cell("EtherType", f.type === "ARP" ? "0x0806" : "0x0800", f.type === "ARP" ? "ARP" : "IPv4 inside")}
      </div>
      {f.arp ? (
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
          {cell("Sender IP", f.arp.sip, "who asks/answers")}
          {cell("Sender MAC", f.arp.smac, v4MacOwner(f.arp.smac))}
          {cell("Target IP", f.arp.tip, f.arp.op === "request" ? "the next hop asked for" : "who asked")}
          {cell("Target MAC", f.arp.tmac, f.arp.tmac === V4_ZERO ? "unknown" : v4MacOwner(f.arp.tmac))}
        </div>
      ) : (
        <>
          <p className="text-[10px] font-bold uppercase tracking-wide text-pv-violet">IPv4 header · end to end</p>
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
            {cell("Source", f.ip!.src, "unchanged by routers")}
            {cell("Destination", f.ip!.dst, "unchanged by routers")}
            {cell("TTL", String(f.ip!.ttl), "−1 at each router", "border-pv-warning/40")}
            {cell("Header checksum", hex4(f.ip!.checksum), "recomputed when TTL changes")}
            {cell("Identification", hex4(f.ip!.id), "per packet")}
            {cell("Protocol", "1 (ICMP)", f.ip!.icmp)}
            {cell("Total length", String(f.ip!.len), "header + data")}
            {cell("Flags", "DF", "don't fragment")}
          </div>
        </>
      )}
      {note && <p className="text-[11px] text-pv-text-muted">{note}</p>}
    </div>
  );
}

export function CacheTable({ s, owner }: { s: V4NetState; owner: V4CacheOwner }) {
  const rows = s.caches[owner];
  return (
    <div className="rounded-xl border border-pv-border p-2" aria-label={`${V4_DEV_NAME[owner]} ARP cache`}>
      <p className="mb-1 flex items-baseline justify-between gap-2 text-[11px] font-bold uppercase tracking-wide text-pv-violet">
        {V4_DEV_NAME[owner]} · ARP
        <span className="font-normal normal-case tracking-normal text-pv-text-faint">next hop IP → MAC</span>
      </p>
      {!rows.length ? (
        <p className="pv-mono text-[11.5px] text-pv-text-faint">empty</p>
      ) : (
        <table className="w-full text-left pv-mono text-[11.5px]">
          <tbody>
            {rows.map((e) => (
              <tr key={e.ip} className={clsx(e.state !== "reachable" && "text-pv-warning")}>
                <td className="pr-2">{e.ip}</td>
                <td>{e.state === "reachable" ? e.mac : "(incomplete — no reply)"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function CaptureTable({ s, dev, iface, vendor, onPick, picked }: { s: V4NetState; dev: V4Dev; iface: string; vendor: CliVendor; onPick?: (c: V4Capture) => void; picked?: number }) {
  const rows = s.captures.filter((c) => c.dev === dev && c.iface === iface).slice(-80);
  if (!rows.length) return <p className="pv-mono text-[11.5px] text-pv-text-faint">No frame has crossed {V4_DEV_NAME[dev]} {ifLabel(dev, iface, vendor)} since the lab (or the ticket) started.</p>;
  return (
    <div className="max-h-72 overflow-auto rounded-lg border border-pv-border">
      <table className="w-full min-w-[480px] text-left text-[11px]">
        <thead className="sticky top-0 bg-pv-bg text-[10px] text-pv-text-faint">
          <tr>
            <th className="px-1.5 py-0.5 font-normal">No.</th>
            <th className="px-1.5 font-normal">dir</th>
            <th className="px-1.5 font-normal">Ethernet</th>
            <th className="px-1.5 font-normal">what</th>
            <th className="px-1.5 font-normal">what {V4_DEV_NAME[dev]} did</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.no} onClick={onPick ? () => onPick(c) : undefined} className={clsx("border-t border-pv-border/50", onPick && "cursor-pointer hover:bg-white/[0.04]", picked === c.no && "bg-pv-cyan/10", /ignored|dropped/.test(c.note ?? "") && "text-pv-text-faint")}>
              <td className="px-1.5 py-0.5 pv-mono">{c.no}</td>
              <td className="px-1.5">{c.dir === "in" ? "← in" : "→ out"}</td>
              <td className="px-1.5 pv-mono">
                {v4MacOwner(c.frame.ethSrc)} → {v4MacOwner(c.frame.ethDst)}
              </td>
              <td className="px-1.5">{frameTitle(c.frame)}</td>
              <td className="px-1.5 text-pv-text-muted">{c.note ?? (c.dir === "out" ? "sent" : "")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const r1IfaceOf = (i: V4R1If) => V4_R1[i];
