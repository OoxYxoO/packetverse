import type { CliVendor } from "@/lib/cli/types";

/**
 * Interface names as each OS prints them (shared by every Service Provider lab). The models use ge-0/0/N (and lo0);
 * IOS XR calls them GigabitEthernet0/0/0/N (Gi0/0/0/N short), Junos ge-0/0/N with unit .0.
 */
export const xrIf = (ifn: string, short = false) => (ifn === "lo0" ? (short ? "Lo0" : "Loopback0") : ifn.replace(/^ge-0\/0\/(\d)$/, short ? "Gi0/0/0/$1" : "GigabitEthernet0/0/0/$1"));
export const jnIf = (ifn: string, unit = true) => (ifn === "lo0" ? (unit ? "lo0.0" : "lo0") : unit ? `${ifn}.0` : ifn);
export const ifName = (v: CliVendor, ifn: string, short = true) => (v === "cisco" ? xrIf(ifn, short) : jnIf(ifn, false));
/** Lab sentences mention ge-0/0/N; on the IOS XR view they read Gi0/0/0/N. */
export const spText = (v: CliVendor, t: string) => (v === "cisco" ? t.replace(/\bge-0\/0\/(\d)(\.0)?/g, "Gi0/0/0/$1").replace(/\blo0(\.0)?\b/g, "Loopback0") : t);
export const isText = spText;
/** XR / Junos interface argument → model name, accepting the usual abbreviations. */
export function parseIf(raw: string): string | undefined {
  const r = raw.toLowerCase();
  let m = /^(?:gigabitethernet|gi|gig|ge)0\/0\/0\/([0-9])$/.exec(r);
  if (m) return `ge-0/0/${m[1]}`;
  m = /^ge-0\/0\/([0-9])(?:\.0)?$/.exec(r);
  if (m) return `ge-0/0/${m[1]}`;
  if (/^(loopback0|lo0|lo0\.0)$/.test(r)) return "lo0";
  return undefined;
}
