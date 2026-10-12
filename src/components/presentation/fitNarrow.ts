"use client";

import { useSyncExternalStore } from "react";
import type { TopoNode } from "./Visuals";

/**
 * Phone layout for presentation topologies (used by the Service Provider decks; Topo itself is unchanged).
 * On a narrow viewport a row of 6–9 nodes can't fit side by side: Topo keeps every node at least 60 px wide and clamps
 * edge nodes 32 px in, so neighbours overlap. fitNarrow() estimates each node's on-screen width and moves crowded
 * neighbours a little sideways, or up/down far enough to leave room for a bubble, until no two nodes overlap; links and
 * tokens follow because they read the same positions. Desktop layouts are returned untouched.
 */

const NARROW = "(max-width: 560px)";
const subscribe = (cb: () => void) => {
  if (typeof window === "undefined" || !window.matchMedia) return () => undefined;
  const m = window.matchMedia(NARROW);
  m.addEventListener("change", cb);
  window.addEventListener("resize", cb);
  return () => {
    m.removeEventListener("change", cb);
    window.removeEventListener("resize", cb);
  };
};
const snapshot = () => (typeof window !== "undefined" && window.matchMedia?.(NARROW).matches ? Math.round(window.innerWidth) : 0);

/** Estimated rendered width of a node at phone size (min-w 60 px, px-1.5, 10.5 px label, 9 px mono sub, 14 px icon). */
const nodeW = (n: TopoNode) => Math.max(60, 14 + Math.max((n.sub?.length ?? 0) * 5.5, n.label.length * 6.6, (n.icon?.length ?? 0) * 8.8));
const NODE_H = 54;
/** Room kept above every node for a bubble (two lines), so a node pushed below another never hides under its bubble. */
const BUBBLE = 36;
const BUBBLE_W = 120;
type Pos = { x: number; y: number };

function attempt(nodes: TopoNode[], stageW: number, H: number): { out: TopoNode[]; left: number } {
  const px = (x: number) => Math.min(Math.max((x / 100) * stageW, 32), stageW - 32);
  // Two nodes clash if their boxes overlap, or if the lower one's bubble (about BUBBLE_W wide, BUBBLE tall, right above
  // it) would cover the upper one.
  const clash = (a: TopoNode, b: TopoNode, p: Pos = a) => {
    const dx = Math.abs(px(p.x) - px(b.x));
    const dy = ((b.y - p.y) / 100) * H;
    if (dx - (nodeW(a) + nodeW(b)) / 2 < 4 && Math.abs(dy) - NODE_H < 4) return true;
    const [lower, upper] = dy >= 0 ? [b, a] : [a, b];
    return dx - (Math.max(nodeW(lower), BUBBLE_W) + nodeW(upper)) / 2 < 2 && Math.abs(dy) - NODE_H - BUBBLE < 2;
  };
  const out = nodes.map((n) => ({ ...n }));
  const moved = new Set<string>();
  const clashes = () => out.reduce((k, a, i) => k + out.filter((b, j) => j > i && clash(a, b)).length, 0);
  for (let pass = 0; pass < 4 && clashes(); pass++) {
    const sorted = [...out].sort((a, b) => px(a.x) - px(b.x));
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i];
        const b = sorted[j];
        if (!clash(a, b)) continue;
        // Move the one that has not moved yet: a small sideways step if that clears it, otherwise up or down far enough
        // to leave room for a bubble above the lower node — whichever creates the fewest new clashes.
        const m = moved.has(b.id) && !moved.has(a.id) ? a : b;
        const o = m === a ? b : a;
        const needY = ((NODE_H + BUBBLE + 6) / H) * 100;
        const needX = (((nodeW(m) + nodeW(o)) / 2 + 6) / stageW) * 100;
        const side = px(m.x) >= px(o.x) ? 1 : -1;
        const cands: Pos[] = [{ x: o.x + side * needX, y: m.y }, { x: m.x, y: o.y + needY }, { x: m.x, y: o.y - needY }].filter((c) => c.x >= 6 && c.x <= 94 && c.y >= 12 && c.y <= 90);
        if (!cands.length) cands.push({ x: m.x, y: Math.min(90, Math.max(12, o.y + (m.y >= o.y ? needY : -needY))) });
        const score = (c: Pos) => out.filter((n) => n !== m && clash(m, n, c)).length * 100 + Math.abs(c.y - m.y) + Math.abs(c.x - m.x) * 1.5;
        const best = cands.sort((p, q) => score(p) - score(q))[0];
        m.x = best.x;
        m.y = best.y;
        moved.add(m.id);
      }
    }
  }
  return { out, left: clashes() };
}

export function fitNarrow(nodes: TopoNode[], stageW: number, minH: number): { nodes: TopoNode[]; minH: number } {
  let H = Math.max(minH + 90, 360);
  let best = attempt(nodes, stageW, H);
  for (let k = 0; k < 3 && best.left; k++) {
    H = Math.round(H * 1.15);
    best = attempt(nodes, stageW, H);
  }
  return { nodes: best.out, minH: Math.round(H) };
}

/** `nodes`/`minH` for the current viewport: the deck's own layout on desktop, fitNarrow() on phones. */
export function useFitNodes(nodes: TopoNode[], minH: number): { nodes: TopoNode[]; minH: number } {
  const w = useSyncExternalStore(subscribe, snapshot, () => 0);
  return w ? fitNarrow(nodes, Math.max(260, w - 52), minH) : { nodes, minH };
}
