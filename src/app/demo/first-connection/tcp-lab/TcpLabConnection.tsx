"use client";

import { clsx } from "clsx";
import { TCP_LAB_CONNS, byteStream, epText, flagText, recordOutcome, type TcpCaptureRecord, type TcpConnId, type TcpHost, type TcpLabState, type TcpTcb } from "@/lib/sim-engine/scenarios/tcpLab";

/**
 * TCP Lab "Connection" view (TCP-specific): each endpoint's own sockets, the exchange ladder of one connection,
 * and the byte bar of the client→server stream. Everything is derived from the lab model — no invented values.
 */

const HOST_LABEL: Record<TcpHost, string> = { client: "Laptop", server: "Server" };

/** What one endpoint knows about one connection, in its own terms. Only variables the model really has. */
function socketWhy(t: TcpTcb): string {
  if (t.state === "LISTEN") return `A listening socket is not a connection: the Server has said "I accept connections on port ${t.local.port}". A connection (with its own state and sequence numbers) is created only when a SYN arrives for this port.`;
  if (t.error === "refused") return `A RST,ACK arrived whose ACK (${t.sndNxt}) acknowledged this attempt's SYN, so the ${HOST_LABEL[t.host]} accepted it and closed the attempt: the application is told "connection refused". Nothing was lost — the Server answered.`;
  const s = t.state === "SYN-SENT" ? "SYN-SENT: it sent a SYN and has not processed a SYN-ACK." : t.state === "SYN-RECEIVED" ? "SYN-RECEIVED: it received a SYN, sent its SYN-ACK, and waits for that SYN-ACK to be acknowledged." : t.state === "ESTABLISHED" ? "ESTABLISHED: from this endpoint's point of view both sequence spaces are synchronised." : "";
  return `${HOST_LABEL[t.host]}'s own view of this connection. SND.UNA = oldest byte it sent that is not yet acknowledged · SND.NXT = the next sequence number it will use · RCV.NXT = the next byte it expects from the peer (what it puts in its ACK field). ${s}`;
}

/**
 * Socket tables of both hosts (TCP-specific: a connection row needs several values visible at once, so the rows wrap
 * instead of truncating). Row "Why?" ids follow the generic card convention "<card title>:<row key>".
 */
export function TcpSocketCards({ lab, freshKeys, openWhy, onWhy }: { lab: TcpLabState; freshKeys: Set<string>; openWhy?: string; onWhy: (id: string | undefined) => void }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
      {(["client", "server"] as TcpHost[]).map((h) => {
        const title = h === "client" ? "Laptop sockets · 192.168.10.10" : "Server sockets · 10.20.20.20";
        const tcbs = lab.sockets[h];
        return (
          <section key={h} className={clsx("min-w-0 rounded-xl border bg-white/[0.02] p-2.5", tcbs.some((t) => freshKeys.has(`${t.host} ${t.conn ?? "listen"}`)) ? "border-pv-success/50" : "border-pv-border")} aria-label={`${title} table`}>
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <h4 className="text-[11px] font-bold text-pv-text">{title}</h4>
              <span className="pv-mono text-[9.5px] font-semibold tracking-wide text-pv-text-faint">{h === "client" ? "CLIENT VIEW" : "SERVER VIEW"}</span>
            </div>
            {tcbs.length === 0 ? (
              <p className="pv-mono text-[11px] text-pv-text-faint">no sockets — no connection yet</p>
            ) : (
              <ul className="space-y-1">
                {tcbs.map((t) => {
                  const key = `${t.host} ${t.conn ?? "listen"}`;
                  const id = `${title}:${key}`;
                  const fresh = freshKeys.has(key);
                  const ends = t.state === "LISTEN" ? `*:${t.local.port}` : `${epText(t.local)} ↔ ${t.remote ? epText(t.remote) : "*"}`;
                  const stateText = t.error === "refused" ? "CLOSED (refused)" : t.state;
                  const primary = `${ends} · ${stateText}`;
                  const vars: [string, number | undefined][] = [
                    ["ISS", t.iss],
                    ["SND.UNA", t.sndUna],
                    ["SND.NXT", t.sndNxt],
                    ["IRS", t.irs],
                    ["RCV.NXT", t.rcvNxt],
                  ];
                  return (
                    <li key={id} className={clsx("rounded-md px-1.5 py-1", fresh ? "bg-pv-success/10 ring-1 ring-pv-success/40" : "bg-black/20")}>
                      <div className="flex items-start justify-between gap-1">
                        <p className="min-w-0 pv-mono text-[10.5px] leading-tight text-pv-text">
                          <span className="[overflow-wrap:anywhere]">{ends}</span> <span className={clsx("whitespace-nowrap rounded px-1 font-bold", t.state === "ESTABLISHED" ? "bg-pv-success/15 text-pv-success" : t.error === "refused" ? "bg-pv-danger/15 text-pv-danger" : "bg-pv-tcp/15 text-pv-tcp")}>{stateText}</span>
                        </p>
                        <button type="button" aria-expanded={openWhy === id} aria-label={`Why does ${title} have ${primary}?`} onClick={() => onWhy(openWhy === id ? undefined : id)} className="shrink-0 rounded px-1 text-[10px] font-semibold text-pv-text-faint hover:text-pv-cyan-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-cyan">
                          Why?
                        </button>
                      </div>
                      {t.state === "LISTEN" ? (
                        <p className="pv-mono text-[10.5px] text-pv-cyan-soft">waiting for a SYN — no connection yet</p>
                      ) : (
                        <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 pv-mono text-[10.5px]">
                          {vars
                            .filter(([, v]) => v !== undefined)
                            .map(([k, v]) => (
                              <span key={k} className="text-pv-cyan-soft">
                                <span className="text-pv-text-faint">{k}</span> {v}
                              </span>
                            ))}
                        </div>
                      )}
                      {t.unacked.length > 0 && <p className="pv-mono text-[10px] text-pv-warning">waiting for ACK of {t.unacked.map((u) => (u.payload ? `${u.seq}–${u.seq + u.payload.length - 1}` : `${u.seq} (${flagText(u.flags)})`)).join(", ")}</p>}
                      {t.delivered && <p className="pv-mono text-[10px] text-pv-success">application received “{t.delivered}”</p>}
                      {fresh && <p className="mt-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-pv-success">Changed by this event</p>}
                      {openWhy === id && (
                        <p className="mt-1 border-l-2 border-pv-cyan/40 pl-1.5 text-[10.5px] leading-snug text-pv-text-muted">
                          <span className="block font-semibold text-pv-cyan-soft">What does this mean?</span>
                          {socketWhy(t)}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** State change caused by processing a delivered record (mirrors the model's rules for the first such segment). */
function stateNote(rec: TcpCaptureRecord, firstOfKind: boolean): string | undefined {
  if (rec.outcome !== "delivered" || !firstOfKind) return undefined;
  const f = rec.seg.flags;
  if (f.includes("RST")) return "Laptop: SYN-SENT → CLOSED (refused)";
  if (f.includes("SYN") && !f.includes("ACK")) return rec.seg.dst.port === TCP_LAB_CONNS.refused.serverPort ? undefined : "Server: → SYN-RECEIVED";
  if (f.includes("SYN") && f.includes("ACK")) return "Laptop: SYN-SENT → ESTABLISHED";
  if (f.join() === "ACK" && rec.dir === "c2s") return "Server: SYN-RECEIVED → ESTABLISHED";
  return undefined;
}

/**
 * Exchange ladder for one connection: Laptop on the left, Server on the right, one row per segment in time order.
 * `concealFault` hides where an incident segment stopped (the learner proves that from the captures).
 */
export function TcpLadder({ lab, conn, selectedNo, onSelect, concealFault }: { lab: TcpLabState; conn: TcpConnId; selectedNo?: number; onSelect: (no: number) => void; concealFault: boolean }) {
  const recs = lab.capture.filter((r) => r.conn === conn);
  const seenKinds = new Set<string>();
  if (!recs.length) return <p className="text-[11px] text-pv-text-faint">No segments yet for the {TCP_LAB_CONNS[conn].label}.</p>;
  return (
    <ol className="space-y-1" aria-label={`Exchange ladder · ${TCP_LAB_CONNS[conn].label}`}>
      <li className="flex justify-between px-1 text-[10px] font-bold uppercase tracking-wide text-pv-text-faint">
        <span>Laptop :{TCP_LAB_CONNS[conn].clientPort}</span>
        <span>Server :{TCP_LAB_CONNS[conn].serverPort}</span>
      </li>
      {recs.map((r) => {
        const outcome = recordOutcome(lab, r);
        const hidden = concealFault && r.drop?.reason === "return-path-fault";
        const kind = `${r.dir}|${r.seg.flags.join()}|${r.seg.payload ? "d" : ""}`;
        const note = outcome === "delivered" ? stateNote(r, !seenKinds.has(kind)) : undefined;
        if (outcome === "delivered") seenKinds.add(kind);
        const c2s = r.dir === "c2s";
        const label = `${flagText(r.seg.flags)}  seq=${r.seg.seq}${r.seg.ack !== undefined ? ` ack=${r.seg.ack}` : ""}${r.seg.payload ? ` len=${r.seg.payload.length}` : ""}`;
        const fate = outcome === "in-flight" ? "in flight…" : hidden ? "sent — did it arrive?" : outcome === "dropped" ? "✕ lost at R1" : "delivered";
        return (
          <li key={r.no}>
            <button
              type="button"
              onClick={() => onSelect(r.no)}
              aria-label={`Segment ${r.no}: ${label}, ${fate}`}
              className={clsx("w-full rounded-lg border px-2 py-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-cyan", selectedNo === r.no ? "border-pv-cyan/60 bg-pv-cyan/10" : "border-pv-border hover:bg-white/[0.03]")}
            >
              <span className={clsx("block pv-mono text-[11px] text-pv-text", c2s ? "text-left" : "text-right")}>
                #{r.no} {label}
                {r.retransmission && <span className="ml-1 rounded bg-pv-warning/15 px-1 text-[9.5px] font-bold text-pv-warning">RETRANSMISSION</span>}
              </span>
              <span className={clsx("flex items-center gap-1 text-[10.5px]", c2s ? "" : "flex-row-reverse")}>
                <span className={clsx("h-px flex-1", outcome === "dropped" && !hidden ? "bg-pv-danger" : "bg-pv-tcp")} />
                <span className={clsx("shrink-0", outcome === "dropped" && !hidden ? "text-pv-danger" : "text-pv-text-faint")}>{c2s ? `${fate} ►` : `◄ ${fate}`}</span>
              </span>
              {note && <span className={clsx("block text-[10.5px] font-semibold text-pv-success", c2s ? "text-right" : "text-left")}>{note}</span>}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Byte bar for the Laptop → Server stream of one connection. Sequence number ISS is the SYN (it carries no byte);
 * data bytes start at ISS+1. Each cell is one byte: acknowledged / sent, not yet acknowledged; markers show the
 * client's SND.UNA and SND.NXT and the server's RCV.NXT (= the ACK it will send).
 */
export function TcpByteBar({ lab, conn }: { lab: TcpLabState; conn: TcpConnId }) {
  const b = byteStream(lab, conn);
  if (!b || b.sndNxt <= b.iss + 1) return null;
  // Every byte the client ever sent, rebuilt from its own transmissions (first copy of each sequence number).
  const bytes = new Map<number, string>();
  lab.capture.filter((r) => r.conn === conn && r.dir === "c2s" && r.seg.payload).forEach((r) => [...r.seg.payload].forEach((ch, i) => !bytes.has(r.seg.seq + i) && bytes.set(r.seg.seq + i, ch)));
  const cells = [{ n: b.iss, ch: "SYN", kind: "syn" as const }, ...Array.from({ length: b.sndNxt - b.iss - 1 }, (_, i) => b.iss + 1 + i).map((n) => ({ n, ch: bytes.get(n) ?? "?", kind: n < b.sndUna ? ("acked" as const) : ("unacked" as const) }))];
  return (
    <figure className="rounded-xl border border-pv-border p-2" aria-label="Byte stream, Laptop to Server">
      <figcaption className="mb-1 text-[10px] font-bold uppercase tracking-wide text-pv-text-faint">Laptop → Server byte stream (sequence space)</figcaption>
      <div className="flex flex-wrap gap-0.5">
        {cells.map((c) => (
          <div key={c.n} className={clsx("flex w-[30px] flex-col items-center rounded border py-0.5", c.kind === "syn" ? "border-pv-tcp/50 bg-pv-tcp/10" : c.kind === "acked" ? "border-pv-success/50 bg-pv-success/10" : "border-pv-warning/60 bg-pv-warning/10")}>
            <span className="pv-mono text-[9px] text-pv-text-faint">{c.n}</span>
            <span className={clsx("pv-mono text-[11px] font-bold", c.kind === "syn" ? "text-[8.5px] text-pv-tcp" : "text-pv-text")}>{c.ch}</span>
          </div>
        ))}
        <div className="flex w-[30px] flex-col items-center rounded border border-dashed border-pv-border py-0.5">
          <span className="pv-mono text-[9px] text-pv-text-faint">{b.sndNxt}</span>
          <span className="text-[9px] text-pv-text-faint">next</span>
        </div>
      </div>
      <dl className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-[10.5px]">
        <dt className="pv-mono text-pv-text-faint">SND.UNA {b.sndUna}</dt>
        <dd className="text-pv-text-muted">client: oldest byte not yet acknowledged{b.sndUna === b.sndNxt ? " (everything sent is acknowledged)" : ""}</dd>
        <dt className="pv-mono text-pv-text-faint">SND.NXT {b.sndNxt}</dt>
        <dd className="text-pv-text-muted">client: sequence number of its next new byte</dd>
        {b.serverRcvNxt !== undefined && (
          <>
            <dt className="pv-mono text-pv-text-faint">RCV.NXT {b.serverRcvNxt}</dt>
            <dd className="text-pv-text-muted">server: next byte it expects — the value it puts in its ACK</dd>
          </>
        )}
      </dl>
      <p className="mt-1 flex flex-wrap gap-2 text-[10px] text-pv-text-faint">
        <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-pv-success/50" />acknowledged</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-pv-warning/60" />sent, not acknowledged</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-pv-tcp/50" />SYN (one sequence number, no data)</span>
      </p>
    </figure>
  );
}

