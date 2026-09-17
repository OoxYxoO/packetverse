/**
 * PacketVerse Simulation Engine — core types.
 *
 * ARCHITECTURAL RULE (see project brief §40):
 *   Networking logic lives ENTIRELY in this layer. Components never
 *   compute protocol behaviour themselves — they subscribe to a
 *   ScenarioEngine, read its state snapshot, and render it. The engine
 *   emits a typed event stream; the UI decides how (or whether) to
 *   animate each event. This means the same engine/scenario can later
 *   be rendered by a 2D DOM view, an SVG topology, or a full 3D
 *   React-Three-Fiber scene without touching a single line of protocol
 *   logic.
 */

export type PVEventType =
  | "STEP_ENTERED"
  | "PACKET_SENT"
  | "PACKET_RECEIVED"
  | "PACKET_DROPPED"
  | "ARP_REQUEST_SENT"
  | "ARP_ENTRY_CREATED"
  | "MAC_LEARNED"
  | "ROUTE_LOOKUP"
  | "ROUTE_SELECTED"
  | "TCP_STATE_CHANGED"
  | "QUESTION_ASKED"
  | "QUESTION_ANSWERED"
  | "SCENARIO_COMPLETED"
  // OSPF (generic enough to serve any link-state / neighbor-forming
  // protocol scenario added later — see brief for the OSPF lesson)
  | "OSPF_HELLO_SENT"
  | "OSPF_HELLO_RECEIVED"
  | "OSPF_NEIGHBOR_DISCOVERED"
  | "OSPF_NEIGHBOR_STATE_CHANGED"
  | "OSPF_DBD_SENT"
  | "OSPF_LSR_SENT"
  | "OSPF_LSU_SENT"
  | "OSPF_LSACK_SENT"
  | "OSPF_LSA_INSTALLED"
  | "OSPF_SPF_STARTED"
  | "OSPF_SPF_COMPLETED"
  | "OSPF_ROUTE_INSTALLED"
  | "OSPF_COST_CHANGED"
  // BGP (generic path-vector/policy vocabulary — reusable by future
  // BGP lessons: route reflectors, MPLS L3VPN, EVPN, multihoming, ...)
  | "BGP_TCP_CONNECT_STARTED"
  | "BGP_TCP_CONNECTED"
  | "BGP_OPEN_SENT"
  | "BGP_OPEN_RECEIVED"
  | "BGP_KEEPALIVE_SENT"
  | "BGP_KEEPALIVE_RECEIVED"
  | "BGP_STATE_CHANGED"
  | "BGP_UPDATE_SENT"
  | "BGP_UPDATE_RECEIVED"
  | "BGP_ROUTE_RECEIVED"
  | "BGP_PATH_EVALUATED"
  | "BGP_BEST_PATH_CHANGED"
  | "BGP_ROUTE_INSTALLED"
  | "BGP_ATTRIBUTE_CHANGED"
  | "BGP_POLICY_APPLIED"
  | "BGP_SESSION_RESET"
  // MPLS / LDP (generic label-distribution + label-switching
  // vocabulary — reusable by future MPLS L3VPN, SR-MPLS, L2VPN lessons)
  | "LDP_HELLO_SENT"
  | "LDP_HELLO_RECEIVED"
  | "LDP_NEIGHBOR_DISCOVERED"
  | "LDP_SESSION_ESTABLISHED"
  | "LDP_LABEL_MAPPING_SENT"
  | "LDP_LABEL_MAPPING_RECEIVED"
  | "LDP_SESSION_RESET"
  | "MPLS_LABEL_INSTALLED"
  | "MPLS_LABEL_PUSHED"
  | "MPLS_LABEL_SWAPPED"
  | "MPLS_LABEL_POPPED"
  | "MPLS_PACKET_FORWARDED"
  | "MPLS_PACKET_DROPPED"
  | "MPLS_LSP_CHANGED"
  // MPLS L3VPN (VRF / RD / RT / VPNv4 vocabulary — generic enough for
  // later EVPN, L2VPN/VPLS, and advanced VPN lessons)
  | "VRF_ROUTE_LEARNED"
  | "VPN_ROUTE_CREATED"
  | "RD_APPLIED"
  | "RT_ATTACHED"
  | "VPN_LABEL_ALLOCATED"
  | "MPBGP_VPN_ROUTE_ADVERTISED"
  | "MPBGP_VPN_ROUTE_RECEIVED"
  | "RT_IMPORT_EVALUATED"
  | "VPN_ROUTE_IMPORTED"
  | "VPN_ROUTE_REJECTED"
  | "VPN_ROUTE_INSTALLED"
  | "VPN_ROUTE_WITHDRAWN"
  | "VPN_LABEL_PUSHED"
  | "TRANSPORT_LABEL_PUSHED"
  | "TRANSPORT_LABEL_SWAPPED"
  | "TRANSPORT_LABEL_POPPED"
  | "VPN_LABEL_LOOKUP"
  | "VPN_CONTEXT_SELECTED"
  | "VPN_PACKET_DELIVERED"
  // BGP Route Reflection (generic enough for any future iBGP-scaling
  // lesson — confederations, redundant RR design, etc.)
  | "BGP_IBGP_SPLIT_HORIZON_BLOCKED"
  | "BGP_ROUTE_REFLECTED"
  | "BGP_RR_CLIENT_ADDED"
  | "BGP_ORIGINATOR_ID_SET"
  | "BGP_CLUSTER_LIST_UPDATED"
  | "BGP_REFLECTION_REJECTED"
  // EVPN IRB / Distributed Anycast Gateway (symmetric IRB — routing
  // performed at both the ingress and egress VTEP's own VRF/L3 context)
  | "ANYCAST_GATEWAY_RESOLVED"
  | "IRB_LOOKUP_STARTED"
  | "VRF_ROUTE_SELECTED"
  | "L3VNI_SELECTED"
  | "ROUTED_VXLAN_ENCAPSULATED"
  | "ROUTED_VXLAN_DECAPSULATED"
  | "EGRESS_IRB_COMPLETED"
  | "L3VNI_MAPPING_MISMATCH";

export interface PVEvent<TPayload = Record<string, unknown>> {
  type: PVEventType;
  timestamp: number;
  stepId: string;
  message: string;
  payload?: TPayload;
}

export type DeviceKind =
  | "laptop"
  | "server"
  | "switch"
  | "router"
  | "firewall"
  | "accessPoint"
  | "cloud"
  | "pe-router"
  | "p-router";

export interface NetNode {
  id: string;
  label: string;
  kind: DeviceKind;
  ip?: string;
  mac?: string;
  /** 0..1 horizontal position along the topology track, left to right */
  track: number;
}

export interface PacketLayer {
  name: string;
  color: string;
  fields: { label: string; value: string }[];
}

export interface PacketVisual {
  id: string;
  protocol: "ARP" | "ETHERNET" | "IP" | "IPV6" | "TCP" | "HTTPS" | "OSPF" | "BGP" | "MPLS" | "VXLAN";
  from: string;
  to: string;
  summary: string;
  broadcast?: boolean;
  /** Overrides the protocol's default glyph text on the packet chip (e.g. "OPEN" / "KEEPALIVE" / "UPDATE" for BGP) — distinguishes message subtypes by text/shape, not color alone. */
  badge?: string;
  layers: PacketLayer[];
  /** ms, purely a hint to the renderer */
  duration?: number;
}

export interface QuizOption {
  id: string;
  label: string;
}

export interface StepQuestion {
  prompt: string;
  options: QuizOption[];
  correctOptionId: string;
  explanation: string;
  /** Optional progressive hints, revealed one at a time before the answer (e.g. troubleshooting scenarios). */
  hints?: string[];
}

export interface StepResult<TState> {
  state: TState;
  events: PVEvent[];
}

export interface ScenarioStep<TState> {
  id: string;
  /** Short label shown in the step rail */
  label: string;
  /** Narrative / teaching copy shown while this step is active */
  narrative: string;
  /** Optional prediction question gating advancement past this step */
  question?: StepQuestion;
  /** Packet to animate for this step, derived from resulting state if omitted */
  packet?: (state: TState) => PacketVisual | undefined;
  /** Pure(ish) transition: given current state, produce next state + events */
  run?: (state: TState) => StepResult<TState>;
  /** Human-readable "what changed" bullets, computed after run() */
  whatChanged?: (prev: TState, next: TState) => string[];
  /**
   * For interactive/retriable steps (e.g. a "try a cost until the path
   * changes" challenge): applies a learner action WITHOUT advancing
   * the step index, so it can be called repeatedly. Pairs with
   * `requiresState` below.
   */
  action?: (state: TState, payload: unknown) => StepResult<TState>;
  /**
   * When set, advancing past this step is blocked until this predicate
   * is true against the live state — e.g. "the challenge's success
   * condition has been met". Checked instead of/alongside `question`.
   */
  requiresState?: (state: TState) => boolean;
}

export interface ScenarioSnapshot<TState> {
  state: TState;
  index: number;
  totalSteps: number;
  currentStep: ScenarioStep<TState> | undefined;
  events: PVEvent[];
  isComplete: boolean;
  lastAnswer?: { stepId: string; optionId: string; correct: boolean };
  whatChanged: string[];
  activePacket?: PacketVisual;
}
