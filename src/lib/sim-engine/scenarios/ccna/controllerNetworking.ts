import type { PacketVisual, ScenarioStep } from "../../types";
import type { ProcessingStage } from "@/components/network3d/types";
import { act, acted, hop, kitBase, layer, packet, q, repairStep, say, stackOf, withDetail, type KitBase } from "./kit";

/**
 * Controller-Based & Cloud-Managed Networking (CCNA 6.1, 6.2, 6.3). A campus of 48 access switches gets a new VLAN
 * for security cameras — first by hand, then through a controller; a branch is managed from a cloud dashboard.
 *
 * Modeled (computed):
 * - Device-by-device work: time = switches × minutes each; P(at least one mistake) = 1 − (1 − p)^switches.
 * - The three planes of a switch, and which one each action uses.
 * - Intent: the controller turns one request (northbound, REST) into per-device configuration (southbound, NETCONF)
 *   for every device in its inventory for that site — and only those.
 * - Cloud management: the management plane lives in the cloud; the data plane stays local.
 */

export const FLEET = { switches: 48, minutesEach: 4, errorRate: 0.02 };
export const manualMinutes = () => FLEET.switches * FLEET.minutesEach;
export const pAnyMistake = () => Math.round((1 - (1 - FLEET.errorRate) ** FLEET.switches) * 1000) / 10;

export interface Sw {
  id: string;
  /** How many real switches this node stands for. */
  count: number;
  managed: boolean;
  vlans: number[];
}
export interface CtrlState extends KitBase {
  switches: Sw[];
  intent?: { vlan: number; name: string };
  cloudLink: boolean;
  branchForwarding: boolean;
  newFloor: boolean;
  log: string[];
}
export function createCtrlState(): CtrlState {
  return {
    ...kitBase(),
    switches: [
      { id: "SW-B1", count: 15, managed: true, vlans: [10, 20] },
      { id: "SW-B2", count: 15, managed: true, vlans: [10, 20] },
      { id: "SW-B3", count: 15, managed: true, vlans: [10, 20] },
    ],
    cloudLink: true,
    branchForwarding: true,
    newFloor: false,
    log: [],
  };
}

/** Apply the intent to every managed switch in the inventory; unmanaged ones are untouched. */
export function pushIntent(s: CtrlState): { state: CtrlState; touched: number; skipped: number } {
  const vlan = s.intent!.vlan;
  let touched = 0;
  let skipped = 0;
  const switches = s.switches.map((w) => {
    if (!w.managed) {
      skipped += w.count;
      return w;
    }
    touched += w.count;
    return w.vlans.includes(vlan) ? w : { ...w, vlans: [...w.vlans, vlan] };
  });
  return { state: { ...s, switches }, touched, skipped };
}
export const fleetSize = (s: CtrlState) => s.switches.reduce((n, w) => n + w.count, 0);
export const withVlan = (s: CtrlState, v: number) => s.switches.filter((w) => w.vlans.includes(v)).reduce((n, w) => n + w.count, 0);

const C = { ip: "#60a5fa", tcp: "#34d399", app: "#f472b6", json: "#facc15" };
export const ST = {
  ctrl: [{ id: "nb", label: "Northbound API (REST)" }, { id: "intent", label: "Intent → per-device config" }, { id: "inv", label: "Inventory / site" }, { id: "sb", label: "Southbound (NETCONF / SSH)" }],
  sw: [{ id: "mgmt", label: "Management plane" }, { id: "ctrlp", label: "Control plane" }, { id: "data", label: "Data plane" }],
  eng: [{ id: "call", label: "Call the API" }],
  cloud: [{ id: "dash", label: "Dashboard (management)" }, { id: "push", label: "Push config over HTTPS" }],
} satisfies Record<string, ProcessingStage[]>;

export const CTRL_REPAIR_OPTIONS = [
  { id: "onboard", label: "Discover the three new switches in the controller and assign them to the site, then re-provision" },
  { id: "cli", label: "SSH to each new switch and add VLAN 30 by hand" },
  { id: "core", label: "Add VLAN 30 on the core switch only" },
  { id: "restart", label: "Restart the controller" },
];
export const CTRL_REPAIR_CORRECT = "onboard";

type Step = ScenarioStep<CtrlState>;
const api = (id: string, summary: string, body: [string, string][]): PacketVisual => packet(id, "HTTPS", "ENG", "CTRL", "REST", summary, [layer("IPv4 Header", C.ip, [["Source IP", "10.9.0.21"], ["Destination IP", "10.9.0.50 (controller)"]]), layer("HTTPS", C.app, [["Method", "POST"], ["URI", "/api/v1/intent/vlans"], ["Auth", "X-Auth-Token"]]), layer("JSON body", C.json, body)]);
const netconf = (id: string, to: string, vlan: number): PacketVisual => packet(id, "TCP", "CTRL", to, "NETCONF", `NETCONF edit-config → ${to} · VLAN ${vlan}`, [layer("TCP Header", C.tcp, [["Destination Port", "830 (NETCONF over SSH)"]]), layer("NETCONF", C.app, [["Operation", "edit-config (merge)"], ["Data", `<vlan><id>${vlan}</id><name>CAMERAS</name></vlan>`]])]);

function provision(id: string): (s: CtrlState) => CtrlState {
  return (s) => {
    const { state: n0, touched } = pushIntent(s);
    const first = n0.switches.find((w) => w.managed)!;
    const p = netconf(`${id}-p`, first.id, n0.intent!.vlan);
    const n = acted(n0, hop({ stepId: id, device: "CTRL", stages: withDetail(ST.ctrl, { intent: `VLAN ${n0.intent!.vlan} ${n0.intent!.name} on every access switch in site HQ`, inv: `${touched} switches in inventory for site HQ`, sb: `edit-config × ${touched}` }), activeStageId: "sb", egressInterfaceId: "mgmt", lookupType: "Inventory (site HQ)", lookupKey: `VLAN ${n0.intent!.vlan}`, lookupResult: `${touched} provisioned · 0 failed`, action: "PROVISION", reason: "A controller configures what it knows. Its inventory is the boundary of its intent.", input: "intent: cameras VLAN", output: p.summary, nextHopId: first.id, before: stackOf(p) }), p, `${touched} switches provisioned`);
    return { ...n, log: [...n.log, `success · ${touched}/${touched}`] };
  };
}

export const ctrlSteps: Step[] = [
  say("predict-manual", "Predict: one change, 48 switches", `Security cameras need VLAN 30 on all ${FLEET.switches} access switches. By hand, each switch takes about ${FLEET.minutesEach} minutes over SSH, and a careful engineer still mistypes about ${FLEET.errorRate * 100}% of the time.`, {
    question: q("What is the chance at least one switch ends up wrong?", [["62", `About ${pAnyMistake()}%`], ["2", "About 2%"], ["0", "Zero, if the engineer is careful"], ["96", "About 96%"]], "62", `1 − (1 − ${FLEET.errorRate})^${FLEET.switches} ≈ ${pAnyMistake()}%. Small error rates compound across many devices — that is why automation exists.`),
  }),
  act("manual", "Device by device", `${FLEET.switches} × ${FLEET.minutesEach} min = ${manualMinutes()} minutes of typing, with a ${pAnyMistake()}% chance that some switch differs from the rest — and nobody knows which until a camera fails.`, (s) =>
    acted(s, hop({ stepId: "manual", device: "ENG", stages: withDetail(ST.eng, { call: `${FLEET.switches} SSH sessions × ${FLEET.minutesEach} min` }), activeStageId: "call", lookupType: "Effort", lookupKey: `${FLEET.switches} switches`, lookupResult: `${manualMinutes()} min · P(mistake) ${pAnyMistake()}%`, action: "BY HAND", reason: "Traditional networks are managed one box at a time; each box runs its own control plane and keeps its own configuration.", input: "change request", output: "48 separate configurations" }), undefined, `${manualMinutes()} min by hand`), "STEP_ENTERED"),
  say("planes", "Three planes", "Every network device does three jobs. The management plane is how it is configured and watched. The control plane is how it decides — building tables by talking to its neighbours. The data plane moves traffic using those tables.", {
    question: q("A monitoring script polls SW-B1's interface counters through its API every minute. Which plane serves that request?", [["mgmt", "The management plane"], ["control", "The control plane"], ["data", "The data plane"], ["none", "None — counters need a controller"]], "mgmt", "Configuring and monitoring a device — SSH, SNMP, APIs — is the management plane. The control plane builds tables (STP, OSPF, ARP); the data plane forwards user traffic in hardware using them. A controller never sits in the path of user frames."),
  }),
  act("intent", "One request to the controller", "Instead, the engineer sends the controller one request through its northbound REST API: 'VLAN 30, CAMERAS, on every access switch at HQ'.", (s) => {
    const p = api("intent-p", "POST /api/v1/intent/vlans · VLAN 30 CAMERAS", [["vlanId", "30"], ["name", "\"CAMERAS\""], ["scope", "\"site:HQ/role:access\""]]);
    return acted({ ...s, intent: { vlan: 30, name: "CAMERAS" } }, hop({ stepId: "intent", device: "CTRL", stages: withDetail(ST.ctrl, { nb: "POST /api/v1/intent/vlans → 202 Accepted" }), activeStageId: "nb", ingressInterfaceId: "mgmt", lookupType: "Northbound API", lookupKey: "POST /intent/vlans", lookupResult: "202 Accepted · task id 7f3c", action: "ACCEPT INTENT", reason: "Northbound: applications and scripts talk to the controller, usually REST with JSON. They say what they want, not how each box does it.", input: p.summary, output: "intent stored", before: stackOf(p) }), p, "intent accepted");
  }, "PACKET_SENT"),
  say("predict-sb", "Predict: the controller talks to the switches", "The controller now has to configure 45 switches it manages.", {
    question: q("Which interface does it use to change a switch's configuration?", [["sb", "A southbound interface such as NETCONF, RESTCONF or SSH"], ["nb", "Its northbound REST API"], ["data", "The data plane"], ["snmp-trap", "SNMP traps"]], "sb", "Southbound interfaces face the devices: NETCONF/RESTCONF (with YANG models), gRPC, OpenFlow, or CLI over SSH. Northbound faces applications; SNMP traps are notifications from devices, not configuration."),
  }),
  act("provision", "Provision through southbound", "The controller renders VLAN 30 for every access switch in site HQ and pushes it with NETCONF, in parallel, then checks each one back.", provision("provision"), "PACKET_SENT"),
  say("fabric", "Underlay, overlay, fabric", "In a software-defined campus or data center, the underlay is the physical routed network (links plus a routing protocol such as IS-IS or OSPF) that simply connects every switch. The overlay is a set of tunnels across it (VXLAN, LISP) that carries virtual networks wherever users are. Underlay + overlay + the controller's policy is the fabric."),
  act("cloud", "Cloud-managed: the branch", "The branch uses cloud-managed equipment (Meraki, Mist and others): each device connects out over HTTPS to the vendor's dashboard, which holds its configuration. The branch's internet link drops for an hour.", (s) => {
    const n0 = { ...s, cloudLink: false };
    const p = packet("cloud-p", "HTTPS", "BR-SW", "CLOUD", "HTTPS", "Dashboard tunnel · BR-SW → cloud (down)", [layer("HTTPS", C.app, [["Destination", "dashboard (TCP 443)"], ["State", "unreachable"]])]);
    return acted(n0, hop({ stepId: "cloud", device: "BR-SW", stages: withDetail(ST.sw, { mgmt: "cloud dashboard unreachable", ctrlp: "STP, MAC learning running", data: "forwarding as configured" }), activeStageId: "data", lookupType: "Planes", lookupKey: "cloud link down", lookupResult: "management paused · data plane unaffected", action: "KEEP FORWARDING", reason: "Only the management plane moved to the cloud. Local switching and routing keep working; changes wait until the link returns.", input: p.summary, output: "branch users unaffected" }), p, "branch keeps forwarding");
  }, "PACKET_DROPPED"),
  // incident
  act("fault-injected", "A new floor", "Facilities opens floor 9 with three new access switches, racked and configured from a USB stick by the installer. Cameras arrive on floor 9.", (s) => ({ ...s, cloudLink: true, newFloor: true, faultActive: true, switches: [...s.switches, { id: "SW-F9", count: 3, managed: false, vlans: [10, 20] }], packet: undefined, flood: [], decision: { device: "SW-F9", text: "3 switches · not in controller inventory" } }), "STEP_ENTERED"),
  act("inc-provision", "Cameras on floor 9 are dark", "The security team re-runs the cameras intent to be sure. The controller reports success — yet floor 9's cameras still get no address in VLAN 30.", provision("inc-provision"), "PACKET_SENT"),
  say("trouble-question", "Diagnose", `The controller's task log says 45 switches provisioned. The fleet now has ${48} switches. show vlan brief on an SW-F9 switch: no VLAN 30.`, {
    question: q("Why didn't floor 9 get VLAN 30?", [["inv", "The three new switches aren't in the controller's inventory, so the intent never reached them"], ["sb", "NETCONF is broken on every switch"], ["vlan", "VLAN 30 doesn't exist on the controller"], ["cam", "The cameras are faulty"]], "inv", "Intent applies to the devices the controller manages. Switches set up outside it are invisible to it — 'success' meant success on the 45 it knows.", ["How many switches did the task touch?", "How many are there?", "Which ones does the controller know?"]),
  }),
  say("diagnostic-layers", "Troubleshooting layers", "Check the intent, the inventory it applies to, southbound reachability, then the device configuration."),
  repairStep("repair-challenge", "Repair", "Choose the change that fixes the cause.", CTRL_REPAIR_CORRECT, (s) => ({ ...s, switches: s.switches.map((w) => (w.id === "SW-F9" ? { ...w, managed: true } : w)), decision: { device: "CTRL", text: "discovered 3 · assigned to site HQ/floor-9" } })),
  act("verify", "Proof", "With the three switches in inventory and assigned to the site, the controller provisions them; now all 48 carry VLAN 30 and floor 9's cameras come up.", provision("verify"), "PACKET_SENT"),
  say("complete", "Controller-based networking", "Automation removes compounding human error; devices have management, control and data planes; controllers take intent northbound and configure devices southbound; fabrics run overlays on an underlay; cloud management moves only the management plane — and a controller manages exactly what's in its inventory."),
];
