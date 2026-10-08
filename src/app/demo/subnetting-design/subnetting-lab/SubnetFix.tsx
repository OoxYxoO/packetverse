"use client";

import { useEffect, useState } from "react";
import { SEGMENTS, blockSize, maskOf } from "@/lib/sim-engine/scenarios/subnettingDesign";
import { lastOctet, overlapMatrix, rangeLabel, validateRow, type SlRow, type SlSeg } from "@/lib/sim-engine/scenarios/subnettingLab";
import { SEG_COLOR } from "./SubnetRuler";
import { AddressGrid, Legend, type SnapOverlay } from "./SubnetGrid";
import { segName } from "./SubnetVisuals";
import { BitBar, Btn, Idea, Lead, Now, Predict, Scene, TryList, alpha, blank, ip, off, paint, useSeen } from "./SubnetKit";

/**
 * FIX — how plans break, then a real broken plan:
 *   8 · Written vs real   slide a block's written start around: the real block (address AND mask) snaps to a grid
 *                         line, and may land on a neighbor
 * (The spreadsheet incident itself — the same .160/26 on a real network — is a ticket in Engineer · Troubleshoot.)
 */

const BOARD_LABEL = "Address board 10.44.0.0/24: 256 addresses, 16 per row";
const hostsOf = (id: SlSeg) => SEGMENTS.find((s) => s.id === id)?.hosts ?? 0;

// =============================================================================================================
// 8 · Written vs real
// =============================================================================================================
const FIXED: SlRow[] = [
  { id: "LAN-A", hosts: hostsOf("LAN-A"), prefix: 25, network: ip(0) },
  { id: "LAN-C", hosts: hostsOf("LAN-C"), prefix: 27, network: ip(128) },
  { id: "TRANSIT", hosts: hostsOf("TRANSIT"), prefix: 30, network: ip(160) },
];

export function FixWrittenVsReal() {
  const [w, setWRaw] = useState(160);
  const [p, setP] = useState(26);
  const [seen, mark] = useSeen();
  const setW = (v: number) => {
    const x = Math.max(0, Math.min(255, v));
    setWRaw(x);
    if (x === 160 && p === 26) mark("160");
  };
  const rows: SlRow[] = [...FIXED, { id: "LAN-B", hosts: hostsOf("LAN-B"), prefix: p, network: ip(w) }];
  const c = validateRow(rows, "LAN-B")!;
  const real = lastOctet(c.real);
  const size = blockSize(p);
  const overlap = c.violations.find((v) => v.code === "OVERLAP");
  const shared = overlapMatrix(rows).cells.find((x) => (x.a === "LAN-B" || x.b === "LAN-B") && x.shared)?.shared;
  const sharedAt = shared ? Math.min(off(shared.last), off(shared.first) + 1) : real;
  const hits = c.violations.filter((v) => v.code === "OVERLAP").map((v) => (
    <b key={v.with} style={{ color: SEG_COLOR[v.with!] }}>
      {segName(v.with!)}
    </b>
  ));
  const hitList = hits.flatMap((h, i) => (i === 0 ? [h] : [<span key={`s${i}`}>{i === hits.length - 1 ? " and " : ", "}</span>, h]));
  useEffect(() => {
    if (c.aligned) mark("aligned");
    if (overlap) mark("overlap");
    if (c.valid) mark("valid");
  }, [c.aligned, c.valid, overlap, mark]);

  const cells = blank();
  for (const r of rows) {
    const rc = validateRow(rows, r.id)!;
    paint(cells, off(rc.realRange.first), rc.realRange.last - rc.realRange.first + 1, (i) => ({ fill: alpha(SEG_COLOR[r.id], r.id === "LAN-B" ? 0.5 : 0.3), group: r.id, groupColor: SEG_COLOR[r.id], pour: i }));
  }
  for (let o = off(c.writtenRange.first); o <= Math.min(255, off(c.writtenRange.last)); o++) cells[o] = { ...cells[o], dashed: SEG_COLOR["LAN-B"] };
  for (const cell of overlapMatrix(rows).cells) if (cell.shared) for (let o = off(cell.shared.first); o <= off(cell.shared.last); o++) cells[o] = { ...cells[o], clash: true };
  cells[w] = { ...cells[w], ring: c.aligned ? "ok" : "bad" };
  const overlays: SnapOverlay[] = c.aligned ? [] : [{ key: `${w}-${p}`, first: real, size, color: SEG_COLOR["LAN-B"], from: w - real, label: `real: .${real}/${p}` }];

  return (
    <Scene
      board={
        <AddressGrid
          cells={cells}
          onTap={setW}
          overlays={overlays}
          label={BOARD_LABEL}
          footer={<Legend items={[{ color: SEG_COLOR["LAN-B"], label: "LAN-B as written", dashed: true }, { color: SEG_COLOR["LAN-B"], label: "LAN-B real block" }, { color: "#f87171", label: "claimed twice", clash: true }]} />}
        />
      }
      hint="Tap any square to write LAN-B's start there"
      side={
        <>
          <Lead kicker="Fix · 1 of 2" title="Written vs real: how plans break">
            <p>A network address in a plan is just text someone typed. Devices don&apos;t trust it. They compute the real block themselves: <b className="text-pv-text">address AND mask</b>. Move LAN-B&apos;s written start and compare.</p>
          </Lead>
          <div className="space-y-2 rounded-2xl border border-pv-cyan/35 bg-pv-cyan/[0.05] p-3">
            <div className="flex items-baseline justify-between">
              <label htmlFor="sl-written" className="text-[13px] font-semibold text-pv-text-muted">
                LAN-B written as
              </label>
              <span className="pv-mono text-[20px] font-bold text-pv-text">
                10.44.0.{w}/{p}
              </span>
            </div>
            <input id="sl-written" type="range" min={0} max={255} value={w} onChange={(e) => setW(Number(e.target.value))} className="w-full accent-[#a78bfa]" />
            <div className="flex flex-wrap items-center gap-1.5">
              <Btn tone="quiet" onClick={() => setW(w - 1)}>
                ◀ 1
              </Btn>
              <Btn tone="quiet" onClick={() => setW(w + 1)}>
                1 ▶
              </Btn>
              <span className="ml-auto flex gap-1" role="group" aria-label="LAN-B prefix">
                {[25, 26, 27, 28].map((x) => (
                  <Btn key={x} tone="quiet" pressed={p === x} onClick={() => setP(x)}>
                    /{x}
                  </Btn>
                ))}
              </span>
            </div>
          </div>
          <BitBar octet={w} prefix={p} clear caption={<p>Top: what was written. Bottom: host bits cleared, the real start every device computes.</p>} />
          {c.aligned ? (
            <Now k={`a${w}-${p}`} tone={overlap ? "bad" : "ok"} title={`✓ .${w} is a /${p} grid line: written = real (${rangeLabel(c.realRange)}).`}>
              {overlap ? (
                <p>
                  But it sits on {hitList}: the red squares belong to two networks.
                </p>
              ) : (
                <p>No neighbor touched. This placement is valid.</p>
              )}
            </Now>
          ) : (
            <Now k={`m${w}-${p}`} tone="bad" title={`.${w} isn't a /${p} grid line, so the real block is .${real}–.${real + size - 1}.`}>
              <p>
                {w} AND {maskOf(p).split(".")[3]} = <b className="text-pv-text">{real}</b>. The dashed block is what the plan says. The solid block is what every device actually uses.
              </p>
              {overlap && (
                <>
                <p>
                  The real block lands on {hitList}, so two networks now claim the same addresses (red).
                </p>
                <p>
                  <b className="text-pv-text">Why that&apos;s a real problem:</b> take address .{sharedAt}. Which network is it on? Both say “mine”. A device in one network thinks devices in the other are local and never asks the router, and the router can only send traffic for those addresses to one side. Something always ends up unreachable.
                </p>
                </>
              )}
            </Now>
          )}
          <Idea>
            <p>The real block is always <b>address AND mask</b>. If the written address isn&apos;t on a grid line, the real block is somewhere else, and it can land on a neighbor without anyone noticing on paper.</p>
          </Idea>
          <Predict
            q="LAN-B written as .200/26: where is its real block?"
            options={[".192–.255", ".200–.263", ".128–.191"]}
            answer={0}
            onTest={() => {
              setP(26);
              setW(200);
            }}
            explain={<p>200 AND 192 = 192. The block is .192–.255, and here that happens to be free. A written address can be wrong and still “work”, which is why these mistakes hide until something else moves.</p>}
          />
          <TryList
            items={[
              { text: <>Write <b>.160/26</b> and watch the real block slide back.</>, done: !!seen["160"] },
              { text: <>Find a start where written = real.</>, done: !!seen.aligned },
              { text: <>Make LAN-B overlap a neighbor.</>, done: !!seen.overlap },
              { text: <>Find the one place a /26 fits cleanly.</>, done: !!seen.valid },
            ]}
          />
        </>
      }
    />
  );
}
