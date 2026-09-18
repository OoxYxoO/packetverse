import type { DeviceKind } from "@/lib/sim-engine/types";
import type { DeviceVisualKind } from "./types";

/**
 * Hex mirrors of the design tokens in globals.css — three.js materials
 * need real color values, not CSS custom properties, so these are
 * kept in sync by hand rather than duplicating a theming system for a
 * single dark 3D canvas.
 */
export const THEME = {
  bg: "#05070d",
  bgElevated: "#0a0e18",
  cyan: "#22d3ee",
  cyanSoft: "#67e8f9",
  violet: "#8b8cf8",
  success: "#34d399",
  warning: "#fbbf24",
  danger: "#fb7185",
  border: "#3a4460",
  text: "#e2e8f0",

  // --- 3D contrast hierarchy (page bg → scene → chassis → panel → detail) ---
  // The page background (`bg`, #05070d) and the 3D canvas background used to
  // be the SAME color, so a chassis rendered anywhere near that darkness
  // visually disappeared. Each tier below is a deliberate, visible step up
  // from the one before it.
  /** 3D canvas/environment background — one visible step above the page background, a deep navy rather than near-black. */
  bgScene: "#0b1120",
  /** Floor/grid plane — one more step up from `bgScene`, giving the ground plane its own depth read. */
  bgFloor: "#111a2e",
  /** Device chassis body — a clearly lit graphite, not near-black, so the shape reads against `bgScene` without extra lighting. */
  chassis: "#2b3242",
  /** Recessed panel/faceplate — a visible step darker than `chassis` (real recessed panels read darker), but still well above `bgScene`. */
  chassisPanel: "#1c2436",
  /** Rack ears / side panels — between `chassis` and `chassisPanel`. */
  chassisSide: "#232a3c",
  /** True cutouts (port holes, vent slots) — allowed to go dark since they represent an absence, not a surface. */
  chassisRecess: "#05070c",
  /** Off/unlit LED color — dim but still visibly present as a shape, not invisible. */
  ledOff: "#2a3244",
  /** Neutral chassis edge/rim highlight, used for the existing selection wireframe at low opacity as a permanent edge-definition cue. */
  chassisRim: "#7686a8",
};

/** Per-device-kind base color, matching the 2D DeviceIcon palette closely enough to feel like the same app. */
export const KIND_COLOR: Record<DeviceKind, string> = {
  laptop: THEME.cyan,
  server: THEME.cyan,
  switch: THEME.cyanSoft,
  router: THEME.cyan,
  firewall: THEME.danger,
  accessPoint: THEME.cyanSoft,
  cloud: THEME.violet,
  "pe-router": THEME.cyan,
  "p-router": THEME.violet,
};

/**
 * Overview-scale bounding box [width, height, depth] per generic
 * chassis shape (brief §4) — used both to size the procedural device
 * mesh and to keep the click/hover wireframe + selection point-light
 * in <NetworkNode3D> fitted to whatever shape is actually rendered.
 * Deliberately small/low-poly-friendly; a device interior view (brief
 * §36, DeviceInteriorScene3D) renders at a much larger, separate scale.
 */
export const DEVICE_BOUNDS: Record<DeviceVisualKind, [number, number, number]> = {
  ROUTER: [1.15, 0.42, 0.72],
  SWITCH: [1.3, 0.34, 0.68],
  FIREWALL: [0.82, 0.62, 0.7],
  SERVER: [0.66, 0.92, 0.66],
  HOST: [0.72, 0.5, 0.56],
  CLOUD: [1.24, 0.74, 1.0],
  GENERIC_NETWORK: [1, 0.68, 0.68],
};

/**
 * Dedicated "this cable is readable without selection" color for a plain
 * physical link — distinct from `THEME.border` (which stays reserved for
 * 2D UI chrome/the 3D grid) precisely because a link sitting *on* the
 * scene background needs more contrast than a UI hairline does.
 */
const linkNormal = "#5b6a8c";

/** Link visual-state → stroke color/dash/width, generic across every lesson (brief §7). Every state stays visually distinct from the others at a glance. */
export const LINK_STATE_STYLE: Record<string, { color: string; dash?: [number, number]; opacity: number; width: number }> = {
  normal: { color: linkNormal, opacity: 0.75, width: 1.6 },
  selected: { color: THEME.text, opacity: 0.95, width: 2.4 },
  activePath: { color: THEME.cyan, opacity: 0.95, width: 3.5 },
  controlPlane: { color: THEME.violet, dash: [0.12, 0.1], opacity: 0.7, width: 1.6 },
  backup: { color: THEME.warning, dash: [0.08, 0.14], opacity: 0.55, width: 1.3 },
  failed: { color: THEME.danger, opacity: 0.6, width: 1.3 },
  disabled: { color: linkNormal, opacity: 0.22, width: 0.9 },
};

/** Interface/port anchor — the small marker where a link meets a device (brief §7), generic across every lesson. */
export const LINK_ANCHOR_STYLE = {
  idle: { color: linkNormal, opacity: 0.55 },
  hovered: { color: THEME.text, opacity: 0.85 },
  active: { color: THEME.cyan, opacity: 1 },
  selected: { color: THEME.text, opacity: 0.95 },
};
