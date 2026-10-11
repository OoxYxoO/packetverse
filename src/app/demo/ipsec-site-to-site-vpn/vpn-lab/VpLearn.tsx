import type { ReactNode } from "react";
import { GW, HOST_IP, PSKS, vpClone, vpHealthy, type VpAction, type VpCfg, type VpHost } from "@/lib/sim-engine/scenarios/vpnNet";

/**
 * Learn track of the VPN Lab: six levels on the lesson's two sites (HOST-A — GW-A — INTERNET — GW-B — HOST-B) with WEB
 * on the internet. A step starts from a known network (its `pre` actions are replayed silently through the model),
 * then the learner pings or shows the IKE negotiation. The questions: does IKE get an answer, agree on keys,
 * authenticate, agree on what to protect — and does the traffic actually enter the tunnel?
 */
export type VpShow = "tunnel" | "compare" | "journey";
export interface VpStepRun {
  label: string;
  actions: VpAction[];
  keep?: boolean;
}
export interface VpCheck {
  q: string;
  options: { id: string; label: string }[];
  answer: string;
  why: string;
}
export interface VpStep {
  title: string;
  body: ReactNode;
  pre?: VpAction[];
  runs?: VpStepRun[];
  show: VpShow[];
  check?: VpCheck;
}
export interface VpLevel {
  n: number;
  title: string;
  idea: string;
  steps: VpStep[];
}
const ping = (from: VpHost, to: string): VpAction => ({ type: "traffic", sends: [{ from, to }] });
const IKE: VpAction = { type: "ike" };
const cfg = (text: string, f: (c: VpCfg) => void, base: VpCfg = vpHealthy()): VpAction => {
  const c = vpClone(base);
  f(c);
  return { type: "cfg", cfg: c, text };
};
const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const M = ({ children }: { children: ReactNode }) => <span className="pv-mono text-pv-text">{children}</span>;

export const VP_LEVELS: VpLevel[] = [
  {
    n: 1,
    title: "Two sites, one internet",
    idea: "Private site networks can't cross the internet: nobody routes 10.x there. A site-to-site VPN carries them inside encrypted packets between the gateways' public addresses.",
    steps: [
      {
        title: "Two private networks",
        body: (
          <>
            <p>Site A is <M>10.10.10.0/24</M>, Site B <M>10.20.20.0/24</M>. The internet only knows the gateways&apos; public addresses (<M>198.51.100.10</M>, <M>203.0.113.10</M>). GW-A and GW-B keep an IPsec tunnel up between them.</p>
          </>
        ),
        show: ["tunnel", "compare"],
      },
      {
        title: "HOST-A pings HOST-B",
        body: (
          <>
            <p>HOST-A just sends to its gateway. GW-A sees a destination in Site B, <B>encrypts</B> the whole packet and wraps it in a new one: <M>198.51.100.10 → 203.0.113.10</M>, protocol 50 (<B>ESP</B>). The internet routes the outer header; GW-B decrypts and forwards the original.</p>
          </>
        ),
        runs: [{ label: "HOST-A pings HOST-B", actions: [ping("HOST-A", HOST_IP["HOST-B"])] }],
        show: ["journey", "tunnel"],
      },
      {
        title: "Not everything goes through the tunnel",
        body: (
          <>
            <p>HOST-A pings WEB on the internet. That destination isn&apos;t Site B, so GW-A routes it out normally, with <B>source NAT</B> like the Firewall lesson — in the clear. Only traffic between the protected subnets is encrypted (split tunneling).</p>
          </>
        ),
        runs: [{ label: "HOST-A pings WEB", actions: [ping("HOST-A", HOST_IP.WEB)] }],
        show: ["journey"],
        check: {
          q: "On the internet, which addresses does HOST-A → HOST-B traffic carry?",
          options: [
            { id: "outer", label: "The gateways' public addresses (outer header); the hosts' addresses are encrypted inside" },
            { id: "inner", label: "10.10.10.10 → 10.20.20.20" },
            { id: "nat", label: "198.51.100.10 → 10.20.20.20 (source NAT)" },
          ],
          answer: "outer",
          why: "Tunnel mode: a new outer IPv4 header between the gateways, the original packet encrypted as ESP payload.",
        },
      },
    ],
  },
  {
    n: 2,
    title: "IKE_SA_INIT: agreeing on keys",
    idea: "Before any data, the gateways run IKEv2 over UDP 500. The first exchange agrees the algorithms and runs Diffie-Hellman — both derive the same keys without ever sending them. Nobody is authenticated yet.",
    steps: [
      {
        title: "The first exchange",
        body: (
          <>
            <p>GW-A sends <M>IKE_SA_INIT</M>: its proposal (encryption, PRF, DH group), its Diffie-Hellman public value (KE) and a nonce — <B>in the clear</B>. GW-B picks the proposal and answers with its own KE and nonce. From here on IKE messages are encrypted.</p>
          </>
        ),
        runs: [{ label: "Show the IKE negotiation", actions: [IKE] }],
        show: ["journey", "tunnel"],
      },
      {
        title: "No common proposal",
        body: (
          <>
            <p>GW-B is reconfigured to accept only AES-CBC-128 with DH group 14; GW-A offers AES-GCM-256 with group 19. No overlap: GW-B answers <M>NO_PROPOSAL_CHOSEN</M> to the very first message. No keys, no tunnel.</p>
          </>
        ),
        pre: [cfg("GW-B IKE proposal → AES-CBC-128 / group 14", (c) => (c.gw["GW-B"].ike = "aes128-sha1-g14"))],
        runs: [{ label: "Show the IKE negotiation", actions: [IKE] }],
        show: ["journey", "compare"],
      },
      {
        title: "Nobody answers",
        body: (
          <>
            <p>GW-A&apos;s peer is typed as <M>203.0.113.11</M>. IKE_SA_INIT goes there, nobody answers, GW-A retransmits and gives up. Proposals, keys and selectors are never even reached.</p>
          </>
        ),
        pre: [cfg("GW-A peer → 203.0.113.11", (c) => (c.gw["GW-A"].peer = "203.0.113.11"))],
        runs: [{ label: "Show the IKE negotiation", actions: [IKE] }],
        show: ["journey", "compare"],
        check: {
          q: "After IKE_SA_INIT succeeds, what do the two gateways know?",
          options: [
            { id: "keys", label: "Shared keys — but not yet who the other side is" },
            { id: "auth", label: "That the other side is really the expected peer" },
            { id: "data", label: "Which subnets to protect" },
          ],
          answer: "keys",
          why: "Diffie-Hellman gives shared keys even with an attacker in the middle; authentication happens in IKE_AUTH, the selectors with the CHILD SA.",
        },
      },
    ],
  },
  {
    n: 3,
    title: "IKE_AUTH: who are you?",
    idea: "Inside the encrypted IKE_AUTH exchange each gateway proves its identity — here with a pre-shared key. Only then does the IKE SA exist, and the first CHILD SA is negotiated in the same exchange.",
    steps: [
      {
        title: "Authenticated",
        body: (
          <>
            <p>GW-A sends its identity and an <B>AUTH</B> value computed from the pre-shared key and the IKE_SA_INIT messages; GW-B checks it with its own copy of the key, then proves itself the same way. The <B>IKE SA</B> is ESTABLISHED.</p>
          </>
        ),
        runs: [{ label: "Show the IKE negotiation", actions: [IKE] }],
        show: ["journey", "tunnel"],
      },
      {
        title: "Different keys",
        body: (
          <>
            <p>GW-B was installed with <M>{PSKS[1]}</M>. IKE_SA_INIT still works — keys are derived — but GW-A&apos;s AUTH doesn&apos;t verify: <M>AUTHENTICATION_FAILED</M>. “IKE starts, then stops.”</p>
          </>
        ),
        pre: [cfg("GW-B pre-shared key changed", (c) => (c.gw["GW-B"].psk = PSKS[1]))],
        runs: [{ label: "Show the IKE negotiation", actions: [IKE] }],
        show: ["journey", "compare"],
      },
      {
        title: "Two kinds of SA",
        body: (
          <>
            <p>The <B>IKE SA</B> protects IKE itself (one per peer pair). The <B>CHILD SA</B> protects user data: a pair of one-way ESP SAs, each with its own SPI. A healthy IKE SA with no CHILD SA moves no user traffic at all.</p>
          </>
        ),
        show: ["tunnel"],
        check: {
          q: "IKE_SA_INIT completes, IKE_AUTH fails with AUTHENTICATION_FAILED. What do you check?",
          options: [
            { id: "psk", label: "The pre-shared key (and identities) on both gateways" },
            { id: "prop", label: "The IKE proposals" },
            { id: "route", label: "The route to the peer" },
          ],
          answer: "psk",
          why: "Reaching IKE_AUTH proves reachability and a common proposal. The failure is in authentication.",
        },
      },
    ],
  },
  {
    n: 4,
    title: "The CHILD SA: what to protect",
    idea: "The CHILD SA carries traffic selectors: which inner traffic it protects. The initiator proposes TSi/TSr; the responder accepts them only if they fit its own policy — the mirror image of the initiator's.",
    steps: [
      {
        title: "Traffic selectors",
        body: (
          <>
            <p>GW-A proposes <M>TSi 10.10.10.0/24</M>, <M>TSr 10.20.20.0/24</M> (Cisco: the crypto ACL; Junos: traffic-selector local-ip / remote-ip). GW-B&apos;s policy is the mirror: local 10.20.20.0/24, remote 10.10.10.0/24. Accepted.</p>
          </>
        ),
        show: ["compare", "tunnel"],
      },
      {
        title: "A selector that doesn't fit",
        body: (
          <>
            <p>During a migration GW-B&apos;s remote selector became <M>10.10.20.0/24</M>. IKE is fine; the CHILD SA is refused with <M>TS_UNACCEPTABLE</M>. Monitoring that only watches the IKE SA says “up” — and no host packet passes.</p>
          </>
        ),
        pre: [cfg("GW-B remote selector → 10.10.20.0/24", (c) => (c.gw["GW-B"].remote = "10.10.20.0/24"))],
        runs: [
          { label: "Show the IKE negotiation", actions: [IKE] },
          { label: "HOST-A pings HOST-B", actions: [ping("HOST-A", HOST_IP["HOST-B"])] },
        ],
        show: ["journey", "compare"],
      },
      {
        title: "A broader selector is fine",
        body: (
          <>
            <p>If GW-B allowed <M>10.10.0.0/16</M> as remote, GW-A&apos;s 10.10.10.0/24 fits inside it: the responder can accept (narrowing). What it can&apos;t accept is a proposal outside its own policy.</p>
          </>
        ),
        pre: [cfg("GW-B remote selector → 10.10.0.0/16", (c) => (c.gw["GW-B"].remote = "10.10.0.0/16"))],
        runs: [{ label: "HOST-A pings HOST-B", actions: [ping("HOST-A", HOST_IP["HOST-B"])] }],
        show: ["tunnel", "journey"],
        check: {
          q: "The IKE SA is up, the CHILD SA fails with TS_UNACCEPTABLE. What's wrong?",
          options: [
            { id: "ts", label: "The protected subnets don't mirror each other on the two gateways" },
            { id: "psk", label: "The pre-shared keys differ" },
            { id: "peer", label: "The peer address is wrong" },
          ],
          answer: "ts",
          why: "An established IKE SA proves reachability, proposal and authentication. TS_UNACCEPTABLE is about what to protect.",
        },
      },
    ],
  },
  {
    n: 5,
    title: "ESP on the wire",
    idea: "Each direction has its own SA and SPI — chosen by the receiver so it can find the right keys. Sequence numbers count every packet and protect against replays; the counters prove traffic really uses the tunnel.",
    steps: [
      {
        title: "Whose SPI?",
        body: (
          <>
            <p>A packet from GW-A to GW-B carries the SPI <B>GW-B chose</B> (it looks up its inbound SA with it); the reply carries GW-A&apos;s. Open a capture on the INTERNET after the ping: two different SPIs, one per direction.</p>
          </>
        ),
        runs: [{ label: "HOST-A pings HOST-B", actions: [ping("HOST-A", HOST_IP["HOST-B"])] }],
        show: ["journey", "tunnel"],
      },
      {
        title: "Sequence numbers and counters",
        body: (
          <>
            <p>Every ESP packet gets the next sequence number on its SA; the receiver remembers which it has seen and drops replays. Ping three times: the encrypted / decrypted counters on both gateways climb together.</p>
          </>
        ),
        runs: [{ label: "HOST-A pings HOST-B three times", actions: [{ type: "traffic", sends: [{ from: "HOST-A", to: HOST_IP["HOST-B"] }, { from: "HOST-A", to: HOST_IP["HOST-B"] }, { from: "HOST-A", to: HOST_IP["HOST-B"] }] }] }],
        show: ["tunnel"],
      },
      {
        title: "Renegotiation: new SPIs",
        body: (
          <>
            <p>Clearing the SAs (or a rekey) builds a new CHILD SA with new SPIs and fresh counters. The old SPIs are gone — a packet still carrying one would be dropped.</p>
          </>
        ),
        runs: [{ label: "Clear SAs, then ping", actions: [{ type: "clear" }, ping("HOST-A", HOST_IP["HOST-B"])] }],
        show: ["tunnel"],
        check: {
          q: "The SPI in an ESP packet from GW-A to GW-B was chosen by…",
          options: [
            { id: "b", label: "GW-B — the receiver, so it can find its inbound SA" },
            { id: "a", label: "GW-A — the sender" },
            { id: "both", label: "Both, as a shared value for the two directions" },
          ],
          answer: "b",
          why: "Each side chooses the SPI for the SA it receives on, and tells the peer in IKE_AUTH / CREATE_CHILD_SA.",
        },
      },
    ],
  },
  {
    n: 6,
    title: "Getting traffic into the tunnel",
    idea: "An up tunnel only carries what the gateway sends into it. Check the steering (crypto map on the WAN interface / route via st0.0) and prove it with the ESP counters — not with the tunnel status.",
    steps: [
      {
        title: "Tunnel up, nothing in it",
        body: (
          <>
            <p>GW-A doesn&apos;t send Site B&apos;s traffic into IPsec (Cisco: the crypto map isn&apos;t on Gi0/1; Junos: no route via st0.0). The ping follows the default route <B>in the clear</B>, source-NATed — and the internet drops it: no route to <M>10.20.20.20</M>. The SAs are up; the counters stay at 0.</p>
          </>
        ),
        pre: [cfg("GW-A: site traffic NOT into IPsec", (c) => (c.gw["GW-A"].steer = false))],
        runs: [{ label: "HOST-A pings HOST-B", actions: [ping("HOST-A", HOST_IP["HOST-B"])] }],
        show: ["journey", "tunnel"],
      },
      {
        title: "The peer disappears",
        body: (
          <>
            <p>GW-B&apos;s internet link fails. GW-A stops hearing from it (dead-peer detection), the SAs are deleted, and Site B traffic is dropped at GW-A: there is no SA to put it in. Restore the link and the tunnel renegotiates with new SPIs.</p>
          </>
        ),
        runs: [
          { label: "Cut GW-B's link, then ping", actions: [{ type: "wan", up: false }, ping("HOST-A", HOST_IP["HOST-B"])] },
          { label: "Restore it, then ping", actions: [{ type: "wan", up: true }, ping("HOST-A", HOST_IP["HOST-B"])], keep: true },
        ],
        show: ["tunnel", "journey"],
      },
      {
        title: "The method",
        body: (
          <>
            <p>Walk it in order: does IKE_SA_INIT get an answer with a common proposal? Does IKE_AUTH authenticate? Is a CHILD SA installed, with mirrored selectors? Is the traffic steered into it? Do the encrypt / decrypt counters move when you test? Fix the first “no”.</p>
          </>
        ),
        show: ["compare", "tunnel"],
        check: {
          q: "Both gateways show the IPsec SA up, but the encrypted-packet counter stays at 0 while users test. Where do you look?",
          options: [
            { id: "steer", label: "Whether the traffic is sent into the tunnel at all (crypto map applied / route via st0.0)" },
            { id: "psk", label: "The pre-shared key" },
            { id: "prop", label: "The IKE proposal" },
          ],
          answer: "steer",
          why: "Keys, authentication and selectors are proven by the SA being up. Counters at 0 mean nothing enters it.",
        },
      },
    ],
  },
];
export const VP_LAN = GW;
