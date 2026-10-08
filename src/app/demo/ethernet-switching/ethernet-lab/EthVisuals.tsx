"use client";

import { clsx } from "clsx";
import type { CliVendor } from "@/lib/cli/types";
import { BROADCAST_MAC, DESK_PORTS, ETH_MAC, SW1_PORTS, macName, type EthDevice, type EthHost, type EthSwitch } from "@/lib/sim-engine/scenarios/ethernetSwitching";
import { capturesAt, nicMacOf, portCable, portNeighbor, swTable, type EthLabState, type EthSwitchDecision, type EthTransmission } from "@/lib/sim-engine/scenarios/ethernetLab";
import { ethPortName } from "./ethLabCli";

/**
 * The Ethernet Lab's visual vocabulary. Everything is drawn from lab state (the same state the CLI prints and the
 * topology animates): a frame's fields, a switch's decision for that frame, the switch's ports, its table, a capture.
 */

export const who = (mac: string) => (mac === BROADCAST_MAC ? "broadcast" : macName(mac));
const field = (tx: EthTransmission, label: string) => tx.frame.layers[0].fields.find((f) => f.label === label)?.value ?? "";
export const txSrc = (tx: EthTransmission) => field(tx, "Source MAC");
export const txDst = (tx: EthTransmission) => field(tx, "Destination MAC");
/** A port's name in the OS view the student picked (SW1), or as the device names it (DESK-SW ports, host eth0). */
export const portLabel = (dev: EthDevice, port: string, vendor: CliVendor) => (dev === "SW1" ? ethPortName(vendor, port) : port);

/** The frame, field by field: what a switch and a NIC actually read. */
export function FrameCard({ tx, compact }: { tx: EthTransmission; compact?: boolean }) {
  const dst = txDst(tx);
  const src = txSrc(tx);
  const cells: { k: string; v: string; sub: string; tone: string }[] = [
    { k: "Destination MAC", v: dst, sub: dst === BROADCAST_MAC ? "broadcast: everyone" : `for ${who(dst)}`, tone: "border-pv-warning/60 bg-pv-warning/10" },
    { k: "Source MAC", v: src, sub: `from ${who(src)}`, tone: "border-pv-cyan/60 bg-pv-cyan/10" },
    { k: "EtherType", v: field(tx, "EtherType").split(" ")[0], sub: field(tx, "EtherType").includes("0806") ? "ARP inside" : "IPv4 inside", tone: "border-pv-border" },
    { k: "Payload", v: "…", sub: "untouched by switches", tone: "border-pv-border border-dashed" },
    { k: "FCS", v: "CRC-32", sub: "error check", tone: "border-pv-border" },
  ];
  return (
    <div className={clsx("grid gap-1", compact ? "grid-cols-2 sm:grid-cols-5" : "grid-cols-2 sm:grid-cols-5")} aria-label="Ethernet frame">
      {cells.map((c) => (
        <div key={c.k} className={clsx("min-w-0 rounded-lg border px-2 py-1", c.tone)}>
          <p className="text-[10px] font-bold uppercase tracking-wide text-pv-text-faint">{c.k}</p>
          <p className="truncate pv-mono text-[11.5px] text-pv-text">{c.v}</p>
          <p className="truncate text-[11px] text-pv-text-muted">{c.sub}</p>
        </div>
      ))}
    </div>
  );
}

/** What each host's network card did with the frame (the NIC compares the destination MAC with its own). */
export function NicVerdicts({ lab, tx }: { lab: EthLabState; tx: EthTransmission }) {
  const dst = txDst(tx);
  return (
    <ul className="grid gap-1 sm:grid-cols-3" aria-label="What each network card did">
      {(Object.keys(ETH_MAC) as EthHost[]).map((h) => {
        const r = tx.received.find((x) => x.host === h);
        const sent = tx.src === h;
        const tone = sent ? "border-pv-cyan/40" : !r ? "border-pv-border opacity-70" : r.accepted ? "border-pv-success/60 bg-pv-success/10" : "border-pv-border bg-white/[0.02]";
        return (
          <li key={h} className={clsx("rounded-lg border px-2 py-1", tone)}>
            <p className="text-[12px] font-bold text-pv-text">{h}</p>
            <p className="text-[11.5px] text-pv-text-muted">
              {sent ? "sent it" : !r ? "no copy reached it" : r.accepted ? (dst === BROADCAST_MAC ? "kept it: broadcast is for everyone" : "kept it: the destination is its own MAC") : `got a copy and discarded it: ${dst} isn't ${nicMacOf(lab, h)}`}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Inside the switch, for one frame: the five things a learning bridge does, in order. Each line is read from the
 * transmission's own record (what the model did), and appears only once the frame has reached that switch.
 */
export function SwitchMind({ lab, tx, sw, vendor, shownWave }: { lab: EthLabState; tx: EthTransmission; sw: EthSwitch; vendor: CliVendor; shownWave: number }) {
  const d: EthSwitchDecision | undefined = tx.decisions.find((x) => x.sw === sw);
  const l = tx.learned.find((x) => x.sw === sw);
  const src = txSrc(tx);
  const dst = txDst(tx);
  const reached = d && shownWave > d.wave;
  if ((!d || !l) && Math.min(shownWave, tx.wave) < tx.waves) return <p className="text-[12px] text-pv-text-faint">The frame is on its way…</p>;
  if (!d || !l)
    return <p className="text-[12px] text-pv-text-faint">No copy of this frame reached {sw}.</p>;
  if (!reached) return <p className="text-[12px] text-pv-text-faint">The frame is on its way to {sw}…</p>;
  const pn = (p: string) => portLabel(sw, p, vendor);
  const from = sw === "SW1" ? portNeighbor(lab, "SW1", d.ingress) : undefined;
  const rows: { n: number; k: string; v: React.ReactNode; tone?: string }[] = [
    { n: 1, k: "Arrived on", v: <>port <b>{pn(d.ingress)}</b>{from ? <span className="text-pv-text-muted"> (cable to {from})</span> : null}</> },
    {
      n: 2,
      k: "Learn the source",
      v:
        l.kind === "static" ? (
          <>source {src} has a <b>static</b> entry: nothing is learned</>
        ) : (
          <>
            <b>{who(src)}</b> ({src}) is behind <b>{pn(l.port)}</b> —{" "}
            {l.kind === "learned" ? "new entry" : l.kind === "refreshed" ? "already known: age reset to 0" : <span className="text-pv-warning">MOVED from {pn(l.from!)}</span>}
          </>
        ),
      tone: l.kind === "moved" ? "border-pv-warning/50" : "border-pv-cyan/40",
    },
    { n: 3, k: "Read the destination", v: <>{dst} <span className="text-pv-text-muted">({dst === BROADCAST_MAC ? "the broadcast address" : who(dst)})</span></> },
    {
      n: 4,
      k: "Look it up",
      v: d.kind === "broadcast" ? <>broadcast: no lookup needed, it is for everyone</> : d.kind === "unknown-unicast" ? <><b className="text-pv-warning">not in the table</b>: {sw} doesn&apos;t know where {who(dst)} is</> : <>found: {who(dst)} is behind <b>{pn(d.hit!.port)}</b>{d.hit!.type === "static" ? " (static entry)" : ""}</>,
      tone: d.kind === "unknown-unicast" ? "border-pv-warning/50" : undefined,
    },
    {
      n: 5,
      k: "Decide",
      v:
        d.kind === "known-unicast" ? (
          d.egress.length ? (
            <><b className="text-pv-success">FORWARD</b> out {pn(d.egress[0])} only</>
          ) : d.hit!.port === d.ingress ? (
            <><b>FILTER</b>: the destination is behind the port it came in on</>
          ) : (
            <><b className="text-pv-danger">DROP</b>: {pn(d.hit!.port)} has no link</>
          )
        ) : d.egress.length ? (
          <><b className="text-pv-warning">FLOOD</b> out {d.egress.map(pn).join(", ")} — every up port except {pn(d.ingress)}</>
        ) : (
          <>flood, but no other port is up: nothing to send</>
        ),
      tone: "border-pv-violet/50",
    },
  ];
  return (
    <ol className="space-y-1" aria-label={`${sw}'s decision`}>
      {rows.map((r, i) => (
        <li key={r.n} className={clsx("pv-pop flex gap-2 rounded-lg border px-2 py-1", r.tone ?? "border-pv-border")} style={{ animationDelay: `${i * 160}ms` }}>
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[11px] font-bold text-pv-text">{r.n}</span>
          <div className="min-w-0 text-[12.5px] leading-snug">
            <span className="mr-1 text-[10.5px] font-bold uppercase tracking-wide text-pv-text-faint">{r.k}</span>
            <span className="text-pv-text">{r.v}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** A switch's front panel: link lights, port names, what each cable leads to, and the last frame's in/out ports. Click a port to predict. */
export function Faceplate({ lab, sw = "SW1", vendor, tx, shownWave = 99, picked, onPick, counters }: { lab: EthLabState; sw?: EthSwitch; vendor: CliVendor; tx?: EthTransmission; shownWave?: number; picked?: string[]; onPick?: (port: string) => void; counters?: boolean }) {
  const ports = sw === "SW1" ? [...SW1_PORTS] : [...DESK_PORTS];
  const d = tx?.decisions.find((x) => x.sw === sw && shownWave > x.wave);
  return (
    <div className="rounded-xl border border-pv-border bg-[#0b1018] p-2" aria-label={`${sw} ports`}>
      <div className="mb-1 flex items-center justify-between">
        <span className="pv-mono text-[11px] font-bold text-pv-text">{sw}</span>
        <span className="text-[10px] text-pv-text-faint">{sw === "SW1" ? (vendor === "cisco" ? "Catalyst · IOS view" : "EX · Junos view") : "unmanaged"}</span>
      </div>
      <div className={clsx("grid gap-1.5", ports.length === 4 ? "grid-cols-4" : "grid-cols-2")}>
        {ports.map((p) => {
          const upL = !!portNeighbor(lab, sw, p);
          const shut = sw === "SW1" && lab.cfg.shut.includes(p);
          const cable = portCable(lab, sw, p);
          const isIn = d?.ingress === p;
          const isOut = d?.egress.includes(p);
          const pick = picked?.includes(p);
          const c = lab.counters[`${sw} ${p}`];
          const body = (
            <>
              <span className={clsx("mx-auto block h-2.5 w-2.5 rounded-full", shut ? "bg-pv-warning" : upL ? "bg-pv-success" : "bg-white/15")} aria-hidden />
              <span className="mt-0.5 block truncate pv-mono text-[10.5px] font-bold text-pv-text">{portLabel(sw, p, vendor)}</span>
              <span className="block truncate text-[10px] text-pv-text-muted">{shut ? "shut down" : cable ? `→ ${cable}` : "no cable"}</span>
              {isIn && <span className="mt-0.5 block text-[10px] font-bold text-pv-cyan-soft">in ▲</span>}
              {isOut && <span className="mt-0.5 block text-[10px] font-bold text-pv-warning">out ▼</span>}
              {counters && c && <span className="mt-0.5 block pv-mono text-[9.5px] text-pv-text-faint">in {c.inFrames} · out {c.outFrames}</span>}
            </>
          );
          const cls = clsx("min-w-0 rounded-lg border px-1 py-1 text-center", pick ? "border-pv-violet bg-pv-violet/15" : isOut ? "border-pv-warning/70 bg-pv-warning/10" : isIn ? "border-pv-cyan/70 bg-pv-cyan/10" : "border-pv-border");
          return onPick ? (
            <button key={p} type="button" aria-pressed={pick} onClick={() => onPick(p)} className={clsx(cls, "hover:border-pv-violet/70")}>
              {body}
            </button>
          ) : (
            <div key={p} className={cls}>
              {body}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A switch's table, as the switch holds it right now (fresh lines are the ones the last frame created or moved). */
export function MacTable({ lab, sw, vendor, tx, caption }: { lab: EthLabState; sw: EthSwitch; vendor: CliVendor; tx?: EthTransmission; caption?: string }) {
  const rows = swTable(lab, sw);
  const fresh = (mac: string) => tx?.learned.some((l) => l.sw === sw && l.mac === mac && (l.kind === "learned" || l.kind === "moved"));
  return (
    <div className="rounded-xl border border-pv-border p-2" aria-label={`${sw} table`}>
      <p className="mb-1 flex items-baseline justify-between gap-2 text-[11px] font-bold uppercase tracking-wide text-pv-cyan-soft">
        {sw} MAC table
        <span className="font-normal normal-case tracking-normal text-pv-text-faint">{caption ?? (sw === "DESK-SW" ? "unmanaged: shown from the simulation" : `aging ${lab.cfg.aging} s`)}</span>
      </p>
      {rows.length === 0 ? (
        <p className="pv-mono text-[11.5px] text-pv-text-faint">empty: {sw} knows no MAC address</p>
      ) : (
        <table className="w-full text-left pv-mono text-[11.5px]">
          <thead className="text-[10px] text-pv-text-faint">
            <tr>
              <th className="font-normal">MAC</th>
              <th className="font-normal">host</th>
              <th className="font-normal">port</th>
              <th className="font-normal">type · age</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.mac} className={clsx(fresh(e.mac) && "pv-pop text-pv-success")}>
                <td className="pr-1">{e.mac}</td>
                <td className="pr-1 font-sans">{who(e.mac)}</td>
                <td className="pr-1">{portLabel(sw, e.port, vendor)}</td>
                <td>{e.type === "static" ? "static" : `${e.age} s`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Every frame seen at one port, as a capture there would show it. */
export function CaptureList({ lab, dev, iface, vendor, max = 40 }: { lab: EthLabState; dev: EthDevice; iface: string; vendor: CliVendor; max?: number }) {
  const rows = capturesAt(lab, dev, iface).slice(-max);
  if (!rows.length) return <p className="pv-mono text-[11.5px] text-pv-text-faint">No frame has crossed {dev} {portLabel(dev, iface, vendor)} since the lab started (or since the ticket was reported).</p>;
  return (
    <div className="max-h-64 overflow-auto rounded-lg border border-pv-border">
      <table className="w-full min-w-[420px] text-left pv-mono text-[11px]">
        <thead className="sticky top-0 bg-pv-bg text-[10px] text-pv-text-faint">
          <tr>
            <th className="px-1.5 py-0.5 font-normal">No.</th>
            <th className="px-1.5 font-normal">dir</th>
            <th className="px-1.5 font-normal">source → destination</th>
            <th className="px-1.5 font-normal">type</th>
            <th className="px-1.5 font-normal">what {dev} did</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.no} className={clsx("border-t border-pv-border/50", /discarded/.test(c.note ?? "") && "text-pv-text-faint", /accepted/.test(c.note ?? "") && "text-pv-success")}>
              <td className="px-1.5 py-0.5">{c.no}</td>
              <td className="px-1.5">{c.dir === "in" ? "← in" : "→ out"}</td>
              <td className="px-1.5">
                {who(c.src)} → {who(c.dst)}
              </td>
              <td className="px-1.5">{c.etherType}</td>
              <td className="px-1.5 font-sans">{c.note ?? (c.dir === "out" ? "sent" : "")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
