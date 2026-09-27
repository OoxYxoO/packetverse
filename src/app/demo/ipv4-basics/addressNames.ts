import { V4_IP, V4_MAC } from "@/lib/sim-engine/scenarios/ipv4Basics";

const TABLE = new Map<string, string>([
  [V4_IP["HOST-A"], "HOST-A"],
  [V4_IP["HOST-B"], "HOST-B"],
  [V4_IP.R1L, "R1 ge-0/0/0"],
  [V4_IP.R1R, "R1 ge-0/0/1"],
  [V4_MAC["HOST-A"], "HOST-A"],
  [V4_MAC["HOST-B"], "HOST-B"],
  [V4_MAC.R1L, "R1 ge-0/0/0"],
  [V4_MAC.R1R, "R1 ge-0/0/1"],
]);

/** Names for the lesson's IPv4 and MAC addresses — every key is a scenario export. */
export const v4Names = (v: string): string | undefined => TABLE.get(v);
