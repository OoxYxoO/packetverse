import { FW, FW_MAC } from "@/lib/sim-engine/scenarios/firewallStateful";

const TABLE = new Map<string, string>([
  [FW.client, "CLIENT"],
  [FW.trust, "FW1 trust"],
  [FW.untrust, "FW1 untrust"],
  [FW.ispFw, "ISP"],
  [FW.web, "WEB-SERVER"],
  [FW.badNat, "198.51.100.99"],
  [FW_MAC.CLIENT, "CLIENT"],
  [FW_MAC.FW_TRUST, "FW1 ge-0/0/0"],
  [FW_MAC.FW_UNTRUST, "FW1 ge-0/0/1"],
  [FW_MAC.ISP_FW, "ISP ge-0/0/0"],
  [FW_MAC.ISP_WEB, "ISP ge-0/0/1"],
  [FW_MAC.WEB, "WEB-SERVER"],
]);

/** Names for the lesson's addresses — every key is a scenario export. */
export const fwNames = (v: string): string | undefined => TABLE.get(v);
