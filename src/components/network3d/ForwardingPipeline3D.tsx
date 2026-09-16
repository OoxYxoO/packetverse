"use client";

import { Line, Text } from "@react-three/drei";
import { THEME } from "./theme";
import type { DeviceProcessingTrace } from "./types";

interface ForwardingPipeline3DProps {
  trace: DeviceProcessingTrace;
  position?: [number, number, number];
  /** Umbrella heading over the stage list — defaults to a plane-agnostic label; a lesson with a meaningful control/data-plane distinction (BGP: "Conceptual BGP Control-Plane Pipeline") can override it. */
  title?: string;
}

/**
 * The "Conceptual Forwarding Pipeline" (brief §4/§17) — an explicitly
 * educational abstraction, not a claim about real ASIC internals. Pure
 * renderer over `trace.stages`/`activeStageId`/`completedStageIds`;
 * it has no idea what "VRF lookup" or "LFIB" mean, it just walks the
 * list the lesson's adapter computed.
 */
export function ForwardingPipeline3D({ trace, position = [0, 1.1, 0], title = "Conceptual Forwarding Pipeline" }: ForwardingPipeline3DProps) {
  const spacing = 0.42;
  const stages = trace.stages;
  // Grows UPWARD from `position` (the base, near the chassis top) rather than
  // downward from a fixed top — so a longer stage list (PE1's 8 vs. P1's 5)
  // only pushes the title further into open headroom instead of dropping
  // stage boxes down into the interface-port/device-label footprint below.
  const titleY = stages.length * spacing + spacing * 0.5;

  return (
    <group position={position}>
      <Text position={[0, titleY, 0]} fontSize={0.1} color={THEME.text} anchorX="center" anchorY="bottom">
        {title}
      </Text>
      {stages.map((stage, i) => {
        const y = i * spacing;
        const isActive = stage.id === trace.activeStageId;
        const isDone = trace.completedStageIds.includes(stage.id);
        const color = isActive ? THEME.cyan : isDone ? THEME.success : THEME.border;
        return (
          <group key={stage.id}>
            {i > 0 && <Line points={[[0, y - spacing, 0], [0, y - 0.16, 0]]} color={color} opacity={isDone || isActive ? 0.8 : 0.3} transparent lineWidth={1.5} />}
            <group position={[0, y, 0]}>
              <mesh>
                <boxGeometry args={[1.9, 0.28, 0.04]} />
                <meshStandardMaterial color={THEME.bgElevated} emissive={color} emissiveIntensity={isActive ? 1 : isDone ? 0.45 : 0.12} roughness={0.4} metalness={0.3} />
              </mesh>
              <mesh>
                <boxGeometry args={[1.94, 0.32, 0.001]} />
                <meshBasicMaterial color={color} wireframe transparent opacity={isActive ? 0.7 : 0.25} />
              </mesh>
              <Text position={[0, 0, 0.03]} fontSize={0.11} color={isActive ? THEME.cyanSoft : isDone ? THEME.success : THEME.text} anchorX="center" anchorY="middle" maxWidth={1.7}>
                {stage.label}
              </Text>
              {isActive && stage.detail && (
                <Text position={[1.15, 0, 0.03]} fontSize={0.08} color={THEME.cyanSoft} anchorX="left" anchorY="middle" maxWidth={2}>
                  {stage.detail}
                </Text>
              )}
            </group>
          </group>
        );
      })}
    </group>
  );
}
