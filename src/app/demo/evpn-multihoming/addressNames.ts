import { evpnNameTable } from "@/components/lesson/evpnCallout";
import { BROADCAST_MAC } from "@/lib/sim-engine/scenarios/evpnBum";
import { HOST_B_IP, HOST_B_MAC, SERVER_A_IP, SERVER_A_MAC, VTEP_LOOPBACK } from "@/lib/sim-engine/scenarios/evpnMultihoming";

/** Role names for EVPN Multihoming packet addresses — every key is a scenario export, never retyped. */
export const evpnMultihomingNames = evpnNameTable([
  [SERVER_A_IP, "SERVER-A"],
  [SERVER_A_MAC, "SERVER-A"],
  [HOST_B_IP, "HOST-B"],
  [HOST_B_MAC, "HOST-B"],
  [BROADCAST_MAC, "broadcast"],
  ["255.255.255.255", "limited broadcast"],
  [VTEP_LOOPBACK.LEAF1, "LEAF1 VTEP"],
  [VTEP_LOOPBACK.LEAF2, "LEAF2 VTEP"],
  [VTEP_LOOPBACK.LEAF3, "LEAF3 VTEP"],
]);
