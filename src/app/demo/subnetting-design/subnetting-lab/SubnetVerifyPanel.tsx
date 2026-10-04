"use client";

import type { ReactNode } from "react";
import { clsx } from "clsx";
import { PARENT, maskOf } from "@/lib/sim-engine/scenarios/subnettingDesign";
import { dotOct, freeSpace, incidentSymptom, octetBits, overlapMatrix, planReport, rangeLabel, type SlRule, type SlState } from "@/lib/sim-engine/scenarios/subnettingLab";
import { SEG_COLOR, SEG_SHORT } from "./SubnetRuler";

/**
 * Verify tab: rules checklist, overlap matrix, free space (ranges → aligned blocks), the binary/alignment view, the
 * incident's own-mask symptom and the final verification. All values are read from the lab model. During the
 * concealed part of the incident the matrix and free-space views stay closed (they would show the real blocks).
 */

const Box = ({ id, title, children, note }: { id: string; title: string; children: ReactNode; note?: ReactNode }) => (
  <section id={id} aria-label={title} className="rounded-xl border border-pv-border p-2.5">
    <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-pv-text-faint">{title}</p>
    {children}
    {note && <p className="mt-1.5 text-[10.5px] text-pv-text-faint">{note}</p>}
  </section>
);

/** Last octet in binary, split at the prefix boundary, with the AND against the mask. Wraps on phones. */
export function BinaryBar({ ip, prefix, label }: { ip: string; prefix: number; label?: string }) {
  const b = octetBits(ip, prefix);
  const cell = (bit: string, net: boolean, i: number) => (
    <span key={i} className={clsx("flex h-6 w-6 items-center justify-center rounded border pv-mono text-[12px] font-bold", net ? "border-pv-violet/50 bg-pv-violet/10 text-pv-violet" : "border-pv-success/50 bg-pv-success/10 text-pv-success")}>
      {bit}
    </span>
  );
  const maskBits = b.maskOctet.toString(2).padStart(8, "0");
  const andBits = b.anded.toString(2).padStart(8, "0");
  const hostZero = /^0*$/.test(b.host);
  return (
    <figure className="space-y-1" aria-label={`${ip}/${prefix}: last octet ${b.bits}, network bits ${b.net}, host bits ${b.host}; AND ${maskOf(prefix)} gives ${b.anded}`}>
      {label && <figcaption className="text-[11px] font-semibold text-pv-text">{label}</figcaption>}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="w-[86px] shrink-0 pv-mono text-[11px] text-pv-text-muted">{dotOct(ip)}</span>
        <span className="flex gap-0.5">{b.bits.split("").map((x, i) => cell(x, i < b.net.length, i))}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="w-[86px] shrink-0 pv-mono text-[11px] text-pv-text-faint">mask .{b.maskOctet}</span>
        <span className="flex gap-0.5">
          {maskBits.split("").map((x, i) => (
            <span key={i} className="flex h-6 w-6 items-center justify-center rounded border border-pv-border pv-mono text-[12px] text-pv-text-faint">
              {x}
            </span>
          ))}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="w-[86px] shrink-0 pv-mono text-[11px] text-pv-text">AND = .{b.anded}</span>
        <span className="flex gap-0.5">{andBits.split("").map((x, i) => cell(x, i < b.net.length, i))}</span>
      </div>
      <p className="text-[11px] leading-snug text-pv-text-muted">
        <span className="text-pv-violet">{b.net.length} network bits</span> in this octet · <span className="text-pv-success">{b.host.length} host bits</span>: {b.host} — {hostZero ? "all 0, so this is a network address." : "not all 0, so this is a host address, not a network address."}
      </p>
    </figure>
  );
}

const RULE_LABEL: Record<SlRule, string> = { alignment: "Aligned to its block size", capacity: "Big enough for its requirement", containment: `Inside ${PARENT.network}/${PARENT.prefix}`, overlap: "No overlap (real CIDR blocks)" };

export interface VerifyPanelProps {
  lab: SlState;
  conceal: boolean;
  binary?: { ip: string; prefix: number; label: string };
  /** The aligned-block split of the free space stays closed until it can no longer answer an open prediction. */
  showFreeBlocks: boolean;
  onRunCheck?: (rule: SlRule) => void;
}

export function SubnetVerifyPanel({ lab, conceal, binary, showFreeBlocks, onRunCheck }: VerifyPanelProps) {
  const live = planReport(lab.rows);
  const m = overlapMatrix(lab.rows);
  const space = freeSpace(lab.rows);
  const incident = lab.incident.active;
  const sym = incident ? incidentSymptom(lab.rows) : undefined;
  const ruleOk: Record<SlRule, boolean> = { alignment: live.aligned, capacity: live.capacity, containment: live.inside, overlap: live.noOverlap };
  const report = lab.report;
  const reportFresh = report && lab.reportSeq === lab.seq;

  return (
    <div className="space-y-2.5">
      <Box
        id="sl-rules"
        title={incident && conceal ? "Rule checks · run each one" : "Rules checklist"}
        note={incident && conceal ? "Each check reads the written plan. Results appear only after you run it." : report ? (reportFresh ? `From “Run plan checks” (event ${lab.reportSeq}).` : "The plan changed since the last “Run plan checks” — the live status below is current.") : "Live status of the current plan."}
      >
        <ul className="space-y-1">
          {(Object.keys(RULE_LABEL) as SlRule[]).map((r) => {
            const run = lab.incident.rulesRun.includes(r);
            // Nothing placed yet: a rule has nothing to judge, so show it as pending rather than a vacuous ✓.
            const hidden = (incident && conceal && !run) || (!incident && live.checks.length === 0);
            return (
              <li key={r} className="flex flex-wrap items-center gap-2 text-[12px]">
                <span aria-hidden className={clsx("flex h-4 w-4 items-center justify-center rounded-full border text-[10px]", hidden ? "border-pv-border text-pv-text-faint" : ruleOk[r] ? "border-pv-success bg-pv-success/20 text-pv-success" : "border-pv-danger bg-pv-danger/20 text-pv-danger")}>
                  {hidden ? "?" : ruleOk[r] ? "✓" : "✕"}
                </span>
                <span className={hidden ? "text-pv-text-muted" : "text-pv-text"}>{RULE_LABEL[r]}</span>
                {hidden ? (
                  onRunCheck && incident && (
                    <button type="button" onClick={() => onRunCheck(r)} className="rounded-full border border-pv-cyan/50 px-2 py-0.5 text-[11px] font-semibold text-pv-cyan-soft hover:bg-pv-cyan/10">
                      Run check
                    </button>
                  )
                ) : (
                  <span className="sr-only">{ruleOk[r] ? "passes" : "fails"}</span>
                )}
              </li>
            );
          })}
          {!incident && (
            <li className="flex items-center gap-2 text-[12px]">
              <span aria-hidden className={clsx("flex h-4 w-4 items-center justify-center rounded-full border text-[10px]", live.allPlaced ? "border-pv-success bg-pv-success/20 text-pv-success" : "border-pv-border text-pv-text-faint")}>
                {live.allPlaced ? "✓" : "·"}
              </span>
              <span className="text-pv-text">Every requirement placed{live.unplaced.length ? ` (missing ${live.unplaced.join(", ")})` : ""}</span>
            </li>
          )}
        </ul>
        {!conceal && live.oversized.length > 0 && <p className="mt-1.5 text-[11px] text-pv-warning">Advisory: {live.oversized.join(", ")} bigger than necessary (still valid).</p>}
        {!conceal && (
          <p className={clsx("mt-1.5 text-[12px] font-semibold", live.allValid ? "text-pv-success" : "text-pv-text-muted")}>
            {live.allValid ? "All rules pass — a valid plan." : "Not a valid plan yet."} <span className="font-normal text-pv-text-faint">{space.allocated}/{space.total} addresses allocated.</span>
          </p>
        )}
      </Box>

      <Box id="sl-matrix" title="Overlap matrix (real CIDR blocks)">
        {conceal ? (
          <p className="text-[11.5px] text-pv-text-muted">Closed until the mask is applied: the matrix compares the REAL blocks, which you have not calculated yet.</p>
        ) : m.ids.length < 2 ? (
          <p className="text-[11.5px] text-pv-text-muted">Place at least two blocks to compare them.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="text-[10.5px]" aria-label="Pairwise overlap">
                <thead>
                  <tr>
                    <th />
                    {m.ids.map((id) => (
                      <th key={id} className="h-7 w-11 font-bold" style={{ color: SEG_COLOR[id] }}>
                        {SEG_SHORT[id]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {m.ids.map((a) => (
                    <tr key={a}>
                      <th className="pr-1.5 text-left font-bold" style={{ color: SEG_COLOR[a] }}>
                        {SEG_SHORT[a]}
                      </th>
                      {m.ids.map((b) => {
                        const cell = m.cells.find((c) => (c.a === a && c.b === b) || (c.a === b && c.b === a));
                        return (
                          <td key={b} className={clsx("h-9 w-11 border border-pv-border/60 text-center pv-mono", a === b ? "bg-pv-bg-elevated/60 text-pv-text-faint" : cell?.overlap ? "bg-pv-danger/15 font-bold text-pv-danger" : "text-pv-success")}>
                            {a === b ? "—" : cell?.overlap ? "✕" : "✓"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="mt-1.5 space-y-0.5 text-[11px]">
              {m.cells.filter((c) => c.overlap).map((c) => (
                <li key={`${c.a}-${c.b}`} className="text-pv-danger">
                  {c.a} ∩ {c.b}: shared <span className="pv-mono">{rangeLabel(c.shared!)}</span>
                </li>
              ))}
              {!m.cells.some((c) => c.overlap) && <li className="text-pv-success">No two blocks share an address (touching ranges such as .191 / .192 are not an overlap).</li>}
            </ul>
          </>
        )}
      </Box>

      <Box id="sl-free" title="Free space">
        {conceal ? (
          <p className="text-[11.5px] text-pv-text-muted">Closed until the mask is applied.</p>
        ) : (
          <>
            <p className="text-[11.5px] text-pv-text-muted">
              {space.free} of {space.total} addresses free{space.ranges.length ? ":" : "."}
            </p>
            <ul className="mt-1 space-y-1">
              {space.ranges.map((f) => (
                <li key={f.first} className="text-[11.5px]">
                  <span className="pv-mono text-pv-text">{rangeLabel(f)}</span> <span className="text-pv-text-faint">({f.last - f.first + 1} addresses — a range, not a subnet)</span>
                  {showFreeBlocks && <span className="block pv-mono text-[11px] text-pv-text-muted">= {f.blocks.map((b) => `${dotOct(b.network)}/${b.prefix}`).join(" + ")}</span>}
                </li>
              ))}
            </ul>
          </>
        )}
      </Box>

      {binary && (
        <Box id="sl-binary" title="Binary / alignment">
          <BinaryBar ip={binary.ip} prefix={binary.prefix} label={binary.label} />
        </Box>
      )}

      {sym && (
        <Box id="sl-symptom" title="Symptom · the LAN-B host's own-mask decision">
          {conceal && !lab.incident.maskApplied ? (
            <p className="text-[11.5px] leading-snug text-pv-text-muted">
              A LAN-B host at <span className="pv-mono">{sym.host}</span> (gateway <span className="pv-mono">{sym.gateway}</span>) cannot reach the LAN-C host <span className="pv-mono">{sym.server}</span>. Its traffic to LAN-A works.
            </p>
          ) : (
            <p className={clsx("text-[11.5px] leading-snug", sym.decision.local ? "text-pv-danger" : "text-pv-success")}>
              <span className="pv-mono">{sym.host}</span> AND {maskOf(sym.decision.prefix)} = <span className="pv-mono">{sym.decision.srcNet}</span> · <span className="pv-mono">{sym.server}</span> AND {maskOf(sym.decision.prefix)} = <span className="pv-mono">{sym.decision.dstNet}</span> → <b>{sym.decision.local ? "LOCAL" : "REMOTE"}</b>
              <span className="block text-pv-text-muted">{sym.decision.local ? `The host treats ${sym.server} as on its own link and never uses its gateway ${sym.gateway}, so it cannot reach LAN-C.` : `Different networks: the host sends to its gateway ${sym.gateway}, as it should.`}</span>
            </p>
          )}
        </Box>
      )}

      {incident && lab.incident.resolved && (
        <Box id="sl-final" title="Final verification">
          <p className="text-[12px] font-semibold text-pv-success">Plan valid (all rules pass) and the symptom is gone: the cross-LAN decision is REMOTE via the gateway.</p>
        </Box>
      )}
    </div>
  );
}
