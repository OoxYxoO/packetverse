import type { GraphEdge, GraphNode, GraphRegion } from "@/components/network/GraphTopologyViewer";
import { V4_IP, V4_PREFIX, networkOf } from "@/lib/sim-engine/scenarios/ipv4Basics";
import { V4_LAB_HOST_C } from "@/lib/sim-engine/scenarios/ipv4Lab";

/**
 * The IPv4 Basics network, drawn once for the guided lesson and the IPv4 Lab. Host labels show addresses only — the
 * configured prefix is evidence the learner inspects (it is what the wrong-mask incident changes).
 */
const last = (ip: string) => `.${ip.split(".")[3]}`;

export const V4_NODES: GraphNode[] = [
  { id: "HOST-A", label: "HOST-A", subLabel: last(V4_IP["HOST-A"]), x: 8, y: 58, kind: "laptop" },
  { id: "SW-A", label: "SW-A", subLabel: "L2 switch", x: 28, y: 42, kind: "switch" },
  { id: "R1", label: "R1", subLabel: `${last(V4_IP.R1L)} | ${last(V4_IP.R1R)}`, x: 50, y: 58, kind: "router" },
  { id: "SW-B", label: "SW-B", subLabel: "L2 switch", x: 72, y: 42, kind: "switch" },
  { id: "HOST-B", label: "HOST-B", subLabel: last(V4_IP["HOST-B"]), x: 92, y: 58, kind: "laptop" },
];
export const V4_EDGES: GraphEdge[] = [
  { id: "a-swa", a: "HOST-A", b: "SW-A", label: "p1" },
  { id: "swa-r1", a: "SW-A", b: "R1", label: `ge-0/0/0 ${last(V4_IP.R1L)}` },
  { id: "r1-swb", a: "R1", b: "SW-B", label: `ge-0/0/1 ${last(V4_IP.R1R)}` },
  { id: "swb-b", a: "SW-B", b: "HOST-B", label: "p2" },
];
export const V4_REGIONS: GraphRegion[] = [
  { id: "net-a", label: `${networkOf(V4_IP.R1L, V4_PREFIX)}/${V4_PREFIX}`, x: 2, y: 14, width: 42, height: 76, tone: "cyan" },
  { id: "net-b", label: `${networkOf(V4_IP.R1R, V4_PREFIX)}/${V4_PREFIX}`, x: 56, y: 14, width: 42, height: 76, tone: "violet" },
];

/** The IPv4 Lab's view: the same network plus the lab-only HOST-C on SW-A p3. */
export const V4_LAB_NODES: GraphNode[] = [
  ...V4_NODES.map((n) => (n.id === "HOST-A" ? { ...n, y: 34 } : n)),
  { id: "HOST-C", label: "HOST-C", subLabel: `${last(V4_LAB_HOST_C.ip)} · lab only`, x: 8, y: 80, kind: "laptop" },
];
export const V4_LAB_EDGES: GraphEdge[] = [...V4_EDGES, { id: "c-swa", a: "HOST-C", b: "SW-A", label: V4_LAB_HOST_C.port }];
