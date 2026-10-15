import type { GuideCliRun } from "@/components/lesson/GuideCli";
import { neighbors, type DiscState } from "@/lib/sim-engine/scenarios/ccna/discovery";

const pad = (s: string, n: number) => (s.length >= n ? `${s} ` : s.padEnd(n));
const capCode = (c: string) => (c.startsWith("Switch") ? "S I" : c === "Router" ? "R" : c === "Trans-Bridge" ? "T" : c === "Telephone" ? "P" : c);

/** Cisco-style `show cdp neighbors` from SW1's model state (holdtimes live). */
export function showCdp(s: DiscState): GuideCliRun {
  const rows = neighbors(s, "CDP");
  return {
    prompt: "SW1#",
    command: "show cdp neighbors",
    output: !s.sw1.CDP
      ? "% CDP is not enabled"
      : [
          "Capability Codes: R - Router, T - Trans Bridge, S - Switch, I - IGMP, P - Phone",
          `${pad("Device ID", 12)}${pad("Local Intrfce", 15)}${pad("Holdtme", 9)}${pad("Capability", 12)}${pad("Platform", 17)}Port ID`,
          ...rows.map((r) => `${pad(r.peer.id, 12)}${pad(r.peer.local, 15)}${pad(String(r.holdLeft), 9)}${pad(capCode(r.peer.caps), 12)}${pad(r.peer.platform.replace("Cisco ", ""), 17)}${r.peer.port}`),
          `Total cdp entries displayed : ${rows.length}`,
        ].join("\n"),
  };
}
/** Cisco-style `show lldp neighbors` from the same state. */
export function showLldp(s: DiscState): GuideCliRun {
  const rows = neighbors(s, "LLDP");
  return {
    prompt: "SW1#",
    command: "show lldp neighbors",
    output: !s.sw1.LLDP
      ? "% LLDP is not enabled"
      : [
          "Capability codes: (R) Router, (B) Bridge, (T) Telephone, (W) WLAN Access Point",
          `${pad("Device ID", 12)}${pad("Local Intf", 13)}${pad("Hold-time", 11)}${pad("Capability", 12)}Port ID`,
          ...rows.map((r) => `${pad(r.peer.id, 12)}${pad(r.peer.local, 13)}${pad(String(r.holdLeft), 11)}${pad(r.peer.caps === "Router" ? "R" : r.peer.caps === "Telephone" ? "T" : r.peer.caps === "Trans-Bridge" ? "W" : "B", 12)}${r.peer.port}`),
          `Total entries displayed: ${rows.length}`,
        ].join("\n"),
  };
}
/** Junos `show lldp neighbors` as R1 would see SW1. */
export function junosLldp(s: DiscState): GuideCliRun {
  return {
    prompt: "admin@R1> ",
    command: "show lldp neighbors",
    output: s.sw1.LLDP && !s.unplugged.includes("R1") ? ["Local Interface    Parent Interface    Chassis Id          Port info     System Name", "ge-0/0/0           -                   00:1e:bd:7a:00:00   Gi1/0/48      SW1"].join("\n") : "Local Interface    Parent Interface    Chassis Id          Port info     System Name\n(no neighbours — SW1 is not sending LLDP)",
  };
}
