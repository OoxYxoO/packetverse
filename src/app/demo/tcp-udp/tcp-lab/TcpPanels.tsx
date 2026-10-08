"use client";

import { clsx } from "clsx";
import { useState, type ReactNode } from "react";
import { TN_ADDR, TN_HTTP, TN_PORT_NAME, pktName, tcpdumpFlags, tnCommand, tnListener, type TcpState, type TnAction, type TnRun, type TnState } from "@/lib/sim-engine/scenarios/tcpNet";
import { StatePill } from "./TcpTopology";

/**
 * Teaching panels of the TCP/UDP lab, all read from the model: the state history of a test (both endpoints, side by
 * side, and R1's empty column), the handshake's numbers, the data ledger (seq, length, ack), what a result proves, the
 * traffic composer, and the troubleshooting evidence ladder.
 */

const card = "rounded-xl border border-pv-border bg-pv-bg/60 p-2.5";
const Title = ({ children }: { children: ReactNode }) => <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-pv-text-faint">{children}</p>;

/** Each endpoint's states during a test, in order — and R1's (none). */
export function StateHistory({ run }: { run: TnRun }) {
  const col = (host: "laptop" | "server") => {
    const ev = run.events.filter((e) => e.k === "state" && e.host === host) as Extract<TnRun["events"][number], { k: "state" }>[];
    const start: TcpState | "LISTEN" | undefined = host === "server" ? (ev[0]?.from === "LISTEN" ? "LISTEN" : undefined) : "CLOSED";
    return { start, ev };
  };
  const L = col("laptop");
  const S = col("server");
  const t0 = run.start;
  const list = (c: ReturnType<typeof col>, who: string) => (
    <div className="min-w-0 space-y-1">
      <p className="text-[12px] font-semibold text-pv-text">{who}</p>
      {c.start && (
        <p className="flex items-center gap-1.5 text-[11.5px] text-pv-text-faint">
          <StatePill state={c.start} /> {who === "Server" ? "(the listening socket)" : "(no connection)"}
        </p>
      )}
      {c.ev.map((e, i) => (
        <p key={i} className="flex items-start gap-1.5 text-[11.5px] leading-snug text-pv-text-muted">
          <StatePill state={e.to} className="shrink-0" />
          <span>
            <span className="pv-mono text-pv-text-faint">{((e.t - t0) / 1000).toFixed(3)} s</span> {e.why}
          </span>
        </p>
      ))}
      {!c.ev.length && !c.start && <p className="text-[11.5px] text-pv-text-faint">no TCP state at all</p>}
    </div>
  );
  return (
    <div className={card}>
      <Title>Who keeps state — during this test</Title>
      <div className="mt-1.5 grid gap-3 sm:grid-cols-[1fr_auto_1fr]">
        {list(L, "Laptop")}
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-pv-border px-3 py-2 text-center">
          <p className="text-[12px] font-semibold text-pv-text">R1</p>
          <p className="text-[11px] text-pv-text-faint">forwards every segment</p>
          <p className="text-[11px] text-pv-text-faint">— no TCP state —</p>
        </div>
        {list(S, "Server")}
      </div>
    </div>
  );
}

/** The capture on the Laptop's NIC as a ledger: who sent what, which bytes, which ack. */
export function SegmentLedger({ s, run, onlyHandshake }: { s: TnState; run: TnRun; onlyHandshake?: boolean }) {
  const caps = s.captures.filter((c) => c.n >= run.capFrom && c.point === "laptop" && c.pkt.proto === "tcp");
  const rows = onlyHandshake ? caps.slice(0, 3) : caps;
  if (!rows.length) return null;
  return (
    <div className={card}>
      <Title>{onlyHandshake ? "The handshake's numbers (Laptop's capture)" : "Every segment, as the Laptop's capture saw it"}</Title>
      <div className="mt-1 overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-[12px]">
          <thead className="text-[11px] text-pv-text-faint">
            <tr>
              <th className="px-1.5 py-1"></th>
              <th className="px-1.5 py-1">segment</th>
              <th className="px-1.5 py-1">seq</th>
              <th className="px-1.5 py-1">bytes</th>
              <th className="px-1.5 py-1">ack (next byte expected)</th>
              <th className="px-1.5 py-1">why that ack</th>
            </tr>
          </thead>
          <tbody className="pv-mono">
            {rows.map((c) => {
              const h = c.pkt.tcp!;
              const out = c.dir === "out";
              const occupies = h.len + (h.flags.includes("SYN") || h.flags.includes("FIN") ? 1 : 0);
              const prev = caps.slice(0, caps.indexOf(c)).reverse().find((x) => x.dir !== c.dir && x.pkt.tcp && (x.pkt.tcp.len || x.pkt.tcp.flags.includes("SYN") || x.pkt.tcp.flags.includes("FIN")));
              const why = (() => {
                if (h.ack === undefined) return "ACK flag clear: no ack yet";
                if (!prev) return "";
                const before = caps.slice(0, caps.indexOf(c));
                const lastSame = [...before].reverse().find((x) => x.dir === c.dir && x.pkt.tcp?.ack !== undefined);
                if (lastSame && lastSame.pkt.tcp!.ack === h.ack && before.indexOf(prev) < before.indexOf(lastSame)) return "unchanged: nothing new has arrived since its last ACK";
                const p = prev.pkt.tcp!;
                const occ = p.len + (p.flags.includes("SYN") || p.flags.includes("FIN") ? 1 : 0);
                const expected = p.seq + occ;
                if (h.ack === expected) return `${p.seq} + ${occ}${p.flags.includes("SYN") ? " (a SYN counts 1)" : p.flags.includes("FIN") ? " (a FIN counts 1)" : ""}: the next byte after the last one received`;
                if (h.ack < expected) return `byte ${h.ack} is still missing — a duplicate ACK (later bytes are kept aside)`;
                return `jumped: the hole is filled, everything up to ${h.ack - 1} has arrived`;
              })();
              return (
                <tr key={c.n} className={clsx("border-t border-pv-border/50", c.pkt.retx && "text-pv-warning")}>
                  <td className="px-1.5 py-0.5 font-sans text-[11px] text-pv-text-faint">{out ? "Laptop →" : "← Server"}</td>
                  <td className="px-1.5 py-0.5">
                    {c.pkt.retx ? "↻ " : ""}
                    {pktName(c.pkt)} {tcpdumpFlags(h.flags)}
                  </td>
                  <td className="px-1.5 py-0.5">{h.seq}</td>
                  <td className="px-1.5 py-0.5">{occupies ? `${h.seq}–${h.seq + occupies - 1}${h.len ? ` (${h.len} B)` : ""}` : "none"}</td>
                  <td className="px-1.5 py-0.5">{h.ack ?? "—"}</td>
                  <td className="px-1.5 py-0.5 font-sans text-[11px] text-pv-text-muted">{why}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[11.5px] text-pv-text-muted">seq = the number of the first byte in the segment. ack = the next byte the sender of the ACK expects — so it says “I have everything before this”.</p>
    </div>
  );
}

/** What the result of a test proves — and what it doesn't. */
export function Reading({ s, run }: { s: TnState; run: TnRun }) {
  const port = run.port;
  const listening = port ? !!tnListener(s.cfg, "tcp", port) : undefined;
  let tone: "ok" | "bad" | "warn" = run.ok ? "ok" : run.result === "refused" ? "bad" : "warn";
  let meaning: string;
  let proves: string;
  if (run.tool === "dig") {
    meaning = run.ok ? "One datagram out, one back. No handshake, no connection, nothing to close." : run.result === "refused" ? "An ICMP port-unreachable came back: the Server is reachable, but no process has UDP 53 open." : "No answer to any of dig's three tries. The query, or the answer, was lost — UDP itself never noticed; dig gave up.";
    proves = run.ok ? "The DNS server answered this query. It doesn't prove anything about TCP services." : run.result === "refused" ? "IP works both ways; the DNS service is the problem." : "Silence: look for where the datagrams stop (captures, filters, the service).";
  } else if (run.tool === "ping") {
    meaning = run.ok ? "Echo replies came back: IP works both ways." : "No echo replies.";
    proves = run.ok ? "The host is reachable at the IP layer — not that any TCP or UDP port is open." : "IP reachability fails (or ICMP is filtered): fix the network layer before blaming TCP.";
    tone = run.ok ? "ok" : "warn";
  } else if (run.tool === "sleep") {
    meaning = "The lab clock moved on.";
    proves = "Timers that ran out (TIME-WAIT, half-open SYN-RECV, retries) have done their work: check the socket tables again.";
  } else {
    meaning = run.ok ? `The three-way handshake completed with ${TN_ADDR.server}:${port}${run.tool === "curl" ? `, the request and the ${TN_HTTP.response}-byte page crossed the connection, and it was closed` : ", and nc closed it at once"}.` : run.result === "refused" ? `An answer came back at once — a RST (or ICMP port unreachable): the Server's host was reached, but ${listening === false ? `nothing listens on TCP ${port}` : "the attempt was rejected"}.` : run.result === "reset" ? "The connection was reset by the peer after it was open." : `Nothing useful came back: the SYN was retransmitted ${run.events.filter((e) => e.k === "note" && /resends the SYN/.test(e.text)).length} times, then the client gave up.`;
    proves = run.ok ? "IP works both ways and something listens on that port. Not that the application's content is right." : run.result === "refused" ? "IP works both ways. The problem is at the Server, on that port: is anything listening? Is its firewall rejecting?" : "Silence is evidence, not a diagnosis: the SYN, or the answer, is being lost — by a filter, a missing return route, or a host firewall. Find where it stops.";
  }
  return (
    <div className={clsx("space-y-1.5 rounded-xl border p-2.5", tone === "ok" ? "border-pv-success/50 bg-pv-success/[0.05]" : tone === "bad" ? "border-pv-danger/50 bg-pv-danger/[0.05]" : "border-pv-warning/50 bg-pv-warning/[0.05]")}>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-black/40 px-2 py-1.5 pv-mono text-[11.5px] text-pv-text">
        <span className="text-pv-success">admin@laptop:~$ </span>
        {run.cmd}
        {"\n"}
        {run.output}
      </pre>
      <p className="text-[13px] text-pv-text">{meaning}</p>
      <p className="text-[12.5px] text-pv-text-muted">
        <b className="text-pv-text">So:</b> {proves}
      </p>
    </div>
  );
}

/** Generate traffic from the Laptop: the tool, the port, how long to wait — each control says what it means. */
export function TrafficComposer({ s, act }: { s: TnState; act: (a: TnAction) => void }) {
  const [tool, setTool] = useState<"curl" | "nc" | "dig" | "ping">("nc");
  const [port, setPort] = useState(443);
  const [timeout, setTimeoutS] = useState(10);
  const a: TnAction = tool === "curl" ? { type: "curl", port: port === 443 || port === 22 ? 80 : port, timeout } : tool === "nc" ? { type: "nc", port, timeout } : tool === "dig" ? { type: "dig" } : { type: "ping", count: 3 };
  const pillCls = (on: boolean) => clsx("rounded-full border px-2.5 py-0.5 text-[12px] font-semibold", on ? "border-pv-cyan bg-pv-cyan/15 text-pv-text" : "border-pv-border text-pv-text-muted hover:text-pv-text");
  const ports = tool === "curl" ? [80, 8080, 8443] : [22, 80, 443, 8080, 8443, ...s.cfg.server.nc.filter((p) => ![22, 80, 443, 8080, 8443].includes(p))];
  return (
    <div className="space-y-2 rounded-xl border border-pv-cyan/30 p-2.5">
      <Title>Generate traffic from the Laptop</Title>
      <div className="flex flex-wrap items-center gap-1">
        {(
          [
            ["nc", "nc -vz · test a TCP port"],
            ["curl", "curl · fetch a page"],
            ["dig", "dig · a UDP DNS query"],
            ["ping", "ping · IP reachability"],
          ] as const
        ).map(([t, l]) => (
          <button key={t} type="button" aria-pressed={tool === t} onClick={() => setTool(t)} className={pillCls(tool === t)}>
            {l}
          </button>
        ))}
      </div>
      {(tool === "nc" || tool === "curl") && (
        <div className="flex flex-wrap items-center gap-1 text-[12px] text-pv-text-muted">
          <span>Server port:</span>
          {ports.map((p) => (
            <button key={p} type="button" aria-pressed={port === p} onClick={() => setPort(p)} className={pillCls(port === p)}>
              {p} {TN_PORT_NAME[p] ?? ""}
            </button>
          ))}
          <span className="ml-2">give up after</span>
          {[5, 10, 0].map((t) => (
            <button key={t} type="button" aria-pressed={timeout === t} onClick={() => setTimeoutS(t)} className={pillCls(timeout === t)}>
              {t ? `${t} s` : "kernel default (127 s)"}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => act(timeout ? a : { ...a, timeout: undefined } as TnAction)} className="rounded-full bg-pv-cyan px-3 py-1 text-[12.5px] font-semibold text-[#03131a]">
          ▶ {tnCommand(timeout ? a : ({ ...a, timeout: undefined } as TnAction))}
        </button>
        <span className="text-[11.5px] text-pv-text-faint">{tool === "nc" ? "Opens a TCP connection and closes it at once: the purest test of “can I connect?”" : tool === "curl" ? "A whole HTTP exchange: handshake, request, page, close." : tool === "dig" ? "UDP: one datagram, one answer — or silence." : "ICMP: is the host reachable at all? Says nothing about ports."}</span>
      </div>
    </div>
  );
}

/** The troubleshooting ladder, filled from the tests the learner ran and the devices' state. */
export function ladder(s: TnState): { k: string; title: string; text: string }[] {
  const runs = s.runs.filter((r) => r.id > (s.changeSeq || 0) || true);
  const lastConn = [...runs].reverse().find((r) => r.tool === "curl" || r.tool === "nc");
  const lastPing = [...runs].reverse().find((r) => r.tool === "ping");
  const lastDig = [...runs].reverse().find((r) => r.tool === "dig");
  const caps = lastConn ? s.captures.filter((c) => c.n >= lastConn.capFrom) : [];
  const at = (point: string, dir: string, f: (n: string) => boolean) => caps.some((c) => c.point === point && c.dir === dir && c.pkt.proto === "tcp" && f(pktName(c.pkt)));
  const need = (x: string) => `Not tested yet — ${x}.`;
  const synOut = at("laptop", "out", (n) => n === "SYN");
  const synAtServer = at("server", "in", (n) => n === "SYN");
  const synAckOut = at("server", "out", (n) => n === "SYN-ACK");
  const rstOut = at("server", "out", (n) => n === "RST");
  const backAtLaptop = at("laptop", "in", (n) => n === "SYN-ACK" || n === "RST");
  const synAckR1In = at("r1:gi1", "in", (n) => n === "SYN-ACK");
  const synAckR1Out = at("r1:gi0", "out", (n) => n === "SYN-ACK");
  // The latest test was a DNS query (UDP): follow the datagram instead of asking about SYNs it never had.
  if (lastDig && (!lastConn || lastDig.id > lastConn.id)) {
    const ucaps = s.captures.filter((c) => c.n >= lastDig.capFrom);
    const seen = (point: string, dir: string, name: string) => ucaps.some((c) => c.point === point && c.dir === dir && pktName(c.pkt) === name);
    const qOut = seen("laptop", "out", "DNS query");
    const qIn = seen("server", "in", "DNS query");
    const resp = seen("server", "out", "DNS response");
    const unreach = seen("server", "out", "ICMP port unreachable");
    const back = seen("laptop", "in", "DNS response") || seen("laptop", "in", "ICMP port unreachable");
    const owner = tnListener(s.cfg, "udp", 53);
    return [
      { k: "ping", title: "Can I reach the host at all (IP)?", text: lastPing ? (lastPing.ok ? "Yes: echo replies come back. IP works both ways." : "No echo replies: suspect the network layer (routes, return path) first.") : need("ping the Server") },
      { k: "port", title: "Which destination port does the application use?", text: "dig sends its query to UDP 53 (DNS). UDP: no handshake, no connection — one datagram out, one back." },
      { k: "syn", title: "Did the query leave the Laptop — and reach the Server?", text: `${qOut ? "The query left the Laptop" : "No query left the Laptop"}${qOut ? `; ${qIn ? "it arrived on the Server's NIC" : "it never arrived at the Server"}` : ""}. (Captures: Laptop eth0, Server eth0.)` },
      { k: "listen", title: "Is anything listening on that port?", text: owner ? `Yes — ${owner} has UDP 53 open (ss -ulnp on the Server).` : "No — nothing has UDP 53 open: a datagram there gets ICMP port unreachable." },
      { k: "answer", title: "Did the Server answer — a DNS response or ICMP port unreachable?", text: resp ? "It sent a DNS response." : unreach ? "It answered ICMP port unreachable: no process owns UDP 53 (dig calls it “connection refused”)." : qIn ? "It received the query and sent nothing back — check its firewall and its routes." : "It never got a query to answer." },
      { k: "return", title: "Did the answer come back to the client?", text: back ? "Yes — the Laptop received it." : resp || unreach ? "No — the answer left the Server but never reached the Laptop." : "Nothing was sent back." },
      { k: "state", title: "What state is each endpoint in?", text: "UDP keeps no connection state: there is nothing to be stuck in. Only the application (dig) decides whether to wait and ask again." },
    ];
  }
  return [
    { k: "ping", title: "Can I reach the host at all (IP)?", text: lastPing ? (lastPing.ok ? "Yes: echo replies come back. IP works both ways." : "No echo replies: suspect the network layer (routes, return path) before TCP.") : need("ping the Server") },
    { k: "port", title: "Which destination port does the application use?", text: lastConn ? `${lastConn.tool} used TCP ${lastConn.port} (${TN_PORT_NAME[lastConn.port ?? 0] ?? "?"}).${lastDig ? " Name lookups use UDP 53." : ""}` : lastDig ? "dig uses UDP 53." : need("reproduce the user's test") },
    { k: "syn", title: "Did the client send its SYN — and did the Server receive it?", text: lastConn ? `${synOut ? "The SYN left the Laptop" : "No SYN left the Laptop"}${synOut ? `; ${synAtServer ? "it arrived on the Server's NIC" : "it never arrived at the Server"}` : ""}. (Captures: Laptop eth0, Server eth0.)` : need("a TCP test, then captures") },
    { k: "listen", title: "Is anything listening on that port?", text: lastConn?.port ? (tnListener(s.cfg, "tcp", lastConn.port) ? `Yes — ${tnListener(s.cfg, "tcp", lastConn.port)} listens on TCP ${lastConn.port} (ss -tlnp on the Server).` : `No — nothing listens on TCP ${lastConn.port}: a SYN there gets RST.`) : need("a TCP test") },
    { k: "answer", title: "Did the Server answer — SYN-ACK or RST?", text: lastConn ? (synAckOut ? "It sent a SYN-ACK." : rstOut ? "It answered RST: refused." : synAtServer ? "It received the SYN and sent nothing back — check its firewall and its routes." : "It never got a SYN to answer.") : need("a TCP test") },
    { k: "return", title: "Did the answer come back to the client?", text: lastConn ? (backAtLaptop ? "Yes — the Laptop received it." : synAckOut ? `No. ${synAckR1In ? `R1 received it on Gi0/1${synAckR1Out ? " and sent it out Gi0/0 — look at the Laptop" : " and never sent it out of Gi0/0: R1 is dropping it"}` : "It never reached R1"}.` : "Nothing was sent back.") : need("a TCP test") },
    { k: "state", title: "What state is each endpoint in?", text: (() => {
      const cl = s.tcbs.filter((t) => t.host === "laptop").map((t) => `${t.local.port}→${t.remote?.port} ${t.state}`);
      const sv = s.tcbs.filter((t) => t.host === "server").map((t) => `${t.remote?.port}→${t.local.port} ${t.state}`);
      return `Laptop: ${cl.join(", ") || "no connections"}. Server: ${sv.join(", ") || "no connections"} (plus its listeners). A Server stuck in SYN-RECV got the SYN, answered, and never heard back.`;
    })() },
  ];
}
