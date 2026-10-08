"use client";

import { clsx } from "clsx";
import { useState } from "react";
import type { DlNode, DlState } from "@/lib/sim-engine/scenarios/dhcpDnsLab";
import { nextStage, stagesOf, type Change, type Stage } from "./verify";

/**
 * "Did it really work?" Every change the student made, with the five confirmations an engineer looks for. A stage
 * is ticked only by evidence (what the device reported, what the student checked, what traffic did). Unconfirmed
 * stages ask a question; the way to answer it is one more click away. Nothing here says what is wrong.
 */

const MARK: Record<Stage["state"], { icon: string; cls: string; word: string }> = {
  ok: { icon: "✓", cls: "border-pv-success/60 bg-pv-success/15 text-pv-success", word: "confirmed" },
  bad: { icon: "✕", cls: "border-pv-danger/60 bg-pv-danger/15 text-pv-danger", word: "evidence says no" },
  wait: { icon: "○", cls: "border-pv-border text-pv-text-faint", word: "not confirmed yet" },
  claimed: { icon: "?", cls: "border-pv-warning/60 bg-pv-warning/10 text-pv-warning", word: "reported, not proven" },
};
const SHORT = ["Accepted", "Active", "On device", "Traffic", "Service"];

function Pills({ st, small }: { st: Stage[]; small?: boolean }) {
  return (
    <ol className="flex flex-wrap items-center gap-1" aria-label="Confirmation stages">
      {st.map((s, i) => (
        <li key={s.n} className="flex items-center gap-1">
          <span title={`${s.label}: ${MARK[s.state].word} · ${s.seen}`} className={clsx("inline-flex items-center gap-1 rounded-full border font-semibold", small ? "px-1.5 text-[10.5px]" : "px-2 py-0.5 text-[11px]", MARK[s.state].cls)}>
            <span aria-hidden>{MARK[s.state].icon}</span>
            {SHORT[i]}
            <span className="sr-only">: {MARK[s.state].word}</span>
          </span>
          {i < st.length - 1 && <span className="text-[10px] text-pv-text-faint" aria-hidden>→</span>}
        </li>
      ))}
    </ol>
  );
}

function Ask({ s }: { s: Stage }) {
  const [how, setHow] = useState(false);
  if (!s.ask) return null;
  return (
    <div className="rounded-lg border border-pv-violet/40 bg-pv-violet/[0.05] px-2 py-1.5">
      <p className="text-[12.5px] text-pv-text">
        <b className="text-pv-violet">{s.label.replace(/\?$/, "")}?</b> {s.ask}
      </p>
      {how ? <p className="mt-0.5 text-[12px] text-pv-text-muted">{s.how}</p> : s.how && (
        <button type="button" onClick={() => setHow(true)} className="mt-0.5 text-[11.5px] font-semibold text-pv-cyan-soft hover:underline">
          How could I check?
        </button>
      )}
    </div>
  );
}

function Entry({ c, lab, onDevice }: { c: Change; lab: DlState; onDevice: (n: DlNode) => void }) {
  const st = stagesOf(c, lab);
  const nx = nextStage(st);
  const [open, setOpen] = useState(false);
  return (
    <li className={clsx("space-y-1.5 rounded-xl border p-2", !nx ? "border-pv-success/45" : st.some((s) => s.state === "bad") ? "border-pv-danger/40" : "border-pv-border")}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <button type="button" onClick={() => onDevice(c.device)} className="rounded-md border border-pv-border px-1.5 text-[11.5px] font-bold text-pv-text hover:border-pv-violet" title="Show it on the topology">
          {c.device}
        </button>
        <span className="min-w-0 flex-1 break-words pv-mono text-[11.5px] text-pv-text-muted">{c.lines.length > 2 ? `${c.lines.length} edits · last: ${c.lines[c.lines.length - 1]}` : c.lines.join(" · ")}</span>
      </div>
      <Pills st={st} />
      {nx ? (
        <>
          <p className="text-[12px] text-pv-text-muted">
            <b className="text-pv-text">{nx.label}:</b> {nx.seen}
          </p>
          <Ask key={`${c.id}-${nx.n}`} s={nx} />
        </>
      ) : (
        <p className="text-[12px] text-pv-success">Confirmed all the way: the device accepted it, runs it, you saw it on the device, traffic shows it, and the service works.</p>
      )}
      <button type="button" onClick={() => setOpen(!open)} className="text-[11px] text-pv-text-faint hover:text-pv-text">
        {open ? "Hide the evidence" : "What counts as evidence for each stage?"}
      </button>
      {open && (
        <ul className="space-y-0.5 text-[11.5px]">
          {st.map((s) => (
            <li key={s.n} className="text-pv-text-muted">
              <span className={clsx("font-semibold", s.state === "ok" ? "text-pv-success" : s.state === "bad" ? "text-pv-danger" : s.state === "claimed" ? "text-pv-warning" : "text-pv-text-faint")}>
                {MARK[s.state].icon} {s.n}. {s.label}
              </span>{" "}
              · {s.seen}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function Journal({ lab, journal, onDevice }: { lab: DlState; journal: Change[]; onDevice: (n: DlNode) => void }) {
  const live = journal.filter((c) => !c.closed).reverse();
  const old = journal.filter((c) => c.closed);
  return (
    <section aria-label="Change journal" className="min-w-0 space-y-1.5 rounded-xl border border-pv-cyan/30 p-2.5">
      <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-pv-cyan-soft">Change journal · did it really work?</p>
      {live.length === 0 ? (
        <p className="text-[12.5px] text-pv-text-muted">Each change you make on a device appears here. A device accepting a command only means the syntax was right. A change is done when it is active, you have seen it on the device, traffic shows it, and the service works.</p>
      ) : (
        <ul className="space-y-1.5">
          {live.map((c) => (
            <Entry key={c.id} c={c} lab={lab} onDevice={onDevice} />
          ))}
        </ul>
      )}
      {old.length > 0 && <p className="text-[11px] text-pv-text-faint">{old.length} earlier change(s) replaced by newer ones on the same device.</p>}
    </section>
  );
}

/** The same confirmation for the device whose window this is: its latest change, at a glance. */
export function VerifyStrip({ lab, journal, node }: { lab: DlState; journal: Change[]; node: string }) {
  const c = [...journal].reverse().find((x) => x.device === node && !x.closed);
  if (!c) return null;
  const st = stagesOf(c, lab);
  const nx = nextStage(st);
  return (
    <div className="space-y-1 border-b border-pv-border bg-pv-bg/80 px-2.5 py-1.5" aria-label={`${node}: last change`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[10.5px] font-bold uppercase tracking-wide text-pv-text-faint">Last change</span>
        <Pills st={st} small />
      </div>
      {nx?.ask && <Ask key={`${c.id}-${nx.n}`} s={nx} />}
    </div>
  );
}
