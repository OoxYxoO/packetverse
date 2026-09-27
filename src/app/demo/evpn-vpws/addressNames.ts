import { evpnNameTable } from "@/components/lesson/evpnCallout";
import { CE_A_MAC, CE_B_MAC, LOCAL_SERVICE_LABEL, PE_LOOPBACK, TRANSPORT_LABEL_TO, type PeId } from "@/lib/sim-engine/scenarios/evpnVpws";

const PES: PeId[] = ["PE1", "PE2", "PE3"];

/** Role names for EVPN-VPWS values — CE MACs, PE loopbacks, and each label's meaning; every key is a scenario export. */
export const evpnVpwsNames = evpnNameTable([
  [CE_A_MAC, "CE-A"],
  [CE_B_MAC, "CE-B"],
  ...PES.map((pe): [string, string] => [PE_LOOPBACK[pe], `${pe} loopback`]),
  ...PES.map((pe): [string, string] => [String(TRANSPORT_LABEL_TO[pe]), `toward ${pe}`]),
  ...PES.map((pe): [string, string] => [String(LOCAL_SERVICE_LABEL[pe]), `${pe}'s VPWS endpoint`]),
]);
