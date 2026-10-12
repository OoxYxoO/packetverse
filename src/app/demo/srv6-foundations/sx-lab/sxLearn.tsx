import type { ReactNode } from "react";
import type { SpLevel } from "@/components/sp-lab/spKit";
import { TO_R6, VIA_R3, endSid, type SxAction, type SxR, type SxRtr } from "@/lib/sim-engine/scenarios/sxNet";

/**
 * SRv6 Foundations Lab · Learn — six levels on the guided lesson's hexagon:
 *   1 Addresses that are instructions · 2 The underlay first · 3 A segment list and the SRH · 4 End at work ·
 *   5 Same SID, another path · 6 When it breaks
 */

const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const M = ({ children }: { children: ReactNode }) => <span className="pv-mono text-pv-text">{children}</span>;
const set = (text: string, changes: { dev: SxR; f: (c: SxRtr) => void }[]): SxAction => ({ type: "set", text, changes });
const plain: SxAction = { type: "plain" };
const send = (sids: string[]): SxAction => ({ type: "send", sids });
const slow45 = set("R4–R5 metric 50 on both ends", [
  { dev: "R4", f: (c) => void (c.ifs["ge-0/0/1"]!.metric = 50) },
  { dev: "R5", f: (c) => void (c.ifs["ge-0/0/0"]!.metric = 50) },
]);
const r3broken = set("R3: locator out of IS-IS, Loopback1 advertises 2001:db8:100:3::/64", [{ dev: "R3", f: (c) => void Object.assign(c, { isisLoc: false, lo1: true }) }]);

export const SX_LEVELS: SpLevel<SxAction>[] = [
  {
    n: 1,
    title: "Addresses that are instructions",
    idea: "An SRv6 SID is a 128-bit IPv6 address: a locator that routes to the node, and a function that tells the node what to do. The local SID table binds the function to a behavior.",
    steps: [
      {
        title: "Locator + function",
        body: (
          <p>
            Each router owns a locator: R3&apos;s is <M>2001:db8:100:3::/64</M>. Enabled in IS-IS, it is advertised to everyone, and IS-IS allocates R3&apos;s <B>End SID</B> under it: <M>2001:db8:100:3:1::</M> — locator, then function <M>1</M>. Plus one End.X SID per neighbor (<M>:40::</M>, <M>:41::</M>). Look at the local SID tables.
          </p>
        ),
        show: ["sids"],
        check: { q: "Is every address inside 2001:db8:100:3::/64 a SID?", options: [{ id: "a", label: "No — only the ones R3 has instantiated in its local SID table" }, { id: "b", label: "Yes — the whole locator is the SID" }, { id: "c", label: "Only addresses ending in ::1" }], answer: "a", why: "The locator routes the packet to R3; only a local SID entry tells R3 what to do with it." },
      },
    ],
  },
  {
    n: 2,
    title: "The underlay first",
    idea: "SRv6 rides on plain IPv6 routing: SIDs are reached by longest match on the locator routes. Transit routers need no SRv6 at all.",
    steps: [
      {
        title: "Plain IPv6",
        body: <p>H1 pings H6 over plain IPv6. IS-IS takes the bottom: R1 → R4 → R5 → R6, cost 15. No SRv6 involved — but the same routes carry the locators.</p>,
        runs: [{ label: "Ping 2001:db8:6::20 from H1", actions: [plain] }],
        show: ["test", "locs"],
      },
      {
        title: "One SID, no SRH",
        body: <p>Now R1 encapsulates H1&apos;s packet toward R6&apos;s End SID only: outer DA <M>2001:db8:100:6:1::</M>, no SRH (one SID needs none). R4 and R5 forward on the outer DA like any IPv6 packet — it matches R6&apos;s locator route. R6 finds the DA in its local SID table: End with Segments Left 0 → it removes the outer header (<B>USD</B>) and delivers the inner packet.</p>,
        runs: [{ label: "Send [R6 End] from R1", actions: [send(TO_R6)] }],
        show: ["headers", "path"],
        check: { q: "What do R4 and R5 need to forward this packet?", options: [{ id: "a", label: "Just an IPv6 route to 2001:db8:100:6::/64" }, { id: "b", label: "SRv6 enabled and R6's SID in their tables" }, { id: "c", label: "An MPLS label for R6" }], answer: "a", why: "Only the node that owns the active SID processes it; everyone else is plain IPv6." },
      },
    ],
  },
  {
    n: 3,
    title: "A segment list and the SRH",
    idea: "For more than one SID, R1 adds a Segment Routing Header. The list is stored in reverse; Segments Left points at the active one, which is also copied into the destination address.",
    steps: [
      {
        title: "Through R3",
        body: (
          <p>
            Send <M>[R3 End, R6 End]</M>. R1 sets DA = R3&apos;s SID and adds an SRH with the rest: <M>Segment List [0] = R6&apos;s SID</M>, <B>Segments Left 1</B>. (IOS XR uses reduced encapsulation: the first SID lives only in the DA.) The packet takes the top path to R3, because that is where R3&apos;s locator is.
          </p>
        ),
        runs: [{ label: "Send [R3 End, R6 End] from R1", actions: [send(VIA_R3)] }],
        show: ["headers", "path"],
        check: { q: "Where is the active segment?", options: [{ id: "a", label: "In the IPv6 destination address" }, { id: "b", label: "At Segment List [0]" }, { id: "c", label: "In the source address" }], answer: "a", why: "Routers forward on the DA; the SRH only stores what comes next." },
      },
    ],
  },
  {
    n: 4,
    title: "End at work",
    idea: "End: if Segments Left > 0, decrement it and copy the next SID into the DA. The penultimate node removes the SRH (PSP); the last one removes the outer header (USD).",
    steps: [
      {
        title: "What R3 and R6 do",
        body: <p>At R3 the DA matches its End SID: Segments Left 1 → 0, DA = R6&apos;s SID — and because no segment is left, R3 removes the SRH (<B>PSP</B>). R6 receives a plain encapsulated packet whose DA is its own End SID with nothing left: <B>USD</B>, the inner packet goes to H6. Follow the headers hop by hop.</p>,
        runs: [{ label: "Send [R3 End, R6 End] from R1", actions: [send(VIA_R3)] }],
        show: ["headers"],
        check: { q: "What did R2 change in the packet?", options: [{ id: "a", label: "Nothing but the hop limit — it is a transit router" }, { id: "b", label: "It decremented Segments Left" }, { id: "c", label: "It swapped the DA" }], answer: "a", why: "Segments Left changes only where a SID is executed, not per hop." },
      },
      {
        title: "Three SIDs",
        body: <p>Send <M>[R5 End, R3 End, R6 End]</M>. After R5, the packet heads for R3 — on R5&apos;s shortest path, through R6. R6 forwards it as a transit router (the DA is R3&apos;s SID, not its own), R3 executes End, and the packet comes back to R6 to end.</p>,
        runs: [{ label: "Send [R5 End, R3 End, R6 End] from R1", actions: [send([endSid(5), endSid(3), endSid(6)])] }],
        show: ["headers", "path"],
      },
    ],
  },
  {
    n: 5,
    title: "Same SID, another path",
    idea: "A SID names a node and an instruction, not a path. How the packet gets to the node is ordinary IPv6 routing toward its locator.",
    steps: [
      {
        title: "The bottom slows down",
        body: <p>Raise R4–R5 to metric 50. The best way to R6&apos;s locator is now the top (cost 30). Send to R6&apos;s End SID again: same SID, same encapsulation, different path — nothing in the packet changed.</p>,
        pre: [slow45],
        runs: [{ label: "Send [R6 End] from R1", actions: [send(TO_R6)] }],
        show: ["test", "locs"],
      },
    ],
  },
  {
    n: 6,
    title: "When it breaks",
    idea: "A locator route says how to reach a node. Only a local SID says what the node does. You can have the first without the second.",
    steps: [
      {
        title: "R3's SID is gone",
        body: <p>R3&apos;s locator is taken out of IS-IS during a migration — no End SID any more — while an old Loopback1 keeps advertising <M>2001:db8:100:3::/64</M> as a plain prefix. Everyone still routes R3&apos;s SID to R3, and R3 drops it: there is no local SID to execute.</p>,
        pre: [r3broken],
        runs: [{ label: "Send [R3 End, R6 End] from R1", actions: [send(VIA_R3)] }],
        show: ["test", "ladder"],
      },
      {
        title: "Read the ladder",
        body: <p>The ladder checks in order: what happened to the test, whether plain IPv6 works, whether R1 can encapsulate, whether every locator is advertised as one, whether every SID in the list exists on its owner, and whether there is MTU headroom.</p>,
        pre: [r3broken],
        runs: [{ label: "Send [R3 End, R6 End] from R1", actions: [send(VIA_R3)] }],
        show: ["ladder"],
        check: { q: "Which rung shows the cause?", options: [{ id: "a", label: "R3's End SID: routed, but no router has it" }, { id: "b", label: "Plain IPv6" }, { id: "c", label: "MTU" }], answer: "a", why: "Routing to R3 works; the instruction at R3 is missing." },
      },
    ],
  },
];
