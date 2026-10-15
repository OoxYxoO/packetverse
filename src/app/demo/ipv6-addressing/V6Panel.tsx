"use client";

import { useId, useState } from "react";
import { classify, compress, expand, groups, multicastMac, solicitedNode, type V6State } from "@/lib/sim-engine/scenarios/ccna/ipv6Addr";

/** Side panel: PC1's addresses with their types (from the model state), and an address explorer to try any address. */
export function V6Panel({ s }: { s: V6State }) {
  const rows: [string, string | undefined][] = [
    ["link-local", s.pc1.linkLocal],
    ["global", s.pc1.gua],
    ["default router", s.pc1.defaultRouter],
  ];
  return (
    <div className="space-y-3 text-xs">
      <section className="rounded-xl border border-pv-border bg-pv-surface/60 p-3" aria-label="PC1 IPv6 addresses">
        <h3 className="font-semibold text-pv-text">PC1 · IPv6</h3>
        <dl className="mt-2 space-y-1">
          {rows.map(([k, v]) => (
            <div key={k} className="flex flex-wrap justify-between gap-x-2">
              <dt className="text-pv-text-muted">{k}</dt>
              <dd className={`break-all font-mono ${v ? "text-pv-text" : "text-pv-danger"}`}>{v ?? "none"}</dd>
            </div>
          ))}
        </dl>
        {s.pc1.groups.length ? (
          <p className="mt-2 break-all font-mono text-[10.5px] text-pv-text-faint">groups: {s.pc1.groups.join(" · ")}</p>
        ) : null}
        {s.pings.length ? (
          <ul className="mt-2 space-y-0.5 font-mono text-[10.5px]">
            {s.pings.map((p, i) => (
              <li key={i} className={/no route/.test(p) ? "text-pv-danger" : "text-pv-success"}>
                ping {p}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      <AddressExplorer />
    </div>
  );
}

const VALID = /^[0-9a-f:]+$/i;
function parse(text: string) {
  const t = text.trim().split("/")[0];
  if (!t || !VALID.test(t) || (t.match(/::/g) ?? []).length > 1) return undefined;
  const parts = t.split("::");
  const count = parts.reduce((n, p) => n + (p ? p.split(":").length : 0), 0);
  if (parts.length === 1 ? count !== 8 : count > 7) return undefined;
  if (t.split(":").some((g) => g.length > 4)) return undefined;
  const g = groups(t);
  return g.length === 8 && g.every((x) => Number.isFinite(x)) ? t : undefined;
}

function AddressExplorer() {
  const id = useId();
  const [text, setText] = useState("2001:0db8:0000:0000:0000:ff00:0042:8329");
  const a = parse(text);
  return (
    <section className="rounded-xl border border-pv-ip/30 bg-pv-ip/5 p-3" aria-label="IPv6 address explorer">
      <label htmlFor={id} className="font-semibold text-pv-text">
        Try any address
      </label>
      <input id={id} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} className="mt-2 w-full rounded-lg border border-pv-border bg-pv-bg/60 px-2 py-1.5 font-mono text-[11px] text-pv-text focus:border-pv-cyan/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-pv-cyan/40" />
      {a ? (
        <dl className="mt-2 space-y-1" aria-live="polite">
          {(
            [
              ["compressed", compress(a)],
              ["expanded", expand(a)],
              ["type", classify(a)],
              ["solicited-node", solicitedNode(a)],
              ["its multicast MAC", multicastMac(solicitedNode(a))],
            ] as const
          ).map(([k, v]) => (
            <div key={k}>
              <dt className="text-pv-text-faint">{k}</dt>
              <dd className="break-all font-mono text-pv-text">{v}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-2 text-pv-warning" aria-live="polite">
          Not a valid IPv6 address (eight groups of up to four hex digits; “::” at most once).
        </p>
      )}
    </section>
  );
}
