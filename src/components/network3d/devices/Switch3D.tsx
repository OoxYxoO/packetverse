"use client";

import { THEME } from "../theme";

interface DeviceMeshProps {
  accentColor: string;
  glow: number;
}

/**
 * Overview-scale generic switch chassis (brief §4) — wider and flatter
 * than the router, with a visible row of Ethernet-style port slits and
 * two uplink indicators, so it silhouettes distinctly from a router
 * even at a glance.
 */
export function Switch3D({ accentColor, glow }: DeviceMeshProps) {
  const ports = Array.from({ length: 8 }, (_, i) => -0.52 + i * 0.15);
  return (
    <group>
      <mesh castShadow>
        <boxGeometry args={[1.3, 0.34, 0.68]} />
        <meshStandardMaterial color={THEME.chassis} roughness={0.5} metalness={0.35} />
      </mesh>
      <mesh position={[0, 0.05, 0.345]}>
        <boxGeometry args={[1.34, 0.02, 0.006]} />
        <meshStandardMaterial color={accentColor} emissive={accentColor} emissiveIntensity={0.55 + glow} toneMapped={false} />
      </mesh>
      {ports.map((x, i) => (
        <mesh key={i} position={[x, -0.06, 0.345]}>
          <boxGeometry args={[0.09, 0.1, 0.01]} />
          <meshStandardMaterial color={THEME.chassisRecess} roughness={0.9} />
        </mesh>
      ))}
      {[0.48, 0.6].map((x, i) => (
        <mesh key={i} position={[x, -0.06, 0.345]}>
          <boxGeometry args={[0.045, 0.045, 0.008]} />
          <meshStandardMaterial color={THEME.cyanSoft} emissive={THEME.cyanSoft} emissiveIntensity={0.9} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}
