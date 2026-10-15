import type { PacketVisual, ScenarioStep } from "../../types";
import type { ProcessingStage } from "@/components/network3d/types";
import { act, acted, hop, kitBase, layer, packet, q, repairStep, say, stackOf, withDetail, type KitBase } from "./kit";

/**
 * Wireless Security (CCNA 5.9, 5.10). HQ from the wireless arc: AP1 (local mode) and the WLC, plus a RADIUS server.
 * A passive listener sits in range, and later a warehouse WLAN serves handheld scanners that only support WPA2.
 *
 * Modeled:
 * - What a passive listener can read: everything on an open WLAN, nothing but headers once traffic is encrypted.
 * - Security generations as data (cipher, key management, status) — WEP, WPA, WPA2, WPA3.
 * - The WPA2 4-way handshake: the passphrase never crosses the air; both sides derive the same per-session key
 *   from the PMK and two nonces, and prove it.
 * - Who can decrypt whom: with WPA2-Personal, anyone who knows the PSK and captures a handshake can derive that
 *   session's key; with WPA3-SAE (and 802.1X) each session's key is private.
 * - AKM negotiation: a client joins with the strongest key-management method both it and the WLAN support, or not
 *   at all.
 */

export type Akm = "OPEN" | "WPA2-PSK" | "WPA3-SAE" | "WPA2-802.1X" | "WPA3-802.1X";
export const AKM_RANK: Akm[] = ["OPEN", "WPA2-PSK", "WPA2-802.1X", "WPA3-SAE", "WPA3-802.1X"];

export interface Generation {
  name: string;
  year: number;
  cipher: string;
  keys: string;
  status: string;
}
export const GENERATIONS: Generation[] = [
  { name: "WEP", year: 1997, cipher: "RC4", keys: "Static shared key, short IV", status: "Broken — never use" },
  { name: "WPA", year: 2003, cipher: "TKIP (RC4-based)", keys: "Per-packet keys", status: "Interim fix — deprecated" },
  { name: "WPA2", year: 2004, cipher: "AES-CCMP", keys: "PSK or 802.1X, 4-way handshake", status: "Baseline today" },
  { name: "WPA3", year: 2018, cipher: "AES-CCMP / GCMP-256", keys: "SAE or 802.1X; PMF required", status: "Current best" },
];

export interface Wlan {
  ssid: string;
  vlan: number;
  akms: Akm[];
  pmf: "disabled" | "optional" | "required";
}
export interface Client {
  id: string;
  supports: Akm[];
}
export const CLIENTS: Record<string, Client> = {
  LAPTOP: { id: "LAPTOP", supports: ["OPEN", "WPA2-PSK", "WPA3-SAE", "WPA2-802.1X", "WPA3-802.1X"] },
  SCANNER: { id: "SCANNER", supports: ["OPEN", "WPA2-PSK"] },
};
/** The strongest AKM both sides support, or undefined (association refused). */
export function negotiate(w: Wlan, c: Client): Akm | undefined {
  return [...AKM_RANK].reverse().find((a) => w.akms.includes(a) && c.supports.includes(a));
}
/** Can someone who knows the shared passphrase and captured this client's handshake derive its session key? */
export const sessionExposed = (akm: Akm | undefined) => akm === "OPEN" || akm === "WPA2-PSK";

export interface WsecState extends KitBase {
  wlans: Wlan[];
  /** What the listener in range can read. */
  listenerReads: string;
  handshake: string[];
  joined: Record<string, Akm | "refused">;
  radius: boolean;
  scanners: boolean;
}
export function createWsecState(): WsecState {
  return { ...kitBase(), wlans: [{ ssid: "CAFE-TEST", vlan: 10, akms: ["OPEN"], pmf: "disabled" }], listenerReads: "—", handshake: [], joined: {}, radius: false, scanners: false };
}

const C = { dot11: "#94a3b8", eapol: "#f59e0b", ip: "#60a5fa", app: "#f472b6", radius: "#a78bfa" };
export const ST = {
  ap: [{ id: "rx", label: "Receive over the air" }, { id: "akm", label: "Security (AKM / cipher)" }, { id: "keys", label: "Keys installed?" }, { id: "fwd", label: "Encrypt / decrypt · forward" }],
  wlc: [{ id: "wlan", label: "WLAN profile" }, { id: "sec", label: "Layer 2 security" }, { id: "push", label: "Push to APs" }],
  rad: [{ id: "rx", label: "Access-Request" }, { id: "eap", label: "EAP method (PEAP / EAP-TLS)" }, { id: "res", label: "Accept / reject" }],
  host: [{ id: "tx", label: "Send / receive" }],
} satisfies Record<string, ProcessingStage[]>;

export const WS_REPAIR_OPTIONS = [
  { id: "transition", label: "Set WAREHOUSE to WPA3 transition mode: WPA2-PSK and WPA3-SAE on the same WLAN (PMF optional)" },
  { id: "open", label: "Make WAREHOUSE open and rely on the VLAN" },
  { id: "tkip", label: "Add WPA with TKIP for compatibility" },
  { id: "reboot", label: "Reboot AP1" },
];
export const WS_REPAIR_CORRECT = "transition";

type Step = ScenarioStep<WsecState>;
const dot11 = (id: string, from: string, to: string, badge: string, summary: string, fields: [string, string][], color = C.dot11): PacketVisual => packet(id, "ETHERNET", from, to, badge, summary, [layer("802.11 header", C.dot11, [["Transmitter", from], ["Receiver", to]]), layer(badge, color, fields)]);

function join(id: string, client: keyof typeof CLIENTS, ssid: string): (s: WsecState) => WsecState {
  return (s) => {
    const w = s.wlans.find((x) => x.ssid === ssid)!;
    const akm = negotiate(w, CLIENTS[client]);
    const p = dot11(`${id}-p`, client, "AP1", "Association", `Association request · ${client} → ${ssid}`, [["SSID", ssid], ["Client AKMs", CLIENTS[client].supports.filter((a) => a !== "OPEN").join(", ")], ["WLAN AKMs", w.akms.join(", ")]]);
    const n = acted(
      s,
      hop({ stepId: id, device: "AP1", stages: withDetail(ST.ap, { akm: `client {${CLIENTS[client].supports.join(", ")}} ∩ WLAN {${w.akms.join(", ")}} → ${akm ?? "none"}`, keys: akm ? "4-way handshake → keys installed" : "—" }), activeStageId: "akm", ingressInterfaceId: "radio0", lookupType: "AKM negotiation", lookupKey: `${client} · ${ssid}`, lookupResult: akm ?? "no common method", action: akm ? "ASSOCIATED" : "REFUSED", reason: akm ? "Both sides use the strongest method they share." : "If no security method is common, the AP refuses the association (status: invalid AKMP).", input: p.summary, output: akm ? `${client} on ${ssid} via ${akm}` : "association refused", nextHopId: akm ? client : undefined, before: stackOf(p) }),
      p,
      `${client}: ${akm ?? "refused"}`,
    );
    return { ...n, joined: { ...n.joined, [client]: akm ?? "refused" } };
  };
}

const CORP: Wlan = { ssid: "CORP", vlan: 10, akms: ["WPA2-PSK"], pmf: "optional" };

export const wsecSteps: Step[] = [
  say("predict-open", "Predict: an open network", "A test SSID, CAFE-TEST, was left open. A laptop browses a plain-HTTP intranet page over it. Someone in the parking lot runs a wireless capture.", {
    question: q("What can the listener read?", [["all", "Every frame's contents — open Wi-Fi sends data unencrypted"], ["headers", "Only the addresses"], ["none", "Nothing — Wi-Fi is always encrypted"], ["assoc", "Only if they associate to the SSID"]], "all", "Open authentication means no encryption: anyone in radio range can capture and read the frames without even joining. Encryption on Wi-Fi comes only from WPA2/WPA3 (or from the application, e.g. HTTPS)."),
  }),
  act("open", "Open: readable by anyone", "The capture shows the full HTTP request — page, cookies and all. Radio doesn't stop at the wall.", (s) => {
    const p = dot11("open-p", "LAPTOP", "AP1", "Data (unencrypted)", "802.11 data · HTTP GET /payroll (cleartext)", [["Protected", "no"], ["Payload", "GET /payroll · Cookie: session=…"]], C.app);
    return { ...acted(s, hop({ stepId: "open", device: "AP1", stages: withDetail(ST.ap, { akm: "OPEN", keys: "none", fwd: "forward unencrypted" }), activeStageId: "akm", ingressInterfaceId: "radio0", lookupType: "Security", lookupKey: "CAFE-TEST", lookupResult: "open — no keys", action: "FORWARD", reason: "Wi-Fi is a shared medium: without link encryption every receiver in range gets every frame.", input: p.summary, output: "readable by the listener", before: stackOf(p) }), p, "listener reads everything"), listenerReads: "everything (open)" };
  }, "PACKET_SENT"),
  act("history", "Four generations", "WEP (1997) used RC4 with a static key and was broken within years. WPA (2003) patched it with TKIP as a stop-gap. WPA2 (2004) brought AES-CCMP — today's baseline. WPA3 (2018) adds SAE for passwords, 192-bit suites for high security, and requires protected management frames.", (s) => ({ ...s, wlans: [CORP], packet: undefined, flood: [], decision: { device: "WLC", text: "CAFE-TEST deleted · CORP = WPA2-PSK (AES)" } }), "STEP_ENTERED"),
  say("predict-handshake", "Predict: the 4-way handshake", "CORP uses WPA2-Personal: one passphrase for everyone. The laptop joins.", {
    question: q("During the 4-way handshake, is the passphrase sent over the air?", [["no", "No — both sides derive the same keys from it and prove they did"], ["hashed", "Yes, as a hash"], ["enc", "Yes, encrypted with AES"], ["first", "Only in the first message"]], "no", "The passphrase and SSID produce the PMK on each side. The AP and client exchange two random nonces; each combines PMK + nonces + MAC addresses into the same session key (PTK) and proves it with a MIC. The secret itself never travels."),
  }),
  act("handshake", "The 4-way handshake", "M1: the AP sends its nonce (ANonce). M2: the laptop sends its nonce (SNonce) and a MIC proving it has the PMK. M3: the AP proves the same and delivers the group key (GTK), encrypted. M4: the laptop confirms. Both install the session key; the listener now sees only encrypted payloads.", (s) => {
    const n0 = join("handshake", "LAPTOP", "CORP")(s);
    const p = dot11("hs-p", "AP1", "LAPTOP", "EAPOL-Key", "EAPOL-Key M3 · install PTK · GTK (encrypted)", [["Key info", "Install, ACK, MIC, Secure"], ["ANonce", "random (from M1)"], ["MIC", "proves AP holds the PMK"], ["Key data", "GTK, encrypted"]], C.eapol);
    return { ...n0, packet: p, handshake: ["M1 ANonce", "M2 SNonce + MIC", "M3 MIC + GTK", "M4 ACK"], listenerReads: "headers only (AES-CCMP)" };
  }, "PACKET_SENT"),
  say("predict-shared", "Predict: a colleague with the passphrase", "A contractor knows CORP's passphrase — everyone does. They capture the laptop's handshake from the parking lot.", {
    question: q("Can they decrypt the laptop's traffic?", [["yes", "Yes — with the shared PSK and both nonces from the capture, they can derive that session key"], ["no", "No — every client has its own session key"], ["mac", "Only if they spoof the laptop's MAC"], ["aes", "No — AES can't be broken"]], "yes", "Each session key is unique, but on WPA2-Personal it is derived only from public values (nonces, MACs) plus the shared PSK. Anyone holding the PSK can compute it. A captured handshake also lets an outsider test passphrase guesses offline — so weak passphrases fall."),
  }),
  act("sae", "WPA3-Personal: SAE", "CORP moves to WPA3-SAE. Instead of deriving the PMK straight from the passphrase, client and AP run a SAE exchange that produces a fresh, private PMK for each session. Knowing the passphrase no longer reveals anyone else's traffic, a capture gives nothing to guess against offline, and PMF is mandatory.", (s) => {
    const n0: WsecState = { ...s, wlans: s.wlans.map((w) => (w.ssid === "CORP" ? { ...w, akms: ["WPA3-SAE"], pmf: "required" } : w)) };
    const n = join("sae", "LAPTOP", "CORP")(n0);
    return { ...n, listenerReads: "headers only (encrypted)" };
  }, "PACKET_SENT"),
  act("enterprise", "Enterprise: 802.1X", "For staff, a passphrase per company isn't enough: people leave. CORP-SECURE uses 802.1X — the laptop (supplicant) proves its user's identity with EAP, AP1/WLC (authenticator) relays it to RADIUS (authentication server), and an Access-Accept returns a per-user key and a VLAN. Disable one account and only that user is out.", (s) => {
    const n0: WsecState = { ...s, radius: true, wlans: [...s.wlans, { ssid: "CORP-SECURE", vlan: 10, akms: ["WPA2-802.1X", "WPA3-802.1X"], pmf: "required" }] };
    const p = packet("rad-p", "IP", "WLC", "RADIUS", "RADIUS", "RADIUS Access-Request · EAP-PEAP · user alice", [layer("IPv4 Header", C.ip, [["Source IP", "10.30.0.10 (WLC)"], ["Destination IP", "10.99.0.20"]]), layer("UDP", C.ip, [["Destination Port", "1812"]]), layer("RADIUS", C.radius, [["Code", "Access-Request"], ["EAP", "PEAP (MSCHAPv2 inside TLS)"], ["Called-Station-Id", "AP1:CORP-SECURE"]])]);
    const n = acted(n0, hop({ stepId: "enterprise", device: "RADIUS", stages: withDetail(ST.rad, { eap: "PEAP · alice · password check inside TLS", res: "Access-Accept · VLAN 10 · per-user PMK" }), activeStageId: "res", ingressInterfaceId: "eth0", lookupType: "RADIUS (UDP 1812)", lookupKey: "alice", lookupResult: "Access-Accept", action: "ACCEPT", reason: "Each user's key comes from their own EAP authentication — no shared secret on the client.", input: p.summary, output: "Access-Accept → WLC → 4-way handshake", nextHopId: "WLC", before: stackOf(p) }), p, "alice accepted");
    return { ...n, joined: { ...n.joined, LAPTOP: negotiate(n0.wlans[n0.wlans.length - 1], CLIENTS.LAPTOP) ?? "refused" } };
  }, "PACKET_SENT"),
  say("pmf", "Protected management frames", "Deauthentication frames used to be unauthenticated, so anyone could forge one and knock clients off. PMF (802.11w) signs management frames; WPA3 requires it."),
  say("predict-gui", "Predict: a WPA2-PSK WLAN", "The warehouse needs a WLAN for handheld barcode scanners that support only WPA2-PSK. You'll configure it on the WLC's GUI.", {
    question: q("Which settings make a valid WPA2-PSK WLAN?", [["ok", "WPA2 policy, AES (CCMP) encryption, PSK key management, an 8–63 character passphrase"], ["tkip", "WPA policy, TKIP encryption, PSK key management"], ["dot1x", "WPA2 policy, AES encryption, 802.1X key management, no passphrase"], ["short", "WPA2 policy, AES encryption, PSK key management, a 6-character passphrase"]], "ok", "WPA2-PSK = WPA2 + AES-CCMP + PSK auth key management + an ASCII passphrase of 8 to 63 characters. TKIP is deprecated; 802.1X is the Enterprise method."),
  }),
  act("gui", "Configure the WLAN (GUI)", "WLANs → Create New: profile WAREHOUSE, SSID WAREHOUSE. General: status enabled, interface vlan40. Security → Layer 2: WPA+WPA2, WPA2 policy, AES; Auth key management: PSK; PSK format ASCII, a long passphrase. Apply. The WLC pushes it to AP1; the scanners join.", (s) => {
    const n0: WsecState = { ...s, scanners: true, wlans: [...s.wlans, { ssid: "WAREHOUSE", vlan: 40, akms: ["WPA2-PSK"], pmf: "optional" }] };
    const n = join("gui", "SCANNER", "WAREHOUSE")(n0);
    return { ...n, decision: { device: "WLC", text: "WAREHOUSE · WPA2 · AES · PSK · VLAN 40" } };
  }, "PACKET_SENT"),
  // incident
  act("fault-injected", "A security hardening", "An audit says: 'move every WLAN to WPA3'. An engineer sets WAREHOUSE to WPA3-SAE only, PMF required, and applies it during the night shift.", (s) => ({ ...s, faultActive: true, wlans: s.wlans.map((w) => (w.ssid === "WAREHOUSE" ? { ...w, akms: ["WPA3-SAE"], pmf: "required" } : w)), packet: undefined, flood: [], decision: { device: "WLC", text: "WAREHOUSE → WPA3-SAE only · PMF required" } }), "STEP_ENTERED"),
  act("inc-join", "Scanners drop off", "Every scanner disconnects and fails to rejoin. The WLC's client log shows association failures for WAREHOUSE.", join("inc-join", "SCANNER", "WAREHOUSE"), "PACKET_DROPPED"),
  say("trouble-question", "Diagnose", "Laptops can still join WAREHOUSE. The scanners' firmware lists WPA2-PSK as their only secure method.", {
    question: q("Why can't the scanners join?", [["akm", "WAREHOUSE now offers only WPA3-SAE, and the scanners support only WPA2-PSK — there is no common method"], ["pass", "The passphrase changed"], ["vlan", "VLAN 40 is missing on the trunk"], ["rf", "The scanners are out of range"]], "akm", "Association needs a key-management method both sides support. WPA3-only removed the one the scanners have.", ["What does the WLAN offer now?", "What do the scanners support?", "Is there any overlap?"]),
  }),
  say("diagnostic-layers", "Troubleshooting layers", "Check from the radio up: RF and association, the WLAN's security settings against the client's capabilities, then VLAN and DHCP."),
  repairStep("repair-challenge", "Repair", "Choose the change that fixes the cause.", WS_REPAIR_CORRECT, (s) => ({ ...s, wlans: s.wlans.map((w) => (w.ssid === "WAREHOUSE" ? { ...w, akms: ["WPA2-PSK", "WPA3-SAE"], pmf: "optional" } : w)), decision: { device: "WLC", text: "WAREHOUSE → WPA2-PSK + WPA3-SAE (transition) · PMF optional" } })),
  act("verify", "Proof", "Both kinds of device join WAREHOUSE: the laptop negotiates WPA3-SAE, the scanner WPA2-PSK. Replacing the scanners is now a planned project, not an outage.", (s) => join("verify", "SCANNER", "WAREHOUSE")(join("verify-laptop", "LAPTOP", "WAREHOUSE")(s)), "PACKET_SENT"),
  say("complete", "Wireless security", "Open Wi-Fi is readable by anyone in range; WEP and TKIP are broken; WPA2 brought AES and the 4-way handshake; WPA3 adds SAE (private session keys) and mandatory PMF; 802.1X gives each user their own key through RADIUS; and transition mode lets older clients join while newer ones use WPA3."),
];
