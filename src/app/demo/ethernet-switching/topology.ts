import type { GraphNode, GraphRegion } from "@/components/network/GraphTopologyViewer";
import type { EthState } from "@/lib/sim-engine/scenarios/ethernetSwitching";

/**
 * The Ethernet & Switching network, drawn from a state: used by the guided lesson AND the Ethernet Lab, so both show
 * the same devices, ports and HOST-B attachment.
 */

export const hostBAtSw1 = (s: EthState) => s.hostB === "SW1 ge-0/0/2";

export const ethNodes = (s: EthState): GraphNode[] => [
  { id: "HOST-A", label: "HOST-A", subLabel: "…:44:0A", x: 10, y: 20, kind: "laptop" },
  { id: "HOST-C", label: "HOST-C", subLabel: "…:44:0C", x: 26, y: 84, kind: "laptop" },
  { id: "SW1", label: "SW1", subLabel: `FDB ${s.fdb.SW1.length}`, x: 45, y: 50, kind: "switch" },
  { id: "DESK-SW", label: "DESK-SW", subLabel: "unmanaged", x: 70, y: 84, kind: "switch" },
  hostBAtSw1(s) ? { id: "HOST-B", label: "HOST-B", subLabel: "…:44:0B", x: 88, y: 20, kind: "laptop" } : { id: "HOST-B", label: "HOST-B", subLabel: "…:44:0B · hot desk", x: 92, y: 56, kind: "laptop" },
];

export const ethEdges = (s: EthState) => [
  { id: "a-sw1", a: "HOST-A", b: "SW1", label: "ge-0/0/1" },
  { id: "c-sw1", a: "HOST-C", b: "SW1", label: "ge-0/0/3" },
  { id: "sw1-desk", a: "SW1", b: "DESK-SW", label: "ge-0/0/4 ↔ port 1" },
  hostBAtSw1(s) ? { id: "b-sw1", a: "SW1", b: "HOST-B", label: "ge-0/0/2" } : { id: "b-desk", a: "DESK-SW", b: "HOST-B", label: "port 2" },
];

export const ETH_REGIONS: GraphRegion[] = [{ id: "lan", label: "One broadcast domain", x: 4, y: 6, width: 92, height: 90, tone: "muted" }];
