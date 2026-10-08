import type { R1Helpers } from "@/lib/sim-engine/scenarios/dhcpDnsBuild";
import type { JunosCandidate, R1Iface } from "./dhcpBuildCli";

/**
 * R1's configuration as each OS shows it, built from the one source of truth the simulation uses (the helper
 * addresses per interface, and for Junos the named server groups/groups that produce them). Every view (running
 * config, filtered output, set form, rollbacks, diffs) is generated here, so they can never disagree.
 */

export const R1_IFS: R1Iface[] = ["ge-0/0/0", "ge-0/0/1", "ge-0/0/2"];
const ADDR: Record<R1Iface, [string, string]> = { "ge-0/0/0": ["10.10.10.1", "24"], "ge-0/0/1": ["10.20.20.1", "24"], "ge-0/0/2": ["198.51.100.2", "30"] };
export const EMPTY_JUNOS: JunosCandidate = { serverGroups: {}, groups: {} };

// ---------------------------------------------------------------------------------------------------------------
// Junos: a tiny configuration tree (statements and stanzas), rendered the way Junos prints it
// ---------------------------------------------------------------------------------------------------------------
export interface JNode {
  name: string;
  children?: JNode[];
}
const stanza = (name: string, children: JNode[]): JNode => ({ name, children });
const leaf = (name: string): JNode => ({ name });

export function junosTree(c: JunosCandidate): JNode[] {
  const sgs = Object.entries(c.serverGroups);
  const groups = Object.entries(c.groups);
  const relay: JNode[] = [
    ...(sgs.length ? [stanza("server-group", sgs.map(([n, l]) => stanza(n, l.map(leaf))))] : []),
    ...groups.map(([n, g]) => stanza(`group ${n}`, [...(g.sg ? [leaf(`active-server-group ${g.sg}`)] : []), ...(g.iface ? [leaf(`interface ${g.iface}.0`)] : [])])),
  ];
  return [
    stanza("system", [leaf("host-name R1")]),
    stanza(
      "interfaces",
      R1_IFS.map((i) => stanza(i, [stanza("unit 0", [stanza("family inet", [leaf(`address ${ADDR[i][0]}/${ADDR[i][1]}`)])])])),
    ),
    stanza("routing-options", [stanza("static", [leaf("route 0.0.0.0/0 next-hop 198.51.100.1")])]),
    ...(relay.length ? [stanza("forwarding-options", [stanza("dhcp-relay", relay)])] : []),
  ];
}

function renderNodes(nodes: JNode[], depth = 0): string[] {
  const pad = "    ".repeat(depth);
  return nodes.flatMap((n) => (n.children ? (n.children.length ? [`${pad}${n.name} {`, ...renderNodes(n.children, depth + 1), `${pad}}`] : [`${pad}${n.name};`]) : [`${pad}${n.name};`]));
}

/** The configuration (or the part under `path`, e.g. ["forwarding-options", "dhcp-relay"]) as Junos prints it. */
export function junosText(c: JunosCandidate, path: string[] = []): string {
  let nodes = junosTree(c);
  const want = [...path];
  while (want.length) {
    // A stanza name can be one word ("interfaces") or two ("group LAN", "unit 0").
    const two = want.length > 1 ? `${want[0]} ${want[1]}` : undefined;
    const hit = nodes.find((n) => n.name === two) ?? nodes.find((n) => n.name === want[0]);
    if (!hit || !hit.children) return "";
    want.splice(0, hit.name.split(" ").length);
    nodes = hit.children;
  }
  return renderNodes(nodes).join("\n");
}

/** Top-level paths students can name after `show configuration` / `show` (and what each holds). */
export const JUNOS_PATHS: { path: string; summary: string }[] = [
  { path: "system", summary: "Host name and system settings" },
  { path: "interfaces", summary: "Interface addresses" },
  { path: "routing-options", summary: "Static routes" },
  { path: "forwarding-options", summary: "Forwarding features (the DHCP relay lives here)" },
  { path: "forwarding-options dhcp-relay", summary: "The DHCP relay: server groups and relay groups" },
];

// ---------------------------------------------------------------------------------------------------------------
// Junos ⇄ helpers
// ---------------------------------------------------------------------------------------------------------------
/** What a candidate would make R1 do, or the commit check-out error that stops it. */
export function candidateHelpers(c: JunosCandidate): { helpers: R1Helpers } | { error: string; note: string } {
  const helpers: R1Helpers = {};
  for (const [n, g] of Object.entries(c.groups)) {
    if (!g.iface) return { error: `[edit forwarding-options dhcp-relay group ${n}]\n  'interface'\n    group ${n} has no interface\nerror: configuration check-out failed`, note: `commit failed: group ${n} has no interface` };
    if (!g.sg || !c.serverGroups[g.sg]) return { error: `[edit forwarding-options dhcp-relay group ${n}]\n  'active-server-group ${g.sg ?? ""}'\n    server group not defined\nerror: configuration check-out failed`, note: `commit failed: server group ${g.sg ?? "(none)"} not defined` };
    helpers[g.iface] = [...new Set([...(helpers[g.iface] ?? []), ...c.serverGroups[g.sg]])];
  }
  return { helpers };
}

/** The Junos form of helpers set some other way (the IOS view), keeping the names already used for each interface. */
export function helpersToCandidate(h: R1Helpers, prev: JunosCandidate): JunosCandidate {
  const out: JunosCandidate = { serverGroups: {}, groups: {} };
  let n = 0;
  for (const i of R1_IFS) {
    const list = h[i] ?? [];
    if (!list.length) continue;
    n++;
    const old = Object.entries(prev.groups).find(([, g]) => g.iface === i);
    const group = old?.[0] ?? `G${n}`;
    const sg = old?.[1].sg ?? `SERVERS${n}`;
    out.serverGroups[sg] = [...list];
    out.groups[group] = { sg, iface: i };
  }
  return out;
}

const norm = (c: JunosCandidate) =>
  JSON.stringify([
    Object.entries(c.serverGroups)
      .map(([k, v]) => [k, [...v].sort()])
      .sort(),
    Object.entries(c.groups)
      .map(([k, g]) => [k, g.sg ?? "", g.iface ?? ""])
      .sort(),
  ]);
export const sameCfg = (a: JunosCandidate, b: JunosCandidate) => norm(a) === norm(b);

// ---------------------------------------------------------------------------------------------------------------
// IOS: contextual differences between two configurations (show archive config differences)
// ---------------------------------------------------------------------------------------------------------------
function iosSections(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let head = "";
  for (const raw of text.split("\n")) {
    if (!raw.trim() || raw.trim() === "!" || /^(Building configuration|Current configuration|Using \d+ out of)/.test(raw)) continue;
    if (!raw.startsWith(" ")) {
      head = raw.trim();
      if (!out.has(head)) out.set(head, []);
    } else out.get(head)?.push(raw.trim());
  }
  return out;
}
export function iosDiff(from: string, to: string): string {
  const a = iosSections(from);
  const b = iosSections(to);
  const lines: string[] = [];
  for (const [head, kids] of b) {
    if (!a.has(head)) {
      lines.push(`+${head}`, ...kids.map((k) => ` +${k}`));
      continue;
    }
    const old = a.get(head)!;
    const add = kids.filter((k) => !old.includes(k));
    const del = old.filter((k) => !kids.includes(k));
    if (add.length || del.length) lines.push(head, ...del.map((k) => ` -${k}`), ...add.map((k) => ` +${k}`));
  }
  for (const [head, kids] of a) if (!b.has(head)) lines.push(`-${head}`, ...kids.map((k) => ` -${k}`));
  return ["!Contextual Config Diffs:", ...(lines.length ? lines : ["!No changes were found"])].join("\n");
}
