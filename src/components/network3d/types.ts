import type { DeviceKind, PacketVisual } from "@/lib/sim-engine/types";

/**
 * Generic 3D-topology data contract (brief: "3D Topology Interaction
 * Layer"). Exactly like <GraphTopologyViewer>'s 2D GraphNode/GraphEdge,
 * these types carry no protocol knowledge — a lesson page derives them
 * from its own ScenarioEngine snapshot and hands them to <NetworkScene3D>.
 * Nothing in the network3d/ directory imports a scenario file.
 */

export type Node3DStatus = "idle" | "active" | "onPath" | "selected";

export interface Node3DData {
  id: string;
  label: string;
  subLabel?: string;
  kind: DeviceKind;
  /** World-space position — already laid out by the caller (see layout.ts). */
  position: [number, number, number];
  status?: Node3DStatus;
  /** Small contextual tags rendered near the node, e.g. "VRF CUST-A", "RR", "LSP". */
  badges?: string[];
}

export interface Link3DData {
  id: string;
  a: string;
  b: string;
  label?: string;
  /** True while the active packet is traversing this link right now. */
  active?: boolean;
  /** True once the packet's journey has already passed through this link this run. */
  onPath?: boolean;
}

/** The animated in-flight packet, positioned between two existing node ids. */
export interface ActivePacket3D {
  packet: PacketVisual;
  fromId: string;
  toId: string;
}

/**
 * State-aware, per-node explanation contract shown in <NodeInspectorPanel>.
 * The 3D layer only renders this shape — computing it (from lesson state
 * + current step + which node was clicked) is entirely the lesson
 * page's job, exactly like `whatChanged`/`narrative` already are.
 */
export interface NodeExplanation {
  id: string;
  name: string;
  deviceType: string;
  role: string;
  currentAction: string;
  controlPlaneRole?: string;
  dataPlaneRole?: string;
  packetBefore?: string;
  packetAfter?: string;
  note?: string;
  tables?: { title: string; rows: { label: string; value: string }[] }[];
}

// ---------------------------------------------------------------------------
// Device-interior contract — everything a lesson needs to describe to
// let <DeviceInteriorScene3D> render a physical device view, its
// interfaces, and its conceptual forwarding pipeline. Structure only —
// no protocol logic. See ARCHITECTURE.md-style note in deviceTrace.ts
// files for the reasoning; this is the "Scene Adapter" boundary.
// ---------------------------------------------------------------------------

export type InterfaceRole = "ingress" | "egress" | "idle";

export interface DeviceInterfaceData {
  id: string;
  name: string;
  status: "up" | "down";
  ip?: string;
  neighborId?: string;
  neighborLabel?: string;
  linkType?: string;
  mtu?: number;
  protocols?: string[];
  packetCount?: number;
  /** Which role this interface plays RIGHT NOW, for highlighting — derived from current step, not stored config. */
  role: InterfaceRole;
  /** Protocol-specific fields beyond the generic set above (e.g. OSPF Area/Cost/Hello/Dead/Network Type/Neighbor State, or a future BGP/IS-IS equivalent) — kept generic so this type never needs new named fields per protocol. */
  extra?: { label: string; value: string }[];
}

export interface ProcessingStage {
  id: string;
  label: string;
  /** One-line detail shown once this stage is reached, e.g. "VRF CUST-A route: 10.2.2.0/24 via PE2". */
  detail?: string;
}

/**
 * Generic per-device forwarding trace (brief §16: reusable by MPLS,
 * OSPF/IP, BGP, EVPN/VXLAN, firewall, NAT, IPsec — not MPLS-specific
 * in shape). A lesson's own adapter computes one of these per device
 * per render; the 3D layer only walks `stages` and highlights
 * `activeStageId`/`completedStageIds` — it never decides what a stage
 * means or when it's "done".
 */
export interface DeviceProcessingTrace {
  deviceId: string;
  ingressInterfaceId?: string;
  egressInterfaceId?: string;
  packetBefore?: string;
  packetAfter?: string;
  stages: ProcessingStage[];
  activeStageId?: string;
  completedStageIds: string[];
  forwardingAction?: string;
}

/** One label (or plain IP payload) in the packet's visual stack, top to bottom. */
export interface PacketStackFrame {
  id: string;
  text: string;
  tone: "transport" | "vpn" | "ip" | "generic";
  /** True while this exact frame is the one just pushed/swapped/popped — used for a brief flash/emphasis. */
  justChanged?: boolean;
}

export type CameraMode = "overview" | "device" | "packetFollow" | "freeOrbit";

/**
 * A labeled 3D boundary region (brief: "AS regions should have
 * depth/boundaries") — the 3D equivalent of <GraphTopologyViewer>'s
 * `GraphRegion`, purely a visual/clickable grouping box. Carries no
 * protocol meaning itself; a lesson decides what a region IS (an AS,
 * a site, a VRF's footprint, ...) and supplies the label/content for
 * whatever panel it shows when the region is clicked.
 */
export interface Region3DData {
  id: string;
  label: string;
  subLabel?: string;
  center: [number, number, number];
  size: [number, number, number];
  tone?: "cyan" | "violet" | "warning" | "muted";
}

/** Detail shown for a clicked link (brief §10). */
export interface LinkDetail {
  aLabel: string;
  bLabel: string;
  aInterface: DeviceInterfaceData;
  bInterface: DeviceInterfaceData;
  status: "up" | "down";
  mtu?: number;
  protocols: { label: string; value: string }[];
  currentTraffic?: string;
}
