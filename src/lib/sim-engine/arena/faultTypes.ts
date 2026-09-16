/**
 * EVPN Troubleshooting Arena — shared domain types (brief §33/§34).
 *
 * Architectural rule this whole arena is built to preserve:
 *   networking truth → scenario/domain logic → typed state/events →
 *   scene adapter → visualization. React components in
 *   app/demo/evpn-troubleshooting/page.tsx never decide whether the
 *   network works — they only dispatch actions into useArenaEngine
 *   and render whatever ArenaState + ArenaSession say is true. Every
 *   test, CLI command, packet capture, and topology badge reads the
 *   SAME ArenaState — there is exactly one source of truth, never a
 *   scripted/hardcoded result that could disagree with it.
 *
 * Reuses rather than reinvents: the ESI/DF/aliasing shapes from the
 * Multihoming and Aliasing lessons, the VPWS Primary/Backup shape
 * from the Single-Active/VPWS lesson, and the generic component set
 * (EvpnRibViewer, ElectionViewer, RouteEvolutionViewer, BgpUpdateCard,
 * ServiceInstanceViewer, TroubleshootingLayers) for presentation.
 */

export type ArenaLeafId = "LEAF1" | "LEAF2" | "LEAF3";
export type ArenaDeviceId = "SPINE1" | ArenaLeafId | "HOST-A" | "SERVER-A" | "HOST-B";

export type Difficulty = "associate" | "professional" | "expert";
export type ScenarioMode = "random" | "select" | "daily";

export type FaultCategory =
  | "underlay"
  | "type2"
  | "type3"
  | "irb"
  | "type5"
  | "mobility"
  | "suppression"
  | "multihoming-df"
  | "aliasing"
  | "mass-withdrawal"
  | "vpws-mtu"
  | "vpws-primary";

export type FaultId = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J" | "K" | "L";

export type HypothesisCategory = "underlay" | "bgp-evpn" | "type2" | "type3" | "vni" | "vrf-irb" | "mac-mobility" | "suppression" | "multihoming" | "vpws" | "other";

export const HYPOTHESIS_OPTIONS: { id: HypothesisCategory; label: string }[] = [
  { id: "underlay", label: "Underlay" },
  { id: "bgp-evpn", label: "BGP EVPN" },
  { id: "type2", label: "Type 2" },
  { id: "type3", label: "Type 3" },
  { id: "vni", label: "VNI" },
  { id: "vrf-irb", label: "VRF / IRB" },
  { id: "mac-mobility", label: "MAC Mobility" },
  { id: "suppression", label: "Suppression" },
  { id: "multihoming", label: "Multihoming" },
  { id: "vpws", label: "VPWS" },
  { id: "other", label: "Other" },
];

export const CATEGORY_TO_HYPOTHESIS: Record<FaultCategory, HypothesisCategory> = {
  underlay: "underlay",
  type2: "type2",
  type3: "type3",
  irb: "vrf-irb",
  type5: "vni",
  mobility: "mac-mobility",
  suppression: "suppression",
  "multihoming-df": "multihoming",
  aliasing: "multihoming",
  "mass-withdrawal": "multihoming",
  "vpws-mtu": "vpws",
  "vpws-primary": "vpws",
};

// ---------------------------------------------------------------------------
// Fixed fabric constants (brief §4) — one reusable topology, varying
// which features/faults are active per scenario.
// ---------------------------------------------------------------------------

export const LEAFS: ArenaLeafId[] = ["LEAF1", "LEAF2", "LEAF3"];
export const VTEP_LOOPBACK: Record<ArenaLeafId, string> = { LEAF1: "10.255.0.1", LEAF2: "10.255.0.2", LEAF3: "10.255.0.3" };
export const VLAN10 = 10;
export const VNI10010 = 10010;
export const VLAN20 = 20;
export const VNI10020 = 10020;
export const L3_VNI = 50000;
export const VRF_NAME = "TENANT-A";
export const ESI = "00:DE:AD:BE:EF:00:00:00:00:01";
export const EXTERNAL_PREFIX = "203.0.113.0/24";
export const VPWS_SERVICE_ID = 500;

export const HOST_A_IP = "10.10.10.11";
export const HOST_A_MAC = "AA:AA:AA:AA:AA:11";
export const SERVER_A_IP = "10.10.10.50";
export const SERVER_A_MAC = "AA:AA:AA:AA:AA:50";
export const HOST_B_IP = "10.10.10.22";
export const HOST_B_MAC = "AA:AA:AA:AA:AA:22";
export const ROAMER_IP = "10.10.10.77";
export const ROAMER_MAC = "AA:AA:AA:AA:AA:77";

// ---------------------------------------------------------------------------
// Networking truth — ArenaState. Every panel in the UI is a read-only
// projection of this. No fault name, category, or root cause lives
// here as a label — only observable, queryable facts.
// ---------------------------------------------------------------------------

export interface Type2RouteState {
  mac: string;
  ip: string;
  originLeaf: ArenaLeafId;
  vni: number;
  rd: string;
  rt: string;
  rtMatchesLocally: boolean;
  esi?: string;
}

export interface EthernetSegmentState {
  esi: string;
  leafs: ArenaLeafId[];
  dfWinner?: ArenaLeafId;
  dualDfBelief: Partial<Record<ArenaLeafId, boolean>>; // which leafs believe THEY are DF
  esAttachmentDown?: ArenaLeafId;
}

export interface AliasingState {
  mac: string;
  advertisedPeEviRoutes: ArenaLeafId[]; // leafs that advertised A-D per-EVI
  perEsWithdrawn: Partial<Record<ArenaLeafId, boolean>>;
  massWithdrawalProcessed: boolean;
  eligiblePEs: ArenaLeafId[]; // derived
}

export interface VpwsState {
  serviceId: number;
  primaryPe?: ArenaLeafId;
  backupPe?: ArenaLeafId;
  acDown?: ArenaLeafId;
  l2MtuAdvertised: Partial<Record<ArenaLeafId, number>>;
  remoteExpectedMtu: number;
  status: "up" | "down"; // derived
}

export interface RoamerState {
  mac: string;
  ip: string;
  actualLeaf: ArenaLeafId;
  remoteBelievedLeaf: ArenaLeafId; // what LEAF3 thinks
  sequence: Partial<Record<ArenaLeafId, number>>;
}

export interface SuppressionState {
  targetIp: string;
  targetMac: string;
  bindingPresentAt: Partial<Record<ArenaLeafId, boolean>>;
}

export interface ArenaState {
  seed: string;
  difficulty: Difficulty;
  activeFaultIds: FaultId[];

  vtepReachable: Record<ArenaLeafId, Partial<Record<ArenaLeafId, boolean>>>;
  bgpEvpnUp: Record<ArenaLeafId, boolean>;

  type2Routes: Type2RouteState[];
  imetMembership: Record<ArenaLeafId, Partial<Record<number, boolean>>>;

  l3VniByLeaf: Record<ArenaLeafId, number>;

  type5: { prefix: string; originLeaf: ArenaLeafId; nextHopVtep: string; nextHopReachable: boolean };

  roamer: RoamerState;
  suppression: SuppressionState;
  es: EthernetSegmentState;
  aliasing: AliasingState;
  vpws: VpwsState;
}

// ---------------------------------------------------------------------------
// Fault / repair model (brief §5)
// ---------------------------------------------------------------------------

export interface RepairAction {
  id: string;
  deviceId: ArenaDeviceId;
  label: string;
  correct: boolean;
  rejectReason?: string; // shown when an invalid repair is attempted
  apply: (state: ArenaState) => ArenaState;
}

export interface IncidentReport {
  site: string;
  severity: "Minor" | "Major" | "Critical";
  report: string;
  started: string;
  recentChanges: string;
}

export interface ArenaFault {
  id: FaultId;
  category: FaultCategory;
  /** Internal-only identity — never rendered to the student during an active incident. */
  internalTitle: string;
  /** Student-facing, symptom-based name for the scenario selector (brief §28) — never reveals the mechanism. */
  symptomName: string;
  minDifficulty: Difficulty;
  affectedObjects: ArenaDeviceId[];
  conflictsWith: FaultId[];
  buildIncident: (rng: () => number) => IncidentReport;
  apply: (state: ArenaState) => ArenaState;
  repairs: RepairAction[];
  /** The single test/action whose pass/fail flips once the fault is actually repaired — this is what [VERIFY FIX] re-runs. */
  verificationTest: { testId: string; params: Record<string, string>; description: string };
  hints: [string, string, string];
  rootCauseSummary: string;
  evidenceSummary: string[];
}
