"use client";

import { clsx } from "clsx";
import { useState, type ReactNode } from "react";
import type { CliVendor } from "@/lib/cli/types";
import { HOST_PORT, HOST_SW, LINK_ENDS, LINK_TEXT, SPARE, ST_HOSTS, ST_LINKS, ST_SWITCHES, bidOf, cmpBid, pk, stMacName, stPortState, type StAction, type StBridge, type StHost, type StRun, type StState, type StSw } from "@/lib/sim-engine/scenarios/stpNet";
import { stPortName, stVendorText } from "./stNames";
import { decisionLine } from "./stMoments";
import { RoleBadge } from "./StDevices";

/**
 * Evidence panels of the STP Lab — each reads the lab state (or one run) and nothing else:
 *   Election    every bridge's ID, lowest first: who is root, and why
 *   RootCosts   each switch's paths to the root, with costs, and the one it picked (its Root Port)
 *   Segments    each link: which end is Designated, which end is Root or Alternate
 *   Journey     every switch decision and host verdict of a run, hop by hop
 *   Copies      copies of each broadcast every host received (1 = loop-free)
 *   Composer    traffic, hellos, time, link failures, the small switch
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
const L = (h: string) => h.replace("HOST-", "");

export function Election({ s }: { s: StState }) {
  const list = [...ST_SWITCHES.filter((sw) => s.cfg.sw[sw].proto !== "none"), ...(s.cfg.rogue ? (["ROGUE"] as StBridge[]) : [])].sort((a, b) => cmpBid(bidOf(s.cfg, a), bidOf(s.cfg, b)));
  const root = s.tree.bridges.SW1?.root ?? list[0];
  return (
    <div className="space-y-1">
      <table className="w-full text-left text-[12px]">
        <thead className="text-[11px] text-pv-text-faint">
          <tr>
            <th className="px-1.5 py-1">bridge</th>
            <th className="px-1.5 py-1">priority</th>
            <th className="px-1.5 py-1">MAC (tie-break)</th>
            <th className="px-1.5 py-1" />
          </tr>
        </thead>
        <tbody className="pv-mono">
          {list.map((b) => (
            <tr key={b} className={clsx("border-t border-pv-border/50", b === root && "bg-pv-success/[0.07]")}>
              <td className="px-1.5 py-0.5 font-sans font-semibold text-pv-text">{b === "ROGUE" ? "small switch" : b}</td>
              <td className="px-1.5 py-0.5">{bidOf(s.cfg, b).priority}</td>
              <td className="px-1.5 py-0.5">{bidOf(s.cfg, b).mac}</td>
              <td className="px-1.5 py-0.5 font-sans">{b === root ? <b className="text-pv-success">♛ root</b> : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[11.5px] text-pv-text-muted">Lowest Bridge ID wins: priority first; the MAC only breaks a tie (SW2 and SW3 have the same priority — SW2&apos;s MAC is lower).{ST_SWITCHES.some((sw) => s.cfg.sw[sw].proto === "none") ? " A switch with spanning tree off takes no part." : ""}</p>
    </div>
  );
}

export function RootCosts({ s, vendor }: { s: StState; vendor: CliVendor }) {
  const root = s.tree.bridges.SW1?.root;
  return (
    <div className="space-y-1.5">
      {ST_SWITCHES.filter((sw) => sw !== root && s.cfg.sw[sw].proto !== "none").map((sw) => {
        const b = s.tree.bridges[sw]!;
        const cands = ST_LINKS.flatMap((l) => {
          const [a, ap, bb, bp] = LINK_ENDS[l];
          if (!s.cfg.links[l]) return [];
          const mine = a === sw ? ap : bb === sw ? bp : undefined;
          const nb = a === sw ? bb : bb === sw ? a : undefined;
          if (!mine || !nb || s.cfg.sw[nb].proto === "none") return [];
          const nbCost = s.tree.bridges[nb]?.cost;
          if (nbCost === undefined) return [];
          return [{ port: mine, via: nb, total: nbCost + s.cfg.sw[sw].ports[mine as "ge-0/0/1"].cost, nbCost, own: s.cfg.sw[sw].ports[mine as "ge-0/0/1"].cost }];
        });
        if (s.cfg.rogue && root === "ROGUE") cands.push({ port: SPARE, via: "SW3" as StSw, total: s.cfg.sw.SW3.ports[SPARE].cost, nbCost: 0, own: s.cfg.sw.SW3.ports[SPARE].cost });
        return (
          <div key={sw} className="text-[12px]">
            <p className="font-semibold text-pv-text">{sw} → root {root === "ROGUE" ? "(small switch)" : root}</p>
            <ul className="pv-mono space-y-0.5 pl-2">
              {cands
                .filter((c) => !(sw !== "SW3" && c.port === SPARE))
                .map((c) => (
                  <li key={c.port} className={c.port === b.rootPort ? "text-pv-success" : "text-pv-text-muted"}>
                    {c.port === b.rootPort ? "✓ " : "· "}via {stPortName(vendor, c.port)}
                    {c.port === SPARE ? " (small switch)" : ` (${c.via})`}: {c.port === SPARE ? 0 : c.nbCost} + {c.own} = {c.total}
                    {c.port === b.rootPort ? " → Root Port" : ""}
                  </li>
                ))}
            </ul>
          </div>
        );
      })}
      <p className="text-[11.5px] text-pv-text-muted">Root path cost = the cost the neighbor advertises + the cost of the port the BPDU ARRIVES on. Lowest total wins; ties: lowest neighbor Bridge ID, then lowest Port ID.</p>
    </div>
  );
}

export function Segments({ s, vendor }: { s: StState; vendor: CliVendor }) {
  return (
    <div className="space-y-1 text-[12px]">
      {ST_LINKS.map((l) => {
        const [a, ap, b, bp] = LINK_ENDS[l];
        return (
          <div key={l} className="flex flex-wrap items-center gap-1.5">
            <span className="w-[74px] font-semibold text-pv-text">{LINK_TEXT[l]}</span>
            {!s.cfg.links[l] ? (
              <span className="text-pv-danger">cable unplugged</span>
            ) : (
              <>
                <span className="pv-mono text-pv-text-muted">
                  {a} {stPortName(vendor, ap)}
                </span>
                <RoleBadge s={s} sw={a} p={ap} />
                <span className="text-pv-text-faint">↔</span>
                <span className="pv-mono text-pv-text-muted">
                  {b} {stPortName(vendor, bp)}
                </span>
                <RoleBadge s={s} sw={b} p={bp} />
              </>
            )}
          </div>
        );
      })}
      {ST_HOSTS.map((h) => (
        <div key={h} className="flex flex-wrap items-center gap-1.5">
          <span className="w-[74px] font-semibold text-pv-text">{h}</span>
          <span className="pv-mono text-pv-text-muted">
            {HOST_SW[h]} {stPortName(vendor, HOST_PORT)}
          </span>
          {s.cfg.hosts[h] ? <RoleBadge s={s} sw={HOST_SW[h]} p={HOST_PORT} /> : <span className="text-pv-text-faint">unplugged</span>}
        </div>
      ))}
      {loopFree(s) ? <p className="text-[11.5px] text-pv-success">Exactly one inter-switch port blocks: three switches, two forwarding links — a tree.</p> : <p className="text-[11.5px] font-semibold text-pv-danger">{blockedCount(s) === 0 && ST_LINKS.every((l) => s.cfg.links[l]) ? "No inter-switch port blocks while all three links are up: a loop." : "Fewer than three links up: nothing needs to block."}</p>}
    </div>
  );
}
export const blockedCount = (s: StState) => ST_SWITCHES.flatMap((sw) => ["ge-0/0/1", "ge-0/0/2"].map((p) => stPortState(s, sw, p).state)).filter((x) => x === "BLK" || x === "BKN").length;
export const loopFree = (s: StState) => !ST_LINKS.every((l) => s.cfg.links[l]) || ST_SWITCHES.flatMap((sw) => ["ge-0/0/1", "ge-0/0/2"].map((p) => s.tree.ports[pk(sw, p)]?.role)).filter((r) => r === "Alternate").length >= 1;

export function Journey({ run, vendor, max = 40 }: { run: StRun; vendor: CliVendor; max?: number }) {
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
              <td className="whitespace-nowrap px-1.5 py-0.5 font-semibold text-pv-text">{L(r.who)}</td>
              <td className={clsx("px-1.5 py-0.5", r.tone === "ok" ? "text-pv-success" : r.tone === "warn" ? "text-pv-warning" : r.tone === "bad" ? "text-pv-danger" : "text-pv-text-muted")}>{stVendorText(vendor, r.text)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > max && <p className="pt-1 text-[11.5px] text-pv-text-faint">… {rows.length - max} more lines{run.left ? ": the copies kept going" : ""}.</p>}
    </div>
  );
}

export function Copies({ run }: { run: StRun }) {
  const r = run.results.find((x) => Object.keys(x.bcastCopies).length);
  if (!r) return <p className="text-[12.5px] text-pv-text-faint">No broadcast in this run.</p>;
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1">
        {ST_HOSTS.filter((h) => h !== r.send.from).map((h) => {
          const n = r.bcastCopies[h] ?? 0;
          return (
            <span key={h} className={clsx("rounded-full border px-2 py-0.5 text-[11.5px] font-semibold", n === 1 ? "border-pv-success/50 text-pv-success" : n > 1 ? "border-pv-danger/60 text-pv-danger" : "border-pv-border text-pv-text-faint")}>
              {L(h)}: {n.toLocaleString("en-US")} cop{n === 1 ? "y" : "ies"}
            </span>
          );
        })}
      </div>
      <p className="text-[11.5px] text-pv-text-muted">{run.left ? `${run.left.toLocaleString("en-US")} copies were still circulating when the drawing stopped — they never die (Ethernet has no TTL). ${run.flaps} MAC moves.` : "Every host got the broadcast once: the active topology is a tree."}</p>
    </div>
  );
}

export function Composer({ s, act, busy }: { s: StState; act: (a: StAction) => void; busy: boolean }) {
  const [from, setFrom] = useState<StHost>("HOST-A");
  const [to, setTo] = useState<StHost>("HOST-C");
  const [kind, setKind] = useState<"ping" | "arp">("ping");
  const dst = to === from ? ST_HOSTS.find((h) => h !== from)! : to;
  const sel = "rounded-md border border-pv-border bg-pv-bg px-1.5 py-0.5 text-[12px] text-pv-text";
  const b = "rounded-full border border-pv-border px-2.5 py-0.5 text-[12px] font-semibold text-pv-text-muted hover:border-pv-cyan/60 hover:text-pv-text disabled:opacity-40";
  return (
    <Card title="Generate traffic · run the network">
      <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-pv-text-muted">
        <select aria-label="From" className={sel} value={from} onChange={(e) => setFrom(e.target.value as StHost)}>
          {ST_HOSTS.map((h) => (
            <option key={h}>{h}</option>
          ))}
        </select>
        <select aria-label="What" className={sel} value={kind} onChange={(e) => setKind(e.target.value as "ping" | "arp")}>
          <option value="ping">pings</option>
          <option value="arp">broadcasts an ARP request for</option>
        </select>
        <select aria-label="To" className={sel} value={dst} onChange={(e) => setTo(e.target.value as StHost)}>
          {ST_HOSTS.filter((h) => h !== from).map((h) => (
            <option key={h}>{h}</option>
          ))}
        </select>
        <button type="button" className={clsx(b, "border-pv-cyan/60 text-pv-text")} disabled={busy} onClick={() => act({ type: "traffic", sends: [{ from, to: dst, kind }] })}>
          Send ▶
        </button>
        <button type="button" className={b} disabled={busy} onClick={() => act({ type: "hello" })}>
          Send a Hello (BPDUs) ▶
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {ST_LINKS.map((l) => (
          <button key={l} type="button" className={b} disabled={busy} onClick={() => act({ type: "link", link: l, up: !s.cfg.links[l] })}>
            {s.cfg.links[l] ? `Unplug ${LINK_TEXT[l]}` : `Plug ${LINK_TEXT[l]} back`}
          </button>
        ))}
        <button type="button" className={b} disabled={busy} onClick={() => act({ type: "wait", seconds: 15 })}>
          Wait 15 s
        </button>
        <button type="button" className={b} disabled={busy} onClick={() => act({ type: "wait", seconds: 60 })}>
          Wait 60 s
        </button>
        <button type="button" className={b} disabled={busy} onClick={() => act({ type: "rogue", up: !s.cfg.rogue })}>
          {s.cfg.rogue ? "Unplug the small switch" : "Plug a small switch into SW3 ge-0/0/11"}
        </button>
        <span className="pv-mono text-[11px] text-pv-text-faint">lab clock {s.clock - 3600} s</span>
      </div>
    </Card>
  );
}

export function ladder(s: StState, vendor: CliVendor, run?: StRun): { k: string; title: string; text: string }[] {
  const c = s.cfg;
  const n = (p: string) => stPortName(vendor, p);
  const root = s.tree.bridges.SW1?.root;
  const res = run?.results ?? [];
  const r0 = res[0];
  const roles = ST_SWITCHES.map((sw) => `${sw}: ${["ge-0/0/1", "ge-0/0/2", HOST_PORT, SPARE].filter((p) => s.tree.ports[pk(sw, p)]?.role !== "Disabled").map((p) => `${n(p)} ${s.tree.ports[pk(sw, p)].role}${stPortState(s, sw, p).wait ? ` (${stPortState(s, sw, p).wait} s to FWD)` : ""}`).join(", ")}`).join(" · ");
  const off = ST_SWITCHES.flatMap((sw) => ["ge-0/0/1", "ge-0/0/2", HOST_PORT, SPARE].filter((p) => c.sw[sw].ports[p as "ge-0/0/1"].stpOff).map((p) => `${sw} ${n(p)}`));
  return [
    { k: "what", title: "What exactly fails — and is it everyone, or one place?", text: !run ? "Reproduce the problem first." : r0 ? (r0.replied || r0.answered ? `${r0.send.from} → ${r0.send.to} worked${r0.path.length > 1 ? ` via ${r0.path.filter((x) => x.startsWith("SW")).join(" → ")}` : ""}${run.left ? ` — but ${run.left.toLocaleString("en-US")} copies kept circulating` : ""}.` : `${r0.send.from} → ${r0.send.to} FAILED: ${r0.fail}`) : "—" },
    { k: "loop", title: "Is there a loop? (duplicates, circulating copies, MAC moves)", text: run ? `${run.left ? `${run.left.toLocaleString("en-US")} copies circulating` : "nothing circulating"} · ${run.flaps} MAC moves · broadcast copies per host: ${r0 ? Object.entries(r0.bcastCopies).map(([h, k]) => `${L(h)} ${k}`).join(", ") || "—" : "—"}.` : "—" },
    { k: "root", title: "Which bridge is root — the one you designed as root?", text: `Root: ${root === "ROGUE" ? "the small switch on SW3 ge-0/0/11!" : root}. Priorities: ${ST_SWITCHES.map((sw) => `${sw} ${c.sw[sw].priority}`).join(", ")}${c.rogue ? ", small switch 4096" : ""}.` },
    { k: "roles", title: "What role and state is every port in?", text: roles },
    { k: "cost", title: "Is each switch's Root Port the one you'd expect? (costs)", text: ST_SWITCHES.filter((sw) => s.tree.bridges[sw]?.root !== sw).map((sw) => `${sw} RP ${s.tree.bridges[sw]?.rootPort ? n(s.tree.bridges[sw]!.rootPort!) : "—"} (cost ${s.tree.bridges[sw]?.cost}; port costs ${n("ge-0/0/1")} ${c.sw[sw].ports["ge-0/0/1"].cost}, ${n("ge-0/0/2")} ${c.sw[sw].ports["ge-0/0/2"].cost})`).join(" · ") },
    { k: "prot", title: "Protocol, edge ports and guards", text: `${ST_SWITCHES.map((sw) => `${sw} ${c.sw[sw].proto.toUpperCase()}`).join(", ")} · host ports edge: ${ST_HOSTS.map((h) => `${L(h)} ${c.sw[HOST_SW[h]].ports[HOST_PORT].edge ? "yes" : "NO"}`).join(", ")} · SW3 ${n(SPARE)}: BPDU guard ${c.sw.SW3.ports[SPARE].bpduGuard ? "on" : "off"}, root guard ${c.sw.SW3.ports[SPARE].rootGuard ? "on" : "off"} · out of spanning tree: ${off.join(", ") || "none"} · err-disabled: ${s.errdis.join(", ") || "none"}.` },
    { k: "links", title: "Are all links up?", text: ST_LINKS.map((l) => `${LINK_TEXT[l]} ${c.links[l] ? "up" : "DOWN"}`).join(" · ") },
  ];
}
export { stMacName };
