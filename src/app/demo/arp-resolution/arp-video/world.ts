/**
 * The video's world: where everything stands, for two stage shapes, and the camera that frames it.
 *
 * One world, two skins: the OFFICE (the analogy) and the NETWORK. The people and the devices stand on the same
 * spots, so when the office fades into the network the newcomer becomes the Laptop, Sam becomes PC-B, Priya becomes
 * PC-C and the front desk by the door becomes the router — the analogy turns into the real thing in place.
 *
 * "wide" is for landscape stages, "tall" for phones in portrait: same devices, rearranged so that the camera can get
 * close enough for text to stay readable.
 */

export type Layout = "wide" | "tall";
export type Spot = "laptop" | "sw1" | "pcb" | "pcc" | "r1" | "server";
export type Pt = [number, number];
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const POS: Record<Layout, Record<Spot, Pt>> = {
  wide: { laptop: [270, 470], sw1: [730, 470], pcb: [1110, 230], pcc: [1110, 710], r1: [1330, 470], server: [1760, 470] },
  tall: { laptop: [200, 250], pcb: [700, 250], sw1: [450, 520], pcc: [200, 790], r1: [700, 790], server: [700, 1170] },
};
/** The local network's boundary (the office walls). The far network sits beyond it. */
export const LAN: Record<Layout, Rect> = { wide: { x: 90, y: 70, w: 1360, h: 800 }, tall: { x: 30, y: 80, w: 840, h: 900 } };
export const FAR: Record<Layout, Rect> = { wide: { x: 1490, y: 270, w: 450, h: 400 }, tall: { x: 470, y: 1010, w: 400, h: 330 } };
export const WORLD: Record<Layout, Rect> = { wide: { x: 0, y: 0, w: 1960, h: 940 }, tall: { x: 0, y: 0, w: 900, h: 1360 } };

export const LINKS: [Spot, Spot][] = [
  ["laptop", "sw1"],
  ["sw1", "pcb"],
  ["sw1", "pcc"],
  ["sw1", "r1"],
  ["r1", "server"],
];
/** SW1 port numbers, as in the lab (Fa0/1 Laptop, Fa0/2 R1, Fa0/3 PC-B, Fa0/4 PC-C). */
export const PORT: Partial<Record<Spot, number>> = { laptop: 1, r1: 2, pcb: 3, pcc: 4 };

const bound = (pts: Spot[], l: Layout, pad: number, padY = pad): Rect => {
  const xs = pts.map((p) => POS[l][p][0]);
  const ys = pts.map((p) => POS[l][p][1]);
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - padY;
  return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + padY - y };
};

export type CamKey = "lan" | "all" | "laptop" | "laptop-pcb" | "switch" | "receivers" | "pcb" | "pcb-laptop" | "router" | "router-server" | "laptop-router" | "door";
/** What each camera position frames (focus rectangles in world units). */
export function camRect(k: CamKey, l: Layout): Rect {
  const lan = LAN[l];
  switch (k) {
    case "lan":
      return { x: lan.x - 20, y: lan.y - 20, w: lan.w + 40, h: lan.h + 40 };
    case "all": {
      const w = WORLD[l];
      return { x: w.x + 20, y: w.y + 20, w: w.w - 40, h: w.h - 40 };
    }
    case "laptop":
      return bound(["laptop"], l, 240, 200);
    case "laptop-pcb":
      return bound(["laptop", "pcb"], l, 210, 190);
    case "switch":
      return bound(["sw1"], l, 260, 220);
    case "receivers":
      return bound(["pcb", "pcc", "r1", "sw1"], l, 190, 170);
    case "pcb":
      return bound(["pcb"], l, 240, 200);
    case "pcb-laptop":
      return bound(["pcb", "laptop", "sw1"], l, 200, 190);
    case "router":
      return bound(["r1"], l, 250, 210);
    case "router-server":
      return bound(["r1", "server"], l, 210, 210);
    case "laptop-router":
      return bound(["laptop", "r1", "sw1"], l, 210, 210);
    case "door":
      return bound(["r1", "server"], l, 260, 260);
  }
}

/**
 * Fit a focus rectangle into the part of the stage that's free ("safe": fractions of the stage — cards and questions
 * take the rest). Returns the SVG viewBox. Zoom is capped so a close-up never turns into giant text on big screens.
 */
export function fitCamera(focus: Rect, W: number, H: number, safe: { x0: number; y0: number; x1: number; y1: number }): Rect {
  const sw = Math.max(1, (safe.x1 - safe.x0) * W);
  const sh = Math.max(1, (safe.y1 - safe.y0) * H);
  const maxScale = W / (W > 700 ? 1150 : 520);
  const s = Math.min(sw / focus.w, sh / focus.h, maxScale);
  const cx = focus.x + focus.w / 2;
  const cy = focus.y + focus.h / 2;
  const scx = ((safe.x0 + safe.x1) / 2) * W;
  const scy = ((safe.y0 + safe.y1) / 2) * H;
  return { x: cx - scx / s, y: cy - scy / s, w: W / s, h: H / s };
}

/**
 * The part of the stage the camera may use (fractions): cards, the question and the captions take the rest.
 * Shared by the player and the audit, so the readability check measures exactly what the viewer sees.
 */
export function safeArea(l: Layout, o: { cards: boolean; asking: boolean; needsCard?: boolean }) {
  if (l === "tall") return { x0: 0.03, y0: o.asking ? 0.04 : o.cards ? 0.36 : 0.05, x1: 0.97, y1: o.asking ? (o.needsCard ? 0.36 : 0.42) : 0.82 };
  return { x0: 0.03, y0: 0.06, x1: o.cards || o.asking ? 0.6 : 0.97, y1: 0.83 };
}

export const layoutFor = (W: number, H: number): Layout => (W / Math.max(1, H) < 0.95 ? "tall" : "wide");
