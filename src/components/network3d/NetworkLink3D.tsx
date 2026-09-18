"use client";

import { useMemo, useState } from "react";
import * as THREE from "three";
import { Line, Text } from "@react-three/drei";
import { LINK_ANCHOR_STYLE, LINK_STATE_STYLE, THEME } from "./theme";
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

/** How far a port/interface anchor sits from a device's center, toward its neighbor — a generic approximation (not a real per-kind socket position) shared by every device shape. */
const ANCHOR_OFFSET = 0.42;

/**
 * One 3D link, drawn as a gently sagging cable rather than a flat
 * line (brief §11), with an invisible thicker proxy mesh so the thin
 * cable is still comfortably clickable (brief §10). Each end also
 * carries a small, always-visible interface/port anchor marker (brief
 * §7) so a link visibly terminates at a specific point on a device
 * rather than appearing to vanish into its center.
 */
export function NetworkLink3D({ id, from, to, label, active, onPath, onSelect, selected, visualState }: NetworkLink3DProps) {
  const [hovered, setHovered] = useState(false);
  const resolvedState: LinkVisualState = visualState ?? (selected ? "selected" : active ? "activePath" : onPath ? "backup" : "normal");
  const style = LINK_STATE_STYLE[resolvedState];
  // Preserve the exact original palette when no explicit visualState is supplied —
  // `onPath` (already-traversed) reads as success-green, not the "backup" amber
  // `LINK_STATE_STYLE` uses for an explicit backup link.
  const color = visualState ? style.color : selected ? THEME.text : active ? THEME.cyan : onPath ? THEME.success : style.color;
  const dashed = visualState === "controlPlane" || visualState === "backup";

  const { a, b, anchorA, anchorB } = useMemo(() => {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const dir = b.clone().sub(a).normalize();
    const dist = a.distanceTo(b);
    const offset = Math.min(ANCHOR_OFFSET, dist * 0.35);
    return { a, b, anchorA: a.clone().addScaledVector(dir, offset), anchorB: b.clone().addScaledVector(dir, -offset) };
  }, [from, to]);

  const points = useMemo(() => {
    const mid = anchorA.clone().lerp(anchorB, 0.5);
    mid.y -= 0.18 + anchorA.distanceTo(anchorB) * 0.01;
    const curve = new THREE.QuadraticBezierCurve3(anchorA, mid, anchorB);
    return curve.getPoints(16);
  }, [anchorA, anchorB]);

  const mid = points[Math.floor(points.length / 2)];
  const proxyGeom = useMemo(() => {
    return { length: a.distanceTo(b), center: a.clone().lerp(b, 0.5), quat: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()) };
  }, [a, b]);

  const opacity = visualState ? Math.max(style.opacity, hovered ? 0.6 : 0) : active ? 0.95 : onPath ? 0.75 : Math.max(style.opacity, hovered ? 0.85 : 0);
  const lineWidth = visualState ? Math.max(style.width, hovered ? 2 : 0) : active ? 3.5 : onPath ? 2.2 : Math.max(style.width, hovered ? 2 : 0);

  const anchorTone = active || onPath || (visualState === "activePath") ? LINK_ANCHOR_STYLE.active : selected ? LINK_ANCHOR_STYLE.selected : hovered ? LINK_ANCHOR_STYLE.hovered : LINK_ANCHOR_STYLE.idle;

  return (
    <group>
      <Line points={points} color={color} transparent opacity={opacity} lineWidth={lineWidth} dashed={dashed} dashSize={style.dash?.[0] ?? 0.1} gapSize={style.dash?.[1] ?? 0.1} />
      {[anchorA, anchorB].map((p, i) => (
        <mesh key={i} position={p}>
          <sphereGeometry args={[0.055, 10, 10]} />
          <meshStandardMaterial color={anchorTone.color} emissive={anchorTone.color} emissiveIntensity={anchorTone === LINK_ANCHOR_STYLE.idle ? 0.25 : 0.85} transparent opacity={anchorTone.opacity} toneMapped={false} roughness={0.4} />
        </mesh>
      ))}
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
