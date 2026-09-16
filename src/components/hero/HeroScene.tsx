"use client";

import { useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import * as THREE from "three";

/**
 * Decorative 3D topology running behind the hero (brief §24/§26).
 * Deliberately simple geometry (boxes/cylinders/spheres) — no heavy
 * imported models — so it stays light on a modest laptop GPU
 * (brief §43): capped DPR, no shadows, ~20 draw calls total.
 */

const NODES: { x: number; kind: "laptop" | "switch" | "router" | "firewall" | "cloud" }[] = [
  { x: -6, kind: "laptop" },
  { x: -3, kind: "switch" },
  { x: 0, kind: "router" },
  { x: 3, kind: "firewall" },
  { x: 6, kind: "cloud" },
];

function NodeMesh({ x, kind }: { x: number; kind: string }) {
  const color = kind === "firewall" ? "#fb7185" : kind === "cloud" ? "#8b8cf8" : "#22d3ee";
  return (
    <group position={[x, 0, 0]}>
      <mesh>
        {kind === "cloud" ? (
          <sphereGeometry args={[0.55, 16, 16]} />
        ) : (
          <boxGeometry args={[0.9, 0.6, 0.6]} />
        )}
        <meshStandardMaterial color="#0d1220" emissive={color} emissiveIntensity={0.25} roughness={0.35} metalness={0.4} />
      </mesh>
      <mesh>
        {kind === "cloud" ? (
          <sphereGeometry args={[0.58, 16, 16]} />
        ) : (
          <boxGeometry args={[0.94, 0.64, 0.64]} />
        )}
        <meshBasicMaterial color={color} wireframe transparent opacity={0.18} />
      </mesh>
    </group>
  );
}

function Link({ from, to }: { from: number; to: number }) {
  return (
    <Line
      points={[
        [from, 0, 0],
        [to, 0, 0],
      ]}
      color="#3a4460"
      transparent
      opacity={0.6}
      lineWidth={1}
    />
  );
}

function Packets() {
  const groupRefs = useRef<(THREE.Mesh | null)[]>([]);
  const OFFSETS = [0, 0.33, 0.66];

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime() * 0.12;
    groupRefs.current.forEach((mesh, i) => {
      if (!mesh) return;
      const progress = (t + OFFSETS[i]) % 1;
      mesh.position.x = -6.5 + progress * 13;
      mesh.position.y = Math.sin(progress * Math.PI) * 0.15;
      const s = 0.9 + Math.sin(progress * Math.PI * 6) * 0.15;
      mesh.scale.setScalar(s);
    });
  });

  return (
    <>
      {OFFSETS.map((_, i) => (
        <mesh key={i} ref={(el) => { groupRefs.current[i] = el; }}>
          <sphereGeometry args={[0.11, 10, 10]} />
          <meshStandardMaterial color="#67e8f9" emissive="#22d3ee" emissiveIntensity={1.4} toneMapped={false} />
        </mesh>
      ))}
    </>
  );
}

function Rig() {
  const group = useRef<THREE.Group>(null);
  useFrame(({ clock, pointer }) => {
    if (!group.current) return;
    group.current.rotation.y = Math.sin(clock.getElapsedTime() * 0.05) * 0.08 + pointer.x * 0.06;
    group.current.rotation.x = pointer.y * 0.03;
  });
  return (
    <group ref={group}>
      {NODES.map((n) => (
        <NodeMesh key={n.kind + n.x} x={n.x} kind={n.kind} />
      ))}
      {NODES.slice(0, -1).map((n, i) => (
        <Link key={i} from={n.x} to={NODES[i + 1].x} />
      ))}
      <Packets />
    </group>
  );
}

export function HeroScene() {
  return (
    <Canvas
      dpr={[1, 1.5]}
      gl={{ antialias: true, alpha: true }}
      camera={{ position: [0, 1.6, 9], fov: 42 }}
      className="!absolute inset-0"
    >
      <ambientLight intensity={0.5} />
      <pointLight position={[0, 4, 6]} intensity={40} color="#22d3ee" />
      <pointLight position={[-6, -2, 4]} intensity={20} color="#8b8cf8" />
      <Rig />
    </Canvas>
  );
}
