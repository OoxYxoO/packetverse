"use client";

import { clsx } from "clsx";
import { useState, type ReactNode } from "react";
import type { CliVendor } from "@/lib/cli/types";
import { BCAST, RTR_PORT, TRUNK, VL_HOSTS, isSw, vlIpOwner, vlMacName, vlPortUp, vlPortVlans, vlShortMac, vlTable, vlanName, type VlAction, type VlCfg, type VlHop, type VlHost, type VlRun, type VlSend, type VlSnap, type VlState, type VlSw } from "@/lib/sim-engine/scenarios/vlanNet";
import { r1IfName, vlPortName, vlVendorText } from "./vlNames";
import { decisionLine, vlanColor } from "./vlMoments";
import { VTag } from "./VlDevices";

/**
 * Evidence panels of the VLAN Lab — each reads the lab state (or one run of it) and nothing else:
 *   Membership   which VLAN every port is in, per switch, and which VLANs each trunk carries
 *   Reach        who received a broadcast — the shape of a VLAN, measured
 *   Anatomy      one frame, link by link: untagged on the access port, tagged on the trunk, untagged again
 *   Journey      every switch's decision (classify → learn → look up in that VLAN → forward), every host's verdict
 *   VlanTables   the two switches' tables, VLAN by VLAN, side by side
 *   Composer     generate traffic; clear tables
 *   ladder       the troubleshooting questions, each answered from evidence
 */

export const Card = ({ title, children, tone = "plain", right }: { title: string; children: ReactNode; tone?: "plain" | "ok" | "warn" | "bad"; right?: ReactNode }) => (
  <div className={clsx("space-y-1.5 rounded-2xl border p-3", tone === "ok" ? "border-pv-success/50 bg-pv-success/[0.06]" : tone === "warn" ? "border-pv-warning/50 bg-pv-warning/[0.06]" : tone === "bad" ? "border-pv-danger/50 bg-pv-danger/[0.05]" : "border-pv-border bg-pv-bg-elevated/30")}>
    <div className="flex items-center justify-between gap-2">
      <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-pv-text-faint">{title}</p>
      {right}
    </div>
    {children}
  </div>
);
const L = (h: string) => h.replace("HOST-", "");
const hostVlan = (cfg: VlCfg, h: VlHost): number | undefined => {
  const at = cfg.hosts[h].at;
  if (!at) return undefined;
  const p = cfg.sw[at.sw].ports[at.port];
  return p.mode === "access" ? p.access : undefined;
};

/** Every port's VLAN, and what each trunk carries. */
export function Membership({ cfg, vendor }: { cfg: VlCfg; vendor: CliVendor }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {(["SW1", "SW2"] as VlSw[]).map((sw) => (
        <div key={sw} className="space-y-0.5">
          <p className="text-[12px] font-semibold text-pv-text">{sw}</p>
          {(["ge-0/0/1", "ge-0/0/2", "ge-0/0/3", RTR_PORT, TRUNK] as const).filter((p) => sw === "SW2" || p !== RTR_PORT).map((p) => {
            const pc = cfg.sw[sw].ports[p];
            const h = VL_HOSTS.find((x) => cfg.hosts[x].at?.sw === sw && cfg.hosts[x].at?.port === p);
            const leads = p === TRUNK ? (sw === "SW1" ? "SW2" : "SW1") : p === RTR_PORT ? "R1" : (h ?? "—");
            return (
              <div key={p} className="flex flex-wrap items-center gap-1 text-[12px]">
                <span className="pv-mono w-[72px] shrink-0 text-pv-text-muted">{vlPortName(vendor, p)}</span>
                <span className="w-[52px] shrink-0 text-pv-text-faint">{leads.replace("HOST-", "host ")}</span>
                {pc.mode === "access" ? (
                  <span className="rounded px-1 text-[11px] font-bold text-[#03131a]" style={{ background: vlanColor(pc.access) }}>
                    access {pc.access}
                  </span>
                ) : (
                  <>
                    <span className="text-[11px] text-pv-text-faint">trunk</span>
                    {vlPortVlans(cfg, sw, p).map((v) => (
                      <span key={v} className={clsx("rounded px-1 text-[11px] font-bold", v === pc.native ? "border border-dashed" : "text-[#03131a]")} style={v === pc.native ? { borderColor: vlanColor(v), color: vlanColor(v) } : { background: vlanColor(v) }}>
                        {v}
                        {v === pc.native ? " native" : ""}
                      </span>
                    ))}
                  </>
                )}
                {!vlPortUp(cfg, sw, p) && <span className="text-[11px] text-pv-text-faint">(down)</span>}
              </div>
            );
          })}
        </div>
      ))}
      <p className="text-[11.5px] text-pv-text-muted sm:col-span-2">Solid = tagged with that VID on the trunk · dashed = the native VLAN, sent untagged.</p>
    </div>
  );
}

/** Who received each broadcast of the run. */
export function Reach({ cfg, run }: { cfg: VlCfg; run: VlRun }) {
  const rx = run.waves.flatMap((w) => w.rx);
  const bcasts = [...new Map(run.waves.flatMap((w) => w.hops).filter((h) => h.frame.dst === BCAST).map((h) => [h.frame.id, h.frame])).values()];
  if (!bcasts.length) return <p className="text-[12.5px] text-pv-text-faint">No broadcast in this run.</p>;
  return (
    <div className="space-y-1.5">
      {bcasts.slice(0, 3).map((f) => {
        const v = isSw(f.from) || f.from === "R1" ? undefined : hostVlan(cfg, f.from as VlHost);
        const got = new Set(rx.filter((r) => r.frame.id === f.id).map((r) => r.dev));
        return (
          <div key={f.id} className="space-y-0.5">
            <p className="text-[12px] text-pv-text">
              {L(f.from)}&apos;s ARP request (who has {f.dip}?){v !== undefined ? ` — sent in VLAN ${v}` : ""}
            </p>
            <div className="flex flex-wrap gap-1">
              {[...VL_HOSTS, "R1" as const].filter((d) => d !== f.from).map((d) => {
                const hv = d === "R1" ? undefined : hostVlan(cfg, d);
                const yes = got.has(d);
                return (
                  <span key={d} className={clsx("rounded-full border px-2 py-0.5 text-[11.5px] font-semibold", yes ? "text-pv-text" : "border-pv-border text-pv-text-faint line-through")} style={yes ? { borderColor: hv !== undefined ? vlanColor(hv) : "#f59e0b" } : undefined}>
                    {yes ? "✓" : "✕"} {L(d)}
                    {hv !== undefined ? ` · V${hv}` : ""}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
      <p className="text-[11.5px] text-pv-text-muted">A broadcast reaches every port of ITS VLAN — on both switches — and nothing else. That set of devices is the VLAN.</p>
    </div>
  );
}

/** One frame, link by link, with the tag it carried on each. */
export function Anatomy({ cfg, run, vendor, pick = "first-cross" }: { cfg: VlCfg; run: VlRun; vendor: CliVendor; pick?: "first-cross" | "echo" }) {
  const hops = run.waves.flatMap((w) => w.hops);
  const crosses = (id: number) => hops.some((h) => h.frame.id === id && isSw(h.from) && (isSw(h.to) || h.to === "R1"));
  const ids = [...new Set(hops.map((h) => h.frame.id))];
  const id = (pick === "echo" ? ids.find((i) => hops.find((h) => h.frame.id === i)!.frame.kind === "echo" && crosses(i)) : undefined) ?? ids.find((i) => crosses(i)) ?? ids[0];
  if (id === undefined) return <p className="text-[12.5px] text-pv-text-faint">No frame in this run.</p>;
  const path: VlHop[] = [];
  // Follow the copy that went furthest toward the destination: one hop per link, in order.
  const mine = hops.filter((h) => h.frame.id === id);
  let cur: VlHop | undefined = mine[0];
  const seen = new Set<string>();
  while (cur && path.length < 8) {
    path.push(cur);
    seen.add(`${cur.from}${cur.fromPort}`);
    const here: VlHop = cur;
    cur = mine.find((h) => h.from === here.to && !seen.has(`${h.from}${h.fromPort}`) && (isSw(h.to) || h.to === "R1" || h.frame.dst !== BCAST || h.to === mine[mine.length - 1].to)) ?? mine.find((h) => h.from === here.to && !seen.has(`${h.from}${h.fromPort}`));
  }
  const f = mine[0].frame;
  const port = (d: string, p: string) => (isSw(d) ? vlPortName(vendor, p) : d === "R1" ? r1IfName(vendor) : "eth0");
  return (
    <div className="space-y-1.5">
      <p className="text-[12px] text-pv-text">
        {L(f.from)} → {f.dst === BCAST ? "broadcast" : L(vlMacName(cfg, f.dst))}: {f.kind === "arp-req" ? "ARP request" : f.kind === "arp-rep" ? "ARP reply" : f.kind === "echo" ? `ping ${f.sip} → ${f.dip}` : "ping reply"}
      </p>
      <ol className="space-y-1">
        {path.map((h, i) => (
          <li key={i} className="flex flex-wrap items-center gap-1.5 text-[12px]">
            <span className="pv-mono w-4 text-pv-text-faint">{i + 1}</span>
            <span className="pv-mono text-pv-text">
              {L(h.from)} {port(h.from, h.fromPort)} → {L(h.to)} {port(h.to, h.toPort)}
            </span>
            <span className="pv-mono flex items-center gap-0.5 rounded border border-pv-border px-1 text-[11px] text-pv-text-muted">
              dst {vlShortMac(h.frame.dst)} · src {vlShortMac(h.frame.src)} · <VTag v={h.vid} /> · {h.frame.kind.startsWith("arp") ? "0x0806" : "0x0800"}
              {!h.frame.kind.startsWith("arp") ? ` · TTL ${h.frame.ttl}` : ""}
            </span>
          </li>
        ))}
      </ol>
      <p className="text-[11.5px] text-pv-text-muted">The MAC addresses stay the same between switches; only the tag appears on the trunk and disappears at the access port. A router (R1) is different: it builds a NEW frame — new MACs, new tag, TTL −1.</p>
    </div>
  );
}

/** Every decision and verdict of the run, hop by hop. */
export function Journey({ cfg, run, vendor, max = 40 }: { cfg: VlCfg; run: VlRun; vendor: CliVendor; max?: number }) {
  const rows: { hop: number; who: string; text: string; tone: "ok" | "warn" | "bad" | "plain" }[] = [];
  run.waves.forEach((w) => {
    for (const n of w.notes) rows.push({ hop: w.k + 1, who: n.dev, text: n.text, tone: n.tone === "bad" ? "bad" : n.tone === "ok" ? "ok" : "plain" });
    for (const d of w.decisions) {
      const l = decisionLine(cfg, d);
      rows.push({ hop: w.k + 1, who: d.sw, text: l.text.replace(/^SW\d /, ""), tone: l.tone === "bad" ? "bad" : d.kind === "known" ? "ok" : "warn" });
    }
    for (const r of w.rx) rows.push({ hop: w.k + 1, who: r.dev === "R1" && r.unit !== undefined ? `R1 .${r.unit}` : r.dev, text: r.why, tone: !r.accepted ? (/TAGGED|VID/.test(r.why) ? "bad" : "plain") : /no answer|ignored/.test(r.why) ? "plain" : "ok" });
  });
  return (
    <div className="max-h-[360px] overflow-y-auto">
      <table className="w-full text-left text-[12px]">
        <tbody>
          {rows.slice(0, max).map((r, i) => (
            <tr key={i} className="border-t border-pv-border/40 align-top">
              <td className="pv-mono px-1.5 py-0.5 text-pv-text-faint">{r.hop}</td>
              <td className="whitespace-nowrap px-1.5 py-0.5 font-semibold text-pv-text">{L(r.who)}</td>
              <td className={clsx("px-1.5 py-0.5", r.tone === "ok" ? "text-pv-success" : r.tone === "warn" ? "text-pv-warning" : r.tone === "bad" ? "text-pv-danger" : "text-pv-text-muted")}>{vlVendorText(vendor, r.text)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > max && <p className="pt-1 text-[11.5px] text-pv-text-faint">… {rows.length - max} more lines.</p>}
    </div>
  );
}

/** Both tables, VLAN by VLAN. */
export function VlanTables({ cfg, snap, vendor }: { cfg: VlCfg; snap: VlSnap; vendor: CliVendor }) {
  const vlans = [...new Set([...vlTable(snap.fdb, "SW1"), ...vlTable(snap.fdb, "SW2")].map((e) => e.vlan))].sort((a, b) => a - b);
  if (!vlans.length) return <p className="text-[12.5px] text-pv-text-faint">Both tables are empty.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[400px] text-left text-[12px]">
        <thead className="text-[11px] text-pv-text-faint">
          <tr>
            <th className="px-1.5 py-1">VLAN</th>
            <th className="px-1.5 py-1">SW1 knows</th>
            <th className="px-1.5 py-1">SW2 knows</th>
          </tr>
        </thead>
        <tbody>
          {vlans.map((v) => (
            <tr key={v} className="border-t border-pv-border/50 align-top">
              <td className="pv-mono px-1.5 py-1 font-bold" style={{ color: vlanColor(v) }}>
                {v} <span className="font-sans text-[11px] font-normal text-pv-text-faint">{vlanName(v, cfg, "SW1")}</span>
              </td>
              {(["SW1", "SW2"] as VlSw[]).map((sw) => (
                <td key={sw} className="pv-mono px-1.5 py-1 text-pv-text-muted">
                  {vlTable(snap.fdb, sw, v).map((e) => `${L(vlMacName(cfg, e.mac))} → ${vlPortName(vendor, e.port)}`).join(" · ") || "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Generate traffic; clear tables. */
export function Composer({ s, act, busy }: { s: VlState; act: (a: VlAction) => void; busy: boolean }) {
  const hosts = VL_HOSTS.filter((h) => s.cfg.hosts[h].at && s.cfg.hosts[h].ip);
  const targets = [...VL_HOSTS.map((h) => ({ id: h, ip: s.cfg.hosts[h].ip })), ...s.cfg.r1.subs.map((x) => ({ id: `R1 .${x.unit}`, ip: x.ip }))].filter((t) => t.ip);
  const [from, setFrom] = useState<VlHost>("HOST-A");
  const [to, setTo] = useState("192.168.10.12");
  const [kind, setKind] = useState<VlSend["kind"]>("ping");
  const src = hosts.includes(from) ? from : hosts[0];
  const dst = targets.some((t) => t.ip === to) && to !== s.cfg.hosts[src]?.ip ? to : targets.find((t) => t.ip !== s.cfg.hosts[src]?.ip)?.ip;
  const sel = "rounded-md border border-pv-border bg-pv-bg px-1.5 py-0.5 text-[12px] text-pv-text";
  const b = "rounded-full border border-pv-border px-2.5 py-0.5 text-[12px] font-semibold text-pv-text-muted hover:border-pv-cyan/60 hover:text-pv-text disabled:opacity-40";
  return (
    <Card title="Generate traffic">
      {src && dst ? (
        <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-pv-text-muted">
          <select aria-label="From" className={sel} value={src} onChange={(e) => setFrom(e.target.value as VlHost)}>
            {hosts.map((h) => (
              <option key={h}>{h}</option>
            ))}
          </select>
          <select aria-label="What" className={sel} value={kind} onChange={(e) => setKind(e.target.value as VlSend["kind"])}>
            <option value="ping">pings</option>
            <option value="arp">broadcasts an ARP request for</option>
          </select>
          <select aria-label="To" className={sel} value={dst} onChange={(e) => setTo(e.target.value)}>
            {targets.filter((t) => t.ip !== s.cfg.hosts[src].ip).map((t) => (
              <option key={t.id} value={t.ip}>
                {t.ip} ({t.id})
              </option>
            ))}
          </select>
          <button type="button" className={clsx(b, "border-pv-cyan/60 text-pv-text")} disabled={busy} onClick={() => act({ type: "traffic", sends: [{ from: src, to: dst, kind }] })}>
            Send ▶
          </button>
        </div>
      ) : (
        <p className="text-[12.5px] text-pv-text-faint">No host is plugged in with an address.</p>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {(["SW1", "SW2"] as VlSw[]).map((sw) => (
          <button key={sw} type="button" className={b} disabled={busy} onClick={() => act({ type: "clear", sw })}>
            Clear {sw}&apos;s table
          </button>
        ))}
        <button type="button" className={b} disabled={busy} onClick={() => ([...VL_HOSTS, "R1"] as const).forEach((d) => act({ type: "clear-arp", dev: d }))}>
          Clear every ARP cache
        </button>
        <button type="button" className={b} disabled={busy} onClick={() => act({ type: "wait", seconds: 300 })}>
          Wait 5 min
        </button>
      </div>
    </Card>
  );
}

/** The troubleshooting questions, in order, each answered from what the lab shows right now. */
export function ladder(s: VlState, vendor: CliVendor, run?: VlRun): { k: string; title: string; text: string }[] {
  const c = s.cfg;
  const n = (p: string) => vlPortName(vendor, p);
  const res = run?.results ?? [];
  const failed = res.filter((r) => !r.replied && r.send.kind === "ping");
  const vl = (h: VlHost) => {
    const at = c.hosts[h].at;
    if (!at) return "unplugged";
    const p = c.sw[at.sw].ports[at.port];
    return `${at.sw} ${n(at.port)} = ${p.mode === "access" ? `VLAN ${p.access}` : "a trunk"} · ${c.hosts[h].ip}/${c.hosts[h].prefix} gw ${c.hosts[h].gw || "none"}`;
  };
  const caps = run ? s.captures.filter((x) => x.run === run.id) : [];
  const onTrunk = (sw: VlSw, port: string) => {
    const xs = caps.filter((x) => x.point === `${sw} ${port}`);
    const tags = [...new Set(xs.map((x) => (x.vid === undefined ? "untagged" : `VID ${x.vid}`)))];
    return xs.length ? `${xs.filter((x) => x.dir === "out").length} out / ${xs.filter((x) => x.dir === "in").length} in · ${tags.join(", ")}` : "nothing";
  };
  const mac = (sw: VlSw) => VL_HOSTS.map((h) => { const e = s.fdb[sw].filter((x) => x.mac === c.hosts[h].mac); return `${L(h)} ${e.length ? e.map((x) => `V${x.vlan}→${n(x.port)}`).join("/") : "?"}`; }).join(", ");
  const t1 = c.sw.SW1.ports[TRUNK];
  const t2 = c.sw.SW2.ports[TRUNK];
  const r = c.sw.SW2.ports[RTR_PORT];
  const drops = run ? Object.entries(s.counters).filter(([, v]) => v.drops > 0).map(([k, v]) => `${k === "R1" ? `R1 ${r1IfName(vendor)}` : `${k.split(" ")[0]} ${n(k.split(" ")[1])}`} ${v.drops}`) : [];
  return [
    { k: "who", title: "What exactly fails — same VLAN or between VLANs?", text: !run ? "Reproduce the problem first." : failed.length ? failed.map((x) => { const owner = vlIpOwner(c, x.send.to); const same = owner && owner !== "R1" && c.hosts[owner as VlHost] && c.hosts[x.send.from as VlHost]?.ip.split(".").slice(0, 3).join(".") === x.send.to.split(".").slice(0, 3).join("."); return `${x.send.from} → ${x.send.to}${owner ? ` (${owner})` : ""}: ${same ? "same subnet — switches only" : "another subnet — through the gateway R1"}`; }).join(" · ") : "Everything in the last test worked." },
    { k: "hosts", title: "Which VLAN is each host's port in — does it match its subnet?", text: VL_HOSTS.map((h) => `${h}: ${vl(h)}`).join(" · ") },
    { k: "tables", title: "In which VLAN did each switch learn each host?", text: `SW1: ${mac("SW1")}. SW2: ${mac("SW2")}.` },
    { k: "trunk", title: "Does the SW1↔SW2 trunk carry the VLAN at BOTH ends — with the same native VLAN?", text: `SW1 ${n(TRUNK)}: ${t1.mode}${t1.mode === "trunk" ? `, allowed ${t1.allowed.join(",")}, native ${t1.native}` : ""} · SW2 ${n(TRUNK)}: ${t2.mode}${t2.mode === "trunk" ? `, allowed ${t2.allowed.join(",")}, native ${t2.native}` : ""}. Captured on it in the last run: SW1 side ${onTrunk("SW1", TRUNK)}.` },
    { k: "router", title: "Does each VLAN reach R1 — tagged with the VID its subinterface expects?", text: `SW2 ${n(RTR_PORT)}: ${r.mode}${r.mode === "trunk" ? `, allowed ${r.allowed.join(",")}` : ""} · captured: ${onTrunk("SW2", RTR_PORT)} · R1: ${c.r1.subs.map((x) => `${r1IfName(vendor, x.unit)} VID ${x.vid} ${x.ip}${x.shut ? " (down)" : ""}`).join(", ")}.` },
    { k: "drops", title: "Did any port drop frames it doesn't carry?", text: drops.length ? `Input drops: ${drops.join(" · ")}.` : "No port dropped anything." },
  ];
}
