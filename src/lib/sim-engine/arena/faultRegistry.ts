import {
  ESI,
  EXTERNAL_PREFIX,
  HOST_A_IP,
  HOST_A_MAC,
  HOST_B_IP,
  HOST_B_MAC,
  L3_VNI,
  LEAFS,
  ROAMER_IP,
  ROAMER_MAC,
  SERVER_A_IP,
  SERVER_A_MAC,
  VNI10010,
  VNI10020,
  VPWS_SERVICE_ID,
  VTEP_LOOPBACK,
  type ArenaFault,
  type ArenaLeafId,
  type ArenaState,
  type FaultId,
} from "./faultTypes";

const RT_HEALTHY = "65000:10010";
const RT_BROKEN = "65000:99999";

function rd(leaf: ArenaLeafId): string {
  return `${VTEP_LOOPBACK[leaf]}:${VNI10010}`;
}

// ---------------------------------------------------------------------------
// Baseline (fully healthy) state — every fault's apply() starts here.
// ---------------------------------------------------------------------------

export function buildBaselineState(seed: string, difficulty: ArenaState["difficulty"]): ArenaState {
  const vtepReachable: ArenaState["vtepReachable"] = {} as ArenaState["vtepReachable"];
  LEAFS.forEach((a) => {
    vtepReachable[a] = {};
    LEAFS.forEach((b) => {
      vtepReachable[a][b] = true;
    });
  });

  return {
    seed,
    difficulty,
    activeFaultIds: [],
    vtepReachable,
    bgpEvpnUp: { LEAF1: true, LEAF2: true, LEAF3: true },
    type2Routes: [
      { mac: HOST_A_MAC, ip: HOST_A_IP, originLeaf: "LEAF1", vni: VNI10010, rd: rd("LEAF1"), rt: RT_HEALTHY, rtMatchesLocally: true },
      { mac: HOST_B_MAC, ip: HOST_B_IP, originLeaf: "LEAF3", vni: VNI10010, rd: rd("LEAF3"), rt: RT_HEALTHY, rtMatchesLocally: true },
      { mac: SERVER_A_MAC, ip: SERVER_A_IP, originLeaf: "LEAF1", vni: VNI10010, rd: rd("LEAF1"), rt: RT_HEALTHY, rtMatchesLocally: true, esi: ESI },
      { mac: ROAMER_MAC, ip: ROAMER_IP, originLeaf: "LEAF2", vni: VNI10010, rd: rd("LEAF2"), rt: RT_HEALTHY, rtMatchesLocally: true },
    ],
    imetMembership: { LEAF1: { [VNI10010]: true }, LEAF2: { [VNI10010]: true }, LEAF3: { [VNI10010]: true, [VNI10020]: true } },
    l3VniByLeaf: { LEAF1: L3_VNI, LEAF2: L3_VNI, LEAF3: L3_VNI },
    type5: { prefix: EXTERNAL_PREFIX, originLeaf: "LEAF3", nextHopVtep: VTEP_LOOPBACK.LEAF3, nextHopReachable: true },
    roamer: { mac: ROAMER_MAC, ip: ROAMER_IP, actualLeaf: "LEAF2", remoteBelievedLeaf: "LEAF2", sequence: { LEAF2: 1 } },
    suppression: { targetIp: HOST_B_IP, targetMac: HOST_B_MAC, bindingPresentAt: { LEAF1: true } },
    es: { esi: ESI, leafs: ["LEAF1", "LEAF2"], dfWinner: "LEAF1", dualDfBelief: { LEAF1: true, LEAF2: false } },
    aliasing: { mac: SERVER_A_MAC, advertisedPeEviRoutes: ["LEAF1", "LEAF2"], perEsWithdrawn: {}, massWithdrawalProcessed: true, eligiblePEs: ["LEAF1", "LEAF2"] },
    vpws: { serviceId: VPWS_SERVICE_ID, primaryPe: "LEAF1", backupPe: "LEAF2", l2MtuAdvertised: { LEAF1: 9000, LEAF2: 9000 }, remoteExpectedMtu: 9000, status: "up" },
  };
}

/** Recomputes every derived field from the raw facts above — the "control plane recalculates → forwarding state recalculates" step (brief §19). Call this after ANY mutation, including repairs. */
export function installDerived(state: ArenaState): ArenaState {
  const eligiblePEs = state.aliasing.massWithdrawalProcessed ? state.aliasing.advertisedPeEviRoutes.filter((l) => !state.aliasing.perEsWithdrawn[l]) : state.aliasing.advertisedPeEviRoutes;
  const vpwsMtuOk = state.vpws.primaryPe ? state.vpws.l2MtuAdvertised[state.vpws.primaryPe] === state.vpws.remoteExpectedMtu : false;
  const vpwsStatus: "up" | "down" = state.vpws.primaryPe && vpwsMtuOk ? "up" : "down";
  return { ...state, aliasing: { ...state.aliasing, eligiblePEs }, vpws: { ...state.vpws, status: vpwsStatus } };
}

// ---------------------------------------------------------------------------
// Incident report text — deterministic per fault, seeded phrasing kept
// minimal (brief §9) so it never leaks the mechanism.
// ---------------------------------------------------------------------------

function incident(site: string, severity: "Minor" | "Major" | "Critical", report: string, started: string) {
  return { site, severity, report, started, recentChanges: "None reported." };
}

// ---------------------------------------------------------------------------
// The fault bank (brief §7)
// ---------------------------------------------------------------------------

export const FAULT_BANK: ArenaFault[] = [
  {
    id: "A",
    category: "underlay",
    internalTitle: "Remote VTEP unreachable through underlay",
    symptomName: "Reachable route, unreachable host",
    minDifficulty: "associate",
    affectedObjects: ["LEAF1", "LEAF3", "SPINE1"],
    conflictsWith: ["B"],
    buildIncident: () => incident("DC-FABRIC-01", "Major", `Users behind LEAF1 can reach local systems, but connections to ${HOST_B_IP} time out.`, "14:32"),
    apply: (s) => ({ ...s, vtepReachable: { ...s.vtepReachable, LEAF1: { ...s.vtepReachable.LEAF1, LEAF3: false }, LEAF3: { ...s.vtepReachable.LEAF3, LEAF1: false } } }),
    repairs: [
      { id: "a-fix-underlay", deviceId: "SPINE1", label: "Restore the LEAF1 ↔ LEAF3 underlay adjacency", correct: true, apply: (s) => ({ ...s, vtepReachable: { ...s.vtepReachable, LEAF1: { ...s.vtepReachable.LEAF1, LEAF3: true }, LEAF3: { ...s.vtepReachable.LEAF3, LEAF1: true } } }) },
      { id: "a-wrong-rt", deviceId: "LEAF1", label: "Change the Type-2 Route Target", correct: false, rejectReason: "The Type-2 route already exists and its RT already matches — RT was never the problem here.", apply: (s) => s },
      { id: "a-wrong-type2", deviceId: "LEAF3", label: "Re-advertise HOST-B's Type-2 route", correct: false, rejectReason: "The route is already present and correct — re-advertising it changes nothing while the underlay path stays broken.", apply: (s) => s },
    ],
    verificationTest: { testId: "ping", params: { from: "HOST-A", to: "HOST-B" }, description: "HOST-A → HOST-B" },
    hints: [
      "Compare what the control plane says exists against what the underlay can actually deliver.",
      "Check VTEP-to-VTEP reachability specifically, not just the presence of the EVPN route.",
      "LEAF1 and LEAF3's VTEP loopbacks cannot reach each other through the underlay — the Type-2 route is fine.",
    ],
    rootCauseSummary: "LEAF1 and LEAF3's VTEP loopbacks lost underlay reachability to each other. The Type-2 route for HOST-B was present and correctly imported the entire time — VXLAN encapsulated traffic simply had no underlay path to the remote VTEP.",
    evidenceSummary: ["Type-2 route for HOST-B: present, RT matched", "BGP EVPN LEAF1↔LEAF3: Established", "VTEP reachability LEAF1→LEAF3: FAILED"],
  },
  {
    id: "B",
    category: "type2",
    internalTitle: "Remote MAC/IP route missing/rejected (RT mismatch)",
    symptomName: "Local systems fine, one remote host unreachable",
    minDifficulty: "associate",
    affectedObjects: ["LEAF1", "LEAF3"],
    conflictsWith: ["A"],
    buildIncident: () => incident("DC-FABRIC-01", "Major", `HOST-A cannot reach ${HOST_B_IP}. The underlay and BGP sessions all show healthy.`, "09:14"),
    apply: (s) => ({ ...s, type2Routes: s.type2Routes.map((r) => (r.mac === HOST_B_MAC ? { ...r, rt: RT_BROKEN, rtMatchesLocally: false } : r)) }),
    repairs: [
      { id: "b-fix-rt", deviceId: "LEAF1", label: "Correct the import Route Target for VNI 10010", correct: true, apply: (s) => ({ ...s, type2Routes: s.type2Routes.map((r) => (r.mac === HOST_B_MAC ? { ...r, rt: RT_HEALTHY, rtMatchesLocally: true } : r)) }) },
      { id: "b-wrong-underlay", deviceId: "SPINE1", label: "Rebuild the underlay adjacency", correct: false, rejectReason: "The underlay and VTEP reachability were already healthy — this changes nothing.", apply: (s) => s },
      { id: "b-wrong-df", deviceId: "LEAF1", label: "Force a new DF election", correct: false, rejectReason: "This isn't a multihoming/DF scenario — HOST-B is single-homed.", apply: (s) => s },
    ],
    verificationTest: { testId: "ping", params: { from: "HOST-A", to: "HOST-B" }, description: "HOST-A → HOST-B" },
    hints: [
      "The underlay and BGP sessions are fine — look at what's actually imported into the VNI's table.",
      "Check whether HOST-B's Type-2 route was received, and whether it was actually imported.",
      "HOST-B's Type-2 route arrives with a Route Target that doesn't match LEAF1's import policy for VNI 10010.",
    ],
    rootCauseSummary: "HOST-B's Type-2 MAC/IP route carried a Route Target that didn't match LEAF1's import policy for VNI 10010, so the route was received but never imported — LEAF1 had no forwarding entry for HOST-B at all.",
    evidenceSummary: ["Underlay: healthy", "BGP EVPN: Established", "Type-2 route for HOST-B: received, RT NOT matched, NOT imported"],
  },
  {
    id: "C",
    category: "type3",
    internalTitle: "Missing/rejected IMET membership",
    symptomName: "Broadcast missing from one leaf",
    minDifficulty: "associate",
    affectedObjects: ["LEAF1", "LEAF3"],
    conflictsWith: [],
    buildIncident: () => incident("DC-FABRIC-01", "Minor", "Known destinations on VLAN 10 work normally, but new/unknown hosts and broadcasts are not being learned behind one leaf.", "11:02"),
    apply: (s) => ({ ...s, imetMembership: { ...s.imetMembership, LEAF3: { ...s.imetMembership.LEAF3, [VNI10010]: false } } }),
    repairs: [
      { id: "c-fix-imet", deviceId: "LEAF3", label: "Re-advertise LEAF3's IMET (Type-3) route for VNI 10010", correct: true, apply: (s) => ({ ...s, imetMembership: { ...s.imetMembership, LEAF3: { ...s.imetMembership.LEAF3, [VNI10010]: true } } }) },
      { id: "c-wrong-type2", deviceId: "LEAF3", label: "Re-advertise HOST-B's Type-2 route", correct: false, rejectReason: "HOST-B's known-unicast route is already fine — this fault is about flood delivery, not MAC/IP reachability.", apply: (s) => s },
      { id: "c-wrong-underlay", deviceId: "SPINE1", label: "Rebuild the underlay adjacency", correct: false, rejectReason: "Underlay and known-unicast reachability were never affected — the flood list itself is what's broken.", apply: (s) => s },
    ],
    verificationTest: { testId: "packet-trace", params: { from: "HOST-A", to: "broadcast" }, description: "Broadcast from HOST-A" },
    hints: [
      "Compare known-unicast behavior against broadcast/unknown-unicast behavior toward the same leaf.",
      "Check each leaf's flood-list membership for VNI 10010, not just its MAC/IP table.",
      "LEAF3 is missing from VNI 10010's IMET (Type-3) membership — known unicast to HOST-B still works because that's a separate Type-2 route.",
    ],
    rootCauseSummary: "LEAF3's IMET (Type-3) membership for VNI 10010 was missing, so it was dropped from the flood list — HOST-A's broadcasts and unknown-unicast traffic never reached it, even though HOST-B's own individually-learned Type-2 route kept ordinary known-unicast traffic working fine.",
    evidenceSummary: ["Known unicast HOST-A → HOST-B: succeeds", "IMET membership, VNI 10010, LEAF3: NOT present", "Broadcast from HOST-A toward LEAF3: not delivered"],
  },
  {
    id: "D",
    category: "irb",
    internalTitle: "Wrong L3 VNI / VRF association",
    symptomName: "Inter-subnet traffic failure",
    minDifficulty: "professional",
    affectedObjects: ["LEAF3", "LEAF1", "LEAF2"],
    conflictsWith: ["E"],
    buildIncident: () => incident("DC-FABRIC-01", "Major", "Systems on VLAN 10 reach each other normally, but nothing on VLAN 10 can reach hosts on VLAN 20.", "15:47"),
    apply: (s) => ({ ...s, l3VniByLeaf: { ...s.l3VniByLeaf, LEAF3: L3_VNI + 1 } }),
    repairs: [
      { id: "d-fix-l3vni", deviceId: "LEAF3", label: "Correct LEAF3's TENANT-A L3 VNI to 50000", correct: true, apply: (s) => ({ ...s, l3VniByLeaf: { ...s.l3VniByLeaf, LEAF3: L3_VNI } }) },
      { id: "d-wrong-l2vni", deviceId: "LEAF3", label: "Change VNI 10020's VLAN mapping", correct: false, rejectReason: "Same-subnet (VLAN 20 internal) traffic already works — the bridged L2 VNI mapping was never the issue.", apply: (s) => s },
      { id: "d-wrong-type5", deviceId: "LEAF3", label: "Re-resolve the Type-5 external prefix next hop", correct: false, rejectReason: "The external prefix is a separate, unrelated route — this incident is about VLAN 10 ↔ VLAN 20, not the external prefix.", apply: (s) => s },
    ],
    verificationTest: { testId: "ping", params: { from: "SERVER-A", to: "10.10.20.5" }, description: "SERVER-A → 10.10.20.5 (VLAN 20)" },
    hints: [
      "Compare same-subnet behavior against inter-subnet behavior for the same source host.",
      "Inspect the tenant VRF and its L3 VNI association on each leaf that should route for it.",
      "LEAF3's L3 VNI for TENANT-A doesn't match the other TENANT-A leaves.",
    ],
    rootCauseSummary: "LEAF3's VRF TENANT-A was associated with the wrong L3 VNI, so routed (inter-subnet) traffic destined through LEAF3 never matched the tenant's actual L3 VNI — same-subnet, bridged VLAN-10 traffic was completely unaffected because that path never uses the L3 VNI at all.",
    evidenceSummary: ["Same-subnet (VLAN 10 → VLAN 10): succeeds", "TENANT-A L3 VNI — LEAF1: 50000, LEAF2: 50000, LEAF3: 50001", "Inter-subnet (VLAN 10 → VLAN 20 via LEAF3): fails"],
  },
  {
    id: "E",
    category: "type5",
    internalTitle: "Type-5 next-hop/VTEP unresolved",
    symptomName: "Visible route, unreachable prefix",
    minDifficulty: "professional",
    affectedObjects: ["LEAF3", "LEAF1"],
    conflictsWith: ["D"],
    buildIncident: () => incident("DC-FABRIC-01", "Major", `${EXTERNAL_PREFIX} is visible in the routing table fabric-wide, but nothing can actually reach it.`, "08:03"),
    apply: (s) => ({ ...s, type5: { ...s.type5, nextHopReachable: false } }),
    repairs: [
      { id: "e-fix-nexthop", deviceId: "LEAF1", label: "Resolve the Type-5 next-hop VTEP for 203.0.113.0/24", correct: true, apply: (s) => ({ ...s, type5: { ...s.type5, nextHopReachable: true } }) },
      { id: "e-wrong-l3vni", deviceId: "LEAF3", label: "Change LEAF3's TENANT-A L3 VNI", correct: false, rejectReason: "The L3 VNI mapping is already consistent everywhere — inter-subnet VLAN traffic isn't part of this complaint.", apply: (s) => s },
      { id: "e-wrong-rt", deviceId: "LEAF1", label: "Change the Type-2 import Route Target", correct: false, rejectReason: "This is a Type-5 IP-prefix route, not a Type-2 MAC/IP route — the RT here was never the problem.", apply: (s) => s },
    ],
    verificationTest: { testId: "ping", params: { from: "LEAF1", to: EXTERNAL_PREFIX }, description: `LEAF1 → ${EXTERNAL_PREFIX}` },
    hints: [
      "The route being visible and the route being usable are two different questions — check both.",
      "Inspect the Type-5 route's next-hop VTEP specifically, separately from the route's own existence.",
      "The Type-5 route for 203.0.113.0/24 exists, but its next-hop VTEP never resolves to a usable underlay path.",
    ],
    rootCauseSummary: "The Type-5 route for 203.0.113.0/24 was present in every leaf's EVPN table, but its next-hop VTEP never resolved to a usable underlay path — the route existing and the route being installed/usable are two different facts, and only the first one was true.",
    evidenceSummary: ["Type-5 route 203.0.113.0/24: present on all leaves", "Next-hop VTEP: unresolved", "BGP EVPN: Established"],
  },
  {
    id: "F",
    category: "mobility",
    internalTitle: "Stale mobility selection / old Type-2 location",
    symptomName: "Host moved, traffic didn't follow",
    minDifficulty: "professional",
    affectedObjects: ["LEAF3", "LEAF2"],
    conflictsWith: [],
    buildIncident: () => incident("DC-FABRIC-01", "Minor", `A host recently relocated within the fabric. Some leaves still send its traffic to the old location (${ROAMER_IP}).`, "13:20"),
    apply: (s) => ({ ...s, roamer: { ...s.roamer, remoteBelievedLeaf: "LEAF1", sequence: { ...s.roamer.sequence, LEAF3: 0 } } }),
    repairs: [
      { id: "f-fix-mobility", deviceId: "LEAF3", label: "Accept the newer mobility sequence and update the remote location", correct: true, apply: (s) => ({ ...s, roamer: { ...s.roamer, remoteBelievedLeaf: s.roamer.actualLeaf, sequence: { ...s.roamer.sequence, LEAF3: (s.roamer.sequence.LEAF2 ?? 1) } } }) },
      { id: "f-wrong-imet", deviceId: "LEAF3", label: "Re-advertise LEAF3's IMET membership", correct: false, rejectReason: "Broadcast/flood delivery was never the issue — this host's location itself is stale.", apply: (s) => s },
      { id: "f-wrong-df", deviceId: "LEAF2", label: "Force a new DF election", correct: false, rejectReason: "This host isn't multihomed — DF election doesn't apply to it.", apply: (s) => s },
    ],
    verificationTest: { testId: "packet-trace", params: { from: "HOST-B", to: "ROAMER" }, description: "HOST-B → roaming host" },
    hints: [
      "Find out where the host actually is right now versus where the fabric currently thinks it is.",
      "Compare the mobility sequence number LEAF3 holds against the host's true, current origin leaf.",
      "LEAF3 kept an older mobility sequence for this host and never accepted the newer, moved-to location.",
    ],
    rootCauseSummary: "The host physically moved to a new leaf, which correctly advertised a higher MAC Mobility sequence number — but LEAF3 never accepted the newer route, and kept forwarding traffic toward the host's old location.",
    evidenceSummary: ["Host's actual current leaf: LEAF2", "LEAF3's believed location: LEAF1", "LEAF3's held mobility sequence: stale (lower than current)"],
  },
  {
    id: "G",
    category: "suppression",
    internalTitle: "Missing Type-2 IP information / suppression binding",
    symptomName: "Working traffic, excess ARP flooding",
    minDifficulty: "associate",
    affectedObjects: ["LEAF1"],
    conflictsWith: [],
    buildIncident: () => incident("DC-FABRIC-01", "Minor", "Connectivity on VLAN 10 is fine, but the fabric shows an unusually high rate of ARP requests being flooded to every leaf.", "10:11"),
    apply: (s) => ({ ...s, suppression: { ...s.suppression, bindingPresentAt: { ...s.suppression.bindingPresentAt, LEAF1: false } } }),
    repairs: [
      { id: "g-fix-binding", deviceId: "LEAF1", label: "Restore the MAC/IP binding used for local ARP suppression", correct: true, apply: (s) => ({ ...s, suppression: { ...s.suppression, bindingPresentAt: { ...s.suppression.bindingPresentAt, LEAF1: true } } }) },
      { id: "g-wrong-type2", deviceId: "LEAF3", label: "Re-advertise HOST-B's Type-2 route", correct: false, rejectReason: "HOST-B's Type-2 MAC/IP route is fine — this is specifically about the local IP binding used for proxy-ARP suppression, a related but distinct piece of state.", apply: (s) => s },
      { id: "g-wrong-underlay", deviceId: "SPINE1", label: "Rebuild the underlay adjacency", correct: false, rejectReason: "Connectivity itself was never broken — underlay was never the issue.", apply: (s) => s },
    ],
    verificationTest: { testId: "arp", params: { from: "LEAF1", to: HOST_B_IP }, description: `LEAF1 ARP suppression for ${HOST_B_IP}` },
    hints: [
      "Connectivity itself works — this is an efficiency problem, not a reachability problem.",
      "Check whether the ingress leaf has the IP-binding information it needs to answer ARP locally.",
      "LEAF1 is missing the MAC/IP binding it needs to suppress ARP locally for this destination, so every request floods instead.",
    ],
    rootCauseSummary: "LEAF1 was missing the MAC/IP binding it needed to answer ARP requests locally for this destination. Connectivity itself never broke — ARP simply fell back to ordinary flooding instead of being suppressed, which is an optimization failure, not a reachability failure.",
    evidenceSummary: ["Ping HOST-A → HOST-B: succeeds", "MAC/IP binding at LEAF1 for HOST-B: absent", "ARP requests observed fabric-wide: elevated"],
  },
  {
    id: "H",
    category: "multihoming-df",
    internalTitle: "Inconsistent DF state",
    symptomName: "Duplicate BUM delivery",
    minDifficulty: "professional",
    affectedObjects: ["LEAF1", "LEAF2"],
    conflictsWith: ["I", "J"],
    buildIncident: () => incident("DC-FABRIC-01", "Major", "SERVER-A is reporting that it receives every broadcast twice.", "16:05"),
    apply: (s) => ({ ...s, es: { ...s.es, dualDfBelief: { LEAF1: true, LEAF2: true } } }),
    repairs: [
      { id: "h-fix-df", deviceId: "LEAF2", label: "Recompute DF election for this Ethernet Segment", correct: true, apply: (s) => ({ ...s, es: { ...s.es, dualDfBelief: { LEAF1: true, LEAF2: false } } }) },
      { id: "h-wrong-mac", deviceId: "SERVER-A", label: "Change SERVER-A's MAC address", correct: false, rejectReason: "SERVER-A's identity was never the problem — this is entirely a DF-election consistency issue between LEAF1 and LEAF2.", apply: (s) => s },
      { id: "h-wrong-imet", deviceId: "LEAF1", label: "Re-advertise IMET membership", correct: false, rejectReason: "Both leaves are already correctly in the flood list — the duplication is a DF-role inconsistency, not a flood-list problem.", apply: (s) => s },
    ],
    verificationTest: { testId: "ethernet-segment", params: { leaf: "LEAF1,LEAF2" }, description: "DF consistency, LEAF1 & LEAF2" },
    hints: [
      "Duplicate delivery toward a multihomed segment points at one specific mechanism.",
      "Compare what LEAF1 believes about its own DF role against what LEAF2 believes about its own DF role.",
      "Both LEAF1 and LEAF2 currently believe they are Designated Forwarder for the same Ethernet Segment.",
    ],
    rootCauseSummary: "LEAF1 and LEAF2's DF election state became inconsistent — both independently believed they were Designated Forwarder for the same Ethernet Segment, so both forwarded every BUM frame onto it instead of exactly one.",
    evidenceSummary: ["ESI, VNI, IMET membership on both leaves: healthy", "LEAF1 believes: DF", "LEAF2 believes: DF (inconsistent)"],
  },
  {
    id: "I",
    category: "aliasing",
    internalTitle: "Failed ES-facing PE remains in alias set",
    symptomName: "Intermittent multihomed reachability",
    minDifficulty: "expert",
    affectedObjects: ["LEAF1", "LEAF2", "LEAF3"],
    conflictsWith: ["H", "J"],
    buildIncident: () => incident("DC-FABRIC-01", "Major", "Some sessions to SERVER-A work fine; others fail intermittently, with no clear pattern reported by users.", "12:44"),
    apply: (s) => ({ ...s, es: { ...s.es, esAttachmentDown: "LEAF1" }, aliasing: { ...s.aliasing, perEsWithdrawn: { LEAF1: true }, massWithdrawalProcessed: false } }),
    repairs: [
      { id: "i-fix-aliasing", deviceId: "LEAF3", label: "Process the pending withdrawal and recompute the alias set", correct: true, apply: (s) => ({ ...s, aliasing: { ...s.aliasing, massWithdrawalProcessed: true } }) },
      { id: "i-wrong-df", deviceId: "LEAF2", label: "Force a new DF election", correct: false, rejectReason: "DF election governs BUM forwarding, not the known-unicast alias set that's actually stale here.", apply: (s) => s },
      { id: "i-wrong-delete-mac", deviceId: "SERVER-A", label: "Delete SERVER-A's MAC/IP route", correct: false, rejectReason: "SERVER-A's endpoint identity is fine — the eligible next-hop set is what's stale.", apply: (s) => s },
    ],
    verificationTest: { testId: "vtep-reachability", params: { from: "LEAF3", to: "SERVER-A" }, description: "LEAF3 known-unicast next hop for SERVER-A" },
    hints: [
      "\"Some flows work, some don't\" toward one multihomed destination suggests more than one usable path — but not all of them are actually usable.",
      "Inspect the eligible next-hop set LEAF3 is using for SERVER-A's MAC, and compare it against each candidate PE's real attachment state.",
      "LEAF1's attachment to SERVER-A already failed, but LEAF3 hasn't pruned LEAF1 from the eligible set yet.",
    ],
    rootCauseSummary: "LEAF1's ES-facing attachment to SERVER-A failed, but LEAF3 never processed the resulting withdrawal — so LEAF3's aliasing next-hop set for SERVER-A's MAC still included LEAF1, and any flow that happened to hash toward it failed.",
    evidenceSummary: ["LEAF1 device/BGP/underlay: healthy", "LEAF1's ES attachment to SERVER-A: DOWN", "LEAF3's eligible next-hop set for SERVER-A: still { LEAF1, LEAF2 }"],
  },
  {
    id: "J",
    category: "mass-withdrawal",
    internalTitle: "Mass withdrawal received but not applied",
    symptomName: "Failed path still in use after a link event",
    minDifficulty: "expert",
    affectedObjects: ["LEAF1", "LEAF2", "LEAF3"],
    conflictsWith: ["H", "I"],
    buildIncident: () => incident("DC-FABRIC-01", "Major", "An Ethernet Segment link failure was reported at 07:58. Traffic to SERVER-A has not fully recovered.", "07:58"),
    apply: (s) => ({ ...s, es: { ...s.es, esAttachmentDown: "LEAF1" }, aliasing: { ...s.aliasing, perEsWithdrawn: { LEAF1: true }, massWithdrawalProcessed: false } }),
    repairs: [
      { id: "j-fix-massw", deviceId: "LEAF3", label: "Apply the received withdrawal and recompute forwarding state", correct: true, apply: (s) => ({ ...s, aliasing: { ...s.aliasing, massWithdrawalProcessed: true } }) },
      { id: "j-wrong-remove-esi", deviceId: "LEAF1", label: "Remove LEAF1 from the ESI configuration entirely", correct: false, rejectReason: "This is a transient attachment failure, not a permanent reconfiguration — removing LEAF1 from the ESI is inappropriate here.", apply: (s) => s },
      { id: "j-wrong-ecmp", deviceId: "LEAF3", label: "Disable ECMP/aliasing permanently", correct: false, rejectReason: "That would defeat all-active multihoming for every other flow too, and doesn't fix the stale forwarding state.", apply: (s) => s },
    ],
    verificationTest: { testId: "vtep-reachability", params: { from: "LEAF3", to: "SERVER-A" }, description: "LEAF3 known-unicast next hop for SERVER-A" },
    hints: [
      "A route being received and a route being processed into forwarding state are two different facts — check both separately.",
      "Look at the Ethernet A-D per-ES route's withdrawal state versus LEAF3's own recomputed forwarding state.",
      "The per-ES withdrawal for LEAF1 was received, but LEAF3 never recomputed its forwarding state from it.",
    ],
    rootCauseSummary: "LEAF1's Ethernet A-D per-ES withdrawal was correctly received by LEAF3 — but LEAF3 never applied it to recompute forwarding, so LEAF1 remained a usable next hop for SERVER-A's traffic well after the underlying link had actually failed.",
    evidenceSummary: ["A-D per-ES withdrawal from LEAF1: received", "LEAF3 mass-withdrawal processing: NOT applied", "SERVER-A known-unicast reachability: intermittent"],
  },
  {
    id: "K",
    category: "vpws-mtu",
    internalTitle: "L2 MTU incompatibility",
    symptomName: "Service won't establish",
    minDifficulty: "professional",
    affectedObjects: ["LEAF3", "LEAF1", "LEAF2"],
    conflictsWith: ["L"],
    buildIncident: () => incident("DC-FABRIC-01", "Major", "A point-to-point service between SERVER-A and HOST-B shows as DOWN, even though BGP EVPN and the remote endpoint both look healthy.", "09:50"),
    apply: (s) => ({ ...s, vpws: { ...s.vpws, remoteExpectedMtu: 1500 } }),
    repairs: [
      { id: "k-fix-mtu", deviceId: "LEAF3", label: "Correct the expected L2 MTU to 9000", correct: true, apply: (s) => ({ ...s, vpws: { ...s.vpws, remoteExpectedMtu: 9000 } }) },
      { id: "k-wrong-mac", deviceId: "HOST-B", label: "Change HOST-B's MAC address", correct: false, rejectReason: "Service selection here isn't driven by destination-MAC learning at all.", apply: (s) => s },
      { id: "k-wrong-type2", deviceId: "LEAF3", label: "Add a Type-2 MAC route for the service", correct: false, rejectReason: "This point-to-point service is signaled by Ethernet A-D per-EVI, not Type-2 — adding one changes nothing.", apply: (s) => s },
    ],
    verificationTest: { testId: "vpws-service", params: { leaf: "LEAF3" }, description: "VPWS-500 status" },
    hints: [
      "The route existing and the service being usable are two different questions.",
      "Compare the service parameters advertised by the primary endpoint against what the remote side locally expects.",
      "The remote side's expected L2 MTU doesn't match what the active endpoint is advertising.",
    ],
    rootCauseSummary: "The point-to-point service's Ethernet A-D per-EVI routes were exchanged correctly and the remote endpoint was discovered — but the advertised and locally expected L2 MTU didn't match, so the remote endpoint could never become usable.",
    evidenceSummary: ["BGP EVPN: Established", "A-D per-EVI route: received, remote endpoint found", "L2 MTU — Primary: 9000, Remote expected: 1500"],
  },
  {
    id: "L",
    category: "vpws-primary",
    internalTitle: "Remote PE has stale Primary/Backup forwarding state",
    symptomName: "Service stopped after a link event",
    minDifficulty: "expert",
    affectedObjects: ["LEAF1", "LEAF2", "LEAF3"],
    conflictsWith: ["K"],
    buildIncident: () => incident("DC-FABRIC-01", "Major", "SERVER-A ↔ HOST-B point-to-point traffic stopped shortly after a reported attachment-circuit event.", "17:26"),
    apply: (s) => ({ ...s, vpws: { ...s.vpws, acDown: "LEAF1", primaryPe: "LEAF1" } }),
    repairs: [
      { id: "l-fix-primary", deviceId: "LEAF3", label: "Recompute the Primary/Backup forwarding state for VPWS-500", correct: true, apply: (s) => ({ ...s, vpws: { ...s.vpws, primaryPe: "LEAF2", backupPe: undefined } }) },
      { id: "l-wrong-df", deviceId: "LEAF2", label: "Make LEAF2 the DF", correct: false, rejectReason: "This service uses Single-Active Primary/Backup roles, not DF election.", apply: (s) => s },
      { id: "l-wrong-mtu", deviceId: "LEAF3", label: "Change the expected L2 MTU", correct: false, rejectReason: "L2 MTU already matches — the service's forwarding next hop is what's stale.", apply: (s) => s },
    ],
    verificationTest: { testId: "vpws-service", params: { leaf: "LEAF3" }, description: "VPWS-500 status" },
    hints: [
      "An attachment-circuit event happened — check whether the previously active endpoint is still actually usable.",
      "Compare the remote PE's believed Primary against which PE's attachment circuit is actually still up.",
      "LEAF3 still forwards toward LEAF1 as Primary, even though LEAF1's attachment circuit already failed.",
    ],
    rootCauseSummary: "After PE1's (LEAF1's) attachment circuit failed, the remote endpoint never recomputed which PE was actually the usable Primary — it kept forwarding toward the failed PE instead of failing over to the healthy Backup.",
    evidenceSummary: ["LEAF1 attachment circuit for VPWS-500: DOWN", "LEAF3's believed Primary: LEAF1 (stale)", "LEAF2 (Backup): healthy and available"],
  },
];

export function getFault(id: FaultId): ArenaFault {
  const f = FAULT_BANK.find((x) => x.id === id);
  if (!f) throw new Error(`Unknown fault id ${id}`);
  return f;
}

export function faultsForDifficulty(difficulty: ArenaState["difficulty"]): ArenaFault[] {
  const order: ArenaState["difficulty"][] = ["associate", "professional", "expert"];
  const maxIdx = order.indexOf(difficulty);
  return FAULT_BANK.filter((f) => order.indexOf(f.minDifficulty) <= maxIdx);
}
