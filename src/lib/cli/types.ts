/**
 * Generic, protocol-agnostic types for PacketVerse's interactive CLI.
 *
 * Architecture: scenario truth → command adapter → terminal rendering.
 * A lesson's adapter turns its scenario snapshot into a CliCommandSet
 * (one per device × vendor); the parser in ./parser.ts matches typed
 * input against it; CLITerminal only renders. Nothing in /lib/cli knows
 * about ARP, OSPF, BGP, … — that knowledge lives in each lesson adapter.
 */

export type CliVendor = "cisco" | "juniper";

export const CLI_VENDOR_LABEL: Record<CliVendor, string> = {
  cisco: "Cisco IOS",
  juniper: "Juniper Junos",
};

/** A positional argument such as `<interface>`. `resolve` returns the canonical value, or undefined when the raw token isn't valid. */
export interface CliArgSpec {
  /** Concrete values offered in help and Tab completion (e.g. "GigabitEthernet0/0"). */
  choices: string[];
  resolve: (raw: string) => string | undefined;
  /** Short `?` description for one choice ("Laptop-facing interface"). */
  describe?: (choice: string) => string | undefined;
}

export interface CliResult {
  output: string;
  /** Optional plain-language teaching note shown under the output — the networking concept, not vendor marketing. */
  explanation?: string;
  /** Renders the output as a warning/refusal (e.g. a read-only boundary) rather than normal output. */
  refused?: boolean;
}

export interface CliCommand {
  /** Stable id — lessons key checklists/telemetry on it, never on the typed text. */
  id: string;
  /** Space-separated words; `<name>` marks an argument defined in `args`. */
  syntax: string;
  summary: string;
  args?: Record<string, CliArgSpec>;
  /** Accepted when typed, but not listed in help / completion (aliases, boundary refusals). */
  hidden?: boolean;
  run: (args: Record<string, string>) => CliResult;
}

export interface CliCommandSet {
  vendor: CliVendor;
  deviceId: string;
  /** Hostname as the device would show it ("R1"). */
  deviceName: string;
  /** Exact prompt text, including any trailing space ("R1#", "user@R1> "). */
  prompt: string;
  commands: CliCommand[];
  /**
   * Short `?` descriptions for keyword nodes, keyed by the canonical keyword
   * path ("show", "show ip", "show ip interface brief"). The grammar itself
   * is derived from `commands`; this only adds help text.
   */
  help?: Record<string, string>;
}

/** One line of `?` help or a Tab candidate. */
export interface CliHelpEntry {
  label: string;
  description?: string;
}

export type CliExecution =
  | { kind: "empty" }
  | { kind: "clear" }
  | { kind: "help"; output: string }
  | { kind: "ok"; commandId: string; output: string; explanation?: string; refused?: boolean }
  | { kind: "error"; output: string };
