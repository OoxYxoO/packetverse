"use client";

import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { THEME } from "./theme";

interface Packet3DProps {
  id: string;
  from: [number, number, number];
  to: [number, number, number];
  color?: string;
  /** Seconds for the hop animation. */
  duration?: number;
  onSelect?: () => void;
  selected?: boolean;
}

/**
 * The animated in-flight packet. Tweens from `from` to `to` whenever
 * `id` changes — the same "new packet id -> new tween" convention the
 * 2D <GraphPacket> uses with framer-motion, done manually here since
 * framer-motion doesn't drive three.js meshes.
 */
export function Packet3D({ id, from, to, color = THEME.cyanSoft, duration = 1.1, onSelect, selected }: Packet3DProps) {
  const mesh = useRef<THREE.Mesh>(null);
  const startTime = useRef(0);
  const lastId = useRef<string | null>(null);
  const fromVec = useRef(new THREE.Vector3(...from));
  const toVec = useRef(new THREE.Vector3(...to));
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    if (lastId.current !== id) {
      lastId.current = id;
      startTime.current = performance.now() / 1000;
      fromVec.current.set(...from);
    }
    toVec.current.set(...to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, to[0], to[1], to[2]]);

  useFrame(({ clock }) => {
    if (!mesh.current) return;
    const elapsed = clock.getElapsedTime() - startTime.current;
    const t = Math.min(1, Math.max(0, elapsed / duration));
    const eased = 1 - Math.pow(1 - t, 3);
    mesh.current.position.lerpVectors(fromVec.current, toVec.current, eased);
    mesh.current.position.y += Math.sin(eased * Math.PI) * 0.35;
    const pulse = 1 + Math.sin(clock.getElapsedTime() * 8) * 0.12;
    mesh.current.scale.setScalar((hovered || selected ? 1.35 : 1) * pulse);
  });

  return (
    <mesh
      ref={mesh}
      position={from}
      onClick={(e) => {
        e.stopPropagation();
        onSelect?.();
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        setHovered(false);
        document.body.style.cursor = "auto";
      }}
    >
      <octahedronGeometry args={[0.17, 0]} />
      <meshStandardMaterial color={selected ? THEME.text : color} emissive={color} emissiveIntensity={selected ? 2.2 : 1.6} toneMapped={false} />
    </mesh>
  );
}
