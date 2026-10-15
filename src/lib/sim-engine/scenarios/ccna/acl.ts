import type { PacketVisual, ScenarioStep } from "../../types";
import type { ProcessingStage } from "@/components/network3d/types";
import { act, acted, hop, kitBase, layer, packet, q, repairStep, say, stackOf, withDetail, type KitBase } from "./kit";

/**
 * Access Control Lists (CCNA 5.6). R1 joins a staff LAN, a guest LAN and a server LAN (web, database, and later a
 * print portal). Policy: guests may use the internet and the web server over HTTPS, and nothing else in the server LAN.
 *
 * Modeled (computed):
 * - Wildcard masks from prefixes, and address matching with them ((addr AND NOT wc) == (net AND NOT wc)).
 * - Standard ACLs match the source only; extended ACLs match protocol, source, destination and port.
 * - Evaluation is top-down, first match wins, and a packet matching nothing hits the implicit deny.
 * - Per-entry hit counters, as `show access-lists` reports them.
 * - An ACL acts only where it is applied: interface and direction.
 */

export const ip2n = (a: string) => a.split(".").reduce((n, o) => n * 256 + Number(o), 0);
export const n2ip = (n: number) => [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join(".");
/** Wildcard for a prefix length: the inverse of the mask. */
export const wildcardOf = (len: number) => n2ip(2 ** (32 - len) - 1);
export function wcMatch(addr: string, net: string, wc: string) {
  const a = ip2n(addr);
  const n = ip2n(net);
  const w = ip2n(wc);
  // compare only the bits the wildcard marks as "must match" (0 bits)
  for (let bit = 31; bit >= 0; bit--) {
    const m = 2 ** bit;
    const care = Math.floor(w / m) % 2 === 0;
    if (care && Math.floor(a / m) % 2 !== Math.floor(n / m) % 2) return false;
  }
  return true;
}

export interface Ace {
  seq: number;
  action: "permit" | "deny";
  proto: "ip" | "tcp" | "udp";
  src: [string, string];
  /** Extended only. */
  dst?: [string, string];
  port?: number;
}
export interface Acl {
  name: string;
  kind: "standard" | "extended";
  aces: Ace[];
}
export interface Flow {
  id: string;
  label: string;
  proto: "tcp" | "udp";
  src: string;
  dst: string;
  port: number;
}
export interface Verdict {
  seq: number | "implicit";
  action: "permit" | "deny";
}

const ANY: [string, string] = ["0.0.0.0", "255.255.255.255"];
export const hostOf = (a: string): [string, string] => [a, "0.0.0.0"];
export const aceMatches = (e: Ace, f: Flow) => (e.proto === "ip" || e.proto === f.proto) && wcMatch(f.src, e.src[0], e.src[1]) && (!e.dst || wcMatch(f.dst, e.dst[0], e.dst[1])) && (e.port === undefined || e.port === f.port);
export function evaluate(acl: Acl, f: Flow): Verdict {
  for (const e of [...acl.aces].sort((a, b) => a.seq - b.seq)) if (aceMatches(e, f)) return { seq: e.seq, action: e.action };
  return { seq: "implicit", action: "deny" };
}

const addrText = ([a, w]: [string, string]) => (w === "0.0.0.0" ? `host ${a}` : w === "255.255.255.255" ? "any" : `${a} ${w}`);
export const aceText = (e: Ace) => `${e.seq} ${e.action} ${e.proto} ${addrText(e.src)}${e.dst ? ` ${addrText(e.dst)}` : ""}${e.port !== undefined ? ` eq ${e.port}` : ""}`;

export const NET = { staff: "10.1.10.0", guest: "10.1.20.0", servers: "10.1.50.0", web: "10.1.50.10", db: "10.1.50.20", portal: "10.1.50.30" };
export const FLOWS: Record<string, Flow> = {
  guestWeb: { id: "guestWeb", label: "Guest → WEB HTTPS", proto: "tcp", src: "10.1.20.33", dst: NET.web, port: 443 },
  guestDb: { id: "guestDb", label: "Guest → DB SQL", proto: "tcp", src: "10.1.20.33", dst: NET.db, port: 1433 },
  guestNet: { id: "guestNet", label: "Guest → internet HTTPS", proto: "tcp", src: "10.1.20.33", dst: "142.250.80.46", port: 443 },
  staffDb: { id: "staffDb", label: "Staff → DB SQL", proto: "tcp", src: "10.1.10.15", dst: NET.db, port: 1433 },
  guestPortal: { id: "guestPortal", label: "Guest → PORTAL HTTPS", proto: "tcp", src: "10.1.20.33", dst: NET.portal, port: 443 },
};

export const STANDARD_ACL: Acl = { name: "10", kind: "standard", aces: [{ seq: 10, action: "deny", proto: "ip", src: [NET.guest, wildcardOf(24)] }, { seq: 20, action: "permit", proto: "ip", src: ANY }] };
export const GUEST_IN: Acl = {
  name: "GUEST-IN",
  kind: "extended",
  aces: [
    { seq: 10, action: "permit", proto: "tcp", src: [NET.guest, wildcardOf(24)], dst: hostOf(NET.web), port: 443 },
    { seq: 20, action: "deny", proto: "ip", src: [NET.guest, wildcardOf(24)], dst: [NET.servers, wildcardOf(24)] },
    { seq: 30, action: "permit", proto: "ip", src: [NET.guest, wildcardOf(24)], dst: ANY },
  ],
};
/** The incident's addition: appended with the next free sequence number. */
export const PORTAL_ACE: Ace = { seq: 40, action: "permit", proto: "tcp", src: [NET.guest, wildcardOf(24)], dst: hostOf(NET.portal), port: 443 };

export interface Applied {
  acl: Acl;
  iface: string;
  dir: "in" | "out";
}
export interface AclState extends KitBase {
  applied?: Applied;
  hits: Record<string, number>;
  results: { flow: string; verdict: Verdict; acl: string }[];
  portal: boolean;
}
export function createAclState(): AclState {
  return { ...kitBase(), hits: {}, results: [], portal: false };
}

/** Which interface a flow enters R1 on, and which it leaves by. */
const ingressOf = (f: Flow) => (f.src.startsWith("10.1.20.") ? "Gi0/1" : "Gi0/0");
const egressOf = (f: Flow) => (f.dst.startsWith("10.1.50.") ? "Gi0/2" : "Gi0/3");
const sourceNode = (f: Flow) => (f.src.startsWith("10.1.20.") ? "GUEST" : "STAFF");
const destNode = (f: Flow) => (f.dst === NET.web ? "WEB" : f.dst === NET.db ? "DB" : f.dst === NET.portal ? "PORTAL" : "NET");

export const wildcardRows = () => [24, 26, 32, 16].map((l) => ({ prefix: `/${l}`, wildcard: wildcardOf(l) }));

const C = { ip: "#60a5fa", tcp: "#34d399" };
export const ST = {
  r1: [{ id: "rx", label: "Receive on interface" }, { id: "in", label: "Inbound ACL (if applied here)" }, { id: "route", label: "Route lookup" }, { id: "out", label: "Outbound ACL (if applied there)" }, { id: "tx", label: "Forward or drop" }],
  host: [{ id: "tx", label: "Send" }],
} satisfies Record<string, ProcessingStage[]>;

export const ACL_REPAIR_OPTIONS = [
  { id: "seq15", label: "Re-enter the portal permit as sequence 15, above the deny for the server LAN (and remove 40)" },
  { id: "anyany", label: "Add 'permit ip any any' at the end" },
  { id: "out", label: "Apply GUEST-IN outbound on Gi0/1 instead of inbound" },
  { id: "wc", label: "Change the portal line's wildcard to 0.0.0.255" },
];
export const ACL_REPAIR_CORRECT = "seq15";

type Step = ScenarioStep<AclState>;
const pkt = (id: string, f: Flow): PacketVisual =>
  packet(id, "TCP", sourceNode(f), "R1", `TCP ${f.port}`, `${f.label} · ${f.src} → ${f.dst}:${f.port}`, [layer("IPv4 Header", C.ip, [["Source IP", f.src], ["Destination IP", f.dst], ["Protocol", f.proto.toUpperCase()]]), layer("TCP Header", C.tcp, [["Destination Port", String(f.port)]])]);

/** Send a flow through R1: apply the ACL where it is applied, count the hit, record the result. */
function send(id: string, flowId: keyof typeof FLOWS): (s: AclState) => AclState {
  return (s) => {
    const f = FLOWS[flowId];
    const a = s.applied;
    const inIf = ingressOf(f);
    const outIf = egressOf(f);
    const here = a && ((a.dir === "in" && a.iface === inIf) || (a.dir === "out" && a.iface === outIf));
    const v: Verdict = here ? evaluate(a.acl, f) : { seq: "implicit", action: "permit" };
    const key = here ? `${a.acl.name}:${v.seq}` : "";
    const hits = here ? { ...s.hits, [key]: (s.hits[key] ?? 0) + 1 } : s.hits;
    const p = pkt(`${id}-p`, f);
    const ok = v.action === "permit";
    const line = here ? (v.seq === "implicit" ? "implicit deny (no line matched)" : aceText(a.acl.aces.find((e) => e.seq === v.seq)!)) : "no ACL on this path";
    const n = acted(
      { ...s, hits },
      hop({
        stepId: id,
        device: "R1",
        stages: withDetail(ST.r1, { rx: inIf, [a?.dir === "out" ? "out" : "in"]: here ? `${a.acl.name}: ${line}` : "—", route: `${f.dst} → ${outIf}`, tx: ok ? `forward out ${outIf}` : "drop" }),
        activeStageId: here ? (a.dir === "in" ? "in" : "out") : "route",
        ingressInterfaceId: inIf,
        egressInterfaceId: ok ? outIf : undefined,
        lookupType: here ? `ACL ${a.acl.name} (${a.dir} on ${a.iface})` : "ACL",
        lookupKey: `${f.proto} ${f.src} → ${f.dst}:${f.port}`,
        lookupResult: line,
        action: ok ? "PERMIT" : "DENY",
        reason: !here ? "No ACL is applied on this flow's path." : v.seq === "implicit" ? "Nothing matched, so the invisible last line — deny everything — applied." : "Lines are checked top-down; the first match decides and the rest are never read.",
        input: p.summary,
        output: ok ? `forwarded to ${destNode(f)}` : "dropped",
        nextHopId: ok ? destNode(f) : undefined,
        before: stackOf(p),
      }),
      p,
      `${f.label}: ${ok ? "permit" : "deny"} (${!here ? "no ACL on path" : v.seq === "implicit" ? "implicit deny" : `seq ${v.seq}`})`,
    );
    return { ...n, results: [...n.results, { flow: f.label, verdict: v, acl: here ? a.acl.name : "—" }] };
  };
}

const apply = (acl: Acl, iface: string, dir: "in" | "out") => (s: AclState): AclState => ({ ...s, applied: { acl, iface, dir }, hits: {}, packet: undefined, flood: [], decision: { device: "R1", text: `ip access-group ${acl.name} ${dir} on ${iface}` } });

export const aclSteps: Step[] = [
  say("intro", "An ordered list", "An ACL is an ordered list of permit and deny lines. A router reads it top to bottom for each packet and stops at the first line that matches.", {
    question: q("A packet matches none of the lines you wrote. What happens to it?", [["deny", "It is dropped — every ACL ends with an invisible 'deny any'"], ["permit", "It is permitted"], ["log", "It is logged and permitted"], ["next", "The router checks the next ACL on the interface"]], "deny", "Every ACL ends with an implicit deny. If you want unmatched traffic to pass, you must say so with a final permit."),
  }),
  say("predict-wildcard", "Predict: a wildcard mask", "ACLs describe address ranges with wildcard masks: a 0 bit must match, a 1 bit is ignored. For a whole prefix, the wildcard is the inverse of the subnet mask.", {
    question: q("Which wildcard matches exactly 10.1.10.64/26?", [["63", "10.1.10.64 0.0.0.63"], ["192", "10.1.10.64 255.255.255.192"], ["255", "10.1.10.64 0.0.0.255"], ["64", "10.1.10.64 0.0.0.64"]], "63", "A /26 mask is 255.255.255.192; its inverse is 0.0.0.63 — the last 6 bits are free, which spans .64 to .127. 0.0.0.255 would match the whole /24."),
  }),
  act("wildcard", "Wildcards, computed", `The model inverts each mask: /24 → ${wildcardOf(24)}, /26 → ${wildcardOf(26)}, /32 → ${wildcardOf(32)} (one host: 'host'), /16 → ${wildcardOf(16)}. 'any' is 0.0.0.0 255.255.255.255.`, (s) =>
    acted(s, hop({ stepId: "wildcard", device: "R1", stages: withDetail(ST.r1, { in: wildcardRows().map((r) => `${r.prefix} → ${r.wildcard}`).join(" · ") }), activeStageId: "in", lookupType: "Wildcard", lookupKey: "255.255.255.255 − mask", lookupResult: `10.1.10.64/26 → ${wildcardOf(26)}; 10.1.10.70 ${wcMatch("10.1.10.70", "10.1.10.64", wildcardOf(26)) ? "matches" : "doesn't"}; 10.1.10.130 ${wcMatch("10.1.10.130", "10.1.10.64", wildcardOf(26)) ? "matches" : "doesn't"}`, action: "COMPUTE", reason: "Wildcards are not masks: 0 = check this bit, 1 = ignore it.", input: "prefixes", output: "wildcards" }), undefined, "0 = match, 1 = ignore"), "STEP_ENTERED"),
  say("policy", "The policy", "The security team's rule: guests (10.1.20.0/24) may browse the internet and reach WEB over HTTPS; nothing else in the server LAN (10.1.50.0/24). Staff are unrestricted."),
  act("standard", "First try: a standard ACL", "A standard ACL matches the source address only. ACL 10 denies 10.1.20.0 0.0.0.255 and permits everything else; it is applied outbound on Gi0/2, toward the servers.", apply(STANDARD_ACL, "Gi0/2", "out"), "STEP_ENTERED"),
  act("std-web", "Guest to WEB", "A guest opens https://web on 10.1.50.10.", send("std-web", "guestWeb"), "PACKET_DROPPED", undefined),
  say("std-limit", "Too blunt", "ACL 10 can't tell WEB from the database or HTTPS from SQL: all it sees is the guest source address. The policy needs destination and port — an extended ACL."),
  say("predict-placement", "Predict: where to apply it", "The extended ACL GUEST-IN will permit HTTPS to WEB, deny the rest of the server LAN, and permit guests everywhere else.", {
    question: q("Where should an extended ACL like GUEST-IN be applied?", [["src", "Inbound on Gi0/1, close to the guests"], ["dst", "Outbound on Gi0/2, close to the servers"], ["wan", "Outbound on the internet link"], ["all", "On every interface, in both directions"]], "src", "An extended ACL names source, destination and port, so it can sit near the source and drop unwanted traffic before it crosses the network. A standard ACL matches only the source, so it goes near the destination to avoid blocking too much."),
  }),
  act("extended", "GUEST-IN, inbound on Gi0/1", "ACL 10 is removed. GUEST-IN goes inbound on Gi0/1: 10 permit HTTPS to WEB; 20 deny the server LAN; 30 permit the rest.", apply(GUEST_IN, "Gi0/1", "in"), "STEP_ENTERED"),
  act("ext-web", "Guest to WEB, again", "The guest opens https://web.", send("ext-web", "guestWeb"), "PACKET_SENT"),
  act("ext-db", "Guest to the database", "A guest laptop tries the database on TCP 1433.", send("ext-db", "guestDb"), "PACKET_DROPPED"),
  act("ext-net", "Guest to the internet", "The guest browses an internet site.", send("ext-net", "guestNet"), "PACKET_SENT"),
  act("ext-staff", "Staff to the database", "A staff PC queries the database. It enters R1 on Gi0/0, where no ACL is applied.", send("ext-staff", "staffDb"), "PACKET_SENT"),
  say("predict-order", "Predict: order matters", "Suppose lines 10 and 20 were swapped, so the deny for the whole server LAN came first.", {
    question: q("With the deny first, what happens to a guest's HTTPS to WEB?", [["deny", "Denied — the server-LAN deny matches first and the permit is never read"], ["permit", "Permitted — the more specific line wins"], ["both", "Both lines apply, so it is logged and permitted"], ["error", "The router rejects the ACL"]], "deny", "ACLs use the first match, not the best match. A general deny above a specific permit shadows it — so specific lines go first."),
  }),
  say("named", "Named ACLs and sequence numbers", "Named ACLs (ip access-list extended GUEST-IN) and numbered ones work alike. Each line has a sequence number; new lines are appended at the next multiple of 10 unless you give a number, and you can insert or delete a single line by its number. One ACL per interface, per direction, per protocol."),
  // incident
  act("fault-injected", "A new portal", "A print portal (10.1.50.30) goes live, and guests should reach it over HTTPS. An engineer adds 'permit tcp 10.1.20.0 0.0.0.255 host 10.1.50.30 eq 443' to GUEST-IN.", (s) => {
    const acl: Acl = { ...GUEST_IN, aces: [...GUEST_IN.aces, PORTAL_ACE] };
    return { ...s, portal: true, faultActive: true, applied: { acl, iface: "Gi0/1", dir: "in" }, packet: undefined, flood: [], decision: { device: "R1", text: `added: ${aceText(PORTAL_ACE)}` } };
  }, "STEP_ENTERED"),
  act("inc-portal", "Guests can't print", "Guests report the portal times out. The engineer tests from a guest laptop and reads the hit counters.", send("inc-portal", "guestPortal"), "PACKET_DROPPED"),
  say("trouble-question", "Diagnose", "show access-lists GUEST-IN: line 20's matches keep climbing as guests retry; line 40 has no matches at all.", {
    question: q("Why is the portal blocked?", [["order", "The new line was appended as 40, below line 20's deny for the whole server LAN — line 20 matches first"], ["wc", "The portal line's wildcard is wrong"], ["dir", "GUEST-IN is applied in the wrong direction"], ["implicit", "The implicit deny blocks it"]], "order", "First match wins. 10.1.50.30 is inside 10.1.50.0/24, so line 20 matches and drops it; line 40 is never read — its zero hit count is the evidence.", ["Which line's counter rises when a guest retries?", "Is 10.1.50.30 inside 10.1.50.0 0.0.0.255?", "Is line 40 ever reached?"]),
  }),
  say("diagnostic-layers", "Troubleshooting layers", "Work down the list: is the ACL applied where you think, which line matches first, and do the counters agree?"),
  repairStep("repair-challenge", "Repair", "Choose the change that fixes the cause.", ACL_REPAIR_CORRECT, (s) => {
    const acl: Acl = { ...GUEST_IN, aces: [...GUEST_IN.aces, { ...PORTAL_ACE, seq: 15 }] };
    return { ...s, applied: { acl, iface: "Gi0/1", dir: "in" }, decision: { device: "R1", text: "15 permit tcp 10.1.20.0 0.0.0.255 host 10.1.50.30 eq 443 · no 40" } };
  }),
  act("verify", "Proof", "The guest retries the portal. Line 15 matches first; the database stays blocked by line 20.", (s) => send("verify", "guestPortal")(send("verify-db", "guestDb")(s)), "PACKET_SENT"),
  say("complete", "Access control lists", "Wildcards invert masks; lines are read top-down and the first match decides; an implicit deny ends every list; standard ACLs near the destination, extended near the source; and hit counters show which line really matched."),
];
