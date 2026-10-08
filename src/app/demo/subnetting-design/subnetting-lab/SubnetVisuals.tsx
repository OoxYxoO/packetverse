"use client";

import { PARENT, blockSize } from "@/lib/sim-engine/scenarios/subnettingDesign";
import { dotOct, overlapMatrix, rangeLabel, slMinPrefix, slUsable, type SlRow, type SlRowCheck, type SlSeg } from "@/lib/sim-engine/scenarios/subnettingLab";

/**
 * Subnet Explorer — small shared pieces: plain-language validator verdicts.
 * Everything is derived from the lab model (validateRow, overlapMatrix); nothing here computes subnet
 * arithmetic of its own.
 */

const SIZE = blockSize(PARENT.prefix);
export const segName = (id: SlSeg) => (id === "TRANSIT" ? "Transit" : id);

export function startsText(prefix: number) {
  const b = blockSize(prefix);
  const n = SIZE / b;
  const list = Array.from({ length: Math.min(n, 8) }, (_, i) => `.${i * b}`);
  return n <= 8 ? list.join(" · ") : `${list.slice(0, 4).join(" · ")} … (every ${b})`;
}
export interface Plain {
  tone: "bad" | "warn";
  title: string;
  body: string;
}
/** The validator's verdicts, said in plain words (the technical code stays in Engineer Details). */
export function plainViolations(c: SlRowCheck, rows: SlRow[]): Plain[] {
  const out: Plain[] = [];
  for (const v of c.violations) {
    if (v.code === "MISALIGNED") out.push({ tone: "bad", title: `Not a place where a /${c.prefix} block can start`, body: `A /${c.prefix} block starts every ${blockSize(c.prefix)} addresses: ${startsText(c.prefix)}. ${dotOct(c.written)} is inside the ${rangeLabel(c.realRange)} block — that's the block devices will really use.` });
    if (v.code === "OVERLAP" && v.with) {
      const cell = overlapMatrix(rows).cells.find((x) => (x.a === c.id && x.b === v.with) || (x.b === c.id && x.a === v.with));
      out.push({ tone: "bad", title: `${segName(c.id)} and ${segName(v.with)} claim some of the same addresses`, body: `Both use ${cell?.shared ? rangeLabel(cell.shared) : "the same range"} (the red squares). An address can belong to only one network.` });
    }
    if (v.code === "OUTSIDE_PARENT") out.push({ tone: "bad", title: `Outside your ${PARENT.network}/${PARENT.prefix}`, body: `${rangeLabel(c.realRange)} isn't on your board — it's not address space you own.` });
    if (v.code === "TOO_SMALL") out.push({ tone: "bad", title: "Too small", body: `A /${c.prefix} block holds ${slUsable(c.prefix)} devices; ${segName(c.id)} needs ${c.hosts}.` });
  }
  if (c.oversized) out.push({ tone: "warn", title: "Fits — but bigger than needed", body: `A /${slMinPrefix(c.hosts)} block (${slUsable(slMinPrefix(c.hosts))} devices) would already hold ${c.hosts}. Still valid; it just uses more space.` });
  return out;
}
