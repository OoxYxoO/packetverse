import type { SpChallenge } from "@/components/sp-lab/spKit";
import { IPERF_GOOD, l1View, testText, type L1Snapshot, type L1State } from "@/lib/sim-engine/scenarios/l1Net";
import { UPLINK, WINDOW_S, rxBand } from "@/lib/sim-engine/scenarios/troubleshootingLayer1";

/** Layer 1 Lab challenges — checked from link state, optics, counters and test results, never from the commands typed. */
const fresh = (s: L1State) => s.tests.filter((t) => t.cfgSeq === s.cfgSeq);
const hint = (s: L1State) => {
  const t = [...s.tests].reverse().find((x) => x.kind !== "wait");
  return t ? `last test: ${testText(t)}.` : "run a test first.";
};
const A = `ACCESS-SW:${UPLINK}`;
const D = `DIST-SW:${UPLINK}`;
/** Consecutive snapshot pairs at least 30 s apart with traffic on the uplink. */
const pairs = (s: L1State, cur?: boolean) => {
  const xs = s.snaps.filter((x) => !cur || x.cfgSeq === s.cfgSeq);
  const out: [L1Snapshot, L1Snapshot][] = [];
  for (let i = 1; i < xs.length; i++) if (xs[i].t - xs[i - 1].t >= WINDOW_S && xs[i].c[A].inPkts > xs[i - 1].c[A].inPkts) out.push([xs[i - 1], xs[i]]);
  return out;
};
const crc = (p: [L1Snapshot, L1Snapshot], k: string) => p[1].c[k].crc - p[0].c[k].crc;

export const L1_CHALLENGES: SpChallenge<L1State>[] = [
  {
    id: "baseline",
    title: "Take a clean baseline",
    how: `On the healthy network, prove the uplink has no active errors despite its 3,912 historic CRC errors: two counter snapshots at least ${WINDOW_S} s apart, with traffic in between, and CRC +0 on both ends.`,
    done: (s) => rxBand(l1View(s).uplink.rxA) === "normal" && pairs(s).some((p) => crc(p, A) === 0 && crc(p, D) === 0),
    next: (s) => (s.snaps.length < 2 ? `take a snapshot, let ${WINDOW_S} s of traffic pass, take another.` : !pairs(s).length ? `the snapshots must be at least ${WINDOW_S} s apart with traffic in between.` : "the uplink is erroring — is something broken?"),
  },
  {
    id: "admin",
    title: "Switch a port off and on again",
    how: "Disable SERVER's switch port (DIST-SW ge-0/0/2) in the configuration, show that SERVER is unreachable, then enable it and prove a fresh ping gets every reply.",
    done: (s) => s.sys.some((x) => x.dev === "DIST-SW" && /LINK_DOWN.*ifAdminStatus down\(2\).*ge-0\/0\/2/.test(x.text)) && s.tests.some((t) => t.kind === "ping" && t.unreachable) && l1View(s).server.up && fresh(s).some((t) => t.kind === "ping" && !t.unreachable && t.recv === t.sent),
    next: (s) => (!s.sys.some((x) => /ifAdminStatus down\(2\).*ge-0\/0\/2/.test(x.text)) ? "DIST-SW ge-0/0/2 hasn't been disabled yet (Junos: set … disable, commit)." : !s.tests.some((t) => t.unreachable) ? "ping SERVER while the port is down." : !l1View(s).server.up ? "the port is still down." : hint(s)),
  },
  {
    id: "direction",
    title: "Prove which direction suffers",
    how: `Smudge the uplink connector at ACCESS-SW (field kit), then show with one snapshot pair that CRC errors rise on ACCESS-SW ${UPLINK} only. Clean the right end and prove a fresh pair with CRC +0 and the receive level back to normal.`,
    done: (s) => !!s.broke.smudge && pairs(s).some((p) => crc(p, A) > 0 && crc(p, D) === 0) && rxBand(l1View(s).uplink.rxA) === "normal" && pairs(s, true).some((p) => crc(p, A) === 0),
    next: (s) => (!s.broke.smudge ? "use the field kit: smudge the uplink connector at ACCESS-SW." : !pairs(s).some((p) => crc(p, A) > 0) ? `take a snapshot pair (≥ ${WINDOW_S} s, traffic in between) while the connector is dirty.` : rxBand(l1View(s).uplink.rxA) !== "normal" ? "the receive level is still low — which end is dirty?" : "now a fresh snapshot pair after the repair."),
  },
  {
    id: "duplex",
    title: "Create a duplex mismatch, then cure it",
    how: "Force CLIENT's switch port (ACCESS-SW ge-0/0/1) so the two ends disagree on duplex, measure the damage with iperf3, then restore auto-negotiation and prove a fresh test at gigabit speed.",
    done: (s) => s.tests.some((t) => t.kind === "iperf" && (t.mbps ?? 1000) < 10) && !l1View(s).client.mismatch && l1View(s).client.speed === 1000 && fresh(s).some((t) => t.kind === "iperf" && (t.mbps ?? 0) >= IPERF_GOOD),
    next: (s) => (!s.tests.some((t) => t.kind === "iperf" && (t.mbps ?? 1000) < 10) ? (l1View(s).client.mismatch ? "measure it: run iperf3." : "no duplex mismatch on CLIENT's link yet.") : l1View(s).client.mismatch || l1View(s).client.speed !== 1000 ? "the link isn't back to 1000/full auto-negotiated." : hint(s)),
  },
  {
    id: "downshift",
    title: "Find the bad pair",
    how: "Damage CLIENT's patch cable (field kit), find the evidence that names the cause — a TDR test on ACCESS-SW ge-0/0/1 that shows the open pair — then replace the cable and prove gigabit throughput.",
    done: (s) => !!s.broke.pair && !!s.tdr["ACCESS-SW"]?.open && !s.phys.clientPair && l1View(s).client.speed === 1000 && fresh(s).some((t) => t.kind === "iperf" && (t.mbps ?? 0) >= IPERF_GOOD),
    next: (s) => (!s.broke.pair ? "use the field kit: damage CLIENT's patch cable." : !s.tdr["ACCESS-SW"]?.open ? "run a TDR test on ACCESS-SW ge-0/0/1 while the cable is damaged (request diagnostics tdr start interface ge-0/0/1)." : s.phys.clientPair ? "replace the cable." : hint(s)),
  },
];
