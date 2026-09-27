import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";

/** Mission Briefing framing for EVPN MAC Mobility — presentation only; phase objectives also show on question/repair/action steps, so they never state an answer or the outcome of a comparison before it is shown. */
export const EVPNM_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "Mission", tone: "cyan" }, objective: "Follow one endpoint's EVPN advertisement before it ever moves.", steps: ["intro", "leaf1-local-learn", "type2-seq0-advertised", "remote-learn-recap"] },
  { phase: { label: "Before the move", tone: "ip" }, objective: "Record the data path while HOST-A is still on its first leaf.", steps: ["send-before-move", "before-move-journey"] },
  { phase: { label: "The move", tone: "warning" }, objective: "Move the endpoint and decide what EVPN must do about it.", steps: ["move-host", "predict-what-must-evpn-do", "enter-leaf2-local-learn"] },
  { phase: { label: "Mobility advertisement", tone: "bgp" }, objective: "See how the new location is advertised and compared.", steps: ["mobility-community-intro", "route-comparison", "type2-seq1-advertised", "enter-leaf3-mobility-update", "remote-mac-before-after", "route-lifecycle-recap"] },
  { phase: { label: "After the move", tone: "ip" }, objective: "Send the same traffic again and compare the path.", steps: ["send-after-move", "after-move-journey", "cause-effect-recap", "control-data-recap", "identity-vs-location", "stale-forwarding-demo"] },
  { phase: { label: "Incident", tone: "danger" }, objective: "Traffic still goes to the old location. Find the failing layer.", steps: ["break-intro", "fault-injected", "trouble-intro", "trouble-question", "diagnostic-layers"] },
  { phase: { label: "Repair", tone: "warning" }, objective: "Apply the fix for the layer you identified, then prove it.", steps: ["repair-challenge", "verify-dataplane"] },
  { phase: { label: "Beyond one move", tone: "violet" }, objective: "Watch a second move, then separate mobility from multihoming.", steps: ["second-move-optional", "mobility-vs-multihoming"] },
  { phase: { label: "Complete", tone: "success" }, objective: "Review identity, location, sequence and selection.", steps: ["complete"] },
];

export const EVPNM_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  "type2-seq0-advertised": { doingNow: "Control plane: HOST-A's first Type 2 advertisement — no MAC Mobility Extended Community; effective sequence 0." },
  "before-move-journey": { doingNow: "Data plane: LEAF3 encapsulates toward LEAF1's VTEP." },
  "move-host": { doingNow: "Use the panel to move HOST-A to its new leaf." },
  "enter-leaf2-local-learn": { doingNow: "LEAF2 learns HOST-A locally and already holds a remote entry for the same MAC." },
  "type2-seq1-advertised": { doingNow: "Control plane: LEAF2's advertisement now carries the MAC Mobility Extended Community." },
  "route-lifecycle-recap": { takeaway: "PacketVerse keeps the old record as history; in EVPN the previous owner withdraws it." },
  "after-move-journey": { takeaway: "Same MAC and IP, different path — because the selected route changed." },
  "fault-injected": { doingNow: "A controlled, educational fault is injected on one leaf." },
  "trouble-intro": { doingNow: "Session, underlay and the new route's arrival all report healthy." },
  "repair-challenge": { doingNow: "Choose the change that fixes the cause you identified." },
  "verify-dataplane": { takeaway: "Forwarding proven with a real frame." },
  "second-move-optional": { doingNow: "HOST-A moves again; the new advertisement carries a higher sequence." },
};
