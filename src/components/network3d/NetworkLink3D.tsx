"use client";

import { useMemo, useState } from "react";
import * as THREE from "three";
import { Line, Text } from "@react-three/drei";
import { THEME } from "./theme";

interface NetworkLink3DProps {
  id: string;
  from: [number, number, number];
  to: [number, number, number];
  label?: string;
  active?: boolean;
  onPath?: boolean;
  onSelect?: (id: string) => void;
  selected?: boolean;
}

/**
 * One 3D link, drawn as a gently sagging cable rather than a flat
 * line (brief §11), with an invisible thicker proxy mesh so the thin
 * cable is still comfortably clickable (brief §10).
 */
export function NetworkLink3D({ id, from, to, label, active, onPath, onSelect, selected }: NetworkLink3DProps) {
  const [hovered, setHovered] = useState(false);
  const color = selected ? THEME.text : active ? THEME.cyan : onPath ? THEME.success : THEME.border;

  const points = useMemo(() => {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const mid = a.clone().lerp(b, 0.5);
    mid.y -= 0.18 + a.distanceTo(b) * 0.01;
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    return curve.getPoints(16);
  }, [from, to]);

  const mid = points[Math.floor(points.length / 2)];
  const proxyGeom = useMemo(() => {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    return { length: a.distanceTo(b), center: a.clone().lerp(b, 0.5), quat: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()) };
  }, [from, to]);

  return (
    <group>
      <Line points={points} color={color} transparent opacity={active ? 0.95 : onPath ? 0.75 : hovered ? 0.6 : 0.35} lineWidth={active ? 3.5 : onPath ? 2.2 : hovered ? 2 : 1.1} />
      <mesh
        position={proxyGeom.center}
        quaternion={proxyGeom.quat}
        visible={false}
        onClick={(e) => {
          e.stopPropagation();
          onSelect?.(id);
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
        <cylinderGeometry args={[0.18, 0.18, proxyGeom.length, 6]} />
        <meshBasicMaterial />
      </mesh>
      {(active || onPath || hovered || selected) && label && (
        <Text position={[mid.x, mid.y + 0.16, mid.z]} fontSize={0.14} color={selected ? THEME.text : active ? THEME.cyanSoft : onPath ? THEME.success : THEME.text} anchorX="center" anchorY="middle">
          {label}
        </Text>
      )}
    </group>
  );
}
