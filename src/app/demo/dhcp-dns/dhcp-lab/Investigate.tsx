"use client";

import { clsx } from "clsx";
import type { ReactNode } from "react";
import { PacketCard } from "@/components/presentation/Visuals";
import { DNS_RECORD_TTL } from "@/lib/sim-engine/scenarios/dhcpDns";
import { BC, DL_ADDR, DL_IFACES, configured, dhcpProblem, dhcpRunning, dlCaptureAt, dlLayersAt, fmtT, leaseLeft, type DlIface, type DlLayer, type DlNode, type DlObs, type DlPacket, type DlState } from "@/lib/sim-engine/scenarios/dhcpDnsLab";
import { useIfName } from "./ifNames";
import { ACT_LABEL, ACT_TONE, CAP_FILTERS, DEVICE_INFO, INSPECTABLE, capMatch, ifaceLabel, journeyEnd, journeyLabel, journeys, nodeIfaces, obsMeaning, tcpdumpLine, type CapFilter, type Coach, type InspectNode } from "./dhcpObserve";
import { DL_MAC_NAMES } from "./dhcpCli";

/**
 * Investigate: observe the lab network the way an engineer would. Two ways in:
 *   - Follow a message: one DHCP/DNS/ARP/ICMP message, device by device, interface by interface, across every leg
 *     (a relayed DISCOVER is two packets, one message), with where it stopped and what that proves.
 *   - Inspect a device: what each of its interfaces saw (a capture per interface), its counters and its tables.
 * Every view reads the lab's packets and device state; nothing is drawn separately from the simulation.
 */

export interface InvestigateSel {
  tab: "follow" | "device" | "cli" | "timeline";
  journey?: string;
  node: DlNode;
  iface?: DlIface;
  filter: CapFilter;
  /** `${packet no}:${obs index}` of the expanded capture row. */
  pick?: string;
  view: "saw" | "state";
}
export const INITIAL_SEL: InvestigateSel = { tab: "follow", node: "CLIENT", filter: "all", view: "saw" };

const Tiny = ({ children, className }: { children: ReactNode; className?: string }) => <p className={clsx("text-[11.5px] leading-snug text-pv-text-muted", className)}>{children}</p>;
const Lbl = ({ children }: { children: ReactNode }) => <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-pv-text-faint">{children}</p>;
const macName = (m: string) => (m === BC ? "broadcast" : (DL_MAC_NAMES[m] ?? m));

function Layers({ layers }: { layers: DlLayer[] }) {
  return <PacketCard compact layers={layers.map((l) => ({ name: l.name, color: l.color, fields: l.fields.map((f) => ({ k: f.k, v: f.v, hi: f.hi ? ("key" as const) : undefined })) }))} />;
}
function Meaning({ p, o, coach }: { p: DlPacket; o: DlObs; coach: Coach }) {
  const nm = useIfName();
  if (coach === "off") return null;
  const hop = p.hops.find((h) => h.node === DL_IFACES[o.iface].node && (o.dir === "in" ? h.in === o.iface : h.out.includes(o.iface)));
  const m = obsMeaning(p, o, hop, nm);
  return (
    <div className="space-y-1 rounded-lg border border-pv-cyan/30 bg-pv-cyan/[0.04] p-2">
      <p className="text-[12px] text-pv-text">{m.means}</p>
      {coach === "guide" && (
        <>
          <Tiny>
            <b className="text-pv-success">Proves: </b>
            {m.proves}
          </Tiny>
          <Tiny>
            <b className="text-pv-warning">Doesn&apos;t prove: </b>
            {m.notProves}
          </Tiny>
          {m.next && (
            <Tiny>
              <b className="text-pv-text">Next: </b>
              {m.next}
            </Tiny>
          )}
        </>
      )}
    </div>
  );
}

export function Investigate({ lab, sel, setSel, coach, setCoach, scope = "full" }: { lab: DlState; sel: InvestigateSel; setSel: (s: InvestigateSel) => void; coach: Coach; setCoach: (c: Coach) => void; /** "follow": messages and captures only (level 5); "full": also tables, logs and status. */ scope?: "follow" | "full" }) {
  return (
    <section className="space-y-2.5" aria-label="Investigate the network">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[13.5px] font-semibold text-pv-text">Investigate the network</p>
          <Tiny>Prove where traffic went, from real observation points.</Tiny>
        </div>
        <div role="radiogroup" aria-label="Coaching" className="flex gap-0.5 rounded-full border border-pv-border p-0.5 text-[11px]">
          {(["guide", "hints", "off"] as Coach[]).map((c) => (
            <button key={c} type="button" role="radio" aria-checked={coach === c} onClick={() => setCoach(c)} className={clsx("rounded-full px-2 py-0.5 font-semibold", coach === c ? "bg-pv-violet/20 text-pv-violet" : "text-pv-text-faint hover:text-pv-text")}>
              {c === "guide" ? "Guide me" : c === "hints" ? "Hints" : "No help"}
            </button>
          ))}
        </div>
      </div>
      <div role="tablist" className="flex gap-1">
        {(
          [
            ["follow", "Follow a message"],
            ["device", "Inspect a device"],
          ] as const
        ).map(([t, label]) => (
          <button key={t} type="button" role="tab" aria-selected={sel.tab === t} onClick={() => setSel({ ...sel, tab: t })} className={clsx("rounded-lg border px-2.5 py-1 text-[12px] font-semibold", sel.tab === t ? "border-pv-cyan/60 bg-pv-cyan/10 text-pv-cyan-soft" : "border-pv-border text-pv-text-muted hover:text-pv-text")}>
            {label}
          </button>
        ))}
      </div>
      {sel.tab === "follow" ? <FollowView lab={lab} sel={sel} setSel={setSel} coach={coach} /> : <Device lab={lab} sel={sel} setSel={setSel} coach={coach} scope={scope} />}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Follow a message
// ---------------------------------------------------------------------------------------------------------------
/** Where a message was meant to end up, for "not seen beyond here". */
function destinationOf(packets: DlPacket[]): DlNode | undefined {
  const first = packets[0];
  const last = packets[packets.length - 1];
  const dst = last.dst.split(":")[0];
  if (first.proto === "DHCP") return first.src === "0.0.0.0" || first.dst === DL_ADDR.SRV || last.dst === DL_ADDR.SRV ? (first.msg === "OFFER" || first.msg === "ACK" ? "CLIENT" : "DHCP-SRV") : "CLIENT";
  if (first.proto === "ARP") return undefined;
  if (dst === DL_ADDR.SRV) return "DHCP-SRV";
  if (dst === DL_ADDR.DNS) return "DNS-SRV";
  if (dst === DL_ADDR.C) return "CLIENT";
  if (dst.startsWith("203.0.113.")) return "WEB";
  return undefined;
}
const NEIGH: Record<DlNode, DlNode[]> = (() => {
  const m = {} as Record<DlNode, DlNode[]>;
  for (const i of Object.keys(DL_IFACES) as DlIface[]) {
    const a = DL_IFACES[i].node;
    const b = DL_IFACES[DL_IFACES[i].peer].node;
    m[a] = [...new Set([...(m[a] ?? []), b])];
  }
  return m;
})();
function pathBetween(a: DlNode, b: DlNode): DlNode[] {
  const prev = new Map<DlNode, DlNode>();
  const q: DlNode[] = [a];
  const seen = new Set([a]);
  while (q.length) {
    const n = q.shift()!;
    if (n === b) break;
    for (const x of NEIGH[n]) {
      if (seen.has(x)) continue;
      seen.add(x);
      prev.set(x, n);
      q.push(x);
    }
  }
  const out: DlNode[] = [];
  for (let n: DlNode | undefined = b; n && n !== a; n = prev.get(n)) out.unshift(n);
  return out;
}

export function FollowView({ lab, sel, setSel, coach, extra }: { lab: DlState; sel: InvestigateSel; setSel: (s: InvestigateSel) => void; coach: Coach; /** Optional: extra content under a packet (e.g. concept links). */ extra?: (p: DlPacket) => ReactNode }) {
  const nm = useIfName();
  const all = journeys(lab);
  if (!all.length)
    return (
      <p className="rounded-xl border border-dashed border-pv-border p-3 text-[12px] text-pv-text-muted">
        Nothing has crossed the network yet{lab.lastResult?.text.includes("cache") ? " (that answer came from the client's cache: no packet was sent)" : ""}. Make the client do something (get an address, resolve a name, ping), then follow what it sent.
      </p>
    );
  const recent = all.filter((j) => j.recent);
  // default: the message that started the last action (journeys are newest first)
  const current = all.find((j) => j.id === sel.journey) ?? recent[recent.length - 1] ?? all[0];
  const packets = current.packets;
  const end = journeyEnd(packets)!;
  const ifaces = packets.flatMap((p) => p.obs);
  const devices = [...new Set(packets.flatMap((p) => p.hops.filter((h) => h.act !== "ignore").map((h) => h.node)))];
  const bad = ACT_TONE[end.act] === "bad";
  const dest = destinationOf(packets);
  const missing = bad && dest && dest !== end.node ? pathBetween(end.node, dest) : [];
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <Lbl>{recent.length ? "Messages from your last action" : "Messages"}</Lbl>
        <div className="flex flex-wrap gap-1">
          {(recent.length ? recent : all.slice(0, 6))
            .slice()
            .reverse()
            .map((j) => (
              <button key={j.id} type="button" onClick={() => setSel({ ...sel, journey: j.id })} className={clsx("rounded-full border px-2 py-0.5 pv-mono text-[11px]", j.id === current.id ? "border-pv-cyan bg-pv-cyan/15 text-pv-text" : "border-pv-border text-pv-text-muted hover:text-pv-text", ACT_TONE[journeyEnd(j.packets)!.act] === "bad" && "border-pv-danger/60")}>
                {journeyLabel(j.packets)}
              </button>
            ))}
        </div>
        {all.length > recent.length && (
          <select aria-label="Earlier messages" value={recent.some((r) => r.id === current.id) ? "" : current.id} onChange={(e) => e.target.value && setSel({ ...sel, journey: e.target.value })} className="h-7 w-full rounded-lg border border-pv-border bg-pv-bg px-1 pv-mono text-[11px] text-pv-text-muted">
            <option value="">Earlier messages…</option>
            {all
              .filter((j) => !j.recent)
              .map((j) => (
                <option key={j.id} value={j.id}>
                  #{j.packets[0].no} {fmtT(j.packets[0].t)} · {journeyLabel(j.packets)}
                </option>
              ))}
          </select>
        )}
      </div>

      <div className={clsx("rounded-xl border p-2.5", bad ? "border-pv-danger/50 bg-pv-danger/[0.05]" : "border-pv-success/45 bg-pv-success/[0.05]")}>
        <p className="text-[12.5px] font-semibold text-pv-text">
          {journeyLabel(packets)}: seen at {ifaces.length} interface crossings on {devices.length} devices.
        </p>
        <p className={clsx("text-[12px]", bad ? "text-pv-danger" : "text-pv-success")}>
          {bad ? "✕" : "✓"} Last device: {end.node}, {ACT_LABEL[end.act]}.
        </p>
        {coach !== "off" && <Tiny className="mt-0.5">{end.text}</Tiny>}
        {coach === "guide" && (
          <Tiny className="mt-1">
            {bad
              ? `This is where to dig: the message provably reached ${end.node} and went no further. The rows below show every point it did cross; nothing of it exists beyond ${end.node}.`
              : packets.length > 1
                ? "Every row below is a point where you could have captured it. Notice where it changes: a relay or a router builds a new frame (and the relay a new packet)."
                : "Every row below is a point where you could have captured it."}
          </Tiny>
        )}
      </div>

      <ol className="space-y-1">
        {packets.map((p, pi) => (
          <li key={p.no} className="space-y-1">
            {pi > 0 && (
              <p className="rounded-md border border-dashed border-pv-violet/50 px-2 py-1 text-[11.5px] text-pv-violet">
                ↳ {packets[pi - 1].hops[packets[pi - 1].hops.length - 1].node} sent a new packet: {p.src} → {p.dst}
                {coach === "guide" && p.src === DL_ADDR.RS ? " (the relay's copy: new source address, giaddr filled in)" : ""}
              </p>
            )}
            {p.hops.map((h, hi) => {
              const inObs = h.in ? p.obs.find((o) => o.iface === h.in && o.dir === "in") : p.obs.find((o) => o.dir === "out");
              const key = `${p.no}:${hi}`;
              const open = sel.pick === key;
              const tone = ACT_TONE[h.act];
              return (
                <div key={key} className={clsx("rounded-lg border", tone === "bad" ? "border-pv-danger/50" : tone === "muted" ? "border-pv-border/60 opacity-75" : "border-pv-border")}>
                  <button type="button" onClick={() => setSel({ ...sel, pick: open ? undefined : key })} className="flex w-full flex-wrap items-center gap-x-2 gap-y-0.5 px-2 py-1 text-left">
                    <span className={clsx("h-2 w-2 shrink-0 rounded-full", tone === "bad" ? "bg-pv-danger" : tone === "muted" ? "bg-pv-text-faint" : "bg-pv-success")} />
                    <span className="text-[12px] font-bold text-pv-text">{h.node}</span>
                    <span className="pv-mono text-[11px] text-pv-text-muted">
                      {h.in ? `in ${nm(h.in)}` : ""}
                      {h.in && h.out.length ? " → " : ""}
                      {h.out.length ? `out ${h.out.map((o) => nm(o)).join(", ")}` : ""}
                    </span>
                    <span className={clsx("ml-auto rounded px-1.5 text-[10.5px] font-bold uppercase", tone === "bad" ? "bg-pv-danger/15 text-pv-danger" : tone === "muted" ? "text-pv-text-faint" : "bg-pv-success/10 text-pv-success")}>{ACT_LABEL[h.act]}</span>
                  </button>
                  {coach === "guide" && !open && h.text && <Tiny className="px-2 pb-1">{h.text}</Tiny>}
                  {open && inObs && (
                    <div className="space-y-1.5 border-t border-pv-border/60 p-2">
                      <Tiny>
                        Frame {inObs.dir === "in" ? "arriving at" : "leaving"} {ifaceLabel(inObs.iface, nm)}: {macName(inObs.srcMac)} → {macName(inObs.dstMac)}
                        {inObs.ttl !== undefined ? `, TTL ${inObs.ttl}` : ""}
                      </Tiny>
                      {coach !== "off" && <p className="text-[12px] text-pv-text">{h.text}</p>}
                      <Meaning p={p} o={inObs} coach={coach} />
                      <Layers layers={dlLayersAt(p, inObs)} />
                      {extra?.(p)}
                      {INSPECTABLE.includes(h.node as InspectNode) && (
                        <button type="button" onClick={() => setSel({ ...sel, tab: "device", node: h.node, iface: inObs.iface, filter: p.proto === "DHCP" ? "dhcp" : p.proto === "DNS" ? "dns" : p.proto === "ARP" ? "arp" : "icmp", view: "saw", pick: undefined })} className="text-[11.5px] font-semibold text-pv-cyan-soft hover:underline">
                          See everything {ifaceLabel(inObs.iface, nm)} saw →
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </li>
        ))}
        {missing.length > 0 && (
          <li className="rounded-lg border border-dashed border-pv-danger/50 px-2 py-1.5">
            <p className="text-[12px] font-semibold text-pv-danger">✕ Never seen at: {missing.join(" → ")}</p>
            {coach !== "off" && <Tiny>To prove it yourself, capture at the next point after {end.node}: this message won&apos;t be there.</Tiny>}
          </li>
        )}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Inspect a device
// ---------------------------------------------------------------------------------------------------------------
function Device({ lab, sel, setSel, coach, scope }: { lab: DlState; sel: InvestigateSel; setSel: (s: InvestigateSel) => void; coach: Coach; scope: "follow" | "full" }) {
  const node = sel.node;
  const info = DEVICE_INFO[node];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {INSPECTABLE.map((n) => (
          <button key={n} type="button" onClick={() => setSel({ ...sel, node: n, iface: undefined, pick: undefined })} className={clsx("rounded-full border px-2.5 py-0.5 text-[11.5px] font-semibold", n === node ? "border-pv-violet bg-pv-violet/15 text-pv-text" : "border-pv-border text-pv-text-muted hover:text-pv-text")}>
            {n}
          </button>
        ))}
      </div>
      <div className="rounded-xl border border-pv-border p-2">
        <p className="text-[12.5px] font-semibold text-pv-text">
          {node} <span className="font-normal text-pv-text-muted">· {info.role}</span>
        </p>
        {coach === "guide" && (
          <>
            <Tiny className="mt-1">
              <b className="text-pv-text">Why look here: </b>
              {info.look}
            </Tiny>
            <Tiny>
              <b className="text-pv-warning">What it can&apos;t tell you: </b>
              {info.cannot}
            </Tiny>
          </>
        )}
      </div>
      {node === "WEB" ? null : scope === "follow" ? (
        <>
          {coach !== "off" && <p className="text-[11.5px] text-pv-text-faint">Each line below is one cable of {node}. Pick one to see its capture. (Tables, logs and the command line unlock in level 6.)</p>}
          <Saw lab={lab} sel={sel} setSel={setSel} coach={coach} />
        </>
      ) : (
        <>
          <div role="tablist" className="flex gap-1">
            {(
              [
                ["saw", "What it saw"],
                ["state", "Its tables and status"],
              ] as const
            ).map(([v, label]) => (
              <button key={v} type="button" role="tab" aria-selected={sel.view === v} onClick={() => setSel({ ...sel, view: v })} className={clsx("rounded-md px-2 py-0.5 text-[11.5px] font-semibold", sel.view === v ? "bg-white/10 text-pv-text" : "text-pv-text-faint hover:text-pv-text")}>
                {label}
              </button>
            ))}
          </div>
          {sel.view === "saw" ? <Saw lab={lab} sel={sel} setSel={setSel} coach={coach} /> : <StateTables lab={lab} node={node as InspectNode} coach={coach} />}
        </>
      )}
    </div>
  );
}

export function Saw({ lab, sel, setSel, coach, extra }: { lab: DlState; sel: InvestigateSel; setSel: (s: InvestigateSel) => void; coach: Coach; extra?: (p: DlPacket) => ReactNode }) {
  const nm = useIfName();
  const node = sel.node;
  const ifs = nodeIfaces(node);
  const iface = sel.iface && ifs.includes(sel.iface) ? sel.iface : ifs[0];
  const rows = dlCaptureAt(lab, iface).filter((r) => capMatch(sel.filter, r.p));
  const f = CAP_FILTERS.find((x) => x.id === sel.filter)!;
  const ios = nm(iface) !== DL_IFACES[iface].name;
  const cmd =
    node === "SW1" || node === "SW2"
      ? ios
        ? `monitor session 1 source interface ${nm(iface)} both`
        : `monitor traffic interface ${nm(iface)}${f.bpf ? ` matching "${f.bpf}"` : ""}`
      : node === "R1"
        ? ios
          ? `monitor capture CAP interface ${nm(iface).replace("Gi", "GigabitEthernet")} both${f.bpf ? ` match ${f.bpf}` : ""}`
          : `monitor traffic interface ${nm(iface)}${f.bpf ? ` matching "${f.bpf}"` : ""}`
        : node === "CLIENT"
          ? `dumpcap -i Ethernet${f.bpf ? ` -f "${f.bpf}"` : ""}`
          : `tcpdump -i eth0 -n -e${f.bpf ? ` ${f.bpf}` : ""}`;
  return (
    <div className="space-y-2">
      <div className="grid gap-1">
        {ifs.map((i) => {
          const c = lab.net.counters[i];
          return (
            <button key={i} type="button" onClick={() => setSel({ ...sel, iface: i, pick: undefined })} className={clsx("flex flex-wrap items-center gap-x-2 rounded-lg border px-2 py-1 text-left", i === iface ? "border-pv-cyan/70 bg-pv-cyan/[0.07]" : "border-pv-border hover:border-pv-cyan/40")}>
              <span className="pv-mono text-[12px] font-bold text-pv-text">{nm(i)}</span>
              <span className="text-[11px] text-pv-text-muted">→ {DL_IFACES[i].faces}</span>
              <span className="ml-auto pv-mono text-[11px] text-pv-text-muted">
                in {c.inPkts}
                {c.inBcast ? ` (${c.inBcast} bc)` : ""} · out {c.outPkts}
                {c.outBcast ? ` (${c.outBcast} bc)` : ""}
              </span>
            </button>
          );
        })}
      </div>
      {coach === "guide" && <Tiny>Counters count every frame since the lab started (in = arrived from the device on the other end, out = sent to it). They prove traffic crossed, not what it was. Capture to see that.</Tiny>}
      <div className="rounded-xl border border-pv-border bg-[#05080d] p-2">
        <p className="pv-mono text-[10.5px] text-pv-text-faint">
          {node}
          {node === "SW1" || node === "SW2" ? "# " : node === "R1" ? "> " : "$ "}
          {cmd}
        </p>
        {coach === "guide" && <Tiny className="mt-0.5">{DEVICE_INFO[node].capture}</Tiny>}
        <div className="mt-1 flex flex-wrap gap-1">
          {CAP_FILTERS.map((x) => (
            <button key={x.id} type="button" onClick={() => setSel({ ...sel, filter: x.id, pick: undefined })} className={clsx("rounded-full border px-2 text-[10.5px] font-semibold", sel.filter === x.id ? "border-pv-cyan text-pv-cyan-soft" : "border-pv-border text-pv-text-faint hover:text-pv-text")}>
              {x.label}
            </button>
          ))}
        </div>
        {rows.length === 0 ? (
          <p className="mt-1.5 pv-mono text-[11px] text-pv-text-faint">
            0 packets captured{f.bpf ? ` matching ${f.label}` : ""}.
            {coach !== "off" && <span className="block font-sans text-pv-text-muted">Nothing {f.id === "all" ? "" : `of that kind `}crossed {ifaceLabel(iface)}. An empty capture is evidence too: whatever you expected never got here.</span>}
          </p>
        ) : (
          <ol className="mt-1.5 max-h-72 space-y-0.5 overflow-y-auto">
            {rows.map(({ p, o }) => {
              const k = `${p.no}:${p.obs.indexOf(o)}`;
              const open = sel.pick === k;
              return (
                <li key={k} className={clsx("rounded border", open ? "border-pv-cyan/60" : "border-transparent")}>
                  <button type="button" onClick={() => setSel({ ...sel, pick: open ? undefined : k })} className={clsx("block w-full overflow-hidden text-ellipsis whitespace-nowrap px-1 text-left pv-mono text-[10.5px] hover:bg-white/[0.04]", p.lost && p.hops[p.hops.length - 1].node === node ? "text-pv-danger" : o.dir === "in" ? "text-pv-text" : "text-pv-cyan-soft")} title={tcpdumpLine(p, o)}>
                    <span className="text-pv-text-faint">#{p.no} </span>
                    {tcpdumpLine(p, o)}
                  </button>
                  {open && (
                    <div className="space-y-1.5 border-t border-pv-border/60 p-1.5">
                      <Meaning p={p} o={o} coach={coach} />
                      <Layers layers={dlLayersAt(p, o)} />
                      {extra?.(p)}
                      <button type="button" onClick={() => setSel({ ...sel, tab: "follow", journey: p.journey, pick: undefined })} className="text-[11.5px] font-semibold text-pv-cyan-soft hover:underline">
                        Follow this message through the whole network →
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}

function Table({ title, how, coach, head, rows, empty }: { title: string; how?: string; coach: Coach; head: string[]; rows: (string | ReactNode)[][]; empty?: string }) {
  return (
    <div className="rounded-xl border border-pv-border p-2">
      <Lbl>{title}</Lbl>
      {coach === "guide" && how && <Tiny className="mt-0.5">{how}</Tiny>}
      {rows.length === 0 ? (
        <p className="mt-1 pv-mono text-[11px] text-pv-text-faint">{empty ?? "(empty)"}</p>
      ) : (
        <div className="mt-1 overflow-x-auto">
          <table className="w-full text-left pv-mono text-[11px]">
            <thead className="text-[10px] text-pv-text-faint">
              <tr>
                {head.map((h) => (
                  <th key={h} className="pr-2 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="text-pv-text">
              {rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j} className="pr-2 align-top">
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
const bad = (t: string) => <span className="text-pv-danger">{t}</span>;

export function StateTables({ lab, node, coach }: { lab: DlState; node: InspectNode; coach: Coach }) {
  const nm = useIfName();
  const n = lab.net;
  if (node === "CLIENT") {
    const c = lab.client;
    return (
      <div className="space-y-2">
        <Table
          title="IP configuration (ipconfig /all)"
          coach={coach}
          how="Everything here came from the DHCP ACK. A wrong gateway or DNS server is what the server handed out."
          head={["field", "value"]}
          rows={[
            ["state", c.phase],
            ["address", c.phase === "APIPA" ? bad(`${c.ip} (self-assigned)`) : (c.ip ?? "—")],
            ["gateway", c.gw ?? "—"],
            ["DNS server", c.dns ?? "—"],
            ["DHCP server", c.serverId ?? "—"],
            ["lease left", configured(c) ? `${Math.round(leaseLeft(lab) / 60)} min` : "—"],
          ]}
        />
        <Table title="ARP cache" coach={coach} how="Before sending to another subnet the client needs its gateway's MAC. “incomplete” = it asked and nobody answered." head={["IP", "MAC"]} rows={Object.entries(n.arp.CLIENT).map(([ip, m]) => [ip, m === "incomplete" ? bad("incomplete (no reply)") : m.toLowerCase()])} empty="(empty: the client hasn't needed to send to anyone yet)" />
        <Table title="DNS cache" coach={coach} how={`Answers kept for their TTL (${DNS_RECORD_TTL} s). While valid, lookups for that name send nothing.`} head={["name", "address", "TTL left"]} rows={lab.cache.map((e) => [e.name, e.ip, e.expires > lab.clock ? `${e.expires - lab.clock} s` : "expired"])} />
      </div>
    );
  }
  if (node === "SW1" || node === "SW2")
    return (
      <Table
        title="MAC address table"
        coach={coach}
        how="A line appears when a frame FROM that MAC arrives on that port. It proves frames from that device reached the switch, nothing about IP or DHCP."
        head={["MAC", "port", "device"]}
        rows={Object.entries(n.mac[node]).map(([m, port]) => [m.toLowerCase(), port, macName(m)])}
      />
    );
  if (node === "R1")
    return (
      <div className="space-y-2">
        <Table
          title="DHCP relay"
          coach={coach}
          how="A relay counts what it received from clients and passed to the server, and back. Requests forwarded but no replies = the server side is silent."
          head={["", ""]}
          rows={[
            ["helper", lab.config.relay && lab.config.helper ? (lab.config.helperIf === "ge-0/0/0" ? `${lab.config.helper} on ${nm("R1:ge-0/0/0")}` : bad(`${lab.config.helper} on ${nm(`R1:${lab.config.helperIf}` as DlIface)} (the servers' side)`)) : bad("not configured")],
            ["from clients → to server", `${n.relay.fromClients} → ${n.relay.toServer}`],
            ["from server → to clients", `${n.relay.fromServer} → ${n.relay.toClients}`],
          ]}
        />
        <Table title="ARP cache" coach={coach} how="R1 needs the next hop's MAC to forward. An incomplete entry = it asked and nobody owns that address." head={["IP", "MAC", "interface"]} rows={Object.entries(n.arp.R1).map(([ip, m]) => [ip, m === "incomplete" ? bad("incomplete") : m.toLowerCase(), ip.startsWith("10.10.10.") ? "ge-0/0/0" : "ge-0/0/1"])} />
        <Table title="Interfaces" coach={coach} head={["name", "address", "status"]} rows={(["R1:ge-0/0/0", "R1:ge-0/0/1", "R1:ge-0/0/2"] as DlIface[]).map((i) => [nm(i), DL_IFACES[i].ip!, "up"])} />
      </div>
    );
  if (node === "DHCP-SRV")
    return (
      <div className="space-y-2">
        <Table title="Service" coach={coach} how="“Host up” and “service running” are different things: the host can receive packets while nothing listens on UDP 67." head={["", ""]} rows={[["dhcpd", dhcpRunning(lab.config) ? "active (running)" : lab.config.serverUp ? bad(`failed: ${dhcpProblem(lab.config)}`) : bad("inactive (dead)")], ["listening", dhcpRunning(lab.config) ? "UDP 67" : bad("nothing on UDP 67")]]} />
        <Table title={lab.config.scope ? `Scope ${lab.config.scope.net}/24` : "Scope (none declared)"} coach={coach} how="These values go into every future ACK. Clients with a lease keep their old values until they renew." head={["", ""]} rows={[["range", lab.config.scope ? `${lab.config.scope.start} – ${lab.config.scope.end}` : bad("none")], ["free addresses", lab.config.poolFree <= 0 ? bad("0") : String(lab.config.poolFree)], ["option 3 router", lab.config.option3], ["option 6 DNS", lab.config.option6], ["lease", "86400 s"]]} />
        <Table title="Leases" coach={coach} head={["IP", "MAC", "until"]} rows={n.leases.map((l) => [l.ip, l.mac, l.state === "active" ? fmtT(l.ends) : "released"])} />
        <Table title="Log (dhcpd)" coach={coach} how="The server's own account. “via 10.10.10.1” = it came through the relay. No line = the request never reached the service." head={["time", "message"]} rows={n.logs["DHCP-SRV"].slice(-10).map((l) => [fmtT(l.t), l.text])} empty={dhcpRunning(lab.config) ? "(no DHCP requests have reached the service)" : "(the service is stopped: it logs nothing)"} />
      </div>
    );
  return (
    <div className="space-y-2">
      <Table title="Service" coach={coach} how="A DNS server host can answer pings while its DNS service is stopped." head={["", ""]} rows={[["named", lab.config.dnsUp ? "active (running)" : bad("inactive (dead)")], ["listening", lab.config.dnsUp ? "UDP 53" : bad("nothing on UDP 53")]]} />
      <Table title="Zone packetverse.test" coach={coach} head={["name", "A"]} rows={Object.entries(lab.records).map(([nm, ip]) => [nm, ip])} />
      <Table title="Query log" coach={coach} how="Every query that reached the service. A client whose lookups fail but never appears here is sending them somewhere else." head={["time", "message"]} rows={n.logs["DNS-SRV"].slice(-10).map((l) => [fmtT(l.t), l.text])} empty={lab.config.dnsUp ? "(no queries have reached the service)" : "(the service is stopped: it logs nothing)"} />
    </div>
  );
}

