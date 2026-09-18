"use client";

import { Billboard, Text } from "@react-three/drei";
import { THEME } from "./theme";

interface HopCallout3DProps {
  position: [number, number, number];
  title: string;
  /** Short lines only (brief §14) — the full explanation belongs in the Hop Inspector panel, not the 3D scene. */
  lines: string[];
}

/**
 * Compact, always-camera-facing in-scene callout near the device
 * currently processing a packet (brief §14) — e.g. "R2 / LFIB /
 * 16002 → 16004 / out → R4". Purely a renderer over whatever short
 * strings the page hands it; it has no idea what a label or an LFIB
 * is.
 */
export function HopCallout3D({ position, title, lines }: HopCallout3DProps) {
  const rowH = 0.19;
  const height = 0.3 + lines.length * rowH;
  const width = 1.7;

  return (
    <Billboard position={position}>
      <mesh position={[0, height / 2, -0.005]}>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial color={THEME.bgFloor} transparent opacity={0.88} />
      </mesh>
      <mesh position={[0, height / 2, -0.006]}>
        <planeGeometry args={[width + 0.04, height + 0.04]} />
        <meshBasicMaterial color={THEME.cyan} transparent opacity={0.35} />
      </mesh>
      <Text position={[0, height - 0.14, 0]} fontSize={0.16} color={THEME.cyanSoft} anchorX="center" anchorY="middle">
        {title}
      </Text>
      {/* One multi-line block rather than one <Text> per line: troika (the
          library behind drei's Text) syncs each Text instance's glyph
          geometry asynchronously off-thread, so N separate instances could
          each pop in at a slightly different moment — most visible as
          "title + first line, then the rest." Joining with newlines makes
          the whole detail block one sync job, so a newly selected hop's
          callout appears as a single, atomic snapshot. */}
      {lines.length > 0 && (
        <Text position={[0, height - 0.34, 0]} fontSize={0.115} lineHeight={1.35} color={THEME.text} anchorX="center" anchorY="top" maxWidth={width - 0.15} textAlign="center">
          {lines.join("\n")}
        </Text>
      )}
    </Billboard>
  );
}
