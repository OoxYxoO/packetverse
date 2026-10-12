import type { ReactNode } from "react";
import type { SpLevel } from "@/components/sp-lab/spKit";
import type { HvAction, HvCe, HvCfg, HvR } from "@/lib/sim-engine/scenarios/hvNet";

/**
 * H-VPLS Lab · Learn — six levels:
 *   1 Two tiers · 2 The access bridge · 3 Spoke, mesh, spoke · 4 Split horizon by role · 5 Labels and transport ·
 *   6 Read the evidence
 */

const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const M = ({ children }: { children: ReactNode }) => <span className="pv-mono text-pv-text">{children}</span>;
const set = (text: string, dev: HvR, f: (c: HvCfg) => void): HvAction => ({ type: "set", text, changes: [{ dev, f }] });
const ping = (from: HvCe, dst: string): HvAction => ({ type: "test", from, dst });
const clear: HvAction = { type: "clear" };
/** The guided lesson's incident: PE1 treats MTU1's pseudowire as a core mesh member. */
const spokeAsMesh = set("PE1: MTU1's pseudowire moved into the core mesh (VFI / default mesh group)", "PE1", (c) => {
  const bd = c.bd!;
  const n = bd.spokes.find((x) => x.ip === "10.0.0.1")!;
  bd.spokes = bd.spokes.filter((x) => x !== n);
  bd.mesh.push(n.pwid !== undefined ? n : { ip: n.ip });
});
const spokeBack = set("PE1: MTU1's pseudowire back as a spoke (access pseudowire / SPOKES mesh group)", "PE1", (c) => {
  const bd = c.bd!;
  const n = bd.mesh.find((x) => x.ip === "10.0.0.1")!;
  bd.mesh = bd.mesh.filter((x) => x !== n);
  bd.spokes.push(n);
});
const noPe3AtPe1 = set("PE1: core mesh neighbor 3.3.3.3 removed", "PE1", (c) => void (c.bd!.mesh = c.bd!.mesh.filter((x) => x.ip !== "3.3.3.3")));

export const HV_LEVELS: SpLevel<HvAction>[] = [
  {
    n: 1,
    title: "Two tiers",
    idea: "Access devices join the service with one spoke pseudowire each; only the hubs form the full mesh.",
    steps: [
      {
        title: "Four sites, one LAN",
        body: (
          <p>
            CE1 and CE2 sit behind <B>MTU1</B>, CE3 behind MTU2, CE4 behind MTU3 — all in <M>192.168.100.0/24</M>. Each MTU-s is a small bridge with one pseudowire, its <B>spoke</B>, to its hub (PE1, PE2, PE3). The three hubs are full-meshed. Ping CE3 from CE1: it answers across both tiers.
          </p>
        ),
        runs: [{ label: "Ping 192.168.100.3 from CE1", actions: [ping("CE1", "192.168.100.3")] }],
        show: ["test", "pws"],
        check: { q: "How many pseudowires does MTU1 have?", options: [{ id: "a", label: "One — its spoke to PE1" }, { id: "b", label: "Five — one to every other VPLS device" }, { id: "c", label: "Three — one to each PE" }], answer: "a", why: "An MTU-s never joins the mesh. Everything beyond its own ports goes up its single spoke." },
      },
      {
        title: "Why bother: the pseudowire count",
        body: <p>Six VPLS devices as one flat mesh would need <M>6 × 5 / 2 = 15</M> pseudowires and fifteen targeted sessions. Three hubs and three spokes need <M>3 + 3 = 6</M>. A hundredth MTU-s costs one new spoke, not 99 new pseudowires.</p>,
        show: ["count", "pws"],
      },
    ],
  },
  {
    n: 2,
    title: "The access bridge",
    idea: "An MTU-s is an ordinary bridge: two sites behind the same MTU-s talk without ever touching the spoke.",
    steps: [
      {
        title: "CE1 → CE2 stays at MTU1",
        body: <p>Start with empty tables. CE1&apos;s ARP request for CE2 is a broadcast, so MTU1 floods it — to CE2 and up the spoke (the whole service hears it). But CE2&apos;s reply is unicast to a MAC MTU1 already knows, and the pings after that never leave MTU1. PE1 learns CE1, never CE2.</p>,
        pre: [clear],
        runs: [{ label: "Ping 192.168.100.2 from CE1 (empty tables)", actions: [ping("CE1", "192.168.100.2")] }],
        show: ["path", "macs"],
        check: { q: "Why does PE1 never learn CE2's MAC?", options: [{ id: "a", label: "CE2 only sent unicast frames to CE1, which MTU1 switched locally" }, { id: "b", label: "PE-rs don't learn MACs from spokes" }, { id: "c", label: "Split horizon hides CE2" }], answer: "a", why: "A bridge learns only from frames it receives. CE2's frames never left MTU1." },
      },
      {
        title: "Ping again: nothing leaves MTU1",
        body: <p>Both MACs are known at MTU1 now: every frame is switched locally, on MTU1, between its two attachment circuits. The spoke carries nothing.</p>,
        pre: [clear, ping("CE1", "192.168.100.2")],
        runs: [{ label: "Ping 192.168.100.2 from CE1 again", actions: [ping("CE1", "192.168.100.2")] }],
        show: ["path", "test"],
      },
    ],
  },
  {
    n: 3,
    title: "Spoke, mesh, spoke",
    idea: "A frame from a spoke may enter the mesh; a frame from the mesh may go down a spoke. That's the whole hierarchy.",
    steps: [
      {
        title: "CE1 → CE3, empty tables",
        body: <p>MTU1 floods CE1&apos;s ARP request up its spoke. PE1 received it on a <B>spoke</B>, so it may flood it into the mesh: to PE2 and PE3. PE2 received it on the <B>mesh</B>: it may send it down its spoke to MTU2 — but not on to PE3. PE3 got its own copy from PE1 anyway. MTU2 delivers to CE3.</p>,
        pre: [clear],
        runs: [{ label: "Ping 192.168.100.3 from CE1 (empty tables)", actions: [ping("CE1", "192.168.100.3")] }],
        show: ["path", "macs"],
        check: { q: "PE2 receives the broadcast from PE1. Where does it send copies?", options: [{ id: "a", label: "Down its spoke to MTU2 only — never on to PE3 (mesh to mesh)" }, { id: "b", label: "To MTU2 and PE3" }, { id: "c", label: "Nowhere: mesh frames are never forwarded" }], answer: "a", why: "Only core-to-core is forbidden. Core-to-spoke is how frames reach the access tier." },
      },
      {
        title: "The same MAC, six different ports",
        body: <p>Look at where each device learned CE1: MTU1 on its attachment circuit, PE1 on the spoke from MTU1, PE2 and PE3 on the mesh pseudowire from PE1, MTU2 on its spoke from PE2. Each bridge learned on its own, from the frames it saw.</p>,
        pre: [clear, ping("CE1", "192.168.100.3")],
        show: ["macs"],
      },
    ],
  },
  {
    n: 4,
    title: "Split horizon by role",
    idea: "The core mesh is one split-horizon group: no relaying between mesh pseudowires — so the mesh must stay full.",
    steps: [
      {
        title: "Remove one mesh pseudowire",
        body: <p>PE1 drops 3.3.3.3 from its core mesh. CE1 ↔ CE3 still works (PE1 ↔ PE2), CE3 ↔ CE4 still works (PE2 ↔ PE3). But CE1 can&apos;t reach CE4: PE2 holds both of the other mesh pseudowires and may not relay between them.</p>,
        runs: [{ label: "PE1: no 3.3.3.3, then ping CE3 and CE4 from CE1", actions: [noPe3AtPe1, ping("CE1", "192.168.100.3"), ping("CE1", "192.168.100.4")] }],
        show: ["test", "pws"],
        check: { q: "Why doesn't PE2 forward PE1's frames to PE3?", options: [{ id: "a", label: "Both are mesh pseudowires: one split-horizon group, no forwarding inside it" }, { id: "b", label: "PE2 has no MAC entry for CE4" }, { id: "c", label: "The spoke to MTU3 is down" }], answer: "a", why: "Inside the core, nobody relays. Any missing mesh pseudowire cuts the sites behind those two hubs apart." },
      },
      {
        title: "Spokes are outside the group",
        body: (
          <p>
            On IOS XR the spoke is an <B>access pseudowire</B> — <M>neighbor 10.0.0.1 pw-id 100</M> directly under the bridge domain — while the mesh lives in the <B>VFI</B>, which is the split-horizon group. On Junos the core neighbors sit in the default mesh group, the spokes in a mesh group of their own (here <M>SPOKES</M>). Frames move freely between groups.
          </p>
        ),
        show: ["pws"],
      },
    ],
  },
  {
    n: 5,
    title: "Labels and transport",
    idea: "A spoke to a directly connected hub carries one label; a mesh pseudowire across the core carries two.",
    steps: [
      {
        title: "CE1 → CE3, hop by hop",
        body: <p>MTU1 pushes <B>34011</B>, PE1&apos;s label for its spoke — PE1 is the next hop, so there is no transport label (PHP). PE1 pushes <B>25021</B>, PE2&apos;s label for the mesh pseudowire, under P1&apos;s transport label; P1 pops it. PE2 pushes <B>44022</B>, MTU2&apos;s spoke label. (Junos numbers them from 299776 upward.)</p>,
        pre: [ping("CE1", "192.168.100.3")],
        runs: [{ label: "Ping 192.168.100.3 from CE1 (known MACs)", actions: [ping("CE1", "192.168.100.3")] }],
        show: ["path", "test"],
      },
      {
        title: "PE3 loses LDP toward P1",
        body: <p>PE3 stops running LDP on its core link. The targeted sessions run over plain IP and stay up, and MTU3&apos;s spoke is directly connected. But PE3 has no transport label toward PE1 and PE2 any more: on IOS XR its frames reach P1 with only a PW label on top, which P1 never allocated; on Junos the mesh pseudowires to PE3 go down. CE4 is cut off.</p>,
        runs: [{ label: "PE3: no LDP on ge-0/0/0, then ping CE4 from CE1", actions: [set("PE3: LDP removed from the interface toward P1", "PE3", (c) => void (c.ldp["ge-0/0/0"] = false)), ping("CE1", "192.168.100.4")] }],
        show: ["path", "test"],
        check: { q: "Every pseudowire on IOS XR still shows up. What do you check next?", options: [{ id: "a", label: "The transport: LDP sessions and labels toward the other PE-rs loopbacks" }, { id: "b", label: "The spoke's PW ID" }, { id: "c", label: "MTU3's MAC table" }], answer: "a", why: "Pseudowire state proves signaling. The frames still need an LSP across the core." },
      },
    ],
  },
  {
    n: 6,
    title: "Read the evidence",
    idea: "Test pairs → attachment circuits → spokes → the core mesh → port roles → transport.",
    steps: [
      {
        title: "The guided lesson's incident",
        body: <p>After a tidy-up of PE1, CE1 and CE2 still reach each other but nobody else. Every pseudowire is up and the transport is fine. PE1 now has MTU1&apos;s pseudowire in its core mesh: frames from MTU1 may no longer be flooded to PE2 and PE3. Walk the ladder.</p>,
        pre: [spokeAsMesh],
        runs: [{ label: "Ping 192.168.100.3 from CE1", actions: [ping("CE1", "192.168.100.3")] }],
        show: ["ladder", "test"],
      },
      {
        title: "Fix one thing, prove it",
        body: <p>Give the pseudowire its role back: an access pseudowire on IOS XR, a member of the SPOKES mesh group on Junos. Nothing about the pseudowire itself changes — only which split-horizon group it belongs to — and a fresh ping proves it.</p>,
        pre: [spokeAsMesh],
        runs: [{ label: "PE1: MTU1 back as a spoke, then ping", actions: [spokeBack, ping("CE1", "192.168.100.3")] }],
        show: ["ladder", "test"],
      },
    ],
  },
];
