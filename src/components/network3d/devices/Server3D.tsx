"use client";

import { THEME } from "../theme";

interface DeviceMeshProps {
  accentColor: string;
  glow: number;
}

/**
 * Overview-scale generic rack server (brief §4) — taller/narrower than
 * the router/switch to read as a vertical rack unit, with drive-bay
 * indicator strips and a status LED row.
 */
export function Server3D({ accentColor, glow }: DeviceMeshProps) {
  const bays = [-0.18, -0.06, 0.06, 0.18];
  return (
    <group>
      <mesh castShadow>
        <boxGeometry args={[0.66, 0.92, 0.66]} />
        <meshStandardMaterial color={THEME.chassis} roughness={0.5} metalness={0.35} />
      </mesh>
      <mesh position={[0, 0.3, 0.335]}>
        <boxGeometry args={[0.7, 0.02, 0.006]} />
        <meshStandardMaterial color={accentColor} emissive={accentColor} emissiveIntensity={0.55 + glow} toneMapped={false} />
      </mesh>
      {bays.map((x, i) => (
        <mesh key={i} position={[x, 0.05, 0.335]}>
          <boxGeometry args={[0.08, 0.55, 0.008]} />
          <meshStandardMaterial color={THEME.chassisRecess} roughness={0.85} />
        </mesh>
      ))}
      {bays.map((x, i) => (
        <mesh key={`led-${i}`} position={[x, -0.35, 0.335]}>
          <boxGeometry args={[0.035, 0.035, 0.006]} />
          <meshStandardMaterial color={THEME.success} emissive={THEME.success} emissiveIntensity={i === 0 ? 0.9 : 0.35} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}
