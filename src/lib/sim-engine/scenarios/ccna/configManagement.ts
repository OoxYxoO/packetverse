import type { PacketVisual, ScenarioStep } from "../../types";
import type { ProcessingStage } from "@/components/network3d/types";
import { act, acted, hop, kitBase, layer, packet, q, repairStep, say, stackOf, withDetail, type KitBase } from "./kit";

/**
 * Configuration Management: Ansible, Terraform, Puppet & Chef (CCNA 6.1, 6.6). Six access switches, a Git repository
 * as the source of truth, an Ansible control node, a Terraform run for a cloud network, and Puppet/Chef compared.
 *
 * Modeled (computed):
 * - Desired state vs actual state per device; an Ansible run reports ok / changed per host, and check mode reports
 *   what would change without changing it.
 * - Idempotency: a second run with nothing to fix changes nothing.
 * - Terraform: plan = diff between the configuration and its state file; apply makes the plan real and records it.
 * - Enforcement: a scheduled run makes every device match the source of truth — including undoing hand changes.
 */

export const SWITCHES = ["SW1", "SW2", "SW3", "SW4", "SW5", "SW6"] as const;
export type SwId = (typeof SWITCHES)[number];
export interface SwCfg {
  ntp: string;
  banner: string;
}
export interface RunResult {
  mode: "check" | "apply";
  ok: SwId[];
  changed: SwId[];
}
export interface TfResource {
  address: string;
  attrs: string;
}
export interface CmState extends KitBase {
  /** group_vars/access.yml in Git. */
  desired: SwCfg;
  actual: Record<SwId, SwCfg>;
  runs: RunResult[];
  /** NTP servers that answer. */
  ntpAlive: string[];
  tfConfig: TfResource[];
  tfState: TfResource[];
  tfPlan?: { add: number; change: number; destroy: number };
  outage: boolean;
}
const BANNER = "Authorized access only";
export function createCmState(): CmState {
  const actual = Object.fromEntries(SWITCHES.map((id) => [id, { ntp: "10.9.0.123", banner: BANNER }])) as Record<SwId, SwCfg>;
  actual.SW3 = { ntp: "10.9.0.99", banner: BANNER };
  actual.SW5 = { ntp: "10.9.0.123", banner: "Welcome!" };
  return { ...kitBase(), desired: { ntp: "10.9.0.123", banner: BANNER }, actual, runs: [], ntpAlive: ["10.9.0.123", "10.9.0.124"], tfConfig: [], tfState: [], outage: false };
}

/** One Ansible play: compare each host with the desired state; change it unless in check mode. */
export function ansibleRun(s: CmState, mode: "check" | "apply"): { state: CmState; result: RunResult } {
  const ok: SwId[] = [];
  const changed: SwId[] = [];
  const actual = { ...s.actual };
  for (const id of SWITCHES) {
    const a = actual[id];
    const differs = a.ntp !== s.desired.ntp || a.banner !== s.desired.banner;
    if (!differs) ok.push(id);
    else {
      changed.push(id);
      if (mode === "apply") actual[id] = { ...s.desired };
    }
  }
  const result = { mode, ok, changed };
  return { state: { ...s, actual, runs: [...s.runs, result] }, result };
}
export const synced = (s: CmState, id: SwId) => s.ntpAlive.includes(s.actual[id].ntp);
export const unsyncedCount = (s: CmState) => SWITCHES.filter((id) => !synced(s, id)).length;
/** Terraform plan: compare configuration with state by address. */
export function tfPlan(s: CmState) {
  const inState = new Set(s.tfState.map((r) => r.address));
  const inCfg = new Set(s.tfConfig.map((r) => r.address));
  return {
    add: s.tfConfig.filter((r) => !inState.has(r.address)).length,
    change: s.tfConfig.filter((r) => inState.has(r.address) && s.tfState.find((x) => x.address === r.address)!.attrs !== r.attrs).length,
    destroy: s.tfState.filter((r) => !inCfg.has(r.address)).length,
  };
}

const C = { ssh: "#34d399", yaml: "#facc15", http: "#f472b6" };
export const ST = {
  ctl: [{ id: "repo", label: "Read playbook + vars from Git" }, { id: "facts", label: "Connect over SSH (agentless)" }, { id: "diff", label: "Compare desired vs actual" }, { id: "apply", label: "Change only what differs" }],
  sw: [{ id: "cfg", label: "Running configuration" }, { id: "ntp", label: "NTP sync" }],
  tf: [{ id: "cfg", label: "Read .tf configuration" }, { id: "state", label: "Compare with state file" }, { id: "plan", label: "Plan: add / change / destroy" }, { id: "apply", label: "Apply via provider API" }],
  git: [{ id: "commit", label: "Reviewed commit" }],
} satisfies Record<string, ProcessingStage[]>;

export const CM_REPAIR_OPTIONS = [
  { id: "vars", label: "Change ntp_server to 10.9.0.124 in group_vars in Git, get it reviewed, and let the playbook apply it" },
  { id: "hand", label: "Fix the six switches by hand again" },
  { id: "disable", label: "Disable the nightly Ansible run" },
  { id: "revive", label: "Restart the old NTP server 10.9.0.123" },
];
export const CM_REPAIR_CORRECT = "vars";

type Step = ScenarioStep<CmState>;
const sshPkt = (id: string, to: string, summary: string, fields: [string, string][]): PacketVisual => packet(id, "TCP", "ANSIBLE", to, "SSH", summary, [layer("TCP Header", C.ssh, [["Destination Port", "22"]]), layer("Ansible task", C.yaml, fields)]);

function play(id: string, mode: "check" | "apply"): (s: CmState) => CmState {
  return (s) => {
    const { state: n0, result } = ansibleRun(s, mode);
    const target = result.changed[0] ?? "SW1";
    const p = sshPkt(`${id}-p`, target, `ansible-playbook access.yml${mode === "check" ? " --check --diff" : ""} → ${target}`, [["Module", "cisco.ios.ios_config / ios_ntp_global"], ["Desired NTP", s.desired.ntp], ["Mode", mode]]);
    const verb = mode === "check" ? "would change" : "changed";
    return acted(n0, hop({ stepId: id, device: "ANSIBLE", stages: withDetail(ST.ctl, { repo: `group_vars: ntp_server=${s.desired.ntp}`, facts: `6 hosts over SSH`, diff: `ok=${result.ok.length} ${verb}=${result.changed.length}`, apply: mode === "check" ? "nothing (check mode)" : `pushed to ${result.changed.join(", ") || "none"}` }), activeStageId: mode === "check" ? "diff" : "apply", egressInterfaceId: "eth0", lookupType: "PLAY RECAP", lookupKey: "access switches", lookupResult: `ok=${result.ok.length} ${verb}=${result.changed.length}${result.changed.length ? ` (${result.changed.join(", ")})` : ""}`, action: mode === "check" ? "CHECK" : result.changed.length ? "CHANGED" : "OK", reason: mode === "check" ? "Check mode reports differences without touching anything." : result.changed.length ? "Only devices that differ from the desired state are changed." : "Nothing differs, so nothing changes — idempotency.", input: "playbook + inventory", output: p.summary, nextHopId: target, before: stackOf(p) }), p, `ok=${result.ok.length} ${verb}=${result.changed.length}`);
  };
}

export const cmSteps: Step[] = [
  say("intro", "A source of truth", `Configuration management describes the network once — in files kept in Git — and lets a tool make every device match. For the ${SWITCHES.length} access switches, group_vars/access.yml says: NTP server 10.9.0.123, banner '${BANNER}'.`),
  act("check", "What has drifted?", "ansible-playbook access.yml --check --diff connects to each switch over SSH, compares it with the desired state and reports — changing nothing.", play("check", "check"), "STEP_ENTERED"),
  act("apply", "Apply", "The same playbook without --check fixes only the switches that differ: SW3's NTP server and SW5's banner.", play("apply", "apply"), "PACKET_SENT"),
  say("predict-idem", "Predict: run it again", "Nothing has changed on the switches since the last run.", {
    question: q("What does a second run report?", [["zero", "ok=6 changed=0 — nothing to do"], ["six", "changed=6 — every task runs again"], ["two", "changed=2 — the same two switches"], ["error", "An error, because the config already exists"]], "zero", "Good modules are idempotent: they compare first and change only what differs. Running twice is safe, which is what makes scheduled runs possible."),
  }),
  act("idem", "Idempotent", "The second run connects, compares and changes nothing.", play("idem", "apply"), "STEP_ENTERED"),
  say("predict-agent", "Predict: push or pull", "Ansible pushed changes from a control node over SSH; the switches ran nothing special.", {
    question: q("Which two tools instead run an agent on each managed node that pulls its configuration from a server?", [["pc", "Puppet and Chef"], ["at", "Ansible and Terraform"], ["ta", "Terraform and Puppet"], ["ca", "Chef and Ansible"]], "pc", "Puppet (manifests in its own declarative language) and Chef (recipes in Ruby) use agents that check in with a server and enforce what it says. Ansible is agentless push over SSH; Terraform calls provider APIs."),
  }),
  act("terraform", "Terraform: plan, then apply", "The same team builds the cloud side of the network with Terraform: a VPC and a subnet described in HCL. terraform plan compares the configuration with the state file and shows 2 to add; apply creates them through the provider's API and records them in the state.", (s) => {
    const tfConfig: TfResource[] = [{ address: "aws_vpc.campus", attrs: "cidr 10.200.0.0/16" }, { address: "aws_subnet.app", attrs: "cidr 10.200.1.0/24" }];
    const n0 = { ...s, tfConfig };
    const plan = tfPlan(n0);
    const p = packet("tf-p", "HTTPS", "TF", "CLOUD", "API", "terraform apply → provider API · create VPC + subnet", [layer("HTTPS", C.http, [["Calls", "CreateVpc, CreateSubnet"], ["Plan", `${plan.add} to add, ${plan.change} to change, ${plan.destroy} to destroy`]])]);
    const n = acted({ ...n0, tfPlan: plan, tfState: tfConfig }, hop({ stepId: "terraform", device: "TF", stages: withDetail(ST.tf, { state: "state: empty", plan: `+${plan.add} ~${plan.change} -${plan.destroy}`, apply: "created; state updated" }), activeStageId: "plan", egressInterfaceId: "api", lookupType: "terraform plan", lookupKey: "main.tf vs terraform.tfstate", lookupResult: `${plan.add} to add, ${plan.change} to change, ${plan.destroy} to destroy`, action: "APPLY", reason: "Terraform is declarative: you describe the end state; plan shows the difference from what it last built.", input: "main.tf", output: p.summary, nextHopId: "CLOUD", before: stackOf(p) }), p, `plan: +${plan.add}`);
    return n;
  }, "PACKET_SENT"),
  // incident
  act("fault-injected", "A 2 a.m. fix", "At 2 a.m. NTP server 10.9.0.123 dies for good. The on-call engineer logs in to all six switches and points them at 10.9.0.124 by hand; clocks resync and they go back to bed.", (s) => {
    const actual = Object.fromEntries(SWITCHES.map((id) => [id, { ...s.actual[id], ntp: "10.9.0.124" }])) as Record<SwId, SwCfg>;
    return { ...s, actual, ntpAlive: ["10.9.0.124"], outage: true, faultActive: true, packet: undefined, flood: [], decision: { device: "SW1", text: "ntp server 10.9.0.124 (by hand)" } };
  }, "STEP_ENTERED"),
  act("inc-run", "The nightly run", "At 3 a.m. the scheduled Ansible run goes through the access switches. By morning all six report 'Clock is unsynchronized' and log timestamps are wrong.", play("inc-run", "apply"), "PACKET_SENT"),
  say("trouble-question", "Diagnose", "The PLAY RECAP says changed=6. Git's group_vars still say ntp_server: 10.9.0.123.", {
    question: q("Why did the clocks break again?", [["sot", "The hand fix never reached the source of truth, so the run enforced the old, dead NTP server"], ["bug", "Ansible has a bug"], ["ssh", "SSH failed on the switches"], ["ntp", "10.9.0.124 failed too"]], "sot", "The tool did its job: make every switch match Git. Git still named the dead server, so it 'fixed' all six back to it.", ["What does Git say the NTP server is?", "What did the run change?", "Where should the 2 a.m. change have gone?"]),
  }),
  say("diagnostic-layers", "Troubleshooting layers", "Compare the source of truth, the last run's recap, the device's running config and the service itself."),
  repairStep("repair-challenge", "Repair", "Choose the change that fixes the cause.", CM_REPAIR_CORRECT, (s) => ({ ...s, desired: { ...s.desired, ntp: "10.9.0.124" }, decision: { device: "GIT", text: "group_vars/access.yml: ntp_server 10.9.0.124 (merged)" } })),
  act("verify", "Proof", "The playbook runs from the updated Git: changed=6, every switch on 10.9.0.124 and synchronised. Run again, as the nightly job will: changed=0.", (s) => play("verify", "apply")(play("verify-1", "apply")(s)), "STEP_ENTERED"),
  say("complete", "Configuration management", "A source of truth in Git; Ansible pushes over SSH, agentless and idempotent, with check mode to preview; Terraform plans and applies against its state; Puppet and Chef agents pull and enforce — and changes go into the source of truth, never only onto the device."),
];
