import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";

/** Mission Briefing — every step in exactly one phase; the incident's cause is never named before its question. */
export const VPN_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "Observe — Two sites", tone: "cyan" }, objective: "Meet the sites, the gateways and what must be protected.", steps: ["intro", "sites"] },
  { phase: { label: "IKE_SA_INIT", tone: "violet" }, objective: "Agree algorithms and run Diffie-Hellman in the clear.", steps: ["predict-init", "init-req", "init-req-rx", "init-resp", "init-resp-rx"] },
  { phase: { label: "Authenticate", tone: "warning" }, objective: "Prove identities inside the encrypted SK payload.", steps: ["predict-auth", "auth-req", "auth-req-rx", "auth-resp", "auth-resp-rx"] },
  { phase: { label: "Build CHILD SA", tone: "success" }, objective: "Separate the control SA from the data SAs.", steps: ["sa-summary", "predict-ike-child", "predict-spi"] },
  { phase: { label: "Encrypt", tone: "mpls" }, objective: "Wrap a private packet in ESP tunnel mode.", steps: ["predict-inner", "ping-send", "predict-outer", "esp-encrypt", "predict-observer"] },
  { phase: { label: "Decrypt", tone: "ip" }, objective: "Recover the original packet at the far gateway.", steps: ["esp-decrypt", "esp-deliver"] },
  { phase: { label: "Return", tone: "tcp" }, objective: "Send the reply back on the other one-way SA.", steps: ["reply-send", "reply-encrypt", "reply-decrypt", "reply-deliver", "seq-more"] },
  { phase: { label: "Incident", tone: "danger" }, objective: "Site A can't reach Site B, yet the peer shows up. Investigate.", steps: ["incident-intro", "child-delete", "child-delete-rx", "child-delete-resp", "inc-ping", "inc-ccsa-req", "inc-ccsa-rx", "inc-ts-resp", "inc-ts-rx"] },
  { phase: { label: "Diagnose", tone: "danger" }, objective: "Diagnosis pending.", steps: ["predict-ts", "predict-ike-healthy", "diagnostic-layers"] },
  { phase: { label: "Repair pending", tone: "warning" }, objective: "Choose the change that fixes the cause you identified.", steps: ["repair-challenge"] },
  { phase: { label: "Verify", tone: "success" }, objective: "Negotiate a new CHILD SA and prove ESP flows again.", steps: ["ver-ccsa-req", "ver-ccsa-rx", "ver-ccsa-resp", "ver-ccsa-done", "ver-esp", "ver-esp-rx", "ver-reply"] },
  { phase: { label: "Complete", tone: "success" }, objective: "Place this in real deployments.", steps: ["implementation", "complete"] },
];

export const VPN_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  "init-resp-rx": { takeaway: "Shared keys, but nobody is authenticated yet." },
  "auth-req": { takeaway: "After IKE_SA_INIT, IKE payloads travel inside SK." },
  "auth-resp-rx": { takeaway: "Two SAs: the IKE SA and the first CHILD SA." },
  "esp-encrypt": { takeaway: "Inner private header kept; outer header between the gateways." },
  "esp-decrypt": { takeaway: "The receiver's SPI finds its keys; the sequence number guards against replay." },
  "reply-encrypt": { takeaway: "Each direction is its own SA with its own SPI and counter." },
  "incident-intro": { doingNow: "A maintenance change on GW-B." },
  "predict-ts": { doingNow: "Diagnosis pending." },
  "repair-challenge": { doingNow: "Choose the change that fixes the cause you identified." },
  "ver-reply": { takeaway: "Traffic flows through IPsec again — not around it." },
};
