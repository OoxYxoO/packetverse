import type { ReactNode } from "react";
import type { SpLevel } from "@/components/sp-lab/spKit";
import { L2_IP, MGMT, MGMT_VLAN, USER_VLAN } from "@/lib/sim-engine/scenarios/troubleshootingLayer2";
import type { L2Action, L2State } from "@/lib/sim-engine/scenarios/l2Net";

/**
 * Layer 2 Lab · Learn — six levels on the lab network:
 *   1 Frames find their way · 2 VLANs and tags · 3 A trunk carries a list · 4 The native VLAN · 5 Spanning tree ·
 *   6 When it breaks: VLAN 10 stops at one trunk
 */

const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const M = ({ children }: { children: ReactNode }) => <span className="pv-mono text-pv-text">{children}</span>;
const set = (text: string, f: (s: L2State) => void): L2Action => ({ type: "set", text, f });
const pingAB: L2Action = { type: "ping", from: "HOST-A", to: L2_IP["HOST-B"], count: 4 };
const pingBA: L2Action = { type: "ping", from: "HOST-B", to: L2_IP["HOST-A"], count: 1 };
const ping13: L2Action = { type: "ping", from: "SW1", to: MGMT.SW3.ip, count: 4 };
const pruned = set("SW2: ge-0/0/51 trunk members MGMT only (VLAN 10 removed)", (s) => void (s.cfg.SW2.ports["ge-0/0/51"].members = [MGMT_VLAN]));
const wrongAccess = set("SW3: ge-0/0/1 access VLAN MGMT", (s) => void (s.cfg.SW3.ports["ge-0/0/1"] = { mode: "access", access: MGMT_VLAN }));
const nativeTen = set("SW1: ge-0/0/49 native-vlan-id 10", (s) => void (s.cfg.SW1.ports["ge-0/0/49"].native = USER_VLAN));
const noStp = set("SW1: protocols rstp deleted", (s) => void (s.cfg.SW1.rstp = false));
const fixPrune = set("SW2: set interfaces ge-0/0/51 unit 0 family ethernet-switching vlan members USERS (committed)", (s) => void (s.cfg.SW2.ports["ge-0/0/51"].members = [USER_VLAN, MGMT_VLAN]));

export const L2_LEVELS: SpLevel<L2Action>[] = [
  {
    n: 1,
    title: "Frames find their way",
    idea: "A switch learns where each MAC address lives from the source of every frame it receives, floods what it doesn't know yet, and forwards the rest straight to the learned port. A ping starts with a broadcast ARP that teaches every switch on the way.",
    steps: [
      {
        title: "One ping, three switches learn",
        body: <p>HOST-A (<M>{L2_IP["HOST-A"]}</M>) pings HOST-B (<M>{L2_IP["HOST-B"]}</M>). Its ARP broadcast is flooded in VLAN 10; every switch it crosses learns HOST-A&apos;s MAC on the port it arrived on. HOST-B&apos;s reply teaches them the way back.</p>,
        runs: [{ label: "ping HOST-B ×4", actions: [pingAB] }],
        show: ["path", "fdb"],
        check: { q: "Where does SW3 learn HOST-A's MAC?", options: [{ id: "a", label: "On ge-0/0/51 — the port the frame arrived on, from SW2" }, { id: "b", label: "On ge-0/0/1, toward HOST-B" }, { id: "c", label: "On ge-0/0/50, the direct link to SW1" }], answer: "a", why: "A switch learns the source MAC on the ingress port. SW1 ge-0/0/50 is blocked by spanning tree, so frames reach SW3 via SW2." },
      },
    ],
  },
  {
    n: 2,
    title: "VLANs and tags",
    idea: "A VLAN is a separate broadcast domain inside the same switches. Access ports carry one VLAN untagged — the host never sees a tag. Trunks carry several VLANs, each frame marked with an 802.1Q tag naming its VLAN.",
    steps: [
      {
        title: "Untagged at the edge, tagged between switches",
        body: <p>The same ARP leaves HOST-A untagged, crosses the trunks with tag <M>10</M>, and reaches HOST-B untagged again. Management traffic between the switches uses VLAN <M>20</M> on the same trunks.</p>,
        runs: [{ label: "ping HOST-B · SW1 → SW3 management", actions: [pingAB, ping13] }],
        show: ["vlans", "path"],
        check: { q: "Why can HOST-A not ping SW3's management address 10.20.20.3?", options: [{ id: "a", label: "It's in VLAN 20, another broadcast domain (and subnet) with no router between them" }, { id: "b", label: "SW3 blocks pings" }, { id: "c", label: "The trunks drop VLAN 20" }], answer: "a", why: "VLANs separate broadcast domains; crossing between them needs a router." },
      },
      {
        title: "A port in the wrong VLAN",
        body: <p>HOST-B&apos;s new desk port on SW3 was configured as an access port in VLAN <M>MGMT</M>. The link is up, the address is right — and HOST-B is now in another broadcast domain.</p>,
        pre: [wrongAccess],
        runs: [{ label: "ping HOST-B · HOST-B pings back", actions: [pingAB, pingBA] }],
        show: ["fdb", "path"],
        check: { q: "SW3 learned HOST-B's MAC in VLAN MGMT. What does that prove?", options: [{ id: "a", label: "SW3 puts HOST-B's port in VLAN 20 — the port's access VLAN is wrong" }, { id: "b", label: "HOST-B has a wrong IP address" }, { id: "c", label: "The trunk is broken" }], answer: "a", why: "The MAC table records the VLAN a frame was classified into on arrival — the port's access VLAN." },
      },
    ],
  },
  {
    n: 3,
    title: "A trunk carries a list",
    idea: "Each trunk carries only the VLANs in its member list. A VLAN missing from one trunk is silently not sent across it — links stay up, spanning tree doesn't change, and other VLANs on the same trunk keep working.",
    steps: [
      {
        title: "VLAN 10 stops at SW2",
        body: <p>Last night&apos;s trunk clean-up removed <M>USERS</M> from SW2 <M>ge-0/0/51</M>, the trunk toward SW3. Ping HOST-B, then check management to SW3 across the same trunk.</p>,
        pre: [pruned],
        runs: [{ label: "ping HOST-B · SW1 → SW3 management", actions: [pingAB, ping13] }],
        show: ["path", "fdb", "vlans"],
        check: { q: "HOST-A fails, SW1 → SW3 management works over the same trunk. What does that rule out?", options: [{ id: "a", label: "The cable and the link — VLAN 20 crosses it fine; only VLAN 10 is missing" }, { id: "b", label: "Nothing" }, { id: "c", label: "SW3's management configuration" }], answer: "a", why: "One VLAN failing where another passes on the same link points at per-VLAN configuration, not the physical link." },
      },
    ],
  },
  {
    n: 4,
    title: "The native VLAN",
    idea: "A trunk sends one VLAN untagged: its native VLAN. Both ends must agree on which one it is — otherwise frames sent untagged as one VLAN are received as another.",
    steps: [
      {
        title: "Untagged, and misread",
        body: <p>A template set <M>native-vlan-id 10</M> on SW1 <M>ge-0/0/49</M>; SW2&apos;s end still uses native VLAN 1. SW1 now sends VLAN 10 untagged — and SW2 files those frames under VLAN 1.</p>,
        pre: [nativeTen],
        runs: [{ label: "ping HOST-B · SW1 → SW3 management", actions: [pingAB, ping13] }],
        show: ["fdb", "path"],
        check: { q: "SW2 learned HOST-A's MAC in VLAN default on ge-0/0/49. Why?", options: [{ id: "a", label: "SW1 sent VLAN 10 untagged and SW2 classified untagged frames into its native VLAN 1" }, { id: "b", label: "HOST-A moved to VLAN 1" }, { id: "c", label: "SW2's MAC table is corrupted" }], answer: "a", why: "An untagged frame belongs to the receiving port's native VLAN — whatever the sender meant." },
      },
    ],
  },
  {
    n: 5,
    title: "Spanning tree",
    idea: "Three switches in a triangle form a loop. RSTP elects a root bridge (lowest priority), gives every other switch one root port, and blocks one port so the triangle becomes a tree. Without it, every broadcast circulates forever.",
    steps: [
      {
        title: "Root SW2, one blocked port",
        body: <p>SW2 has the lowest priority (<M>4096</M>) and is root. SW1 and SW3 each reach it with cost 20000; on the SW1–SW3 link SW3 wins (lower bridge ID), so SW1 <M>ge-0/0/50</M> is <B>Alternate, Discarding</B>.</p>,
        runs: [{ label: "ping HOST-B ×4", actions: [pingAB] }],
        show: ["stp", "path"],
        check: { q: "Why does HOST-A's traffic go SW1 → SW2 → SW3 instead of SW1 → SW3 directly?", options: [{ id: "a", label: "SW1 ge-0/0/50 is the Alternate port: blocked to break the loop" }, { id: "b", label: "The SW1–SW3 link is down" }, { id: "c", label: "VLAN 10 isn't allowed on SW1–SW3" }], answer: "a", why: "RSTP blocks exactly one port of the triangle; the tree goes through the root." },
      },
      {
        title: "No spanning tree on SW1",
        body: <p>Someone deleted <M>protocols rstp</M> on SW1. SW1 now forwards on both trunks and swallows BPDUs; SW2 and SW3 see no RSTP neighbour on those ports and forward too.</p>,
        pre: [noStp],
        runs: [{ label: "ping HOST-B ×4", actions: [pingAB] }],
        show: ["stp", "counters"],
        check: { q: "Counters explode, MACs flap between ports, pings mostly die. Why?", options: [{ id: "a", label: "No port is blocked: broadcasts circle the triangle forever — a broadcast storm" }, { id: "b", label: "A cable is faulty" }, { id: "c", label: "VLAN 10 is missing" }], answer: "a", why: "Ethernet frames have no TTL; without a blocked port a broadcast is copied around the loop indefinitely." },
      },
    ],
  },
  {
    n: 6,
    title: "When it breaks: VLAN 10 stops at one trunk",
    idea: "The guided lesson's incident: HOST-A can't reach HOST-B, everything looks up. Follow the frame, read the MAC tables, find the trunk that doesn't carry VLAN 10 — fix it and prove it.",
    steps: [
      {
        title: "Follow the frame",
        body: <p>Reproduce it, then read where the ARP stopped and which switches learned HOST-A.</p>,
        pre: [pruned],
        runs: [{ label: "ping HOST-B · SW1 → SW3 management", actions: [pingAB, ping13] }],
        show: ["path", "fdb", "vlans"],
        check: { q: "SW2 learned HOST-A, SW3 didn't, VLAN 20 crosses SW2–SW3 fine. Which repair?", options: [{ id: "a", label: "Add VLAN 10 (USERS) to SW2 ge-0/0/51's member list" }, { id: "b", label: "Restart spanning tree" }, { id: "c", label: "Replace the SW2–SW3 cable" }], answer: "a", why: "The frame reached SW2 and was never sent toward SW3 — the trunk doesn't carry VLAN 10." },
      },
      {
        title: "Repair, then prove",
        body: <p>Add <M>USERS</M> to SW2 <M>ge-0/0/51</M> and commit. Then prove: a fresh ping, and SW3 has learned HOST-A on <M>ge-0/0/51</M>.</p>,
        pre: [pruned],
        runs: [{ label: "fix · ping HOST-B", actions: [fixPrune, pingAB] }],
        show: ["fdb", "path"],
        check: { q: "Which evidence proves the repair?", options: [{ id: "a", label: "A fresh 4/4 ping and SW3 learning HOST-A in USERS on ge-0/0/51" }, { id: "b", label: "The trunk is up" }, { id: "c", label: "show vlans lists USERS" }], answer: "a", why: "The trunk was up all along; fresh traffic and the MAC table it builds are the proof." },
      },
    ],
  },
];
