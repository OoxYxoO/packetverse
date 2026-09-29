import { ALL_ISS, IFACES, ROUTER } from "@/lib/sim-engine/scenarios/isisFundamentals";

const TABLE = new Map<string, string>([
  ...(Object.entries(ROUTER).map(([r, v]) => [v.loopback, r]) as [string, string][]),
  ...IFACES.map((i) => [i.addr, `${i.router} ${i.name}`] as [string, string]),
  ...IFACES.map((i) => [i.mac, `${i.router} ${i.name}`] as [string, string]),
  [ALL_ISS, "AllISs"],
]);

/** Names for the lesson's addresses — every key is a scenario export. */
export const isisNames = (v: string): string | undefined => TABLE.get(v);
