import { evpnNameTable } from "@/components/lesson/evpnCallout";
import { HOST_A_IP, HOST_A_MAC, HOST_B_IP, HOST_B_MAC, VTEP_LOOPBACK } from "@/lib/sim-engine/scenarios/evpnMacMobility";

/** Role names for EVPN MAC Mobility packet addresses — HOST-A's identity never changes, so neither does its name. */
export const evpnMobilityNames = evpnNameTable([
  [HOST_A_IP, "HOST-A"],
  [HOST_A_MAC, "HOST-A"],
  [HOST_B_IP, "HOST-B"],
  [HOST_B_MAC, "HOST-B"],
  [VTEP_LOOPBACK.LEAF1, "LEAF1 VTEP"],
  [VTEP_LOOPBACK.LEAF2, "LEAF2 VTEP"],
  [VTEP_LOOPBACK.LEAF3, "LEAF3 VTEP"],
]);
