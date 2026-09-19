"use client";

import { useState } from "react";
import { Text } from "@react-three/drei";
import { THEME } from "./theme";
import type { DeviceInterfaceData, FocusTarget3D } from "./types";

interface DeviceInterfacePort3DProps {
  iface: DeviceInterfaceData;
  position: [number, number, number];
  onSelect?: (id: string) => void;
  selected?: boolean;
  /** Fired alongside `onSelect` — generic camera-focus request ("3D Inspection & Selection UX Pass" §4/§9). Additive: `onSelect`'s existing list-highlight behavior is unchanged. */
  onFocus?: (target: FocusTarget3D) => void;
}

/** One physical, clickable port on a device's faceplate (brief §2/§3). */
export function DeviceInterfacePort3D({ iface, position, onSelect, selected, onFocus }: DeviceInterfacePort3DProps) {
  const [hovered, setHovered] = useState(false);
  const ledColor = iface.role === "ingress" ? THEME.cyan : iface.role === "egress" ? THEME.success : iface.status === "up" ? THEME.border : "#2a2f3d";

  return (
    <group
      position={position}
      onClick={(e) => {
        e.stopPropagation();
        onSelect?.(iface.id);
        onFocus?.({ kind: "interface", id: iface.id, position, size: [0.27, 0.18, 0.08] });
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
        <boxGeometry args={[0.24, 0.15, 0.08]} />
        <meshStandardMaterial color={THEME.bg} roughness={0.7} metalness={0.3} />
      </mesh>
      <mesh>
        <boxGeometry args={[0.27, 0.18, 0.001]} />
        <meshBasicMaterial color={selected ? THEME.text : hovered ? THEME.cyanSoft : "#1a1f2b"} wireframe transparent opacity={selected ? 0.9 : hovered ? 0.7 : 0.4} />
      </mesh>
      <mesh position={[0, 0.055, 0.041]}>
        <boxGeometry args={[0.05, 0.025, 0.01]} />
        <meshStandardMaterial color={ledColor} emissive={ledColor} emissiveIntensity={iface.role !== "idle" ? 1.8 : 0.4} toneMapped={false} />
      </mesh>
      <Text position={[0, -0.13, 0]} fontSize={0.075} color={selected ? THEME.cyanSoft : THEME.text} anchorX="center" anchorY="top">
        {iface.name}
      </Text>
    </group>
  );
}
