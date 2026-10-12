import type { ReactNode } from "react";
import type { SpLevel } from "@/components/sp-lab/spKit";
import type { VsCe } from "@/lib/sim-engine/scenarios/vsNet";
import type { BvAction, BvCfg, BvR } from "@/lib/sim-engine/scenarios/bvNet";

/**
 * BGP VPLS Lab · Learn — six levels:
 *   1 The same LAN, built by BGP · 2 Discovery: RD, RT and the route reflector · 3 VE IDs and label blocks ·
 *   4 The same data plane · 5 When it breaks · 6 Read the evidence
 */

const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const M = ({ children }: { children: ReactNode }) => <span className="pv-mono text-pv-text">{children}</span>;
const set = (text: string, dev: BvR, f: (c: BvCfg) => void): BvAction => ({ type: "set", text, changes: [{ dev, f }] });
const ping = (from: VsCe, dst: string): BvAction => ({ type: "test", from, dst });
const clear: BvAction = { type: "clear" };
const pe3Rt999 = set("PE3: route target changed to 65000:999", "PE3", (c) => void (c.bd!.rt = "65000:999"));
const pe3Ve12 = set("PE3: VE ID changed to 12", "PE3", (c) => void (c.bd!.veId = 12));
const pe3NotClient = set("RR1: PE3 is no longer a route-reflector client", "RR1", (c) => void (c.rr!.clients.find((x) => x.ip === "3.3.3.3")!.client = false));
const noLdpP1P3 = set("P1: LDP removed from the interface toward P3", "P1", (c) => void (c.ldp["ge-0/0/2"] = false));

export const BV_LEVELS: SpLevel<BvAction>[] = [
  {
    n: 1,
    title: "The same LAN, built by BGP",
    idea: "The customer gets exactly the VPLS of the previous lesson. What changes is how the PEs find each other and agree on labels: BGP, not a list of neighbors.",
    steps: [
      {
        title: "Three sites, one subnet — again",
        body: (
          <p>
            CE1, CE2 and CE3 share <M>192.168.100.0/24</M> across PE1, PE2 and PE3, exactly as before. Ping CE3 from CE1: it answers. Then look at the pseudowires: a full mesh, six ends — yet no PE has a single neighbor statement in its VPLS configuration.
          </p>
        ),
        runs: [{ label: "Ping 192.168.100.3 from CE1", actions: [ping("CE1", "192.168.100.3")] }],
        show: ["test", "pws"],
        check: { q: "Where did each PE learn which other PEs belong to the VPLS?", options: [{ id: "a", label: "From the other PEs' BGP routes for the VPLS, carrying a route target it imports" }, { id: "b", label: "From targeted LDP hellos" }, { id: "c", label: "From the MAC tables" }], answer: "a", why: "Each PE advertises one BGP route per VPLS. Any PE that imports the route target learns that the advertiser is a member — that is auto-discovery." },
      },
      {
        title: "One session per PE",
        body: <p>Each PE has one iBGP session, to the route reflector <B>RR1</B> (9.9.9.9). RR1 is pure control plane: no customer frame ever passes through it, and the P routers stay BGP-free. Adding a fourth PE means one new session and one VPLS configuration — not touching every existing PE.</p>,
        show: ["bgp", "pws"],
      },
    ],
  },
  {
    n: 2,
    title: "Discovery: RD, RT and the route reflector",
    idea: "Each PE advertises one route: its RD makes it unique, its RT says which VPLS it belongs to, the route reflector carries it to every other PE.",
    steps: [
      {
        title: "What each PE advertises",
        body: <p>PE1&apos;s VPLS route is <M>65000:1:1:1</M>: RD 65000:1, VE ID 1, block offset 1. It carries <B>RT 65000:100</B> and the VPLS MTU. RR1 holds all three PEs&apos; routes and reflects each to the two other PEs; each PE imports the routes with RT 65000:100.</p>,
        show: ["routes", "bgp"],
        check: { q: "Why does each PE use its own RD?", options: [{ id: "a", label: "So the three routes stay distinct in BGP — the RD makes each one unique" }, { id: "b", label: "To decide which routes are imported" }, { id: "c", label: "The RD is the VPLS label" }], answer: "a", why: "The RD only makes the route unique. Import is decided by the RT." },
      },
      {
        title: "Who RR1 reflects to",
        body: <p>A route reflector bends the iBGP rule (no passing routes between iBGP peers) only for its clients: a route from a client goes to everyone, a route from a non-client goes to clients only. Make PE3 a non-client: PE3&apos;s route still reaches the clients PE1 and PE2, and their routes still reach PE3. The mesh stays up — remove the client flag from all three and nothing would be reflected at all.</p>,
        runs: [{ label: "RR1: PE3 no longer a client, then ping CE3 from CE1", actions: [pe3NotClient, ping("CE1", "192.168.100.3")] }],
        show: ["bgp", "test"],
      },
    ],
  },
  {
    n: 3,
    title: "VE IDs and label blocks",
    idea: "BGP doesn't send one label per neighbor. Each PE advertises a block of labels; every other PE picks its own label from the block using its VE ID.",
    steps: [
      {
        title: "Label = base + VE ID − offset",
        body: (
          <p>
            PE1 advertises a block starting at 24000 (Junos: 262145) for VE IDs 1–10 (Junos: 1–8). PE2, VE ID 2, sends to PE1 with <M>24000 + 2 − 1 = 24001</M>; PE3 uses <M>24002</M>. PE1 computes the same way from the others&apos; blocks: it pushes 25000 toward PE2 and 26000 toward PE3 (Junos: 262401, 262657). Nobody sends anybody a per-pseudowire label.
          </p>
        ),
        show: ["labels", "pws"],
        check: { q: "PE2 receives frames from PE1 on 25000 and from PE3 on 25002 (IOS XR). What makes them different?", options: [{ id: "a", label: "The sender's VE ID picks the label inside PE2's block — 1 → 25000, 3 → 25002" }, { id: "b", label: "PE2 sent each one a label in a separate message" }, { id: "c", label: "The RD" }], answer: "a", why: "One block, one label per remote VE ID: the label still identifies which neighbor — which bridge port — the frame came from." },
      },
      {
        title: "Renumber PE3 to VE ID 12",
        body: <p>VE ID 12 is outside every PE&apos;s first block. PE1 and PE2 import PE3&apos;s new route, see VE 12, and each advertise a <B>second block</B> (offset 11 on IOS XR, 9 on Junos) so PE3 has a label to use. The mesh stays up; the BGP table now holds two routes from PE1 and two from PE2.</p>,
        runs: [{ label: "PE3: VE ID 12, then ping CE3 from CE1", actions: [pe3Ve12, ping("CE1", "192.168.100.3")] }],
        show: ["routes", "labels", "test"],
      },
    ],
  },
  {
    n: 4,
    title: "The same data plane",
    idea: "Once the pseudowires are up, BGP VPLS bridges exactly like LDP VPLS: learning, flooding, split horizon, two labels.",
    steps: [
      {
        title: "Flood first, then unicast",
        body: <p>Start with empty MAC tables. CE1&apos;s ARP broadcast floods over both pseudowires; CE3&apos;s reply teaches PE1 where CE3 lives. The second ping goes over one pseudowire only.</p>,
        pre: [clear],
        runs: [
          { label: "Ping 192.168.100.3 from CE1 (empty tables)", actions: [ping("CE1", "192.168.100.3")] },
          { label: "…and again", actions: [ping("CE1", "192.168.100.3")] },
        ],
        show: ["path", "macs"],
      },
      {
        title: "Two labels on the wire",
        body: <p>PE1 pushes the VPLS label it computed from PE3&apos;s block, then the LDP transport label toward 3.3.3.3. P1 swaps, P3 pops (PHP), PE3 sees the label from its own block and knows the frame came from VE 1 — PE1.</p>,
        pre: [ping("CE1", "192.168.100.3")],
        runs: [{ label: "Ping 192.168.100.3 from CE1 (known MACs)", actions: [ping("CE1", "192.168.100.3")] }],
        show: ["path", "test"],
        check: { q: "Do P1, P2 and P3 need BGP for this VPLS?", options: [{ id: "a", label: "No — they switch on the transport label only; BGP runs on the PEs and RR1" }, { id: "b", label: "Yes, to know the VE IDs" }, { id: "c", label: "Only P1, because RR1 is attached to it" }], answer: "a", why: "The VPLS label is underneath. The core only sees the LDP label toward the far PE's loopback." },
      },
    ],
  },
  {
    n: 5,
    title: "When it breaks",
    idea: "Discovery can fail (RT, family, reflection), signaling can fail (VE ID, MTU) and the transport can fail. Each leaves different evidence.",
    steps: [
      {
        title: "Two PEs, one VE ID",
        body: <p>Give PE3 VE ID 1 — PE1&apos;s. PE1 and PE3 both see their own VE ID in the other&apos;s route: a collision, so no pseudowire comes up between them. PE2 receives VE ID 1 twice and keeps only the PE with the lower loopback, PE1. CE3 is cut off from everyone.</p>,
        runs: [{ label: "PE3: VE ID 1, then ping CE3 from CE1", actions: [set("PE3: VE ID changed to 1", "PE3", (c) => void (c.bd!.veId = 1)), ping("CE1", "192.168.100.3")] }],
        show: ["pws", "test"],
      },
      {
        title: "LDP disappears on P1–P3",
        body: <p>Discovery is healthy now — every route, every label. But P1 stops running LDP toward P3. On IOS XR the pseudowires stay up while P1 removes the transport label and P3 drops PE3&apos;s VPLS label; on Junos the pseudowires to PE3 go down (no LSP in inet.3). Either way CE3 is cut off while BGP looks perfect.</p>,
        runs: [{ label: "P1: no LDP toward P3, then ping CE3 from CE1", actions: [noLdpP1P3, ping("CE1", "192.168.100.3")] }],
        show: ["path", "test"],
        check: { q: "Every BGP route is present and every label computed. Where do you look next?", options: [{ id: "a", label: "The transport LSP: LDP sessions and the labels toward the far PE's loopback" }, { id: "b", label: "The route targets" }, { id: "c", label: "The VE IDs" }], answer: "a", why: "BGP proves discovery and signaling. The frames still need an LSP to the far PE." },
      },
    ],
  },
  {
    n: 6,
    title: "Read the evidence",
    idea: "Test → attachment circuits → BGP family → discovery (import) → pseudowires and labels → transport LSP.",
    steps: [
      {
        title: "The guided lesson's incident",
        body: <p>After a change on PE3, CE3 reaches nobody. PE3&apos;s BGP session is up and RR1 holds its route — with RT <M>65000:999</M>. PE1 and PE2 don&apos;t import it; PE3 doesn&apos;t import theirs. Walk the ladder.</p>,
        pre: [pe3Rt999],
        runs: [{ label: "Ping 192.168.100.3 from CE1", actions: [ping("CE1", "192.168.100.3")] }],
        show: ["ladder", "test"],
      },
      {
        title: "Fix one thing, prove it",
        body: <p>Put PE3&apos;s route target back to 65000:100. PE3 re-advertises, PE1 and PE2 import, everyone computes labels from the blocks — and a fresh ping proves the mesh.</p>,
        pre: [pe3Rt999],
        runs: [{ label: "PE3: RT 65000:100 again, then ping", actions: [set("PE3: route target back to 65000:100", "PE3", (c) => void (c.bd!.rt = "65000:100")), ping("CE1", "192.168.100.3")] }],
        show: ["ladder", "test"],
      },
    ],
  },
];
