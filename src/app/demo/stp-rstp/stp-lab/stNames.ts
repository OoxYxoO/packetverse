import type { CliVendor } from "@/lib/cli/types";
import { ST_PORTS, type StPort } from "@/lib/sim-engine/scenarios/stpNet";

/** Port names in each OS view: Junos ge-0/0/N ↔ Cisco GigabitEthernet1/0/N (Gi1/0/N). */
const N = (p: string) => p.split("/").pop()!;
export const CISCO_IF = Object.fromEntries(ST_PORTS.map((p) => [p, `GigabitEthernet1/0/${N(p)}`])) as Record<StPort, string>;
export const CISCO_SHORT = Object.fromEntries(ST_PORTS.map((p) => [p, `Gi1/0/${N(p)}`])) as Record<StPort, string>;
export const stPortName = (vendor: CliVendor, port: string) => (vendor === "cisco" ? (CISCO_SHORT[port as StPort] ?? port) : port);
/** Lab text written with the model's (Junos) names, shown in the OS view the student picked. */
export const stVendorText = (vendor: CliVendor, text: string) => (vendor === "cisco" ? text.replace(/\bge-0\/0\/(\d+)\b/g, "Gi1/0/$1") : text);
