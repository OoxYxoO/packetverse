"use client";

import { clsx } from "clsx";
import { useState, type ReactNode } from "react";
import { GW, HOST_IP, IKE_PROPS, VP_GWS, VP_HOSTS, type VpAction, type VpHost, type VpNet, type VpRun } from "@/lib/sim-engine/scenarios/vpnNet";

/**
 * Evidence panels of the VPN Lab — each reads the lab state (or one run) and nothing else:
 *   TunnelState  the IKE SA, the CHILD SA, why negotiation stops, selectors, SPIs and ESP counters
 *   Compare      both gateways' VPN settings side by side (they must mirror each other)
 *   Journey      every decision of a run, hop by hop (IKE exchanges, encryption, decryption)
 *   Composer     pings, an IKE negotiation, clearing SAs, GW-B's internet link
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
const Row = ({ k, v, good }: { k: string; v: ReactNode; good?: boolean }) => (
  <div className="flex flex-wrap justify-between gap-x-3 border-b border-pv-border/50 py-0.5 text-[12px]">
    <span className="text-pv-text-muted">{k}</span>
    <span className={clsx("pv-mono text-right", good === undefined ? "text-pv-text" : good ? "text-pv-success" : "text-pv-danger")}>{v}</span>
  </div>
);
export function TunnelState({ s }: { s: VpNet }) {
  const t = s.tunnel;
  return (
    <div>
      <Row k="IKE SA (IKE_SA_INIT + IKE_AUTH)" v={t.ike} good={t.ike === "ESTABLISHED"} />
      <Row k="CHILD SA (ESP)" v={t.child} good={t.child === "INSTALLED"} />
      {t.why && <p className="py-1 text-[12px] text-pv-text-muted">{t.why}</p>}
      {t.child === "INSTALLED" && (
        <>
          <Row k="traffic selectors" v={`${t.tsi} ↔ ${t.tsr}`} />
          <Row k="SPI GW-A → GW-B (GW-B chose)" v={s.sa.ab} />
          <Row k="SPI GW-B → GW-A (GW-A chose)" v={s.sa.ba} />
          <Row k="ESP encrypted A / B" v={`${s.sa.encaps["GW-A"]} / ${s.sa.encaps["GW-B"]}`} />
          <Row k="ESP decrypted A / B" v={`${s.sa.decaps["GW-A"]} / ${s.sa.decaps["GW-B"]}`} />
        </>
      )}
    </div>
  );
}
const mask = (k: string) => `••••${k.slice(-4)}`;
export function Compare({ s }: { s: VpNet }) {
  const a = s.cfg.gw["GW-A"];
  const b = s.cfg.gw["GW-B"];
  const rows: [string, string, string, boolean][] = [
    ["peer address", `${a.peer}${a.peer === GW["GW-B"].wan ? " (GW-B)" : ""}`, `${b.peer}${b.peer === GW["GW-A"].wan ? " (GW-A)" : ""}`, a.peer === GW["GW-B"].wan && b.peer === GW["GW-A"].wan],
    ["IKE proposal", `${IKE_PROPS[a.ike].encr} · ${IKE_PROPS[a.ike].dh.split(" (")[0]}`, `${IKE_PROPS[b.ike].encr} · ${IKE_PROPS[b.ike].dh.split(" (")[0]}`, a.ike === b.ike],
    ["pre-shared key", mask(a.psk), mask(b.psk), a.psk === b.psk],
    ["local selector", a.local, b.local, true],
    ["remote selector", a.remote, b.remote, a.local === b.remote && a.remote === b.local],
    ["site traffic → IPsec", a.steer ? "yes" : "NO", b.steer ? "yes" : "NO", a.steer && b.steer],
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[380px] text-left text-[12px]">
        <thead className="text-[10.5px] text-pv-text-faint">
          <tr>
            <th className="px-1 py-0.5" />
            <th className="px-1 py-0.5">GW-A</th>
            <th className="px-1 py-0.5">GW-B</th>
          </tr>
        </thead>
        <tbody className="pv-mono">
          {rows.map(([k, x, y, ok]) => (
            <tr key={k} className={clsx("border-t border-pv-border/40", ok ? "text-pv-text-muted" : "text-pv-warning")}>
              <td className="px-1 py-0.5 font-sans text-pv-text-muted">{k}</td>
              <td className="px-1 py-0.5">{x}</td>
              <td className="px-1 py-0.5">{y}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="pt-1 text-[11.5px] text-pv-text-muted">The two ends must mirror each other: each one&apos;s peer is the other&apos;s address, the same proposal and key, and each one&apos;s local selector is the other&apos;s remote.</p>
    </div>
  );
}
export function Journey({ run, max = 40 }: { run: VpRun; max?: number }) {
  const rows: { hop: number; who: string; text: string; tone: "ok" | "bad" | "plain" | "learn" }[] = [];
  run.waves.forEach((w, i) => {
    for (const d of w.decisions) rows.push({ hop: i + 1, who: d.dev, text: d.drop ? `DROPPED — ${d.drop}` : d.text, tone: d.drop ? "bad" : /ESP|decrypted|IKE_/.test(d.text) ? "learn" : "plain" });
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
              <td className={clsx("px-1.5 py-0.5", r.tone === "ok" ? "text-pv-success" : r.tone === "bad" ? "text-pv-danger" : r.tone === "learn" ? "text-pv-violet" : "text-pv-text-muted")}>{r.text}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > max && <p className="pt-1 text-[11.5px] text-pv-text-faint">… {rows.length - max} more lines.</p>}
    </div>
  );
}
export const TARGETS: { ip: string; label: string }[] = [
  { ip: HOST_IP["HOST-B"], label: "HOST-B 10.20.20.20" },
  { ip: HOST_IP["HOST-A"], label: "HOST-A 10.10.10.10" },
  { ip: HOST_IP.WEB, label: "WEB 192.0.2.80 (internet)" },
  { ip: GW["GW-B"].lan, label: "GW-B 10.20.20.1" },
];
export function Composer({ s, act, busy }: { s: VpNet; act: (a: VpAction) => void; busy: boolean }) {
  const [from, setFrom] = useState<VpHost>("HOST-A");
  const [to, setTo] = useState(HOST_IP["HOST-B"]);
  const sel = "rounded-md border border-pv-border bg-pv-bg px-1.5 py-0.5 text-[12px] text-pv-text";
  const b = "rounded-full border border-pv-border px-2.5 py-0.5 text-[12px] font-semibold text-pv-text-muted hover:border-pv-cyan/60 hover:text-pv-text disabled:opacity-40";
  const dst = to === HOST_IP[from] ? TARGETS.find((t) => t.ip !== HOST_IP[from])!.ip : to;
  return (
    <Card title="Generate traffic · run the tunnel">
      <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-pv-text-muted">
        <select aria-label="From" className={sel} value={from} onChange={(e) => setFrom(e.target.value as VpHost)}>
          {VP_HOSTS.map((h) => (
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
        <button type="button" className={clsx(b, "border-pv-cyan/60 text-pv-text")} disabled={busy} onClick={() => act({ type: "traffic", sends: [{ from, to: dst }] })}>
          Ping ▶
        </button>
        <button type="button" className={b} disabled={busy} onClick={() => act({ type: "ike" })}>
          Show the IKE negotiation ▶
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className={b} disabled={busy} onClick={() => act({ type: "clear" })}>
          Clear SAs (renegotiate)
        </button>
        <button type="button" className={b} disabled={busy} onClick={() => act({ type: "wan", up: !s.cfg.wanB })}>
          {s.cfg.wanB ? "Cut GW-B's internet link" : "Restore GW-B's internet link"}
        </button>
      </div>
    </Card>
  );
}
export function ladder(s: VpNet, run?: VpRun): { k: string; title: string; text: string }[] {
  const t = s.tunnel;
  const r0 = run?.results[0];
  const a = s.cfg.gw["GW-A"];
  const b = s.cfg.gw["GW-B"];
  return [
    { k: "what", title: "What fails — and is the traffic even meant for the tunnel?", text: !run ? "Reproduce the problem first." : r0 ? (r0.replied ? `It works${r0.encrypted ? " — through the tunnel" : " — but in the clear!"}.` : `FAILED: ${r0.fail}`) : "negotiation only" },
    { k: "ike1", title: "Does IKE_SA_INIT get an answer, with a common proposal? (show crypto ikev2 sa · show security ike security-associations)", text: t.ike === "NO_RESPONSE" ? `No answer: ${t.why}` : t.ike === "NO_PROPOSAL_CHOSEN" ? t.why! : `Yes — ${IKE_PROPS[a.ike].encr}, ${IKE_PROPS[a.ike].dh}` },
    { k: "ike2", title: "Does IKE_AUTH authenticate both peers?", text: t.ike === "AUTHENTICATION_FAILED" ? t.why! : t.ike === "ESTABLISHED" ? "Yes — the IKE SA is ESTABLISHED" : "not reached" },
    { k: "child", title: "Is a CHILD SA installed — with which selectors? (show crypto ipsec sa · show security ipsec security-associations)", text: t.child === "INSTALLED" ? `Yes — ${t.tsi} ↔ ${t.tsr}` : t.child === "TS_UNACCEPTABLE" ? t.why! : "no CHILD SA" },
    { k: "steer", title: "Is the site traffic sent into IPsec? (crypto map on the WAN · route via st0.0)", text: `GW-A: ${a.steer ? "yes" : "NO"} · GW-B: ${b.steer ? "yes" : "NO"}` },
    { k: "count", title: "Do the ESP counters move when you test? (encaps / decaps)", text: `GW-A encrypted ${s.sa.encaps["GW-A"]}, decrypted ${s.sa.decaps["GW-A"]} · GW-B encrypted ${s.sa.encaps["GW-B"]}, decrypted ${s.sa.decaps["GW-B"]}` },
  ];
}
export const VP_GW_LIST = VP_GWS;
