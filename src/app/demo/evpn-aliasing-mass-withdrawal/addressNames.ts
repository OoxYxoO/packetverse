import { evpnNameTable } from "@/components/lesson/evpnCallout";
import { HOST_B_IP, HOST_B_MAC, SERVER_A_IP, SERVER_A_MAC, VTEP_LOOPBACK } from "@/lib/sim-engine/scenarios/evpnAliasingMassWithdrawal";

/** Role names for EVPN Aliasing + Mass Withdrawal packet addresses — every key is a scenario export, never retyped. */
export const evpnAliasingNames = evpnNameTable([
  [SERVER_A_IP, "SERVER-A"],
  [SERVER_A_MAC, "SERVER-A"],
  [HOST_B_IP, "HOST-B"],
  [HOST_B_MAC, "HOST-B"],
  [VTEP_LOOPBACK.LEAF1, "LEAF1 VTEP"],
  [VTEP_LOOPBACK.LEAF2, "LEAF2 VTEP"],
  [VTEP_LOOPBACK.LEAF3, "LEAF3 VTEP"],
]);
