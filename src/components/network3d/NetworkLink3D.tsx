"use client";

import { useMemo, useState } from "react";
import * as THREE from "three";
import { Line, Text } from "@react-three/drei";
import { LINK_STATE_STYLE, THEME } from "./theme";
import type { LinkVisualState } from "./types";

interface NetworkLink3DProps {
  id: string;
  from: [number, number, number];
  to: [number, number, number];
  label?: string;
  active?: boolean;
  onPath?: boolean;
  onSelect?: (id: string) => void;
  selected?: boolean;
  /** Optional richer state (brief §7) — when omitted, falls back to the original active/onPath/selected coloring exactly as before. */
  visualState?: LinkVisualState;
}

/**
 * One 3D link, drawn as a gently sagging cable rather than a flat
 * line (brief §11), with an invisible thicker proxy mesh so the thin
 * cable is still comfortably clickable (brief §10).
 */
export function NetworkLink3D({ id, from, to, label, active, onPath, onSelect, selected, visualState }: NetworkLink3DProps) {
  const [hovered, setHovered] = useState(false);
  const resolvedState: LinkVisualState = visualState ?? (selected ? "selected" : active ? "activePath" : onPath ? "backup" : "normal");
  const style = LINK_STATE_STYLE[resolvedState];
  // Preserve the exact original palette when no explicit visualState is supplied —
  // `onPath` (already-traversed) reads as success-green, not the "backup" amber
  // `LINK_STATE_STYLE` uses for an explicit backup link.
  const color = visualState ? style.color : selected ? THEME.text : active ? THEME.cyan : onPath ? THEME.success : THEME.border;
  const dashed = visualState === "controlPlane" || visualState === "backup";

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

  const opacity = visualState ? Math.max(style.opacity, hovered ? 0.6 : 0) : active ? 0.95 : onPath ? 0.75 : hovered ? 0.6 : 0.35;
  const lineWidth = visualState ? Math.max(style.width, hovered ? 2 : 0) : active ? 3.5 : onPath ? 2.2 : hovered ? 2 : 1.1;

  return (
    <group>
      <Line points={points} color={color} transparent opacity={opacity} lineWidth={lineWidth} dashed={dashed} dashSize={style.dash?.[0] ?? 0.1} gapSize={style.dash?.[1] ?? 0.1} />
      {visualState === "failed" && (
        <mesh position={mid} rotation={[0, 0, Math.PI / 4]}>
          <boxGeometry args={[0.14, 0.14, 0.02]} />
          <meshStandardMaterial color={THEME.danger} emissive={THEME.danger} emissiveIntensity={0.9} toneMapped={false} />
        </mesh>
      )}
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
