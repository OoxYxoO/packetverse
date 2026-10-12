import type { ReactNode } from "react";
import type { SpLevel } from "@/components/sp-lab/spKit";
import type { VsAction, VsCe, VsCfg, VsR } from "@/lib/sim-engine/scenarios/vsNet";

/**
 * VPLS Lab · Learn — six levels:
 *   1 One LAN across the provider · 2 Learning and flooding · 3 Split horizon and the full mesh · 4 Two labels on the
 *   wire · 5 The transport underneath · 6 Read the evidence
 */

const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const M = ({ children }: { children: ReactNode }) => <span className="pv-mono text-pv-text">{children}</span>;
const set = (text: string, dev: VsR, f: (c: VsCfg) => void): VsAction => ({ type: "set", text, changes: [{ dev, f }] });
const ping = (from: VsCe, dst: string): VsAction => ({ type: "test", from, dst });
const clear: VsAction = { type: "clear" };
const noPe1AtPe3 = set("PE3: neighbor 1.1.1.1 removed from the VPLS", "PE3", (c) => void (c.bd!.nbrs = c.bd!.nbrs.filter((n) => n.ip !== "1.1.1.1")));

export const VS_LEVELS: SpLevel<VsAction>[] = [
  {
    n: 1,
    title: "One LAN across the provider",
    idea: "VPLS makes several customer sites behave like ports of one Ethernet switch, stretched across the provider.",
    steps: [
      {
        title: "Three sites, one subnet",
        body: (
          <p>
            CE1, CE2 and CE3 sit at three different PEs, yet they share one subnet, <M>192.168.100.0/24</M>, as if plugged into one switch. Ping CE2 and CE3 from CE1: both answer. No router in the path looks at those IP addresses.
          </p>
        ),
        runs: [
          { label: "Ping 192.168.100.2 from CE1", actions: [ping("CE1", "192.168.100.2")] },
          { label: "Ping 192.168.100.3 from CE1", actions: [ping("CE1", "192.168.100.3")] },
        ],
        show: ["test", "pws"],
        check: { q: "What makes VPLS different from the VPWS of the previous lesson?", options: [{ id: "a", label: "Many sites, so the PE must decide which remote PE a frame goes to — it learns MAC addresses like a switch" }, { id: "b", label: "It routes the customer's IP packets" }, { id: "c", label: "It needs no pseudowires" }], answer: "a", why: "A VPWS has one other end. A VPLS has many, so each PE bridges: it learns where each MAC lives and floods what it doesn't know." },
      },
      {
        title: "Each PE is a bridge",
        body: <p>Every PE runs a small Ethernet bridge for the service: its ports are the local attachment circuit and one pseudowire to each other PE. The P routers in the middle have no idea a customer LAN exists.</p>,
        show: ["pws", "macs"],
      },
    ],
  },
  {
    n: 2,
    title: "Learning and flooding",
    idea: "A PE learns each source MAC on the port it arrived on, sends known destinations to one port, and floods the rest.",
    steps: [
      {
        title: "The first frame floods",
        body: <p>Start with empty MAC tables. CE1 knows nothing about CE3 either, so it broadcasts an ARP request. PE1 floods it over <B>both</B> pseudowires; PE2 and PE3 deliver it to their CEs. On the way every PE learns CE1&apos;s MAC — and from CE3&apos;s reply, PE1 learns CE3&apos;s MAC behind the pseudowire to PE3.</p>,
        pre: [clear],
        runs: [{ label: "Ping 192.168.100.3 from CE1 (empty tables)", actions: [ping("CE1", "192.168.100.3")] }],
        show: ["path", "macs"],
      },
      {
        title: "The second frame doesn't",
        body: <p>Ping again. CE1 has CE3 in its ARP cache now, and PE1 knows CE3&apos;s MAC is behind PE3: the echo request goes over one pseudowire only. PE2 sees nothing.</p>,
        pre: [clear, ping("CE1", "192.168.100.3")],
        runs: [{ label: "Ping 192.168.100.3 from CE1 again", actions: [ping("CE1", "192.168.100.3")] }],
        show: ["path", "macs"],
        check: { q: "PE2 learned CE1's MAC but never CE3's. Why?", options: [{ id: "a", label: "CE3's frames were unicast to PE1 — they never passed PE2" }, { id: "b", label: "PE2 doesn't learn from pseudowires" }, { id: "c", label: "Split horizon hides CE3 from PE2" }], answer: "a", why: "A PE learns only from frames it receives. CE3's reply went straight from PE3 to PE1, which already knew CE1." },
      },
    ],
  },
  {
    n: 3,
    title: "Split horizon and the full mesh",
    idea: "A frame received on a pseudowire is never sent out another pseudowire — so every PE needs a direct pseudowire to every other PE.",
    steps: [
      {
        title: "Why no loops",
        body: <p>Three PEs, three pseudowires: a triangle. If PE2 forwarded PE1&apos;s broadcast to PE3, and PE3 forwarded it back to PE1, the frame would circle forever — Ethernet has no TTL. VPLS forbids it: a frame from a pseudowire goes only to local attachment circuits (<B>split horizon</B>).</p>,
        show: ["pws"],
      },
      {
        title: "Remove one pseudowire",
        body: <p>Take 1.1.1.1 out of PE3&apos;s neighbor list. The PE1–PE3 pseudowire goes down. CE1 still reaches CE2, and CE2 reaches CE3 — but CE1 and CE3 lose each other: PE2 holds both of the other pseudowires and may not relay between them.</p>,
        runs: [{ label: "PE3: remove neighbor 1.1.1.1, then ping CE2 and CE3 from CE1", actions: [noPe1AtPe3, ping("CE1", "192.168.100.2"), ping("CE1", "192.168.100.3")] }],
        show: ["test", "pws"],
        check: { q: "Could PE2 simply relay CE1's frames to PE3?", options: [{ id: "a", label: "No — split horizon forbids pseudowire-to-pseudowire forwarding; the fix is the missing pseudowire" }, { id: "b", label: "Yes, after its MAC table times out" }, { id: "c", label: "Yes, if the frame is a broadcast" }], answer: "a", why: "Split horizon has no exceptions in a VPLS mesh. Reachability needs the full mesh." },
      },
    ],
  },
  {
    n: 4,
    title: "Two labels on the wire",
    idea: "As in VPWS: the PW label chosen by the far PE underneath, the transport label on top.",
    steps: [
      {
        title: "CE1 → CE3, hop by hop",
        body: <p>PE1 pushes <B>26031</B> — the label PE3 chose for its pseudowire with PE1 — then the transport label toward 3.3.3.3. P1 swaps it, P3 pops it (PHP), and PE3 receives 26031: &quot;this came from PE1, on VPLS-A&quot;.</p>,
        pre: [ping("CE1", "192.168.100.3")],
        runs: [{ label: "Ping 192.168.100.3 from CE1 (known MACs)", actions: [ping("CE1", "192.168.100.3")] }],
        show: ["path", "test"],
      },
      {
        title: "A label per pair, per direction",
        body: <p>Six pseudowire ends, six labels: each PE allocates one receive label per neighbor (PE1: 24012 from PE2, 24013 from PE3; PE2: 25021, 25023; PE3: 26031, 26032). The label tells the receiving PE which neighbor — which bridge port — the frame came from, so it can learn the source MAC on the right port.</p>,
        show: ["pws"],
        check: { q: "Why does PE3 give PE1 and PE2 different labels?", options: [{ id: "a", label: "The label identifies the pseudowire — the port — the frame arrived on, which is what MAC learning and split horizon need" }, { id: "b", label: "To load-balance" }, { id: "c", label: "Labels must be unique network-wide" }], answer: "a", why: "Each pseudowire is a separate bridge port at the receiving PE. The label is how the PE knows which one." },
      },
    ],
  },
  {
    n: 5,
    title: "The transport underneath",
    idea: "Every pseudowire rides an LSP. Break the LSP and the pseudowire carries nothing — even if it still looks up.",
    steps: [
      {
        title: "LDP disappears on P1–P3",
        body: <p>P1 stops running LDP toward P3. The targeted sessions run over plain IP and stay up. On IOS XR the pseudowires to PE3 stay up — but P1 has no label from P3, removes the transport label, and P3 receives PE3&apos;s PW label, which means nothing to it. (On Junos the pseudowires to PE3 go down: no LSP in inet.3.) CE3 is cut off; CE1 ↔ CE2 still works.</p>,
        runs: [{ label: "P1: no LDP toward P3, then ping CE2 and CE3 from CE1", actions: [set("P1: LDP removed from the interface toward P3", "P1", (c) => void (c.ldp["ge-0/0/2"] = false)), ping("CE1", "192.168.100.2"), ping("CE1", "192.168.100.3")] }],
        show: ["path", "test"],
      },
      {
        title: "Repair the LSP, prove it",
        body: <p>Put LDP back. The transport label returns, P3 pops it as before, and PE3 sees its PW label again.</p>,
        pre: [set("P1: LDP removed from the interface toward P3", "P1", (c) => void (c.ldp["ge-0/0/2"] = false))],
        runs: [{ label: "P1: LDP back toward P3, then ping", actions: [set("P1: LDP on the interface toward P3", "P1", (c) => void (c.ldp["ge-0/0/2"] = true)), ping("CE1", "192.168.100.3")] }],
        show: ["path", "test"],
      },
    ],
  },
  {
    n: 6,
    title: "Read the evidence",
    idea: "Test → attachment circuits → full mesh → pseudowire state and labels → transport LSP.",
    steps: [
      {
        title: "The guided lesson's incident",
        body: <p>The pseudowire between PE1 and PE3 is down: PE3&apos;s configuration lost PE1 as a neighbor. CE1 ↔ CE2 and CE2 ↔ CE3 still work, which makes it look like a CE problem. Walk the ladder.</p>,
        pre: [noPe1AtPe3],
        runs: [{ label: "Ping 192.168.100.3 from CE1", actions: [ping("CE1", "192.168.100.3")] }],
        show: ["ladder", "test"],
      },
      {
        title: "Fix one thing, prove it",
        body: <p>Add 1.1.1.1 back to PE3&apos;s neighbors. The targeted session comes up, both ends exchange labels for PW 500, the mesh is full again — and a fresh ping proves it.</p>,
        pre: [noPe1AtPe3],
        runs: [{ label: "PE3: neighbor 1.1.1.1 again, then ping", actions: [set("PE3: neighbor 1.1.1.1 pw-id 500 back in the VPLS", "PE3", (c) => void c.bd!.nbrs.push({ ip: "1.1.1.1", pwid: 500 })), ping("CE1", "192.168.100.3")] }],
        show: ["ladder", "test"],
      },
    ],
  },
];
