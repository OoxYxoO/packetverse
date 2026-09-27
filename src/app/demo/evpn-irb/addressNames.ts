import { evpnNameTable } from "@/components/lesson/evpnCallout";
import { GATEWAY_IP, GATEWAY_MAC, HOST_A_IP, HOST_A_MAC, HOST_B_IP, HOST_B_MAC, HOST_C_IP, HOST_C_MAC, ROUTER_MAC, VTEP_LOOPBACK } from "@/lib/sim-engine/scenarios/evpnIrb";

/** Role names for EVPN IRB packet addresses — every key is a scenario export, never retyped. */
export const evpnIrbNames = evpnNameTable([
  [HOST_A_IP, "HOST-A"],
  [HOST_A_MAC, "HOST-A"],
  [HOST_B_IP, "HOST-B"],
  [HOST_B_MAC, "HOST-B"],
  [HOST_C_IP, "HOST-C"],
  [HOST_C_MAC, "HOST-C"],
  [GATEWAY_IP[10], "VLAN 10 anycast GW"],
  [GATEWAY_IP[20], "VLAN 20 anycast GW"],
  [GATEWAY_MAC, "anycast GW MAC"],
  [ROUTER_MAC.LEAF1, "LEAF1 RMAC"],
  [ROUTER_MAC.LEAF2, "LEAF2 RMAC"],
  [ROUTER_MAC.LEAF3, "LEAF3 RMAC"],
  [VTEP_LOOPBACK.LEAF1, "LEAF1 VTEP"],
  [VTEP_LOOPBACK.LEAF2, "LEAF2 VTEP"],
  [VTEP_LOOPBACK.LEAF3, "LEAF3 VTEP"],
]);
