import type { SpChallenge } from "@/components/sp-lab/spKit";
import { L2_IP, L2_MAC, USER_VLAN } from "@/lib/sim-engine/scenarios/troubleshootingLayer2";
import { L2_SWS, faultsOf, l2Stp, liveFdb, loopVlans, testText, type L2State } from "@/lib/sim-engine/scenarios/l2Net";

/** Layer 2 Lab challenges — checked from the MAC tables, spanning tree, configuration and test results, never from the commands typed. */
const fresh = (s: L2State) => s.tests.filter((t) => t.cfgSeq === s.cfgSeq);
const freshAB = (s: L2State) => fresh(s).some((t) => t.from === "HOST-A" && t.to === L2_IP["HOST-B"] && t.recv === t.sent && !t.storm);
const hint = (s: L2State) => {
  const t = s.tests[s.tests.length - 1];
  return t ? `last test: ${testText(t)}.` : "run a ping first.";
};
const clean = (s: L2State) => faultsOf(s.cfg).filter((f) => f !== "root").length === 0;

export const L2_CHALLENGES: SpChallenge<L2State>[] = [
  {
    id: "root",
    title: "Move the root bridge",
    how: "Make a switch other than SW2 the RSTP root by changing bridge priorities. Prove the new tree still blocks exactly one port and a fresh ping HOST-A → HOST-B gets every reply.",
    done: (s) => l2Stp(s).bridge.SW1.rootSw !== "SW2" && L2_SWS.every((sw) => s.cfg[sw].rstp) && Object.values(l2Stp(s).ports).filter((p) => p.role === "Alternate").length === 1 && freshAB(s),
    next: (s) => (l2Stp(s).bridge.SW1.rootSw === "SW2" ? "SW2 is still root — lower another switch's bridge-priority below 4096." : !freshAB(s) ? hint(s) : "check spanning tree: exactly one Alternate port."),
  },
  {
    id: "prune",
    title: "Prune VLAN 10, then restore it",
    how: "Remove USERS from a trunk on HOST-A's path so the ping fails (while the links stay up), then put it back and prove a fresh ping succeeds.",
    done: (s) => s.tests.some((t) => t.unreachable && t.faults.includes("prune")) && !faultsOf(s.cfg).includes("prune") && freshAB(s),
    next: (s) => (!s.tests.some((t) => t.unreachable && t.faults.includes("prune")) ? "no failed ping with VLAN 10 missing from a trunk yet." : faultsOf(s.cfg).includes("prune") ? "a trunk still lacks USERS." : hint(s)),
  },
  {
    id: "native",
    title: "Catch a native VLAN mismatch",
    how: "Make the two ends of a trunk disagree on the native VLAN so that a host's MAC is learned in VLAN default somewhere, then make them agree and prove a fresh ping.",
    done: (s) => s.tests.some((t) => t.faults.includes("native")) && L2_SWS.some((sw) => s.fdb[sw].some((e) => e.vlan === 1 && (e.mac === L2_MAC["HOST-A"] || e.mac === L2_MAC["HOST-B"]))) && !faultsOf(s.cfg).includes("native") && freshAB(s),
    next: (s) => (!faultsOf(s.cfg).includes("native") && !s.tests.some((t) => t.faults.includes("native")) ? "no trunk with mismatched native VLANs yet (interfaces <if> native-vlan-id)." : !L2_SWS.some((sw) => s.fdb[sw].some((e) => e.vlan === 1)) ? "ping, then find the host MAC learned in VLAN default." : faultsOf(s.cfg).includes("native") ? "the natives still differ." : hint(s)),
  },
  {
    id: "storm",
    title: "Survive a broadcast storm",
    how: "Remove RSTP from one switch and see the storm in a ping (huge loss, flapping MACs), then restore RSTP and prove a clean ping with exactly one blocked port.",
    done: (s) => s.tests.some((t) => t.storm) && !loopVlans(s.cfg, l2Stp(s)).length && L2_SWS.every((sw) => s.cfg[sw].rstp) && freshAB(s),
    next: (s) => (!s.tests.some((t) => t.storm) ? (loopVlans(s.cfg, l2Stp(s)).length ? "there is a loop — ping to see the storm." : "no loop yet: delete protocols rstp on one switch.") : !L2_SWS.every((sw) => s.cfg[sw].rstp) ? "a switch still has no RSTP." : hint(s)),
  },
  {
    id: "relearn",
    title: "Watch SW3 relearn",
    how: "On a healthy network, clear SW3's MAC table, then ping and show that SW3 has learned HOST-A on ge-0/0/51 and HOST-B on ge-0/0/1 again.",
    done: (s) => s.clearedMac.SW3 !== undefined && clean(s) && liveFdb(s, "SW3").some((e) => e.mac === L2_MAC["HOST-A"] && e.vlan === USER_VLAN && e.port === "ge-0/0/51" && e.seen >= s.clearedMac.SW3!) && liveFdb(s, "SW3").some((e) => e.mac === L2_MAC["HOST-B"] && e.vlan === USER_VLAN && e.port === "ge-0/0/1" && e.seen >= s.clearedMac.SW3!),
    next: (s) => (s.clearedMac.SW3 === undefined ? "clear SW3's ethernet-switching table first." : !clean(s) ? "fix the network first." : "ping, then read SW3's table."),
  },
];
