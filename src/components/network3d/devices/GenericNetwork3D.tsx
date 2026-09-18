"use client";

import { THEME } from "../theme";

interface DeviceMeshProps {
  accentColor: string;
  glow: number;
}

/**
 * Fallback generic-network-device chassis (brief §3/§40) — used when a
 * lesson hasn't (or can't) classify a node into one of the named
 * shapes. A simple beveled-look box with a status strip, still clearly
 * "a piece of equipment" rather than an unlabeled cube.
 */
export function GenericNetwork3D({ accentColor, glow }: DeviceMeshProps) {
  return (
    <group>
      <mesh castShadow>
        <boxGeometry args={[1, 0.5, 0.6]} />
        <meshStandardMaterial color={THEME.chassis} roughness={0.5} metalness={0.35} />
      </mesh>
      <mesh position={[0, 0.15, 0.305]}>
        <boxGeometry args={[1.04, 0.02, 0.006]} />
        <meshStandardMaterial color={accentColor} emissive={accentColor} emissiveIntensity={0.5 + glow} toneMapped={false} />
      </mesh>
    </group>
  );
}
