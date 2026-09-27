import { evpnNameTable } from "@/components/lesson/evpnCallout";
import { DESTINATION_IP, GATEWAY_MAC, HOST_A_IP, HOST_A_MAC, ROUTER_MAC, VTEP_LOOPBACK } from "@/lib/sim-engine/scenarios/evpnType5";

/** Role names for EVPN Type 5 packet addresses — every key is a scenario export, never retyped. */
export const evpnType5Names = evpnNameTable([
  [HOST_A_IP, "HOST-A"],
  [HOST_A_MAC, "HOST-A"],
  [DESTINATION_IP, "prefix host"],
  [GATEWAY_MAC, "anycast GW MAC"],
  [ROUTER_MAC.LEAF1, "LEAF1 RMAC"],
  [ROUTER_MAC.LEAF2, "LEAF2 RMAC"],
  [ROUTER_MAC.LEAF3, "LEAF3 RMAC"],
  [VTEP_LOOPBACK.LEAF1, "LEAF1 VTEP"],
  [VTEP_LOOPBACK.LEAF2, "LEAF2 VTEP"],
  [VTEP_LOOPBACK.LEAF3, "LEAF3 VTEP"],
]);
