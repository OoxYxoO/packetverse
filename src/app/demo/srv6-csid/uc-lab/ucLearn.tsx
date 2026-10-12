import type { ReactNode } from "react";
import type { SpLevel } from "@/components/sp-lab/spKit";
import type { UAction, UR, URtr } from "@/lib/sim-engine/scenarios/ucNet";

/**
 * SRv6 uSID Lab · Learn — six levels on the lab network:
 *   1 The cost of 128-bit SIDs · 2 What stays common · 3 One packet, hop by hop · 4 Crossing into the next carrier ·
 *   5 A local uSID means nothing elsewhere · 6 When it breaks
 */

const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const M = ({ children }: { children: ReactNode }) => <span className="pv-mono text-pv-text">{children}</span>;
const set = (text: string, changes: { dev: UR; f: (c: URtr) => void }[]): UAction => ({ type: "set", text, changes });
const p100: UAction = { type: "ping", size: 100 };
const p1430: UAction = { type: "ping", size: 1430 };
const stale = set("R6: the adjacency to R8 was re-created — its uA is now e003", [{ dev: "R6", f: (c) => void (c.xfn["ge-0/0/2"] = 0xe003) }]);
const classicR4 = set("R4: locator MAIN without micro-segment; PATH-A index 30 → R4's classic End fcbb:bb00:4:1::", [
  { dev: "R4", f: (c) => void (c.micro = false) },
  { dev: "R1", f: (c) => void (c.lists!["PATH-A"].find((e) => e.idx === 30)!.sid = "fcbb:bb00:4:1::") },
]);

export const UC_LEVELS: SpLevel<UAction>[] = [
  {
    n: 1,
    title: "The cost of 128-bit SIDs",
    idea: "Policy GREEN sends CUST's traffic through R2, R3, R4, R5 and R6's express link to R8. Written classically that is six 128-bit SIDs; packed as uSIDs it is two.",
    steps: [
      {
        title: "Same program, two encodings",
        body: <p>PATH-A has five SIDs, and BGP adds R8&apos;s uDT4 service SID: six. Classic SRv6 needs one 128-bit entry per SID — 40 bytes of outer IPv6 plus an SRH of 8 + 5 × 16 = 128 bytes. R1 packs them as uSIDs into two 128-bit carriers: 40 + 8 + 16 = <B>64 bytes</B>. The comparison is computed from the list R1 actually pushes.</p>,
        runs: [{ label: "Ping 100 bytes", actions: [p100] }],
        show: ["compare", "test"],
        check: { q: "What does compression remove?", options: [{ id: "a", label: "The repeated block and padding: many 16-bit uSIDs share one 128-bit carrier" }, { id: "b", label: "Some of the routers on the path" }, { id: "c", label: "The outer IPv6 header" }], answer: "a", why: "The path and the behaviors stay identical; only the encoding shrinks." },
      },
    ],
  },
  {
    n: 2,
    title: "What stays common",
    idea: "Every locator comes from one block, fcbb:bb00::/32. Only 16 bits per node differ — the node's uSID. A 128-bit carrier holds the block once and up to six uSIDs.",
    steps: [
      {
        title: "Block, uSIDs and local uSIDs",
        body: <p>R6&apos;s locator is <M>fcbb:bb00:6::/48</M> (flag U, micro-segment). Its <B>uN</B> is <M>fcbb:bb00:6::</M>: the uSID <M>6</M>. Its <B>uA</B> toward R8 is <M>fcbb:bb00:6:e002::</M>: two uSIDs, <M>6</M> then <M>e002</M> — a value from the local ID block that only R6 understands. R1 packed <M>2 3 4 5 6 e002</M> into one carrier and <M>8 e002</M> (R8&apos;s uDT4 — another local value, at R8) into the next.</p>,
        show: ["carriers", "sids"],
        check: { q: "Why can R6 and R8 both use e002 without conflict?", options: [{ id: "a", label: "Local ID block uSIDs only mean something at the node that just executed its uN" }, { id: "b", label: "They are in different blocks" }, { id: "c", label: "One of them is a mistake" }], answer: "a", why: "A local uSID follows its node's uN — R6 reads e002 as its uA, R8 as its uDT4." },
      },
    ],
  },
  {
    n: 3,
    title: "One packet, hop by hop",
    idea: "The active uSID is always bits 32–47 of the destination address. The router that owns it executes it and shifts the rest left; everyone else just routes the address to that owner's locator.",
    steps: [
      {
        title: "Shift, route, shift",
        body: <p>R1 sends DA <M>fcbb:bb00:2:3:4:5:6:e002</M>. R2 sees active uSID 2 — its uN — and shifts: <M>fcbb:bb00:3:4:5:6:e002::</M>. Segments Left stays 1: the SRH is untouched while the carrier still has uSIDs. R3, R4, R5 repeat it; each forwards on the next owner&apos;s /48 locator.</p>,
        runs: [{ label: "Ping 100 bytes", actions: [p100] }],
        show: ["hops", "path"],
      },
    ],
  },
  {
    n: 4,
    title: "Crossing into the next carrier",
    idea: "At R6 the carrier runs out: R6 executes its uN, then its local uA e002, and only then copies the next SRH entry into the destination address — and sends it out of the express link.",
    steps: [
      {
        title: "R6: uN, uA, next carrier",
        body: <p>After the shift, the DA is <M>fcbb:bb00:e002::</M> — R6&apos;s uA toward R8. Nothing follows it in the carrier, so R6 copies <M>fcbb:bb00:8:e002::</M> from the SRH (Segments Left 1 → 0) and forwards out Gi0/0/0/2 to R8. R8 executes uN 8, then e002 — its uDT4 — and delivers to CE8: 11 ms over the express link.</p>,
        runs: [{ label: "Ping 100 bytes", actions: [p100] }],
        show: ["hops", "test"],
        check: { q: "When does Segments Left change?", options: [{ id: "a", label: "Only when a carrier is exhausted and the next SRH entry is copied in" }, { id: "b", label: "At every router" }, { id: "c", label: "Never with uSIDs" }], answer: "a", why: "Shifts stay inside the carrier; the SRH moves only between carriers." },
      },
    ],
  },
  {
    n: 5,
    title: "A local uSID means nothing elsewhere",
    idea: "R6's adjacency to R8 is re-created and its uA becomes e003. PATH-A still says e002. When e002 becomes active at R6, R6 has no such local uSID — and nobody else can route it.",
    steps: [
      {
        title: "A stale e002",
        body: <p>Global uSIDs (2, 3 … 8) are routed on their locators. Local ones (e000–efff) are never routed: they only work right after their node&apos;s uN. R6 now has e000, e001, e003 — the packet with active <M>e002</M> dies at R6.</p>,
        pre: [stale],
        runs: [{ label: "Ping 100 bytes", actions: [p100] }],
        show: ["test", "hops"],
      },
    ],
  },
  {
    n: 6,
    title: "When it breaks",
    idea: "The guided lesson's incident: one router can't take part in compression. Here R4's locator loses its micro-segment behavior — R4's SID becomes classic, takes its own 128-bit entry, and the header grows.",
    steps: [
      {
        title: "R4 goes classic",
        body: <p>R4 now advertises a classic End, <M>fcbb:bb00:4:1::</M>, and the provisioning tool put it into PATH-A. R1 can&apos;t pack it: three entries — <M>[2 3]</M> | R4&apos;s classic SID | <M>[5 6 e002 8 e002]</M>. Same path, 80 bytes of overhead: a 100-byte ping works, a 1430-byte packet no longer fits the 1500-byte MTU.</p>,
        pre: [classicR4],
        runs: [{ label: "Ping 100 and 1430 bytes", actions: [p100, p1430] }],
        show: ["test", "compare", "ladder"],
        check: { q: "Is R4 unreachable?", options: [{ id: "a", label: "No — R4 is reachable and executes its SID; it just can't be compressed" }, { id: "b", label: "Yes" }, { id: "c", label: "Only for big packets" }], answer: "a", why: "Reachable but not compressible: the encoding, not the path, changed." },
      },
    ],
  },
];
