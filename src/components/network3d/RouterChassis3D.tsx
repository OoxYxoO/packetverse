"use client";

import { useMemo } from "react";
import { THEME } from "./theme";

interface RouterChassis3DProps {
  /** 0 = fully solid exterior, 1 = fully see-through for X-Ray. */
  xray: number;
  accentColor?: string;
  width?: number;
}

/**
 * Stylized generic service-provider router chassis — a rack-mount 1U
 * body, recessed faceplate, rack ears, vent grooves and an accent
 * strip, all composed from primitive geometry. Deliberately NOT a
 * cube with a router glyph on it (brief §1/§18), and deliberately NOT
 * a copy of a specific vendor's chassis — a believable, generic piece
 * of network hardware built procedurally, per the brief's explicit
 * allowance for procedural models over sourced GLTF assets.
 */
export function RouterChassis3D({ xray, accentColor = THEME.cyan, width = 3.4 }: RouterChassis3DProps) {
  const opacity = 1 - xray * 0.88;
  const vents = useMemo(() => {
    const count = Math.max(4, Math.floor(width * 3));
    return Array.from({ length: count }, (_, i) => -width / 2 + 0.5 + i * ((width - 1) / (count - 1)));
  }, [width]);

  return (
    <group>
      {/* main body */}
      <mesh renderOrder={xray > 0 ? 10 : 0}>
        <boxGeometry args={[width, 0.62, 1.15]} />
        <meshStandardMaterial color="#12161f" roughness={0.5} metalness={0.55} transparent opacity={opacity} depthWrite={xray < 0.5} />
      </mesh>
      {/* recessed front faceplate */}
      <mesh position={[0, 0, 0.585]} renderOrder={xray > 0 ? 10 : 0}>
        <boxGeometry args={[width + 0.04, 0.5, 0.03]} />
        <meshStandardMaterial color="#0a0d14" roughness={0.6} metalness={0.4} transparent opacity={opacity} depthWrite={xray < 0.5} />
      </mesh>
      {/* accent strip */}
      <mesh position={[0, 0.225, 0.6]}>
        <boxGeometry args={[width + 0.04, 0.025, 0.01]} />
        <meshStandardMaterial color={accentColor} emissive={accentColor} emissiveIntensity={xray > 0 ? 0.35 : 1.3} toneMapped={false} transparent opacity={Math.max(0.25, opacity)} />
      </mesh>
      {/* rack ears */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * (width / 2 + 0.09), 0, 0.4]} renderOrder={xray > 0 ? 10 : 0}>
          <boxGeometry args={[0.12, 0.62, 0.35]} />
          <meshStandardMaterial color="#0a0d14" roughness={0.6} metalness={0.5} transparent opacity={opacity} depthWrite={xray < 0.5} />
        </mesh>
      ))}
      {/* vent grooves */}
      {vents.map((x, i) => (
        <mesh key={i} position={[x, -0.18, 0.6]}>
          <boxGeometry args={[0.02, 0.16, 0.006]} />
          <meshStandardMaterial color="#000000" roughness={1} transparent opacity={opacity * 0.85} />
        </mesh>
      ))}
    </group>
  );
}
