import type { CliArgSpec, CliCommand, CliCommandSet, CliResult, CliVendor } from "@/lib/cli/types";
import { columns } from "@/lib/cli/format";
import type { CliQuestion } from "@/app/demo/dhcp-dns/dhcp-lab/dhcpBuildCli";
import { withSelfPing } from "@/lib/cli/selfPing";
import { withShellHistory } from "@/lib/cli/shellHistory";
import { GW, HOST_IP, IKE_PROPS, INET_WEB, PSKS, WEB_NET, isCidr, isIp, otherGw, vpClone, type IkeProp, type VpAction, type VpGw, type VpGwCfg, type VpHost, type VpNet } from "@/lib/sim-engine/scenarios/vpnNet";

/**
 * Command lines of the VPN Lab. GW-A and GW-B run Cisco IOS (IKEv2 with a crypto map on the WAN interface — the
 * crypto ACL is the traffic selector) or Junos (route-based: st0.0 bound to the VPN, a traffic-selector, a static
 * route into st0.0). Both print the same lab state: the IKE SA, the CHILD SA with its SPIs and counters, the log. The
 * INTERNET is a read-only looking glass; hosts have a Linux shell.
 *
 *   IOS    show crypto ikev2 sa [detailed] · show crypto ipsec sa · show crypto session · show crypto map ·
 *          show crypto ikev2 proposal · show access-lists · show ip route · show running-config · show logging ·
 *          clear crypto session · configure terminal → crypto ikev2 policy POL-1 (proposal …) · crypto ikev2 keyring
 *          KR → peer SITE-x (address · pre-shared-key) · crypto map VPN 10 ipsec-isakmp (set peer) ·
 *          ip access-list extended VPN-TRAFFIC ([no] permit ip …) · interface GigabitEthernet0/1 ([no] crypto map VPN)
 *   Junos  show security ike security-associations [detail] · show security ipsec security-associations [detail] ·
 *          show security ipsec statistics · show route · show configuration security ike|ipsec · show log messages ·
 *          clear security ike security-associations → configure: set security ike policy ike-pol proposals … |
 *          pre-shared-key ascii-text … · set security ike gateway gw-peer address … · set security ipsec vpn site-vpn
 *          traffic-selector ts1 local-ip | remote-ip … · set / delete routing-options static route … next-hop st0.0
 */
export type VpIosMode = { kind: "exec" } | { kind: "config" } | { kind: "policy" } | { kind: "keyring" } | { kind: "kpeer" } | { kind: "cmap" } | { kind: "acl" } | { kind: "ifc" };
export type VpCand = Record<VpGw, VpGwCfg>;
export interface VpCliApi {
  view: VpNet;
  act: (a: VpAction) => VpNet;
  ios: Record<VpGw, VpIosMode>;
  setIos: (g: VpGw, m: VpIosMode) => void;
  junosEdit: Record<VpGw, boolean>;
  setJunosEdit: (g: VpGw, b: boolean) => void;
  cand: VpCand;
  setCand: (c: VpCand) => void;
  ask?: (q: CliQuestion | undefined) => void;
  history?: string[];
}
const refuse = (output: string, explanation?: string): CliResult => ({ output, refused: true, explanation });
const prefixed = (cmds: CliCommand[], word: "do" | "run"): CliCommand[] => cmds.map((c) => ({ ...c, id: `${word}:${c.id}`, syntax: `${word} ${c.syntax}` }));
const stamp = (clock: number) => {
  const hh = String(Math.floor(clock / 3600) % 24).padStart(2, "0");
  const mm = String(Math.floor(clock / 60) % 60).padStart(2, "0");
  const ss = String(Math.floor(clock) % 60).padStart(2, "0");
  return { ios: `*Mar  1 ${hh}:${mm}:${ss}.000`, junos: `Mar  1 ${hh}:${mm}:${ss}` };
};
const lenToMask = (len: number) => [0, 8, 16, 24].map((o) => Math.max(0, Math.min(8, len - o))).map((b) => 256 - 2 ** (8 - b)).join(".");
const lenToWild = (len: number) => lenToMask(len).split(".").map((o) => 255 - +o).join(".");
const wildToLen = (w: string) => { const bits = w.split(".").map((o) => (255 - +o).toString(2).padStart(8, "0")).join(""); return /^1*0*$/.test(bits) ? bits.indexOf("0") === -1 ? 32 : bits.indexOf("0") : undefined; };
const fixedName = (n: string): CliArgSpec => ({ choices: [n], resolve: (raw) => (raw.toUpperCase() === n ? n : undefined) });
const ipArg = (choices: string[]): CliArgSpec => ({ choices, resolve: (raw) => (isIp(raw) ? raw : undefined) });
const cidrArg = (choices: string[]): CliArgSpec => ({ choices, resolve: (raw) => (isCidr(raw) ? raw : undefined) });
const wildArg: CliArgSpec = { choices: ["0.0.0.255"], resolve: (raw) => (isIp(raw) && wildToLen(raw) !== undefined ? raw : undefined) };
const PROP_NAME: Record<IkeProp, { cisco: string; junos: string }> = { "aes256-sha256-g19": { cisco: "PROP-G19", junos: "ike-g19" }, "aes128-sha1-g14": { cisco: "PROP-G14", junos: "ike-g14" } };
const propOf = (vendor: CliVendor, raw: string) => (Object.keys(PROP_NAME) as IkeProp[]).find((p) => PROP_NAME[p][vendor === "cisco" ? "cisco" : "junos"].toLowerCase() === raw.toLowerCase());
const peerName = (g: VpGw) => (g === "GW-A" ? "SITE-B" : "SITE-A");
const hashed = (psk: string) => `$9$${[...psk].map((ch) => String.fromCharCode(((ch.charCodeAt(0) * 7) % 26) + 65)).join("")}`;
const pskArg: CliArgSpec = { choices: [...PSKS], describe: () => "the shared secret (both gateways must use the same)", resolve: (raw) => (/^\S{6,64}$/.test(raw) ? raw.replace(/^"|"$/g, "") : undefined) };

// ---------------------------------------------------------------------------------------------------------------
// Shared outputs
// ---------------------------------------------------------------------------------------------------------------
const tunnelUp = (s: VpNet) => s.tunnel.child === "INSTALLED";
const inSpi = (s: VpNet, g: VpGw) => (g === "GW-B" ? s.sa.ab : s.sa.ba);
const outSpi = (s: VpNet, g: VpGw) => (g === "GW-B" ? s.sa.ba : s.sa.ab);
function iosLogLine(s: VpNet, g: VpGw, text: string, clock: number) {
  const t = stamp(clock).ios;
  const peer = s.cfg.gw[g].peer;
  if (/CHILD SA installed/.test(text)) return `${t}: %IKEV2-5-SA_UP: SA UP\n${t}: %CRYPTO-5-SESSION_STATUS: Crypto tunnel is UP  .  Peer ${peer}:500`;
  if (/IKE SA down|CHILD SA deleted/.test(text)) return `${t}: %IKEV2-5-SA_DOWN: SA DOWN\n${t}: %CRYPTO-5-SESSION_STATUS: Crypto tunnel is DOWN.  Peer ${peer}:500`;
  if (text === "NO_PROPOSAL_CHOSEN") return `${t}: %IKEV2-3-NEG_ABORT: Negotiation aborted due to ERROR: Failed to find a matching policy (NO_PROPOSAL_CHOSEN) — peer ${peer}`;
  if (text === "AUTHENTICATION_FAILED") return `${t}: %IKEV2-3-NEG_ABORT: Negotiation aborted due to ERROR: Auth exchange failed (AUTHENTICATION_FAILED) — peer ${peer}`;
  if (text === "TS_UNACCEPTABLE") return `${t}: %IKEV2-3-NEG_ABORT: Negotiation aborted due to ERROR: Create child exchange failed: TS_UNACCEPTABLE — peer ${peer}`;
  if (text === "NO_RESPONSE") return `${t}: %IKEV2-5-OSAL_INITIATE_TUNNEL: Received request to establish an IPsec tunnel; local traffic selector = ${s.cfg.gw[g].local}, remote = ${s.cfg.gw[g].remote}\n${t}: %IKEV2-3-NEG_ABORT: Negotiation aborted due to ERROR: Maximum number of retransmissions reached — peer ${peer}`;
  return `${t}: %IKEV2-5-INFO: ${text}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Cisco IOS
// ---------------------------------------------------------------------------------------------------------------
function iosRunning(g: VpGw, c: VpGwCfg): string {
  const ln = c.local.split("/");
  const rn = c.remote.split("/");
  const lines = [
    `hostname ${g}`,
    "!",
    "crypto ikev2 proposal PROP-G19",
    " encryption aes-gcm-256",
    " prf sha256",
    " group 19",
    "crypto ikev2 proposal PROP-G14",
    " encryption aes-cbc-128",
    " integrity sha1",
    " group 14",
    "!",
    "crypto ikev2 policy POL-1",
    ` proposal ${PROP_NAME[c.ike].cisco}`,
    "!",
    "crypto ikev2 keyring KR",
    ` peer ${peerName(g)}`,
    `  address ${c.peer}`,
    `  pre-shared-key ${c.psk}`,
    "!",
    "crypto ikev2 profile PROF-1",
    ` match identity remote address ${c.peer} 255.255.255.255`,
    " authentication remote pre-share",
    " authentication local pre-share",
    " keyring local KR",
    "!",
    "crypto ipsec transform-set TS-GCM esp-gcm 256",
    " mode tunnel",
    "!",
    "crypto map VPN 10 ipsec-isakmp",
    ` set peer ${c.peer}`,
    " set transform-set TS-GCM",
    " set ikev2-profile PROF-1",
    " match address VPN-TRAFFIC",
    "!",
    "interface GigabitEthernet0/0",
    ` ip address ${GW[g].lan} 255.255.255.0`,
    " ip nat inside",
    "!",
    "interface GigabitEthernet0/1",
    ` ip address ${GW[g].wan} 255.255.255.252`,
    " ip nat outside",
    ...(c.steer ? [" crypto map VPN"] : []),
    "!",
    "ip access-list extended VPN-TRAFFIC",
    ...(c.local && c.remote ? [` permit ip ${ln[0]} ${lenToWild(+ln[1])} ${rn[0]} ${lenToWild(+rn[1])}`] : []),
    "ip access-list extended NAT-OUT",
    ` deny   ip ${GW[g].lanNet.split("/")[0]} 0.0.0.255 ${GW[otherGw(g)].lanNet.split("/")[0]} 0.0.0.255`,
    ` permit ip ${GW[g].lanNet.split("/")[0]} 0.0.0.255 any`,
    "ip nat inside source list NAT-OUT interface GigabitEthernet0/1 overload",
    `ip route 0.0.0.0 0.0.0.0 ${GW[g].isp}`,
    "!",
    "end",
  ];
  return `Building configuration...\n\nCurrent configuration : ${lines.join("\n").length} bytes\n!\n${lines.join("\n")}`;
}
function iosExec(api: VpCliApi, g: VpGw): CliCommand[] {
  const s = api.view;
  const c = s.cfg.gw[g];
  const t = s.tunnel;
  const p = IKE_PROPS[c.ike];
  return [
    {
      id: "ikesa",
      syntax: "show crypto ikev2 sa",
      summary: "The IKE SA with the peer",
      run: () =>
        t.ike === "ESTABLISHED"
          ? { output: [" IPv4 Crypto IKEv2  SA", "", columns([["Tunnel-id", "Local", "Remote", "fvrf/ivrf", "Status"], ["1", `${GW[g].wan}/500`, `${c.peer}/500`, "none/none", "READY"]], [10, 22, 22, 21]), `      Encr: ${p.encr.replace("-256", "").replace("-128", "")}, keysize: ${p.encr.endsWith("256") ? 256 : 128}, PRF: ${p.prf.replace("PRF-HMAC-", "")}, Hash: None, DH Grp:${c.ike.endsWith("g19") ? 19 : 14}, Auth sign: PSK, Auth verify: PSK`, "      Life/Active Time: 86400/912 sec"].join("\n"), explanation: `READY = the IKE SA is up: keys agreed (IKE_SA_INIT) and both peers authenticated (IKE_AUTH).${t.child !== "INSTALLED" ? ` But it protects only IKE — the CHILD SA failed: ${t.child}.` : ""}` }
          : { output: " IPv4 Crypto IKEv2  SA\n", explanation: `No IKE SA: ${t.why}` },
    },
    { id: "ikesa", syntax: "show crypto ikev2 sa detailed", summary: "The IKE SA with SPIs and the local/remote identities", run: () => (t.ike === "ESTABLISHED" ? { output: [" IPv4 Crypto IKEv2  SA", "", `Tunnel-id Local                 Remote                fvrf/ivrf            Status`, `1         ${GW[g].wan}/500     ${c.peer}/500      none/none            READY`, `      Encr: ${p.encr}, PRF: ${p.prf}, DH Grp: ${p.dh}`, `      Local spi: ${g === "GW-A" ? "1A2B3C4D5E6F7081" : "9F8E7D6C5B4A3921"}       Remote spi: ${g === "GW-A" ? "9F8E7D6C5B4A3921" : "1A2B3C4D5E6F7081"}`, `      Local id: ${GW[g].wan}`, `      Remote id: ${c.peer}`, `      Local req msg id:  2              Remote req msg id:  0`, `      Initiator of SA : ${g === "GW-A" ? "Yes" : "No"}`].join("\n") } : { output: " IPv4 Crypto IKEv2  SA\n", explanation: `No IKE SA: ${t.why}` }) },
    {
      id: "ipsecsa",
      syntax: "show crypto ipsec sa",
      summary: "The CHILD SA: selectors, SPIs, packet counters",
      run: () => ({
        output: [
          "interface: GigabitEthernet0/1",
          `    Crypto map tag: VPN, local addr ${GW[g].wan}`,
          "",
          "   protected vrf: (none)",
          `   local  ident (addr/mask/prot/port): (${c.local.split("/")[0]}/${lenToMask(+c.local.split("/")[1])}/0/0)`,
          `   remote ident (addr/mask/prot/port): (${c.remote.split("/")[0]}/${lenToMask(+c.remote.split("/")[1])}/0/0)`,
          `   current_peer ${c.peer} port 500`,
          `     PERMIT, flags={origin_is_acl,}`,
          `    #pkts encaps: ${tunnelUp(s) ? s.sa.encaps[g] : 0}, #pkts encrypt: ${tunnelUp(s) ? s.sa.encaps[g] : 0}, #pkts digest: ${tunnelUp(s) ? s.sa.encaps[g] : 0}`,
          `    #pkts decaps: ${tunnelUp(s) ? s.sa.decaps[g] : 0}, #pkts decrypt: ${tunnelUp(s) ? s.sa.decaps[g] : 0}, #pkts verify: ${tunnelUp(s) ? s.sa.decaps[g] : 0}`,
          "",
          `     local crypto endpt.: ${GW[g].wan}, remote crypto endpt.: ${c.peer}`,
          `     current outbound spi: ${tunnelUp(s) ? outSpi(s, g).toUpperCase().replace("0X", "0x") : "0x0(0)"}`,
          "",
          "     inbound esp sas:",
          ...(tunnelUp(s) ? [`      spi: ${inSpi(s, g)}`, "        transform: esp-gcm 256 ,", "        in use settings ={Tunnel, }", "        sa timing: remaining key lifetime (sec): (3590)", "        replay detection support: Y", "        Status: ACTIVE(ACTIVE)"] : []),
          "",
          "     outbound esp sas:",
          ...(tunnelUp(s) ? [`      spi: ${outSpi(s, g)}`, "        transform: esp-gcm 256 ,", "        in use settings ={Tunnel, }", "        Status: ACTIVE(ACTIVE)"] : []),
        ].join("\n"),
        explanation: tunnelUp(s) ? "Two one-way SAs. The inbound SPI is the one THIS gateway chose; packets toward it carry it. encaps counts packets this gateway encrypted, decaps the ones it decrypted — the proof traffic really uses the tunnel." : `No ESP SAs: ${t.why}`,
      }),
    },
    { id: "sess", syntax: "show crypto session", summary: "Tunnel status at a glance", run: () => ({ output: ["Crypto session current status", "", "Interface: GigabitEthernet0/1", `Session status: ${tunnelUp(s) ? "UP-ACTIVE" : t.ike === "ESTABLISHED" ? "UP-NO-IPSEC" : "DOWN-NEGOTIATING"}`, `Peer: ${c.peer} port 500`, `  Session ID: 1`, `  IKEv2 SA: local ${GW[g].wan}/500 remote ${c.peer}/500 ${t.ike === "ESTABLISHED" ? "Active" : "Inactive"}`, `  IPSEC FLOW: permit ip ${c.local.split("/")[0]}/${lenToMask(+c.local.split("/")[1])} ${c.remote.split("/")[0]}/${lenToMask(+c.remote.split("/")[1])}`, `        Active SAs: ${tunnelUp(s) ? 2 : 0}, origin: crypto map`].join("\n"), explanation: tunnelUp(s) ? undefined : t.ike === "ESTABLISHED" ? "UP-NO-IPSEC: the IKE SA is up but there is no CHILD SA — user traffic can't pass." : "DOWN-NEGOTIATING: IKE keeps trying and failing." }) },
    { id: "cmap", syntax: "show crypto map", summary: "The crypto map and where it is applied", run: () => ({ output: [`Crypto Map IPv4 "VPN" 10 ipsec-isakmp`, `\tPeer = ${c.peer}`, `\tIKEv2 Profile: PROF-1`, `\tAccess-List SS dynamic: False`, `\tExtended IP access list VPN-TRAFFIC`, `\t    access-list VPN-TRAFFIC permit ip ${c.local.split("/")[0]} ${lenToWild(+c.local.split("/")[1])} ${c.remote.split("/")[0]} ${lenToWild(+c.remote.split("/")[1])}`, `\tCurrent peer: ${c.peer}`, "\tTransform sets={ TS-GCM:  { esp-gcm 256  } , }", `\tInterfaces using crypto map VPN:`, ...(c.steer ? ["\t\tGigabitEthernet0/1"] : [])].join("\n"), explanation: c.steer ? "Traffic leaving Gi0/1 that matches VPN-TRAFFIC is encrypted toward the peer." : "No interface uses this crypto map: matching traffic leaves Gi0/1 unencrypted — the tunnel can be up and still unused." }) },
    { id: "prop", syntax: "show crypto ikev2 proposal", summary: "The IKE proposals (and which one the policy uses)", run: () => ({ output: [" IKEv2 proposal: PROP-G19", "     Encryption : AES-GCM-256", "     PRF        : SHA256", "     DH Group   : DH_GROUP_256_ECP/Group 19", " IKEv2 proposal: PROP-G14", "     Encryption : AES-CBC-128", "     Integrity  : SHA96", "     PRF        : SHA1", "     DH Group   : DH_GROUP_2048_MODP/Group 14", "", ` IKEv2 policy POL-1 uses proposal ${PROP_NAME[c.ike].cisco}`].join("\n"), explanation: "IKE_SA_INIT only succeeds if both gateways offer a common proposal." }) },
    { id: "acl", syntax: "show access-lists", summary: "The crypto ACL (traffic selector) and NAT ACL", run: () => ({ output: ["Extended IP access list VPN-TRAFFIC", `    10 permit ip ${c.local.split("/")[0]} ${lenToWild(+c.local.split("/")[1])} ${c.remote.split("/")[0]} ${lenToWild(+c.remote.split("/")[1])}${tunnelUp(s) && s.sa.encaps[g] ? ` (${s.sa.encaps[g]} matches)` : ""}`, "Extended IP access list NAT-OUT", `    10 deny ip ${GW[g].lanNet.split("/")[0]} 0.0.0.255 ${GW[otherGw(g)].lanNet.split("/")[0]} 0.0.0.255`, `    20 permit ip ${GW[g].lanNet.split("/")[0]} 0.0.0.255 any`].join("\n"), explanation: "VPN-TRAFFIC is the traffic selector this gateway proposes (local → remote). The peer must accept the mirror image." }) },
    { id: "route", syntax: "show ip route", summary: "The routing table", run: () => ({ output: ["Codes: L - local, C - connected, S - static", "", `Gateway of last resort is ${GW[g].isp} to network 0.0.0.0`, "", `S*    0.0.0.0/0 [1/0] via ${GW[g].isp}`, `C        ${GW[g].lanNet} is directly connected, GigabitEthernet0/0`, `L        ${GW[g].lan}/32 is directly connected, GigabitEthernet0/0`, `C        ${GW[g].wanNet} is directly connected, GigabitEthernet0/1`, `L        ${GW[g].wan}/32 is directly connected, GigabitEthernet0/1`].join("\n"), explanation: "The other site is reached by the default route out Gi0/1 — the crypto map on that interface decides whether it is encrypted." }) },
    { id: "run", syntax: "show running-config", summary: `${g}'s configuration`, run: () => ({ output: iosRunning(g, c) }) },
    { id: "log", syntax: "show logging", summary: "The log: tunnel up/down, negotiation errors", run: () => { const l = s.syslog.filter((x) => x.gw === g).slice(-30).map((x) => iosLogLine(s, g, x.text, x.clock)); return { output: ["Syslog logging: enabled", "", "Log Buffer (8192 bytes):", ...(l.length ? l : [tunnelUp(s) ? iosLogLine(s, g, "IKE SA up · CHILD SA installed", s.clock - 900) : iosLogLine(s, g, t.ike === "ESTABLISHED" ? t.child : t.ike, s.clock - 30)])].join("\n"), explanation: "NEG_ABORT names the stage that failed: no matching policy (proposal), auth exchange (key), TS unacceptable (selectors), retransmissions (no answer)." }; } },
    { id: "clr", syntax: "clear crypto session", summary: "Tear the tunnel down; it renegotiates (new SPIs)", run: () => (api.act({ type: "clear" }), { output: "", explanation: "New SAs, new SPIs, counters back to 0." }) },
    { id: "hist", syntax: "show history", summary: "The commands you typed in this session", run: () => ({ output: [...(api.history ?? []), "show history"].map((x) => `  ${x}`).join("\n") }) },
  ];
}
function iosSet(api: VpCliApi, g: VpGw): CliCommandSet {
  const s = api.view;
  const c = s.cfg.gw[g];
  const base = { vendor: "cisco" as const, deviceId: g, deviceName: g };
  const mode = api.ios[g];
  const exec = iosExec(api, g);
  const set = (patch: Partial<VpGwCfg>, text: string) => {
    const cfg = vpClone(s.cfg);
    cfg.gw[g] = { ...cfg.gw[g], ...patch };
    api.act({ type: "cfg", cfg, text: `${g}: ${text}` });
  };
  const to = (m: VpIosMode) => () => (api.setIos(g, m), { output: "" });
  const end: CliCommand = { id: "end", syntax: "end", summary: "Leave configuration mode", run: () => (api.setIos(g, { kind: "exec" }), { output: "%SYS-5-CONFIG_I: Configured from console by console" }) };
  if (mode.kind === "exec") return { ...base, prompt: `${g}#`, commands: [...exec, { id: "conf", syntax: "configure terminal", summary: "Enter configuration mode", run: () => (api.setIos(g, { kind: "config" }), { output: "Enter configuration commands, one per line.  End with CNTL/Z." }) }] };
  const doCmds = prefixed(exec, "do");
  const back = (k: VpIosMode["kind"], prompt: string, cmds: CliCommand[], up: VpIosMode = { kind: "config" }): CliCommandSet => ({ ...base, prompt: `${g}(${prompt})#`, commands: [...cmds, { id: "exit", syntax: "exit", summary: "Up one level", run: to(up) }, end, ...doCmds] });
  const peerIp = ipArg([GW[otherGw(g)].wan]);
  switch (mode.kind) {
    case "config":
      return back("config", "config", [
        { id: "pol", syntax: "crypto ikev2 policy <name>", summary: "Edit the IKEv2 policy (which proposal is offered)", args: { name: fixedName("POL-1") }, run: to({ kind: "policy" }) },
        { id: "kr", syntax: "crypto ikev2 keyring <name>", summary: "Edit the keyring (peer address, pre-shared key)", args: { name: fixedName("KR") }, run: to({ kind: "keyring" }) },
        { id: "cm", syntax: "crypto map <map> <seq> ipsec-isakmp", summary: "Edit the crypto map entry", args: { map: fixedName("VPN"), seq: { choices: ["10"], resolve: (raw) => (raw === "10" ? raw : undefined) } }, run: to({ kind: "cmap" }) },
        { id: "acl", syntax: "ip access-list extended <acl>", summary: "Edit the crypto ACL (the traffic selector)", args: { acl: fixedName("VPN-TRAFFIC") }, run: () => (api.setIos(g, { kind: "acl" }), { output: "", explanation: "VPN-TRAFFIC decides which traffic is protected — and is what this gateway proposes as TSi/TSr." }) },
        { id: "ifc", syntax: "interface <ifc>", summary: "Configure the WAN interface", args: { ifc: { choices: ["GigabitEthernet0/1"], describe: () => `WAN ${GW[g].wan}`, resolve: (raw) => (/^(gigabitethernet|gi)0\/1$/i.test(raw) ? "GigabitEthernet0/1" : undefined) } }, run: to({ kind: "ifc" }) },
        { id: "prop", syntax: "crypto ikev2 proposal <name>", summary: "", hidden: true, args: { name: { choices: ["PROP-G19"], resolve: (raw) => raw } }, run: () => refuse("% Not available in this lab: the two proposals are fixed.", "Choose which proposal the policy offers instead: crypto ikev2 policy POL-1 → proposal …") },
      ]);
    case "policy":
      return back("policy", "config-ikev2-policy", [
        { id: "pp", syntax: "proposal <name>", summary: "Offer this proposal", args: { name: { choices: ["PROP-G19", "PROP-G14"], describe: (n) => (n === "PROP-G19" ? IKE_PROPS["aes256-sha256-g19"].cisco : IKE_PROPS["aes128-sha1-g14"].cisco), resolve: (raw) => (propOf("cisco", raw) ? raw.toUpperCase() : undefined) } }, run: ({ name }) => (set({ ike: propOf("cisco", name)! }, `IKEv2 policy proposal ${name}`), { output: "", explanation: "IKE_SA_INIT will offer this proposal; the peer must offer the same." }) },
      ]);
    case "keyring":
      return back("keyring", "config-ikev2-keyring", [{ id: "peer", syntax: "peer <name>", summary: "Edit the peer entry", args: { name: fixedName(peerName(g)) }, run: to({ kind: "kpeer" }) }]);
    case "kpeer":
      return back("kpeer", "config-ikev2-keyring-peer", [
        { id: "addr", syntax: "address <ip>", summary: "The peer's public address", args: { ip: peerIp }, run: ({ ip }) => (set({ peer: ip }, `keyring peer address ${ip}`), { output: "", explanation: `In this lab the keyring peer, the profile match and the crypto map's set peer follow one value: ${ip}.` }) },
        { id: "psk", syntax: "pre-shared-key <key>", summary: "The shared secret", args: { key: pskArg }, run: ({ key }) => (set({ psk: key }, "pre-shared key changed"), { output: "", explanation: "Both gateways must use exactly the same key, or IKE_AUTH fails." }) },
      ], { kind: "keyring" });
    case "cmap":
      return back("cmap", "config-crypto-map", [
        { id: "sp", syntax: "set peer <ip>", summary: "Where IKE is sent", args: { ip: peerIp }, run: ({ ip }) => (set({ peer: ip }, `crypto map set peer ${ip}`), { output: "" }) },
        { id: "ma", syntax: "match address <acl>", summary: "The crypto ACL", args: { acl: fixedName("VPN-TRAFFIC") }, run: () => ({ output: "", explanation: "Already matching VPN-TRAFFIC." }) },
      ]);
    case "acl": {
      const ace = (neg: boolean): CliCommand => ({
        id: `ace-${neg}`,
        syntax: `${neg ? "no " : ""}permit ip <src> <sw> <dst> <dw>`,
        summary: neg ? "Remove the entry" : "Protect this traffic (local → remote)",
        args: { src: ipArg([GW[g].lanNet.split("/")[0]]), sw: wildArg, dst: ipArg([GW[otherGw(g)].lanNet.split("/")[0]]), dw: wildArg },
        run: ({ src, sw, dst, dw }) => {
          const local = `${src}/${wildToLen(sw)}`;
          const remote = `${dst}/${wildToLen(dw)}`;
          if (neg) {
            if (local !== c.local || remote !== c.remote) return refuse("% Entry not found");
            return refuse("", "In this lab VPN-TRAFFIC always holds exactly one entry: type the new permit to replace it.");
          }
          set({ local, remote }, `VPN-TRAFFIC permit ip ${local} → ${remote}`);
          return { output: "", explanation: `This gateway now protects ${local} ↔ ${remote} (replacing the previous entry — one entry in this lab).` };
        },
      });
      return back("acl", "config-ext-nacl", [ace(false), ace(true)]);
    }
    case "ifc":
      return back("ifc", "config-if", [
        { id: "cm", syntax: "crypto map <map>", summary: "Apply the crypto map (encrypt matching traffic)", args: { map: fixedName("VPN") }, run: () => (set({ steer: true }, "crypto map VPN applied on Gi0/1"), { output: `%CRYPTO-6-ISAKMP_ON_OFF: ISAKMP is ON` }) },
        { id: "cm", syntax: "no crypto map <map>", summary: "Remove it (traffic leaves unencrypted)", args: { map: fixedName("VPN") }, run: () => (set({ steer: false }, "crypto map VPN removed from Gi0/1"), { output: "", explanation: "Site traffic now follows the default route in the clear." }) },
      ]);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Junos
// ---------------------------------------------------------------------------------------------------------------
interface JNode {
  name: string;
  kids?: JNode[];
}
const render = (nodes: JNode[], d = 0): string[] => nodes.flatMap((n) => (n.kids ? [`${"    ".repeat(d)}${n.name} {`, ...render(n.kids, d + 1), `${"    ".repeat(d)}}`] : [`${"    ".repeat(d)}${n.name};`]));
function walk(nodes: JNode[], path: string[]): string {
  const want = [...path];
  while (want.length) {
    let hit: JNode | undefined;
    for (let k = Math.min(want.length, 3); k >= 1 && !hit; k--) {
      hit = nodes.find((n) => n.name === want.slice(0, k).join(" "));
      if (hit) want.splice(0, k);
    }
    if (!hit?.kids) return "";
    nodes = hit.kids;
  }
  return render(nodes).join("\n");
}
function junosTree(g: VpGw, c: VpGwCfg): JNode[] {
  return [
    {
      name: "security",
      kids: [
        {
          name: "ike",
          kids: [
            { name: "proposal ike-g19", kids: [{ name: "authentication-method pre-shared-keys" }, { name: "dh-group group19" }, { name: "encryption-algorithm aes-256-gcm" }] },
            { name: "proposal ike-g14", kids: [{ name: "authentication-method pre-shared-keys" }, { name: "dh-group group14" }, { name: "authentication-algorithm sha1" }, { name: "encryption-algorithm aes-128-cbc" }] },
            { name: "policy ike-pol", kids: [{ name: `proposals ${PROP_NAME[c.ike].junos}` }, { name: `pre-shared-key ascii-text "${hashed(c.psk)}"` }] },
            { name: "gateway gw-peer", kids: [{ name: "ike-policy ike-pol" }, { name: `address ${c.peer}` }, { name: "external-interface ge-0/0/1.0" }, { name: "version v2-only" }] },
          ],
        },
        {
          name: "ipsec",
          kids: [
            { name: "proposal esp-gcm", kids: [{ name: "protocol esp" }, { name: "encryption-algorithm aes-256-gcm" }] },
            { name: "policy ipsec-pol", kids: [{ name: "proposals esp-gcm" }] },
            { name: "vpn site-vpn", kids: [{ name: "bind-interface st0.0" }, { name: "ike", kids: [{ name: "gateway gw-peer" }, { name: "ipsec-policy ipsec-pol" }] }, { name: "traffic-selector ts1", kids: [{ name: `local-ip ${c.local}` }, { name: `remote-ip ${c.remote}` }] }, { name: "establish-tunnels immediately" }] },
          ],
        },
        { name: "zones", kids: [{ name: "security-zone trust", kids: [{ name: "interfaces", kids: [{ name: "ge-0/0/0.0" }] }] }, { name: "security-zone untrust", kids: [{ name: "host-inbound-traffic", kids: [{ name: "system-services", kids: [{ name: "ike" }] }] }, { name: "interfaces", kids: [{ name: "ge-0/0/1.0" }] }] }, { name: "security-zone vpn", kids: [{ name: "interfaces", kids: [{ name: "st0.0" }] }] }] },
      ],
    },
    { name: "interfaces", kids: [{ name: "st0", kids: [{ name: "unit 0", kids: [{ name: "family inet" }] }] }] },
    { name: "routing-options", kids: [{ name: "static", kids: [{ name: `route 0.0.0.0/0 next-hop ${GW[g].isp}` }, ...(c.steer ? [{ name: `route ${GW[otherGw(g)].lanNet} next-hop st0.0` }] : [])] }] },
  ];
}
export const vpJunosText = (g: VpGw, c: VpGwCfg, path: string[] = []) => walk(junosTree(g, c), path);
function junosOp(api: VpCliApi, g: VpGw): CliCommand[] {
  const s = api.view;
  const c = s.cfg.gw[g];
  const t = s.tunnel;
  return [
    { id: "ike", syntax: "show security ike security-associations", summary: "The IKE SA", run: () => (t.ike === "ESTABLISHED" ? { output: columns([["Index", "State", "Initiator cookie", "Responder cookie", "Mode", "Remote Address"], ["4519261", "UP", "1a2b3c4d5e6f7081", "9f8e7d6c5b4a3921", "IKEv2", c.peer]], [9, 7, 18, 18, 8]) } : { output: "", explanation: `No IKE SA: ${t.why}` }) },
    { id: "ike", syntax: "show security ike security-associations detail", summary: "The IKE SA in detail", run: () => (t.ike === "ESTABLISHED" ? { output: [`IKE peer ${c.peer}, Index 4519261, Gateway Name: gw-peer`, `  Role: ${g === "GW-A" ? "Initiator" : "Responder"}, State: UP`, "  Initiator cookie: 1a2b3c4d5e6f7081, Responder cookie: 9f8e7d6c5b4a3921", `  Exchange type: IKEv2, Authentication method: Pre-shared-keys`, `  Local: ${GW[g].wan}:500, Remote: ${c.peer}:500`, "  Algorithms:", `   Authentication        : ${c.ike.includes("sha1") ? "hmac-sha1-96" : "(AEAD)"}`, `   Encryption            : ${c.ike.includes("g19") ? "aes256-gcm" : "aes128-cbc"}`, `   Pseudo random function: ${c.ike.includes("g19") ? "hmac-sha256" : "hmac-sha1"}`, `   Diffie-Hellman group  : ${c.ike.includes("g19") ? "DH-group-19" : "DH-group-14"}`].join("\n") } : { output: "", explanation: `No IKE SA: ${t.why}` }) },
    {
      id: "ipsec",
      syntax: "show security ipsec security-associations",
      summary: "The CHILD SA (both directions, SPIs)",
      run: () => (tunnelUp(s) ? { output: [`  Total active tunnels: 1     Total Ipsec sas: 1`, columns([["  ID", "Algorithm", "SPI", "Life:sec/kb", "Mon", "lsys", "Port", "Gateway"], ["  <131073", "ESP:aes-gcm-256/None", inSpi(s, g).slice(2), "3590/ unlim", "-", "root", "500", c.peer], ["  >131073", "ESP:aes-gcm-256/None", outSpi(s, g).slice(2), "3590/ unlim", "-", "root", "500", c.peer]], [10, 21, 10, 13, 4, 5, 5])].join("\n"), explanation: "< inbound (the SPI this gateway chose), > outbound (the peer's). Both exist only when the CHILD SA is installed." } : { output: "  Total active tunnels: 0     Total Ipsec sas: 0", explanation: t.ike === "ESTABLISHED" ? `IKE SA up, but no IPsec SA: ${t.child}.` : `No IPsec SA: ${t.why}` }),
    },
    { id: "ipsec", syntax: "show security ipsec security-associations detail", summary: "The CHILD SA with its traffic selector", run: () => ({ output: tunnelUp(s) ? [`ID: 131073 Virtual-system: root, VPN Name: site-vpn`, `  Local Gateway: ${GW[g].wan}, Remote Gateway: ${c.peer}`, `  Traffic Selector Name: ts1`, `  Local Identity: ipv4(${c.local})`, `  Remote Identity: ipv4(${c.remote})`, `  Version: IKEv2`, `  Bind-interface: st0.0`, "", `    Direction: inbound, SPI: ${inSpi(s, g).slice(2)}, AUX-SPI: 0`, `    State: Installed`, `    Protocol: ESP, Authentication: None, Encryption: aes-gcm (256 bits)`, `    Anti-replay service: counter-based enabled, Replay window size: 64`, "", `    Direction: outbound, SPI: ${outSpi(s, g).slice(2)}, AUX-SPI: 0`, `    State: Installed`].join("\n") : "", explanation: tunnelUp(s) ? undefined : `No IPsec SA: ${t.ike === "ESTABLISHED" ? t.child : t.why}` }) },
    { id: "stats", syntax: "show security ipsec statistics", summary: "ESP packets encrypted / decrypted", run: () => ({ output: ["ESP Statistics:", `  Encrypted bytes:        ${(tunnelUp(s) ? s.sa.encaps[g] : 0) * 120}`, `  Decrypted bytes:        ${(tunnelUp(s) ? s.sa.decaps[g] : 0) * 120}`, `  Encrypted packets:      ${tunnelUp(s) ? s.sa.encaps[g] : 0}`, `  Decrypted packets:      ${tunnelUp(s) ? s.sa.decaps[g] : 0}`, "AH Statistics:", "  Input bytes:            0", "Errors:", "  AH authentication failures: 0, Replay errors: 0", "  ESP authentication failures: 0, ESP decryption failures: 0", "  Bad headers: 0, Bad trailers: 0"].join("\n"), explanation: "Encrypted packets that don't grow while users test = the traffic isn't entering st0.0." }) },
    { id: "route", syntax: "show route", summary: "The routing table", run: () => ({ output: ["inet.0: 6 destinations, 6 routes (6 active, 0 holddown, 0 hidden)", "+ = Active Route, - = Last Active, * = Both", "", "0.0.0.0/0          *[Static/5] 1d 00:00:00", `                    >  to ${GW[g].isp} via ge-0/0/1.0`, `${GW[g].lanNet.padEnd(19)}*[Direct/0] 1d 00:00:00`, "                    >  via ge-0/0/0.0", ...(c.steer && tunnelUp(s) ? [`${GW[otherGw(g)].lanNet.padEnd(19)}*[Static/5] 00:15:12`, "                    >  via st0.0"] : c.steer ? [] : []), `${GW[g].wanNet.padEnd(19)}*[Direct/0] 1d 00:00:00`, "                    >  via ge-0/0/1.0"].join("\n"), explanation: c.steer ? (tunnelUp(s) ? `${GW[otherGw(g)].lanNet} goes into st0.0 — encrypted.` : "The static route via st0.0 is configured but inactive: st0.0 is down while there is no IPsec SA.") : `No route to ${GW[otherGw(g)].lanNet} via st0.0: that traffic follows the default route in the clear.` }) },
    { id: "cfg", syntax: "show configuration security ike", summary: "IKE configuration", run: () => ({ output: vpJunosText(g, c, ["security", "ike"]) }) },
    { id: "cfg", syntax: "show configuration security ipsec", summary: "IPsec configuration", run: () => ({ output: vpJunosText(g, c, ["security", "ipsec"]) }) },
    { id: "cfg", syntax: "show configuration routing-options", summary: "Static routes", run: () => ({ output: vpJunosText(g, c, ["routing-options"]) }) },
    { id: "cfg", syntax: "show configuration", summary: "The committed configuration", run: () => ({ output: vpJunosText(g, c) }) },
    {
      id: "log",
      syntax: "show log messages",
      summary: "kmd: tunnel up/down, negotiation errors",
      run: () => {
        const line = (text: string, clock: number) => {
          const ts = stamp(clock).junos;
          if (/CHILD SA installed/.test(text)) return `${ts}  ${g} kmd[1622]: KMD_VPN_UP_ALARM_USER: VPN site-vpn from ${c.peer} is up. Local-ip: ${GW[g].wan}, gateway name: gw-peer, vpn name: site-vpn, tunnel-id: 131073, local tunnel-if: st0.0`;
          if (/down|deleted/i.test(text)) return `${ts}  ${g} kmd[1622]: KMD_VPN_DOWN_ALARM_USER: VPN site-vpn from ${c.peer} is down. Local-ip: ${GW[g].wan}, gateway name: gw-peer, reason: SA deleted`;
          const why = text === "NO_PROPOSAL_CHOSEN" ? "No proposal chosen" : text === "AUTHENTICATION_FAILED" ? "Authentication failed" : text === "TS_UNACCEPTABLE" ? "TS unacceptable" : "Peer not responding";
          return `${ts}  ${g} kmd[1622]: KMD_PM_SA_ESTABLISHMENT_FAILED? `.replace("KMD_PM_SA_ESTABLISHMENT_FAILED? ", `IKE negotiation failed with error: ${why}. IKE Version: 2, VPN: site-vpn Gateway: gw-peer, Local: ${GW[g].wan}/500, Remote: ${c.peer}/500`);
        };
        const l = s.syslog.filter((x) => x.gw === g).slice(-30).map((x) => line(x.text, x.clock));
        return { output: (l.length ? l : [line(tunnelUp(s) ? "IKE SA up · CHILD SA installed" : t.ike === "ESTABLISHED" ? t.child : t.ike, s.clock - 60)]).join("\n") };
      },
    },
    { id: "clr", syntax: "clear security ike security-associations", summary: "Tear the tunnel down; it renegotiates (new SPIs)", run: () => (api.act({ type: "clear" }), { output: "", explanation: "New SAs, new SPIs, counters back to 0." }) },
    { id: "clr2", syntax: "clear security ipsec security-associations", summary: "Clear the IPsec SAs (renegotiated at once)", run: () => (api.act({ type: "clear" }), { output: "" }) },
    { id: "hist", syntax: "show cli history", summary: "The commands you typed in this session", run: () => ({ output: [...(api.history ?? []), "show cli history"].map((x, n) => `${String(n + 1).padStart(4)}  ${x}`).join("\n") }) },
  ];
}
function junosSet(api: VpCliApi, g: VpGw): CliCommandSet {
  const s = api.view;
  const base = { vendor: "juniper" as const, deviceId: g, deviceName: g };
  const op = junosOp(api, g);
  const active = s.cfg.gw[g];
  const rbHist = s.rb?.[g] ?? [];
  const cand = api.cand[g];
  const dirty = JSON.stringify(cand) !== JSON.stringify(active);
  const configure: CliCommand = { id: "conf", syntax: "configure", summary: "Enter configuration mode", run: () => (!dirty && api.setCand({ ...api.cand, [g]: vpClone(active) }), api.setJunosEdit(g, true), { output: dirty ? "Entering configuration mode\nThe configuration has been changed but not committed\n" : "Entering configuration mode\n" }) };
  if (!api.junosEdit[g]) return { ...base, prompt: `admin@${g}> `, commands: [...op, configure] };
  const put = (patch: Partial<VpGwCfg>) => (api.setCand({ ...api.cand, [g]: { ...cand, ...patch } }), { output: "" });
  const other = GW[otherGw(g)].lanNet;
  const doCommit = (quit: boolean): CliResult => {
    if (dirty) {
      const cfg = vpClone(s.cfg);
      cfg.gw[g] = vpClone(cand);
      api.act({ type: "cfg", cfg, text: `${g}: Junos commit`, junosCommit: g });
    }
    if (quit) api.setJunosEdit(g, false);
    return { output: quit ? "commit complete\nExiting configuration mode" : "commit complete", explanation: dirty ? "Active now. Check show security ike / ipsec security-associations, then prove it with traffic." : undefined };
  };
  return {
    ...base,
    prompt: `admin@${g}# `,
    commands: [
      { id: "prop", syntax: "set security ike policy ike-pol proposals <p>", summary: "Which IKE proposal is offered", args: { p: { choices: ["ike-g19", "ike-g14"], describe: (n) => (n === "ike-g19" ? IKE_PROPS["aes256-sha256-g19"].junos : IKE_PROPS["aes128-sha1-g14"].junos), resolve: (raw) => (propOf("juniper", raw) ? raw.toLowerCase() : undefined) } }, run: ({ p }) => put({ ike: propOf("juniper", p)! }) },
      { id: "psk", syntax: "set security ike policy ike-pol pre-shared-key ascii-text <key>", summary: "The shared secret", args: { key: pskArg }, run: ({ key }) => put({ psk: key }) },
      { id: "gw", syntax: "set security ike gateway gw-peer address <ip>", summary: "The peer's public address", args: { ip: ipArg([GW[otherGw(g)].wan]) }, run: ({ ip }) => put({ peer: ip }) },
      { id: "tsl", syntax: "set security ipsec vpn site-vpn traffic-selector ts1 local-ip <cidr>", summary: "Local protected subnet", args: { cidr: cidrArg([GW[g].lanNet]) }, run: ({ cidr }) => put({ local: cidr }) },
      { id: "tsr", syntax: "set security ipsec vpn site-vpn traffic-selector ts1 remote-ip <cidr>", summary: "Remote protected subnet", args: { cidr: cidrArg([other]) }, run: ({ cidr }) => put({ remote: cidr }) },
      { id: "rt", syntax: "set routing-options static route <cidr> next-hop st0.0", summary: "Send the other site's traffic into the tunnel", args: { cidr: cidrArg([other]) }, run: ({ cidr }) => (cidr === other ? put({ steer: true }) : refuse("", `In this lab only the other site's LAN (${other}) is routed into st0.0.`)) },
      { id: "drt", syntax: "delete routing-options static route <cidr>", summary: "Remove that route", args: { cidr: cidrArg([other]) }, run: ({ cidr }) => (cidr === other && cand.steer ? put({ steer: false }) : cidr === "0.0.0.0/0" ? refuse("", "Keep the default route: IKE and ESP leave through it.") : refuse("warning: statement not found")) },
      { id: "show", syntax: "show", summary: "The candidate configuration (try show | compare)", run: () => ({ output: vpJunosText(g, cand) }) },
      { id: "show", syntax: "show security ike", summary: "Candidate IKE configuration", run: () => ({ output: vpJunosText(g, cand, ["security", "ike"]) }) },
      { id: "show", syntax: "show security ipsec", summary: "Candidate IPsec configuration", run: () => ({ output: vpJunosText(g, cand, ["security", "ipsec"]) }) },
      { id: "commit", syntax: "commit", summary: "Activate the candidate configuration", run: () => doCommit(false) },
      { id: "commit", syntax: "commit check", summary: "Check the candidate", run: () => ({ output: "configuration check succeeds" }) },
      { id: "commit", syntax: "commit and-quit", summary: "Commit, then leave configuration mode", run: () => doCommit(true) },
      { id: "rollback", syntax: "rollback", summary: "Discard your uncommitted changes (= rollback 0)", run: () => (api.setCand({ ...api.cand, [g]: vpClone(active) }), { output: "load complete" }) },
      {
        id: "rollback",
        syntax: "rollback <n>",
        summary: "Load an earlier committed configuration into the candidate (then commit)",
        args: { n: { choices: ["0", ...rbHist.map((_, i) => String(i + 1))], describe: (x) => (x === "0" ? "the active configuration" : x === "1" ? "before the last commit" : `before the last ${x} commits`), resolve: (raw) => (/^\d{1,2}$/.test(raw) ? String(+raw) : undefined) } },
        run: ({ n }) => {
          if (n === "0") return (api.setCand({ ...api.cand, [g]: vpClone(active) }), { output: "load complete" });
          const json = rbHist[Number(n) - 1];
          if (!json) return refuse(`error: rollback ${n} does not exist${rbHist.length ? ` (1–${rbHist.length} available)` : " (no commits yet)"}`);
          api.setCand({ ...api.cand, [g]: JSON.parse(json) as VpGwCfg });
          return { output: "load complete", explanation: `The candidate now holds ${g}'s configuration from before the last ${n === "1" ? "commit" : `${n} commits`}. show | compare, then commit to activate it.` };
        },
      },
      ...prefixed(op, "run"),
      {
        id: "exit",
        syntax: "exit",
        summary: "Leave configuration mode",
        run: () => {
          if (!dirty || !api.ask) return (api.setJunosEdit(g, false), { output: "Exiting configuration mode" });
          api.ask({ node: g, prompt: "The configuration has been changed but not committed\nExit with uncommitted changes? [yes,no] (yes) ", answer: (line) => { api.ask?.(undefined); if (/^n(o)?$/i.test(line.trim())) return { output: "" }; api.setJunosEdit(g, false); return { output: "Exiting configuration mode" }; }, cancel: () => (api.ask?.(undefined), "") });
          return { output: "" };
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// INTERNET looking glass and hosts
// ---------------------------------------------------------------------------------------------------------------
function inetSet(vendor: CliVendor): CliCommandSet {
  const ro = refuse("% This is the provider's router: read-only.", "You don't manage the internet. Only the gateways' public addresses (and WEB's network) are routed here.");
  return {
    vendor,
    deviceId: "INTERNET",
    deviceName: "INTERNET",
    prompt: "lg-internet> ",
    commands: [
      { id: "route", syntax: "show ip route", summary: "The internet's routes", run: () => ({ output: ["Codes: C - connected, L - local", "", `C        ${GW["GW-A"].wanNet} is directly connected, GigabitEthernet0/0`, `C        ${GW["GW-B"].wanNet} is directly connected, GigabitEthernet0/1`, `C        ${WEB_NET} is directly connected, GigabitEthernet0/2`].join("\n"), explanation: "No 10.10.10.0/24, no 10.20.20.0/24: the sites' private networks exist only inside ESP between the gateways." }) },
      { id: "conf", syntax: "configure terminal", summary: "", hidden: true, run: () => ro },
      { id: "conf2", syntax: "configure", summary: "", hidden: true, run: () => ro },
    ],
  };
}
function hostSet(api: VpCliApi, h: VpHost): CliCommandSet {
  const name = h.toLowerCase();
  const gw = h === "WEB" ? INET_WEB : GW[h === "HOST-A" ? "GW-A" : "GW-B"].lan;
  const net = h === "WEB" ? WEB_NET : GW[h === "HOST-A" ? "GW-A" : "GW-B"].lanNet;
  const targets = [HOST_IP["HOST-A"], HOST_IP["HOST-B"], HOST_IP.WEB, GW["GW-A"].lan, GW["GW-B"].lan].filter((x) => x !== HOST_IP[h]);
  const ping = (ip: string, n: number): CliResult => {
    const r = api.act({ type: "traffic", sends: [{ from: h, to: ip }] }).last!.results[0];
    return r.replied ? { output: [`PING ${ip} (${ip}) 56(84) bytes of data.`, ...Array.from({ length: n }, (_, i) => `64 bytes from ${ip}: icmp_seq=${i + 1} ttl=${r.encrypted ? 62 : 61} time=${(9.8 + i * 0.4).toFixed(1)} ms`), "", `--- ${ip} ping statistics ---`, `${n} packets transmitted, ${n} received, 0% packet loss`].join("\n"), explanation: r.encrypted ? `Through the tunnel: ${r.path.join(" → ")} (ESP between the gateways).` : `In the clear: ${r.path.join(" → ")}.` } : { output: [`PING ${ip} (${ip}) 56(84) bytes of data.`, "", `--- ${ip} ping statistics ---`, `${n} packets transmitted, 0 received, 100% packet loss`].join("\n"), explanation: r.fail };
  };
  const cmds: CliCommand[] = [
    { id: "addr", syntax: "ip addr", summary: "This host's address", run: () => ({ output: `2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 state UP\n    inet ${HOST_IP[h]}/24 scope global eth0` }) },
    { id: "route", syntax: "ip route", summary: "This host's routes", run: () => ({ output: `default via ${gw} dev eth0\n${net} dev eth0 proto kernel scope link src ${HOST_IP[h]}`, explanation: h === "WEB" ? undefined : "The host knows nothing about the VPN: everything off-link goes to its gateway, which decides." }) },
    { id: "ping", syntax: "ping <ip>", summary: "Ping (4 echo requests)", args: { ip: ipArg(targets) }, run: ({ ip }) => ping(ip, 4) },
    { id: "ping", syntax: "ping -c <count> <ip>", summary: "Ping <count> times", args: { count: { choices: ["1", "3"], resolve: (raw) => (/^\d+$/.test(raw) && +raw >= 1 && +raw <= 10 ? raw : undefined) }, ip: ipArg(targets) }, run: ({ count, ip }) => ping(ip, +count) },
  ];
  return withShellHistory(withSelfPing({ vendor: "cisco", deviceId: h, deviceName: name, prompt: `admin@${name}:~$ `, commands: cmds }, "linux", [HOST_IP[h]]), "linux", api.history);
}
export function vpGwSets(api: VpCliApi, g: VpGw): Partial<Record<CliVendor, CliCommandSet>> {
  return { cisco: withSelfPing(iosSet(api, g), "ios", [GW[g].lan, GW[g].wan]), juniper: withSelfPing(junosSet(api, g), "junos", [GW[g].lan, GW[g].wan]) };
}
export const vpInetSets = (): Partial<Record<CliVendor, CliCommandSet>> => ({ cisco: inetSet("cisco"), juniper: inetSet("juniper") });
export const vpHostSet = hostSet;
export const vpJunosConfig = (api: Pick<VpCliApi, "view">, g: VpGw) => (which: "committed" | number, path: string[]) => (which === "committed" || which === 0 ? vpJunosText(g, api.view.cfg.gw[g], path) : undefined);
