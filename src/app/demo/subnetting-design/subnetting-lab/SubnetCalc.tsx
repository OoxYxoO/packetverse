"use client";

import { useState } from "react";
import { clsx } from "clsx";
import { ssCalc, ssDrill, ssParseIp, type SsCalc } from "@/lib/sim-engine/scenarios/subnetStudio";
import { AddressGrid, Legend } from "./SubnetGrid";
import { BitBar, Btn, Idea, Lead, Now, Scene, blank, paint, useSeen } from "./SubnetKit";

/**
 * CALCULATE — "8 · Calculate it": the learner works out a subnet's numbers on their own, then the model checks every
 * field and shows the method that produced the right answer (host bits → block → boundary → network → broadcast).
 * Three levels: the last octet of 10.44.0.x (with the board), the last octet of any address, and the third octet
 * (/17–/23, the same method one octet to the left). Problems are deterministic (ssDrill) and nothing is recorded.
 */

type Field = "block" | "network" | "first" | "last" | "broadcast" | "usable";
const FIELDS: { k: Field; label: string; num?: boolean }[] = [
  { k: "block", label: "Addresses in the block", num: true },
  { k: "usable", label: "Usable hosts", num: true },
  { k: "network", label: "Network address" },
  { k: "first", label: "First usable" },
  { k: "last", label: "Last usable" },
  { k: "broadcast", label: "Broadcast" },
];
const LEVELS = [
  { n: 1 as const, t: "Last octet · 10.44.0.x" },
  { n: 2 as const, t: "Last octet · any address" },
  { n: 3 as const, t: "Third octet · /17–/23" },
];
const answerOf = (c: SsCalc, k: Field) => (k === "block" ? String(c.block) : k === "usable" ? String(c.usable) : c[k]);
const norm = (k: Field, v: string, n: boolean | undefined) => (n ? v.replace(/[^0-9]/g, "") : (ssParseIp(v) ?? v.trim()));

/** The interesting octet as a 0–255 line, cut every `step`: the block the address falls in is lit. */
function OctetLine({ c }: { c: SsCalc }) {
  const v = Number(c.ip.split(".")[c.octet]);
  const start = Math.floor(v / c.step) * c.step;
  const ticks = Array.from({ length: 256 / c.step + 1 }, (_, i) => i * c.step);
  const showLabels = c.step >= 16;
  return (
    <div className="rounded-xl border border-pv-border bg-pv-bg/50 p-2.5" role="img" aria-label={`Octet ${c.octet + 1}: value ${v}, blocks of ${c.step}, block ${start} to ${start + c.step - 1}`}>
      <p className="mb-1 text-[12.5px] text-pv-text-muted">
        Octet {c.octet + 1} of the address (value <b className="pv-mono text-pv-text">{v}</b>), cut into blocks of <b className="pv-mono text-pv-text">{c.step}</b>
      </p>
      <div className="relative h-9 rounded-md bg-pv-bg-elevated/60">
        <div className="absolute inset-y-0 rounded-md bg-pv-cyan/35 ring-2 ring-pv-cyan" style={{ left: `${(start / 256) * 100}%`, width: `${(c.step / 256) * 100}%` }} />
        {ticks.map((t) => (
          <span key={t} className="absolute inset-y-0 w-px bg-pv-text-faint/50" style={{ left: `${(t / 256) * 100}%` }} />
        ))}
        <span className="absolute -top-1 h-11 w-[3px] -translate-x-1/2 rounded bg-white" style={{ left: `${((v + 0.5) / 256) * 100}%` }} />
      </div>
      <div className="relative mt-0.5 h-4 pv-mono text-[10.5px] text-pv-text-faint">
        {showLabels
          ? ticks.slice(0, -1).map((t) => (
              <span key={t} className={clsx("absolute -translate-x-1/2", t === start && "font-bold text-pv-cyan-soft")} style={{ left: `${(t / 256) * 100}%` }}>
                {t}
              </span>
            ))
          : [
              <span key="s" className="absolute -translate-x-1/2 font-bold text-pv-cyan-soft" style={{ left: `${(start / 256) * 100}%` }}>
                {start}
              </span>,
            ]}
      </div>
    </div>
  );
}

function Method({ c }: { c: SsCalc }) {
  const v = Number(c.ip.split(".")[c.octet]);
  const q = Math.floor(v / c.step);
  const later = 3 - c.octet;
  return (
    <ol className="list-decimal space-y-1 pl-5 text-[13.5px] leading-snug text-pv-text-muted">
      <li>
        /{c.prefix} → host bits = 32 − {c.prefix} = <b className="text-pv-text">{c.hostBits}</b> → block = 2^{c.hostBits} = <b className="text-pv-text">{c.block}</b> addresses, usable = {c.block} − 2 = <b className="text-pv-text">{c.usable}</b> (network and broadcast reserved).
      </li>
      <li>
        The mask {c.mask} stops being 255 in octet {c.octet + 1}: {c.maskOctet}. Blocks there step by 256 − {c.maskOctet} = <b className="text-pv-text">{c.step}</b>.
      </li>
      <li>
        Octet {c.octet + 1} is {v}: {v} ÷ {c.step} = {q} remainder {v - q * c.step}, so the block starts at {q} × {c.step} = <b className="text-pv-text">{q * c.step}</b>
        {later > 0 ? `, and every octet after it is 0` : ""}. Network = <b className="pv-mono text-pv-text">{c.network}</b>.
      </li>
      <li>
        Broadcast = the last address of the block: {q * c.step} + {c.step} − 1 = {q * c.step + c.step - 1}
        {later > 0 ? ", every octet after it 255" : ""} → <b className="pv-mono text-pv-text">{c.broadcast}</b>.
      </li>
      <li>
        Usable = everything between: <b className="pv-mono text-pv-text">{c.first}</b> – <b className="pv-mono text-pv-text">{c.last}</b>. The next subnet starts at {c.next}.
      </li>
    </ol>
  );
}

export function CalculateIt() {
  const [level, setLevel] = useState<1 | 2 | 3>(1);
  const [n, setN] = useState(0);
  const [vals, setVals] = useState<Partial<Record<Field, string>>>({});
  const [checked, setChecked] = useState(false);
  const [method, setMethod] = useState(false);
  const [streak, setStreak] = useState(0);
  const [solved, setSolved] = useState(0);
  const [seen, mark] = useSeen();
  const prob = ssDrill(n, level);
  const c = ssCalc(prob.ip, prob.prefix);
  const right = (k: Field) => norm(k, vals[k] ?? "", FIELDS.find((f) => f.k === k)!.num) === answerOf(c, k);
  const all = FIELDS.every((f) => right(f.k));
  const fresh = (l: 1 | 2 | 3, i: number) => {
    setLevel(l);
    setN(i);
    setVals({});
    setChecked(false);
    setMethod(false);
  };
  const check = () => {
    setChecked(true);
    mark("check");
    if (all && !checked) {
      setStreak((s) => s + 1);
      setSolved((s) => s + 1);
      mark(`l${level}`);
    } else if (!all) setStreak(0);
  };
  const last = Number(prob.ip.split(".")[3]);
  const cells = blank();
  if (level === 1) {
    paint(cells, 0, 256, () => ({ fill: "rgba(148,163,184,0.06)" }));
    if (checked || method) {
      const s0 = Number(c.network.split(".")[3]);
      paint(cells, s0, c.block, (i) => ({ fill: i === 0 ? "rgba(167,139,250,0.55)" : i === c.block - 1 ? "rgba(251,191,36,0.55)" : "rgba(52,211,153,0.32)", group: "b", groupColor: "#ffffff", tag: i === 0 ? "N" : i === c.block - 1 ? "B" : undefined }));
    }
    cells[last] = { ...cells[last], ring: "info" };
  }
  return (
    <Scene
      board={
        level === 1 ? (
          <AddressGrid cells={cells} label="Address board 10.44.0.0/24" footer={<Legend items={[{ color: "#e8edf9", label: `${prob.ip} (ringed)` }, ...(checked || method ? [{ color: "rgba(167,139,250,0.75)", label: "N network" }, { color: "rgba(251,191,36,0.75)", label: "B broadcast" }] : [])]} />} />
        ) : (
          <div className="space-y-3">
            <p className="text-center pv-mono text-[26px] font-bold text-pv-text sm:text-[32px]">
              {prob.ip}
              <span className="text-pv-cyan-soft">/{prob.prefix}</span>
            </p>
            <OctetLine c={c} />
            {level === 2 && <BitBar octet={last} prefix={prob.prefix} clear />}
            {level === 3 && <p className="text-center text-[13px] text-pv-text-muted">The prefix ends inside the third octet, so that is the octet you divide. The fourth octet is all host bits: 0 in the network address, 255 in the broadcast.</p>}
          </div>
        )
      }
      hint={level === 1 ? (checked || method ? "The block, with its network (N) and broadcast (B)" : "Work it out first — the board shows the block after you check") : "The interesting octet, cut into blocks"}
      side={
        <>
          <Lead kicker="Calculate · on your own" title="Calculate it yourself">
            <p>You&apos;ve seen why blocks have the sizes and starts they do. Now work out a subnet&apos;s numbers on your own; the checker marks each field and shows the method.</p>
          </Lead>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Level">
            {LEVELS.map((l) => (
              <Btn key={l.n} tone="quiet" pressed={level === l.n} onClick={() => fresh(l.n, 0)}>
                {l.t}
              </Btn>
            ))}
          </div>
          <div className="rounded-2xl border border-pv-cyan/35 bg-pv-cyan/[0.05] p-3">
            <p className="text-[12.5px] text-pv-text-muted">
              Problem {n + 1} · solved {solved} · streak {streak}
            </p>
            <p className="pv-mono text-[22px] font-bold text-pv-text">
              {prob.ip}
              <span className="text-pv-cyan-soft">/{prob.prefix}</span>
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {FIELDS.map((f) => (
                <label key={f.k} className="block text-[12.5px] text-pv-text-muted">
                  {f.label}
                  <span className="mt-0.5 flex items-center gap-1.5">
                    <input
                      value={vals[f.k] ?? ""}
                      onChange={(e) => {
                        setVals((v) => ({ ...v, [f.k]: e.target.value.replace(f.num ? /[^0-9]/g : /[^0-9.]/g, "").slice(0, f.num ? 6 : 15) }));
                        setChecked(false);
                      }}
                      onKeyDown={(e) => e.key === "Enter" && check()}
                      inputMode={f.num ? "numeric" : "decimal"}
                      placeholder={f.num ? "" : level === 1 ? "10.44.0." : ""}
                      aria-label={f.label}
                      className={clsx("h-9 w-full min-w-0 rounded-lg border bg-pv-bg px-2 pv-mono text-[15px] text-pv-text", checked ? (right(f.k) ? "border-pv-success" : "border-pv-danger") : "border-pv-border")}
                    />
                    {checked && <span className={right(f.k) ? "text-pv-success" : "text-pv-danger"}>{right(f.k) ? "✓" : "✕"}</span>}
                  </span>
                </label>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Btn onClick={check}>Check</Btn>
              <Btn tone="quiet" pressed={method} onClick={() => (setMethod((m) => !m), mark("method"))}>
                {method ? "Hide the method" : "Show the method"}
              </Btn>
              <Btn tone="quiet" onClick={() => fresh(level, n + 1)}>
                Next problem →
              </Btn>
            </div>
          </div>
          {checked && (
            <Now k={`${level}-${n}-${JSON.stringify(vals)}`} tone={all ? "ok" : "warn"} title={all ? "✓ Every field is right." : `${FIELDS.filter((f) => !right(f.k)).length} field${FIELDS.filter((f) => !right(f.k)).length > 1 ? "s" : ""} to look at again.`}>
              {!all && (
                <ul className="space-y-0.5">
                  {FIELDS.filter((f) => !right(f.k)).map((f) => (
                    <li key={f.k}>
                      <b className="text-pv-text">{f.label}</b>: {f.k === "block" ? `host bits = 32 − ${c.prefix} = ${c.hostBits}; 2^${c.hostBits} addresses.` : f.k === "usable" ? "the block minus the network and broadcast addresses." : f.k === "network" ? `the multiple of ${c.step} at or below octet ${c.octet + 1}'s value${c.octet < 3 ? ", later octets 0" : ""}.` : f.k === "broadcast" ? `network + block − 1${c.octet < 3 ? ": in octet " + (c.octet + 1) + " that is + " + (c.step - 1) + ", later octets 255" : ""}.` : f.k === "first" ? "one after the network address." : "one before the broadcast address."}
                    </li>
                  ))}
                </ul>
              )}
              {all && <p>Next problem, or move up a level. The method is the same at every level — only the octet changes.</p>}
            </Now>
          )}
          {method && (
            <div className="sl-pop rounded-2xl border border-pv-border bg-pv-bg-elevated/30 p-3">
              <p className="mb-1 text-[10.5px] font-bold uppercase tracking-[0.16em] text-pv-text-faint">The method, for this problem</p>
              <Method c={c} />
            </div>
          )}
          <Idea>
            <p>
              host bits = 32 − prefix · addresses = 2^host bits · usable = 2^host bits − 2 · the block starts at the multiple of its size at or below the address · broadcast = start + size − 1.
            </p>
            <p className="text-pv-text-muted">The −2 is for ordinary LAN subnets. A /31 point-to-point link uses both of its 2 addresses; a /32 is one single address.</p>
          </Idea>
          <p className="text-[12.5px] text-pv-text-faint">{seen.l1 && seen.l3 ? "You've solved problems in the last and the third octet: that's the whole method." : "Solve one at level 1, then one at level 3: the same method, one octet to the left."}</p>
        </>
      }
    />
  );
}
