"use client";

import { clsx } from "clsx";
import { useState, type ReactNode } from "react";
import type { CliVendor } from "@/lib/cli/types";
import { HOST_IP, LC_HOSTS, LC_MEMBERS, pk, type LcAction, type LcHost, type LcRun, type LcState, type LcSw } from "@/lib/sim-engine/scenarios/lacpNet";
import { lcPortName, lcVendorText } from "./lcNames";
import { decisionLine } from "./lcMoments";
import { StateBadge } from "./LcDevices";

/**
 * Evidence panels of the LACP Lab — each reads the lab state (or one run) and nothing else:
 *   BundleView  every uplink port at both ends: group, mode, state, why — and the logical links that result
 *   Flows       each flow of a run: which member it used out and back, and the hash that chose it
 *   Journey     every switch decision and host verdict, hop by hop
 *   Composer    traffic, LACPDUs, cables, silent failures, time
 *   ladder      the troubleshooting questions, each answered from evidence
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
const MODE: Record<string, string> = { active: "active", passive: "passive", on: "on (static)", off: "—" };
export function BundleView({ s, vendor }: { s: LcState; vendor: CliVendor }) {
  return (
    <div className="space-y-1.5">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-left text-[12px]">
          <thead className="text-[11px] text-pv-text-faint">
            <tr>
              <th className="px-1.5 py-1">cable</th>
              {(["SW1", "SW2"] as LcSw[]).map((sw) => (
                <th key={sw} className="px-1.5 py-1">
                  {sw}: group · mode · state
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {LC_MEMBERS.map((m) => (
              <tr key={m} className="border-t border-pv-border/50">
                <td className="pv-mono px-1.5 py-1 text-pv-text">{lcPortName(vendor, m)}</td>
                {(["SW1", "SW2"] as LcSw[]).map((sw) => {
                  const mc = s.cfg.sw[sw].members[m];
                  return (
                    <td key={sw} className="px-1.5 py-1 text-pv-text-muted">
                      {!s.cfg.cables[m] ? (
                        <span className="text-pv-text-faint">no cable</span>
                      ) : (
                        <>
                          <span className="pv-mono">{mc.mode === "off" ? "—" : `${lcPortName(vendor, `Po${mc.group}`)} ${MODE[mc.mode]}${mc.fast ? " fast" : ""}`}</span> <StateBadge s={s} sw={sw} m={m} />
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="space-y-0.5 text-[12px]">
        {s.bundle.logical.length === 0 && <li className="font-semibold text-pv-danger">No working link between the switches.</li>}
        {s.bundle.logical.map((l) => (
          <li key={l.id} className={l.stp === "fwd" ? "text-pv-success" : "text-pv-warning"}>
            {l.kind === "po" ? `${lcPortName(vendor, l.ends.SW1)} ⇄ ${lcPortName(vendor, l.ends.SW2)}: ${l.members.length} member${l.members.length > 1 ? "s" : ""} (${l.members.length} Gb/s)` : `${lcPortName(vendor, l.id)}: a single link`} · STP {l.stp === "fwd" ? "forwarding" : "blocked"}
          </li>
        ))}
        {LC_MEMBERS.filter((m) => s.cfg.cables[m]).map((m) => {
          const why = [s.bundle.members[pk("SW1", m)], s.bundle.members[pk("SW2", m)]].find((x) => x.state === "suspended" || x.state === "errdis");
          return why ? (
            <li key={`w${m}`} className="text-pv-danger">
              {lcPortName(vendor, m)}: {why.why}
            </li>
          ) : null;
        })}
      </ul>
    </div>
  );
}
export function Flows({ run, vendor }: { run: LcRun; vendor: CliVendor }) {
  const hashes = run.waves.flatMap((w) => w.decisions).flatMap((d) => d.out.filter((o) => o.hash).map((o) => ({ sw: d.sw, f: d.frame, o })));
  return (
    <div className="space-y-1">
      {run.results.length ? (
        <table className="w-full text-left text-[12px]">
          <tbody>
            {run.results.map((r, i) => (
              <tr key={i} className="border-t border-pv-border/50">
                <td className="px-1.5 py-0.5 font-semibold text-pv-text">
                  {r.send.from.replace("HOST-", "")} → {r.send.to.replace("HOST-", "")}
                </td>
                <td className="pv-mono px-1.5 py-0.5 text-pv-text-muted">
                  .{HOST_IP[r.send.from].split(".")[3]} → .{HOST_IP[r.send.to].split(".")[3]}
                </td>
                <td className={clsx("pv-mono px-1.5 py-0.5", r.replied ? "text-pv-success" : "text-pv-danger")}>{r.replied ? `out ${lcPortName(vendor, r.memberOut ?? "—")} · back ${lcPortName(vendor, r.memberBack ?? "—")}` : `FAILED${r.memberOut ? ` (on ${lcPortName(vendor, r.memberOut)})` : ""}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-[12.5px] text-pv-text-faint">No flows in this run.</p>
      )}
      {hashes.length > 0 && (
        <ul className="pv-mono space-y-0.5 text-[11.5px] text-pv-text-muted">
          {hashes.slice(0, 6).map((h, i) => (
            <li key={i}>
              {h.sw} {h.f.kind}: {lcVendorText(vendor, h.o.hash!)}
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11.5px] text-pv-text-muted">Modeled hash: (last octet of source + last octet of destination) mod number-of-members. One flow, one member — so one flow never gets more than one cable&apos;s bandwidth; many flows spread out.</p>
    </div>
  );
}
export function Journey({ run, vendor, max = 40 }: { run: LcRun; vendor: CliVendor; max?: number }) {
  const rows: { hop: number; who: string; text: string; tone: "ok" | "warn" | "bad" | "plain" }[] = [];
  run.waves.forEach((w, i) => {
    for (const d of w.decisions) {
      const l = decisionLine(d);
      rows.push({ hop: i + 1, who: d.sw, text: l.text.replace(/^SW\d /, ""), tone: l.tone === "bad" ? "bad" : d.kind === "known" ? "ok" : "warn" });
    }
    for (const r of w.rx) rows.push({ hop: i + 1, who: r.dev, text: r.why.replace(new RegExp(`^${r.dev}( ge-0/0/\\d+)?: `), ""), tone: r.ok ? "ok" : "plain" });
  });
  return (
    <div className="max-h-[360px] overflow-y-auto">
      <table className="w-full text-left text-[12px]">
        <tbody>
          {rows.slice(0, max).map((r, i) => (
            <tr key={i} className="border-t border-pv-border/40 align-top">
              <td className="pv-mono px-1.5 py-0.5 text-pv-text-faint">{r.hop}</td>
              <td className="whitespace-nowrap px-1.5 py-0.5 font-semibold text-pv-text">{r.who.replace("HOST-", "")}</td>
              <td className={clsx("px-1.5 py-0.5", r.tone === "ok" ? "text-pv-success" : r.tone === "warn" ? "text-pv-warning" : r.tone === "bad" ? "text-pv-danger" : "text-pv-text-muted")}>{lcVendorText(vendor, r.text)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function Composer({ s, act, busy }: { s: LcState; act: (a: LcAction) => void; busy: boolean }) {
  const [from, setFrom] = useState<LcHost>("HOST-A");
  const [to, setTo] = useState<LcHost>("HOST-B");
  const dst = to === from ? LC_HOSTS.find((h) => h !== from)! : to;
  const sel = "rounded-md border border-pv-border bg-pv-bg px-1.5 py-0.5 text-[12px] text-pv-text";
  const b = "rounded-full border border-pv-border px-2.5 py-0.5 text-[12px] font-semibold text-pv-text-muted hover:border-pv-cyan/60 hover:text-pv-text disabled:opacity-40";
  return (
    <Card title="Generate traffic · run the network">
      <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-pv-text-muted">
        <select aria-label="From" className={sel} value={from} onChange={(e) => setFrom(e.target.value as LcHost)}>
          {LC_HOSTS.map((h) => (
            <option key={h}>{h}</option>
          ))}
        </select>
        pings
        <select aria-label="To" className={sel} value={dst} onChange={(e) => setTo(e.target.value as LcHost)}>
          {LC_HOSTS.filter((h) => h !== from).map((h) => (
            <option key={h}>{h}</option>
          ))}
        </select>
        <button type="button" className={clsx(b, "border-pv-cyan/60 text-pv-text")} disabled={busy} onClick={() => act({ type: "traffic", sends: [{ from, to: dst, kind: "ping" }] })}>
          Send ▶
        </button>
        <button type="button" className={b} disabled={busy} onClick={() => act({ type: "traffic", sends: [{ from: "HOST-A", to: "HOST-B", kind: "ping" }, { from: "HOST-A", to: "HOST-C", kind: "ping" }, { from: "HOST-D", to: "HOST-B", kind: "ping" }, { from: "HOST-D", to: "HOST-C", kind: "ping" }], cmd: "Four flows across the uplink" })}>
          Four flows ▶
        </button>
        <button type="button" className={b} disabled={busy} onClick={() => act({ type: "lacp" })}>
          LACPDUs ▶
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {LC_MEMBERS.map((m) => (
          <button key={m} type="button" className={b} disabled={busy} onClick={() => act({ type: "cable", member: m, up: !s.cfg.cables[m] })}>
            {s.cfg.cables[m] ? `Unplug ${m}` : `Plug ${m}`}
          </button>
        ))}
        {LC_MEMBERS.filter((m) => s.cfg.cables[m]).map((m) => (
          <button key={`s${m}`} type="button" className={b} disabled={busy} onClick={() => act({ type: "silent", member: m, on: s.silent[m] === undefined })}>
            {s.silent[m] === undefined ? `Silent failure on ${m}` : `Repair ${m}`}
          </button>
        ))}
        <button type="button" className={b} disabled={busy} onClick={() => act({ type: "wait", seconds: 5 })}>
          Wait 5 s
        </button>
        <button type="button" className={b} disabled={busy} onClick={() => act({ type: "wait", seconds: 90 })}>
          Wait 90 s
        </button>
      </div>
    </Card>
  );
}
export function ladder(s: LcState, vendor: CliVendor, run?: LcRun): { k: string; title: string; text: string }[] {
  const c = s.cfg;
  const n = (p: string) => lcPortName(vendor, p);
  const res = run?.results ?? [];
  const side = (sw: LcSw) => LC_MEMBERS.filter((m) => c.cables[m]).map((m) => `${n(m)} ${c.sw[sw].members[m].mode === "off" ? "no group" : `${n(`Po${c.sw[sw].members[m].group}`)} ${c.sw[sw].members[m].mode}`} → ${s.bundle.members[pk(sw, m)].state}`).join(", ");
  return [
    { k: "what", title: "What fails — everything across the uplink, or only some flows?", text: !run ? "Reproduce the problem first." : res.map((r) => `${r.send.from} → ${r.send.to}: ${r.replied ? `ok (out ${r.memberOut ?? "—"}, back ${r.memberBack ?? "—"})` : `FAILED — ${r.fail}`}`).join(" · ") },
    { k: "cables", title: "Are the cables physically up?", text: LC_MEMBERS.map((m) => `${n(m)} ${!c.cables[m] ? "no cable" : s.silent[m] !== undefined ? "link UP (but nothing arrives!)" : "up"}`).join(" · ") },
    { k: "sw1", title: "What did SW1 make of each port? (show etherchannel summary / show lacp interfaces)", text: side("SW1") },
    { k: "sw2", title: "And SW2?", text: side("SW2") },
    { k: "lacp", title: "Does LACP talk on each member, and with which partner?", text: LC_MEMBERS.filter((m) => c.cables[m]).map((m) => { const a = s.bundle.members[pk("SW1", m)]; return `${n(m)}: ${a.lacp ? `partner group ${a.partnerGroup}` : "no LACPDUs exchanged"}`; }).join(" · ") },
    { k: "stp", title: "What does spanning tree see between the switches?", text: s.bundle.logical.map((l) => `${l.kind === "po" ? n(l.ends.SW1) : n(l.id)} (${l.kind === "po" ? `${l.members.length} members` : "single"}) ${l.stp === "fwd" ? "forwarding" : "BLOCKED"}`).join(" · ") || "no working link" },
    { k: "rate", title: "How fast would LACP notice a silent member?", text: (["SW1", "SW2"] as LcSw[]).map((sw) => `${sw}: ${LC_MEMBERS.filter((m) => c.cables[m] && c.sw[sw].members[m].mode !== "off").map((m) => `${n(m)} ${c.sw[sw].members[m].fast ? "3 s (fast)" : "90 s (slow)"}`).join(", ") || "—"}`).join(" · ") },
  ];
}
