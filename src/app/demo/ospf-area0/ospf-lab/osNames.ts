import type { CliVendor } from "@/lib/cli/types";
import type { OsIf } from "@/lib/sim-engine/scenarios/ospfNet";

/** Interface names in each OS view: Junos ge-0/0/N / lo0 ↔ Cisco GigabitEthernet0/N / Loopback0. */
export const CISCO_IF: Record<OsIf, string> = { "ge-0/0/0": "GigabitEthernet0/0", "ge-0/0/1": "GigabitEthernet0/1", "ge-0/0/2": "GigabitEthernet0/2", lo0: "Loopback0" };
export const CISCO_SHORT: Record<OsIf, string> = { "ge-0/0/0": "Gi0/0", "ge-0/0/1": "Gi0/1", "ge-0/0/2": "Gi0/2", lo0: "Lo0" };
export const osIfName = (vendor: CliVendor, i: string, unit = false) => (vendor === "cisco" ? (CISCO_SHORT[i as OsIf] ?? i) : unit && i !== "eth0" ? `${i}.0` : i);
export const osVendorText = (vendor: CliVendor, text: string) => (vendor === "cisco" ? text.replace(/\bge-0\/0\/(\d)\b/g, "Gi0/$1").replace(/\blo0\b/g, "Lo0") : text);
