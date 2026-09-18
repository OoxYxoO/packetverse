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

/** Link visual-state → stroke color/dash/width, generic across every lesson (brief §7). */
export const LINK_STATE_STYLE: Record<string, { color: string; dash?: [number, number]; opacity: number; width: number }> = {
  normal: { color: THEME.border, opacity: 0.35, width: 1.1 },
  selected: { color: THEME.text, opacity: 0.85, width: 2.2 },
  activePath: { color: THEME.cyan, opacity: 0.95, width: 3.5 },
  controlPlane: { color: THEME.violet, dash: [0.12, 0.1], opacity: 0.55, width: 1.4 },
  backup: { color: THEME.warning, dash: [0.08, 0.14], opacity: 0.4, width: 1.1 },
  failed: { color: THEME.danger, opacity: 0.5, width: 1.1 },
  disabled: { color: THEME.border, opacity: 0.15, width: 0.8 },
};
