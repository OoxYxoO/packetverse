import type { SpChallenge } from "@/components/sp-lab/spKit";
import { BIG, TO_R6, endSid, sxLocalSid, type SxState } from "@/lib/sim-engine/scenarios/sxNet";

/** SRv6 Foundations Lab challenges — checked from locators, local SIDs and fresh tests. */
const fresh = (s: SxState) => s.tests.filter((t) => t.cfgSeq === s.cfgSeq && t.kind === "srv6");
const last = (s: SxState) => fresh(s).at(-1);
const hint = (s: SxState) => {
  const t = last(s);
  return !t ? "send a segment list from R1." : t.ok ? `that one went ${t.path.join(" → ")}.` : `that one failed: ${t.why}`;
};

export const SX_CHALLENGES: SpChallenge<SxState>[] = [
  {
    id: "top",
    title: "Through the top, on purpose",
    how: "Without changing any configuration, get H1's traffic to H6 over R1 → R2 → R3 → R6 with a segment list of exactly two SIDs.",
    done: (s) => fresh(s).some((t) => t.ok && t.sids.length === 2 && t.path.join("-") === "H1-R1-R2-R3-R6-H6"),
    next: hint,
  },
  {
    id: "twice",
    title: "Through R6 twice",
    how: "Without changing any configuration, send a segment list that makes the packet cross R6 as a transit router before it ends at R6.",
    done: (s) => fresh(s).some((t) => t.ok && t.path.filter((x) => x === "R6").length >= 2),
    next: hint,
  },
  {
    id: "move",
    title: "Same SID, the long way",
    how: "Make R6's End SID be reached over the top by changing IS-IS metrics only, and prove it with a test to [R6 End].",
    done: (s) => fresh(s).some((t) => t.ok && t.sids.join() === TO_R6.join() && t.path.includes("R2") && t.path.includes("R3")),
    next: (s) => hint(s),
  },
  {
    id: "jumbo",
    title: "Room for the headers",
    how: "Send a 1460-byte packet with three SIDs through the bottom ([R4 End, R5 End, R6 End]) and work out its size on the R4–R5 link. Then make the R4–R5 link drop it — by lowering one MTU on the console — and put it back so it passes again.",
    done: (s) => {
      const t = fresh(s).filter((x) => x.size >= BIG && x.sids.length === 3);
      return s.tests.some((x) => x.kind === "srv6" && x.icmp === "toobig") && t.some((x) => x.ok) && s.cfg.R4.ifs["ge-0/0/1"]!.mtu >= 9000;
    },
    next: (s) => (!s.tests.some((x) => x.kind === "srv6" && x.icmp === "toobig") ? "no test has been dropped for MTU yet." : s.cfg.R4.ifs["ge-0/0/1"]!.mtu < 9000 ? "put R4's MTU toward R5 back to 9216." : "now send the 1460-byte, three-SID test again."),
  },
  {
    id: "rebuild",
    title: "Rebuild R3",
    how: "Press “Wipe R3's SRv6” below, then rebuild it from R3's console: locator MAIN 2001:db8:100:3::/64 under segment-routing srv6, enabled in IS-IS. Prove it with a test through [R3 End, R6 End].",
    done: (s) => !!s.wiped && !!sxLocalSid(s.view, "R3", endSid(3)) && fresh(s).some((t) => t.ok && t.sids[0] === endSid(3)),
    next: (s) => (!s.wiped ? "press “Wipe R3's SRv6” first." : !sxLocalSid(s.view, "R3", endSid(3)) ? "R3 has no End SID 2001:db8:100:3:1:: yet." : hint(s)),
  },
];
