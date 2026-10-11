import { LC_MEMBERS, pk, type LcState } from "@/lib/sim-engine/scenarios/lacpNet";

/**
 * Hands-on challenges of the LACP Lab's engineering workspace — each checked against the network itself (its runs,
 * its computed bundle), never against what was clicked or typed.
 */
export interface LcChallenge {
  id: string;
  title: string;
  how: string;
  done: (s: LcState) => boolean;
  /** What is still missing, from the network's own state — shown while the challenge is open and something was tried. */
  next: (s: LcState) => string;
}
const poMembers = (s: LcState) => s.bundle.logical.find((l) => l.kind === "po")?.members.length ?? 0;
const flowsSpread = (s: LcState, n: number) => s.runs.some((r) => r.kind === "traffic" && r.cfgSeq === s.cfgSeq && r.results.every((x) => x.replied) && new Set(r.results.map((x) => x.memberOut)).size >= n);
export const LC_CHALLENGES: LcChallenge[] = [
  {
    id: "spread",
    title: "Prove both members carry traffic",
    how: "Send several flows (Four flows ▶) and show that at least two different members were used — and every ping came back.",
    done: (s) => flowsSpread(s, 2),
    next: (s) => (poMembers(s) < 2 ? `The bundle has ${poMembers(s)} working member${poMembers(s) === 1 ? "" : "s"}. Get both members of Po1 / ae0 bundled first.` : "Send several flows after your last change (Four flows ▶). One flow always stays on one member, so it takes more than one."),
  },
  {
    id: "three",
    title: "Build a three-member bundle",
    how: "Plug in the ge-0/0/22 cable and add it to Po1 / ae0 on both switches with LACP; then show three flows on three different members.",
    done: (s) => s.bundle.logical.some((l) => l.kind === "po" && l.members.length === 3) && flowsSpread(s, 3),
    next: (s) => {
      if (!s.cfg.cables["ge-0/0/22"]) return "Plug in the ge-0/0/22 cable first.";
      const n = poMembers(s);
      if (n < 3) return `The bundle has ${n} working member${n === 1 ? "" : "s"}. Put ge-0/0/22 in Po1 / ae0 with LACP on BOTH switches.`;
      return "Three members are bundled. Now send enough flows to see three different members used.";
    },
  },
  {
    id: "lacpdu",
    title: "Catch the LACP conversation",
    how: "Send one round of LACPDUs and find them in a capture on a member port (they go to 01:80:C2:00:00:02).",
    done: (s) => s.captures.some((c) => c.frame.kind === "lacpdu"),
    next: () => "Send one round of LACPDUs (LACPDUs ▶), then open a capture on a member port.",
  },
  {
    id: "passive",
    title: "Run one side passive — and keep the bundle",
    how: "Make every uplink member of one switch LACP passive while the other stays active, and show traffic still crosses on both members.",
    done: (s) => (["SW1", "SW2"] as const).some((sw) => LC_MEMBERS.filter((m) => s.cfg.cables[m] && s.cfg.sw[sw].members[m].mode !== "off").every((m) => s.cfg.sw[sw].members[m].mode === "passive")) && flowsSpread(s, 2),
    next: (s) => {
      const side = (["SW1", "SW2"] as const).find((sw) => LC_MEMBERS.filter((m) => s.cfg.cables[m] && s.cfg.sw[sw].members[m].mode !== "off").every((m) => s.cfg.sw[sw].members[m].mode === "passive"));
      if (!side) return "Make every uplink member of ONE switch passive (channel-group 1 mode passive · lacp passive), and leave the other switch active.";
      if (poMembers(s) < 2) return `${side} is passive, but the bundle doesn't have two working members. Is the other side still active?`;
      return `${side} is passive and the bundle is up. Send several flows after your last change.`;
    },
  },
  {
    id: "fail",
    title: "Lose a member without losing a ping",
    how: "Unplug one member of the working bundle, then send traffic: every ping must come back over the remaining members.",
    done: (s) => LC_MEMBERS.some((m) => !s.cfg.cables[m] && m !== "ge-0/0/22") && s.bundle.logical.some((l) => l.kind === "po") && s.runs.some((r) => r.kind === "traffic" && r.cfgSeq === s.cfgSeq && r.results.length > 1 && r.results.every((x) => x.replied)),
    next: (s) => {
      if (!LC_MEMBERS.some((m) => !s.cfg.cables[m] && m !== "ge-0/0/22")) return "Unplug one member of the working bundle (ge-0/0/23 or ge-0/0/24).";
      if (!s.bundle.logical.some((l) => l.kind === "po")) return "The bundle itself is down. Plug the cable back and check Po1 / ae0 first.";
      return "A member is out and the bundle is up. Send several flows after the unplug: every ping must come back.";
    },
  },
  {
    id: "silent",
    title: "Survive a silent failure within seconds",
    how: "Configure the fast LACP rate where it matters, fail a member silently, wait 5 s and show the flows that used it work again.",
    done: (s) => LC_MEMBERS.some((m) => s.silent[m] !== undefined && (["SW1", "SW2"] as const).every((sw) => s.bundle.members[pk(sw, m)].state === "suspended")) && s.runs.some((r) => r.kind === "traffic" && r.results.length > 0 && r.results.every((x) => x.replied) && LC_MEMBERS.some((m) => s.silent[m] !== undefined && r.clock > s.silent[m]! && r.clock - s.silent[m]! <= 10)),
    next: (s) => {
      const m = LC_MEMBERS.find((x) => s.silent[x] !== undefined);
      if (!m) return "Configure the fast rate first, then fail a member silently (Silent failure on …).";
      if (!(["SW1", "SW2"] as const).every((sw) => s.bundle.members[pk(sw, m)].state === "suspended")) return `${m} is failing silently, but LACP hasn't removed it at both ends yet. With the slow rate that takes 90 s: which ends need the fast rate?`;
      return `Both ends removed ${m}. Now send flows within 10 s of the failure.`;
    },
  },
];
