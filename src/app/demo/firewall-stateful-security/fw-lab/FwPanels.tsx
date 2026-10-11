"use client";

import { clsx } from "clsx";
import { useState, type ReactNode } from "react";
import type { CliVendor } from "@/lib/cli/types";
import { FW_HOSTS, FW_ZONES, HOST_IP, OBJECTS, PUBLIC, hitKey, snatAddr, type FwAction, type FwHost, type FwNet, type FwRun, type FwSendKind, type FwZone } from "@/lib/sim-engine/scenarios/fwNet";
import { JUNOS_APP, fwVendorText, zoneName } from "./fwNames";

/**
 * Evidence panels of the Firewall Lab — each reads the lab state (or one run) and nothing else:
 *   Policies   every rule per zone pair, in evaluation order, with its hit count and the implicit deny
 *   Sessions   FW1's session table: as sent / after NAT, the rule that created it, TCP state
 *   Pipeline   what FW1 decided for each packet of a run, step by step (session → NAT → route → policy → NAT)
 *   NatView    source NAT per zone, destination NAT
 *   Journey    every decision of a run, hop by hop
 *   Composer   connections, pings, a stray segment, clearing sessions
 *   ladder     the troubleshooting questions, each answered from evidence
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
export const pairsInUse = (s: FwNet): [FwZone, FwZone][] =>
  FW_ZONES.flatMap((f) => FW_ZONES.filter((t) => t !== f).map((t) => [f, t] as [FwZone, FwZone])).filter(([f, t]) => s.cfg.rules.some((r) => r.from === f && r.to === t) || (s.hits[hitKey(f, t)] ?? 0) > 0);
export function Policies({ s, vendor, only }: { s: FwNet; vendor: CliVendor; only?: [FwZone, FwZone] }) {
  const pairs = only ? [only] : pairsInUse(s);
  return (
    <div className="space-y-2 text-[12px]">
      {pairs.map(([f, t]) => {
        const rs = s.cfg.rules.filter((r) => r.from === f && r.to === t);
        return (
          <div key={`${f}${t}`}>
            <p className="font-semibold text-pv-text">
              {zoneName(vendor, f)} → {zoneName(vendor, t)}
            </p>
            <table className="w-full text-left">
              <tbody className="pv-mono">
                {rs.map((r, i) => (
                  <tr key={r.name} className={clsx("border-t border-pv-border/40", r.action === "deny" ? "text-pv-warning" : "text-pv-text-muted")}>
                    <td className="w-5 px-1 py-0.5 text-pv-text-faint">{i + 1}</td>
                    <td className="px-1 py-0.5 font-semibold text-pv-text">{r.name}</td>
                    <td className="px-1 py-0.5">
                      {r.src.join(",") || "∅"} → {r.dst.join(",") || "∅"}
                    </td>
                    <td className="px-1 py-0.5">{vendor === "juniper" ? JUNOS_APP[r.app] : r.app}</td>
                    <td className="px-1 py-0.5">{r.action === "permit" ? (vendor === "cisco" ? "inspect" : "permit") : vendor === "cisco" ? "drop" : "deny"}</td>
                    <td className="px-1 py-0.5 text-right text-pv-text-faint">{s.hits[hitKey(f, t, r.name)] ?? 0} hits</td>
                  </tr>
                ))}
                <tr className="border-t border-pv-border/40 text-pv-text-faint">
                  <td className="px-1 py-0.5">{rs.length + 1}</td>
                  <td className="px-1 py-0.5" colSpan={4}>
                    {vendor === "cisco" ? "class-default → drop" : "default policy → deny-all"} (implicit)
                  </td>
                  <td className="px-1 py-0.5 text-right">{s.hits[hitKey(f, t)] ?? 0} hits</td>
                </tr>
              </tbody>
            </table>
          </div>
        );
      })}
      <p className="text-[11.5px] text-pv-text-muted">Top to bottom, per zone pair: the first rule that matches decides. Objects: {Object.entries(OBJECTS).map(([k, v]) => `${k} ${v}`).join(" · ")}.</p>
    </div>
  );
}
export function Sessions({ s, max = 12 }: { s: FwNet; max?: number }) {
  const rows = [...s.sessions].reverse().slice(0, max);
  if (!rows.length) return <p className="text-[12px] text-pv-text-faint">No sessions yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-left text-[11.5px]">
        <thead className="text-[10.5px] text-pv-text-faint">
          <tr>
            <th className="px-1 py-0.5">id</th>
            <th className="px-1 py-0.5">rule</th>
            <th className="px-1 py-0.5">as sent</th>
            <th className="px-1 py-0.5">after NAT</th>
            <th className="px-1 py-0.5">state</th>
          </tr>
        </thead>
        <tbody className="pv-mono">
          {rows.map((x) => (
            <tr key={x.id} className={clsx("border-t border-pv-border/40", x.state === "ESTABLISHED" || x.state === "ICMP" ? "text-pv-success" : x.state === "CLOSED" ? "text-pv-text-faint" : "text-pv-warning")}>
              <td className="px-1 py-0.5">{x.id}</td>
              <td className="px-1 py-0.5">{x.rule}</td>
              <td className="px-1 py-0.5">
                {x.src}:{x.sport} → {x.dst}:{x.dport}
              </td>
              <td className="px-1 py-0.5">
                {x.xsrc}:{x.xsport} → {x.realDst}:{x.realDport}
              </td>
              <td className="px-1 py-0.5">{x.state}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function Pipeline({ run, vendor }: { run: FwRun; vendor: CliVendor }) {
  const ds = run.waves.flatMap((w) => w.decisions).filter((d) => d.dev === "FW1");
  if (!ds.length) return <p className="text-[12px] text-pv-text-faint">No packet reached FW1 in this run.</p>;
  return (
    <div className="space-y-2">
      {ds.slice(0, 6).map((d, i) => (
        <div key={i} className={clsx("rounded-lg border p-2", d.drop ? "border-pv-danger/50" : "border-pv-border")}>
          <p className="pv-mono text-[11.5px] font-semibold text-pv-text">
            {d.pkt.proto === "tcp" ? `TCP ${d.pkt.flags} ${d.pkt.src}:${d.pkt.sport} → ${d.pkt.dst}:${d.pkt.dport}` : `ICMP ${d.pkt.icmp} ${d.pkt.src} → ${d.pkt.dst}`} <span className="font-sans font-normal text-pv-text-faint">in {d.ingress ? zoneName(vendor, d.ingress) : "?"}</span>
          </p>
          <ol className="mt-1 space-y-0.5">
            {d.stages.map((st, k) => (
              <li key={k} className={clsx("text-[12px]", st.k === "drop" || !st.ok ? "text-pv-danger" : st.k === "session" && /matches/.test(st.text) ? "text-pv-violet" : "text-pv-text-muted")}>
                <span className="pv-mono text-[10.5px] uppercase text-pv-text-faint">{st.k} </span>
                {fwVendorText(vendor, st.text)}
              </li>
            ))}
          </ol>
        </div>
      ))}
      {ds.length > 6 && <p className="text-[11.5px] text-pv-text-faint">… {ds.length - 6} more packets through FW1.</p>}
    </div>
  );
}
export function NatView({ s, vendor }: { s: FwNet; vendor: CliVendor }) {
  const row = (k: string, v: string, good: boolean) => (
    <div className="flex flex-wrap justify-between gap-x-3 border-b border-pv-border/50 py-0.5 text-[12px]">
      <span className="text-pv-text-muted">{k}</span>
      <span className={clsx("pv-mono", good ? "text-pv-success" : "text-pv-warning")}>{v}</span>
    </div>
  );
  return (
    <div>
      {row(`source NAT ${zoneName(vendor, "trust")} → ${zoneName(vendor, "untrust")}`, snatAddr(s.cfg.snat.trust) ? `→ ${snatAddr(s.cfg.snat.trust)}` : "none", s.cfg.snat.trust === "interface")}
      {row(`source NAT ${zoneName(vendor, "dmz")} → ${zoneName(vendor, "untrust")}`, snatAddr(s.cfg.snat.dmz) ? `→ ${snatAddr(s.cfg.snat.dmz)}` : "none", s.cfg.snat.dmz === "interface")}
      {row("destination NAT", s.cfg.dnat ? `${PUBLIC}:443 → ${HOST_IP.DMZ}:443` : "none", s.cfg.dnat)}
      {row("DMZ server's gateway", s.cfg.dmzGw, s.cfg.dmzGw === "172.16.0.1")}
    </div>
  );
}
export function Journey({ run, vendor, max = 40 }: { run: FwRun; vendor: CliVendor; max?: number }) {
  const rows: { hop: number; who: string; text: string; tone: "ok" | "bad" | "plain" }[] = [];
  run.waves.forEach((w, i) => {
    for (const d of w.decisions) {
      const pk = d.pkt.proto === "tcp" ? `${d.pkt.flags} ${d.pkt.src}:${d.pkt.sport} → ${d.pkt.dst}:${d.pkt.dport}` : `${d.pkt.icmp} ${d.pkt.src} → ${d.pkt.dst}`;
      rows.push({ hop: i + 1, who: d.dev, text: `${pk}: ${d.drop ? `DROPPED — ${d.drop}` : d.stages.filter((x) => x.k !== "session" || /matches session/.test(x.text)).map((x) => x.text).slice(-2).join(" · ")}`, tone: d.drop ? "bad" : "plain" });
    }
    for (const r of w.rx) rows.push({ hop: i + 1, who: r.dev, text: r.why.replace(new RegExp(`^${r.dev}: `), ""), tone: r.ok ? "ok" : "bad" });
  });
  return (
    <div className="max-h-[360px] overflow-y-auto">
      <table className="w-full text-left text-[12px]">
        <tbody>
          {rows.slice(0, max).map((r, i) => (
            <tr key={i} className="border-t border-pv-border/40 align-top">
              <td className="pv-mono px-1.5 py-0.5 text-pv-text-faint">{r.hop}</td>
              <td className="whitespace-nowrap px-1.5 py-0.5 font-semibold text-pv-text">{r.who}</td>
              <td className={clsx("px-1.5 py-0.5", r.tone === "ok" ? "text-pv-success" : r.tone === "bad" ? "text-pv-danger" : "text-pv-text-muted")}>{fwVendorText(vendor, r.text)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > max && <p className="pt-1 text-[11.5px] text-pv-text-faint">… {rows.length - max} more lines.</p>}
    </div>
  );
}
export const TARGETS: { ip: string; label: string }[] = [
  { ip: HOST_IP.WEB, label: "WEB 203.0.113.80" },
  { ip: PUBLIC, label: "our public 198.51.100.2" },
  { ip: HOST_IP.DMZ, label: "DMZ 172.16.0.10" },
  { ip: HOST_IP.OUT, label: "OUT 203.0.113.50" },
  { ip: HOST_IP.CLIENT, label: "CLIENT 10.10.10.10" },
];
const APP_CHOICES: { id: string; label: string; kind: FwSendKind; port?: number }[] = [
  { id: "https", label: "HTTPS (443)", kind: "connect", port: 443 },
  { id: "http", label: "HTTP (80)", kind: "connect", port: 80 },
  { id: "ssh", label: "SSH (22)", kind: "connect", port: 22 },
  { id: "ping", label: "ping", kind: "ping" },
];
export function Composer({ act, busy }: { act: (a: FwAction) => void; busy: boolean }) {
  const [from, setFrom] = useState<FwHost>("CLIENT");
  const [to, setTo] = useState(HOST_IP.WEB);
  const [app, setApp] = useState("https");
  const sel = "rounded-md border border-pv-border bg-pv-bg px-1.5 py-0.5 text-[12px] text-pv-text";
  const b = "rounded-full border border-pv-border px-2.5 py-0.5 text-[12px] font-semibold text-pv-text-muted hover:border-pv-cyan/60 hover:text-pv-text disabled:opacity-40";
  const a = APP_CHOICES.find((x) => x.id === app)!;
  const dst = to === HOST_IP[from] ? TARGETS.find((t) => t.ip !== HOST_IP[from])!.ip : to;
  return (
    <Card title="Generate traffic · run the network">
      <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-pv-text-muted">
        <select aria-label="From" className={sel} value={from} onChange={(e) => setFrom(e.target.value as FwHost)}>
          {FW_HOSTS.map((h) => (
            <option key={h}>{h}</option>
          ))}
        </select>
        →
        <select aria-label="To" className={sel} value={dst} onChange={(e) => setTo(e.target.value)}>
          {TARGETS.filter((t) => t.ip !== HOST_IP[from]).map((t) => (
            <option key={t.ip} value={t.ip}>
              {t.label}
            </option>
          ))}
        </select>
        <select aria-label="Application" className={sel} value={app} onChange={(e) => setApp(e.target.value)}>
          {APP_CHOICES.map((x) => (
            <option key={x.id} value={x.id}>
              {x.label}
            </option>
          ))}
        </select>
        <button type="button" className={clsx(b, "border-pv-cyan/60 text-pv-text")} disabled={busy} onClick={() => act({ type: "traffic", sends: [{ from, to: dst, kind: a.kind, port: a.port }] })}>
          Send ▶
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className={b} disabled={busy} onClick={() => act({ type: "traffic", sends: [{ from: "OUT", to: PUBLIC, kind: "stray", port: 40001 }] })}>
          Stray ACK from the internet ▶
        </button>
        <button type="button" className={b} disabled={busy} onClick={() => act({ type: "clear" })}>
          Clear sessions
        </button>
      </div>
    </Card>
  );
}
export function ladder(s: FwNet, vendor: CliVendor, run?: FwRun): { k: string; title: string; text: string }[] {
  const r0 = run?.results[0];
  const fwd = run?.waves.flatMap((w) => w.decisions).filter((d) => d.dev === "FW1") ?? [];
  const firstFw = fwd[0];
  const sess = r0?.session ? s.sessions.find((x) => x.id === r0.session) : undefined;
  const drop = run?.waves.flatMap((w) => w.decisions).find((d) => d.drop);
  const t = (x: string) => fwVendorText(vendor, x);
  return [
    { k: "what", title: "What exactly fails — denied, hanging, or refused?", text: !run || !r0 ? "Reproduce the problem first." : r0.ok ? `It works: ${r0.path.join(" → ")}.` : `${r0.outcome}: ${t(r0.fail ?? "")}` },
    { k: "reach", title: "Did the first packet reach FW1, and in which zone?", text: firstFw ? t(`yes — ${firstFw.pkt.proto === "tcp" ? `TCP ${firstFw.pkt.flags}` : "ICMP"} from ${firstFw.pkt.src} arrived in zone ${firstFw.ingress}`) : run ? "No — it never got to the firewall (look at the host)." : "—" },
    { k: "policy", title: "Which rule matched — or did the default deny drop it? (hit counts, logs)", text: firstFw ? t(firstFw.stages.filter((x) => x.k === "dnat" || x.k === "policy").map((x) => x.text).join(" · ") || firstFw.stages.map((x) => x.text).join(" · ")) : "—" },
    { k: "nat", title: "How was it translated? (source NAT out, destination NAT in)", text: firstFw ? t(firstFw.stages.filter((x) => x.k === "snat" || x.k === "dnat").map((x) => x.text).join(" · ") || "no translation for this packet") : "—" },
    { k: "sess", title: "Was a session created — and did it reach ESTABLISHED? (show … sessions)", text: sess ? `session ${sess.id}: ${sess.src}:${sess.sport} → ${sess.dst}:${sess.dport} · out as ${sess.xsrc}:${sess.xsport} → ${sess.realDst}:${sess.realDport} · ${sess.state}` : r0?.session === undefined && run ? "no session was created (the first packet was dropped before)" : "—" },
    { k: "back", title: "If the session is stuck half-open: where did the reply die?", text: drop && sess && sess.state !== "ESTABLISHED" ? t(`${drop.dev}: ${drop.drop}`) : sess?.state === "ESTABLISHED" ? "the reply came back through the session" : "—" },
  ];
}
