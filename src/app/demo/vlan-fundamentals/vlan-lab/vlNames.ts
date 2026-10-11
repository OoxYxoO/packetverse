import type { CliVendor } from "@/lib/cli/types";
import { VL_PORTS, type VlPort } from "@/lib/sim-engine/scenarios/vlanNet";

/** Port names in each OS view. Switch ports: Junos ge-0/0/N ↔ Cisco Gi1/0/N (GigabitEthernet1/0/N). R1: ge-0/0/0 ↔ Gi0/0. */
const N = (p: string) => p.split("/").pop()!;
export const CISCO_IF = Object.fromEntries(VL_PORTS.map((p) => [p, `GigabitEthernet1/0/${N(p)}`])) as Record<VlPort, string>;
export const CISCO_SHORT = Object.fromEntries(VL_PORTS.map((p) => [p, `Gi1/0/${N(p)}`])) as Record<VlPort, string>;
export const vlPortName = (vendor: CliVendor, port: string) => (vendor === "cisco" ? (CISCO_SHORT[port as VlPort] ?? port) : port);
export const r1IfName = (vendor: CliVendor, unit?: number, long = false) => (vendor === "cisco" ? `${long ? "GigabitEthernet" : "Gi"}0/0${unit !== undefined ? `.${unit}` : ""}` : `ge-0/0/0${unit !== undefined ? `.${unit}` : ""}`);
/** Lab text written with the model's (Junos) names, shown in the OS view the student picked. */
export const vlVendorText = (vendor: CliVendor, text: string) => (vendor === "cisco" ? text.replace(/\bge-0\/0\/0\b/g, "Gi0/0").replace(/\bge-0\/0\/(\d+)\b/g, "Gi1/0/$1") : text);
