import type { DlNode, DlPacket } from "@/lib/sim-engine/scenarios/dhcpDnsLab";

/**
 * The DHCP exchange (Discover → Offer → Request → Ack) as the captured packets show it: for each message, whether it
 * got where it had to go, and if not, where it stopped. Read only from packets (the same ones Follow and the captures
 * show), so the topology's summary can never disagree with them.
 */

export type DoraMsg = "DISCOVER" | "OFFER" | "REQUEST" | "ACK";
export interface DoraLeg {
  msg: DoraMsg;
  /** ok: reached its destination · bad: stopped or never answered · none: not sent (an earlier step failed) · skip: not part of this kind of exchange */
  state: "ok" | "bad" | "none" | "skip";
  text: string;
  /** Number of the first packet of this message, so the summary can light up when the animation gets there. */
  firstNo?: number;
  /** Where the message stopped (for "look here"). */
  at?: DlNode;
}
export interface DhcpExchange {
  legs: DoraLeg[];
  /** An ICMP port unreachable came back instead of a DHCP answer. */
  icmpFrom?: DlNode;
  renewal: boolean;
}

const end = (p: DlPacket) => p.hops[p.hops.length - 1];
const reached = (p: DlPacket, n: DlNode) => end(p).node === n && end(p).act === "deliver";

export function dhcpExchange(pkts: DlPacket[]): DhcpExchange | undefined {
  const dhcp = pkts.filter((p) => p.proto === "DHCP" && p.msg !== "RELEASE");
  if (!dhcp.length) return undefined;
  const of = (m: DoraMsg) => dhcp.filter((p) => p.msg === m);
  const icmp = pkts.find((p) => p.msg === "Port unreachable" && /UDP 67/.test(p.info));
  const renewal = !of("DISCOVER").length && of("REQUEST").length > 0;
  const legs: DoraLeg[] = [];

  // DISCOVER: did a laptop's request get to the DHCP server's host?
  const disc = of("DISCOVER");
  const discAtSrv = disc.find((p) => end(p).node === "DHCP-SRV");
  if (renewal) legs.push({ msg: "DISCOVER", state: "skip", text: "not needed: a renewal asks its server directly" });
  else if (discAtSrv) legs.push({ msg: "DISCOVER", state: "ok", text: `reached DHCP-SRV${disc.some((p) => p.hops[0].node === "R1") ? " (relayed by R1)" : ""}`, firstNo: disc[0].no });
  else {
    const last = disc[disc.length - 1];
    legs.push({ msg: "DISCOVER", state: "bad", text: `stopped at ${end(last).node}${disc.filter((p) => p.hops[0].node === "CLIENT").length > 1 ? ` (sent ${disc.filter((p) => p.hops[0].node === "CLIENT").length}×, never got further)` : ""}`, firstNo: disc[0].no, at: end(last).node });
  }

  // OFFER: did the server answer, and did the answer get back to the laptop?
  const off = of("OFFER");
  if (renewal) legs.push({ msg: "OFFER", state: "skip", text: "not needed for a renewal" });
  else if (off.some((p) => reached(p, "CLIENT"))) legs.push({ msg: "OFFER", state: "ok", text: "came back to CLIENT", firstNo: off[0].no });
  else if (off.length) legs.push({ msg: "OFFER", state: "bad", text: `stopped at ${end(off[off.length - 1]).node}`, firstNo: off[0].no, at: end(off[off.length - 1]).node });
  else if (discAtSrv) legs.push({ msg: "OFFER", state: "bad", text: icmp ? "DHCP-SRV sent no offer: ICMP port unreachable came back instead" : "DHCP-SRV received the request but sent no offer", at: "DHCP-SRV" });
  else legs.push({ msg: "OFFER", state: "none", text: "never sent: no request reached a DHCP server" });

  // REQUEST and ACK: the laptop accepts, the server confirms.
  const req = of("REQUEST");
  if (req.some((p) => end(p).node === "DHCP-SRV")) legs.push({ msg: "REQUEST", state: "ok", text: "reached DHCP-SRV", firstNo: req[0].no });
  else if (req.length) legs.push({ msg: "REQUEST", state: "bad", text: `stopped at ${end(req[req.length - 1]).node}`, firstNo: req[0].no, at: end(req[req.length - 1]).node });
  else legs.push({ msg: "REQUEST", state: "none", text: "never sent: the laptop had no offer to accept" });

  const ack = of("ACK");
  if (ack.some((p) => reached(p, "CLIENT"))) legs.push({ msg: "ACK", state: "ok", text: "CLIENT received its settings", firstNo: ack[0].no });
  else if (ack.length) legs.push({ msg: "ACK", state: "bad", text: `stopped at ${end(ack[ack.length - 1]).node}`, firstNo: ack[0].no, at: end(ack[ack.length - 1]).node });
  else if (req.some((p) => end(p).node === "DHCP-SRV")) legs.push({ msg: "ACK", state: "bad", text: "DHCP-SRV received the request but did not confirm it", at: "DHCP-SRV" });
  else legs.push({ msg: "ACK", state: "none", text: "never sent" });

  return { legs, icmpFrom: icmp ? (icmp.hops[0].node as DlNode) : undefined, renewal };
}
