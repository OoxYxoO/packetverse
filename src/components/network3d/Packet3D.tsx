"use client";

import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard, Text } from "@react-three/drei";
import * as THREE from "three";
import { THEME } from "./theme";
import type { PacketCallout3D } from "./types";

interface Packet3DProps {
  id: string;
  from: [number, number, number];
  to: [number, number, number];
  color?: string;
  /** Seconds for the hop animation. */
  duration?: number;
  onSelect?: () => void;
  selected?: boolean;
  /** Readable bubble riding with the packet — see `ActivePacket3D.callout`. */
  callout?: PacketCallout3D;
}

/** With a callout the packet rides above the chassis tops and stays outside both endpoint devices. */
const CALLOUT_LIFT = 0.75;
const CALLOUT_START = 0.14;
const CALLOUT_END = 0.8;

/**
 * The animated in-flight packet. Tweens from `from` to `to` whenever
 * `id` changes — the same "new packet id -> new tween" convention the
 * 2D <GraphPacket> uses with framer-motion, done manually here since
 * framer-motion doesn't drive three.js meshes.
 */
export function Packet3D({ id, from, to, color = THEME.cyanSoft, duration = 1.1, onSelect, selected, callout }: Packet3DProps) {
  const group = useRef<THREE.Group>(null);
  const mesh = useRef<THREE.Mesh>(null);
  const startTime = useRef(0);
  // The tween starts on the next rendered frame, measured on the canvas's own clock — a canvas mounted late
  // (Focus Mode, a 2D→3D switch) has a clock far behind performance.now(), which used to stall the packet.
  const pendingStart = useRef(true);
  const lastId = useRef<string | null>(null);
  const fromVec = useRef(new THREE.Vector3(...from));
  const toVec = useRef(new THREE.Vector3(...to));
  const pathA = useRef(new THREE.Vector3());
  const pathB = useRef(new THREE.Vector3());
  const [hovered, setHovered] = useState(false);
  const markerColor = callout?.color ?? color;

  useEffect(() => {
    if (lastId.current !== id) {
      lastId.current = id;
      pendingStart.current = true;
      fromVec.current.set(...from);
    }
    toVec.current.set(...to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, to[0], to[1], to[2]]);

  useFrame(({ clock }) => {
    if (!group.current || !mesh.current) return;
    if (pendingStart.current) {
      startTime.current = clock.getElapsedTime();
      pendingStart.current = false;
    }
    const elapsed = clock.getElapsedTime() - startTime.current;
    const t = Math.min(1, Math.max(0, elapsed / duration));
    const eased = 1 - Math.pow(1 - t, 3);
    if (callout) {
      pathA.current.lerpVectors(fromVec.current, toVec.current, CALLOUT_START);
      pathB.current.lerpVectors(fromVec.current, toVec.current, CALLOUT_END);
      group.current.position.lerpVectors(pathA.current, pathB.current, eased);
      group.current.position.y += CALLOUT_LIFT + Math.sin(eased * Math.PI) * 0.2;
    } else {
      group.current.position.lerpVectors(fromVec.current, toVec.current, eased);
      group.current.position.y += Math.sin(eased * Math.PI) * 0.35;
    }
    const pulse = 1 + Math.sin(clock.getElapsedTime() * 8) * 0.12;
    mesh.current.scale.setScalar((hovered || selected ? 1.35 : 1) * pulse);
  });

  return (
    <group
      ref={group}
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
      <mesh ref={mesh}>
        <octahedronGeometry args={[0.17, 0]} />
        <meshStandardMaterial color={selected ? THEME.text : markerColor} emissive={markerColor} emissiveIntensity={selected ? 2.2 : 1.6} toneMapped={false} />
      </mesh>
      {callout && <PacketBubble callout={callout} />}
    </group>
  );
}

/**
 * Camera-facing label drawn with depth testing off and a high render
 * order, so it stays readable even when the camera angle puts a chassis
 * between the viewer and the packet.
 */
function PacketBubble({ callout }: { callout: PacketCallout3D }) {
  const detail = callout.detail ?? "";
  const width = Math.min(3.6, Math.max(1.4, callout.title.length * 0.1, Math.min(detail.length, 40) * 0.075) + 0.36);
  const detailLines = detail ? Math.ceil((detail.length * 0.075) / (width - 0.3)) : 0;
  const height = 0.4 + detailLines * 0.19;
  const y = 0.42 + height / 2;

  return (
    <Billboard position={[0, y, 0]}>
      <mesh renderOrder={20}>
        <planeGeometry args={[width + 0.05, height + 0.05]} />
        <meshBasicMaterial color={callout.color} transparent opacity={0.9} depthTest={false} depthWrite={false} />
      </mesh>
      <mesh renderOrder={21}>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial color={THEME.bgScene} transparent opacity={0.94} depthTest={false} depthWrite={false} />
      </mesh>
      {/* Stem pointing down to the marker. */}
      <mesh renderOrder={20} position={[0, -height / 2 - 0.11, 0]}>
        <planeGeometry args={[0.025, 0.22]} />
        <meshBasicMaterial color={callout.color} transparent opacity={0.8} depthTest={false} depthWrite={false} />
      </mesh>
      <Text renderOrder={22} material-depthTest={false} position={[0, height / 2 - 0.19, 0]} fontSize={0.18} color={callout.color} anchorX="center" anchorY="middle" fontWeight={700}>
        {callout.title}
      </Text>
      {detail && (
        <Text renderOrder={22} material-depthTest={false} position={[0, height / 2 - 0.34, 0]} fontSize={0.13} lineHeight={1.3} color={THEME.text} anchorX="center" anchorY="top" maxWidth={width - 0.2} textAlign="center">
          {detail}
        </Text>
      )}
    </Billboard>
  );
}
