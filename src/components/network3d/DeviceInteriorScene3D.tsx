"use client";

import { useMemo } from "react";
import { Text } from "@react-three/drei";
import { RouterChassis3D } from "./RouterChassis3D";
import { DeviceInterfacePort3D } from "./DeviceInterfacePort3D";
import { ForwardingPipeline3D } from "./ForwardingPipeline3D";
import { PacketStack3D } from "./PacketStack3D";
import { THEME } from "./theme";
import type { DeviceInterfaceData, DeviceProcessingTrace, FocusTarget3D, PacketStackFrame } from "./types";

interface DeviceInteriorScene3DProps {
  deviceLabel: string;
  interfaces: DeviceInterfaceData[];
  xray: boolean;
  trace?: DeviceProcessingTrace;
  packetFrames?: PacketStackFrame[];
  onSelectInterface?: (id: string) => void;
  selectedInterfaceId?: string;
  onSelectPacket?: () => void;
  packetSelected?: boolean;
  focusTones?: PacketStackFrame["tone"][];
  /** Passed through to <ForwardingPipeline3D> — see its `title` prop. */
  pipelineTitle?: string;
  /** Generic object-focus interaction ("3D Inspection & Selection UX Pass" §4) — fired from a pipeline stage, packet layer, or interface anchor. Optional; every existing lesson keeps rendering unchanged. */
  onFocusObject?: (target: FocusTarget3D) => void;
  focusedObjectId?: string;
}

/**
 * Physical-device view (brief §1/§2/§4): a router chassis with real,
 * clickable interface ports and — in X-Ray — the conceptual forwarding
 * pipeline for whatever device is currently entered. Positions ports
 * from the interface list order and places the packet along a simple
 * ingress→pipeline→egress arc derived from the trace's stage index —
 * a layout computation, not a protocol decision (the trace already
 * carries the decision).
 */
export function DeviceInteriorScene3D({ deviceLabel, interfaces, xray, trace, packetFrames, onSelectInterface, selectedInterfaceId, onSelectPacket, packetSelected, focusTones, pipelineTitle, onFocusObject, focusedObjectId }: DeviceInteriorScene3DProps) {
  const xrayT = xray ? 1 : 0;

  const portPositions = useMemo<[number, number, number][]>(() => {
    const n = interfaces.length;
    const spread = Math.max(0.9, (n - 1) * 1.15);
    return interfaces.map((_, i) => {
      const x = n === 1 ? 0 : -spread / 2 + (spread * i) / (n - 1);
      return [x, 0, 0.66];
    });
  }, [interfaces]);

  const packetPosition = useMemo<[number, number, number] | undefined>(() => {
    if (!packetFrames || packetFrames.length === 0 || !trace) return undefined;
    const stageIndex = trace.stages.findIndex((s) => s.id === trace.activeStageId);
    const total = Math.max(1, trace.stages.length - 1);
    const t = stageIndex < 0 ? 0 : stageIndex / total;
    const ingressIdx = interfaces.findIndex((i) => i.id === trace.ingressInterfaceId);
    const egressIdx = interfaces.findIndex((i) => i.id === trace.egressInterfaceId);
    const from = ingressIdx >= 0 ? portPositions[ingressIdx] : ([0, 0, 0.66] as [number, number, number]);
    const to = egressIdx >= 0 ? portPositions[egressIdx] : ([0, 0, 0.66] as [number, number, number]);
    const arcHeight = xray ? 1.15 : 0.85;
    const x = from[0] + (to[0] - from[0]) * t;
    const y = Math.sin(t * Math.PI) * arcHeight;
    const z = from[2] + (to[2] - from[2]) * t - Math.sin(t * Math.PI) * 0.55;
    return [x, y, z];
  }, [packetFrames, trace, interfaces, portPositions, xray]);

  return (
    <group>
      <Text position={[0, -0.85, 0]} fontSize={0.24} color={THEME.text} anchorX="center" anchorY="top">
        {deviceLabel}
      </Text>
      <RouterChassis3D xray={xrayT} width={Math.max(3, interfaces.length * 1.15 + 1)} />
      {interfaces.map((iface, i) => (
        <DeviceInterfacePort3D key={iface.id} iface={iface} position={portPositions[i]} onSelect={onSelectInterface} selected={selectedInterfaceId === iface.id} onFocus={onFocusObject} />
      ))}
      {xray && trace && (
        <ForwardingPipeline3D trace={trace} position={[0, 0.85, -0.95]} title={pipelineTitle} onFocusStage={onFocusObject} focusedStageId={focusedObjectId} />
      )}
      {packetFrames && packetFrames.length > 0 && packetPosition && (
        <PacketStack3D
          frames={packetFrames}
          position={packetPosition}
          onSelect={onSelectPacket}
          selected={packetSelected}
          focusTones={xray ? focusTones : undefined}
          onFocusFrame={onFocusObject}
          focusedFrameId={focusedObjectId}
        />
      )}
    </group>
  );
}
