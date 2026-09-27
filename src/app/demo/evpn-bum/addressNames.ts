import { evpnNameTable } from "@/components/lesson/evpnCallout";
import { BROADCAST_MAC, HOST_A_IP, HOST_A_MAC, HOST_B_IP, HOST_B_MAC, HOST_C_IP, HOST_C_MAC, VTEP_LOOPBACK } from "@/lib/sim-engine/scenarios/evpnBum";

/** Role names for EVPN BUM packet addresses — every key is a scenario export, never retyped. */
export const evpnBumNames = evpnNameTable([
  [HOST_A_IP, "HOST-A"],
  [HOST_A_MAC, "HOST-A"],
  [HOST_B_IP, "HOST-B"],
  [HOST_B_MAC, "HOST-B"],
  [HOST_C_IP, "HOST-C"],
  [HOST_C_MAC, "HOST-C"],
  [BROADCAST_MAC, "broadcast"],
  ["255.255.255.255", "limited broadcast"],
  [VTEP_LOOPBACK.LEAF1, "LEAF1 VTEP"],
  [VTEP_LOOPBACK.LEAF2, "LEAF2 VTEP"],
  [VTEP_LOOPBACK.LEAF3, "LEAF3 VTEP"],
]);
