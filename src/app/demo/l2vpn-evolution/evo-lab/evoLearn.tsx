import type { ReactNode } from "react";
import type { SpLevel } from "@/components/sp-lab/spKit";
import type { VsCe } from "@/lib/sim-engine/scenarios/vsNet";
import type { EmAction, EmCfg, EmR } from "@/lib/sim-engine/scenarios/emNet";

/**
 * L2VPN Evolution Lab · Learn — six levels on the CUST-A network, now carried by EVPN-MPLS, compared at every step with
 * the LDP VPLS and BGP VPLS of the previous lessons (the comparison is computed from those labs' own models):
 *   1 Same LAN, a third control plane · 2 Type 3: who floods to whom · 3 Type 2: MACs in BGP ·
 *   4 Two labels per PE · 5 When it breaks · 6 What evolved
 */

const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const M = ({ children }: { children: ReactNode }) => <span className="pv-mono text-pv-text">{children}</span>;
const set = (text: string, dev: EmR, f: (c: EmCfg) => void): EmAction => ({ type: "set", text, changes: [{ dev, f }] });
const ping = (from: VsCe, dst: string): EmAction => ({ type: "test", from, dst });
const clear: EmAction = { type: "clear" };
const pe3Rt999 = set("PE3: the EVI's route target changed to 65000:999", "PE3", (c) => void (c.evi!.rt = "65000:999"));
const pe2NoFamily = set("PE2: the EVPN family removed from its session to RR1", "PE2", (c) => void (c.nbr!.evpn = false));
const noLdpP1P3 = set("P1: LDP removed from the interface toward P3", "P1", (c) => void (c.ldp["ge-0/0/2"] = false));

export const EVO_LEVELS: SpLevel<EmAction>[] = [
  {
    n: 1,
    title: "The same LAN, a third control plane",
    idea: "CUST-A still gets one Ethernet segment across three sites. This time the PEs build it with EVPN: no pseudowires, and MAC addresses travel in BGP.",
    steps: [
      {
        title: "Three sites, one subnet — once more",
        body: (
          <p>
            CE1, CE2 and CE3 share <M>192.168.100.0/24</M> across PE1, PE2 and PE3, as in the VPLS and BGP VPLS labs. Same routers, same core, same route reflector. Ping CE3 from CE1: it answers. Now compare the three architectures below — the LDP VPLS and BGP VPLS columns come from those labs&apos; own models on this topology.
          </p>
        ),
        runs: [{ label: "Ping 192.168.100.3 from CE1", actions: [ping("CE1", "192.168.100.3")] }],
        show: ["test", "cmp"],
        check: { q: "How many pseudowires does the EVPN column count?", options: [{ id: "a", label: "None — EVPN reaches the other PEs with labels from BGP routes, not pseudowires" }, { id: "b", label: "Six, like both VPLS flavors" }, { id: "c", label: "Three, one per PE" }], answer: "a", why: "EVPN keeps the MPLS transport but drops the pseudowire mesh. Each PE advertises routes; the other PEs push the labels those routes carry." },
      },
      {
        title: "What each PE runs",
        body: <p>Each PE has an <B>EVI</B> (EVPN instance 100) with an RD and a route target, a bridge domain holding the attachment circuit, and one iBGP session to <B>RR1</B> with the <B>EVPN family</B> (IOS XR <M>address-family l2vpn evpn</M>, Junos <M>family evpn signaling</M>). The P routers stay BGP-free and run IS-IS and LDP only, as in every lab of this path.</p>,
        show: ["bgp", "flood"],
      },
    ],
  },
  {
    n: 2,
    title: "Type 3: who floods to whom",
    idea: "Every PE advertises one inclusive-multicast route (Type 3): “send me your broadcast and unknown frames, with this label”. A PE floods to every PE whose Type 3 route it keeps.",
    steps: [
      {
        title: "The flood list replaces the mesh",
        body: <p>Before any customer frame, each PE has already advertised a <B>Type 3</B> route: its loopback, its RD, RT <M>65000:100</M> and its inclusive-multicast label. RR1 reflects them; each PE keeps the ones whose RT it imports. The PEs a PE keeps Type 3 routes from form its <B>flood list</B> — where one copy of every broadcast goes (ingress replication).</p>,
        show: ["flood", "routes"],
        check: { q: "In BGP VPLS, what played the role of the Type 3 route?", options: [{ id: "a", label: "The VPLS route each PE advertised (RD, VE ID, label block): it told the others to build a pseudowire to it" }, { id: "b", label: "The MAC table" }, { id: "c", label: "Nothing — BGP VPLS had no discovery" }], answer: "a", why: "Both are “I'm a member, here's how to reach me”. In BGP VPLS the answer was a pseudowire per pair; in EVPN it's a label to push when flooding." },
      },
      {
        title: "Wrong route target, off the list",
        body: <p>Give PE3&apos;s EVI route target <M>65000:999</M>. RR1 still reflects every route, but PE1 and PE2 don&apos;t import PE3&apos;s Type 3 route and PE3 doesn&apos;t import theirs. PE3 drops off both flood lists — and CE3 off the LAN.</p>,
        runs: [{ label: "PE3: RT 65000:999, then ping CE3 from CE1", actions: [pe3Rt999, ping("CE1", "192.168.100.3")] }],
        show: ["flood", "test"],
      },
    ],
  },
  {
    n: 3,
    title: "Type 2: MACs in BGP",
    idea: "A PE learns its own CEs' MACs from the frames they send, as any bridge does — then advertises each one as a Type 2 route. Remote MACs come from BGP, never from the data plane.",
    steps: [
      {
        title: "Learned once, advertised to all",
        body: <p>Ping CE3 from CE1. PE1 learns CE1&apos;s MAC on its attachment circuit, PE3 learns CE3&apos;s. Each advertises a <B>Type 2</B> route (MAC only, then MAC+IP once it has seen the host&apos;s ARP). Look at <B>PE2</B>: it knows CE1&apos;s and CE3&apos;s MACs, behind PE1 and PE3 — though CE3&apos;s reply never passed through PE2.</p>,
        runs: [{ label: "Ping 192.168.100.3 from CE1", actions: [ping("CE1", "192.168.100.3")] }],
        show: ["macs", "routes"],
        check: { q: "How does PE2 know where CE3 is?", options: [{ id: "a", label: "From PE3's Type 2 route for CE3's MAC, reflected by RR1" }, { id: "b", label: "From CE3's echo reply, flooded to every PE" }, { id: "c", label: "From the pseudowire to PE3" }], answer: "a", why: "That is control-plane learning: in a VPLS, PE2 would only learn CE3 by receiving a frame from it on a pseudowire. In EVPN every PE learns every MAC from BGP." },
      },
      {
        title: "Withdrawn, not aged out",
        body: <p>Clear the MAC tables. Each PE withdraws its Type 2 routes, and the other PEs forget those MACs at once — instead of waiting for them to age out, as a VPLS PE does with what it learned on a pseudowire. The Type 3 routes stay: the flood lists don&apos;t change.</p>,
        pre: [ping("CE1", "192.168.100.3")],
        runs: [{ label: "Clear all MAC tables", actions: [clear], keep: true }],
        show: ["macs", "flood"],
      },
    ],
  },
  {
    n: 4,
    title: "Two labels per PE",
    idea: "Each PE allocates a unicast label (carried in its Type 2 routes) and an inclusive-multicast label (in its Type 3 route). The label on a frame tells the egress PE whether it was flooded.",
    steps: [
      {
        title: "Flooded, then unicast",
        body: (
          <p>
            Ping CE3 from CE1 twice. The first ping&apos;s ARP request is broadcast: PE1 sends one copy to PE2 and one to PE3, each with that PE&apos;s <B>inclusive-multicast</B> label under the transport label. The second ping finds CE3&apos;s MAC in PE1&apos;s table: one copy, with PE3&apos;s <B>unicast</B> label. Read the labels in the frame walk.
          </p>
        ),
        runs: [
          { label: "First ping 192.168.100.3 from CE1", actions: [ping("CE1", "192.168.100.3")] },
          { label: "Ping it again", actions: [ping("CE1", "192.168.100.3")], keep: true },
        ],
        show: ["path", "labels"],
        check: { q: "PE3 receives a frame with its inclusive-multicast label. What may it do with it?", options: [{ id: "a", label: "Flood it to its local attachment circuits only — never back into the core" }, { id: "b", label: "Flood it to every port and every other PE" }, { id: "c", label: "Drop it: only unicast labels are valid" }], answer: "a", why: "The ingress PE already sent one copy to every PE. Re-flooding into the core would loop — VPLS needed split horizon for the same reason." },
      },
      {
        title: "The transport underneath",
        body: <p>Both EVPN labels ride under an LDP transport label, as the VPLS label did. P1, P2 and P3 swap and pop the transport label and never look at the EVPN label. The core didn&apos;t change between the three architectures — only the edge did. Ping CE3 again and read the walk: on IOS XR, PE1 pushes 24104 over 26010, P1 swaps 24104 for 24306, P3 pops it.</p>,
        pre: [ping("CE1", "192.168.100.3")],
        runs: [{ label: "Ping 192.168.100.3 from CE1 again", actions: [ping("CE1", "192.168.100.3")], keep: true }],
        show: ["labels", "path"],
      },
    ],
  },
  {
    n: 5,
    title: "When it breaks",
    idea: "The failure classes you know still apply — family, reflection, route target, transport, attachment circuit — with EVPN routes and flood lists as the evidence.",
    steps: [
      {
        title: "Established, but no EVPN",
        body: <p>Remove the EVPN family from PE2&apos;s session to RR1. The session stays Established, but no EVPN route crosses it: PE2 advertises no Type 3 route and keeps none. Its flood list is empty, and the others drop PE2 from theirs.</p>,
        runs: [{ label: "PE2: no EVPN family, then ping CE1 from CE2", actions: [pe2NoFamily, ping("CE2", "192.168.100.1")] }],
        show: ["bgp", "flood", "test"],
      },
      {
        title: "Routes everywhere, frames nowhere",
        body: <p>Remove LDP between P1 and P3. BGP doesn&apos;t notice — every route is still reflected. On IOS XR the frames for PE3 leave PE1 without a transport label and P3 drops what it sees: PE3&apos;s EVPN label. On Junos the EVPN routes from PE3 become unusable without an LSP in <M>inet.3</M>, and PE3 drops off the flood lists.</p>,
        runs: [{ label: "P1: no LDP toward P3, then ping CE3 from CE1", actions: [noLdpP1P3, ping("CE1", "192.168.100.3")] }],
        show: ["test", "path"],
      },
    ],
  },
  {
    n: 6,
    title: "What evolved",
    idea: "LDP VPLS → BGP VPLS → EVPN: discovery moved into BGP, then learning did. Read every layer of the evidence in order.",
    steps: [
      {
        title: "The evidence ladder",
        body: <p>Break PE3&apos;s route target again and climb the ladder: attachment circuits, the EVPN family, Type 3 routes kept, Type 2 routes, the transport. Each rung is read from the network. The first rung that fails is where you look.</p>,
        runs: [{ label: "PE3: RT 65000:999, then ping CE3 from CE1", actions: [pe3Rt999, ping("CE1", "192.168.100.3")] }],
        show: ["ladder"],
        check: { q: "Which rung fails first?", options: [{ id: "a", label: "Type 3 routes kept: PE1, PE2 and PE3 don't import each other's routes" }, { id: "b", label: "The EVPN family" }, { id: "c", label: "The transport" }], answer: "a", why: "Sessions and the family are fine; the routes arrive but aren't imported — the RT rung." },
      },
      {
        title: "Three answers to the same questions",
        body: <p>Who belongs to this LAN? LDP VPLS: whoever is configured as a neighbor. BGP VPLS and EVPN: whoever advertises a route with the RT. Where is a MAC? Both VPLS flavors: wherever a frame from it last arrived. EVPN: wherever its Type 2 route says. That second change is what makes all-active multihoming, MAC mobility and ARP suppression possible — the next lessons of an EVPN design.</p>,
        show: ["cmp"],
      },
    ],
  },
];
