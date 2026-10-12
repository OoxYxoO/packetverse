import type { ReactNode } from "react";
import type { SpLevel } from "@/components/sp-lab/spKit";
import type { VpAction, VpCe, VpCfg, VpR } from "@/lib/sim-engine/scenarios/vpNet";

/**
 * L2VPN (VPWS) Lab · Learn — six levels:
 *   1 A wire across the provider · 2 Attachment circuits · 3 Targeted LDP and the PW FEC · 4 Two labels on the wire ·
 *   5 The transport underneath · 6 Read the evidence
 */

const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const M = ({ children }: { children: ReactNode }) => <span className="pv-mono text-pv-text">{children}</span>;
const set = (text: string, dev: VpR, f: (c: VpCfg) => void): VpAction => ({ type: "set", text, changes: [{ dev, f }] });
const ping = (from: VpCe, dst: string): VpAction => ({ type: "test", from, dst });
const xcA = (c: VpCfg) => c.xcs.find((x) => x.ac?.endsWith(".100"))!;
const badPwid = set("PE2: CUST-A's pseudowire defined with PW ID 6000 (instead of 5000)", "PE2", (c) => void (xcA(c).pwid = 6000));

export const VP_LEVELS: SpLevel<VpAction>[] = [
  {
    n: 1,
    title: "A wire across the provider",
    idea: "A VPWS service makes two customer ports behave like one cable: whatever enters one comes out of the other.",
    steps: [
      {
        title: "Same addresses, separate wires",
        body: (
          <p>
            CUST-A and CUST-B both number their sites <M>192.168.100.1</M> and <M>192.168.100.2</M>. Ping 192.168.100.2 from each site 1: both succeed, and each reaches <B>its own</B> site 2. The provider never looked at those addresses.
          </p>
        ),
        runs: [
          { label: "Ping 192.168.100.2 from CE1A (CUST-A)", actions: [ping("CE1A", "192.168.100.2")] },
          { label: "Ping 192.168.100.2 from CE1B (CUST-B)", actions: [ping("CE1B", "192.168.100.2")] },
        ],
        show: ["test", "pws"],
        check: { q: "PE1 never reads the customers' IP addresses. How does it know CE1B's frame belongs to CUST-B?", options: [{ id: "a", label: "It arrives on CUST-B's attachment circuit: that port and VLAN 200" }, { id: "b", label: "From its destination MAC address" }, { id: "c", label: "From its destination IP address" }], answer: "a", why: "The attachment circuit decides the service. Everything that enters it goes into its pseudowire — no MAC or IP lookup." },
      },
      {
        title: "The frame crosses untouched",
        body: <p>Ping back from CE2A. PE2 wraps the customer&apos;s Ethernet frame in two labels and PE1 unwraps it: the customer&apos;s MAC addresses, VLAN and IP packet are carried as they are. To the customers, the provider is a piece of wire.</p>,
        runs: [{ label: "Ping 192.168.100.1 from CE2A", actions: [ping("CE2A", "192.168.100.1")] }],
        show: ["path", "test"],
      },
    ],
  },
  {
    n: 2,
    title: "Attachment circuits",
    idea: "The attachment circuit is the customer's side of the service: a port, and here one VLAN on it.",
    steps: [
      {
        title: "Port + VLAN = the service",
        body: (
          <p>
            On each PE, CUST-A uses a sub-interface for VLAN 100 on its port (<M>.100</M>) and CUST-B one for VLAN 200 on another port (<M>.200</M>). A frame enters a service only if its VLAN tag matches the attachment circuit&apos;s. Each attachment circuit is cross-connected to exactly one pseudowire.
          </p>
        ),
        show: ["pws"],
      },
      {
        title: "The wrong VLAN, a working pseudowire",
        body: <p>Make PE2&apos;s CUST-A sub-interface accept VLAN 200 while CE2A keeps sending VLAN 100. The pseudowire stays up — both PEs still agree on PW 5000 — but frames leave PE2 tagged 200 and CE2A drops them.</p>,
        runs: [{ label: "PE2: CUST-A's sub-interface on VLAN 200, then ping from CE1A", actions: [set("PE2: CUST-A's attachment circuit now accepts VLAN 200", "PE2", (c) => void (c.acs["ge-0/0/1.100"].vlan = 200)), ping("CE1A", "192.168.100.2")] }],
        show: ["test", "pws"],
      },
    ],
  },
  {
    n: 3,
    title: "Targeted LDP and the PW FEC",
    idea: "The PEs signal every pseudowire to each other over a targeted LDP session: same PW ID at both ends, a label from each.",
    steps: [
      {
        title: "A session between the loopbacks",
        body: (
          <p>
            Link LDP runs between neighbors. To signal a pseudowire, PE1 and PE2 — four hops apart — open a <B>targeted</B> LDP session between their loopbacks (<M>1.1.1.1</M> ↔ <M>4.4.4.4</M>). Over it each PE sends a label mapping per pseudowire: the PW FEC (type Ethernet, PW ID) and the label it wants to receive.
          </p>
        ),
        show: ["ldp", "pws"],
      },
      {
        title: "PW 5000 at one end, 6000 at the other",
        body: <p>Define PE2&apos;s CUST-A pseudowire with PW ID 6000. The session stays up, but PE1 advertises a mapping for 5000 and PE2 one for 6000: neither receives a mapping for the PW ID it configured, neither has a label to push, and the pseudowire stays down.</p>,
        runs: [{ label: "PE2: PW ID 6000, then ping from CE1A", actions: [badPwid, ping("CE1A", "192.168.100.2")] }],
        show: ["test", "pws"],
        check: { q: "The PW ID is 5000. Is 5000 the label carried in the packet?", options: [{ id: "a", label: "No — the PW ID only names the pseudowire in signaling; each PE allocates its own label" }, { id: "b", label: "Yes — the PW ID is the inner label" }, { id: "c", label: "Yes, but only at PE1" }], answer: "a", why: "The PW ID identifies the pseudowire in the FEC. The labels (24001, 25001) are allocated by each PE and advertised in the mappings." },
      },
    ],
  },
  {
    n: 4,
    title: "Two labels on the wire",
    idea: "The ingress PE pushes the PW label chosen by the far PE, then the transport label; the core switches the top label only.",
    steps: [
      {
        title: "PW label underneath, transport label on top",
        body: <p>CE1A pings CE2A. PE1 pushes <B>25001</B> — the label PE2 asked for — then the transport label toward 4.4.4.4. P1 swaps the top label, P2 pops it (PHP), and PE2 receives just 25001, which means &quot;CUST-A&apos;s attachment circuit&quot;.</p>,
        runs: [{ label: "Ping 192.168.100.2 from CE1A", actions: [ping("CE1A", "192.168.100.2")] }],
        show: ["path", "test"],
      },
      {
        title: "One label per direction",
        body: <p>The reply travels on a different label: PE2 pushes <B>24001</B>, the label PE1 asked for. A pseudowire is two one-way label paths, each chosen by its receiver. P1 and P2 know none of them.</p>,
        runs: [{ label: "Ping 192.168.100.1 from CE2A", actions: [ping("CE2A", "192.168.100.1")] }],
        show: ["path", "pws"],
        check: { q: "Which router chose the label 25001 that PE1 pushes?", options: [{ id: "a", label: "PE2 — the receiver allocates the PW label and advertises it" }, { id: "b", label: "PE1" }, { id: "c", label: "P2" }], answer: "a", why: "As with every LDP label, the downstream router chooses it. PE2 advertised 25001 for PW 5000; PE1 just uses it." },
      },
    ],
  },
  {
    n: 5,
    title: "The transport underneath",
    idea: "The pseudowire rides on the transport LSP. Break the LSP and the wire stops carrying frames — even if the signaling looks fine.",
    steps: [
      {
        title: "LDP disappears on P1–P2",
        body: <p>P1 stops running LDP toward P2. The targeted session runs over plain IP and stays up. On IOS XR the pseudowire even stays up — but P1 has no label from P2 for 4.4.4.4, removes the transport label, and P2 receives PE2&apos;s PW label, which means nothing to it. (On Junos, PE1 keeps the pseudowire down: no LSP to 4.4.4.4 in inet.3.)</p>,
        runs: [{ label: "P1: no LDP toward P2, then ping", actions: [set("P1: LDP removed from the interface toward P2", "P1", (c) => void (c.ldp["ge-0/0/1"] = false)), ping("CE1A", "192.168.100.2")] }],
        show: ["path", "test"],
      },
      {
        title: "Repair the LSP, prove the wire",
        body: <p>Put LDP back. The transport label returns, P2 pops it as before, and PE2 sees the PW label it expects.</p>,
        pre: [set("P1: LDP removed from the interface toward P2", "P1", (c) => void (c.ldp["ge-0/0/1"] = false))],
        runs: [{ label: "P1: LDP back toward P2, then ping", actions: [set("P1: LDP on the interface toward P2", "P1", (c) => void (c.ldp["ge-0/0/1"] = true)), ping("CE1A", "192.168.100.2")] }],
        show: ["path", "test"],
      },
    ],
  },
  {
    n: 6,
    title: "Read the evidence",
    idea: "Test → attachment circuits → targeted LDP → pseudowire state and labels → transport LSP.",
    steps: [
      {
        title: "The guided lesson's incident",
        body: <p>Last night PE2&apos;s CUST-A pseudowire was defined with PW ID 6000. CUST-A&apos;s sites lost each other; everything else looks healthy. Walk the ladder: the first rung that is wrong names the layer.</p>,
        pre: [badPwid],
        runs: [{ label: "Ping 192.168.100.2 from CE1A", actions: [ping("CE1A", "192.168.100.2")] }],
        show: ["ladder", "test"],
      },
      {
        title: "Fix one thing, prove it",
        body: <p>Set PE2&apos;s PW ID back to 5000. Both PEs now advertise the same PW FEC, each learns the other&apos;s label, the pseudowire comes up — and a fresh ping proves it end to end.</p>,
        pre: [badPwid],
        runs: [{ label: "PE2: PW ID 5000 again, then ping", actions: [set("PE2: CUST-A's pseudowire back to PW ID 5000", "PE2", (c) => void (xcA(c).pwid = 5000)), ping("CE1A", "192.168.100.2")] }],
        show: ["ladder", "test"],
      },
    ],
  },
];
