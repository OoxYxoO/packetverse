"use client";

import { clsx } from "clsx";
import type { ReactNode } from "react";
import type { CliVendor } from "@/lib/cli/types";
import {
  BCAST,
  DEV_NAME,
  HOSTS,
  R1_IFS,
  SW_PORT_PEER,
  ZERO_MAC,
  entryAge,
  macOwner,
  maskOf,
  type ArpCapture,
  type ArpDev,
  type ArpFrame,
  type ArpNetState,
  type CacheOwner,
  type SendDecision,
  type SwPort,
} from "@/lib/sim-engine/scenarios/arpNet";
import { arpIfName } from "./arpNetCli";

/**
 * The ARP Lab's visual vocabulary, all drawn from lab state: a sender's decision (the four answers that make ARP
 * happen), a frame's fields, an ARP cache (IP → MAC, on a device), SW1's MAC table (MAC → port), a capture.
 */

export const ifLabel = (dev: ArpDev, iface: string, vendor: CliVendor) => (dev === "sw1" || dev === "r1" ? arpIfName(vendor, dev, iface) : iface);
const Mono = ({ children, className }: { children: ReactNode; className?: string }) => <span className={clsx("pv-mono", className)}>{children}</span>;
export const frameTitle = (f: ArpFrame) => (f.type === "ARP" ? (f.arp!.op === "request" ? `ARP Request · who has ${f.arp!.tip}?` : `ARP Reply · ${f.arp!.sip} is at ${f.arp!.smac}`) : f.ip!.icmp === "echo-request" ? `Ping · ${f.ip!.src} → ${f.ip!.dst}` : f.ip!.icmp === "echo-reply" ? `Echo reply · ${f.ip!.src} → ${f.ip!.dst}` : `ICMP unreachable · ${f.ip!.src} → ${f.ip!.dst}`);

/**
 * The decision chain a sender goes through before a frame can leave: where is the destination, so what is the next
 * hop, what is that next hop's MAC (cache or ARP), and so what goes in the Ethernet destination field.
 */
export function DecisionChain({ d, compact }: { d: SendDecision; compact?: boolean }) {
  const steps: { k: string; v: ReactNode; sub?: ReactNode; tone: string }[] = [
    { k: "IP destination", v: <Mono>{d.dst}</Mono>, sub: d.dev === "r1" ? "from the packet R1 is forwarding" : "where the packet must end up", tone: "border-pv-violet/50" },
    {
      k: "Local or remote?",
      v: d.cache === "no-route" ? <b className="text-pv-danger">no route</b> : d.local ? <b className="text-pv-success">local</b> : <b className="text-pv-warning">remote</b>,
      sub: d.dev === "r1" ? `connected network ${d.myNet}` : <>my network {d.myNet}</>,
      tone: d.local ? "border-pv-success/50" : "border-pv-warning/50",
    },
    { k: "Next hop = ARP target", v: d.nextHop ? <Mono>{d.nextHop}</Mono> : "—", sub: !d.nextHop ? "nothing to resolve" : d.local ? "the destination itself" : "the default gateway, not the destination", tone: "border-pv-cyan/50" },
    {
      k: "ARP cache",
      v: d.cache === "hit" ? <b className="text-pv-success">hit</b> : d.cache === "static" ? <b className="text-pv-warning">static entry</b> : d.cache === "no-route" ? "—" : <b className="text-pv-warning">miss → ARP</b>,
      sub: d.cache === "miss" ? (d.resolved ? "the reply filled it" : "no reply yet") : d.cache === "hit" ? "learned earlier: no ARP needed" : d.cache === "static" ? "configured by hand, never checked" : "",
      tone: "border-pv-border",
    },
    { k: "Ethernet destination", v: d.ethDst ? <Mono>{d.ethDst}</Mono> : <Mono className="text-pv-text-faint">??:??:??:??:??:??</Mono>, sub: d.ethDst ? macOwner(d.ethDst) : "unknown until ARP answers", tone: d.ethDst ? "border-pv-success/50" : "border-dashed border-pv-border" },
  ];
  return (
    <div>
      <p className="mb-1 text-[11px] text-pv-text-faint">
        {DEV_NAME[d.dev]} ({d.src}) → {d.dst}
      </p>
      <ol className={clsx("grid gap-1", compact ? "grid-cols-2 sm:grid-cols-5" : "grid-cols-1 sm:grid-cols-5")} aria-label={`${DEV_NAME[d.dev]}'s decision`}>
        {steps.map((x, i) => (
          <li key={x.k} className={clsx("pv-pop min-w-0 rounded-lg border px-2 py-1", x.tone)} style={{ animationDelay: `${i * 110}ms` }}>
            <p className="text-[9.5px] font-bold uppercase tracking-wide text-pv-text-faint">{x.k}</p>
            <p className="truncate text-[12.5px] text-pv-text">{x.v}</p>
            {x.sub && <p className="text-[10.5px] leading-snug text-pv-text-muted">{x.sub}</p>}
          </li>
        ))}
      </ol>
      {!compact && <p className="mt-1 text-[11.5px] text-pv-text-muted">{d.why}.</p>}
    </div>
  );
}

/** A frame, header by header: Ethernet first (what switches and NICs read), then ARP or IP. */
export function FrameView({ f, note }: { f: ArpFrame; note?: string }) {
  const cell = (k: string, v: string, sub: string, tone = "border-pv-border") => (
    <div key={k} className={clsx("min-w-0 rounded-md border px-1.5 py-1", tone)}>
      <p className="text-[9.5px] font-bold uppercase tracking-wide text-pv-text-faint">{k}</p>
      <p className="truncate pv-mono text-[11.5px] text-pv-text">{v}</p>
      <p className="truncate text-[10.5px] text-pv-text-muted">{sub}</p>
    </div>
  );
  const a = f.arp;
  return (
    <div className="space-y-1" aria-label="Frame fields">
      <p className="text-[12px] font-semibold text-pv-text">{frameTitle(f)}</p>
      <p className="text-[10px] font-bold uppercase tracking-wide text-pv-cyan-soft">Ethernet header</p>
      <div className="grid grid-cols-3 gap-1">
        {cell("Destination MAC", f.ethDst, f.ethDst === BCAST ? "broadcast: every device" : `unicast: ${macOwner(f.ethDst)}`, f.ethDst === BCAST ? "border-pv-warning/60 bg-pv-warning/10" : "border-pv-cyan/50")}
        {cell("Source MAC", f.ethSrc, macOwner(f.ethSrc))}
        {cell("EtherType", f.type === "ARP" ? "0x0806" : "0x0800", f.type === "ARP" ? "ARP inside" : "IPv4 inside")}
      </div>
      {a ? (
        <>
          <p className="text-[10px] font-bold uppercase tracking-wide text-pv-violet">ARP {a.op}</p>
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
            {cell("Sender IP", a.sip, "who is speaking")}
            {cell("Sender MAC", a.smac, macOwner(a.smac))}
            {cell("Target IP", a.tip, a.op === "request" ? "the question" : "who asked")}
            {cell("Target MAC", a.tmac, a.tmac === ZERO_MAC ? "unknown: that's what is asked" : macOwner(a.tmac), a.tmac === ZERO_MAC ? "border-dashed border-pv-border" : "border-pv-border")}
          </div>
        </>
      ) : (
        <>
          <p className="text-[10px] font-bold uppercase tracking-wide text-pv-violet">IPv4 header</p>
          <div className="grid grid-cols-3 gap-1">
            {cell("Source IP", f.ip!.src, "unchanged end to end")}
            {cell("Destination IP", f.ip!.dst, "unchanged end to end")}
            {cell("TTL", String(f.ip!.ttl), "−1 at each router")}
          </div>
        </>
      )}
      {note && <p className="text-[11px] text-pv-text-muted">{note}</p>}
    </div>
  );
}

/** One device's ARP cache: IP → MAC. */
export function CacheTable({ s, owner, fresh }: { s: ArpNetState; owner: CacheOwner; fresh?: string[] }) {
  const rows = s.caches[owner];
  const own = owner === "r1" ? [R1_IFS.gi0, R1_IFS.gi1] : [];
  return (
    <div className="rounded-xl border border-pv-border p-2" aria-label={`${DEV_NAME[owner]} ARP cache`}>
      <p className="mb-1 flex items-baseline justify-between gap-2 text-[11px] font-bold uppercase tracking-wide text-pv-violet">
        {DEV_NAME[owner]} · ARP cache
        <span className="font-normal normal-case tracking-normal text-pv-text-faint">IP → MAC{owner !== "r1" ? ` · ${s.cfg[owner].ip}/${s.cfg[owner].prefix}` : ""}</span>
      </p>
      {!rows.length && !own.length ? (
        <p className="pv-mono text-[11.5px] text-pv-text-faint">empty</p>
      ) : (
        <table className="w-full text-left pv-mono text-[11.5px]">
          <tbody>
            {own.map((o) => (
              <tr key={o.ip} className="text-pv-text-faint">
                <td className="pr-2">{o.ip}</td>
                <td className="pr-2">{o.mac}</td>
                <td className="font-sans">own address</td>
              </tr>
            ))}
            {rows.map((e) => (
              <tr key={e.ip} className={clsx(fresh?.includes(e.ip) && "pv-pop text-pv-success", e.state !== "reachable" && "text-pv-warning")}>
                <td className="pr-2">{e.ip}</td>
                <td className="pr-2">{e.state === "reachable" ? e.mac : e.state === "incomplete" ? "(incomplete — asking…)" : "(incomplete — no reply)"}</td>
                <td className="font-sans">{e.static ? "static" : e.state === "reachable" ? `${entryAge(s, e)} s` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** SW1's MAC address table: MAC → port. No IP anywhere. */
export function MacTableView({ s, vendor, fresh }: { s: ArpNetState; vendor: CliVendor; fresh?: string[] }) {
  const rows = Object.entries(s.swMac);
  return (
    <div className="rounded-xl border border-pv-border p-2" aria-label="SW1 MAC address table">
      <p className="mb-1 flex items-baseline justify-between gap-2 text-[11px] font-bold uppercase tracking-wide text-pv-cyan-soft">
        SW1 · MAC address table
        <span className="font-normal normal-case tracking-normal text-pv-text-faint">MAC → port · no IP addresses</span>
      </p>
      {!rows.length ? (
        <p className="pv-mono text-[11.5px] text-pv-text-faint">empty</p>
      ) : (
        <table className="w-full text-left pv-mono text-[11.5px]">
          <tbody>
            {rows.map(([mac, e]) => (
              <tr key={mac} className={clsx(fresh?.includes(mac) && "pv-pop text-pv-success")}>
                <td className="pr-2">{mac}</td>
                <td className="pr-2">{arpIfName(vendor, "sw1", e.port)}</td>
                <td className="font-sans text-pv-text-muted">→ {DEV_NAME[SW_PORT_PEER[e.port as SwPort]]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Every frame seen at one interface. */
export function CaptureTable({ s, dev, iface, vendor, onPick, picked }: { s: ArpNetState; dev: ArpDev; iface: string; vendor: CliVendor; onPick?: (c: ArpCapture) => void; picked?: number }) {
  const rows = s.captures.filter((c) => c.dev === dev && c.iface === iface).slice(-80);
  if (!rows.length) return <p className="pv-mono text-[11.5px] text-pv-text-faint">No frame has crossed {DEV_NAME[dev]} {ifLabel(dev, iface, vendor)} since the lab (or the ticket) started.</p>;
  return (
    <div className="max-h-72 overflow-auto rounded-lg border border-pv-border">
      <table className="w-full min-w-[460px] text-left text-[11px]">
        <thead className="sticky top-0 bg-pv-bg text-[10px] text-pv-text-faint">
          <tr>
            <th className="px-1.5 py-0.5 font-normal">No.</th>
            <th className="px-1.5 font-normal">dir</th>
            <th className="px-1.5 font-normal">Ethernet src → dst</th>
            <th className="px-1.5 font-normal">what</th>
            <th className="px-1.5 font-normal">what {DEV_NAME[dev]} did</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.no} onClick={onPick ? () => onPick(c) : undefined} className={clsx("border-t border-pv-border/50", onPick && "cursor-pointer hover:bg-white/[0.04]", picked === c.no && "bg-pv-cyan/10", /discarded|ignored|dropped/.test(c.note ?? "") && "text-pv-text-faint")}>
              <td className="px-1.5 py-0.5 pv-mono">{c.no}</td>
              <td className="px-1.5">{c.dir === "in" ? "← in" : "→ out"}</td>
              <td className="px-1.5 pv-mono">
                {macOwner(c.frame.ethSrc)} → {macOwner(c.frame.ethDst)}
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

/** For one ARP request: who received it, and what each did with it. */
export function WhoHeard({ s, run, tip }: { s: ArpNetState; run: number; tip: string }) {
  const rows = s.captures.filter((c) => c.run === run && c.dir === "in" && c.frame.arp?.op === "request" && c.frame.arp.tip === tip && c.dev !== "sw1");
  if (!rows.length) return null;
  return (
    <ul className="grid gap-1 sm:grid-cols-3" aria-label="Who received the request">
      {rows.map((c) => {
        const target = /that's me/.test(c.note ?? "");
        return (
          <li key={c.no} className={clsx("rounded-lg border px-2 py-1", target ? "border-pv-success/60 bg-pv-success/10" : "border-pv-border")}>
            <p className="text-[12px] font-bold text-pv-text">{DEV_NAME[c.dev]}</p>
            <p className="text-[11px] text-pv-text-muted">{target ? `owns ${tip}: learns the sender, replies` : `kept the broadcast, read the ARP: ${tip} isn't mine → ignored`}</p>
          </li>
        );
      })}
    </ul>
  );
}

export function hostSummary(s: ArpNetState, h: "laptop" | "pcb" | "pcc" | "server") {
  const c = s.cfg[h];
  return `${HOSTS[h].name} · ${c.ip}/${c.prefix} (mask ${maskOf(c.prefix)}) · gateway ${c.gw ?? "none"} · MAC ${HOSTS[h].mac}`;
}
