"use client";

import { clsx } from "clsx";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import type { DlPacket } from "@/lib/sim-engine/scenarios/dhcpDnsLab";
import { QUESTION_MAP } from "./LearnPath";

/**
 * The Concepts drawer: short reminders a student can open from the engineering workspace without losing the
 * investigation ("what was giaddr again?", "why ports 67/68?"). Each concept links back to the learn level that
 * teaches it, and packets offer the concepts they contain.
 */

export type ConceptId = "story" | "devices" | "relay" | "dora" | "ports" | "options" | "dns" | "arp" | "unreachable" | "checkpoints" | "capture" | "ttl" | "tools";
const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const M = ({ children }: { children: ReactNode }) => <span className="pv-mono text-pv-text">{children}</span>;

export const CONCEPTS: Record<ConceptId, { title: string; level?: 1 | 2 | 3 | 4; body: ReactNode }> = {
  story: { title: "The whole story in six lines", level: 1, body: <ol className="list-decimal space-y-0.5 pl-5"><li>The laptop needs network settings.</li><li>It asks for them (a broadcast).</li><li>The request has to reach the DHCP server (through R1&apos;s relay).</li><li>The server answers.</li><li>The laptop receives an address, a router and a DNS server.</li><li>Then it uses DNS to turn names into addresses.</li></ol> },
  devices: { title: "Who does what", level: 2, body: <ul className="space-y-0.5"><li><B>Switches</B> carry frames inside one network and never read IP, DHCP or DNS.</li><li><B>R1</B> joins the two networks: it relays the DHCP broadcast and routes normal messages.</li><li><B>DHCP-SRV</B> decides addresses and settings. <B>DNS-SRV</B> answers names.</li></ul> },
  relay: { title: "Broadcasts, the relay and giaddr", level: 2, body: <><p>A laptop without an address sends from <M>0.0.0.0</M> to <M>255.255.255.255</M>: everyone on its own network. Routers don&apos;t pass broadcasts on.</p><p>R1&apos;s <B>DHCP relay</B> (ip helper-address, on the interface facing the laptops) catches it and sends a <B>new</B> message to the DHCP server, from R1&apos;s own address. It writes <B>giaddr</B> = its address on the laptops&apos; network (<M>10.10.10.1</M>): the server picks the scope whose subnet contains giaddr.</p></> },
  dora: { title: "The four DHCP messages, and xid", level: 1, body: <><p><B>DISCOVER</B> (anyone there?) → <B>OFFER</B> (you can have this address) → <B>REQUEST</B> (I&apos;ll take it, from you) → <B>ACK</B> (confirmed, with the settings).</p><p>All four share a ticket number, the <B>xid</B>, so you can match them in a capture. Nothing is configured on the laptop until the ACK.</p></> },
  ports: { title: "Why UDP ports 67, 68 and 53", level: 4, body: <><p>DHCP always uses UDP <B>67</B> (servers) and <B>68</B> (clients); DNS servers listen on UDP <B>53</B>. That is how you recognize them in a capture, and why filters use them.</p><p>Seeing UDP 67 at a point proves DHCP traffic got there. An empty filtered capture proves it never did.</p></> },
  options: { title: "Lease options 3 and 6", level: 4, body: <p>The ACK carries the settings: <B>option 3</B> = the router (default gateway), <B>option 6</B> = the DNS server, plus the lease time. They are copied from the server&apos;s scope at that moment; a laptop keeps them until it renews.</p> },
  dns: { title: "DNS questions, answers and the cache", level: 1, body: <p>The laptop asks the DNS server from option 6 (UDP 53) and matches the answer by its Transaction ID. It remembers the answer for the record&apos;s <B>TTL</B>; while it&apos;s valid, asking again sends nothing. “No such name” (NXDOMAIN) is a real answer: the server works, the record doesn&apos;t exist.</p> },
  arp: { title: "ARP: hardware addresses", body: <p>To send anything to another device on its own network (often the router), a device first needs its hardware (MAC) address: it asks “who has 10.10.10.1?”. An <B>incomplete</B> entry means it asked and nobody answered: nothing can be sent there.</p> },
  unreachable: { title: "Port unreachable: host up, service down", body: <p>If a computer is on but no program listens on the port (UDP 67 for DHCP, 53 for DNS), it answers <B>ICMP port unreachable</B>. The traffic arrived; the service didn&apos;t answer. A ping to that computer still works.</p> },
  checkpoints: { title: "Checkpoints: the last ✓ is where to dig", level: 3, body: <p>Ask place by place: did the laptop send it? Did it reach the router? Did it leave the router&apos;s other side? Did it reach the server? Did an answer come back? The last place that saw the message is where the problem is.</p> },
  capture: { title: "What a capture proves (and doesn't)", level: 4, body: <p>A capture records what crossed <B>one cable</B>. It proves a message got there, or (when empty) that it didn&apos;t. It doesn&apos;t prove a server processed what arrived: look for the answer, the service status and its log.</p> },
  ttl: { title: "Two different TTLs", body: <p>The IPv4 <B>TTL</B> in a packet is a hop limit: each router lowers it by one (64 → 63). The DNS record <B>TTL</B> is how many seconds an answer may be cached. Same name, unrelated meanings.</p> },
  tools: {
    title: "Which tool answers which question",
    body: (
      <ul className="space-y-0.5">
        {QUESTION_MAP.map((q) => (
          <li key={q.q}>
            {q.q} <span className="text-pv-text-faint">→ {q.where}</span>
          </li>
        ))}
      </ul>
    ),
  },
};

/** The concepts a packet illustrates (offered under packet details). */
export function conceptsForPacket(p: DlPacket): ConceptId[] {
  const f = (k: string) => p.layers.flatMap((l) => l.fields).find((x) => x.k === k)?.v;
  const out: ConceptId[] = [];
  if (p.proto === "DHCP") {
    out.push("dora", "ports");
    if (p.src === "0.0.0.0" || p.dst.startsWith("255.255.255.255") || (f("giaddr") && f("giaddr") !== "0.0.0.0")) out.push("relay");
    if (f("opt 3 router")) out.push("options");
  }
  if (p.proto === "DNS") out.push("dns", "ports");
  if (p.proto === "ARP") out.push("arp");
  if (p.msg === "Port unreachable") out.push("unreachable");
  if (p.layers.some((l) => l.name === "IPv4")) out.push("ttl");
  return out;
}
export function ConceptChips({ ids, onOpen }: { ids: ConceptId[]; onOpen: (id: ConceptId) => void }) {
  if (!ids.length) return null;
  return (
    <p className="flex flex-wrap items-center gap-1 text-[11px] text-pv-text-faint">
      Need a reminder?
      {ids.map((id) => (
        <button key={id} type="button" onClick={() => onOpen(id)} className="rounded-full border border-pv-border px-2 py-0.5 text-pv-text-muted hover:border-pv-cyan/60 hover:text-pv-text">
          {CONCEPTS[id].title}
        </button>
      ))}
    </p>
  );
}

export function ConceptsDrawer({ open, focus, onClose, onFocus, onLearn }: { open: boolean; focus?: ConceptId; onClose: () => void; onFocus: (id: ConceptId | undefined) => void; onLearn: (level: 1 | 2 | 3 | 4) => void }) {
  if (!open || typeof document === "undefined") return null;
  const ids = Object.keys(CONCEPTS) as ConceptId[];
  // Portalled: the drawer must overlay whichever panel is visible (on phones the task and tools are separate tabs).
  return createPortal(
    <div className="fixed inset-0 z-[200] flex justify-end bg-black/40" onClick={onClose} role="presentation">
      <aside role="dialog" aria-label="Concepts" onClick={(e) => e.stopPropagation()} className="pv-pop h-full w-full max-w-md overflow-y-auto border-l border-pv-border bg-pv-bg p-4 shadow-2xl">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div>
            <p className="text-[15px] font-bold text-pv-text">Concepts</p>
            <p className="text-[12px] text-pv-text-muted">Your investigation stays exactly where you left it.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full border border-pv-border px-3 py-1 text-[12.5px] font-semibold text-pv-text">
            Back to my investigation
          </button>
        </div>
        <ul className="space-y-1.5">
          {ids.map((id) => {
            const c = CONCEPTS[id];
            const on = focus === id;
            return (
              <li key={id} className={clsx("rounded-xl border", on ? "border-pv-cyan/60 bg-pv-cyan/[0.05]" : "border-pv-border")}>
                <button type="button" aria-expanded={on} onClick={() => onFocus(on ? undefined : id)} className="w-full px-3 py-2 text-left text-[13.5px] font-semibold text-pv-text">
                  {c.title}
                </button>
                {on && (
                  <div className="space-y-1.5 px-3 pb-2.5 text-[13px] leading-relaxed text-pv-text-muted">
                    {c.body}
                    {c.level && (
                      <button type="button" onClick={() => onLearn(c.level!)} className="text-[12px] font-semibold text-pv-cyan-soft hover:underline">
                        Revisit it in Learn, level {c.level} → (you can come back to the workspace)
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </aside>
    </div>,
    document.body,
  );
}
