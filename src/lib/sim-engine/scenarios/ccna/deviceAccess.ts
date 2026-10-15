import type { PacketVisual, ScenarioStep } from "../../types";
import type { ProcessingStage } from "@/components/network3d/types";
import { act, acted, hop, kitBase, layer, packet, q, repairStep, say, stackOf, withDetail, type KitBase } from "./kit";

/**
 * Device Access & AAA (CCNA 5.3, 5.4, 5.8). NOC engineers manage two access switches; a TACACS+ server centralises
 * logins.
 *
 * Modeled:
 * - How each password form is kept in the configuration (clear text, reversible obfuscation, one-way hash) —
 *   described by type; the lesson never derives a password from a stored value.
 * - Password strength as entropy for randomly chosen passwords: length × log2(alphabet size), computed.
 * - Local accounts at scale: switches × admins = accounts to maintain.
 * - AAA method lists: methods are tried in order; the next one is used only when the previous one returns ERROR
 *   (no answer). An ACCEPT or a REJECT from any method ends the search.
 * - TACACS+ authorises each command against the user's role; accounting records what was done.
 */

export type Method = "local" | "tacacs";
export type Outcome = "ACCEPT" | "REJECT" | "ERROR";
export interface Attempt {
  device: string;
  user: string;
  trace: { method: Method; outcome: Outcome; why: string }[];
  result: "ACCEPT" | "REJECT";
}

export interface StoredForm {
  command: string;
  type: string;
  safe: boolean;
  note: string;
}
export const STORAGE: StoredForm[] = [
  { command: "enable password …", type: "type 0 (clear text)", safe: false, note: "Readable by anyone who sees the configuration." },
  { command: "service password-encryption", type: "type 7 (obfuscated)", safe: false, note: "Hides passwords from a glance over the shoulder only: the scheme is reversible and widely known." },
  { command: "enable secret …  /  username … secret …", type: "type 5 / 8 / 9 (one-way hash)", safe: true, note: "Only a hash is stored. Prefer type 8 (PBKDF2) or type 9 (scrypt), which are slow to compute." },
];

/** Candidate passwords. Entropy applies only to randomly chosen ones; a pattern-based password is rated separately. */
export interface Candidate {
  id: string;
  label: string;
  length: number;
  alphabet: number;
  random: boolean;
}
export const CANDIDATES: Candidate[] = [
  { id: "c8", label: "8 random characters from all 94 printable", length: 8, alphabet: 94, random: true },
  { id: "w5", label: "5 random words from a 7,776-word list", length: 5, alphabet: 7776, random: true },
  { id: "l16", label: "16 random lowercase letters", length: 16, alphabet: 26, random: true },
  { id: "pat", label: "'Cisco@2026' (word + symbol + year)", length: 10, alphabet: 94, random: false },
];
export const entropyBits = (c: Candidate) => Math.round(c.length * Math.log2(c.alphabet) * 10) / 10;
export const strongest = () => CANDIDATES.filter((c) => c.random).reduce((a, b) => (entropyBits(b) > entropyBits(a) ? b : a));

export const FLEET = { switches: 40, admins: 6 };
export const localAccounts = () => FLEET.switches * FLEET.admins;

export interface AaaState extends KitBase {
  /** Login method list per switch, in order. */
  lists: Record<string, Method[]>;
  /** Local usernames per switch. */
  localUsers: Record<string, string[]>;
  /** TACACS+ accounts: enabled or disabled, and role. */
  tacacsUsers: Record<string, { enabled: boolean; role: "network-admin" | "helpdesk" }>;
  serverUp: boolean;
  aaa: boolean;
  attempts: Attempt[];
  accounting: string[];
}
export function createAaaState(): AaaState {
  return {
    ...kitBase(),
    lists: { SW1: ["local"], SW2: ["local", "tacacs"] },
    localUsers: { SW1: ["alice"], SW2: ["alice", "mark"] },
    tacacsUsers: { alice: { enabled: true, role: "network-admin" }, bob: { enabled: true, role: "helpdesk" }, mark: { enabled: false, role: "network-admin" } },
    serverUp: true,
    aaa: false,
    attempts: [],
    accounting: [],
  };
}

/** Walk a method list. Only ERROR moves to the next method. `passwordOk` is whether the typed password is the right one. */
export function authenticate(s: AaaState, device: string, user: string, passwordOk: boolean): Attempt {
  const trace: Attempt["trace"] = [];
  for (const m of s.lists[device] ?? []) {
    if (m === "tacacs") {
      if (!s.serverUp) {
        trace.push({ method: m, outcome: "ERROR", why: "no reply from the TACACS+ server" });
        continue;
      }
      const acct = s.tacacsUsers[user];
      const ok = !!acct && acct.enabled && passwordOk;
      trace.push({ method: m, outcome: ok ? "ACCEPT" : "REJECT", why: !acct ? "unknown user" : !acct.enabled ? "account disabled" : passwordOk ? "credentials valid" : "wrong password" });
      return { device, user, trace, result: ok ? "ACCEPT" : "REJECT" };
    }
    const known = (s.localUsers[device] ?? []).includes(user);
    const ok = known && passwordOk;
    trace.push({ method: m, outcome: ok ? "ACCEPT" : "REJECT", why: !known ? "no local account" : passwordOk ? "local secret matches" : "wrong password" });
    return { device, user, trace, result: ok ? "ACCEPT" : "REJECT" };
  }
  return { device, user, trace, result: "REJECT" };
}

/** Per-command authorization: helpdesk may run show commands only. */
export const authorize = (s: AaaState, user: string, command: string) => {
  const role = s.tacacsUsers[user]?.role;
  return role === "network-admin" || (role === "helpdesk" && command.startsWith("show "));
};

export const listText = (l: Method[]) => `aaa authentication login default ${l.map((m) => (m === "tacacs" ? "group tacacs+" : "local")).join(" ")}`;
export const traceText = (a: Attempt) => a.trace.map((t) => `${t.method === "tacacs" ? "TACACS+" : "local"}: ${t.outcome} (${t.why})`).join(" → ");

const C = { ip: "#60a5fa", tcp: "#34d399", app: "#f472b6" };
export const ST = {
  sw: [{ id: "rx", label: "SSH login request" }, { id: "list", label: "Method list (in order)" }, { id: "method", label: "Ask the method" }, { id: "result", label: "Accept / reject" }],
  srv: [{ id: "rx", label: "TACACS+ request (TCP 49)" }, { id: "authn", label: "Authenticate" }, { id: "authz", label: "Authorise command" }, { id: "acct", label: "Account" }],
  admin: [{ id: "ssh", label: "Open SSH session" }, { id: "cmd", label: "Type command" }],
} satisfies Record<string, ProcessingStage[]>;

export const AAA_REPAIR_OPTIONS = [
  { id: "order", label: "On SW2: put TACACS+ first (group tacacs+ local) and remove every local account except the break-glass one" },
  { id: "disable", label: "Disable mark's account on the TACACS+ server" },
  { id: "enable", label: "Change SW2's enable secret" },
  { id: "radius", label: "Replace TACACS+ with RADIUS" },
];
export const AAA_REPAIR_CORRECT = "order";

type Step = ScenarioStep<AaaState>;

const sshPkt = (id: string, user: string, to: string): PacketVisual =>
  packet(id, "TCP", "ADMIN", to, "SSH", `SSH login · ${user} → ${to}`, [layer("IPv4 Header", C.ip, [["Source IP", "10.9.0.21 (NOC)"], ["Destination IP", to === "SW1" ? "10.0.0.11" : "10.0.0.12"]]), layer("TCP Header", C.tcp, [["Destination Port", "22"]]), layer("SSH", C.app, [["User", user], ["Password", "(encrypted inside SSH)"]])]);

const tacPkt = (id: string, from: string, user: string): PacketVisual =>
  packet(id, "TCP", from, "AAA", "TACACS+", `TACACS+ authentication · ${user}`, [layer("IPv4 Header", C.ip, [["Source IP", from === "SW1" ? "10.0.0.11" : "10.0.0.12"], ["Destination IP", "10.9.0.5"]]), layer("TCP Header", C.tcp, [["Destination Port", "49"]]), layer("TACACS+", C.app, [["Type", "Authentication START"], ["User", user], ["Body", "encrypted (shared key)"]])]);

/** A login at a switch: walk the list, record the attempt, show the switch's view. */
function login(id: string, device: string, user: string, passwordOk: boolean): (s: AaaState) => AaaState {
  return (s) => {
    const a = authenticate(s, device, user, passwordOk);
    const askedServer = a.trace.some((t) => t.method === "tacacs");
    const p = askedServer && s.serverUp ? tacPkt(`${id}-p`, device, user) : sshPkt(`${id}-p`, user, device);
    const last = a.trace[a.trace.length - 1];
    const n = acted(
      s,
      hop({
        stepId: id,
        device,
        stages: withDetail(ST.sw, { list: listText(s.lists[device]), method: traceText(a), result: a.result }),
        activeStageId: "method",
        ingressInterfaceId: "vty",
        lookupType: "AAA method list",
        lookupKey: `${user} · ${listText(s.lists[device]).replace("aaa authentication login default ", "")}`,
        lookupResult: traceText(a),
        action: a.result === "ACCEPT" ? "LOGIN ACCEPTED" : "LOGIN REJECTED",
        reason: last?.outcome === "REJECT" ? "A REJECT is a final answer — the switch does not try the next method." : a.trace.some((t) => t.outcome === "ERROR") ? "The server gave no answer (ERROR), so the next method in the list was tried." : "The first method that answers decides.",
        input: `SSH login ${user}`,
        output: a.result === "ACCEPT" ? `${user} at ${device}#` : "% Authentication failed",
        before: stackOf(p),
      }),
      p,
      `${user}: ${a.result}`,
    );
    return { ...n, attempts: [...n.attempts, a] };
  };
}

function command(id: string, user: string, cmd: string): (s: AaaState) => AaaState {
  return (s) => {
    const ok = authorize(s, user, cmd);
    const p = packet(`${id}-p`, "TCP", "SW1", "AAA", "TACACS+", `TACACS+ authorization · ${user} · ${cmd}`, [layer("TCP Header", C.tcp, [["Destination Port", "49"]]), layer("TACACS+", C.app, [["Type", "Authorization REQUEST"], ["User", user], ["Command", cmd]])]);
    const role = s.tacacsUsers[user]?.role ?? "none";
    const n = acted(s, hop({ stepId: id, device: "AAA", stages: withDetail(ST.srv, { authz: `${user} (${role}) · '${cmd}' → ${ok ? "PASS" : "FAIL"}`, acct: `stop record: ${user} ${cmd}` }), activeStageId: "authz", ingressInterfaceId: "eth0", lookupType: "Command authorization", lookupKey: `${role} · ${cmd}`, lookupResult: ok ? "permitted" : "not permitted for this role", action: ok ? "PERMIT" : "DENY", reason: "TACACS+ checks every command separately, so one login can be allowed some commands and refused others.", input: p.summary, output: ok ? "command runs" : "% Authorization failed.", before: stackOf(p) }), p, `${cmd}: ${ok ? "permitted" : "denied"}`);
    return { ...n, accounting: [...n.accounting, `${user}@SW1 · ${cmd} · ${ok ? "permitted" : "denied"}`] };
  };
}

export const aaaSteps: Step[] = [
  say("intro", "Three questions", "Every management login answers three questions. Authentication: who are you? Authorization: what may you do? Accounting: what did you do? Together they are AAA.", {
    question: q("An auditor asks who ran 'configure terminal' on SW1 last Tuesday at 10:02. Which A answers that?", [["acct", "Accounting"], ["authn", "Authentication"], ["authz", "Authorization"], ["none", "None — switches can't record that"]], "acct", "Accounting keeps the record of what was done and when. Authentication only proved who logged in; authorization decided whether the command was allowed."),
  }),
  say("predict-storage", "Predict: what's in the configuration?", "SW1's configuration holds an old enable password, service password-encryption is turned on, and the admin account uses a secret.", {
    question: q("A copy of SW1's configuration leaks. Which stored form still protects its password?", [["hash", "The 'secret' lines — only a one-way hash is stored"], ["t7", "The type 7 lines — service password-encryption encrypts them"], ["all", "All of them — the configuration is encrypted"], ["none", "None of them"]], "hash", "Type 0 is clear text; type 7 is a reversible obfuscation that only stops casual glances. A secret stores a one-way hash — prefer type 8 or 9."),
  }),
  act("storage", "How passwords are stored", "The switch shows each form for what it is. Only the secret is a one-way hash; clear text and type 7 belong in no production configuration.", (s) => {
    const n = acted(s, hop({ stepId: "storage", device: "SW1", stages: withDetail(ST.sw, { rx: "show running-config", result: STORAGE.map((f) => `${f.type}: ${f.safe ? "safe" : "unsafe"}`).join(" · ") }), activeStageId: "result", lookupType: "Stored password forms", lookupKey: "running-config", lookupResult: STORAGE.map((f) => f.type).join(" / "), action: "AUDIT", reason: "Use 'enable secret' and 'username … secret' (type 8 or 9); never rely on type 7.", input: "show running-config", output: "replace enable password with enable secret" }), undefined, "only secrets are hashed");
    return n;
  }, "STEP_ENTERED"),
  say("predict-strength", "Predict: which password is strongest?", "Four candidates for the new break-glass account. For a randomly chosen password, strength in bits is its length × log2 of the alphabet it was drawn from.", {
    question: q("Which candidate is strongest?", CANDIDATES.map((c) => [c.id, c.label] as [string, string]), strongest().id, `16 random lowercase letters: 16 × log2(26) ≈ ${entropyBits(CANDIDATES[2])} bits — more than 5 random words (${entropyBits(CANDIDATES[1])}) or 8 random symbols (${entropyBits(CANDIDATES[0])}). 'Cisco@2026' follows a pattern every guessing list tries first; the formula doesn't apply to it. Length beats complexity.`),
  }),
  act("strength", "Strength, computed", `Computed: 8 random characters ≈ ${entropyBits(CANDIDATES[0])} bits; 5 random words ≈ ${entropyBits(CANDIDATES[1])} bits; 16 random lowercase letters ≈ ${entropyBits(CANDIDATES[2])} bits. A pattern like 'Cisco@2026' gets no credit — it isn't random.`, (s) =>
    acted(s, hop({ stepId: "strength", device: "SW1", stages: withDetail(ST.sw, { result: CANDIDATES.map((c) => `${c.id}: ${c.random ? entropyBits(c) + " bits" : "pattern"}`).join(" · ") }), activeStageId: "result", lookupType: "Entropy", lookupKey: "length × log2(alphabet)", lookupResult: `best: ${strongest().label}`, action: "CHOOSE", reason: "Each extra bit doubles the guesses needed. Adding length grows bits faster than enlarging the alphabet.", input: "4 candidates", output: strongest().label }), undefined, `${entropyBits(strongest())} bits`), "STEP_ENTERED"),
  say("policy", "A password policy", "A policy sets minimum length, bans reuse and known-breached passwords, and locks or slows an account after repeated failures. Better still, add something that isn't a password: multi-factor authentication, certificates (the device proves itself with a key), or biometrics."),
  act("local", "Local accounts don't scale", `SW1 checks only its own list: alice logs in with a local account. But ${FLEET.admins} admins on ${FLEET.switches} switches is ${localAccounts()} accounts to keep in step — and when someone leaves, ${FLEET.switches} switches to change.`, login("local", "SW1", "alice", true), "PACKET_SENT"),
  act("aaa", "Centralise with AAA", "SW1 now runs aaa new-model with the list 'group tacacs+ local': ask the TACACS+ server first, and use local accounts only if the server can't answer. alice logs in with her central account.", (s) => login("aaa", "SW1", "alice", true)({ ...s, aaa: true, lists: { ...s.lists, SW1: ["tacacs", "local"] } }), "PACKET_SENT"),
  say("predict-reject", "Predict: a mistyped password", "alice mistypes her password. The server is up.", {
    question: q("SW1's list is 'group tacacs+ local'. What happens?", [["stop", "The server answers REJECT and the login fails — local is not tried"], ["fall", "The switch tries the local account next"], ["lock", "The switch disables SSH"], ["retry", "The switch asks the server again with the local password"]], "stop", "Only an ERROR (no answer) moves to the next method. A REJECT is a final answer; otherwise anyone could bypass the server by guessing a local password."),
  }),
  act("reject", "REJECT is final", "The server replies REJECT. SW1 stops there.", login("reject", "SW1", "alice", false), "PACKET_DROPPED"),
  say("predict-error", "Predict: the server goes quiet", "A WAN cut isolates the TACACS+ server. alice must log in to SW1 to fix the link.", {
    question: q("What does SW1 do when alice logs in?", [["local", "Gets no answer (ERROR), so it tries the next method: the local account"], ["deny", "Refuses everyone until the server returns"], ["allow", "Lets anyone in while the server is down"], ["cache", "Uses the last answer the server gave"]], "local", "No answer is an ERROR, and an ERROR moves to the next method. That is why the list ends in 'local' — a break-glass account for exactly this outage."),
  }),
  act("error", "ERROR moves on", "No reply from TACACS+ — ERROR — so SW1 tries the local database, and alice's break-glass account gets her in. The WAN is repaired and the server returns.", (s) => {
    const n = login("error", "SW1", "alice", true)({ ...s, serverUp: false });
    return { ...n, serverUp: true };
  }, "PACKET_SENT"),
  act("authz", "Authorization per command", "bob from the help desk logs in. His role allows show commands only. 'show interfaces status' is permitted; 'configure terminal' is refused.", (s) => command("authz", "bob", "configure terminal")(command("authz-show", "bob", "show interfaces status")(s)), "PACKET_DROPPED"),
  act("accounting", "Accounting", "Every command, permitted or not, is recorded centrally with user, device and time — the record the auditor asked for.", (s) =>
    acted(s, hop({ stepId: "accounting", device: "AAA", stages: withDetail(ST.srv, { acct: `${s.accounting.length} records` }), activeStageId: "acct", lookupType: "Accounting log", lookupKey: "SW1", lookupResult: s.accounting.join(" | ") || "—", action: "RECORD", reason: "Accounting turns 'who changed this?' into a lookup instead of a guess.", input: "command stop records", output: "stored on the server" }), undefined, `${s.accounting.length} records`), "STEP_ENTERED"),
  say("radius", "TACACS+ or RADIUS?", "TACACS+ (TCP 49) encrypts the whole body and separates authentication, authorization and accounting — built for device administration. RADIUS (UDP 1812/1813, an IETF standard) hides only the password and combines authentication with authorization — built for network access: 802.1X, Wi-Fi and VPN users.", {
    question: q("Employees join the Wi-Fi with 802.1X. Which protocol does the access point use to reach the AAA server?", [["radius", "RADIUS"], ["tacacs", "TACACS+"], ["ssh", "SSH"], ["snmp", "SNMP"]], "radius", "802.1X carries user authentication to a RADIUS server. TACACS+ is for administrators logging in to network devices."),
  }),
  // incident
  act("fault-injected", "Monday morning", "mark left the company on Friday and his TACACS+ account was disabled. Monday, SW2's syslog reports a successful SSH login by mark.", (s) => ({ ...s, faultActive: true, packet: undefined, flood: [], decision: { device: "SW2", text: "%SEC_LOGIN-5-LOGIN_SUCCESS: user mark" } }), "STEP_ENTERED"),
  act("inc-login", "The login, replayed", "Security replays the login on SW2 to watch the method list at work.", login("inc-login", "SW2", "mark", true), "PACKET_SENT"),
  say("trouble-question", "Diagnose", "The TACACS+ server is up, and it shows no request for mark from SW2.", {
    question: q("Why was mark accepted?", [["order", "SW2's list puts local first, and SW2 still has mark's local account — the server was never asked"], ["server", "The TACACS+ server ignored the disabled flag"], ["error", "The server returned ERROR, so local was used"], ["ssh", "SSH skips AAA"]], "order", "The first method that answers decides. On SW2 that is local, and a stale local account said ACCEPT. The server wasn't asked, so its disabled flag never mattered.", ["Which method did SW2 try first?", "Did the server see any request?", "What is in SW2's local database?"]),
  }),
  say("diagnostic-layers", "Troubleshooting layers", "Check from the request inward: the SSH session, the method list's order, each method's answer, then the accounts themselves."),
  repairStep("repair-challenge", "Repair", "Choose the change that fixes the cause.", AAA_REPAIR_CORRECT, (s) => ({ ...s, lists: { ...s.lists, SW2: ["tacacs", "local"] }, localUsers: { ...s.localUsers, SW2: ["alice"] }, decision: { device: "SW2", text: "group tacacs+ local · no username mark" } })),
  act("verify", "Proof", "alice still gets in through the server. mark tries again: SW2 now asks the server first, and the server rejects the disabled account.", (s) => login("verify", "SW2", "mark", true)(login("verify-alice", "SW2", "alice", true)(s)), "PACKET_DROPPED"),
  say("complete", "Device access", "Store only hashed secrets; choose long random passwords; centralise logins with AAA; order the method list server-first with a single break-glass local account; let TACACS+ authorise each command and account for it; use RADIUS for network access."),
];
