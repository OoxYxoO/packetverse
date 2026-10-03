"use client";

import { clsx } from "clsx";
import { LabPacketFields } from "@/components/practice-lab/LabPacketFields";
import { epText, flagText, recordOutcome, tcpLabPacket, visiblePoints, type TcpCapturePoint, type TcpCaptureRecord, type TcpLabState } from "@/lib/sim-engine/scenarios/tcpLab";

/**
 * TCP Lab "Capture" view (TCP-specific): an educational packet-capture record, not a Wireshark clone.
 * Each capture point lists only the segments that actually crossed it — that is what makes it evidence.
 * "All points" is the lab's own view of every segment and its outcome.
 */

export type TcpCaptureView = "all" | TcpCapturePoint;
export const CAPTURE_VIEWS: { id: TcpCaptureView; label: string; hint: string }[] = [
  { id: "laptop", label: "Laptop", hint: "what the Laptop sent and received" },
  { id: "r1-lan", label: "R1 · LAN side", hint: "R1's interface toward the Laptop (192.168.10.1)" },
  { id: "r1-server", label: "R1 · Server side", hint: "R1's interface toward the Server (10.20.20.1)" },
  { id: "server", label: "Server", hint: "what the Server received and sent" },
  { id: "all", label: "All (lab view)", hint: "every segment the lab created, with its outcome" },
];

/** Which link's frame a capture point shows for a record (see tcpLabPacket: link 0 = the sender's link). */
export function linkAt(rec: TcpCaptureRecord, point: TcpCaptureView): number {
  if (point === "all") return 0;
  if (rec.dir === "c2s") return point === "laptop" ? 0 : point === "r1-lan" ? 1 : 2;
  return point === "server" || point === "r1-server" ? 0 : point === "r1-lan" ? 1 : 2;
}

/** Does `rec` belong in this capture point's list (as of now — an in-flight segment appears hop by hop)? */
export const capturedAt = (lab: TcpLabState, rec: TcpCaptureRecord, point: TcpCaptureView) => point === "all" || visiblePoints(lab, rec).includes(point);

/** Direction as seen from a capture point. */
function dirText(rec: TcpCaptureRecord, point: TcpCaptureView) {
  if (point === "laptop") return rec.dir === "c2s" ? "out" : "in";
  if (point === "server") return rec.dir === "c2s" ? "in" : "out";
  if (point === "r1-lan") return rec.dir === "c2s" ? "in" : "out";
  if (point === "r1-server") return rec.dir === "c2s" ? "out" : "in";
  return rec.dir === "c2s" ? "L→S" : "S→L";
}

export function TcpCapture({
  lab,
  view,
  onView,
  selectedNo,
  onSelect,
  concealFault,
}: {
  lab: TcpLabState;
  view: TcpCaptureView;
  onView: (v: TcpCaptureView) => void;
  selectedNo?: number;
  onSelect: (no: number | undefined) => void;
  /** Hide the lab-view outcome of incident segments until the learner has proven where they stopped. */
  concealFault: boolean;
}) {
  const rows = lab.capture.filter((r) => capturedAt(lab, r, view));
  const sel = selectedNo !== undefined ? lab.capture[selectedNo - 1] : undefined;
  const selVisible = sel && capturedAt(lab, sel, view);
  const outcomeText = (r: TcpCaptureRecord) => {
    const o = recordOutcome(lab, r);
    if (o === "in-flight") return "in flight";
    if (o === "dropped") return concealFault && r.drop?.reason === "return-path-fault" ? "—" : `dropped at R1 (${r.drop?.reason === "lab-loss" ? "lab loss" : "fault"})`;
    return "delivered";
  };
  return (
    <div className="space-y-2">
      <div role="radiogroup" aria-label="Capture point" className="flex flex-wrap gap-1">
        {CAPTURE_VIEWS.map((v) => (
          <button key={v.id} type="button" role="radio" aria-checked={view === v.id} title={v.hint} onClick={() => onView(v.id)} className={clsx("rounded-full border px-2.5 py-0.5 text-[11px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-cyan", view === v.id ? "border-pv-cyan/60 bg-pv-cyan/10 text-pv-cyan-soft" : "border-pv-border text-pv-text-muted hover:text-pv-text")}>
            {v.label}
          </button>
        ))}
      </div>
      <p className="text-[10.5px] text-pv-text-faint">{CAPTURE_VIEWS.find((v) => v.id === view)?.hint}. Select a row to open its fields.</p>
      <div className="overflow-x-auto rounded-xl border border-pv-border">
        <table className="w-full border-collapse pv-mono text-[10.5px] sm:min-w-[520px]" aria-label={`Capture at ${CAPTURE_VIEWS.find((v) => v.id === view)?.label}`}>
          <thead className="bg-white/[0.03] text-left text-pv-text-faint">
            <tr>
              {/* Phones get one compact "Ports" column instead of full Src/Dst, so Flags/Seq/Ack stay in view. */}
              {[["No.", ""], ["Dir", ""], ["Ports", "sm:hidden"], ["Src", "hidden sm:table-cell"], ["Dst", "hidden sm:table-cell"], ["Flags", ""], ["Seq", ""], ["Ack", ""], ["Len", ""], ...(view === "all" ? [["Outcome", ""]] : [])].map(([h, cls]) => (
                <th key={h} className={clsx("px-1.5 py-1 font-semibold", cls)}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-2 py-2 font-sans text-pv-text-faint">
                  Nothing captured here yet.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.no} onClick={() => onSelect(r.no)} className={clsx("cursor-pointer border-t border-pv-border", selectedNo === r.no ? "bg-pv-cyan/10" : "hover:bg-white/[0.03]")}>
                <td className="px-1.5 py-1">
                  <button type="button" onClick={(e) => (e.stopPropagation(), onSelect(r.no))} aria-label={`Open segment ${r.no}`} className="text-pv-cyan-soft underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-cyan">
                    {r.no}
                  </button>
                </td>
                <td className="px-1.5 py-1 text-pv-text-faint">{dirText(r, view)}</td>
                <td className="px-1.5 py-1 text-pv-text-muted sm:hidden">
                  :{r.seg.src.port}→:{r.seg.dst.port}
                </td>
                <td className="hidden px-1.5 py-1 text-pv-text-muted sm:table-cell">{epText(r.seg.src)}</td>
                <td className="hidden px-1.5 py-1 text-pv-text-muted sm:table-cell">{epText(r.seg.dst)}</td>
                <td className="px-1.5 py-1 text-pv-text">
                  {flagText(r.seg.flags)}
                  {r.retransmission && <span className="ml-1 font-sans text-[9.5px] font-bold text-pv-warning">[RTX]</span>}
                </td>
                <td className="px-1.5 py-1 text-pv-text">{r.seg.seq}</td>
                <td className="px-1.5 py-1 text-pv-text">{r.seg.ack ?? "—"}</td>
                <td className="px-1.5 py-1 text-pv-text">{r.seg.payload.length}</td>
                {view === "all" && <td className={clsx("px-1.5 py-1 font-sans", r.outcome === "dropped" && outcomeText(r) !== "—" ? "text-pv-danger" : "text-pv-text-muted")}>{outcomeText(r)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sel && selVisible && (
        <div className="relative rounded-xl border border-pv-border bg-pv-bg-elevated/80 p-2.5">
          <button type="button" onClick={() => onSelect(undefined)} aria-label="Close segment fields" className="absolute right-2 top-1.5 text-pv-text-faint hover:text-pv-text">
            ×
          </button>
          <p className="mb-1.5 pr-5 text-[12px] font-semibold text-pv-text">
            Segment #{sel.no} {view === "all" ? "as it left its sender" : `as captured at ${CAPTURE_VIEWS.find((v) => v.id === view)?.label}`}
            {sel.retransmission && <span className="ml-1.5 text-[11px] font-normal text-pv-warning">· retransmission of the same bytes</span>}
          </p>
          <LabPacketFields packet={tcpLabPacket(sel, linkAt(sel, view))} notes={fieldNotes(sel)} />
        </div>
      )}
    </div>
  );
}

/** Short notes tying the fields to sequence/acknowledgment arithmetic. */
export function fieldNotes(r: TcpCaptureRecord): Record<string, string> {
  const g = r.seg;
  const notes: Record<string, string> = {};
  if (g.flags.includes("SYN")) notes.Sequence = `ISN — the SYN itself uses ${g.seq}; the next number is ${g.seq + 1}`;
  else if (g.payload) notes.Sequence = `first data byte; this segment carries ${g.seq}–${g.seq + g.payload.length - 1}`;
  else notes.Sequence = "carries no bytes, so the next segment uses the same number";
  if (g.ack !== undefined) notes.Acknowledgment = g.flags.includes("RST") ? `= SYN seq + 1: acknowledges the refused SYN` : `next byte this sender expects from its peer`;
  else notes.Acknowledgment = "ACK flag clear — nothing is acknowledged yet";
  if (g.flags.includes("RST")) notes.Flags = "reset: the Server's TCP refuses — nothing listens on this port";
  return notes;
}
