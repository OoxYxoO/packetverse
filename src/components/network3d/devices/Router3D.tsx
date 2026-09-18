"use client";

import { THEME } from "../theme";

interface DeviceMeshProps {
  accentColor: string;
  glow: number;
}

/**
 * Overview-scale generic router chassis (brief §4) — a low-profile
 * rack-style body with a recessed faceplate, a row of port/status LEDs
 * and an accent strip, all procedural primitives. Deliberately generic
 * (no vendor chassis proportions/branding) and deliberately NOT a
 * plain cube — this is what replaces the old box in <NetworkNode3D>.
 */
export function Router3D({ accentColor, glow }: DeviceMeshProps) {
  const ledXs = [-0.32, -0.18, -0.04, 0.1, 0.24];
  return (
    <group>
      <mesh castShadow>
        <boxGeometry args={[1.15, 0.42, 0.72]} />
        <meshStandardMaterial color="#12161f" roughness={0.55} metalness={0.5} />
      </mesh>
      <mesh position={[0, 0, 0.365]}>
        <boxGeometry args={[1.19, 0.34, 0.02]} />
        <meshStandardMaterial color="#0a0d14" roughness={0.65} metalness={0.35} />
      </mesh>
      <mesh position={[0, 0.14, 0.375]}>
        <boxGeometry args={[1.19, 0.02, 0.008]} />
        <meshStandardMaterial color={accentColor} emissive={accentColor} emissiveIntensity={0.6 + glow} toneMapped={false} />
      </mesh>
      {ledXs.map((x, i) => (
        <mesh key={i} position={[x, -0.1, 0.375]}>
          <boxGeometry args={[0.03, 0.03, 0.006]} />
          <meshStandardMaterial color={i === 0 ? THEME.success : "#1a2030"} emissive={i === 0 ? THEME.success : "#000000"} emissiveIntensity={i === 0 ? 0.9 : 0} toneMapped={false} />
        </mesh>
      ))}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * 0.62, 0, 0.24]}>
          <boxGeometry args={[0.07, 0.42, 0.24]} />
          <meshStandardMaterial color="#0a0d14" roughness={0.65} metalness={0.4} />
        </mesh>
      ))}
    </group>
  );
}
