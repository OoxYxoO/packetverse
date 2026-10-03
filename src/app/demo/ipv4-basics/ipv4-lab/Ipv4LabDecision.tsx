"use client";

import { clsx } from "clsx";
import { R1_ROUTES, maskOf } from "@/lib/sim-engine/scenarios/ipv4Basics";
import { INCOMPLETE, V4_STATIONS, v4Owner, type V4ArpUse, type V4Decision, type V4Host, type V4LabState } from "@/lib/sim-engine/scenarios/ipv4Lab";
import { r1InterfaceAlias } from "../cliAdapter";

/**
 * IPv4 Lab "Decision" view (IPv4-specific): the host's forwarding decision made visible — its own prefix, the AND of
 * both addresses, LOCAL vs REMOTE, the Layer-3 next hop vs the final destination, and the Layer-2 target ARP resolved.
 * While the incident is unresolved, HOST-A's configured mask is concealed until the learner inspects HOST-A.
 */

const lastOctet = (ip: string) => Number(ip.split(".")[3]);

/** Last-octet bit view: every address in this lesson shares 192.168.10, so only octet 4 holds the boundary. */
function BitRow({ label, ip, prefix }: { label: string; ip: string; prefix: number }) {
  const bits = lastOctet(ip).toString(2).padStart(8, "0");
  const netBits = Math.max(0, Math.min(8, prefix - 24));
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      <span className="w-[86px] shrink-0 pv-mono text-[10.5px] text-pv-text-faint">{label}</span>
      <span className="pv-mono text-[11px] text-pv-text-muted">192.168.10.</span>
      <span className="flex pv-mono text-[12px]">
        {[...bits].map((b, i) => (
          <span key={i} className={clsx("w-[13px] text-center", i < netBits ? "rounded-sm bg-pv-cyan/20 font-bold text-pv-cyan-soft" : "text-pv-text-muted", i === netBits - 1 && "mr-1.5")}>
            {b}
          </span>
        ))}
      </span>
      <span className="pv-mono text-[10.5px] text-pv-text-faint">({lastOctet(ip)})</span>
    </div>
  );
}

export function V4DecisionPanel({ lab, arp, conceal, onInspect }: { lab: V4LabState; arp?: V4ArpUse; conceal: boolean; onInspect: (src: V4Host) => void }) {
  const d: V4Decision | undefined = lab.decision;
  if (!d) return <p className="rounded-xl border border-pv-border p-3 text-[11.5px] text-pv-text-faint">No forwarding decision yet. The first guided step makes HOST-A decide how to reach a destination.</p>;
  const hide = conceal && d.src === "HOST-A";
  const hostNetBits = Math.max(0, d.prefix - 24);
  const nextHopName = v4Owner(d.nextHop) ?? "no device owns this address";
  return (
    <section className="rounded-xl border border-pv-cyan/40 bg-pv-cyan/[0.03] p-2.5" aria-label="Forwarding decision">
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-[11px] font-bold text-pv-text">
          {d.src}&apos;s forwarding decision → {d.dst}
        </h4>
        <button type="button" onClick={() => onInspect(d.src)} className="rounded-full border border-pv-cyan/50 px-2 py-0.5 text-[10.5px] font-semibold text-pv-cyan-soft hover:bg-pv-cyan/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-cyan">
          Inspect this decision
        </button>
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[11px]">
        <dt className="text-pv-text-faint">Source</dt>
        <dd className="pv-mono text-pv-text">{hide ? `${d.srcIp} · mask: inspect HOST-A's configuration` : `${d.srcIp}/${d.prefix} · mask ${d.mask}`}</dd>
        <dt className="text-pv-text-faint">Destination</dt>
        <dd className="pv-mono text-pv-text">{d.dst}</dd>
        {!hide && (
          <>
            <dt className="text-pv-text-faint">AND</dt>
            <dd className="pv-mono text-pv-text">
              {d.srcIp} AND {d.mask} = <b className="text-pv-cyan-soft">{d.srcNet}</b>
            </dd>
            <dt />
            <dd className="pv-mono text-pv-text">
              {d.dst} AND {d.mask} = <b className={d.local ? "text-pv-cyan-soft" : "text-pv-warning"}>{d.dstNet}</b>
            </dd>
          </>
        )}
      </dl>
      {!hide && (
        <div className="mt-1.5 space-y-0.5 rounded-lg border border-pv-border bg-black/20 p-1.5" aria-label="Last octet in bits">
          <p className="text-[10px] text-pv-text-faint">
            Last octet in bits — /{d.prefix} puts {hostNetBits} network bit{hostNetBits === 1 ? "" : "s"} here (highlighted) and {8 - hostNetBits} host bits
          </p>
          <BitRow label={d.src} ip={d.srcIp} prefix={d.prefix} />
          <BitRow label={v4Owner(d.dst) ?? "destination"} ip={d.dst} prefix={d.prefix} />
        </div>
      )}
      {hide && <p className="mt-1 text-[10.5px] text-pv-text-faint">The AND uses HOST-A&apos;s configured mask. Inspect HOST-A&apos;s configuration to see it.</p>}
      <dl className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[11px]">
        <dt className="text-pv-text-faint">Decision</dt>
        <dd>
          <span className={clsx("rounded px-1.5 py-0.5 pv-mono text-[11px] font-bold", d.local ? "bg-pv-cyan/15 text-pv-cyan-soft" : "bg-pv-warning/15 text-pv-warning")}>{d.local ? "LOCAL — same network" : "REMOTE — different network"}</span>
        </dd>
        <dt className="text-pv-text-faint">Next hop (L3)</dt>
        <dd className="pv-mono text-pv-text">
          {d.nextHop} · {d.local ? "the destination itself" : `default gateway (${nextHopName})`}
        </dd>
        <dt className="text-pv-text-faint">Final destination</dt>
        <dd className="pv-mono text-pv-text">{d.dst} — stays in the IPv4 header</dd>
        <dt className="text-pv-text-faint">L2 target</dt>
        <dd className="pv-mono text-pv-text">
          {arp ? (arp.outcome === "no-reply" ? `ARP for ${arp.ip}: no reply → INCOMPLETE` : `${arp.mac} — ARP for ${arp.ip} (${arp.outcome === "cache" ? "already in cache" : "resolved now"})`) : `MAC of ${d.nextHop} — resolved by ARP when ${d.src} sends`}
        </dd>
      </dl>
    </section>
  );
}

/** One host's configuration + ARP cache. HOST-A's prefix/mask can be concealed (incident). */
export function V4HostCard({ lab, host, conceal, onInspectConfig, fresh }: { lab: V4LabState; host: V4Host; conceal: boolean; onInspectConfig?: () => void; fresh?: boolean }) {
  const st = V4_STATIONS[host];
  const cfg = lab.config[host];
  const hide = conceal && host === "HOST-A";
  const arp = Object.entries(lab.arp[host]);
  return (
    <section className={clsx("min-w-0 rounded-xl border bg-white/[0.02] p-2.5", fresh ? "border-pv-success/50" : "border-pv-border")} aria-label={`${host} card`}>
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-[11px] font-bold text-pv-text">
          {host}
          {host === "HOST-C" && <span className="ml-1.5 rounded border border-pv-violet/50 px-1 text-[9.5px] font-semibold text-pv-violet">LAB ONLY</span>}
        </h4>
        {host === "HOST-A" && onInspectConfig && (
          <button type="button" onClick={onInspectConfig} className="rounded-full border border-pv-border px-2 py-0.5 text-[10.5px] font-semibold text-pv-text-muted hover:text-pv-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-cyan">
            Inspect configuration
          </button>
        )}
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 pv-mono text-[10.5px]">
        <dt className="text-pv-text-faint">IPv4</dt>
        <dd className="text-pv-text">{hide ? `${st.ip} / (concealed — inspect)` : `${st.ip}/${cfg.prefix}`}</dd>
        <dt className="text-pv-text-faint">Mask</dt>
        <dd className="text-pv-text">{hide ? "—" : maskOf(cfg.prefix)}</dd>
        <dt className="text-pv-text-faint">Gateway</dt>
        <dd className="text-pv-text">{cfg.gateway}</dd>
        <dt className="text-pv-text-faint">MAC</dt>
        <dd className="text-pv-text-muted">{st.mac}</dd>
      </dl>
      <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">ARP cache</p>
      {arp.length === 0 ? (
        <p className="pv-mono text-[10.5px] text-pv-text-faint">empty</p>
      ) : (
        <ul className="pv-mono text-[10.5px]">
          {arp.map(([ip, mac]) => (
            <li key={ip} className={mac === INCOMPLETE ? "text-pv-warning" : "text-pv-cyan-soft"}>
              {ip} → {mac}
              <span className="text-pv-text-faint"> ({v4Owner(ip) ?? "unknown"})</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function V4RouterCard({ lab, fresh }: { lab: V4LabState; fresh?: boolean }) {
  const arp = Object.entries(lab.arp.R1);
  return (
    <section className={clsx("min-w-0 rounded-xl border bg-white/[0.02] p-2.5", fresh ? "border-pv-success/50" : "border-pv-border")} aria-label="R1 card">
      <h4 className="mb-1 text-[11px] font-bold text-pv-text">R1 · router</h4>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">Connected routes</p>
      <ul className="pv-mono text-[10.5px] text-pv-text">
        {R1_ROUTES.map((r) => (
          <li key={r.prefix}>
            {r.prefix} → {r.iface} ({r1InterfaceAlias("cisco", r.iface)}) · {r.addr}
          </li>
        ))}
      </ul>
      <p className="mt-1 pv-mono text-[10.5px] text-pv-text">
        IPv4 packets routed: <b className="text-pv-cyan-soft">{lab.r1Forwarded}</b>
      </p>
      <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">ARP cache</p>
      {arp.length === 0 ? (
        <p className="pv-mono text-[10.5px] text-pv-text-faint">empty</p>
      ) : (
        <ul className="pv-mono text-[10.5px] text-pv-cyan-soft">
          {arp.map(([ip, mac]) => (
            <li key={ip}>
              {ip} → {mac} <span className="text-pv-text-faint">({v4Owner(ip)})</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
