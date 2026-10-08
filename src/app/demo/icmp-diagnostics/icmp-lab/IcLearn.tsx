"use client";

import { type ReactNode } from "react";
import { IC_ADDR } from "@/lib/sim-engine/scenarios/icmpDiagnostics";
import type { IcAction, IcNetCfg, IcRun, IcState } from "@/lib/sim-engine/scenarios/icmpNet";
import { Claims } from "./IcPanels";

/**
 * LEARN — what the network's signals mean, one idea per step, each on a real probe the learner sends:
 *   1 One ping            the request, the reply's own journey back, what a reply proves (and what it doesn't)
 *   2 TTL                 TTL 1, 2, 3: routers count it down and report when it runs out (11/0, from where)
 *   3 Traceroute          TTL on purpose (ICMP and UDP probes), and why * * * doesn't mean "down"
 *   4 When delivery fails 3/0 no route, 3/1 nobody answers, a powered-off host vs a firewalled one
 *   5 Size, MTU and DF    the arithmetic, the boundary byte, fragmenting vs refusing, what Linux does by default
 *   6 Silence             a lost reply, the PMTUD black hole, reading patterns of silence
 * Each step sets the network up through the model (a configuration, never a fault switch) and the learner sends the
 * probe. Results are read by the shared ResultView; nothing is pre-recorded.
 */

const B = IC_ADDR["HOST-B"];
const Bb = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
export interface IcStep {
  id: string;
  title: string;
  body: ReactNode;
  setup?: (c: IcNetCfg) => void;
  setupText?: string;
  probes?: { label: string; action: IcAction }[];
  /** Extra teaching UI under the result (receives the lab state and this step's latest run). */
  extra?: (s: IcState, run?: IcRun) => ReactNode;
  detail?: "simple" | "full";
  /** The learner sizes the probe (Level 5 arithmetic). */
  sizer?: boolean;
}
export interface IcLevel {
  n: number;
  title: string;
  idea: string;
  steps: IcStep[];
}
const ping = (o: Partial<Extract<IcAction, { type: "ping" }>> = {}): IcAction => ({ type: "ping", dev: "HOST-A", dst: B, count: 1, ...o });
const transit1400 = (c: IcNetCfg) => {
  c.R1.ifs.ge1.mtu = 1400;
  c.R2.ifs.ge1.mtu = 1400;
};

export const IC_LEVELS: IcLevel[] = [
  {
    n: 1,
    title: "One ping",
    idea: "A reply proves the request arrived AND the reply came back.",
    steps: [
      { id: "l1-send", detail: "simple", title: "Send one Echo Request", body: <p>HOST-A puts an ICMP <Bb>Echo Request</Bb> (type 8) inside an IP packet to HOST-B ({B}) and waits. Send it and watch who it passes and who answers.</p>, probes: [{ label: "ping -c 1 HOST-B", action: ping() }] },
      {
        id: "l1-back",
        detail: "simple",
        title: "The reply has its own journey",
        body: <p>HOST-B answers with an <Bb>Echo Reply</Bb> (type 0) — a brand-new packet with its own TTL, routed back on its own. Watch the TTL on the way there and on the way back.</p>,
        probes: [{ label: "ping -c 1 HOST-B", action: ping() }],
        extra: (_s, run) => {
          const a = run?.probes[0]?.answer;
          return a ? (
            <p className="rounded-xl border border-pv-border bg-pv-bg-elevated/30 p-3 text-[13.5px] text-pv-text-muted">
              The request left with TTL <Bb>64</Bb> and reached HOST-B with <Bb>62</Bb> (R1 and R2 each took one). The reply started at HOST-B with TTL <Bb>64</Bb> and arrived with <Bb>{a.ttl}</Bb>: {64 - a.ttl} routers forwarded it back. Two separate trips, both successful.
            </p>
          ) : null;
        },
      },
      {
        id: "l1-proves",
        detail: "simple",
        title: "What this ping proved — and what it didn't",
        body: <p>A reply is strong evidence, but only for what was actually tested: one small ICMP packet, to one address, a few times.</p>,
        extra: () => (
          <Claims
            title="Ping HOST-B succeeded. Does that prove…"
            items={[
              { claim: "HOST-B received my Echo Request", proven: true, why: "The Echo Reply is HOST-B's answer to it." },
              { claim: "HOST-B's reply found its way back to me", proven: true, why: "You received it — the return path worked for this packet." },
              { claim: "The web application on HOST-B works", proven: false, why: "Ping tests ICMP, not TCP port 80 or the application behind it." },
              { claim: "1500-byte packets will get through", proven: false, why: "This probe was 84 bytes. A smaller MTU somewhere only bites bigger packets." },
              { claim: "There is no packet loss on this path", proven: false, why: "A handful of probes is a sample, not a guarantee." },
              { claim: "DNS works", proven: false, why: "You pinged an address; no name was ever looked up." },
            ]}
          />
        ),
      },
    ],
  },
  {
    n: 2,
    title: "TTL and Time Exceeded",
    idea: "Every router takes one off the TTL. When it would reach 0, the router drops the packet and tells you.",
    steps: [
      { id: "l2-1", title: "Start the probe with TTL 1", body: <p>Same ping, but leaving HOST-A with <Bb>TTL 1</Bb>. R1 must subtract 1 before forwarding — it would leave with 0, so R1 drops it and sends <Bb>ICMP 11/0 Time Exceeded</Bb> back.</p>, probes: [{ label: "ping -c 1 -t 1 HOST-B", action: ping({ ttl: 1 }) }] },
      { id: "l2-2", title: "TTL 2", body: <p>Now R1 forwards it with TTL 1, and <Bb>R2</Bb> is the one that would send it out with 0. Notice the source of the error: R2&apos;s address <i>on the side the packet arrived</i> (203.0.113.2), not its LAN address.</p>, probes: [{ label: "ping -c 1 -t 2 HOST-B", action: ping({ ttl: 2 }) }] },
      { id: "l2-3", title: "TTL 3 is enough", body: <p>R1 and R2 each take one; the packet reaches HOST-B with TTL 1. Hosts don&apos;t decrement TTL — the destination accepts it and replies.</p>, probes: [{ label: "ping -c 1 -t 3 HOST-B", action: ping({ ttl: 3 }) }] },
    ],
  },
  {
    n: 3,
    title: "Traceroute",
    idea: "Traceroute expires probes on purpose: TTL 1 reveals the first router, TTL 2 the second…",
    steps: [
      { id: "l3-icmp", title: "Traceroute with ICMP probes", body: <p>traceroute -I sends Echo Requests with TTL 1, 2, 3… (three each). Each Time Exceeded names one router; the Echo Reply means the destination was reached.</p>, probes: [{ label: "traceroute -I HOST-B", action: { type: "trace", dev: "HOST-A", dst: B, icmp: true } }] },
      { id: "l3-udp", title: "Linux's default: UDP probes", body: <p>Plain traceroute sends UDP to unlikely ports (33434+). Routers still answer 11/0 when TTL runs out; the destination, which has nothing listening there, answers <Bb>ICMP 3/3 Port Unreachable</Bb> — that&apos;s how traceroute knows it arrived.</p>, probes: [{ label: "traceroute HOST-B", action: { type: "trace", dev: "HOST-A", dst: B } }] },
      {
        id: "l3-hidden",
        title: "* * * does not mean “down”",
        body: <p>Here R1 has an inbound filter on its transit interface that discards ICMP Time Exceeded (a common “security” rule). Run traceroute again and look at hop 2 — then at hop 3.</p>,
        setup: (c) => {
          c.R1.acl = { entries: [{ seq: 10, term: "block-ttl", action: "deny", proto: "icmp", icmp: "time-exceeded", hits: 0 }, { seq: 20, term: "allow-all", action: "permit", proto: "ip", hits: 0 }], appliedIn: "ge1" };
        },
        setupText: "Lesson setup: R1 filter WAN-IN — 10 deny icmp time-exceeded, 20 permit ip (inbound on the transit interface)",
        probes: [{ label: "traceroute HOST-B", action: { type: "trace", dev: "HOST-A", dst: B } }],
        extra: (s, run) =>
          run ? (
            <p className="rounded-xl border border-pv-border bg-pv-bg-elevated/30 p-3 text-[13.5px] text-pv-text-muted">
              Device evidence: R2&apos;s ICMP statistics show <Bb>{s.stats.R2.sent.ttl ?? 0} Time Exceeded sent</Bb>; R1&apos;s filter line 10 shows <Bb>{s.cfg.R1.acl?.entries[0]?.hits ?? 0} hits</Bb>. R2 answered every TTL-2 probe — R1 threw the answers away. Hop 3 (HOST-B) still appears, so the path is fine.
            </p>
          ) : null,
      },
    ],
  },
  {
    n: 4,
    title: "When delivery fails",
    idea: "A router that can't deliver usually says why — and the error names the router.",
    steps: [
      { id: "l4-net", title: "No route: 3/0 Net Unreachable", body: <p>Ping an address in a network nobody routes. R1 has no route for it, drops it and reports <Bb>3/0</Bb>.</p>, probes: [{ label: "ping -c 1 10.20.30.40", action: ping({ dst: "10.20.30.40" }) }] },
      { id: "l4-host", title: "Nobody answers ARP: 3/1 Host Unreachable", body: <p>198.51.100.99 is inside HOST-B&apos;s network, so R2 has a route — but no device owns that address. R2&apos;s ARP goes unanswered: <Bb>3/1</Bb>, from R2.</p>, probes: [{ label: "ping -c 1 198.51.100.99", action: ping({ dst: "198.51.100.99" }) }] },
      { id: "l4-off", title: "HOST-B is switched off", body: <p>Same signal for the real server when it&apos;s off: R2 reports 3/1. The error tells you the path to R2 works and the problem is beyond it.</p>, setup: (c) => (c["HOST-B"].power = false), setupText: "Lesson setup: HOST-B powered off", probes: [{ label: "ping -c 1 HOST-B", action: ping() }, { label: "traceroute HOST-B", action: { type: "trace", dev: "HOST-A", dst: B } }] },
      { id: "l4-fw", title: "HOST-B's firewall: silence", body: <p>Now HOST-B is on, but its firewall drops Echo Requests. A firewall that drops sends <i>nothing</i>. Compare ping with traceroute (UDP): does the path still reach HOST-B?</p>, setup: (c) => (c["HOST-B"].input = [{ type: "echo-request", target: "DROP" }]), setupText: "Lesson setup: HOST-B iptables INPUT -p icmp --icmp-type echo-request -j DROP", probes: [{ label: "ping -c 1 HOST-B", action: ping() }, { label: "traceroute HOST-B", action: { type: "trace", dev: "HOST-A", dst: B } }, { label: "curl index.html", action: { type: "curl", file: "small" } }] },
    ],
  },
  {
    n: 5,
    title: "Size, MTU and DF",
    idea: "Every link has a largest packet (MTU). DF decides whether a too-big packet is split or refused with 3/4.",
    steps: [
      { id: "l5-math", sizer: true, title: "Do the arithmetic", body: <p>In this level the R1–R2 link carries at most <Bb>1400-byte</Bb> IP packets. An Echo Request is data + 8 (ICMP header) + 20 (IPv4 header). Pick a size, predict, then send it with DF (-M do).</p>, setup: transit1400, setupText: "Lesson setup: transit link MTU 1400 (both ends)" },
      { id: "l5-fit", title: "1372 fits exactly", body: <p>1372 + 8 + 20 = <Bb>1400</Bb>: the largest packet the path carries whole.</p>, setup: transit1400, setupText: "Lesson setup: transit link MTU 1400", probes: [{ label: "ping -c 1 -s 1372 -M do HOST-B", action: ping({ data: 1372, mode: "do" }) }] },
      { id: "l5-over", title: "One byte more: 3/4 Fragmentation Needed", body: <p>1373 → 1401 bytes. R1 can&apos;t send it out its 1400-byte link and DF forbids splitting it, so R1 drops it and sends <Bb>3/4</Bb> carrying the limit: mtu 1400.</p>, setup: transit1400, setupText: "Lesson setup: transit link MTU 1400", probes: [{ label: "ping -c 1 -s 1373 -M do HOST-B", action: ping({ data: 1373, mode: "do" }) }] },
      { id: "l5-frag", title: "Let it fragment", body: <p>Same 1401 bytes without DF (-M dont): R1 splits it into fragments, HOST-B reassembles them and replies. It works — but fragmentation costs performance and many paths block fragments.</p>, setup: transit1400, setupText: "Lesson setup: transit link MTU 1400", probes: [{ label: "ping -c 1 -s 1373 -M dont HOST-B", action: ping({ data: 1373, mode: "dont" }) }] },
      {
        id: "l5-want",
        title: "What Linux does by default (Path MTU Discovery)",
        body: <p>Without -M, Linux sets DF and <i>listens</i> for 3/4. The first 1500-byte ping is refused; the kernel remembers “1400 to HOST-B” and fragments the next ones itself. That memory is Path MTU Discovery.</p>,
        setup: transit1400,
        setupText: "Lesson setup: transit link MTU 1400",
        probes: [{ label: "ping -c 3 -s 1472 HOST-B", action: ping({ data: 1472, count: 3 }) }],
        extra: (s) => (s.cfg["HOST-A"].pmtu[B] ? <p className="rounded-xl border border-pv-border bg-pv-bg-elevated/30 p-3 pv-mono text-[13px] text-pv-text">$ ip route get {B}<br />{B} via 192.0.2.1 dev eth0 src 192.0.2.10 uid 1000<br />    cache expires 597sec mtu {s.cfg["HOST-A"].pmtu[B]}</p> : null),
      },
    ],
  },
  {
    n: 6,
    title: "Silence is evidence",
    idea: "No answer is a clue: find the last place the probe — or its reply — was seen.",
    steps: [
      { id: "l6-return", title: "The request arrived — the reply didn't come back", body: <p>R2 has lost its route back to HOST-A&apos;s network. Ping HOST-B, then read <Bb>Follow the probe</Bb>: did HOST-B get the request? Did it answer? Where did the answer die?</p>, setup: (c) => (c.R2.statics = []), setupText: "Lesson setup: R2's route to 192.0.2.0/24 removed", probes: [{ label: "ping -c 1 HOST-B", action: ping() }, { label: "ping -c 1 R1", action: ping({ dst: IC_ADDR["R1:LAN"] }) }, { label: "traceroute HOST-B", action: { type: "trace", dev: "HOST-A", dst: B, max: 5 } }] },
      {
        id: "l6-blackhole",
        title: "Small works, big hangs: a PMTUD black hole",
        body: <p>The transit link is 1400 bytes and HOST-B&apos;s firewall drops ICMP Fragmentation Needed. Load the small page, then the big file. The data flows <i>from</i> HOST-B in full-size packets with DF: R2 refuses them and sends 3/4 — to HOST-B, which drops it.</p>,
        setup: (c) => {
          transit1400(c);
          c["HOST-B"].input = [{ type: "fragmentation-needed", target: "DROP" }];
        },
        setupText: "Lesson setup: transit MTU 1400 + HOST-B drops ICMP fragmentation-needed",
        probes: [{ label: "curl index.html", action: { type: "curl", file: "small" } }, { label: "curl big.iso", action: { type: "curl", file: "big" } }, { label: "ping -c 1 HOST-B", action: ping() }],
        extra: (s, run) =>
          run?.tool === "curl" && !run.curl?.ok ? (
            <p className="rounded-xl border border-pv-border bg-pv-bg-elevated/30 p-3 text-[13.5px] text-pv-text-muted">
              Device evidence: R2 sent <Bb>{s.stats.R2.sent.frag ?? 0}</Bb> Fragmentation Needed; HOST-B&apos;s capture shows them arriving and dropped by its firewall. The server never learns the path MTU, so it keeps resending 1500-byte segments. No error ever reaches HOST-A — a <Bb>silent</Bb> failure that only big packets hit.
            </p>
          ) : null,
      },
      {
        id: "l6-read",
        title: "Read the pattern",
        body: (
          <div className="space-y-1.5">
            <p>Each failure pattern points somewhere different:</p>
            <ul className="list-disc space-y-0.5 pl-5">
              <li>
                <Bb>R1 answers, then silence</Bb> — beyond R1, or anything that must come back through R2 (return path).
              </li>
              <li>
                <Bb>R2 answers, then silence</Bb> — beyond R2: the destination, or its firewall.
              </li>
              <li>
                <Bb>Nothing answers</Bb> — HOST-A&apos;s own side: its link, gateway, or a filter near it.
              </li>
              <li>
                <Bb>An unreachable comes back</Bb> — a router told you exactly where and why.
              </li>
              <li>
                <Bb>The request reaches HOST-B, the reply never returns</Bb> — the return path.
              </li>
            </ul>
          </div>
        ),
        extra: () => (
          <Claims
            title="Ping HOST-B failed. Does that prove…"
            items={[
              { claim: "HOST-B is down", proven: false, why: "Its firewall may drop ping, or the reply may be lost on the way back." },
              { claim: "The network is broken", proven: false, why: "Monitoring may be measuring a filter. Check other tests (traceroute, the application)." },
              { claim: "Either the request, the reply, or the answer to it was dropped — or never sent", proven: true, why: "That's all a timeout says. Captures, counters and other probes tell you which." },
              { claim: "If a router had a problem it would always tell me", proven: false, why: "ICMP can be filtered, and some drops (firewalls, giants) never generate any." },
            ]}
          />
        ),
      },
    ],
  },
];
