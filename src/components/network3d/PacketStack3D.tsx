"use client";

import { useState } from "react";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { Text } from "@react-three/drei";
import { THEME } from "./theme";
import type { PacketStackFrame } from "./types";

const TONE_COLOR: Record<PacketStackFrame["tone"], string> = {
  transport: THEME.danger,
  vpn: THEME.violet,
  ip: THEME.cyan,
  generic: THEME.border,
};

interface PacketStack3DProps {
  frames: PacketStackFrame[];
  position: [number, number, number];
  onSelect?: () => void;
  selected?: boolean;
  /** Dim every frame except these tones (X-Ray focus, brief §6). */
  focusTones?: PacketStackFrame["tone"][];
}

/**
 * The packet rendered as its actual label stack in 3D space — top
 * frame is the outermost label — instead of an anonymous glowing dot.
 * The whole stack is one clickable object (brief §9).
 */
export function PacketStack3D({ frames, position, onSelect, selected, focusTones }: PacketStack3DProps) {
  const group = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);

  useFrame(({ clock }) => {
    if (!group.current) return;
    const pulse = 1 + Math.sin(clock.getElapsedTime() * 5) * 0.04;
    group.current.scale.setScalar(hovered || selected ? pulse * 1.08 : pulse);
  });

  const frameHeight = 0.16;

  return (
    <group
      ref={group}
      position={position}
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
      {frames.map((f, i) => {
        const y = (frames.length - 1 - i) * (frameHeight + 0.015);
        const color = TONE_COLOR[f.tone];
        const dimmed = focusTones ? !focusTones.includes(f.tone) : false;
        const intensity = f.justChanged ? 2.2 : dimmed ? 0.15 : selected ? 1.2 : 0.7;
        return (
          <group key={f.id} position={[0, y, 0]}>
            <mesh>
              <boxGeometry args={[0.62, frameHeight, 0.34]} />
              <meshStandardMaterial color={THEME.bgElevated} emissive={color} emissiveIntensity={intensity} toneMapped={false} transparent opacity={dimmed ? 0.35 : 1} />
            </mesh>
            <mesh>
              <boxGeometry args={[0.65, frameHeight + 0.02, 0.001]} />
              <meshBasicMaterial color={color} wireframe transparent opacity={dimmed ? 0.15 : 0.6} />
            </mesh>
            <Text position={[0, 0, 0.18]} fontSize={0.075} color={dimmed ? THEME.border : THEME.text} anchorX="center" anchorY="middle">
              {f.text}
            </Text>
          </group>
        );
      })}
      {(selected || hovered) && (
        <mesh position={[0, ((frames.length - 1) * (frameHeight + 0.015)) / 2, 0]}>
          <boxGeometry args={[0.78, frames.length * (frameHeight + 0.015) + 0.1, 0.5]} />
          <meshBasicMaterial color={THEME.cyan} wireframe transparent opacity={0.35} />
        </mesh>
      )}
    </group>
  );
}
