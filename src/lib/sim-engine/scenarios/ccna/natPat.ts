import type { PacketVisual, ScenarioStep } from "../../types";
import type { ProcessingStage } from "@/components/network3d/types";
import { act, acted, hop, kitBase, layer, packet, q, repairStep, say, stackOf, withDetail, type KitBase } from "./kit";

/**
 * NAT & PAT (CCNA 4.1). R1 connects the office (inside, Gi0/0) to the ISP (outside, Gi0/1). The ISP routed the block
 * 203.0.113.0/29 to R1: .1 is the ISP, .2 is R1's outside interface, .3–.6 are free.
 *
 * Modeled:
 * - Static NAT: one inside local address permanently ↔ one inside global address (works in both directions).
 * - Dynamic NAT: inside hosts permitted by an ACL borrow one address each from a pool; when the pool is empty, new hosts
 *   fail.
 * - PAT (overload): every permitted host shares one inside global address; each flow is told apart by its source port.
 *   R1 keeps the host's source port if it is still free on that address, else takes the next free port.
 * - Return traffic: the destination (inside global address:port) is looked up in the translation table to find the
 *   inside host. A packet whose source isn't permitted by the ACL leaves untranslated — and the ISP drops private
 *   sources.
 */

export interface Xlate {
  proto: "tcp" | "udp" | "—";
  insideLocal: string;
  insideGlobal: string;
  outsideGlobal: string;
  kind: "static" | "dynamic" | "pat";
}
export interface NatState extends KitBase {
  mode: "none" | "dynamic" | "pat";
  /** Source prefixes permitted by ACL 1 (prefix, length). */
  acl: [string, number][];
  pool: string[];
  statics: { local: string; global: string }[];
  table: Xlate[];
  results: string[];
}
const n = (ip: string) => ip.split(".").reduce((a, o) => a * 256 + Number(o), 0) >>> 0;
const inP = (ip: string, p: string, len: number) => {
  const m = len === 0 ? 0 : (0xffffffff << (32 - len)) >>> 0;
  return ((n(ip) & m) >>> 0) === ((n(p) & m) >>> 0);
};
export const OUTSIDE_IP = "203.0.113.2";
export const WEB = { local: "10.1.1.100", global: "203.0.113.5" };
export function createNatState(): NatState {
  return { ...kitBase(), mode: "none", acl: [["10.1.1.0", 24]], pool: ["203.0.113.3", "203.0.113.4"], statics: [WEB], table: [{ proto: "—", insideLocal: WEB.local, insideGlobal: WEB.global, outsideGlobal: "—", kind: "static" }], results: [] };
}
export const permitted = (s: NatState, src: string) => s.acl.some(([p, l]) => inP(src, p, l));
const split = (hp: string) => {
  const [ip, port] = hp.split(":");
  return { ip, port: Number(port) };
};

/** Outbound translation for one new flow. Returns the new state and what happened. */
export function translateOut(s: NatState, src: string, sport: number, dst: string, dport: number): { s: NatState; out?: string; note: string } {
  const st = s.statics.find((x) => x.local === src);
  if (st) return { s, out: `${st.global}:${sport}`, note: `static ${src} → ${st.global}` };
  if (!permitted(s, src) || s.mode === "none") return { s, note: `not permitted by ACL 1 — sent untranslated from ${src}` };
  if (s.mode === "dynamic") {
    const existing = s.table.find((x) => x.kind === "dynamic" && x.insideLocal === src);
    if (existing) return { s, out: `${existing.insideGlobal}:${sport}`, note: `existing dynamic ${src} → ${existing.insideGlobal}` };
    const used = new Set(s.table.filter((x) => x.kind === "dynamic").map((x) => x.insideGlobal));
    const free = s.pool.find((a) => !used.has(a));
    if (!free) return { s, note: "pool exhausted — no address free; packet dropped" };
    const x: Xlate = { proto: "—", insideLocal: src, insideGlobal: free, outsideGlobal: "—", kind: "dynamic" };
    return { s: { ...s, table: [...s.table, x] }, out: `${free}:${sport}`, note: `dynamic ${src} → ${free}` };
  }
  const usedPorts = new Set(s.table.filter((x) => x.kind === "pat").map((x) => split(x.insideGlobal).port));
  let port = sport;
  while (usedPorts.has(port)) port++;
  const x: Xlate = { proto: "tcp", insideLocal: `${src}:${sport}`, insideGlobal: `${OUTSIDE_IP}:${port}`, outsideGlobal: `${dst}:${dport}`, kind: "pat" };
  return { s: { ...s, table: [...s.table, x] }, out: `${OUTSIDE_IP}:${port}`, note: port === sport ? `PAT ${src}:${sport} → ${OUTSIDE_IP}:${port}` : `PAT ${src}:${sport} → ${OUTSIDE_IP}:${port} (port ${sport} already in use)` };
}
/** Inbound: find the inside host for a packet to inside-global addr:port. */
export function translateIn(s: NatState, dstGlobal: string): string | undefined {
  const { ip, port } = split(dstGlobal);
  const st = s.statics.find((x) => x.global === ip);
  if (st) return `${st.local}:${port}`;
  const pat = s.table.find((x) => x.kind === "pat" && x.insideGlobal === dstGlobal);
  if (pat) return pat.insideLocal;
  const dyn = s.table.find((x) => x.kind === "dynamic" && x.insideGlobal === ip);
  return dyn ? `${dyn.insideLocal}:${port}` : undefined;
}

// ---------------------------------------------------------------------------------------------------------------
const C = { ip: "#60a5fa", tcp: "#34d399" };
const tcp = (id: string, from: string, to: string, src: string, dst: string): PacketVisual =>
  packet(id, "TCP", from, to, "TCP", `TCP · ${src} → ${dst}`, [layer("IPv4 Header", C.ip, [["Source IP", src.split(":")[0]], ["Destination IP", dst.split(":")[0]]]), layer("TCP Header", C.tcp, [["Source Port", src.split(":")[1]], ["Destination Port", dst.split(":")[1]], ["Flags", "SYN"]])]);
export const ST = {
  r1: [{ id: "rx", label: "Receive on inside / outside interface" }, { id: "route", label: "Route lookup" }, { id: "acl", label: "Source permitted by the NAT ACL?" }, { id: "xlate", label: "Translate (static, pool or port)" }, { id: "tx", label: "Forward and record the translation" }],
  isp: [{ id: "rx", label: "Receive" }, { id: "check", label: "Drop private (RFC 1918) sources" }, { id: "fwd", label: "Route onward" }],
  host: [{ id: "tx", label: "Send / receive" }],
} satisfies Record<string, ProcessingStage[]>;

function outFlow(id: string, host: string, src: string, sport: number): (s: NatState) => NatState {
  return (s) => {
    const dst = "198.51.100.80";
    const r = translateOut(s, src, sport, dst, 443);
    const inP2 = tcp(`${id}-in`, host, "R1", `${src}:${sport}`, `${dst}:443`);
    const outP = tcp(`${id}-out`, "R1", "ISP", r.out ?? `${src}:${sport}`, `${dst}:443`);
    const ok = !!r.out;
    const untranslated = !r.out && !r.note.startsWith("pool");
    const n2 = acted(r.s, hop({ stepId: id, device: "R1", stages: withDetail(ST.r1, { acl: permitted(s, src) ? `${src} permitted` : `${src} not in ACL 1`, xlate: r.note }), activeStageId: "xlate", ingressInterfaceId: "Gi0/0", egressInterfaceId: ok || untranslated ? "Gi0/1" : undefined, lookupType: "NAT", lookupKey: `${src}:${sport}`, lookupResult: r.out ?? r.note, action: ok ? "TRANSLATE" : untranslated ? "NO TRANSLATION" : "DROP", reason: "Only sources permitted by the NAT ACL are translated; the translation table remembers each one so replies can be reversed.", input: inP2.summary, output: ok || untranslated ? outP.summary : "dropped", nextHopId: ok || untranslated ? "ISP" : undefined, before: stackOf(inP2), after: ok ? stackOf(outP) : undefined, mutations: ok ? [{ type: "SA_CHANGE", detail: `${src}:${sport} → ${r.out}` }] : [] }), ok || untranslated ? outP : undefined, r.note);
    return { ...n2, results: [...n2.results, `${host} (${src}): ${r.out ? `→ ${r.out}` : r.note}`] };
  };
}

export const NAT_REPAIR_OPTIONS = [
  { id: "acl", label: "Add permit 10.1.2.0 0.0.0.255 to ACL 1" },
  { id: "static", label: "Add a static NAT entry for every new host" },
  { id: "pool", label: "Add more addresses to the NAT pool" },
  { id: "inside", label: "Configure ip nat inside on Gi0/1" },
];
export const NAT_REPAIR_CORRECT = "acl";

type Step = ScenarioStep<NatState>;
export const natSteps: Step[] = [
  say("intro", "Private inside, public outside", "The office uses private 10.x addresses — free, plentiful and not routed on the internet. The ISP gave R1 six public addresses. NAT on R1 rewrites addresses at the border so private hosts can talk to the internet, and the internet can reach the one server we publish."),
  say("terms", "Four names for addresses", "Cisco names each address by side and viewpoint. Inside local: a host's real (private) address. Inside global: what the outside sees for it. Outside global: the remote host's real address. Outside local: how the remote host appears inside (usually the same).", {
    question: q("PC1 (10.1.1.10) reaches a website through R1, which translates it to 203.0.113.3. What is 203.0.113.3 called?", [["ig", "The inside global address"], ["il", "The inside local address"], ["og", "The outside global address"], ["ol", "The outside local address"]], "ig", "PC1 is on the inside; 203.0.113.3 is how it appears globally (to the outside): inside global. 10.1.1.10 is its inside local; the website's address is outside global."),
  }),
  act("static", "Static NAT publishes a server", `The web server ${WEB.local} has a permanent mapping to ${WEB.global}. A customer at 198.51.100.7 connects to ${WEB.global}:443; R1 translates the destination to ${WEB.local} and forwards it inside.`, (s) => {
    const inside = translateIn(s, `${WEB.global}:443`)!;
    const p = tcp("st-in", "ISP", "R1", "198.51.100.7:50122", `${WEB.global}:443`);
    const n2 = acted(s, hop({ stepId: "static", device: "R1", stages: withDetail(ST.r1, { rx: "Gi0/1 (outside)", xlate: `static ${WEB.global} → ${WEB.local}` }), activeStageId: "xlate", ingressInterfaceId: "Gi0/1", egressInterfaceId: "Gi0/0", lookupType: "Static NAT", lookupKey: WEB.global, lookupResult: inside, action: "TRANSLATE (destination)", reason: "Static NAT is permanent and bidirectional, so outside users can start connections to the published server.", input: p.summary, output: `→ ${inside}`, nextHopId: "WEB", before: stackOf(p), mutations: [{ type: "DA_CHANGE", detail: `${WEB.global} → ${WEB.local}` }] }), p, `→ ${WEB.local}`);
    return { ...n2, results: [...n2.results, `198.51.100.7 → ${WEB.global}:443 → ${inside}`] };
  }, "PACKET_SENT"),
  act("dynamic-cfg", "Dynamic NAT from a pool", "For the users, R1 first gets dynamic NAT: hosts permitted by ACL 1 (10.1.1.0/24) borrow an address from a pool of two, 203.0.113.3 and .4.", (s) => ({ ...s, mode: "dynamic", packet: undefined, flood: [], decision: { device: "R1", text: "ip nat inside source list 1 pool USERS" } }), "STEP_ENTERED"),
  act("dyn-pc1", "PC1 and PC2 go online", "PC1 opens a website: R1 gives it 203.0.113.3. PC2 follows and gets 203.0.113.4.", (s) => outFlow("dyn-pc1", "PC2", "10.1.1.11", 52000)(outFlow("dyn-pc1", "PC1", "10.1.1.10", 51000)(s)), "PACKET_SENT"),
  say("predict-pool", "Predict: a third user", "PC3 (10.1.1.12) now opens a website while PC1 and PC2 are still online.", {
    question: q("What happens to PC3's traffic?", [["drop", "It fails: the pool has no free address"], ["share", "It shares 203.0.113.3 with PC1"], ["outside", "It uses R1's outside address"], ["untrans", "It leaves untranslated"]], "drop", "Dynamic NAT is one-to-one: two pool addresses serve two hosts at a time. PC3 waits until a translation times out — the reason PAT exists."),
  }),
  act("dyn-pc3", "The pool is empty", "R1 has no free address for PC3: the packet is dropped and a 'pool exhausted' counter rises.", outFlow("dyn-pc3", "PC3", "10.1.1.12", 53000), "PACKET_DROPPED"),
  act("pat-cfg", "PAT: everyone shares one address", `R1 is switched to PAT (overload) on its outside interface: every permitted host shares ${OUTSIDE_IP}, and flows are told apart by source port.`, (s) => ({ ...s, mode: "pat", table: s.table.filter((x) => x.kind === "static"), packet: undefined, flood: [], decision: { device: "R1", text: "ip nat inside source list 1 interface Gi0/1 overload" } }), "STEP_ENTERED"),
  act("pat-flows", "Three hosts, one public address", "PC1, PC2 and PC3 all browse. PC1 and PC2 happen to pick the same source port, 51000; R1 keeps it for PC1 and gives PC2 the next free one.", (s) => outFlow("pat-flows", "PC3", "10.1.1.12", 53000)(outFlow("pat-flows", "PC2", "10.1.1.11", 51000)(outFlow("pat-flows", "PC1", "10.1.1.10", 51000)(s))), "PACKET_SENT"),
  say("predict-return", "Predict: a reply comes back", `A reply arrives from the website for ${OUTSIDE_IP}:51001.`, {
    question: q("Which inside host gets it?", [["pc2", "PC2 (10.1.1.11:51000)"], ["pc1", "PC1 (10.1.1.10:51000)"], ["pc3", "PC3 (10.1.1.12:53000)"], ["all", "All three"]], "pc2", "R1 looks up inside global 203.0.113.2:51001 in its table: that's PC2's flow, whose port was remapped from 51000. The port is what makes PAT work."),
  }),
  act("return", "The reply is translated back", `R1 finds ${OUTSIDE_IP}:51001 in its translation table and rewrites the destination to PC2's 10.1.1.11:51000.`, (s) => {
    const inside = translateIn(s, `${OUTSIDE_IP}:51001`) ?? "—";
    const p = tcp("ret", "ISP", "R1", "198.51.100.80:443", `${OUTSIDE_IP}:51001`);
    const n2 = acted(s, hop({ stepId: "return", device: "R1", stages: withDetail(ST.r1, { rx: "Gi0/1 (outside)", xlate: `${OUTSIDE_IP}:51001 → ${inside}` }), activeStageId: "xlate", ingressInterfaceId: "Gi0/1", egressInterfaceId: "Gi0/0", lookupType: "NAT table", lookupKey: `${OUTSIDE_IP}:51001`, lookupResult: inside, action: "UN-TRANSLATE", reason: "Return traffic is matched against existing translations only — which is also why unsolicited inbound connections fail with PAT.", input: p.summary, output: `→ ${inside}`, nextHopId: "PC2", before: stackOf(p), mutations: [{ type: "DA_CHANGE", detail: `${OUTSIDE_IP}:51001 → ${inside}` }] }), p, `→ ${inside}`);
    return { ...n2, results: [...n2.results, `reply → ${inside}`] };
  }, "PACKET_RECEIVED"),
  // incident
  act("fault-injected", "A new office floor", "The company adds a floor with its own subnet, 10.1.2.0/24, on a new R1 sub-interface marked ip nat inside. Its users get DHCP addresses and can ping their gateway.", (s) => ({ ...s, faultActive: true, packet: undefined, flood: [], decision: { device: "R1", text: "Gi0/2 · 10.1.2.1/24 · ip nat inside" } }), "STEP_ENTERED"),
  act("inc-noweb", "The new floor has no internet", "PC4 (10.1.2.20) opens a website. Nothing loads. The old floor still works.", (s) => {
    const n2 = outFlow("inc-noweb", "PC4", "10.1.2.20", 54000)(s);
    return { ...n2, hops: [...n2.hops, hop({ stepId: "inc-noweb", device: "ISP", stages: withDetail(ST.isp, { check: "source 10.1.2.20 is private → drop" }), activeStageId: "check", ingressInterfaceId: "to-R1", lookupType: "Ingress filter", lookupKey: "10.1.2.20", lookupResult: "RFC 1918 — drop", action: "DROP", reason: "ISPs drop private source addresses: nobody could route the reply anyway.", input: "TCP from 10.1.2.20", output: "dropped" })] };
  }, "PACKET_DROPPED"),
  say("trouble-question", "Diagnose", "show ip nat translations has no entry for 10.1.2.20. The new sub-interface is ip nat inside and its users reach R1.", {
    question: q("Why aren't the new floor's packets translated?", [["acl", "ACL 1 only permits 10.1.1.0/24, so 10.1.2.0/24 isn't selected for NAT"], ["pool", "The PAT port pool is full"], ["outside", "Gi0/1 lost ip nat outside"], ["dns", "DNS is failing"]], "acl", "NAT translates only sources the ACL permits. The old floor still translates, so the outside interface and overload are fine; the new subnet simply isn't in ACL 1, so it leaves with its private address and the ISP drops it.", ["Does the old floor still work?", "What decides which sources are translated?", "What source address does the ISP see?"]),
  }),
  say("diagnostic-layers", "Troubleshooting layers", "Inside to outside: the host reaches its gateway, inside/outside interface roles, the NAT ACL, the translation table, then what the ISP sees."),
  repairStep("repair-challenge", "Repair", "Choose the change that fixes the cause.", NAT_REPAIR_CORRECT, (s) => ({ ...s, acl: [...s.acl, ["10.1.2.0", 24]], decision: { device: "R1", text: "access-list 1 permit 10.1.2.0 0.0.0.255" } })),
  act("verify", "The new floor is online", `PC4's next connection matches ACL 1 and is translated to ${OUTSIDE_IP} with its own port. The ISP routes it, and the reply comes back through the table.`, outFlow("verify", "PC4", "10.1.2.20", 54000), "PACKET_SENT"),
  say("complete", "NAT and PAT", "Inside local, inside global, outside global; static NAT to publish a server; dynamic NAT that runs out; PAT that shares one address by port — and an ACL that decides who gets translated at all."),
];
