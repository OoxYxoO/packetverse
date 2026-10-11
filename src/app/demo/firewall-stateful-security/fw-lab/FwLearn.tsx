import type { ReactNode } from "react";
import { HOST_IP, PUBLIC, fwClone, fwHealthy, type FwAction, type FwCfg, type FwHost } from "@/lib/sim-engine/scenarios/fwNet";

/**
 * Learn track of the Firewall Lab: six levels on the lesson's FW1, now with three zones (trust: CLIENT and LAB · dmz:
 * the company web server · untrust: the ISP, WEB and an internet user OUT). A step starts from a known network (its
 * `pre` actions are replayed silently through the model), then the learner runs its traffic. The questions: which
 * zone pair, which rule, which translation, which session — and where did the reply die?
 */
export type FwShow = "policy" | "sessions" | "pipeline" | "nat" | "journey";
export interface FwStepRun {
  label: string;
  actions: FwAction[];
  keep?: boolean;
}
export interface FwCheck {
  q: string;
  options: { id: string; label: string }[];
  answer: string;
  why: string;
}
export interface FwStep {
  title: string;
  body: ReactNode;
  pre?: FwAction[];
  runs?: FwStepRun[];
  show: FwShow[];
  check?: FwCheck;
}
export interface FwLevel {
  n: number;
  title: string;
  idea: string;
  steps: FwStep[];
}
const tcp = (from: FwHost, to: string, port = 443): FwAction => ({ type: "traffic", sends: [{ from, to, kind: "connect", port }] });
const ping = (from: FwHost, to: string): FwAction => ({ type: "traffic", sends: [{ from, to, kind: "ping" }] });
const cfg = (text: string, f: (c: FwCfg) => void, base: FwCfg = fwHealthy()): FwAction => {
  const c = fwClone(base);
  f(c);
  return { type: "cfg", cfg: c, text };
};
const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const M = ({ children }: { children: ReactNode }) => <span className="pv-mono text-pv-text">{children}</span>;

export const FW_LEVELS: FwLevel[] = [
  {
    n: 1,
    title: "A router that decides",
    idea: "A firewall routes like any router — and before forwarding, it asks whether this traffic, between these two zones, is allowed. Anything not explicitly allowed is denied.",
    steps: [
      {
        title: "Three zones",
        body: (
          <>
            <p>FW1 has three interfaces, each in a <B>zone</B>: <M>trust</M> (the office: CLIENT, LAB), <M>dmz</M> (our public web server) and <M>untrust</M> (the ISP and the internet). Policies are written per <B>zone pair</B>, one direction at a time.</p>
            <p>The lesson had trust and untrust only; the DMZ adds a server the internet must reach — without reaching the office.</p>
          </>
        ),
        show: ["policy", "nat"],
      },
      {
        title: "CLIENT opens HTTPS to WEB",
        body: (
          <>
            <p>The SYN arrives in zone trust. FW1 finds <B>no session</B>, looks up the route (default → untrust), then the policy trust → untrust: <M>ALLOW-WEB</M> matches. It translates the source, creates a session and forwards. Watch FW1&apos;s steps in order.</p>
          </>
        ),
        runs: [{ label: "CLIENT opens HTTPS to WEB", actions: [tcp("CLIENT", HOST_IP.WEB)] }],
        show: ["pipeline", "sessions"],
      },
      {
        title: "Nothing allows SSH",
        body: (
          <>
            <p>Same client, same server, TCP/22. No rule of trust → untrust matches SSH, so the packet falls through to the <B>implicit default deny</B> — the last, invisible rule of every zone pair. The client just waits: a dropped SYN gets no answer.</p>
          </>
        ),
        runs: [{ label: "CLIENT tries SSH to WEB", actions: [tcp("CLIENT", HOST_IP.WEB, 22)] }],
        show: ["pipeline", "policy"],
        check: {
          q: "Which rule dropped CLIENT's SSH attempt?",
          options: [
            { id: "deny", label: "The implicit default deny: no rule allowed it" },
            { id: "block", label: "BLOCK-LAB" },
            { id: "web", label: "ALLOW-WEB, because it only allows HTTPS" },
          ],
          answer: "deny",
          why: "ALLOW-WEB simply doesn't match SSH; matching continues down the list. When nothing matches, the default deny decides.",
        },
      },
    ],
  },
  {
    n: 2,
    title: "Rules in order",
    idea: "Within a zone pair, rules are checked top-down and the first match decides. A rule can only take effect if nothing above it already matched.",
    steps: [
      {
        title: "The lab PCs are blocked",
        body: (
          <>
            <p>LAB (10.10.10.200) is in <M>LAB-PCS</M> (10.10.10.128/25). Rule 2, <M>BLOCK-LAB</M>, denies LAB-PCS → any, any application. ALLOW-WEB below would allow it — but is never reached.</p>
          </>
        ),
        runs: [{ label: "LAB opens HTTPS to WEB", actions: [tcp("LAB", HOST_IP.WEB)] }],
        show: ["pipeline", "policy"],
      },
      {
        title: "…but they can ping",
        body: (
          <>
            <p>Rule 1, <M>ALLOW-PING</M>, allows ICMP from CLIENTS — and 10.10.10.200 is in CLIENTS too. It sits <B>above</B> BLOCK-LAB, so it matches first. Order is the policy.</p>
          </>
        ),
        runs: [{ label: "LAB pings WEB", actions: [ping("LAB", HOST_IP.WEB)] }],
        show: ["pipeline", "policy"],
      },
      {
        title: "A deny that is too broad",
        body: (
          <>
            <p>A change typed BLOCK-LAB&apos;s source as <M>CLIENTS</M> (the whole /24) instead of LAB-PCS. Now every HTTPS attempt hits rule 2. Ping still works (rule 1) — which is exactly why users say “the line is fine”.</p>
          </>
        ),
        pre: [cfg("BLOCK-LAB source → CLIENTS", (c) => (c.rules.find((r) => r.name === "BLOCK-LAB")!.src = ["CLIENTS"]))],
        runs: [
          { label: "CLIENT opens HTTPS to WEB", actions: [tcp("CLIENT", HOST_IP.WEB)] },
          { label: "CLIENT pings WEB", actions: [ping("CLIENT", HOST_IP.WEB)] },
        ],
        show: ["pipeline", "policy"],
        check: {
          q: "Hit counts: BLOCK-LAB keeps counting, ALLOW-WEB stays at 0. What does that tell you?",
          options: [
            { id: "shadow", label: "A rule above ALLOW-WEB matches the same traffic first" },
            { id: "unused", label: "Nobody uses HTTPS any more" },
            { id: "route", label: "The route to the internet is missing" },
          ],
          answer: "shadow",
          why: "An allow rule that never counts while a deny above it does is the signature of shadowing. Fix the deny's scope (LAB-PCS) or its position — and keep its intent.",
        },
      },
    ],
  },
  {
    n: 3,
    title: "Sessions: replies come home",
    idea: "The first packet creates a session. Every later packet — in either direction — is matched against the session table first. Replies need no rule of their own; unsolicited traffic has no session to match.",
    steps: [
      {
        title: "The whole handshake",
        body: (
          <>
            <p>SYN out (policy checked, session created) → SYN-ACK back: FW1 finds the session <B>in reverse</B> and lets it in without any untrust → trust rule → ACK out, session <B>ESTABLISHED</B>. You saw this in TCP &amp; UDP; here the firewall tracks it.</p>
          </>
        ),
        runs: [{ label: "CLIENT opens HTTPS to WEB", actions: [tcp("CLIENT", HOST_IP.WEB)] }],
        show: ["journey", "sessions"],
      },
      {
        title: "A stray segment",
        body: (
          <>
            <p>OUT sends a TCP <M>ACK</M> to our public address, port 40001 — as if it were a reply. There is <B>no session</B> for it, and an ACK can&apos;t start one (only a SYN can). Dropped and logged.</p>
          </>
        ),
        runs: [{ label: "OUT sends a stray ACK", actions: [{ type: "traffic", sends: [{ from: "OUT", to: PUBLIC, kind: "stray", port: 40001 }] }] }],
        show: ["pipeline"],
      },
      {
        title: "The internet can't start a conversation",
        body: (
          <>
            <p>OUT tries to open HTTPS to CLIENT&apos;s private address: the ISP has <B>no route</B> to 10.10.10.10 — private addresses aren&apos;t routed on the internet. And SSH to our public address is dropped by FW1: nothing publishes TCP/22 there.</p>
          </>
        ),
        runs: [
          { label: "OUT → CLIENT HTTPS", actions: [tcp("OUT", HOST_IP.CLIENT)] },
          { label: "OUT → 198.51.100.2 SSH", actions: [tcp("OUT", PUBLIC, 22)] },
        ],
        show: ["pipeline", "journey"],
        check: {
          q: "Why does WEB's SYN-ACK get in when no rule allows untrust → trust?",
          options: [
            { id: "session", label: "It matches the session CLIENT's SYN created" },
            { id: "rule", label: "There is a hidden allow rule for replies" },
            { id: "ack", label: "Packets with the ACK flag are always allowed" },
          ],
          answer: "session",
          why: "Stateful filtering: the reply matches the session's reverse tuple. A stray ACK with no session is dropped — the flag alone proves nothing.",
        },
      },
    ],
  },
  {
    n: 4,
    title: "Source NAT",
    idea: "Private addresses can't travel on the internet. On the way out, FW1 rewrites the source to its own public address and remembers the mapping in the session — replies are translated back.",
    steps: [
      {
        title: "Before and after FW1",
        body: (
          <>
            <p>Captured on FW1&apos;s trust side the SYN reads <M>10.10.10.10:51000 → 203.0.113.80:443</M>; on the untrust side <M>198.51.100.2:40001 → 203.0.113.80:443</M>. The destination never changes. Open the capture on FW1 after the run and compare the interfaces.</p>
          </>
        ),
        runs: [{ label: "CLIENT opens HTTPS to WEB", actions: [tcp("CLIENT", HOST_IP.WEB)] }],
        show: ["pipeline", "sessions", "nat"],
      },
      {
        title: "Many clients, one address",
        body: (
          <>
            <p>Two connections leave with the same public address and different ports (<B>PAT</B>): 40001, 40002. The session table is the only place that knows which inside client each port belongs to.</p>
          </>
        ),
        runs: [
          {
            label: "CLIENT opens HTTPS and HTTP",
            actions: [
              { type: "traffic", sends: [{ from: "CLIENT", to: HOST_IP.WEB, kind: "connect", port: 443 }, { from: "CLIENT", to: HOST_IP.WEB, kind: "connect", port: 80 }] },
            ],
          },
        ],
        show: ["sessions", "nat"],
      },
      {
        title: "Translated to the wrong address",
        body: (
          <>
            <p>Source NAT now uses <M>198.51.100.99</M>. The policy allows it, the session is created, the SYN reaches WEB — and WEB answers to 198.51.100.99. The ISP only routes <M>198.51.100.0/30</M> to us: the SYN-ACK dies at the ISP. The session stays <B>SYN_SENT</B>.</p>
          </>
        ),
        pre: [cfg("source NAT trust → BAD-POOL 198.51.100.99", (c) => (c.snat.trust = "bad"))],
        runs: [{ label: "CLIENT opens HTTPS to WEB", actions: [tcp("CLIENT", HOST_IP.WEB)] }],
        show: ["journey", "sessions"],
        check: {
          q: "The log says ALLOWED and a session exists. Why does the connection still hang?",
          options: [
            { id: "return", label: "The reply is addressed to an address the ISP doesn't route back to us" },
            { id: "policy", label: "ALLOW-WEB is too narrow" },
            { id: "server", label: "WEB isn't listening" },
          ],
          answer: "return",
          why: "Policy is one check of several. The translated source decides where the internet sends the reply.",
        },
      },
    ],
  },
  {
    n: 5,
    title: "Publishing a server",
    idea: "Destination NAT maps our public address and port to the DMZ server. It happens before the route and policy lookups — so the policy is written for the server's real address.",
    steps: [
      {
        title: "The internet reaches the DMZ",
        body: (
          <>
            <p>OUT connects to <M>198.51.100.2:443</M>. FW1 translates the destination to <M>172.16.0.10:443</M>, routes it to the dmz zone, and checks untrust → dmz: <M>PUBLISH-WEB</M> allows HTTPS to DMZ-WEB. The server sees OUT&apos;s real address.</p>
          </>
        ),
        runs: [{ label: "OUT opens HTTPS to 198.51.100.2", actions: [tcp("OUT", PUBLIC)] }],
        show: ["pipeline", "sessions"],
      },
      {
        title: "A rule for the public address",
        body: (
          <>
            <p>PUBLISH-WEB is rewritten for <M>FW-OUTSIDE</M> (198.51.100.2) — the address customers type. But by the time the policy is checked, the destination is already 172.16.0.10: no match, default deny. Same on Junos and on the IOS zone-based firewall.</p>
          </>
        ),
        pre: [cfg("PUBLISH-WEB destination → FW-OUTSIDE", (c) => (c.rules.find((r) => r.name === "PUBLISH-WEB")!.dst = ["FW-OUTSIDE"]))],
        runs: [{ label: "OUT opens HTTPS to 198.51.100.2", actions: [tcp("OUT", PUBLIC)] }],
        show: ["pipeline", "policy"],
      },
      {
        title: "The DMZ goes out too",
        body: (
          <>
            <p>The DMZ server downloads updates (ALLOW-UPDATES). Its source must be translated as well — remove SNAT-DMZ and the SYN leaves as <M>172.16.0.10</M>: WEB answers, the ISP has no route to a private address.</p>
          </>
        ),
        pre: [cfg("no source NAT for the dmz", (c) => (c.snat.dmz = "off"))],
        runs: [{ label: "DMZ opens HTTPS to WEB", actions: [tcp("DMZ", HOST_IP.WEB)] }],
        show: ["pipeline", "journey"],
        check: {
          q: "Which address should an inbound rule for the published server use?",
          options: [
            { id: "real", label: "The server's real address (172.16.0.10) — the policy sees it after destination NAT" },
            { id: "public", label: "The public address (198.51.100.2) — that's what customers connect to" },
            { id: "both", label: "It doesn't matter" },
          ],
          answer: "real",
          why: "Order of operations: destination NAT, then route, then policy. (Classic Cisco ASA before 8.3 was the opposite — check your platform.)",
        },
      },
    ],
  },
  {
    n: 6,
    title: "Reading a firewall path",
    idea: "Allowed is not the same as working. Separate the steps: did the first packet arrive, which rule matched, what was translated, was a session created — and where did the reply die?",
    steps: [
      {
        title: "Allowed, created — and still hanging",
        body: (
          <>
            <p>The DMZ server was rebuilt with gateway <M>172.16.0.254</M>. The customer&apos;s SYN arrives (DNAT, PUBLISH-WEB, session created), the server answers — to a gateway nobody owns. FW1 never sees the reply. The firewall is innocent; its <B>session state</B> proves it.</p>
          </>
        ),
        pre: [cfg("DMZ server: default via 172.16.0.254", (c) => (c.dmzGw = "172.16.0.254"))],
        runs: [{ label: "OUT opens HTTPS to 198.51.100.2", actions: [tcp("OUT", PUBLIC)] }],
        show: ["journey", "sessions"],
      },
      {
        title: "Refused or blocked?",
        body: (
          <>
            <p>A <B>timeout</B> means something dropped a packet silently (a firewall, a missing route). <B>Connection refused</B> means the packet arrived and the host answered RST: nothing listens. CLIENT → OUT HTTPS is allowed but OUT runs no server: RST, instantly.</p>
          </>
        ),
        runs: [
          { label: "CLIENT → OUT HTTPS (refused)", actions: [tcp("CLIENT", HOST_IP.OUT)] },
          { label: "CLIENT → WEB SSH (timeout)", actions: [tcp("CLIENT", HOST_IP.WEB, 22)] },
        ],
        show: ["journey", "sessions"],
      },
      {
        title: "The method",
        body: (
          <>
            <p>Ask in order: did it reach FW1 (which zone)? which rule matched (hit counts, deny logs)? what was translated? was a session created, and did it reach ESTABLISHED? If it stays half-open, follow the reply: return route, NAT address, the server&apos;s gateway.</p>
          </>
        ),
        show: ["policy", "nat", "sessions"],
        check: {
          q: "A session exists in SYN_SENT and never moves. What do you know for sure?",
          options: [
            { id: "past", label: "The policy allowed it; the reply never came back through FW1 — look past the firewall" },
            { id: "deny", label: "A rule denied it" },
            { id: "nat", label: "Destination NAT failed" },
          ],
          answer: "past",
          why: "A denied packet never creates a session. A half-open session points at the return path: NAT address, ISP route, the server's gateway — or the server itself.",
        },
      },
    ],
  },
];
