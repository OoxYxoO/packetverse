import type { DeviceKind } from "@/lib/sim-engine/types";

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
