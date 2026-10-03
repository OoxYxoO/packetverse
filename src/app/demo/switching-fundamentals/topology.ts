import type { GraphNode, GraphRegion } from "@/components/network/GraphTopologyViewer";
import type { ShellEdge } from "@/components/lesson/FundamentalsLessonShell";
import { EDGE_PRIMARY, EDGE_SECONDARY, PRIMARY_PORT, SECONDARY_PORT, type SwfState } from "@/lib/sim-engine/scenarios/switchingFundamentals";

/**
 * The Switching Fundamentals network, drawn from a state: used by the guided lesson AND the Switching Lab, so both
 * show the same devices, ports and the primary/secondary SW1↔SW2 links.
 */

export const swfNodes = (s: SwfState): GraphNode[] => [
  { id: "HOST-A", label: "HOST-A", subLabel: "…:55:0A", x: 10, y: 26, kind: "laptop" },
  { id: "HOST-D", label: "HOST-D", subLabel: "…:55:0D", x: 20, y: 82, kind: "laptop" },
  { id: "SW1", label: "SW1", subLabel: `FDB ${s.fdb.SW1.length}`, x: 31, y: 50, kind: "switch" },
  { id: "SW2", label: "SW2", subLabel: `FDB ${s.fdb.SW2.length}`, x: 69, y: 50, kind: "switch" },
  { id: "HOST-B", label: "HOST-B", subLabel: "…:55:0B", x: 88, y: 28, kind: "laptop" },
  { id: "HOST-C", label: "HOST-C", subLabel: "…:55:0C", x: 80, y: 82, kind: "laptop" },
];

export const swfEdges = (s: SwfState): ShellEdge[] => [
  { id: "a-sw1", a: "HOST-A", b: "SW1", label: "ge-0/0/1" },
  { id: "d-sw1", a: "HOST-D", b: "SW1", label: "ge-0/0/2" },
  { id: EDGE_PRIMARY, a: "SW1", b: "SW2", label: `${PRIMARY_PORT} primary`, offset: { dx: 0, dy: -6 }, offset3D: [0, 0, -0.55] },
  { id: EDGE_SECONDARY, a: "SW1", b: "SW2", label: `${SECONDARY_PORT} ${s.secondaryUp ? "on" : "off"}`, offset: { dx: 0, dy: 6 }, offset3D: [0, 0, 0.55], down: !s.secondaryUp, visual3D: s.secondaryUp ? undefined : "disabled" },
  { id: "sw2-b", a: "SW2", b: "HOST-B", label: "ge-0/0/1" },
  { id: "sw2-c", a: "SW2", b: "HOST-C", label: "ge-0/0/2" },
];

export const SWF_REGIONS: GraphRegion[] = [{ id: "l2", label: "One Layer-2 broadcast domain", x: 3, y: 6, width: 94, height: 90, tone: "muted" }];
