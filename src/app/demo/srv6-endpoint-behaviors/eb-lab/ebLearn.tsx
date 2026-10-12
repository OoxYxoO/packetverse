import type { ReactNode } from "react";
import type { SpLevel } from "@/components/sp-lab/spKit";
import { DOC, type EbAction, type EbR, type EbRtr } from "@/lib/sim-engine/scenarios/ebNet";

/**
 * SRv6 Endpoint Behaviors Lab · Learn — six levels on the guided lesson's network:
 *   1 One table, many behaviors · 2 End vs End.X · 3 Decapsulate and look up · 4 The rules of the last segment ·
 *   5 Cross-connect instead of look up · 6 When it breaks
 */

const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const M = ({ children }: { children: ReactNode }) => <span className="pv-mono text-pv-text">{children}</span>;
const set = (text: string, changes: { dev: EbR; f: (c: EbRtr) => void }[]): EbAction => ({ type: "set", text, changes });
const send = (sids: string[], inner: string): EbAction => ({ type: "send", sids, inner });
const perCe = set("R6: VRF CUST4 alloc mode per-ce", [{ dev: "R6", f: (c) => void (c.vrfs.CUST4!.mode = "per-ce") }]);
const ce4bOut = set("R6: CE4-B's interface out of VRF CUST4", [{ dev: "R6", f: (c) => void (c.ceVrf["ge-0/0/4"] = undefined) }]);
/** With CUST4 per-ce, R6's dynamic SIDs are …:42 (DX4 → CE4-A) and …:43 (DX4 → CE4-B). */
const DX_A = "2001:db8:100:6:42::";
const DX_B = "2001:db8:100:6:43::";

export const EB_LEVELS: SpLevel<EbAction>[] = [
  {
    n: 1,
    title: "One table, many behaviors",
    idea: "A SID is an instruction, and the local SID table says which one. IS-IS allocates End and End.X; BGP allocates the service SIDs that hand packets to customers.",
    steps: [
      {
        title: "R3 and R6",
        body: (
          <p>
            R3&apos;s table: <B>End</B> (<M>…:3:1::</M>) and one <B>End.X</B> per neighbor — toward R2, R6 and, across the cross-link, R4 (<M>…:3:42::</M>). R6&apos;s table adds what BGP allocated for its two VRFs: <B>End.DT4</B> for CUST4 (<M>…:6:42::</M>) and <B>End.DT6</B> for CUST6 (<M>…:6:43::</M>).
          </p>
        ),
        show: ["sids"],
        check: { q: "Who allocated R6's End.DT4 SID?", options: [{ id: "a", label: "BGP, for VRF CUST4 (alloc mode per-vrf)" }, { id: "b", label: "IS-IS, like End" }, { id: "c", label: "The headend R1" }], answer: "a", why: "Service SIDs belong to the service — on IOS XR, BGP allocates them per VRF or per CE." },
      },
    ],
  },
  {
    n: 2,
    title: "End vs End.X",
    idea: "End: next segment, then route normally. End.X: next segment, and leave through this one link — whatever routing says.",
    steps: [
      {
        title: "Through R3 with End",
        body: <p>Send <M>[R3 End, CUST4 SID]</M> to CE4-B (10.10.2.8). At R3, End moves to the next segment and R3 routes toward R6&apos;s locator — the direct link, cost 10.</p>,
        runs: [{ label: "Send [R3 End, CUST4] to 10.10.2.8", actions: [send([DOC.endR3, DOC.dt4], "10.10.2.8")] }],
        show: ["test", "path"],
      },
      {
        title: "Through R3 with End.X",
        body: <p>Now <M>[R3 End.X → R4, CUST4 SID]</M>. Same next segment — but End.X sends it out R3&apos;s link to R4, which no shortest path uses. The packet goes R3 → R4 → R5 → R6.</p>,
        runs: [{ label: "Send [R3 End.X→R4, CUST4] to 10.10.2.8", actions: [send([DOC.endXR3R4, DOC.dt4], "10.10.2.8")] }],
        show: ["test", "headers"],
        check: { q: "What is different in the packet R3 sends?", options: [{ id: "a", label: "Nothing — same DA, same SRH state; only the exit link differs" }, { id: "b", label: "End.X adds a label" }, { id: "c", label: "End.X keeps Segments Left at 1" }], answer: "a", why: "The rewrite is identical; End.X just fixes the next hop." },
      },
    ],
  },
  {
    n: 3,
    title: "Decapsulate and look up",
    idea: "End.DT4 / End.DT6: remove the outer header, then look the inner packet up in the VRF's table. One SID serves the whole VRF.",
    steps: [
      {
        title: "Two customers, one SID",
        body: <p>Send the CUST4 SID with an inner packet for 10.10.2.8, then for 10.10.1.8. R6 decapsulates and looks each up in VRF CUST4 — and finds CE4-B, then CE4-A. The SID didn&apos;t pick the customer; the lookup did.</p>,
        runs: [
          { label: "Send [CUST4] to 10.10.2.8", actions: [send([DOC.dt4], "10.10.2.8")] },
          { label: "Send [CUST4] to 10.10.1.8", actions: [send([DOC.dt4], "10.10.1.8")] },
        ],
        show: ["test", "vrfs"],
      },
      {
        title: "The IPv6 customer",
        body: <p>CUST6 is an IPv6 VRF: its SID is End.DT6. An inner IPv6 packet for <M>2001:db8:c6::6</M> is looked up in CUST6 and delivered to CE6.</p>,
        runs: [{ label: "Send [CUST6] to 2001:db8:c6::6", actions: [send([DOC.dt6], "2001:db8:c6::6")] }],
        show: ["test", "path"],
      },
    ],
  },
  {
    n: 4,
    title: "The rules of the last segment",
    idea: "A decapsulation behavior ends the SRv6 journey, so it must be the last segment — and the inner packet must be the family it expects.",
    steps: [
      {
        title: "Not the last segment",
        body: <p>Send <M>[CUST4 SID, R3 End]</M>: R6 receives its End.DT4 SID with one segment still left. Decapsulating now would throw away the rest of the program — R6 drops it.</p>,
        runs: [{ label: "Send [CUST4, R3 End] to 10.10.2.8", actions: [send([DOC.dt4, DOC.endR3], "10.10.2.8")] }],
        show: ["test"],
      },
      {
        title: "The wrong family",
        body: <p>Send the CUST6 SID with an IPv4 packet inside. End.DT6 can only look up IPv6 — R6 drops it.</p>,
        runs: [{ label: "Send [CUST6] to 10.10.2.8", actions: [send([DOC.dt6], "10.10.2.8")] }],
        show: ["test"],
        check: { q: "Why not just look the IPv4 packet up somewhere?", options: [{ id: "a", label: "End.DT6 names an IPv6 table; an IPv4 packet has no meaning there" }, { id: "b", label: "IPv4 can't be encapsulated in IPv6" }, { id: "c", label: "R6 has no IPv4" }], answer: "a", why: "The behavior defines the lookup: DT4 = IPv4 table, DT6 = IPv6 table (DT46 would accept both)." },
      },
    ],
  },
  {
    n: 5,
    title: "Cross-connect instead of look up",
    idea: "End.DX4 / End.DX6: remove the outer header and send the inner packet to one specific CE — no lookup. One SID per CE.",
    steps: [
      {
        title: "Per-CE SIDs",
        body: <p>Switch VRF CUST4 to <B>alloc mode per-ce</B>. BGP replaces End.DT4 with one <B>End.DX4</B> per CE: <M>…:6:42::</M> → CE4-A, <M>…:6:43::</M> → CE4-B (End.DT6 moves to <M>…:6:44::</M> — dynamic SIDs are renumbered). Send to CE4-B with its own DX SID.</p>,
        pre: [perCe],
        runs: [{ label: "Send [DX4 → CE4-B] to 10.10.2.8", actions: [send([DX_B], "10.10.2.8")] }],
        show: ["sids", "test"],
      },
      {
        title: "The guided lesson's incident",
        body: <p>Now send 10.10.2.8 with CE4-A&apos;s DX SID — what the runbook&apos;s old CUST4 SID has become. R6 decapsulates and hands the packet to CE4-A without looking at the destination. Delivered — to the wrong customer.</p>,
        pre: [perCe],
        runs: [{ label: "Send [DX4 → CE4-A] to 10.10.2.8", actions: [send([DX_A], "10.10.2.8")] }],
        show: ["test", "path"],
        check: { q: "Why didn't R6 notice the destination belonged to CE4-B?", options: [{ id: "a", label: "End.DX4 does no lookup — the SID alone decides the CE" }, { id: "b", label: "CE4-A and CE4-B share a subnet" }, { id: "c", label: "The SRH pointed at CE4-A" }], answer: "a", why: "That is the point of DX: fast and simple, but only as right as the SID you chose." },
      },
    ],
  },
  {
    n: 6,
    title: "When it breaks",
    idea: "A SID can be perfectly right and still fail: the behavior runs, but what it relies on — the VRF table, the adjacency — is missing.",
    steps: [
      {
        title: "CE4-B left the VRF",
        body: <p>CE4-B&apos;s interface on R6 loses <M>vrf CUST4</M>. The CUST4 SID still exists and End.DT4 still runs — it decapsulates and looks 10.10.2.8 up in CUST4, where there is no route any more.</p>,
        pre: [ce4bOut],
        runs: [{ label: "Send [CUST4] to 10.10.2.8", actions: [send([DOC.dt4], "10.10.2.8")] }],
        show: ["test", "ladder"],
      },
      {
        title: "Read the ladder",
        body: <p>The ladder: where did it die, does every SID exist, is the service SID last, does the family match, what do the VRFs allocate and contain, are R3&apos;s End.X SIDs there.</p>,
        pre: [ce4bOut],
        runs: [{ label: "Send [CUST4] to 10.10.2.8", actions: [send([DOC.dt4], "10.10.2.8")] }],
        show: ["ladder"],
        check: { q: "Which rung shows the cause?", options: [{ id: "a", label: "The VRFs: CUST4 has CE4-A only" }, { id: "b", label: "The SIDs" }, { id: "c", label: "The family" }], answer: "a", why: "The SID and the behavior are fine; the table behind End.DT4 is incomplete." },
      },
    ],
  },
];
