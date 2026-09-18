"use client";

interface DeviceMeshProps {
  accentColor: string;
  glow: number;
}

/**
 * Overview-scale generic host/workstation (brief §4) — a simple
 * monitor-on-a-stand silhouette, immediately readable as an end
 * device rather than infrastructure.
 */
export function Host3D({ accentColor, glow }: DeviceMeshProps) {
  return (
    <group>
      <mesh position={[0, 0.08, 0]} castShadow>
        <boxGeometry args={[0.62, 0.42, 0.04]} />
        <meshStandardMaterial color="#12161f" roughness={0.4} metalness={0.3} />
      </mesh>
      <mesh position={[0, 0.08, 0.023]}>
        <boxGeometry args={[0.54, 0.34, 0.006]} />
        <meshStandardMaterial color={accentColor} emissive={accentColor} emissiveIntensity={0.35 + glow * 0.6} toneMapped={false} />
      </mesh>
      <mesh position={[0, -0.19, 0]}>
        <boxGeometry args={[0.06, 0.16, 0.06]} />
        <meshStandardMaterial color="#0a0d14" roughness={0.6} metalness={0.4} />
      </mesh>
      <mesh position={[0, -0.29, 0]}>
        <boxGeometry args={[0.3, 0.03, 0.22]} />
        <meshStandardMaterial color="#0a0d14" roughness={0.6} metalness={0.4} />
      </mesh>
    </group>
  );
}
