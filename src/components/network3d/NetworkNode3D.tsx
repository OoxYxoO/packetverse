"use client";

import { useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import * as THREE from "three";
import type { Node3DData } from "./types";
import { KIND_COLOR, THEME } from "./theme";

interface NetworkNode3DProps {
  node: Node3DData;
  onSelect?: (id: string) => void;
  /** Stable per-node phase offset so idle bobbing doesn't sync across nodes. */
  phase?: number;
}

/**
 * One clickable 3D device. Pure presentation — it renders whatever
 * `status`/`badges` the caller computed from scenario state; it holds
 * no notion of "VRF" or "label stack" itself.
 */
export function NetworkNode3D({ node, onSelect, phase = 0 }: NetworkNode3DProps) {
  const group = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);
  const color = KIND_COLOR[node.kind] ?? THEME.cyan;
  const isCloudLike = node.kind === "cloud";

  useFrame(({ clock }) => {
    if (!group.current) return;
    const t = clock.getElapsedTime();
    group.current.position.y = node.position[1] + Math.sin(t * 0.8 + phase) * 0.08;
    const targetScale = hovered ? 1.18 : node.status === "selected" ? 1.1 : 1;
    group.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.15);
  });

  const emissiveIntensity = node.status === "selected" ? 1.1 : node.status === "active" ? 0.75 : node.status === "onPath" ? 0.4 : 0.22;

  return (
    <group
      ref={group}
      position={node.position}
      onClick={(e) => {
        e.stopPropagation();
        onSelect?.(node.id);
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
      <mesh>
        {isCloudLike ? <sphereGeometry args={[0.62, 20, 20]} /> : <boxGeometry args={[1, 0.68, 0.68]} />}
        <meshStandardMaterial color={THEME.bgElevated} emissive={color} emissiveIntensity={emissiveIntensity} roughness={0.35} metalness={0.45} />
      </mesh>
      <mesh>
        {isCloudLike ? <sphereGeometry args={[0.67, 20, 20]} /> : <boxGeometry args={[1.06, 0.74, 0.74]} />}
        <meshBasicMaterial color={node.status === "selected" ? THEME.text : color} wireframe transparent opacity={node.status === "selected" ? 0.55 : hovered ? 0.4 : 0.2} />
      </mesh>
      {(node.status === "selected" || node.status === "active") && (
        <pointLight color={color} intensity={node.status === "selected" ? 6 : 3} distance={3.5} />
      )}

      <Text position={[0, 0.72, 0]} fontSize={0.26} color={THEME.text} anchorX="center" anchorY="bottom">
        {node.label}
      </Text>
      {node.subLabel && (
        <Text position={[0, -0.55, 0]} fontSize={0.16} color={THEME.border} anchorX="center" anchorY="top">
          {node.subLabel}
        </Text>
      )}
      {node.badges && node.badges.length > 0 && (
        <Text position={[0, -0.55 - (node.subLabel ? 0.24 : 0), 0]} fontSize={0.14} color={THEME.cyanSoft} anchorX="center" anchorY="top">
          {node.badges.join(" · ")}
        </Text>
      )}
    </group>
  );
}
