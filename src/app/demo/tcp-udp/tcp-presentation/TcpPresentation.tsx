"use client";

import { useState, type ReactNode } from "react";
import { LessonPresentation } from "@/components/presentation/LessonPresentation";
import { Mover, StageHead, type DeckStep } from "@/components/presentation/ScrollyDeck";
import { Chain, Compare, MiniTable, PacketCard, ReplayButton, Stat, Token, Topo, nodeAt, short, type TopoNode, type TopoView } from "@/components/presentation/Visuals";
import { TN_ADDR, TN_DNS, TN_FIRST, TN_HTTP, TN_TIMERS } from "@/lib/sim-engine/scenarios/tcpNet";

/**
 * TCP/UDP — the presentation before the TCP/UDP Lab, on the lab's own network (Laptop — R1 — Server) and with the
 * lab's own numbers (port 51001, ISNs 100 / 300, a 78-byte request and a 2400-byte page, 200 ms / 1 s timers, the
 * SYN-ACK dropped by R1's ACL). Presentation state only: nothing here touches the lab or progress.
 */

const C = TN_FIRST.clientIsn;
const S = TN_FIRST.serverIsn;
const CP = TN_FIRST.clientPort;
const REQ = TN_HTTP.request;
const PAGE = TN_HTTP.response;
const L = TN_ADDR.laptop;
const SV = TN_ADDR.server;

type Id = "why" | "ports" | "client" | "listen" | "hs-syn" | "hs-synack" | "hs-ack" | "why3" | "request" | "page" | "loss" | "retx" | "close" | "rst" | "timeout" | "udp" | "udp-silence" | "incident" | "captures" | "trouble" | "verify" | "recap";
type Step = DeckStep & { id: Id };
const Bb = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const M = ({ children }: { children: ReactNode }) => <span className="pv-mono text-pv-text">{children}</span>;

const STEPS: Step[] = [
  { id: "why", chapter: "Why a transport layer", title: "IP delivers packets to a host — that's all.", body: <p>IP gets each packet to the right host, usually. It doesn&apos;t say which <Bb>program</Bb> on that host should get it, and it doesn&apos;t promise every packet arrives, once, in order. The transport layer — TCP or UDP — adds what applications need on top.</p> },
  { id: "ports", chapter: "Ports", title: "One address, many applications.", body: <p>The Server at <M>{SV}</M> runs SSH, a web server, a DNS server and an API. Each <Bb>listens</Bb> on its own <Bb>port</Bb>: TCP 22, 80, 443, 8443 — and UDP 53. IP finds the host; the port finds the application.</p> },
  { id: "client", chapter: "Ports", title: "The client brings its own port.", body: <p>When the Laptop connects to port 443, its OS picks a free <Bb>source port</Bb> — <M>{CP}</M> — so answers come back to the right program. A conversation is named by four things: <M>{L}:{CP} ⇄ {SV}:443</M>. A second connection, to SSH, gets <M>{CP + 1}</M>: same hosts, different conversation.</p> },
  { id: "listen", chapter: "Client and server", title: "Before anything moves: the Server is LISTENing.", body: <p>A server program opens a <Bb>listening socket</Bb> on its port: a promise to accept connections, not a connection yet. The Laptop has nothing — <M>CLOSED</M>. Every connection will start from the client.</p> },
  { id: "hs-syn", chapter: "The three-way handshake", title: `1 · SYN: “let's talk; my numbers start at ${C}.”`, body: <p>The Laptop picks an initial sequence number (ISN {C}) and sends a <Bb>SYN</Bb>. Its state changes: <M>CLOSED → SYN-SENT</M>. R1 forwards the packet like any other — it keeps no TCP state.</p> },
  { id: "hs-synack", chapter: "The three-way handshake", title: `2 · SYN-ACK: “OK. Mine start at ${S}; I expect your byte ${C + 1}.”`, body: <p>The Server&apos;s listening socket accepts: a new connection appears in <M>SYN-RECEIVED</M>. It acknowledges the SYN (<M>ack={C + 1}</M> — a SYN counts as one byte) and sends its own SYN, ISN {S}.</p> },
  { id: "hs-ack", chapter: "The three-way handshake", title: `3 · ACK: “got it, I expect your byte ${S + 1}.”`, body: <p>The Laptop is <M>ESTABLISHED</M> as soon as the SYN-ACK arrives; it acknowledges the Server&apos;s SYN, and when that ACK arrives the Server is <M>ESTABLISHED</M> too. <Bb>Both endpoints</Bb> changed state — R1 never did.</p> },
  { id: "why3", chapter: "The three-way handshake", title: "Why three messages?", body: <p>Each side has to <Bb>announce</Bb> its starting number and have it <Bb>acknowledged</Bb>. The Server combines its acknowledgment and its own SYN into one segment, so it takes three, not four.</p> },
  { id: "request", chapter: "Bytes, seq and ack", title: `The handshake was preparation. Now: ${REQ} bytes of request.`, body: <p>curl sends <M>{TN_HTTP.requestLine}</M> — {REQ} bytes — starting at <M>seq={C + 1}</M>. They cover bytes {C + 1}–{C + REQ}, so the Server answers <M>ack={C + 1 + REQ}</M>: the <Bb>next byte it expects</Bb>.</p> },
  { id: "page", chapter: "Bytes, seq and ack", title: `The answer: ${PAGE} bytes, every one numbered.`, body: <p>nginx sends the page in three segments: seq <M>{S + 1}</M> (1000 bytes), <M>{S + 1001}</M> (1000), <M>{S + 2001}</M> (400). The Laptop acknowledges each: ack {S + 1001}, {S + 2001}, {S + PAGE + 1}. The sender always knows exactly what arrived.</p> },
  { id: "loss", chapter: "Loss and recovery", title: `Bytes ${S + 1001}–${S + 2000} are lost at R1.`, body: <p>The next segment (seq {S + 2001}) arrives — but byte {S + 1001} is missing. The Laptop keeps the later bytes aside and repeats <M>ack={S + 1001}</M>: a <Bb>duplicate ACK</Bb>. “I still need byte {S + 1001}.”</p> },
  { id: "retx", chapter: "Loss and recovery", title: `${TN_TIMERS.dataRto} ms without progress: the same bytes again.`, body: <p>The Server&apos;s retransmission timer fires and it resends <Bb>the same bytes, same seq={S + 1001}</Bb>. The hole is filled, and the ACK jumps straight to <M>{S + PAGE + 1}</M> — everything arrived, in order. The network resent nothing: TCP at the two ends did.</p> },
  { id: "close", chapter: "Closing", title: "Closing is a conversation too: FIN, ACK, FIN, ACK.", body: <p>The side that finishes first sends <Bb>FIN</Bb> (<M>FIN-WAIT-1</M>); the other acknowledges (<M>CLOSE-WAIT</M>), then sends its own FIN (<M>LAST-ACK</M>). The last ACK closes it. The side that closed first waits in <M>TIME-WAIT</M> for {TN_TIMERS.timeWait / 1000} s, just in case.</p> },
  { id: "rst", chapter: "Refused vs timeout", title: "Nothing listening → the host answers RST.", body: <p>A SYN to port <M>8080</M>, where nothing listens, gets <Bb>RST,ACK</Bb> straight back: “connection refused”. Fast and explicit: the host was reached, the network works both ways — the service isn&apos;t there.</p> },
  { id: "timeout", chapter: "Refused vs timeout", title: "Silence: SYN… SYN… SYN… timeout.", body: <p>If something drops the SYN (or the reply), nothing comes back. The Laptop resends the SYN after 1 s, then 2 s more, then 4 s more… and the program gives up: <Bb>timed out</Bb>. Not “the server is down” — the expected answer never arrived. Find where it was lost.</p> },
  { id: "udp", chapter: "UDP", title: "UDP: one datagram out, one back.", body: <p>dig asks the Server&apos;s DNS for <M>{TN_DNS.name}</M>: <Bb>one UDP datagram</Bb> to port 53, no handshake, and one datagram comes back. UDP has ports — but no sequence numbers, no ACKs, no connection, no state to close.</p> },
  { id: "udp-silence", chapter: "UDP", title: "When a datagram is lost, the application decides.", body: <p>No answer? UDP will never notice. <Bb>dig</Bb> waits {TN_TIMERS.dnsTimeout / 1000} s and asks again — the application retries, not UDP. That&apos;s not “bad TCP”: for a small question, a connection would only add delay.</p> },
  { id: "incident", chapter: "The incident", title: "Ticket: the site “spins, then times out”.", body: <p>The Laptop sends SYN… waits… retries. It stays in <M>SYN-SENT</M> and times out. The server team says nginx is running and they <i>see</i> the connection attempts. Not refused — so something is <Bb>dropping</Bb> traffic silently.</p> },
  { id: "captures", chapter: "Troubleshooting", title: "Capture at every point and compare.", body: <p>Laptop: SYN out, nothing back. Server: SYN in, <Bb>SYN-ACK out</Bb> — it sits in SYN-RECEIVED. R1: the SYN-ACK arrives on its Server side and never leaves toward the Laptop. The response disappears inside R1.</p> },
  { id: "trouble", chapter: "Troubleshooting", title: "Refused or timeout tells you where to look.", body: <p>A RST means the SYN reached the host. A timeout means something in between lost the SYN or the answer. The endpoint states and the captures at each point say which segment goes missing, and where.</p> },
  { id: "verify", chapter: "Troubleshooting", title: "Fix it, then prove it with traffic.", body: <p>R1&apos;s ACL denied TCP from the Server&apos;s port 80. Remove that line, run the same test: SYN → SYN-ACK → ACK, both sides ESTABLISHED, the page arrives. That&apos;s the proof — not the command being accepted.</p> },
  { id: "recap", chapter: "The whole idea", title: "Ports, state, numbered bytes — and evidence.", body: <p>Now drive it yourself in the TCP &amp; UDP Lab: watch both endpoints change state, read seq and ack, lose a segment, compare refused with timeout, query DNS over UDP, and solve six tickets from captures.</p> },
];

const VISUAL: Record<Id, string> = { why: "net", ports: "ports", client: "client", listen: "net", "hs-syn": "net", "hs-synack": "net", "hs-ack": "net", why3: "why3", request: "net", page: "net", loss: "net", retx: "net", close: "net", rst: "net", timeout: "net", udp: "net", "udp-silence": "net", incident: "net", captures: "net", trouble: "trouble", verify: "net", recap: "recap" };

const NODES: TopoNode[] = [
  { id: "l", label: "Laptop", sub: L, icon: "💻", x: 12, y: 60 },
  { id: "r1", label: "R1", sub: "router", icon: "R", x: 50, y: 60 },
  { id: "s", label: "Server", sub: SV, icon: "🗄", x: 88, y: 60 },
];
const LINKS = [
  { a: "l", b: "r1" },
  { a: "r1", b: "s" },
];
const at = (n: string) => nodeAt(NODES, n);
const C2S = ["l", "r1", "s"];
const S2C = ["s", "r1", "l"];

const STATES: Partial<Record<Id, [string, string]>> = {
  listen: ["CLOSED", "LISTEN :443"],
  "hs-syn": ["SYN-SENT", "LISTEN"],
  "hs-synack": ["SYN-SENT", "SYN-RECEIVED"],
  "hs-ack": ["ESTABLISHED", "ESTABLISHED"],
  request: ["ESTABLISHED", "ESTABLISHED"],
  page: ["ESTABLISHED", "ESTABLISHED"],
  loss: ["ESTABLISHED", "ESTABLISHED"],
  retx: ["ESTABLISHED", "ESTABLISHED"],
  close: ["TIME-WAIT", "CLOSED"],
  rst: ["CLOSED (refused)", "no listener on 8080"],
  timeout: ["SYN-SENT → gives up", "never saw a SYN"],
  udp: ["no TCP state", "named: UNCONN :53"],
  "udp-silence": ["no TCP state", "named: UNCONN :53"],
  incident: ["SYN-SENT (retrying)", "SYN-RECEIVED"],
  captures: ["SYN-SENT", "SYN-RECEIVED"],
  verify: ["ESTABLISHED", "ESTABLISHED"],
};

function TcpDeck({ step: s, play, replay }: { step: Step; play: number; replay: () => void }) {
  const id = s.id;
  const k = `${id}-${play}`;
  const head = <StageHead chapter={s.chapter} title={s.title} />;
  const travel = (path: string[], o: { label: string; key: string; delay?: number; color?: string; stopAt?: number; d?: number }) => {
    const end = o.stopAt ?? path.length - 1;
    return path.slice(0, end).map((n, i) => {
      const last = i === end - 1;
      return (
        <Mover key={`${k}-${o.key}-${i}`} from={at(n)} to={last ? short(at(n), at(path[i + 1])) : at(path[i + 1])} delay={(o.delay ?? 0) + i * (o.d ?? 650)} duration={o.d ?? 650} stay={last}>
          <Token color={o.color ?? "cyan"}>{o.label}</Token>
        </Mover>
      );
    });
  };

  if (VISUAL[id] === "net") {
    const views: Record<string, TopoView> = {};
    let movers: ReactNode = null;
    if (["hs-syn", "hs-synack", "hs-ack", "request", "page", "close"].includes(id)) views.r1 = { badge: { text: "no TCP state", tone: "no" } };
    if (id === "why") {
      movers = (
        <>
          {travel(C2S, { label: "pkt 1", key: "a" })}
          {travel(C2S, { label: "pkt 2", key: "b", delay: 500, stopAt: 1, color: "red" })}
          {travel(C2S, { label: "pkt 3", key: "c", delay: 1000, color: "violet" })}
        </>
      );
      views.r1 = { ring: "bad", bubble: { text: "pkt 2 dropped", tone: "bad", delay: 1100 } };
      views.s = { bubble: { text: "for which program? and where's 2?", tone: "ask", delay: 2400 } };
    }
    if (id === "listen") views.s = { ring: "on", bubble: { text: "LISTEN on 22, 80, 443, 8443 · UDP 53", tone: "info" } };
    if (id === "hs-syn") movers = travel(C2S, { label: `SYN seq=${C}`, key: "1", color: "amber" });
    if (id === "hs-synack") movers = travel(S2C, { label: `SYN-ACK seq=${S} ack=${C + 1}`, key: "1", color: "violet" });
    if (id === "hs-ack") movers = travel(C2S, { label: `ACK ack=${S + 1}`, key: "1", color: "green" });
    if (id === "request")
      movers = (
        <>
          {travel(C2S, { label: `data ${REQ} B seq=${C + 1}`, key: "1" })}
          {travel(S2C, { label: `ack=${C + 1 + REQ}`, key: "2", delay: 1500, color: "green" })}
        </>
      );
    if (id === "page")
      movers = (
        <>
          {travel(S2C, { label: `seq=${S + 1} 1000 B`, key: "1", color: "green" })}
          {travel(S2C, { label: `seq=${S + 1001} 1000 B`, key: "2", delay: 700, color: "green" })}
          {travel(S2C, { label: `seq=${S + 2001} 400 B`, key: "3", delay: 1400, color: "green" })}
          {travel(C2S, { label: `ack=${S + PAGE + 1}`, key: "4", delay: 2900, color: "white" })}
        </>
      );
    if (id === "loss") {
      movers = (
        <>
          {travel(S2C, { label: `seq=${S + 1001}`, key: "1", stopAt: 1, color: "red" })}
          {travel(S2C, { label: `seq=${S + 2001}`, key: "2", delay: 800, color: "green" })}
          {travel(C2S, { label: `ack=${S + 1001} again`, key: "3", delay: 2200, color: "amber" })}
        </>
      );
      views.r1 = { ring: "bad", bubble: { text: "lost here", tone: "bad", delay: 700 } };
      views.l = { bubble: { text: `still missing ${S + 1001}`, tone: "ask", delay: 1900 } };
    }
    if (id === "retx")
      movers = (
        <>
          {travel(S2C, { label: `↻ seq=${S + 1001} (same bytes)`, key: "1", color: "amber" })}
          {travel(C2S, { label: `ack=${S + PAGE + 1}`, key: "2", delay: 1500, color: "green" })}
        </>
      );
    if (id === "close")
      movers = (
        <>
          {travel(C2S, { label: "FIN", key: "1", color: "amber" })}
          {travel(S2C, { label: "ACK", key: "2", delay: 1400, color: "white" })}
          {travel(S2C, { label: "FIN", key: "3", delay: 2100, color: "amber" })}
          {travel(C2S, { label: "ACK", key: "4", delay: 3500, color: "white" })}
        </>
      );
    if (id === "rst")
      movers = (
        <>
          {travel(C2S, { label: "SYN → :8080", key: "1", color: "amber" })}
          {travel(S2C, { label: "RST,ACK", key: "2", delay: 1400, color: "red" })}
        </>
      );
    if (id === "timeout") {
      movers = (
        <>
          {travel(C2S, { label: "SYN", key: "1", stopAt: 1, color: "amber" })}
          {travel(C2S, { label: "SYN (+1 s)", key: "2", delay: 1300, stopAt: 1, color: "amber" })}
          {travel(C2S, { label: "SYN (+2 s)", key: "3", delay: 2600, stopAt: 1, color: "amber" })}
        </>
      );
      views.r1 = { ring: "bad", bubble: { text: "dropped silently", tone: "bad", delay: 700 } };
      views.l = { bubble: { text: "…nothing comes back", tone: "ask", delay: 3400 } };
    }
    if (id === "udp")
      movers = (
        <>
          {travel(C2S, { label: "DNS query (UDP 53)", key: "1", color: "violet" })}
          {travel(S2C, { label: `${TN_DNS.name} = ${SV}`, key: "2", delay: 1400, color: "violet" })}
        </>
      );
    if (id === "udp-silence") {
      movers = (
        <>
          {travel(C2S, { label: "query", key: "1", stopAt: 1, color: "violet" })}
          {travel(C2S, { label: "query again (dig)", key: "2", delay: 1600, stopAt: 1, color: "violet" })}
        </>
      );
      views.l = { bubble: { text: `dig retries after ${TN_TIMERS.dnsTimeout / 1000} s`, tone: "ask", delay: 1300 } };
    }
    if (id === "incident" || id === "captures") {
      movers = (
        <>
          {travel(C2S, { label: "SYN", key: "1", color: "amber" })}
          {travel(S2C, { label: "SYN-ACK", key: "2", delay: 1400, stopAt: 1, color: "violet" })}
          {travel(C2S, { label: "SYN (retry)", key: "3", delay: 2600, color: "amber" })}
        </>
      );
      views.r1 = { ring: id === "captures" ? "bad" : "hit", bubble: id === "captures" ? { text: "SYN-ACK in on Gi0/1, never out", tone: "bad", delay: 1900 } : undefined };
      if (id === "captures") {
        views.l = { badge: { text: "📷", tone: "info" }, bubble: { text: "SYN out · nothing back", tone: "no", delay: 500 } };
        views.s = { badge: { text: "📷", tone: "info" }, bubble: { text: "SYN in · SYN-ACK out", tone: "yes", delay: 1400 } };
      } else views.l = { bubble: { text: "…waiting", tone: "ask", delay: 2000 } };
    }
    if (id === "verify")
      movers = (
        <>
          {travel(C2S, { label: "SYN", key: "1", color: "amber" })}
          {travel(S2C, { label: "SYN-ACK", key: "2", delay: 1400, color: "violet" })}
          {travel(C2S, { label: "ACK", key: "3", delay: 2800, color: "green" })}
        </>
      );
    const st = STATES[id];
    return (
      <>
        {head}
        <Topo nodes={NODES} links={LINKS} views={views} ratio={30} minH={190}>
          {movers}
        </Topo>
        {st && (
          <div className="grid grid-cols-2 gap-2">
            <Stat k="Laptop" v={st[0]} tone={st[0].startsWith("ESTAB") ? "green" : st[0].startsWith("CLOSED (") || st[0].includes("gives up") ? "red" : st[0].startsWith("no") ? "plain" : "amber"} />
            <Stat k="Server" v={st[1]} tone={st[1].startsWith("ESTAB") ? "green" : st[1].startsWith("no") || st[1].startsWith("never") ? "red" : "violet"} />
          </div>
        )}
        {id === "page" && (
          <MiniTable
            title="seq = where these bytes begin · ack = the next byte expected"
            cols={["segment", "bytes", "Laptop's ack"]}
            rows={[
              { cells: [`seq=${S + 1}`, `${S + 1}–${S + 1000}`, String(S + 1001)] },
              { cells: [`seq=${S + 1001}`, `${S + 1001}–${S + 2000}`, String(S + 2001)] },
              { cells: [`seq=${S + 2001}`, `${S + 2001}–${S + PAGE}`, String(S + PAGE + 1)], state: "hit" },
            ]}
          />
        )}
        {id === "captures" && (
          <MiniTable
            title="Capture evidence"
            cols={["Point", "SYN", "SYN-ACK"]}
            rows={[
              { cells: ["Laptop eth0", "out ✓", "never seen ✕"], state: "bad" },
              { cells: ["R1 Gi0/0 (LAN side)", "in ✓", "never sent ✕"], state: "bad" },
              { cells: ["R1 Gi0/1 (Server side)", "out ✓", "in ✓"] },
              { cells: ["Server eth0", "in ✓", "out ✓"] },
            ]}
          />
        )}
        <ReplayButton onClick={replay} />
      </>
    );
  }

  switch (id) {
    case "ports":
      return (
        <>
          {head}
          <MiniTable
            title={`One host, ${SV}: who listens where`}
            cols={["port", "application"]}
            rows={[
              { cells: ["TCP 22", "SSH (sshd)"] },
              { cells: ["TCP 80", "web (nginx)"], state: "hit" },
              { cells: ["TCP 443", "web, HTTPS (nginx)"] },
              { cells: ["TCP 8443", "the team's API"] },
              { cells: ["UDP 53", "DNS (named)"] },
              { cells: ["TCP 8080", "— nothing —"], state: "dim" },
            ]}
          />
        </>
      );
    case "client":
      return (
        <>
          {head}
          <PacketCard
            layers={[
              { name: "IPv4: which hosts", color: "#a78bfa", fields: [{ k: "Src IP", v: L }, { k: "Dst IP", v: SV }, { k: "Protocol", v: "6 = TCP" }] },
              { name: "TCP: which applications", color: "#22d3ee", fields: [{ k: "Src port", v: `${CP} (picked by the Laptop)`, hi: "key" }, { k: "Dst port", v: "443 (HTTPS)", hi: "key" }, { k: "Seq / Ack / Flags", v: "next steps" }] },
            ]}
          />
          <p className="text-center pv-mono text-[12.5px] text-pv-text sm:text-[14px]">
            {L}:{CP} ⇄ {SV}:443
            <br />
            {L}:{CP + 1} ⇄ {SV}:22 <span className="font-sans text-pv-text-muted">— a different conversation</span>
          </p>
        </>
      );
    case "why3":
      return (
        <>
          {head}
          <Chain
            k="w3"
            items={[
              { t: `Laptop: “my ISN is ${C}” (SYN)`, tone: "amber" },
              { t: `Server: “ack ${C + 1}” + “my ISN is ${S}” (SYN-ACK)`, tone: "violet" },
              { t: `Laptop: “ack ${S + 1}” (ACK)`, tone: "green" },
              { t: "Both numberings announced and confirmed → ESTABLISHED at both ends", tone: "cyan" },
            ]}
          />
          <p className="text-center text-[13px] text-pv-text-muted">Real stacks pick random 32-bit ISNs; the lab uses readable ones.</p>
        </>
      );
    case "trouble":
      return (
        <>
          {head}
          <Compare
            items={[
              { title: "RST (refused)", tone: "red", body: "reached the host · nothing listens (or a firewall rejects) · instant answer" },
              { title: "Timeout (hangs)", tone: "amber", body: "the SYN or the reply is lost · no answer at all · retries, then gives up" },
            ]}
          />
          <Chain
            k="ts"
            items={[
              { t: "Can I reach the host? (ping)", tone: "plain" },
              { t: "Did the SYN leave? Did it reach the Server?", tone: "amber" },
              { t: "Is anything listening? Did the Server send SYN-ACK or RST?", tone: "amber" },
              { t: "Did the answer come back? Where did it stop?", tone: "violet" },
              { t: "What state is each endpoint in?", tone: "violet" },
              { t: "Fix → verify on the device → test again", tone: "green" },
            ]}
          />
        </>
      );
    case "recap":
      return (
        <>
          {head}
          <Chain
            k="recap"
            items={[
              { t: "IP finds the host; the port finds the application; the 4-tuple names a conversation" },
              { t: "SYN → SYN-ACK → ACK: both endpoints change state; routers keep none", tone: "amber" },
              { t: "seq = first byte; ack = next byte expected", tone: "cyan" },
              { t: "Loss → duplicate ACK → the same bytes resent → the ACK jumps", tone: "violet" },
              { t: "FIN … TIME-WAIT closes; RST = refused; silence = timeout", tone: "red" },
              { t: "UDP: datagrams, no state — the application handles silence", tone: "violet" },
              { t: "Captures at several points find where a packet stops", tone: "green" },
            ]}
          />
        </>
      );
  }
  return head;
}

export function TcpPresentation({ open, onClose, onFinish, finishLabel }: { open: boolean; onClose: () => void; onFinish: () => void; finishLabel: string }) {
  const [play, setPlay] = useState(0);
  return (
    <LessonPresentation
      open={open}
      onClose={onClose}
      title="TCP & UDP, from zero"
      kicker="Learn · the TCP & UDP presentation"
      flow={["Learn", "Lab", "Practice", "Troubleshoot"]}
      steps={STEPS}
      visual={(s) => VISUAL[s.id]}
      renderStage={(s) => <TcpDeck step={s} play={play} replay={() => setPlay((p) => p + 1)} />}
      finish={{ label: finishLabel, onClick: onFinish }}
      skip={{ label: "Skip to the TCP & UDP Lab →", onClick: onFinish }}
    />
  );
}
