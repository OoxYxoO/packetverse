"use client";

import { THEME } from "../theme";

interface DeviceMeshProps {
  accentColor: string;
  glow: number;
}

/**
 * Overview-scale generic firewall appliance (brief §4) — a visually
 * distinct chassis from the router/switch: a taller, narrower body
 * with an angled front wedge (a shield read, not a literal shield
 * glyph) and a small emphasized status-panel group rather than a wide
 * port row, since a firewall's interfaces are typically few and
 * emphasized zones (inside/outside/DMZ), not many uniform ports.
 */
export function Firewall3D({ accentColor, glow }: DeviceMeshProps) {
  return (
    <group>
      <mesh castShadow>
        <boxGeometry args={[0.82, 0.62, 0.6]} />
        <meshStandardMaterial color="#1a1116" roughness={0.5} metalness={0.5} />
      </mesh>
      <mesh position={[0, 0, 0.34]} rotation={[0.28, 0, 0]}>
        <boxGeometry args={[0.86, 0.3, 0.05]} />
        <meshStandardMaterial color="#0e0a0c" roughness={0.6} metalness={0.4} />
      </mesh>
      <mesh position={[0, 0.2, 0.36]}>
        <boxGeometry args={[0.86, 0.02, 0.006]} />
        <meshStandardMaterial color={accentColor} emissive={accentColor} emissiveIntensity={0.65 + glow} toneMapped={false} />
      </mesh>
      {[-0.22, 0, 0.22].map((x, i) => (
        <mesh key={i} position={[x, -0.06, 0.365]} rotation={[0.28, 0, 0]}>
          <boxGeometry args={[0.05, 0.05, 0.006]} />
          <meshStandardMaterial color={i === 1 ? THEME.danger : THEME.success} emissive={i === 1 ? THEME.danger : THEME.success} emissiveIntensity={0.8} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}
