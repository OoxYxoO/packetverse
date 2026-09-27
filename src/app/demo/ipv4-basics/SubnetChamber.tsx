"use client";

import { useState } from "react";
import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { V4_IP, V4_PREFIX, blockSize, broadcastOf, hostRange, maskOf, networkOf, sameSubnet } from "@/lib/sim-engine/scenarios/ipv4Basics";

const PREFIXES = [24, 25, 26, 27, 28];
const PRESETS = [10, 63, 64, 70, 130, 200];

/** Interactive subnet calculator. Every number comes from the scenario's own CIDR functions. */
export function SubnetChamber() {
  const [octet, setOctet] = useState(70);
  const [prefix, setPrefix] = useState(V4_PREFIX);
  const ip = `192.168.10.${octet}`;
  const range = hostRange(ip, prefix);
  const hostBits = 32 - prefix;
  const bits = octet.toString(2).padStart(8, "0");
  const netBitsInOctet = Math.max(0, 8 - hostBits);
  const same = sameSubnet(ip, V4_IP["HOST-A"], prefix);
  const rows = [
    { k: "Prefix / mask", v: `/${prefix} = ${maskOf(prefix)}` },
    { k: "Borrowed from /24", v: `${prefix - 24} bit${prefix - 24 === 1 ? "" : "s"} → ${2 ** (prefix - 24)} subnet${prefix === 24 ? "" : "s"}` },
    { k: "Block size", v: `${blockSize(prefix)} addresses` },
    { k: "Network", v: `${networkOf(ip, prefix)}/${prefix}` },
    { k: "Broadcast", v: broadcastOf(ip, prefix) },
    { k: "Host range", v: range ? `${range.first} – ${range.last} (${range.count})` : "n/a" },
  ];
  return (
    <GlassPanel className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-pv-cyan-soft">Subnet chamber</h3>
        <span className="pv-mono text-sm text-pv-text">
          {ip}/{prefix}
        </span>
      </div>
      <div className="space-y-2">
        <label className="flex flex-wrap items-center gap-3 text-xs text-pv-text-muted">
          Last octet
          <input type="range" min={0} max={255} value={octet} onChange={(e) => setOctet(Number(e.target.value))} className="min-w-0 flex-1 accent-cyan-400" aria-label="Last octet" />
          <span className="pv-mono w-8 text-right text-pv-text">{octet}</span>
        </label>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button key={p} type="button" onClick={() => setOctet(p)} className={clsx("rounded-full border px-2.5 py-0.5 pv-mono text-[11px]", p === octet ? "border-pv-cyan bg-pv-cyan/15 text-pv-cyan-soft" : "border-pv-border text-pv-text-muted hover:border-pv-cyan/40")}>
              .{p}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PREFIXES.map((p) => (
            <button key={p} type="button" onClick={() => setPrefix(p)} className={clsx("rounded-full border px-2.5 py-0.5 pv-mono text-[11px]", p === prefix ? "border-pv-violet bg-pv-violet/15 text-pv-violet" : "border-pv-border text-pv-text-muted hover:border-pv-violet/40")}>
              /{p}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border border-pv-border p-3">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">Last octet in binary</p>
        <p className="pv-mono text-base tracking-[0.2em]">
          {bits.split("").map((b, i) => (
            <span key={i} className={i < netBitsInOctet ? "text-pv-violet" : "text-pv-success"}>
              {b}
            </span>
          ))}
        </p>
        <p className="mt-1 text-[10px] text-pv-text-faint">
          <span className="text-pv-violet">network bits</span> · <span className="text-pv-success">host bits</span> ({hostBits} host bits in total)
        </p>
      </div>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {rows.map((r) => (
          <div key={r.k} className="rounded-lg border border-pv-border px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-pv-text-faint">{r.k}</p>
            <p className="pv-mono break-all text-xs text-pv-text">{r.v}</p>
          </div>
        ))}
      </div>
      <p className={clsx("rounded-lg border px-3 py-2 text-xs", same ? "border-pv-success/40 bg-pv-success/5 text-pv-success" : "border-pv-warning/40 bg-pv-warning/5 text-pv-warning")}>
        With /{prefix}, {ip} is {same ? "in the SAME subnet as" : "in a DIFFERENT subnet from"} HOST-A ({V4_IP["HOST-A"]}).
      </p>
    </GlassPanel>
  );
}
