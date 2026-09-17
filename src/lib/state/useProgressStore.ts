"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface Achievement {
  id: string;
  title: string;
  description: string;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: "first-packet", title: "First Packet", description: "Completed your first interactive simulation." },
  { id: "packet-detective", title: "Packet Detective", description: "Inspected 10 packet headers in detail." },
  { id: "handshake-hero", title: "Handshake Hero", description: "Completed the TCP three-way handshake simulation." },
  { id: "spf-navigator", title: "SPF Navigator", description: "Changed OSPF costs to steer traffic onto a new best path." },
  { id: "path-architect", title: "Path Architect", description: "Used BGP Local Preference to make an AS prefer a different upstream." },
  { id: "label-switcher", title: "Label Switcher", description: "Repaired a broken LDP adjacency and restored an MPLS LSP end to end." },
  { id: "vpn-architect", title: "VPN Architect", description: "Repaired a Route Target mismatch and restored MPLS L3VPN connectivity end to end." },
  { id: "control-plane-architect", title: "Control Plane Architect", description: "Redesigned a 6-PE network around redundant Route Reflectors, cutting iBGP sessions while keeping every route distributed." },
  { id: "fabric-explorer", title: "Fabric Explorer", description: "Built a BGP EVPN Type 2 route and repaired a Route Target mismatch to restore VXLAN reachability end to end." },
  { id: "flood-controller", title: "Flood Controller", description: "Repaired a broken EVPN Type 3 (IMET) advertisement and restored broadcast/BUM replication to every VTEP in a VNI." },
  { id: "anycast-architect", title: "Anycast Architect", description: "Repaired an L3 VNI/VRF mismatch and restored inter-subnet connectivity through a Distributed Anycast Gateway using symmetric IRB." },
  { id: "prefix-navigator", title: "Prefix Navigator", description: "Repaired a next-hop VTEP resolution failure and restored reachability to an entire IP prefix advertised via EVPN Route Type 5." },
  { id: "mobility-tracker", title: "Mobility Tracker", description: "Repaired a stale mobility comparison and restored reachability to an endpoint after it moved to a new VTEP, using EVPN's MAC Mobility sequence." },
  { id: "broadcast-tamer", title: "Broadcast Tamer", description: "Repaired a missing MAC/IP binding and restored EVPN ARP suppression, eliminating unnecessary VXLAN BUM replication for a known endpoint." },
  { id: "multihoming-engineer", title: "Multihoming Engineer", description: "Kept a dual-homed server reachable through a PE failure via DF re-election, and repaired a DF-consistency fault causing duplicate broadcasts." },
  { id: "convergence-engineer", title: "Convergence Engineer", description: "Repaired a stale EVPN aliasing next-hop set by processing a Mass Withdrawal, restoring known-unicast reachability to a multihomed server without touching DF election." },
  { id: "virtual-wire-engineer", title: "Virtual Wire Engineer", description: "Repaired an L2 MTU mismatch to restore an EVPN-VPWS point-to-point service, then verified it survived a live Primary/Backup failover." },
  { id: "traffic-engineer", title: "Traffic Engineer", description: "Used CSPF and RSVP-TE to steer a bandwidth-guaranteed LSP off the IGP shortest path, then repaired a bandwidth-constraint failure by releasing a competing reservation." },
  { id: "fast-reroute-engineer", title: "Fast Reroute Engineer", description: "Traced local repair through a facility-backup bypass at the Point of Local Repair, then diagnosed and fixed a link-protection bypass that could not survive a full node failure by establishing genuine node protection." },
  { id: "segment-programmer", title: "Segment Programmer", description: "Built a segment list forcing traffic through a locally-significant Adjacency SID, diagnosed a segment list that skipped its owning router, and repaired it into a working Node-SID + Adjacency-SID + Node-SID path." },
  { id: "policy-architect", title: "Policy Architect", description: "Built an SR Policy from an explicit candidate and a computed dynamic fallback, diagnosed a candidate-preference intent mismatch that was silently selecting the wrong valid path, and repaired it after verifying the resend." },
  { id: "convergence-architect", title: "Convergence Architect", description: "Built SR-MPLS TI-LFA local repair from post-convergence SPF, P-Space, Q-Space, and a derived PQ candidate, protected both a link and a node, diagnosed a stale repair computation left behind by an IGP metric change, and verified the fix with a real packet." },
  { id: "algorithm-engineer", title: "Algorithm Engineer", description: "Defined Flex-Algo 128 for low-latency forwarding — DELAY metric, BLUE-excluded affinity, algorithm-specific Prefix-SID — diagnosed a router that had silently stopped participating in the algorithm, and verified the repaired low-delay path with a real packet." },
  { id: "pseudowire-engineer", title: "Pseudowire Engineer", description: "Built a traditional LDP-signaled pseudowire — targeted LDP session, matching PW FEC, and directional receive-label allocation — verified forward and reverse traffic use different PW labels, diagnosed a PW ID mismatch between the two PEs, and confirmed the fix with a real Ethernet frame." },
  { id: "virtual-lan-engineer", title: "Virtual LAN Engineer", description: "Built a traditional VPLS full mesh of pseudowires, demonstrated data-plane MAC learning and BUM flooding, diagnosed a missing mesh pseudowire by its pseudowire split-horizon symptom, and repaired it without ever disabling split horizon." },
  { id: "bgp-vpls-architect", title: "BGP VPLS Architect", description: "Signaled a full VPLS mesh using RFC 4761 BGP auto-discovery and label blocks over a Route Reflector, calculated every directional PW label from a VE ID and label block, proved BGP never carried a customer MAC address, and repaired a Route Target membership mismatch." },
  { id: "h-vpls-architect", title: "H-VPLS Architect", description: "Built a hierarchical VPLS service — a PE-rs core full mesh plus one spoke pseudowire per access MTU-s — proved local switching stays local, traced a frame end to end through spoke → mesh → spoke, and diagnosed a misclassified spoke pseudowire without ever disabling split horizon globally." },
  { id: "fabric-detective", title: "Fabric Detective", description: "Solved a Professional-difficulty incident in the EVPN Troubleshooting Arena — investigate, hypothesize, repair, and verify without being told the fault." },
  { id: "evpn-troubleshooter", title: "EVPN Troubleshooter", description: "Solved Arena incidents spanning a broad range of EVPN fault families — underlay, control-plane, service, and forwarding alike." },
  { id: "l2vpn-architect", title: "L2VPN Architect", description: "Traced one customer through VPWS, LDP-VPLS, BGP-VPLS, H-VPLS, and EVPN, diagnosed a BGP-VPLS mental-model incident without breaking anything that wasn't broken, and matched a mixed 8-site requirement to the right architecture on its technical merits." },
  { id: "srv6-programmer", title: "SRv6 Programmer", description: "Decomposed an SRv6 SID into LOC:FUNCT:ARG, read a Local SID Table, built a correct full SRH with reversed segment-list storage order, traced a real End execution end to end, and repaired a missing local SID binding without touching MPLS." },
];

export interface ArenaResult {
  seed: string;
  faultIds: string[];
  categories: string[];
  difficulty: "associate" | "professional" | "expert";
  score: number;
  xpAwarded: number;
  hintsUsed: number;
  timestamp: number;
}

interface ProgressState {
  xp: number;
  streak: number;
  completedLessons: string[];
  achievements: string[];
  packetsInspected: number;
  quizScore: { correct: number; total: number };
  arenaResults: ArenaResult[];
  completeLesson: (lessonId: string, xpAward?: number) => void;
  recordAnswer: (correct: boolean) => void;
  inspectPacket: () => void;
  unlockAchievement: (id: string) => void;
  recordArenaResult: (result: { seed: string; faultIds: string[]; categories: string[]; difficulty: "associate" | "professional" | "expert"; score: number; hintsUsed: number }) => number;
  reset: () => void;
}

const ARENA_XP_CAP: Record<"associate" | "professional" | "expert", number> = { associate: 200, professional: 400, expert: 600 };

export const useProgressStore = create<ProgressState>()(
  persist(
    (set, get) => ({
      xp: 0,
      streak: 1,
      completedLessons: [],
      achievements: [],
      packetsInspected: 0,
      quizScore: { correct: 0, total: 0 },
      arenaResults: [],
      completeLesson: (lessonId, xpAward = 100) =>
        set((s) => ({
          xp: s.xp + (s.completedLessons.includes(lessonId) ? 0 : xpAward),
          completedLessons: s.completedLessons.includes(lessonId) ? s.completedLessons : [...s.completedLessons, lessonId],
          achievements: s.achievements.includes("first-packet") ? s.achievements : [...s.achievements, "first-packet"],
        })),
      recordAnswer: (correct) =>
        set((s) => ({
          xp: s.xp + (correct ? 15 : 0),
          quizScore: { correct: s.quizScore.correct + (correct ? 1 : 0), total: s.quizScore.total + 1 },
        })),
      inspectPacket: () =>
        set((s) => {
          const packetsInspected = s.packetsInspected + 1;
          const unlock = packetsInspected >= 10 && !s.achievements.includes("packet-detective");
          return {
            packetsInspected,
            achievements: unlock ? [...s.achievements, "packet-detective"] : s.achievements,
          };
        }),
      unlockAchievement: (id) =>
        set((s) => ({ achievements: s.achievements.includes(id) ? s.achievements : [...s.achievements, id] })),
      recordArenaResult: ({ seed, faultIds, categories, difficulty, score, hintsUsed }) => {
        const s = get();
        const seedPlayedBefore = s.arenaResults.some((r) => r.seed === seed);
        const cap = ARENA_XP_CAP[difficulty];
        const raw = Math.round((score / 1000) * cap);
        const xpAwarded = seedPlayedBefore ? Math.round(raw * 0.2) : raw;
        const solvedCategories = new Set([...s.arenaResults.flatMap((r) => r.categories), ...categories]);
        const newAchievements = [...s.achievements];
        if (difficulty !== "associate" && !newAchievements.includes("fabric-detective")) newAchievements.push("fabric-detective");
        if (solvedCategories.size >= 6 && !newAchievements.includes("evpn-troubleshooter")) newAchievements.push("evpn-troubleshooter");
        set({
          xp: s.xp + xpAwarded,
          arenaResults: [...s.arenaResults, { seed, faultIds, categories, difficulty, score, xpAwarded, hintsUsed, timestamp: Date.now() }],
          achievements: newAchievements,
        });
        return xpAwarded;
      },
      reset: () =>
        set({ xp: 0, streak: 1, completedLessons: [], achievements: [], packetsInspected: 0, quizScore: { correct: 0, total: 0 }, arenaResults: [] }),
    }),
    { name: "packetverse-progress" },
  ),
);

export const levelForXp = (xp: number) => Math.max(1, Math.floor(xp / 250) + 1);
export const xpIntoLevel = (xp: number) => xp % 250;
