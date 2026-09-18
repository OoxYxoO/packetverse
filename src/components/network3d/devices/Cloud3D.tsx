"use client";

import { THEME } from "../theme";

interface DeviceMeshProps {
  accentColor: string;
  glow: number;
}

/**
 * Lightweight abstract cloud (brief §4) — a small cluster of
 * overlapping low-poly spheres, semi-transparent, reading as "the
 * outside network" without pretending to be a literal cumulus glyph.
 */
export function Cloud3D({ accentColor, glow }: DeviceMeshProps) {
  const puffs: [number, number, number, number][] = [
    [0, 0, 0, 0.42],
    [0.32, 0.06, 0.08, 0.3],
    [-0.3, 0.02, -0.06, 0.28],
    [0.05, 0.2, 0.05, 0.26],
  ];
  return (
    <group>
      {puffs.map(([x, y, z, r], i) => (
        <mesh key={i} position={[x, y, z]}>
          <sphereGeometry args={[r, 14, 12]} />
          <meshStandardMaterial color={THEME.chassisSide} emissive={accentColor} emissiveIntensity={0.22 + glow * 0.4} roughness={0.55} metalness={0.1} transparent opacity={0.9} />
        </mesh>
      ))}
    </group>
  );
}
