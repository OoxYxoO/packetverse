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
 * Body/panel colors come from the shared `THEME` chassis-contrast
 * tokens so the chassis reads clearly against the scene background
 * instead of disappearing into it.
 */
export function Router3D({ accentColor, glow }: DeviceMeshProps) {
  const ledXs = [-0.32, -0.18, -0.04, 0.1, 0.24];
  const vents = [-0.44, -0.36, 0.36, 0.44];
  return (
    <group>
      <mesh castShadow>
        <boxGeometry args={[1.15, 0.42, 0.72]} />
        <meshStandardMaterial color={THEME.chassis} roughness={0.5} metalness={0.35} />
      </mesh>
      <mesh position={[0, 0, 0.365]}>
        <boxGeometry args={[1.19, 0.34, 0.02]} />
        <meshStandardMaterial color={THEME.chassisPanel} roughness={0.6} metalness={0.3} />
      </mesh>
      <mesh position={[0, 0.14, 0.375]}>
        <boxGeometry args={[1.19, 0.02, 0.008]} />
        <meshStandardMaterial color={accentColor} emissive={accentColor} emissiveIntensity={0.6 + glow} toneMapped={false} />
      </mesh>
      {ledXs.map((x, i) => (
        <mesh key={i} position={[x, -0.1, 0.375]}>
          <boxGeometry args={[0.03, 0.03, 0.006]} />
          <meshStandardMaterial color={i === 0 ? THEME.success : THEME.ledOff} emissive={i === 0 ? THEME.success : THEME.ledOff} emissiveIntensity={i === 0 ? 0.9 : 0.15} toneMapped={false} />
        </mesh>
      ))}
      {vents.map((x, i) => (
        <mesh key={i} position={[x, 0.16, 0.25]}>
          <boxGeometry args={[0.03, 0.006, 0.14]} />
          <meshStandardMaterial color={THEME.chassisRecess} roughness={0.9} />
        </mesh>
      ))}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * 0.62, 0, 0.24]}>
          <boxGeometry args={[0.07, 0.42, 0.24]} />
          <meshStandardMaterial color={THEME.chassisSide} roughness={0.55} metalness={0.3} />
        </mesh>
      ))}
    </group>
  );
}
