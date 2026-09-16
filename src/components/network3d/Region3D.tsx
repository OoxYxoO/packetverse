"use client";

import { useState } from "react";
import { Text } from "@react-three/drei";
import { THEME } from "./theme";
import type { Region3DData } from "./types";

const TONE_COLOR: Record<NonNullable<Region3DData["tone"]>, string> = {
  cyan: THEME.cyan,
  violet: THEME.violet,
  warning: THEME.warning,
  muted: THEME.border,
};

interface Region3DProps {
  region: Region3DData;
  onSelect?: (id: string) => void;
  selected?: boolean;
}

/**
 * One labeled 3D boundary box (brief: "AS regions should have
 * depth/boundaries") — a translucent floor plate plus a wireframe
 * volume and a floating label, entirely generic. Device interaction
 * stays primary: this renders BEHIND nodes/links (a floor-height
 * volume, `raycast={null}` isn't set so it stays clickable, but its
 * geometry is deliberately open/see-through rather than a solid box
 * that could occlude devices).
 */
export function Region3D({ region, onSelect, selected }: Region3DProps) {
  const [hovered, setHovered] = useState(false);
  const color = TONE_COLOR[region.tone ?? "muted"];
  const [w, h, d] = region.size;
  const opacity = selected ? 0.5 : hovered ? 0.35 : 0.18;

  return (
    <group position={region.center}>
      {/* floor plate */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -h / 2, 0]}
        onClick={(e) => {
          e.stopPropagation();
          onSelect?.(region.id);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          setHovered(false);
          document.body.style.cursor = "auto";
        }}
      >
        <planeGeometry args={[w, d]} />
        <meshBasicMaterial color={color} transparent opacity={opacity} />
      </mesh>
      {/* wireframe volume — depth/boundary cue */}
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[w, h, d]} />
        <meshBasicMaterial color={color} wireframe transparent opacity={selected ? 0.6 : 0.25} />
      </mesh>
      <Text position={[-w / 2 + 0.15, h / 2 + 0.05, -d / 2 + 0.15]} fontSize={0.16} color={color} anchorX="left" anchorY="bottom">
        {region.label}
      </Text>
      {region.subLabel && (
        <Text position={[-w / 2 + 0.15, h / 2 - 0.17, -d / 2 + 0.15]} fontSize={0.11} color={THEME.text} anchorX="left" anchorY="bottom">
          {region.subLabel}
        </Text>
      )}
    </group>
  );
}
