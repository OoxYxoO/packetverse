import type { CliVendor } from "@/lib/cli/types";
import type { FwApp, FwRule, FwZone } from "@/lib/sim-engine/scenarios/fwNet";

/**
 * Names in each OS view. Junos SRX: zones trust / untrust / dmz on ge-0/0/0–2, security policies per zone pair.
 * Cisco IOS zone-based firewall: zones INSIDE / OUTSIDE / DMZ on GigabitEthernet0/0–2, one zone-pair per direction
 * with an inspect policy-map whose classes are the rules (class-map CM-<rule> matching ACL-<rule>).
 */
export const IOS_ZONE: Record<FwZone, string> = { trust: "INSIDE", untrust: "OUTSIDE", dmz: "DMZ" };
export const zoneName = (vendor: CliVendor, z: FwZone) => (vendor === "cisco" ? IOS_ZONE[z] : z);
export const ifName = (vendor: CliVendor, junosIf: string, long = false) => (vendor === "cisco" ? junosIf.replace(/^ge-0\/0\/(\d)$/, long ? "GigabitEthernet0/$1" : "Gi0/$1") : junosIf);
const SHORT: Record<FwZone, string> = { trust: "IN", untrust: "OUT", dmz: "DMZ" };
export const zonePair = (from: FwZone, to: FwZone) => `ZP-${SHORT[from]}-${SHORT[to]}`;
export const policyMap = (from: FwZone, to: FwZone) => `PM-${SHORT[from]}-${SHORT[to]}`;
export const JUNOS_APP: Record<FwApp, string> = { https: "junos-https", http: "junos-http", ssh: "junos-ssh", icmp: "junos-icmp-all", any: "any" };
export const appOfJunos = (raw: string): FwApp | undefined => (Object.keys(JUNOS_APP) as FwApp[]).find((a) => JUNOS_APP[a] === raw);
export const PORT_NAME: Record<number, string> = { 443: "443", 80: "80", 22: "22" };
export const ruleText = (vendor: CliVendor, r: FwRule) => `${r.name}: ${zoneName(vendor, r.from)} → ${zoneName(vendor, r.to)} · ${r.src.join(",")} → ${r.dst.join(",")} · ${vendor === "juniper" ? JUNOS_APP[r.app] : r.app} · ${r.action === "permit" ? (vendor === "cisco" ? "inspect" : "permit") : vendor === "cisco" ? "drop" : "deny"}`;
/** Zone and interface words in model text, as the chosen OS names them. */
export const fwVendorText = (vendor: CliVendor, text: string) =>
  vendor === "cisco"
    ? text
        .replace(/\bge-0\/0\/(\d)\b/g, "Gi0/$1")
        .replace(/\buntrust\b/g, "OUTSIDE")
        .replace(/\btrust\b/g, "INSIDE")
        .replace(/\bdmz\b/g, "DMZ")
    : text;
