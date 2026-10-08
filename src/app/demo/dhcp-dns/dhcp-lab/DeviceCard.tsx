"use client";

import { clsx } from "clsx";
import { useIfName } from "./ifNames";
import type { ReactNode } from "react";
import { DNS_RECORD_TTL } from "@/lib/sim-engine/scenarios/dhcpDns";
import { DL_ADDR, DL_IFACES, DL_NODE_IFACES, configured, dhcpProblem, dhcpRunning, macLabel, type DlHop, type DlIface, type DlNode, type DlPacket, type DlState } from "@/lib/sim-engine/scenarios/dhcpDnsLab";
import { field, plainHop, ROLE } from "./dhcpPlain";
import type { Level } from "./LearnPath";
import { QUESTION_MAP } from "./LearnPath";

/**
 * The device card: tap a device to see what it is, what it knows, what it just saw and did, what it changed or
 * decided, and (later) how to prove it and troubleshoot it. Depth grows with the learning level:
 *   1 role + what it knows · 2 + what it just did · 3 + where you could look · 4 + what it changed/decided ·
 *   5 + prove it (captures, follow) · 6 + troubleshoot (tables, terminal, commands).
 * Everything is read from the last action's packets and the device state; nothing is invented here.
 */

type Node = Exclude<DlNode, "WEB">;
const recent = (lab: DlState) => lab.capture.filter((p) => lab.lastPackets.includes(p.no));
const hopsAt = (lab: DlState, n: DlNode) => recent(lab).flatMap((p) => p.hops.filter((h) => h.node === n && h.act !== "ignore").map((h) => ({ p, h })));
const owner = (m: string) => macLabel(m).replace(/^.*\((.*)\)$/, "$1");
const FRIENDLY: Record<string, string> = { CLIENT: "the laptop", "R1 ge-0/0/0": "router R1", "R1 ge-0/0/1": "router R1", "R1 ge-0/0/2": "router R1", "DHCP-SRV": "the DHCP server", "DNS-SRV": "the DNS server" };
const friendly = (m: string) => FRIENDLY[owner(m)] ?? owner(m);

/** A short word for what a device just did, for the topology badge. */
export function activityBadge(lab: DlState, n: DlNode): { text: string; tone: "yes" | "bad" | "info" } | undefined {
  const hs = hopsAt(lab, n);
  if (!hs.length || n === "CLIENT") return undefined;
  const acts = hs.map((x) => x.h.act);
  if (acts.includes("drop")) return { text: "dropped", tone: "bad" };
  if (acts.includes("reject")) return { text: "refused", tone: "bad" };
  if (acts.includes("unanswered")) return { text: "no answer", tone: "bad" };
  if (n === "SW1" || n === "SW2") return { text: "carried", tone: "info" };
  if (n === "R1") return { text: acts.includes("relay") ? "relayed" : "routed", tone: "info" };
  if (n === "DHCP-SRV") return { text: recent(lab).some((p) => p.msg === "ACK") ? "leased" : recent(lab).some((p) => p.msg === "OFFER") ? "offered" : "replied", tone: "yes" };
  if (n === "DNS-SRV") return { text: "answered", tone: "yes" };
  return undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// What the device knows right now (plain), with config facts optionally concealed (level 5: locate, don't peek)
// ---------------------------------------------------------------------------------------------------------------
function knows(lab: DlState, n: Node, level: Level, conceal: boolean): string[] {
  const c = lab.client;
  const cfg = lab.config;
  const hidden = "Its settings unlock in level 6. For now, use what it saw.";
  switch (n) {
    case "CLIENT":
      return [
        configured(c) ? `It is set up: address ${c.ip}, router ${c.gw}, DNS server ${c.dns}.` : c.phase === "APIPA" ? `Nobody answered, so it gave itself ${c.ip}: it can't reach anything beyond its own network.` : c.phase === "INIT" ? "It has no settings yet." : `It is in the middle of asking (${c.phase === "SELECTING" ? "it has an offer" : "it has asked for the offer"}). Nothing is set up yet.`,
        ...(level >= 2 && lab.cache.some((e) => e.expires > lab.clock) ? [`It remembers ${lab.cache.filter((e) => e.expires > lab.clock).map((e) => `${e.name} → ${e.ip} (${e.expires - lab.clock} s left)`).join(", ")}.`] : []),
        ...(level >= 4 && Object.keys(lab.net.arp.CLIENT).length ? [`Hardware addresses it knows: ${Object.entries(lab.net.arp.CLIENT).map(([ip, m]) => (m === "incomplete" ? `${ip}: asked, no answer` : `${ip} (${owner(m)})`)).join(", ")}.`] : []),
      ];
    case "SW1":
    case "SW2": {
      const t = Object.entries(lab.net.mac[n]);
      return [level >= 2 ? `It knows which cable leads to ${t.length} device${t.length === 1 ? "" : "s"}: ${t.map(([m, port]) => `${friendly(m)} on ${port}`).join(", ")}.` : `It connects the cables of ${n === "SW1" ? "the laptop's network" : "the servers' network"}.`];
    }
    case "R1":
      return [
        "It connects the laptop's network (10.10.10.0/24, cable ge-0/0/0) and the servers' network (10.20.20.0/24, cable ge-0/0/1).",
        ...(level >= 2 ? [conceal ? hidden : cfg.relay && cfg.helper ? (cfg.helperIf === "ge-0/0/0" ? `Its DHCP relay is on: DHCP broadcasts from the laptop's network are sent on to ${cfg.helper}${cfg.helper === DL_ADDR.SRV ? " (the DHCP server)" : ""}.` : `Its DHCP relay is configured on ${cfg.helperIf}, the servers' side: broadcasts from the laptop's network are NOT relayed.`) : "Its DHCP relay is OFF: DHCP broadcasts from the laptop's network go no further."] : []),
        ...(level >= 4 && Object.keys(lab.net.arp.R1).length ? [`Hardware addresses it knows: ${Object.entries(lab.net.arp.R1).map(([ip, m]) => (m === "incomplete" ? `${ip}: asked, nobody answered` : `${ip} (${owner(m)})`)).join(", ")}.`] : []),
      ];
    case "DHCP-SRV":
      return [
        ...(conceal ? [hidden] : [dhcpRunning(cfg) ? "Its DHCP service is running." : cfg.serverUp ? `Its DHCP service FAILED to start: ${dhcpProblem(cfg)}.` : "Its DHCP service is not running (the computer is on, the program isn't).", cfg.scope ? `It hands out ${cfg.scope.start}–${cfg.scope.end} (${cfg.poolFree} free) on ${cfg.scope.net}/24, with router ${cfg.option3 || "(none)"} and DNS server ${cfg.option6 || "(none)"}.` : "It has no scope for the laptops' network."]),
        ...(level >= 2 && lab.net.leases.length ? [`Leases it has given: ${lab.net.leases.map((l) => `${l.ip} to the laptop${l.state === "free" ? " (released)" : ""}`).join(", ")}.`] : []),
      ];
    case "DNS-SRV":
      return [...(conceal ? [hidden] : [`Its DNS service is ${cfg.dnsUp ? "running" : "STOPPED (the computer is on, the program isn't)"}.`, `It knows: ${Object.entries(lab.records).map(([nm, ip]) => `${nm} → ${ip}`).join(", ")}.`])];
  }
}

// ---------------------------------------------------------------------------------------------------------------
// What it just saw and did (level 2+), and what it changed or decided (level 4+)
// ---------------------------------------------------------------------------------------------------------------
function justNow(lab: DlState, n: Node): string[] {
  const out: string[] = [];
  const seen = new Map<string, number>();
  for (const { p, h } of hopsAt(lab, n)) {
    // the relay's own new packet starts at R1: its "send" is already described by the relay step
    if (h.act === "send" && n === "R1" && recent(lab).some((q) => q.journey === p.journey && q.no < p.no)) continue;
    const s = plainHop(p, h).replace(/^(The laptop|Switch SW[12]|Router R1|The DHCP server|The DNS server) /, "") ;
    const line = `${p.msg}: ${s}`;
    seen.set(line, (seen.get(line) ?? 0) + 1);
  }
  for (const [line, k] of seen) out.push(k > 1 ? `${line} (×${k})` : line);
  if (!out.length && n === "CLIENT" && lab.lastResult?.kind === "resolve" && lab.lastResult.ok) out.push("It answered the name question from its memory: nothing was sent.");
  return out;
}

interface Change {
  label: string;
  before?: string;
  after: string;
}
function changed(lab: DlState, n: Node): Change[] {
  const ps = recent(lab);
  const out: Change[] = [];
  const next = (p: DlPacket) => ps.find((q) => q.journey === p.journey && q.no > p.no);
  if (n === "SW1" || n === "SW2") {
    const learned = new Map<string, string>();
    for (const p of ps) for (const o of p.obs) if (o.dir === "in" && DL_IFACES[o.iface].node === n && o.srcMac !== "FF:FF:FF:FF:FF:FF") learned.set(friendly(o.srcMac), DL_IFACES[o.iface].name);
    if (hopsAt(lab, n).length) out.push({ label: "The message itself", after: "unchanged: the same addresses leave as arrived. A switch only chooses which cable." });
    for (const [who, port] of learned) out.push({ label: "It learned", after: `${who} is on ${port}` });
  }
  if (n === "R1") {
    for (const { p, h } of hopsAt(lab, n)) {
      if (h.act === "relay" && h.in === "R1:ge-0/0/0") {
        const q = next(p);
        if (q) out.push({ label: `Relayed ${p.msg}`, before: `from ${p.src} to ${p.dst} (a broadcast)`, after: `from ${q.src} to ${q.dst}, note giaddr ${field(q, "giaddr")}` });
      } else if (h.act === "relay") {
        const q = next(p);
        if (q) out.push({ label: `Relayed ${p.msg} back`, before: `from ${p.src} to ${p.dst}`, after: `from ${q.src} to everyone on the laptop's network` });
      } else if (h.act === "route") {
        const i = p.obs.find((o) => o.iface === h.in && o.dir === "in");
        const o2 = p.obs.find((o) => h.out.includes(o.iface) && o.dir === "out");
        if (i && o2) out.push({ label: `Routed ${p.msg}`, before: `hardware ${owner(i.srcMac)} → ${owner(i.dstMac)}, TTL ${i.ttl}`, after: `hardware ${owner(o2.srcMac)} → ${owner(o2.dstMac)}, TTL ${o2.ttl} (IP addresses unchanged)` });
      } else if (h.act === "drop") out.push({ label: `Kept ${p.msg}`, after: "nothing left by the other cable" });
    }
    for (const p of ps.filter((x) => x.proto === "ARP" && x.src === DL_ADDR.RS)) out.push({ label: "Asked", after: `who has ${field(p, "target IP")}? ${p.lost ? "Nobody answered." : "Answered."}` });
  }
  if (n === "DHCP-SRV") {
    for (const { p, h } of hopsAt(lab, n)) {
      if (h.act === "reject") out.push({ label: `${p.msg} arrived`, after: "no DHCP program is running, so the computer replied “nobody is listening here”" });
      else if (h.act === "unanswered") out.push({ label: `${p.msg} arrived via ${field(p, "giaddr")}`, after: "pool 10.10.10.0/24 has no free address: it sent nothing back" });
      else if (h.act === "deliver" && p.msg === "DISCOVER") {
        const offer = ps.find((q) => q.msg === "OFFER");
        out.push({ label: "Decided", before: `request via giaddr ${field(p, "giaddr")}`, after: `pool 10.10.10.0/24 → offer ${field(offer ?? p, "yiaddr")} (router ${field(offer ?? p, "opt 3 router")}, DNS ${field(offer ?? p, "opt 6 DNS")})` });
      } else if (h.act === "deliver" && p.msg === "REQUEST") out.push({ label: "Decided", before: `the laptop accepts ${field(p, "opt 50 requested IP") ?? field(p, "ciaddr")}`, after: "lease recorded for 24 h, confirmation sent" });
      else if (h.act === "deliver" && p.msg === "RELEASE") out.push({ label: "Decided", after: "lease marked free again" });
    }
  }
  if (n === "DNS-SRV") {
    for (const { p, h } of hopsAt(lab, n)) {
      if (h.act === "reject") out.push({ label: "Question arrived", after: "no DNS program is running, so the computer replied “nobody is listening here”" });
      else if (h.act === "deliver" && p.msg === "DNS query") {
        const r = ps.find((q) => q.msg === "DNS response");
        const a = r && field(r, "Answer");
        out.push({ label: "Looked up", before: (field(p, "Question") ?? "").replace(" A IN", ""), after: a ? `${a.split(" A ")[1]}, keep for ${DNS_RECORD_TTL} s` : "no such name (NXDOMAIN)" });
      }
    }
  }
  if (n === "CLIENT") {
    const ack = ps.find((p) => p.msg === "ACK" && p.hops[p.hops.length - 1].node === "CLIENT");
    if (ack) out.push({ label: "Settings", before: "whatever it had before", after: `address ${field(ack, "yiaddr")}, router ${field(ack, "opt 3 router")}, DNS ${field(ack, "opt 6 DNS")}` });
    if (lab.client.phase === "APIPA" && ps.some((p) => p.msg === "DISCOVER")) out.push({ label: "Gave up", after: `no answer after ${ps.filter((p) => p.msg === "DISCOVER" && p.src === "0.0.0.0").length} tries: gave itself ${lab.client.ip}` });
    const resp = ps.find((p) => p.msg === "DNS response" && field(p, "Answer"));
    if (resp) out.push({ label: "Remembered", after: `${field(resp, "Answer")!.replace(" A ", " → ")} for ${DNS_RECORD_TTL} s` });
    for (const p of ps.filter((x) => x.proto === "ARP" && x.src === DL_ADDR.C)) out.push({ label: "Asked", after: `who has ${field(p, "target IP")}? ${p.lost ? "Nobody answered: it can't send through that router." : "R1 answered: it can now send through its router."}` });
  }
  return out;
}

/** Its cables, with what crossed each in the last action (level 3+). */
function cables(lab: DlState, n: Node): { i: DlIface; inN: number; outN: number }[] {
  const ps = recent(lab);
  return DL_NODE_IFACES[n].filter((i) => DL_IFACES[i].peer !== "WEB:eth0" || n === "R1").map((i) => ({ i, inN: ps.reduce((k, p) => k + p.obs.filter((o) => o.iface === i && o.dir === "in").length, 0), outN: ps.reduce((k, p) => k + p.obs.filter((o) => o.iface === i && o.dir === "out").length, 0) }));
}

const Sec = ({ label, children, tone = "muted" }: { label: string; children: ReactNode; tone?: "muted" | "cyan" | "violet" | "warning" }) => (
  <div className="space-y-0.5">
    <p className={clsx("text-[10px] font-bold uppercase tracking-[0.12em]", tone === "cyan" ? "text-pv-cyan-soft" : tone === "violet" ? "text-pv-violet" : tone === "warning" ? "text-pv-warning" : "text-pv-text-faint")}>{label}</p>
    {children}
  </div>
);
const Lines = ({ items }: { items: string[] }) => (
  <ul className="space-y-0.5">
    {items.map((t) => (
      <li key={t} className="text-[12.5px] text-pv-text">
        {t}
      </li>
    ))}
  </ul>
);

export function DeviceCard({ lab, node, level, onClose, onCapture, onFollow, onTables, onTerminal, embedded }: { lab: DlState; node: Node; level: Level; /** Inside the engineering Device tool: no close button, no height cap. */ embedded?: boolean; onClose: () => void; onCapture: (i: DlIface) => void; onFollow: () => void; onTables: () => void; onTerminal: () => void }) {
  const nm = useIfName();
  const role = ROLE[node];
  const conceal = level === 5;
  const now = level >= 2 ? justNow(lab, node) : [];
  const ch = level >= 4 ? changed(lab, node) : [];
  const ran = lab.lastPackets.length > 0 || !!lab.lastResult;
  return (
    <section aria-label={`${node}: device card`} className={clsx("mx-auto max-w-4xl space-y-2 rounded-xl border border-pv-violet/50 bg-pv-bg/95 p-2.5", !embedded && "pv-pop overflow-y-auto lg:max-h-[36vh]")}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[13.5px] font-bold text-pv-text">
            <span className="mr-1">{role.icon}</span>
            {role.title}
          </p>
          <p className="text-[12px] text-pv-text-muted">{role.job}</p>
        </div>
        {!embedded && (
          <button type="button" onClick={onClose} aria-label="Close device card" className="rounded-full border border-pv-border px-2 text-[12px] text-pv-text-faint hover:text-pv-text">
            ✕
          </button>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Sec label="What it knows right now" tone="cyan">
          <Lines items={knows(lab, node, level, conceal)} />
        </Sec>
        {level >= 2 && (
          <Sec label="What it just did">
            {now.length ? <Lines items={now} /> : <p className="text-[12.5px] text-pv-text-muted">{ran ? "Nothing from the last action reached this device." : "Nothing yet: run the step and tap it again."}</p>}
          </Sec>
        )}
      </div>
      {level >= 4 && ch.length > 0 && (
        <Sec label="What it changed or decided" tone="violet">
          <ul className="space-y-0.5">
            {ch.map((c, i) => (
              <li key={i} className="text-[12.5px] text-pv-text">
                <b>{c.label}:</b> {c.before && <span className="text-pv-text-muted">{c.before} → </span>}
                {c.after}
              </li>
            ))}
          </ul>
        </Sec>
      )}
      {level >= 3 && (
        <Sec label="Where you could look here" tone="warning">
          <ul className="flex flex-wrap gap-1.5">
            {cables(lab, node).map(({ i, inN, outN }) => (
              <li key={i}>
                {level >= 5 ? (
                  <button type="button" onClick={() => onCapture(i)} className="rounded-lg border border-pv-warning/50 px-2 py-0.5 text-left text-[12px] text-pv-text hover:bg-pv-warning/10">
                    cable to {DL_IFACES[i].faces} <span className="pv-mono text-pv-text-faint">{nm(i)}</span> · in {inN} · out {outN} · see capture →
                  </button>
                ) : (
                  <span className="inline-block rounded-lg border border-pv-border px-2 py-0.5 text-[12px] text-pv-text">
                    cable to {DL_IFACES[i].faces} <span className="pv-mono text-pv-text-faint">{nm(i)}</span>
                    {ran ? ` · last action: ${inN} in, ${outN} out` : ""}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {level < 5 && <p className="text-[11.5px] text-pv-text-faint">A capture on one of these cables would show exactly these messages{level < 4 ? " (level 4 shows you how to read one)" : ""}.</p>}
        </Sec>
      )}
      {level >= 5 && (
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={onFollow} className="rounded-full border border-pv-cyan/60 px-2.5 py-0.5 text-[12px] font-semibold text-pv-cyan-soft">
            Follow the last message →
          </button>
          {level >= 6 && (
            <>
              <button type="button" onClick={onTables} className="rounded-full border border-pv-violet/60 px-2.5 py-0.5 text-[12px] font-semibold text-pv-text">
                Its tables, status and logs →
              </button>
              <button type="button" onClick={onTerminal} className="rounded-full border border-pv-border px-2.5 py-0.5 text-[12px] font-semibold text-pv-text-muted hover:text-pv-text">
                Open its terminal →
              </button>
            </>
          )}
        </div>
      )}
      {level >= 6 && (
        <Sec label="Questions this device answers">
          <ul className="space-y-0.5">
            {QUESTION_MAP.filter((q) => q.node === node).map((q) => (
              <li key={q.q} className="text-[12px] text-pv-text">
                {q.q} <span className="pv-mono text-[11px] text-pv-text-faint">{q.cmd}</span>
              </li>
            ))}
            {(node === "SW2" ? ["Did the relayed request or the DNS question reach the server's cable? → its MAC table and port counters, or a capture on that port"] : []).map((t) => (
              <li key={t} className="text-[12px] text-pv-text">
                {t}
              </li>
            ))}
          </ul>
        </Sec>
      )}
    </section>
  );
}

export type { DlHop };
