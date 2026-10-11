import type { CliVendor } from "@/lib/cli/types";
import { LC_PORTS, type LcPort } from "@/lib/sim-engine/scenarios/lacpNet";

/** Port names in each OS view: Junos ge-0/0/N ↔ Cisco Gi1/0/N; Port-channel N ↔ aeN-1. */
const N = (p: string) => p.split("/").pop()!;
export const CISCO_IF = Object.fromEntries(LC_PORTS.map((p) => [p, `GigabitEthernet1/0/${N(p)}`])) as Record<LcPort, string>;
export const CISCO_SHORT = Object.fromEntries(LC_PORTS.map((p) => [p, `Gi1/0/${N(p)}`])) as Record<LcPort, string>;
/** A physical port or a logical one (Po1 / Po2) in the vendor's naming. */
export const lcPortName = (vendor: CliVendor, port: string) => (/^Po\d$/.test(port) ? (vendor === "cisco" ? port : `ae${+port.slice(2) - 1}`) : vendor === "cisco" ? (CISCO_SHORT[port as LcPort] ?? port) : port);
/** Texts written for both vendors say "Po1 / ae0": each vendor keeps only its own name. */
export const lcVendorText = (vendor: CliVendor, text: string) =>
  vendor === "cisco" ? text.replace(/\b(Po\d) \/ ae\d\b/g, "$1").replace(/\bge-0\/0\/(\d+)\b/g, "Gi1/0/$1") : text.replace(/\bPo\d \/ (ae\d)\b/g, "$1").replace(/\bPo(\d)\b/g, (_, n) => `ae${+n - 1}`);
