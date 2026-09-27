import { evpnNameTable } from "@/components/lesson/evpnCallout";
import { HOST_A_IP, HOST_A_MAC, HOST_B_IP, HOST_B_MAC, UNKNOWN_TARGET_IP, VTEP_LOOPBACK } from "@/lib/sim-engine/scenarios/evpnArpNdSuppression";

/** Role names for EVPN ARP/ND packet addresses — every key is a scenario export, never retyped. */
export const evpnArpNdNames = evpnNameTable([
  [HOST_A_IP, "HOST-A"],
  [HOST_A_MAC, "HOST-A"],
  [HOST_B_IP, "HOST-B"],
  [HOST_B_MAC, "HOST-B"],
  [UNKNOWN_TARGET_IP, "unknown target"],
  [VTEP_LOOPBACK.LEAF1, "LEAF1 VTEP"],
  [VTEP_LOOPBACK.LEAF2, "LEAF2 VTEP"],
  [VTEP_LOOPBACK.LEAF3, "LEAF3 VTEP"],
]);
