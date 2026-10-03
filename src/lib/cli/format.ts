import type { CliArgSpec, CliCommand, CliVendor } from "./types";

/** "02:AA:00:00:00:01" → "02aa.0000.0001" (IOS dotted-quad hex). */
export function ciscoMac(mac: string): string {
  const hex = mac.replace(/[^0-9a-f]/gi, "").toLowerCase();
  return `${hex.slice(0, 4)}.${hex.slice(4, 8)}.${hex.slice(8, 12)}`;
}

/** "02:AA:00:00:00:01" → "02:aa:00:00:00:01" (Junos lower-case colon form). */
export function junosMac(mac: string): string {
  return mac.toLowerCase();
}

/** Left-aligned fixed-width columns; the last column is never padded. */
export function columns(rows: string[][], widths: number[]): string {
  return rows.map((r) => r.map((cell, i) => (i < r.length - 1 ? cell.padEnd(widths[i]) : cell)).join("").trimEnd()).join("\n");
}

export function prefixToMask(len: number): string {
  const bits = len === 0 ? 0 : (0xffffffff << (32 - len)) >>> 0;
  return [24, 16, 8, 0].map((s) => (bits >>> s) & 255).join(".");
}

function ipToInt(ip: string): number {
  return ip.split(".").reduce((acc, o) => ((acc << 8) + Number(o)) >>> 0, 0);
}

export function ipInSubnet(ip: string, network: string, prefixLength: number): boolean {
  if (prefixLength === 0) return true;
  const mask = (0xffffffff << (32 - prefixLength)) >>> 0;
  return (ipToInt(ip) & mask) === (ipToInt(network) & mask);
}

export function networkOf(ip: string, prefixLength: number): string {
  const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
  const n = ipToInt(ip) & mask;
  return [24, 16, 8, 0].map((s) => (n >>> s) & 255).join(".");
}

/**
 * Interface-name argument that accepts the forms an engineer actually
 * types: full names ("GigabitEthernet0/0"), any IOS-style abbreviation
 * ("Gi0/0", "g0/0"), and Junos names with or without a ".0" unit.
 * `names` maps canonical id → full vendor name; `descriptions` (same keys)
 * feeds the `?` help ("Laptop-facing interface").
 */
export function interfaceArg(vendor: CliVendor, names: Record<string, string>, descriptions: Record<string, string> = {}): CliArgSpec {
  return {
    choices: Object.values(names),
    describe: (choice) => descriptions[Object.keys(names).find((id) => names[id] === choice) ?? ""],
    resolve: (raw) => {
      const lower = raw.toLowerCase();
      for (const [id, full] of Object.entries(names)) {
        const fullLower = full.toLowerCase();
        if (vendor === "juniper") {
          if (lower === fullLower || lower === `${fullLower}.0`) return id;
          continue;
        }
        const m = /^([a-z-]+)(\d+(?:\/\d+)*)$/.exec(lower);
        const fm = /^([a-z-]+)(\d+(?:\/\d+)*)$/.exec(fullLower);
        if (m && fm && m[2] === fm[2] && fm[1].startsWith(m[1])) return id;
      }
      return undefined;
    },
  };
}

const anyArg: CliArgSpec = { choices: [], resolve: (raw) => raw };

/**
 * Hidden commands every read-only lesson CLI should answer honestly
 * instead of pretending they work: configuration mode, and active
 * probes (ping/traceroute) that would themselves generate traffic and
 * silently change the state the learner is inspecting.
 */
export function readOnlyBoundaryCommands(vendor: CliVendor): CliCommand[] {
  const configMsg =
    vendor === "cisco"
      ? "% Configuration mode is not available here.\n% PacketVerse CLI is read-only in this lesson: inspect state with show commands."
      : "error: configuration mode is not available here.\nPacketVerse CLI is read-only in this lesson: inspect state with show commands.";
  const probeMsg = (verb: string) =>
    vendor === "cisco"
      ? `% '${verb}' is not available in this lesson.\n% Sending a probe would itself trigger ARP and change the state you are inspecting.`
      : `error: '${verb}' is not available in this lesson.\nSending a probe would itself trigger ARP and change the state you are inspecting.`;
  const refuse = (output: string) => () => ({ output, refused: true });
  const cmds: CliCommand[] =
    vendor === "cisco"
      ? [
          { id: "boundary-config", syntax: "configure terminal", summary: "", hidden: true, run: refuse(configMsg) },
          { id: "boundary-config", syntax: "configure", summary: "", hidden: true, run: refuse(configMsg) },
        ]
      : [
          { id: "boundary-config", syntax: "configure", summary: "", hidden: true, run: refuse(configMsg) },
          { id: "boundary-config", syntax: "edit", summary: "", hidden: true, run: refuse(configMsg) },
        ];
  for (const verb of ["ping", "traceroute"]) {
    cmds.push({ id: "boundary-probe", syntax: verb, summary: "", hidden: true, run: refuse(probeMsg(verb)) });
    cmds.push({ id: "boundary-probe", syntax: `${verb} <target>`, summary: "", hidden: true, args: { target: anyArg }, run: refuse(probeMsg(verb)) });
  }
  return cmds;
}
