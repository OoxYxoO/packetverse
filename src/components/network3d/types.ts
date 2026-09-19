import type { DeviceKind, PacketVisual } from "@/lib/sim-engine/types";

/**
 * Generic 3D-topology data contract (brief: "3D Topology Interaction
 * Layer"). Exactly like <GraphTopologyViewer>'s 2D GraphNode/GraphEdge,
 * these types carry no protocol knowledge — a lesson page derives them
 * from its own ScenarioEngine snapshot and hands them to <NetworkScene3D>.
 * Nothing in the network3d/ directory imports a scenario file.
 */

export type Node3DStatus = "idle" | "active" | "onPath" | "selected";

/**
 * Physical-hardware-SHAPE taxonomy (brief §3) — deliberately separate
 * from `DeviceKind`/logical `role`. A PE, P, RR, spine or leaf are all
 * still just routers physically; this only decides which generic 3D
 * chassis mesh renders, never a protocol decision. `deviceVisualKindFor`
 * below is the default mapper from the existing `DeviceKind` union so
 * every lesson gets a sensible shape with zero changes required —
 * a lesson may still override per-node via `Node3DData.visualKind`.
 */
export type DeviceVisualKind = "ROUTER" | "SWITCH" | "FIREWALL" | "SERVER" | "HOST" | "CLOUD" | "GENERIC_NETWORK";

export function deviceVisualKindFor(kind: DeviceKind): DeviceVisualKind {
  switch (kind) {
    case "router":
    case "pe-router":
    case "p-router":
      return "ROUTER";
    case "switch":
    case "accessPoint":
      return "SWITCH";
    case "firewall":
      return "FIREWALL";
    case "server":
      return "SERVER";
    case "laptop":
      return "HOST";
    case "cloud":
      return "CLOUD";
    default:
      return "GENERIC_NETWORK";
  }
}

export interface Node3DData {
  id: string;
  label: string;
  subLabel?: string;
  kind: DeviceKind;
  /** World-space position — already laid out by the caller (see layout.ts). */
  position: [number, number, number];
  status?: Node3DStatus;
  /** Small contextual tags rendered near the node, e.g. "VRF CUST-A", "RR", "LSP" — this is the ROLE badge (brief §5), distinct from the physical chassis shape. */
  badges?: string[];
  /** Overrides the shape derived from `kind` via `deviceVisualKindFor` — optional, falls back automatically so no existing lesson needs to change. */
  visualKind?: DeviceVisualKind;
}

export type LinkVisualState = "normal" | "selected" | "activePath" | "controlPlane" | "backup" | "failed" | "disabled";

export interface Link3DData {
  id: string;
  a: string;
  b: string;
  label?: string;
  /** True while the active packet is traversing this link right now. */
  active?: boolean;
  /** True once the packet's journey has already passed through this link this run. */
  onPath?: boolean;
  /**
   * Optional richer link-state classification (brief §7). When omitted,
   * rendering falls back entirely to `active`/`onPath` exactly as before —
   * additive, not a replacement, so every existing lesson keeps working
   * unmodified.
   */
  visualState?: LinkVisualState;
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
 * Generic packet mutation vocabulary (brief §18) — reports WHAT
 * already happened to the packet at a hop; it never decides whether
 * it should happen. Kept generic enough for MPLS/SRv6/VXLAN/EVPN/VLAN/
 * IP routing/multicast without a protocol-specific union ever leaking
 * into this file.
 */
export type PacketMutationType =
  | "PUSH"
  | "POP"
  | "SWAP"
  | "ENCAPSULATE"
  | "DECAPSULATE"
  | "DA_CHANGE"
  | "SA_CHANGE"
  | "TTL_CHANGE"
  | "HOP_LIMIT_CHANGE"
  | "SEGMENTS_LEFT_CHANGE"
  | "VNI_ADD"
  | "VNI_REMOVE"
  | "VLAN_ADD"
  | "VLAN_REMOVE"
  | "MAC_CHANGE";

export interface PacketMutation {
  type: PacketMutationType;
  detail?: string;
}

/**
 * Generic per-device forwarding trace (brief §16: reusable by MPLS,
 * OSPF/IP, BGP, EVPN/VXLAN, firewall, NAT, IPsec — not MPLS-specific
 * in shape). A lesson's own adapter computes one of these per device
 * per render; the 3D layer only walks `stages` and highlights
 * `activeStageId`/`completedStageIds` — it never decides what a stage
 * means or when it's "done".
 *
 * The fields below `forwardingAction` are an ADDITIVE extension (brief
 * §17, "Hop Inspection Contract") feeding the new <HopInspectorPanel> —
 * every field is optional so a lesson that only ever populated the
 * original fields keeps rendering exactly as before with no hop
 * inspector shown. This is deliberately layered onto the existing
 * `DeviceProcessingTrace` rather than a second, competing tracing
 * type — see ARCHITECTURE.md.
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
  /** e.g. "LFIB", "VRF lookup", "MAC table", "route table" — what kind of table/decision this hop consulted. */
  lookupType?: string;
  /** The key looked up, e.g. "label 16004", "10.2.2.0/24". */
  lookupKey?: string;
  /** The result of that lookup in plain text, e.g. "swap 16004 → 16005 via P2". */
  lookupResult?: string;
  /** Next-hop device id, so the panel/UI can link to it. */
  nextHopId?: string;
  nextHopLabel?: string;
  /** One-line "why" — the reason this forwarding action happened, e.g. "LFIB entry for active transport label". */
  reason?: string;
  /** Structured before/after packet stack, for <PacketDiffViewer> — falls back to the plain `packetBefore`/`packetAfter` strings above when omitted. */
  packetBeforeFrames?: PacketStackFrame[];
  packetAfterFrames?: PacketStackFrame[];
  mutations?: PacketMutation[];
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

/**
 * A clicked-and-focused sub-object inside the 3D scene (forwarding-pipeline
 * stage, packet/header layer, interface anchor, or link) — generic camera
 * + identity contract only. `position`/`size` are world-space, computed by
 * whichever mesh component fired the click; the PAGE decides what detail
 * panel to show for a given `kind`+`id` by looking the id up in data it
 * already has (trace.stages, packetFrames, interfaces, linkDetailFor) —
 * this type carries no protocol knowledge and no detail fields itself.
 */
export type FocusableObjectKind = "stage" | "packetLayer" | "interface" | "link";

export interface FocusTarget3D {
  kind: FocusableObjectKind;
  id: string;
  position: [number, number, number];
  /** Rough world-space bounding size, so the camera can frame it without a hardcoded per-kind distance. */
  size?: [number, number, number];
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
