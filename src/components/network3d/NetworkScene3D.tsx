"use client";

import { Suspense, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { Grid } from "@react-three/drei";
import { NetworkNode3D } from "./NetworkNode3D";
import { NetworkLink3D } from "./NetworkLink3D";
import { Packet3D } from "./Packet3D";
import { Region3D } from "./Region3D";
import { CameraController3D } from "./CameraController3D";
import { DeviceInteriorScene3D } from "./DeviceInteriorScene3D";
import { THEME } from "./theme";
import type { ActivePacket3D, DeviceInterfaceData, DeviceProcessingTrace, Link3DData, Node3DData, PacketStackFrame, Region3DData } from "./types";

interface DeviceViewProps {
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
  pipelineTitle?: string;
}

/** One simultaneous copy of a control-plane object (an LSA flood, say) traveling a specific edge — distinct from `activePacket`, which is the single normal in-flight packet. Several can be shown at once, e.g. an LSA reaching two neighbors in the same wave. */
export interface FloodCopy3D {
  id: string;
  fromId: string;
  toId: string;
}

interface NetworkScene3DProps {
  nodes: Node3DData[];
  links: Link3DData[];
  activePacket?: ActivePacket3D;
  /** Simultaneous flood copies (brief: LSA Flooding Mode) — rendered like `activePacket` but there can be more than one at once, and they're colored distinctly so they never read as normal user/control traffic. */
  floodCopies?: FloodCopy3D[];
  onSelectFloodCopy?: (id: string) => void;
  selectedFloodCopyId?: string;
  /** Labeled boundary boxes drawn behind nodes (brief: "AS regions should have depth/boundaries") — purely visual/clickable grouping, generic across lessons. */
  regions?: Region3DData[];
  onSelectRegion?: (id: string) => void;
  selectedRegionId?: string;
  onSelectNode?: (id: string) => void;
  onSelectLink?: (id: string) => void;
  selectedLinkId?: string;
  onSelectPacket?: () => void;
  packetSelected?: boolean;
  /** Position the camera should fly to — the selected node's position, or the followed packet's current node. */
  focusPosition?: [number, number, number];
  eyeOffset?: [number, number, number];
  /** "device" renders <DeviceInteriorScene3D> instead of the topology overview. */
  mode?: "overview" | "device";
  deviceView?: DeviceViewProps;
}

/**
 * The reusable 3D topology surface (brief: "3D Topology Interaction
 * Layer"). Consumes only the generic Node3DData/Link3DData/ActivePacket3D/
 * DeviceInterfaceData/DeviceProcessingTrace shapes — it has no idea what
 * "VRF" or "VPN label" mean. A lesson page derives those shapes from its
 * own ScenarioEngine snapshot every render and passes them down; this
 * component (and the device-interior view it composes) just renders them.
 * One persistent <Canvas> across overview <-> device mode so entering/
 * leaving a device is a camera move, not a WebGL context teardown.
 */
export function NetworkScene3D({ nodes, links, activePacket, floodCopies, onSelectFloodCopy, selectedFloodCopyId, regions, onSelectRegion, selectedRegionId, onSelectNode, onSelectLink, selectedLinkId, onSelectPacket, packetSelected, focusPosition, eyeOffset, mode = "overview", deviceView }: NetworkScene3DProps) {
  const positionById = useMemo(() => new Map(nodes.map((n) => [n.id, n.position])), [nodes]);

  return (
    <div className="h-96 w-full overflow-hidden rounded-2xl border border-pv-border sm:h-[28rem]" style={{ background: THEME.bg }}>
      <Canvas dpr={[1, 1.5]} gl={{ antialias: true }} camera={{ position: [0, 6, 11], fov: 45 }}>
        <ambientLight intensity={0.55} />
        <pointLight position={[0, 5, 6]} intensity={35} color={THEME.cyan} />
        <pointLight position={[-5, -2, 4]} intensity={18} color={THEME.violet} />
        <Grid
          args={[40, 40]}
          cellColor={THEME.border}
          sectionColor={THEME.border}
          cellSize={1}
          sectionSize={4}
          fadeDistance={22}
          fadeStrength={1.5}
          infiniteGrid
          position={[0, -1.3, 0]}
        />
        <Suspense fallback={null}>
          {mode === "overview" ? (
            <>
              {regions?.map((r) => (
                <Region3D key={r.id} region={r} onSelect={onSelectRegion} selected={selectedRegionId === r.id} />
              ))}
              {links.map((l) => {
                const from = positionById.get(l.a);
                const to = positionById.get(l.b);
                if (!from || !to) return null;
                return <NetworkLink3D key={l.id} id={l.id} from={from} to={to} label={l.label} active={l.active} onPath={l.onPath} onSelect={onSelectLink} selected={selectedLinkId === l.id} />;
              })}
              {nodes.map((n, i) => (
                <NetworkNode3D key={n.id} node={n} onSelect={onSelectNode} phase={i * 1.35} />
              ))}
              {activePacket &&
                (() => {
                  const from = positionById.get(activePacket.fromId);
                  const to = positionById.get(activePacket.toId);
                  if (!from || !to) return null;
                  return <Packet3D id={activePacket.packet.id} from={from} to={to} onSelect={onSelectPacket} selected={packetSelected} />;
                })()}
              {floodCopies?.map((c) => {
                const from = positionById.get(c.fromId);
                const to = positionById.get(c.toId);
                if (!from || !to) return null;
                return <Packet3D key={c.id} id={c.id} from={from} to={to} color={THEME.warning} duration={1.6} onSelect={() => onSelectFloodCopy?.(c.id)} selected={selectedFloodCopyId === c.id} />;
              })}
            </>
          ) : (
            deviceView && (
              <DeviceInteriorScene3D
                deviceLabel={deviceView.deviceLabel}
                interfaces={deviceView.interfaces}
                xray={deviceView.xray}
                trace={deviceView.trace}
                packetFrames={deviceView.packetFrames}
                onSelectInterface={deviceView.onSelectInterface}
                selectedInterfaceId={deviceView.selectedInterfaceId}
                onSelectPacket={deviceView.onSelectPacket}
                packetSelected={deviceView.packetSelected}
                focusTones={deviceView.focusTones}
                pipelineTitle={deviceView.pipelineTitle}
              />
            )
          )}
        </Suspense>
        <CameraController3D focusPosition={focusPosition} eyeOffset={eyeOffset} />
      </Canvas>
    </div>
  );
}
