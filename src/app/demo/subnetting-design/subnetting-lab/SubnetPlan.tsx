"use client";

import { useMemo, useState } from "react";
import { clsx } from "clsx";
import { SEGMENTS, blockSize, type SegId } from "@/lib/sim-engine/scenarios/subnettingDesign";
import { equalSplit, firstFit, freeSpace, lastOctet, rangeLabel, slMinPrefix, type SlRow } from "@/lib/sim-engine/scenarios/subnettingLab";
import { SEG_COLOR } from "./SubnetRuler";
import { AddressGrid, Legend, type SnapOverlay } from "./SubnetGrid";
import { segName } from "./SubnetVisuals";
import { Btn, Idea, Lead, Now, Predict, PrefixSlider, Scene, TryList, alpha, blank, ip, paint, tile, useSeen, useStepper } from "./SubnetKit";

/**
 * PLAN — from "how blocks work" to "a plan that works":
 *   5 · One size for everyone?  pour the four networks into an equal split (FLSM) and watch it fail
 *   6 · Right-size and pack     each network gets its smallest box; watch each box hunt for a free grid line (VLSM)
 * (Designing a whole plan freely, with every rule verified, is the Engineer stage: SubnetStudio.tsx.)
 */

const BOARD_LABEL = "Address board 10.44.0.0/24: 256 addresses, 16 per row";
const WASTE = "rgba(148,163,184,0.20)";

// =============================================================================================================
// 5 · One size for everyone? (FLSM)
// =============================================================================================================
const FLSM_TITLE: Record<number, string> = {
  25: "/25: two big halves, but you have four networks.",
  26: "/26: four blocks, one each. But LAN-A doesn't fit in 62.",
  27: "/27: eight blocks of 30 devices. LAN-A and LAN-B overflow.",
  28: "/28: sixteen blocks of 14 devices. Only Transit fits.",
};

export function PlanEqualSplit() {
  const [prefix, setPrefixRaw] = useState(26);
  const [seen, mark] = useSeen();
  const [play, , playing] = useStepper();
  const setPrefix = (p: number) => {
    setPrefixRaw(p);
    mark(`p${p}`);
  };
  const f = equalSplit(prefix);
  const b = f.block;
  const cells = blank();
  tile(cells, prefix, { lit: false });
  for (let o = SEGMENTS.length * b; o < 256; o++) cells[o] = { ...cells[o], dim: true };
  const spills: (() => void)[] = [];
  const rows = SEGMENTS.map((s, i) => {
    if (i >= f.count) return { s, status: "none" as const, waste: 0, short: 0 };
    const start = i * b;
    const used = Math.min(s.hosts, f.usable);
    const color = SEG_COLOR[s.id];
    paint(cells, start, b, (k) => (k === 0 ? { fill: alpha(color, 0.3), tag: "N" } : k === b - 1 ? { fill: alpha(color, 0.3), tag: "B" } : k <= used ? { fill: alpha(color, 0.55), pour: k } : { fill: WASTE, dashed: "rgba(148,163,184,0.55)" }));
    const over = s.hosts - f.usable;
    if (over > 0) spills.push(() => paint(cells, start + b, over, (k) => ({ fill: alpha(color, 0.5), clash: true, pour: k + used })));
    return { s, status: over > 0 ? ("short" as const) : ("fits" as const), waste: Math.max(0, f.usable - s.hosts), short: Math.max(0, over) };
  });
  spills.forEach((sp) => sp()); // after every block, so a spill visibly lands on its neighbor
  const wasted = rows.reduce((n, r) => n + r.waste, 0);

  return (
    <Scene
      board={
        <AddressGrid
          cells={cells}
          label={BOARD_LABEL}
          footer={<Legend items={[...SEGMENTS.map((s) => ({ color: SEG_COLOR[s.id], label: segName(s.id) })), { color: "rgba(148,163,184,0.8)", label: "unused (wasted)", dashed: true }, { color: "#f87171", label: "doesn't fit (spills out)", clash: true }]} />}
        />
      }
      hint="Move the slider: every network gets one equal block"
      side={
        <>
          <Lead kicker="Plan · 1 of 3" title="One size for everyone? (FLSM)">
            <p>
              Your four networks need <b className="text-pv-text">100, 50, 25 and 2</b> device addresses (each count includes the router). The simplest idea: cut the /24 into equal blocks (<b className="text-pv-text">FLSM</b>, Fixed-Length Subnet Masks) and give each network one block.
            </p>
          </Lead>
          <PrefixSlider value={prefix} onChange={setPrefix} min={25} max={28} label="Equal block size" />
          <Now k={`p${prefix}`} tone={rows.every((r) => r.status === "fits") ? "ok" : "warn"} title={FLSM_TITLE[prefix]}>
            <ul className="space-y-1">
              {rows.map((r) => (
                <li key={r.s.id} className="flex gap-2">
                  <span className="mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: SEG_COLOR[r.s.id] }} />
                  <span>
                    <b className="text-pv-text">{segName(r.s.id)}</b> needs {r.s.hosts}:{" "}
                    {r.status === "none" ? (
                      <b className="text-pv-danger">no block left for it.</b>
                    ) : r.status === "short" ? (
                      <b className="text-pv-danger">
                        too big, {r.short} devices spill out (red).
                      </b>
                    ) : (
                      <>
                        fits{r.waste > 0 && <>, but leaves <b className="text-pv-warning">{r.waste} addresses unused</b></>}.
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <p>
              /{prefix} borrows {f.borrowed} bit{f.borrowed > 1 ? "s" : ""} from the /24: 2^{f.borrowed} = <b className="text-pv-text">{f.count} subnets</b>, each 2^{32 - prefix} = {f.block} addresses ({f.usable} usable). Every subnet gets the same prefix. Wasted inside used blocks: <b className="text-pv-text">{wasted}</b>.
            </p>
          </Now>
          <Idea>
            <p>An equal split has to be as big as your <b>biggest</b> network, but bigger blocks means <b>fewer</b> blocks. No single size works for 100, 50, 25 and 2.</p>
            <p className="text-pv-text-muted">The fix: let each network have its own size. That&apos;s VLSM (Variable-Length Subnet Masks), next.</p>
          </Idea>
          <Predict
            q="Is there any equal size that works for all four networks?"
            options={["/25", "/26", "/27", "None works"]}
            answer={3}
            onTest={() => {
              mark("predict");
              play([25, 26, 27, 28], 1500, (p) => setPrefix(p));
            }}
            explain={<p>{playing ? "Watch the slider walk through every option…" : "/25 has too few blocks; /26 and smaller are too small for LAN-A. Equal sizes can't serve unequal networks."}</p>}
          />
          <TryList
            items={[
              { text: <>Try <b>/25</b>: who gets nothing?</>, done: !!seen.p25 },
              { text: <>Try <b>/26</b>: look at the red spill and the gray waste in Transit&apos;s block.</>, done: !!seen.p26 || !!seen.predict },
              { text: <>Try <b>/27</b> and <b>/28</b>.</>, done: !!seen.p27 && !!seen.p28 },
            ]}
          />
        </>
      }
    />
  );
}

// =============================================================================================================
// 6 · Right-size and pack (VLSM)
// =============================================================================================================
interface Frame {
  seg: SegId;
  prefix: number;
  start: number;
  ok: boolean;
}
function packFrames(order: SegId[]): Frame[] {
  const rows: SlRow[] = [];
  const frames: Frame[] = [];
  for (const seg of order) {
    const hosts = SEGMENTS.find((s) => s.id === seg)!.hosts;
    const prefix = slMinPrefix(hosts);
    const fit = firstFit(rows, seg, hosts);
    const final = fit ? lastOctet(fit.network) : undefined;
    for (let n = 0; n < 256; n += blockSize(prefix)) {
      const ok = n === final;
      frames.push({ seg, prefix, start: n, ok });
      if (ok) break;
    }
    if (fit) rows.push({ id: seg, hosts, prefix, network: fit.network });
  }
  return frames;
}
const BIG_FIRST = [...SEGMENTS].sort((a, b) => b.hosts - a.hosts).map((s) => s.id);
const SMALL_FIRST = [...BIG_FIRST].reverse();

export function PlanRightSize() {
  const [order, setOrder] = useState<"big" | "small">("big");
  const frames = useMemo(() => packFrames(order === "big" ? BIG_FIRST : SMALL_FIRST), [order]);
  const bigLen = useMemo(() => packFrames(BIG_FIRST).length, []);
  const [idx, setIdx] = useState(0);
  const [seen, mark] = useSeen();
  const [play, stop, playing] = useStepper();
  const placedFrames = frames.slice(0, idx).filter((f) => f.ok);
  const probe = idx > 0 ? frames[idx - 1] : undefined;
  const done = idx >= frames.length;
  const owner = (o: number) => placedFrames.find((f) => o >= f.start && o < f.start + blockSize(f.prefix));

  const cells = blank();
  for (const f of placedFrames) paint(cells, f.start, blockSize(f.prefix), (i) => ({ fill: alpha(SEG_COLOR[f.seg], 0.45), group: f.seg, groupColor: SEG_COLOR[f.seg], pour: i }));
  if (probe && !probe.ok) {
    paint(cells, probe.start, blockSize(probe.prefix), () => ({ dashed: "#f87171" }));
    for (let o = probe.start; o < probe.start + blockSize(probe.prefix); o++) if (owner(o)) cells[o] = { ...cells[o], clash: true };
  }
  const overlays: SnapOverlay[] = probe?.ok ? [{ key: `${order}-${idx}`, first: probe.start, size: blockSize(probe.prefix), color: "#ffffff", from: 0, label: `${segName(probe.seg)} lands at .${probe.start}` }] : [];

  const run = () => {
    mark(order === "big" ? "playBig" : "playSmall");
    const from = done ? 0 : idx;
    if (done) setIdx(0);
    play(
      Array.from({ length: frames.length - from }, (_, i) => from + i + 1),
      520,
      (i) => setIdx(i),
    );
  };
  const step = () => {
    stop();
    mark("step");
    setIdx((i) => Math.min(frames.length, i + 1));
  };
  const switchOrder = (o: "big" | "small") => {
    stop();
    setOrder(o);
    setIdx(0);
    if (o === "small") mark("small");
  };
  const segTries = probe ? frames.slice(0, idx).filter((f) => f.seg === probe.seg) : [];
  const free = done ? freeSpace(placedFrames.map((f) => ({ id: f.seg, hosts: 0, prefix: f.prefix, network: ip(f.start) }))) : undefined;

  return (
    <Scene
      board={<AddressGrid cells={cells} overlays={overlays} label={BOARD_LABEL} footer={<Legend items={[...SEGMENTS.map((s) => ({ color: SEG_COLOR[s.id], label: segName(s.id) })), { color: "#f87171", label: "tried here: already taken", dashed: true }]} />} />}
      hint={probe ? `Trying ${segName(probe.seg)} at .${probe.start}` : "Press Play or Step"}
      side={
        <>
          <Lead kicker="Plan · 2 of 3" title="Right-size each network, then pack (VLSM)">
            <p>Step 1: give every network the <b className="text-pv-text">smallest block that holds it</b>. Step 2: drop the blocks onto the board. Each one can only land on its own grid lines.</p>
          </Lead>
          <SizeLadders />
          <div className="flex flex-wrap items-center gap-2">
            {playing ? (
              <Btn tone="quiet" onClick={stop}>
                Pause
              </Btn>
            ) : (
              <Btn onClick={run}>{done ? "▶ Pack again" : idx > 0 ? "▶ Continue" : "▶ Pack the board"}</Btn>
            )}
            <Btn tone="quiet" onClick={step} disabled={done}>
              Step
            </Btn>
            <span className="ml-auto flex gap-1" role="group" aria-label="Packing order">
              <Btn tone="quiet" pressed={order === "big"} onClick={() => switchOrder("big")}>
                Largest first
              </Btn>
              <Btn tone="quiet" pressed={order === "small"} onClick={() => switchOrder("small")}>
                Smallest first
              </Btn>
            </span>
          </div>
          {probe ? (
            <Now k={`${order}-${idx}`} tone={done ? "ok" : "info"} title={probe.ok ? `${segName(probe.seg)} (/${probe.prefix}) lands at .${probe.start}.` : `${segName(probe.seg)} (/${probe.prefix}) can't land at .${probe.start}: taken by ${segName(owner(probe.start)?.seg ?? owner(probe.start + blockSize(probe.prefix) - 1)?.seg ?? probe.seg)}.`}>
              <p>
                A /{probe.prefix} may only start on a multiple of {blockSize(probe.prefix)}. Tries:{" "}
                {segTries.map((t, i) => (
                  <span key={i} className={clsx("pv-mono", t.ok ? "font-bold text-pv-success" : "text-pv-danger")}>
                    {i ? " · " : ""}.{t.start} {t.ok ? "✓" : "✕"}
                  </span>
                ))}
              </p>
              {done && free && (
                <p>
                  Everything fits. Used {free.allocated} of 256. Free: <b className="text-pv-text">{free.ranges.map((r) => rangeLabel(r)).join(", ")}</b>, in one piece.
                </p>
              )}
            </Now>
          ) : (
            <Now k="start" title="Four right-sized boxes, one empty board.">
              <p>Press Play to watch each box look for the first free spot on its own grid lines, or Step through it.</p>
            </Now>
          )}
          <Idea>
            <p>
              Smaller grid lines always line up with bigger ones: every /26 start is also a /27, /28… start. That&apos;s why <b>different-sized blocks fit together without gaps</b>, as long as each one starts on its own lines.
            </p>
            <p className="text-pv-text-muted">
              Big blocks have the fewest landing spots, so the habit is <b className="text-pv-text">largest first</b>: they take the big lines, then the small ones slot in after. Both orders give a valid plan here, so largest first is a convenience, not a rule: it leaves no holes between blocks and keeps the free space in one piece at the end, ready for growth. Smallest first leaves a gap that only small blocks can use.
            </p>
          </Idea>
          <Predict
            q="Largest first: where will LAN-C (/27) land?"
            options={[".160", ".192", ".224"]}
            answer={1}
            onTest={() => {
              switchOrder("big");
              window.setTimeout(() => setIdx(bigLen), 0);
            }}
            explain={<p>LAN-A takes .0–.127, LAN-B .128–.191. The first free /27 line is .192.</p>}
          />
          <TryList
            items={[
              { text: <>Pack the board largest-first and watch the tries.</>, done: !!seen.playBig },
              { text: <>Step through it one try at a time.</>, done: !!seen.step },
              { text: <>Switch to smallest first and pack again. Where does the free space end up?</>, done: !!seen.playSmall },
            ]}
          />
        </>
      }
    />
  );
}

function SizeLadders() {
  const sizes = [4, 8, 16, 32, 64, 128, 256];
  return (
    <div className="space-y-2 rounded-2xl border border-pv-border bg-pv-bg-elevated/30 p-3">
      <p className="text-[12.5px] text-pv-text-muted">Smallest block with room for the devices + network + broadcast:</p>
      {SEGMENTS.map((s) => {
        const p = slMinPrefix(s.hosts);
        return (
          <div key={s.id}>
            <p className="text-[13px] text-pv-text">
              <b style={{ color: SEG_COLOR[s.id] }}>{segName(s.id)}</b> {s.hosts} + 2 = {s.hosts + 2} → <b className="pv-mono">{blockSize(p)}</b> <span className="pv-mono text-pv-text-muted">(/{p})</span>
            </p>
            <div className="mt-0.5 flex gap-1" aria-hidden>
              {sizes.map((z) => {
                const fits = z - 2 >= s.hosts;
                const chosen = z === blockSize(p);
                return (
                  <span key={z} className={clsx("flex-1 rounded py-0.5 text-center pv-mono text-[11px]", chosen ? "font-bold text-[#03131a]" : fits ? "text-pv-text-faint" : "text-pv-danger/70 line-through")} style={{ background: chosen ? SEG_COLOR[s.id] : fits ? "rgba(148,163,184,0.10)" : "rgba(248,113,113,0.08)" }}>
                    {z}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
