"use client";

import { clsx } from "clsx";
import type { PacketVisual } from "@/lib/sim-engine/types";
import { v4Owner } from "@/lib/sim-engine/scenarios/ipv4Lab";

/**
 * Before/after R1 (IPv4-specific): the frame R1 received and the frame it sent, field by field, each marked CHANGED or
 * UNCHANGED. Values come straight from the lab model's frames (real RFC 791 checksums). Stacks vertically on phones.
 */
const ROWS: { layer: RegExp; label: string; group: string }[] = [
  { layer: /^Ethernet/, label: "Source MAC", group: "Ethernet (this link only)" },
  { layer: /^Ethernet/, label: "Destination MAC", group: "Ethernet (this link only)" },
  { layer: /^IPv4/, label: "Version", group: "IPv4 header" },
  { layer: /^IPv4/, label: "IHL", group: "IPv4 header" },
  { layer: /^IPv4/, label: "DSCP / ECN", group: "IPv4 header" },
  { layer: /^IPv4/, label: "Total Length", group: "IPv4 header" },
  { layer: /^IPv4/, label: "Identification", group: "IPv4 header" },
  { layer: /^IPv4/, label: "Flags", group: "IPv4 header" },
  { layer: /^IPv4/, label: "Fragment Offset", group: "IPv4 header" },
  { layer: /^IPv4/, label: "TTL", group: "IPv4 header" },
  { layer: /^IPv4/, label: "Protocol", group: "IPv4 header" },
  { layer: /^IPv4/, label: "Header Checksum", group: "IPv4 header" },
  { layer: /^IPv4/, label: "Source", group: "IPv4 header" },
  { layer: /^IPv4/, label: "Destination", group: "IPv4 header" },
  { layer: /^UDP/, label: "Length", group: "Payload (UDP)" },
];
const val = (p: PacketVisual, re: RegExp, label: string) => p.layers.find((l) => re.test(l.name))?.fields.find((f) => f.label === label)?.value ?? "—";

export function V4PacketDiff({ before, after, why }: { before: PacketVisual; after: PacketVisual; why?: Partial<Record<string, string>> }) {
  return (
    <figure className="rounded-xl border border-pv-border p-2.5" aria-label="Packet before and after R1">
      <figcaption className="mb-1.5 text-[11px] font-bold text-pv-text">Before R1 (as R1 received it) vs after R1 (as R1 sent it)</figcaption>
      <div className="hidden grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-x-2 border-b border-pv-border pb-1 text-[10px] font-bold uppercase tracking-wide text-pv-text-faint sm:grid">
        <span>Field</span>
        <span>Before R1</span>
        <span>After R1</span>
        <span />
      </div>
      <ul className="divide-y divide-pv-border/50">
        {ROWS.map((r, i) => {
          const a = val(before, r.layer, r.label);
          const b = val(after, r.layer, r.label);
          const changed = a !== b;
          const header = i === 0 || ROWS[i - 1].group !== r.group;
          return (
            <li key={`${r.group}-${r.label}`}>
              {header && <p className="pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">{r.group}</p>}
              <div className={clsx("grid grid-cols-1 gap-x-2 py-0.5 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-baseline", changed && "rounded bg-pv-warning/[0.06]")}>
                <span className="text-[11px] text-pv-text-muted">
                  {r.label}
                  <span className={clsx("ml-1.5 rounded px-1 text-[9px] font-bold sm:hidden", changed ? "bg-pv-warning/20 text-pv-warning" : "bg-pv-success/15 text-pv-success")}>{changed ? "CHANGED" : "UNCHANGED"}</span>
                </span>
                <span className="break-all pv-mono text-[11px] text-pv-text">
                  <span className="text-pv-text-faint sm:hidden">before </span>
                  {a}
                  {v4Owner(a) && r.layer.source.includes("Ethernet") && <span className="text-pv-text-faint"> ({v4Owner(a)})</span>}
                </span>
                <span className={clsx("break-all pv-mono text-[11px]", changed ? "font-bold text-pv-warning" : "text-pv-text")}>
                  <span className="font-normal text-pv-text-faint sm:hidden">after </span>
                  {b}
                  {v4Owner(b) && r.layer.source.includes("Ethernet") && <span className="font-normal text-pv-text-faint"> ({v4Owner(b)})</span>}
                </span>
                <span className={clsx("hidden rounded px-1 text-[9px] font-bold sm:inline", changed ? "bg-pv-warning/20 text-pv-warning" : "bg-pv-success/15 text-pv-success")}>{changed ? "CHANGED" : "UNCHANGED"}</span>
              </div>
              {changed && why?.[r.label] && <p className="pb-0.5 text-[10.5px] text-pv-text-muted">← {why[r.label]}</p>}
            </li>
          );
        })}
      </ul>
    </figure>
  );
}
