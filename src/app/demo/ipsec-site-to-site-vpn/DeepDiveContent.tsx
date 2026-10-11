import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DNode, DPill, FailureSignatures, FieldTable, FlowSteps, GuideSection, Misconceptions, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { DFieldRow, DTable } from "@/components/lesson/FundamentalsGuideSvg";
import { ExplainIt, KnowledgeQuiz, PracticeBridge, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { CliPair, CliPanel, FailureWalk, pickLines, runGuideCli } from "@/components/lesson/GuideCli";
import type { CliVendor } from "@/lib/cli/types";
import { CHILD_SPIS, EXCHANGE, NOTIFY_TS_UNACCEPTABLE, spiText } from "@/lib/sim-engine/scenarios/ipsecVpn";
import { HOST_IP, createVpNet, vpApply, vpClone, vpTicket, vpTicketState, type VpGw, type VpNet, type VpTicketId } from "@/lib/sim-engine/scenarios/vpnNet";
import { vpGwSets, type VpCliApi } from "./vpn-lab/vpCli";
import { AuthDiagram, DhDiagram, EspDiagram, HeadersDiagram, IncidentDiagram, InitDiagram, RepairDiagram, ReturnDiagram, SasDiagram, SpiSeqDiagram, TopologyDiagram, TsDiagram } from "./LessonGuideContent";

/**
 * IPSEC SITE-TO-SITE VPN DEEP DIVE — the complete study course, taught on the lesson's own GW-A / GW-B tunnel. Every CLI
 * sample is produced by running the VPN Lab's model and its real Cisco/Junos command sets.
 * Progression: Foundation → IKEv2 → ESP → Steering → Operations → Troubleshooting → Beyond → Master it.
 */

function cliApi(s: VpNet): VpCliApi {
  return { view: s, act: () => s, ios: { "GW-A": { kind: "exec" }, "GW-B": { kind: "exec" } }, setIos: () => undefined, junosEdit: { "GW-A": false, "GW-B": false }, setJunosEdit: () => undefined, cand: vpClone(s.cfg.gw), setCand: () => undefined };
}
const cli = (s: VpNet, g: VpGw, vendor: CliVendor, command: string) => runGuideCli(vpGwSets(cliApi(s), g)[vendor]!, command);
/** A ticket's network after its test ran: the state the student investigates. */
const ticketState = (id: VpTicketId) => vpTicket(id).repro.reduce((acc, a) => vpApply(acc, a), vpTicketState(id, 1));
/** The healthy network after GW-A negotiated the tunnel and HOST-A pinged HOST-B once. */
const WARM = [{ type: "ike" } as const, { type: "traffic" as const, sends: [{ from: "HOST-A" as const, to: HOST_IP["HOST-B"] }] }].reduce((acc, a) => vpApply(acc, a), createVpNet());

const AB = spiText(CHILD_SPIS.first.ab);
const BA = spiText(CHILD_SPIS.first.ba);

function HeaderDiagram() {
  const f = (label: string, sub: string, w: number, color = D.violet, strong?: boolean) => ({ label, sub, w, color, strong });
  return (
    <DiagramSvg h={150} label="IKEv2 header: Initiator SPI, Responder SPI, Next Payload, Version, Exchange Type, Flags, Message ID, Length — 28 bytes">
      <DFieldRow x={10} y={20} fields={[f("Initiator SPI", "8 bytes", 124, D.violet, true), f("Responder SPI", "8 bytes", 124, D.violet, true), f("Next", "1", 50), f("Ver", "2.0", 46), f("Exch", "34–37", 60), f("Flags", "I / R", 60), f("Message ID", "4 bytes", 80, D.cyan, true), f("Length", "4", 76)]} />
      <text x={320} y={96} textAnchor="middle" fill={D.text} fontSize={10}>
        The SPI pair names the IKE SA (Responder SPI is 0 in the very first request).
      </text>
      <text x={320} y={114} textAnchor="middle" fill={D.muted} fontSize={10}>
        Message ID counts request/response pairs; a response reuses its request&apos;s ID. Retransmissions keep it.
      </text>
      <text x={320} y={132} textAnchor="middle" fill={D.muted} fontSize={10}>
        Flags: I = sent by the original initiator · R = this is a response.
      </text>
    </DiagramSvg>
  );
}

function ExchangeDiagram() {
  return (
    <DiagramSvg h={170} label="IKEv2 exchange types 34 IKE_SA_INIT, 35 IKE_AUTH, 36 CREATE_CHILD_SA, 37 INFORMATIONAL">
      <DTable
        x={20}
        y={8}
        title="IKEv2 exchanges (RFC 7296)"
        cols={[
          { label: "TYPE", w: 60 },
          { label: "NAME", w: 150 },
          { label: "PROTECTED?", w: 110 },
          { label: "PURPOSE", w: 280 },
        ]}
        rows={[
          [String(EXCHANGE.IKE_SA_INIT), "IKE_SA_INIT", "no (cleartext)", "algorithms · Diffie-Hellman · nonces"],
          [String(EXCHANGE.IKE_AUTH), "IKE_AUTH", "yes (SK)", "identities · AUTH · first CHILD SA"],
          [String(EXCHANGE.CREATE_CHILD_SA), "CREATE_CHILD_SA", "yes (SK)", "new/rekeyed CHILD SA · IKE SA rekey"],
          [String(EXCHANGE.INFORMATIONAL), "INFORMATIONAL", "yes (SK)", "Delete · Notify · liveness checks"],
        ]}
      />
    </DiagramSvg>
  );
}

function ProposalDiagram() {
  return (
    <DiagramSvg h={200} label="SA proposal transforms: IKE SA uses AES-GCM, a PRF and a DH group; ESP uses AES-GCM and ESN; AEAD means no separate integrity transform">
      <DTable
        x={20}
        y={8}
        title="Transforms in this lesson"
        cols={[
          { label: "TRANSFORM TYPE", w: 170 },
          { label: "IKE SA", w: 210 },
          { label: "ESP (CHILD SA)", w: 220 },
        ]}
        rows={[
          ["1 Encryption (ENCR)", "AES-GCM-16, 256-bit", "AES-GCM-16, 256-bit"],
          ["2 PRF", "HMAC-SHA2-256", "—"],
          ["3 Integrity (INTEG)", "none — AEAD", "none — AEAD"],
          ["4 Key exchange (DH)", "group 19 (P-256)", "none (no PFS here)"],
          ["5 ESN", "—", "no ESN"],
        ]}
      />
      <text x={320} y={178} textAnchor="middle" fill={D.muted} fontSize={10}>
        KE carries a DH public value; Ni / Nr are fresh random nonces that feed every key derivation.
      </text>
    </DiagramSvg>
  );
}

function AuthMethodsDiagram() {
  return (
    <DiagramSvg h={180} label="AUTH binds the peer's identity to its own IKE_SA_INIT message and the other side's nonce, keyed by the pre-shared key or signed with a private key">
      <DPill x={110} y={40} text="own IKE_SA_INIT message" color={D.violet} w={190} />
      <DPill x={320} y={40} text="peer's nonce" color={D.cyan} w={120} />
      <DPill x={520} y={40} text="prf(SK_p, own ID)" color={D.warning} w={170} />
      <DArrow x1={150} y1={56} x2={300} y2={104} color={D.line} width={1.5} />
      <DArrow x1={320} y1={56} x2={320} y2={100} color={D.line} width={1.5} />
      <DArrow x1={490} y1={56} x2={340} y2={104} color={D.line} width={1.5} />
      <DNode x={320} y={120} label="AUTH" sub="PSK: prf-based MIC · or a signature" accent={D.success} w={240} />
      <text x={320} y={166} textAnchor="middle" fill={D.muted} fontSize={10}>
        A man in the middle who ran DH with each side would fail here: the AUTH values would not verify.
      </text>
    </DiagramSvg>
  );
}

function ModesDiagram() {
  const f = (label: string, sub: string, w: number, color: string) => ({ label, sub, w, color });
  return (
    <DiagramSvg h={170} label="Tunnel mode wraps the whole original packet under a new IP header; transport mode protects only the payload and keeps the original IP header">
      <text x={20} y={20} fill={D.text} fontSize={10.5} fontWeight={700}>
        Tunnel mode (gateway to gateway — this lesson)
      </text>
      <DFieldRow x={20} y={28} h={36} fields={[f("New IP", "gateways", 110, D.ip), f("ESP", "", 70, D.mpls), f("Original IP", "hosts", 130, D.warning), f("Payload", "", 130, D.warning), f("Trailer+ICV", "", 150, D.mpls)]} />
      <text x={20} y={96} fill={D.text} fontSize={10.5} fontWeight={700}>
        Transport mode (host to host)
      </text>
      <DFieldRow x={20} y={104} h={36} fields={[f("Original IP", "hosts", 130, D.ip), f("ESP", "", 70, D.mpls), f("Payload", "", 240, D.warning), f("Trailer+ICV", "", 150, D.mpls)]} />
      <text x={320} y={162} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Orange = encrypted. Site-to-site VPNs use tunnel mode so private addresses stay hidden and routable only inside.
      </text>
    </DiagramSvg>
  );
}

function ReplayDiagram() {
  const cells = Array.from({ length: 12 }, (_, i) => i + 5);
  return (
    <DiagramSvg h={170} label="Anti-replay window: sequence numbers already received are marked; a duplicate or a number left of the window is rejected, a new higher number slides the window">
      {cells.map((n, i) => {
        const got = [6, 7, 9, 10, 12, 13, 14, 16].includes(n);
        return (
          <g key={n}>
            <rect x={60 + i * 44} y={30} width={40} height={30} rx={4} fill={got ? D.success : D.box} fillOpacity={got ? 0.25 : 1} stroke={got ? D.success : D.line} />
            <text x={80 + i * 44} y={50} textAnchor="middle" fill={D.text} fontSize={10} fontFamily="monospace">
              {n}
            </text>
          </g>
        );
      })}
      <text x={320} y={20} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        receiver&apos;s window (highest accepted = 16) · green = already received
      </text>
      <DPill x={130} y={98} text="seq 3 → too old: drop" color={D.danger} w={170} />
      <DPill x={320} y={98} text="seq 12 again → replay: drop" color={D.danger} w={190} />
      <DPill x={520} y={98} text="seq 11 → gap, new: accept" color={D.success} w={180} />
      <text x={320} y={140} textAnchor="middle" fill={D.text} fontSize={10}>
        Checked AFTER the integrity check passes, so a forged number can&apos;t move the window.
      </text>
      <text x={320} y={158} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Sequence numbers are visible on the wire and give no confidentiality.
      </text>
    </DiagramSvg>
  );
}

function PfsRekeyDiagram() {
  return (
    <DiagramSvg h={190} label="Rekeying: a new CHILD SA is created with CREATE_CHILD_SA before the old one expires; with PFS a new Diffie-Hellman exchange is included">
      <text x={20} y={24} fill={D.text} fontSize={10.5} fontWeight={700}>
        CHILD SA rekey over time
      </text>
      <rect x={40} y={38} width={330} height={22} rx={6} fill={D.success} fillOpacity={0.2} stroke={D.success} />
      <text x={205} y={53} textAnchor="middle" fill={D.text} fontSize={9.5}>
        old CHILD SA (SPIs X / Y)
      </text>
      <rect x={300} y={70} width={300} height={22} rx={6} fill={D.cyan} fillOpacity={0.2} stroke={D.cyan} />
      <text x={450} y={85} textAnchor="middle" fill={D.text} fontSize={9.5}>
        new CHILD SA (new SPIs)
      </text>
      <DArrow x1={300} y1={112} x2={300} y2={96} color={D.violet} width={1.5} />
      <text x={300} y={124} textAnchor="middle" fill={D.violet} fontSize={9}>
        CREATE_CHILD_SA (36)
      </text>
      <DArrow x1={370} y1={112} x2={370} y2={64} color={D.danger} width={1.5} />
      <text x={400} y={124} textAnchor="start" fill={D.danger} fontSize={9}>
        INFORMATIONAL Delete (37)
      </text>
      <text x={320} y={158} textAnchor="middle" fill={D.text} fontSize={10}>
        Without PFS the new keys come from SK_d + fresh nonces. With PFS (a KE payload in CREATE_CHILD_SA)
      </text>
      <text x={320} y={176} textAnchor="middle" fill={D.text} fontSize={10}>
        they also include a new DH secret, so a later leak of SK_d does not expose past traffic.
      </text>
    </DiagramSvg>
  );
}

function NattDiagram() {
  const f = (label: string, sub: string, w: number, color: string, strong?: boolean) => ({ label, sub, w, color, strong });
  return (
    <DiagramSvg h={170} label="NAT traversal: when a NAT is detected, IKE moves to UDP 4500 and ESP is carried inside UDP 4500 with a non-ESP marker for IKE">
      <DNode x={80} y={40} label="GW" accent={D.cyan} w={80} />
      <DNode x={320} y={40} label="NAT" sub="rewrites IP/ports" accent={D.warning} w={130} />
      <DNode x={560} y={40} label="peer GW" accent={D.violet} w={90} />
      <DArrow x1={122} y1={40} x2={254} y2={40} color={D.cyan} />
      <DArrow x1={386} y1={40} x2={514} y2={40} color={D.cyan} />
      <text x={20} y={96} fill={D.text} fontSize={10.5} fontWeight={700}>
        ESP with NAT-T (not used in this lesson&apos;s main flow)
      </text>
      <DFieldRow x={20} y={104} h={36} fields={[f("IPv4", "proto 17", 110, D.ip), f("UDP", "4500 → 4500", 120, D.warning, true), f("ESP", "SPI · seq", 110, D.mpls), f("encrypted…", "", 170, D.mpls), f("ICV", "", 90, D.mpls)]} />
      <text x={320} y={160} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        NAT_DETECTION payloads in IKE_SA_INIT reveal a NAT; plain ESP (protocol 50) has no ports for a NAT to track.
      </text>
    </DiagramSvg>
  );
}

function ImplDiagram() {
  return (
    <DiagramSvg h={190} label="Policy-based VPNs match traffic by selectors directly; route-based VPNs route traffic into a tunnel interface and usually negotiate broad selectors">
      <text x={160} y={22} textAnchor="middle" fill={D.cyan} fontSize={11} fontWeight={700}>
        Policy-based
      </text>
      <DPill x={160} y={56} text="packet 10.10.10.10 → 10.20.20.20" color={D.muted} w={250} />
      <DArrow x1={160} y1={70} x2={160} y2={92} color={D.line} width={1.5} />
      <DPill x={160} y={106} text="matches selector pair? → CHILD SA" color={D.cyan} w={250} />
      <text x={160} y={146} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        one CHILD SA per protected subnet pair
      </text>
      <line x1={320} y1={12} x2={320} y2={176} stroke={D.line} strokeDasharray="3 4" />
      <text x={480} y={22} textAnchor="middle" fill={D.violet} fontSize={11} fontWeight={700}>
        Route-based
      </text>
      <DPill x={480} y={56} text="route 10.20.20.0/24 → tunnel interface" color={D.muted} w={260} />
      <DArrow x1={480} y1={70} x2={480} y2={92} color={D.line} width={1.5} />
      <DPill x={480} y={106} text="everything into it uses the CHILD SA" color={D.violet} w={250} />
      <text x={480} y={146} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        selectors often 0.0.0.0/0 ↔ 0.0.0.0/0; routing decides
      </text>
      <text x={320} y={184} textAnchor="middle" fill={D.faint} fontSize={9.5}>
        Same IKEv2 and ESP underneath. Vendor terms like &quot;proxy ID&quot; or &quot;encryption domain&quot; = traffic selectors.
      </text>
    </DiagramSvg>
  );
}

/** What a healthy tunnel looks like, read from both gateways — the state every later section refers to. */
function NormalState() {
  const ipsec = cli(WARM, "GW-A", "cisco", "show crypto ipsec sa");
  const map = cli(WARM, "GW-A", "cisco", "show crypto map");
  const rt = cli(WARM, "GW-A", "juniper", "show route");
  return (
    <div className="space-y-5">
      <p>
        Before anything breaks, learn what a healthy tunnel looks like. This is the lab&apos;s two sites after GW-A has negotiated the tunnel and HOST-A has pinged HOST-B once. Below are the verification questions, asked on the real gateways, with the state described above in the answers. Every output is exactly what the VPN Lab prints, and in the five faults below you will compare broken output with it.
      </p>
      <div className="space-y-2">
        <h4 className="text-sm font-bold text-pv-text">1 · Is the IKE SA up?</h4>
        <CliPair cisco={cli(WARM, "GW-A", "cisco", "show crypto ikev2 sa")} junos={cli(WARM, "GW-A", "juniper", "show security ike security-associations")} ciscoCaption="GW-A · Cisco IOS" junosCaption="GW-A · Junos" />
        <p className="text-sm text-pv-text-muted">
          One IKE SA between the two public addresses, 198.51.100.10 and 203.0.113.10, in state <Mono>READY</Mono> (Junos <Mono>UP</Mono>): the gateways agreed keys (AES-GCM-256, DH group 19) and authenticated each other with the pre-shared key.
        </p>
      </div>
      <div className="space-y-2">
        <h4 className="text-sm font-bold text-pv-text">2 · Is a CHILD SA installed for the right traffic, and is it used?</h4>
        <CliPanel run={{ ...ipsec, output: pickLines(ipsec.output, /ident|pkts|spi:|current outbound/) }} />
        <CliPanel run={cli(WARM, "GW-B", "juniper", "show security ipsec security-associations")} />
        <p className="text-sm text-pv-text-muted">
          The protected traffic is 10.10.10.0/24 ↔ 10.20.20.0/24 (the traffic selectors). There are two one-way SAs, each with the SPI its <em>receiver</em> chose: GW-A sends with <Mono>0xa2b3c4d5</Mono>, which GW-B lists as its inbound (<Mono>&lt;</Mono>) SA, and receives with <Mono>0xb2c3d4e5</Mono>. The encaps and decaps counters moved with the ping, so traffic really crosses the tunnel.
        </p>
      </div>
      <div className="space-y-2">
        <h4 className="text-sm font-bold text-pv-text">3 · Is Site B&apos;s traffic steered into the tunnel?</h4>
        <CliPanel run={{ ...map, output: pickLines(map.output, /Crypto Map|Peer =|access-list|Interfaces using|GigabitEthernet/) }} />
        <CliPanel run={{ ...rt, output: pickLines(rt.output, /inet\.0|10\.20\.20\.0|st0/) }} />
        <p className="text-sm text-pv-text-muted">
          Cisco steers with a crypto map applied on the WAN interface: packets matching the crypto ACL are encrypted. Junos is route-based: Site B&apos;s subnet is routed into the tunnel interface <Mono>st0.0</Mono>. Everything else, such as browsing to WEB, leaves normally with source NAT (split tunneling).
        </p>
      </div>
      <Callout tone="success" title="And the traffic proves it" icon="✓">
        HOST-A pings HOST-B and the reply comes back. A capture on the internet shows only ESP (IP protocol 50) between 198.51.100.10 and 203.0.113.10: the private addresses never appear outside, and the content is encrypted.
      </Callout>
    </div>
  );
}

/** The five faults the lab can break, each walked from normal state through evidence and repair to proof. */
function FaultWalks() {
  const psk = ticketState("psk");
  const prop = ticketState("proposal");
  const ts = ticketState("ts");
  const steer = ticketState("steer");
  const peer = ticketState("peer");
  const tsIpsec = cli(ts, "GW-A", "cisco", "show crypto ipsec sa");
  const tsCfg = cli(ts, "GW-B", "juniper", "show configuration security ipsec");
  const stIpsec = cli(steer, "GW-A", "cisco", "show crypto ipsec sa");
  const stMap = cli(steer, "GW-A", "cisco", "show crypto map");
  const prCfg = cli(prop, "GW-B", "juniper", "show configuration security ike");
  return (
    <div className="space-y-4">
      <p>These are the five faults of the lab&apos;s tickets. Each one starts from the healthy evidence above and changes one thing. Read the evidence first and compare it with the healthy output, because the difference is the clue. Find the first layer that failed. Then see how the investigation questions lead to the cause, how to repair it on both vendors, and what proves the repair.</p>
      <FailureWalk
        title="1 · The pre-shared keys don't match"
        normal={<>Both gateways use the same pre-shared key, so each one&apos;s AUTH value verifies at the other end.</>}
        change={<>GW-B is replaced and configured with a different key.</>}
        evidence={
          <>
            <p>The tunnel never comes up, and both gateways reach each other&apos;s public address. IKE_SA_INIT succeeds (keys are agreed), then IKE_AUTH fails, and both logs say so:</p>
            <CliPanel run={cli(psk, "GW-A", "cisco", "show logging")} />
            <CliPanel run={cli(psk, "GW-B", "juniper", "show log messages")} />
          </>
        }
        next={<>&quot;IKE starts, then stops&quot; is the signature of the second exchange failing. AUTHENTICATION_FAILED points at the pre-shared key (or the identities) on both gateways: compare them.</>}
        fix={<>On GW-B, the shared key: Cisco <Mono>crypto ikev2 keyring KR</Mono>, <Mono>peer SITE-A</Mono>, <Mono>pre-shared-key Lab-Key-2026</Mono> · Junos <Mono>set security ike policy ike-pol pre-shared-key ascii-text Lab-Key-2026</Mono>, then <Mono>commit</Mono>.</>}
        proof={<>The IKE SA is READY / UP, a CHILD SA is installed, and HOST-A&apos;s ping to HOST-B comes back with the ESP counters moving.</>}
      />
      <FailureWalk
        title="2 · The IKE proposals don't overlap"
        normal={<>Both gateways offer the same IKE proposal: AES-GCM-256 with DH group 19.</>}
        change={<>A &quot;hardening&quot; on GW-B replaces its IKE proposal with AES-CBC-128, SHA-1, group 14. The two gateways now have nothing in common.</>}
        evidence={
          <>
            <p>The very first IKE message is rejected: GW-B answers IKE_SA_INIT with NO_PROPOSAL_CHOSEN, and GW-B&apos;s policy names the other proposal:</p>
            <CliPanel run={cli(prop, "GW-A", "cisco", "show logging")} />
            <CliPanel run={{ ...prCfg, output: pickLines(prCfg.output, /^policy ike-pol|^ {4}proposals ike/) }} note={<>GW-B&apos;s IKE policy now offers only ike-g14 (AES-CBC-128, SHA-1, group 14); GW-A offers ike-g19.</>} />
          </>
        }
        next={<>A failure in the first exchange, with an answer: compare the IKE proposals on both gateways (<Mono>show crypto ikev2 proposal</Mono> · <Mono>show configuration security ike</Mono>). At least one transform set must match exactly.</>}
        fix={<>On GW-B, the common proposal back: Cisco <Mono>crypto ikev2 policy POL-1</Mono>, <Mono>proposal PROP-G19</Mono> · Junos <Mono>set security ike policy ike-pol proposals ike-g19</Mono>, then <Mono>commit</Mono>.</>}
        proof={<>IKE_SA_INIT is accepted, the IKE SA is READY / UP, and HOST-A reaches HOST-B.</>}
      />
      <FailureWalk
        title="3 · The traffic selectors don't mirror each other"
        normal={<>GW-A protects 10.10.10.0/24 → 10.20.20.0/24, and GW-B the mirror, 10.20.20.0/24 → 10.10.10.0/24.</>}
        change={<>During a migration, GW-B&apos;s remote subnet becomes 10.10.20.0/24. GW-A&apos;s proposal no longer fits GW-B&apos;s policy.</>}
        evidence={
          <>
            <p>Monitoring says the peer is up, and no host packet passes. The IKE SA is READY, but no CHILD SA was installed: no SPIs, counters at zero, and the log names the reason:</p>
            <CliPanel run={{ ...tsIpsec, output: pickLines(tsIpsec.output, /ident|pkts|current outbound/) }} />
            <CliPanel run={cli(ts, "GW-A", "cisco", "show logging")} />
            <CliPanel run={{ ...tsCfg, output: pickLines(tsCfg.output, /traffic-selector|local-ip|remote-ip/) }} />
            <DiagramFrame caption="The IKE SA is up, but the CHILD SA's selectors don't match.">
              <IncidentDiagram />
            </DiagramFrame>
          </>
        }
        next={<>IKE up and nothing passes: look at the CHILD SA. TS_UNACCEPTABLE means the protected subnets don&apos;t mirror each other. One side&apos;s local must be the other side&apos;s remote (Cisco: the crypto ACL · Junos: traffic-selector).</>}
        fix={<>On GW-B, the remote subnet back to Site A. Junos <Mono>set security ipsec vpn site-vpn traffic-selector ts1 remote-ip 10.10.10.0/24</Mono>, then <Mono>commit</Mono> · Cisco <Mono>ip access-list extended VPN-TRAFFIC</Mono>, <Mono>permit ip 10.20.20.0 0.0.0.255 10.10.10.0 0.0.0.255</Mono>. In the lab the new permit replaces the single entry; on a real router you would also remove the old line with <Mono>no permit</Mono>.</>}
        proof={
          <>
            <p>A CHILD SA is installed with both SPIs, and HOST-A&apos;s ping to HOST-B comes back with encaps and decaps climbing.</p>
            <DiagramFrame caption="Selectors mirrored: the CHILD SA is installed and ESP flows.">
              <RepairDiagram />
            </DiagramFrame>
          </>
        }
      />
      <FailureWalk
        title="4 · The traffic isn't steered into the tunnel"
        normal={<>GW-A sends Site B&apos;s traffic into IPsec: the crypto map is applied on its WAN interface (Junos: a route to st0.0).</>}
        change={<>The crypto map is removed from GW-A&apos;s WAN interface (Junos: the route to st0.0 is deleted).</>}
        evidence={
          <>
            <p>The SAs are up on both sides, yet HOST-A can&apos;t ping HOST-B and the ESP counters never move, while browsing the internet works. The packet leaves in the clear, NATed, and the internet drops a private destination:</p>
            <CliPanel run={{ ...stIpsec, output: pickLines(stIpsec.output, /pkts/) }} />
            <CliPanel run={{ ...stMap, output: pickLines(stMap.output, /Crypto Map|Interfaces using/) }} note={<>&quot;Interfaces using crypto map VPN&quot; lists nothing.</>} />
            <CliPanel run={cli(steer, "GW-A", "juniper", "show route")} note={<>No route for 10.20.20.0/24 via st0.0: Site B&apos;s traffic follows the default route to the internet.</>} />
          </>
        }
        next={<>SAs up, counters at zero: the gateway isn&apos;t sending the traffic into IPsec. Check the steering: <Mono>show crypto map</Mono> (Interfaces using crypto map) · <Mono>show route</Mono> (… via st0.0).</>}
        fix={<>On GW-A: Cisco <Mono>interface GigabitEthernet0/1</Mono>, <Mono>crypto map VPN</Mono> · Junos <Mono>set routing-options static route 10.20.20.0/24 next-hop st0.0</Mono>, then <Mono>commit</Mono>.</>}
        proof={<>HOST-A pings HOST-B and encaps and decaps climb on both gateways; browsing to WEB still leaves outside the tunnel.</>}
      />
      <FailureWalk
        title="5 · IKE goes to the wrong peer"
        normal={<>GW-A sends IKE_SA_INIT to GW-B&apos;s public address, 203.0.113.10.</>}
        change={<>An address change on GW-A sets the peer to 203.0.113.11, an address nobody answers on.</>}
        evidence={
          <>
            <p>The tunnel stays down, and GW-A keeps sending IKE_SA_INIT without ever hearing back, while the internet works from both sites. No answer at all means the messages go nowhere, and the crypto map shows where:</p>
            <CliPanel run={cli(peer, "GW-A", "cisco", "show logging")} />
            <CliPanel run={{ ...cli(peer, "GW-A", "cisco", "show crypto map"), output: pickLines(cli(peer, "GW-A", "cisco", "show crypto map").output, /Peer =|Current peer/) }} />
          </>
        }
        next={<>No answer to IKE_SA_INIT (retransmissions, then give up): check the peer address in both directions, and that the peer&apos;s internet link is up. A rejection would at least mean the peer answered.</>}
        fix={<>On GW-A, the right peer: Cisco <Mono>crypto map VPN 10 ipsec-isakmp</Mono>, <Mono>set peer 203.0.113.10</Mono> · Junos <Mono>set security ike gateway gw-peer address 203.0.113.10</Mono>, then <Mono>commit</Mono>.</>}
        proof={<>IKE_SA_INIT gets an answer, both SAs come up, and HOST-A reaches HOST-B through the tunnel.</>}
      />
    </div>
  );
}

function LabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the VPN Lab" onPractice={openLab}>
      Same sites and addresses, both gateways yours. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

const G = { foundation: "Foundation", ike: "IKEv2: building the tunnel", esp: "ESP: using the tunnel", steer: "Steering", ops: "Operations", trouble: "Troubleshooting", beyond: "Beyond this lesson", master: "Master it" };

export const VPN_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "vpd-why", label: "Why a site-to-site VPN exists", group: G.foundation },
  { id: "vpd-idea", label: "Two jobs: IKE, then ESP", group: G.foundation },
  { id: "vpd-header", label: "The IKEv2 header and exchanges", group: G.ike },
  { id: "vpd-init", label: "IKE_SA_INIT: keys, not trust", group: G.ike },
  { id: "vpd-auth", label: "IKE_AUTH: who are you?", group: G.ike },
  { id: "vpd-child", label: "The CHILD SA and selectors", group: G.ike },
  { id: "vpd-esp", label: "ESP tunnel mode", group: G.esp },
  { id: "vpd-spi", label: "SPIs, sequence numbers, anti-replay", group: G.esp },
  { id: "vpd-return", label: "The reply's own SA", group: G.esp },
  { id: "vpd-pfs", label: "Rekeying and PFS", group: G.esp },
  { id: "vpd-steer", label: "Policy-based vs route-based", group: G.steer },
  { id: "vpd-split", label: "Split tunneling", group: G.steer },
  { id: "vpd-state", label: "The state the gateways keep", group: G.ops },
  { id: "vpd-verify", label: "How to verify: layer by layer", group: G.ops },
  { id: "vpd-normal", label: "What healthy looks like", group: G.ops },
  { id: "vpd-signatures", label: "Failure signatures", group: G.trouble },
  { id: "vpd-layers", label: "Symptom → layer", group: G.trouble },
  { id: "vpd-workflow", label: "Investigation workflow", group: G.trouble },
  { id: "vpd-faults", label: "Five faults, evidence to proof", group: G.trouble },
  { id: "vpd-prove", label: "Prove the repair", group: G.trouble },
  { id: "vpd-natt", label: "NAT traversal", group: G.beyond },
  { id: "vpd-myths", label: "Common misconceptions", group: G.master },
  { id: "vpd-quiz", label: "Knowledge check", group: G.master },
  { id: "vpd-explain", label: "Can you explain it?", group: G.master },
  { id: "vpd-practice", label: "Practice in the VPN Lab", group: G.master },
];

const QUIZ: KnowledgeQuestion[] = [
  {
    id: "q-init",
    prompt: "After IKE_SA_INIT, what do GW-A and GW-B have?",
    options: [
      { id: "a", label: "Shared keys, but no proof of who the other is" },
      { id: "b", label: "Authenticated identities and a CHILD SA" },
      { id: "c", label: "ESP traffic flowing" },
      { id: "d", label: "Nothing until IKE_AUTH completes" },
    ],
    correctId: "a",
    explanation: "IKE_SA_INIT agrees algorithms and runs Diffie-Hellman: both derive the same keys. Identity is proven only in IKE_AUTH, inside the encrypted SK payload.",
  },
  {
    id: "q-auth",
    prompt: "IKE_SA_INIT completes, then IKE_AUTH fails with AUTHENTICATION_FAILED. What is the classic cause?",
    options: [
      { id: "a", label: "Wrong peer address" },
      { id: "b", label: "No common proposal" },
      { id: "c", label: "Different pre-shared keys (or identities)" },
      { id: "d", label: "Mismatched traffic selectors" },
    ],
    correctId: "c",
    explanation: "A wrong peer gets no answer, a proposal mismatch fails at the first message, and selectors fail later at the CHILD SA. \"IKE starts, then stops\" with AUTHENTICATION_FAILED points at the key.",
  },
  {
    id: "q-spi",
    prompt: `In the lab, packets from GW-A to GW-B carry SPI ${WARM.sa.ab}. Who chose that SPI?`,
    options: [
      { id: "a", label: "GW-A, the sender" },
      { id: "b", label: "GW-B, the receiver, so it can find the right keys" },
      { id: "c", label: "Both, by negotiation of one shared value" },
      { id: "d", label: "The initiator, for both directions" },
    ],
    correctId: "b",
    explanation: "Each one-way SA is identified by the SPI its receiver picked. GW-B lists the GW-A → GW-B SA as inbound; the reverse direction has its own SPI chosen by GW-A.",
  },
  {
    id: "q-ts",
    prompt: "The IKE SA is up, no host packet passes, and the log says TS_UNACCEPTABLE. Where is the fault?",
    options: [
      { id: "a", label: "The pre-shared key" },
      { id: "b", label: "The traffic selectors: one side's local subnet isn't the other side's remote" },
      { id: "c", label: "The internet path between the gateways" },
      { id: "d", label: "The DH group" },
    ],
    correctId: "b",
    explanation: "The IKE SA proves the peer is reachable and authenticated. The CHILD SA failed because the protected subnets don't mirror each other.",
  },
  {
    id: "q-steer",
    prompt: "Both SAs are up, HOST-A can't ping HOST-B, and the encaps counter stays at 0 while browsing works. What is missing?",
    options: [
      { id: "a", label: "A CHILD SA" },
      { id: "b", label: "Steering: the crypto map on the WAN interface (Cisco) or the route via st0.0 (Junos)" },
      { id: "c", label: "The pre-shared key" },
      { id: "d", label: "A NAT-T port" },
    ],
    correctId: "b",
    explanation: "The tunnel exists, but the gateway isn't sending Site B's traffic into it. The packet leaves in the clear with source NAT, and the internet drops the private destination.",
  },
  {
    id: "q-outer",
    prompt: "A capture on the internet between the gateways shows HOST-A's ping. What does it see?",
    options: [
      { id: "a", label: "10.10.10.10 → 10.20.20.20, ICMP" },
      { id: "b", label: "198.51.100.10 → 203.0.113.10, IP protocol 50 (ESP), encrypted payload" },
      { id: "c", label: "UDP 500 packets" },
      { id: "d", label: "Nothing" },
    ],
    correctId: "b",
    explanation: "In tunnel mode the whole original packet is encrypted inside ESP, and the outer header carries the gateways' public addresses. The private addresses never appear outside.",
  },
];

export function VpnDeepDiveContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="vpd-why" eyebrow="Foundation" title="Why a site-to-site VPN exists" tone="cyan">
        <p>
          Site A uses 10.10.10.0/24 (HOST-A is 10.10.10.10) and Site B 10.20.20.0/24 (HOST-B is 10.20.20.20). Between them there is only the public internet. HOST-A&apos;s packet to 10.20.20.20 follows GW-A&apos;s default route to the internet, where two things go wrong:
        </p>
        <FlowSteps
          steps={[
            { title: "Private addresses don't travel", body: "No internet router has a route to 10.20.20.0/24. The packet is dropped, or, after source NAT, it goes to a private address that doesn't exist on the internet.", tone: "danger" },
            { title: "Anyone on the path can read and change it", body: "Even if it arrived, every router between the sites could see the content, and nothing would prove that the packet really came from Site A.", tone: "warning" },
          ]}
        />
        <DiagramFrame caption="Private sites, public gateway addresses.">
          <TopologyDiagram />
        </DiagramFrame>
        <p>A <strong>site-to-site IPsec VPN</strong> carries Site A ↔ Site B traffic between the gateways&apos; public addresses (198.51.100.10 and 203.0.113.10), encrypted and authenticated, while the hosts change nothing.</p>
      </GuideSection>

      <GuideSection id="vpd-idea" eyebrow="Foundation" title="Two jobs: IKE builds the tunnel, ESP uses it" tone="cyan">
        <p>The gateways do two separate jobs. First they talk with <strong>IKEv2</strong> (the control plane): agree algorithms and keys, prove who they are, agree which traffic to protect. Then <strong>ESP</strong> (the data plane) carries each protected host packet, encrypted, inside a new outer header between the gateways.</p>
        <FlowSteps
          steps={[
            { title: "IKE_SA_INIT", body: "Algorithms, Diffie-Hellman values and nonces, in the clear. The result is keys, not trust.", tone: "violet" },
            { title: "IKE_AUTH", body: "Identities and AUTH, encrypted with the new keys. It also creates the first CHILD SA.", tone: "warning" },
            { title: "ESP", body: "Host packets encrypted in tunnel mode, one SA per direction.", tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="vpd-header" eyebrow="IKEv2: building the tunnel" title="The IKEv2 header and its exchanges" tone="violet">
        <p>Every IKE message (UDP 500) starts with a 28-byte header: the initiator&apos;s and responder&apos;s IKE SPIs name the IKE SA, the exchange type says what this message is, and the Message ID pairs each request with its response.</p>
        <DiagramFrame caption="28 bytes in front of every IKE message.">
          <HeaderDiagram />
        </DiagramFrame>
        <DiagramFrame caption="Only the first one is readable on the wire.">
          <ExchangeDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="vpd-init" eyebrow="IKEv2: building the tunnel" title="IKE_SA_INIT: keys, not trust" tone="violet">
        <p>
          GW-A, the initiator, sends its proposal, its Diffie-Hellman public value and a nonce to its configured peer. GW-B picks a proposal it shares and answers with its own values. From the two public values each gateway computes the same shared secret, which never crosses the wire; every key for the rest of the tunnel is derived from it. No NAT sits between these gateways, so the exchange stays on UDP 500.
        </p>
        <DiagramFrame caption="Message ID 0, in the clear.">
          <InitDiagram />
        </DiagramFrame>
        <DiagramFrame caption="Public values cross the wire; the shared secret never does.">
          <DhDiagram />
        </DiagramFrame>
        <DiagramFrame caption="The initiator offers; the responder picks exactly one proposal.">
          <ProposalDiagram />
        </DiagramFrame>
        <p>If the two sides share no acceptable proposal, the responder answers NO_PROPOSAL_CHOSEN, at the very first message. That is a different failure from TS_UNACCEPTABLE ({NOTIFY_TS_UNACCEPTABLE}), which is about selectors, not algorithms.</p>
      </GuideSection>

      <GuideSection id="vpd-auth" eyebrow="IKEv2: building the tunnel" title="IKE_AUTH: who are you?" tone="warning">
        <p>Now everything is encrypted inside the SK payload. Each gateway sends its identity and an AUTH value, and checks the other&apos;s. Only now does each gateway know who is on the other side.</p>
        <DiagramFrame caption="Everything after the IKE header is ciphertext on the wire.">
          <AuthDiagram />
        </DiagramFrame>
        <Callout tone="warning" title="Teaching view, not wire view">
          The lesson&apos;s inspector labels these payloads &quot;decrypted teaching view&quot;. An observer sees only the IKE header and an encrypted SK payload.
        </Callout>
        <DiagramFrame caption="Pre-shared key or certificate signature, same idea.">
          <AuthMethodsDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "Pre-shared key", tone: "warning", tag: "simple", points: ["Both gateways configured with the same secret", "AUTH is a MAC keyed from it", "Key never sent; rotate it like a password"] },
            { title: "Certificates", tone: "violet", tag: "scalable", points: ["Each gateway signs with its private key", "Peer validates the certificate chain", "No shared secret to distribute"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="vpd-child" eyebrow="IKEv2: building the tunnel" title="The CHILD SA and traffic selectors" tone="success">
        <p>
          The initiator proposes <strong>traffic selectors</strong>: TSi for its own side (10.10.10.0/24) and TSr for the responder&apos;s side (10.20.20.0/24). The responder accepts only if they fit its own policy, the mirror image. Then two one-way ESP SAs are installed: the CHILD SA.
        </p>
        <DiagramFrame caption="TSi describes the initiator's side, TSr the responder's.">
          <TsDiagram />
        </DiagramFrame>
        <DiagramFrame caption="Control SA on top, a pair of one-way data SAs below.">
          <SasDiagram />
        </DiagramFrame>
        <p>The IKE SA is not &quot;the tunnel&quot;. Host packets travel in ESP under a CHILD SA, which IKE creates, rekeys and deletes. That is why the IKE SA can be up while no host packet passes. A responder may also accept a broader selector than proposed (for example 10.10.0.0/16 covering 10.10.10.0/24).</p>
      </GuideSection>

      <GuideSection id="vpd-esp" eyebrow="ESP: using the tunnel" title="ESP tunnel mode" tone="mpls">
        <p>In tunnel mode the whole original packet is encrypted and authenticated (AES-GCM). A new outer header carries the gateways&apos; public addresses and IP protocol 50; the ESP header carries the receiver&apos;s SPI and the next sequence number.</p>
        <DiagramFrame caption="IP protocol 50, AES-GCM, Next Header 4.">
          <EspDiagram />
        </DiagramFrame>
        <DiagramFrame caption="Two IPv4 headers, two different jobs.">
          <HeadersDiagram />
        </DiagramFrame>
        <DiagramFrame caption="Where the new header goes, and what is encrypted.">
          <ModesDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="vpd-spi" eyebrow="ESP: using the tunnel" title="SPIs, sequence numbers and anti-replay" tone="violet">
        <p>Each SPI is chosen by the gateway that <em>receives</em> on it. In the guided lesson, packets to GW-B carry <Mono>{AB}</Mono> and packets to GW-A carry <Mono>{BA}</Mono>. The lab&apos;s first CHILD SA negotiates its own values, <Mono>{WARM.sa.ab}</Mono> and <Mono>{WARM.sa.ba}</Mono>, which you will see in the device output below: every negotiation picks new SPIs. Each SA counts its own sequence numbers, which let the receiver reject replays; they don&apos;t encrypt anything.</p>
        <DiagramFrame caption="The receiver chooses the SPI; each SA counts on its own.">
          <SpiSeqDiagram />
        </DiagramFrame>
        <DiagramFrame caption="Duplicates and stale packets are rejected even if they decrypt.">
          <ReplayDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="vpd-return" eyebrow="ESP: using the tunnel" title="The reply's own SA" tone="tcp">
        <p>The reply takes the other one-way SA: GW-B encrypts it with GW-A&apos;s SPI and its own sequence counter, and GW-A decrypts it.</p>
        <DiagramFrame caption="Encrypt at GW-B, decrypt at GW-A.">
          <ReturnDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="vpd-pfs" eyebrow="ESP: using the tunnel" title="Rekeying and PFS" tone="cyan">
        <DiagramFrame caption="Make before break: the new CHILD SA exists before the old one is deleted.">
          <PfsRekeyDiagram />
        </DiagramFrame>
        <p>Every new CHILD SA gets new SPIs, and its sequence numbers restart at 1. That is how you recognise a renegotiation in the evidence, for example after a peer outage.</p>
      </GuideSection>

      <GuideSection id="vpd-steer" eyebrow="Steering" title="Policy-based vs route-based" tone="ip">
        <p>A gateway only encrypts what it sends into IPsec. How it decides is called <strong>steering</strong>, and the two vendors in the lab do it differently:</p>
        <FlowSteps
          steps={[
            { title: "Cisco IOS: crypto map (policy-based)", body: <>The crypto map <Mono>VPN</Mono> is applied on the WAN interface GigabitEthernet0/1. Packets leaving that interface that match the crypto ACL <Mono>VPN-TRAFFIC</Mono> are encrypted. The ACL is also what IOS proposes as traffic selectors.</>, tone: "cyan" },
            { title: "Junos: route-based (st0.0)", body: <>Site B&apos;s subnet is routed to the tunnel interface <Mono>st0.0</Mono>, which is bound to the VPN. Whatever is routed into st0.0 is encrypted. The selectors come from <Mono>traffic-selector</Mono>.</>, tone: "violet" },
          ]}
        />
        <DiagramFrame caption="Two ways to decide which packets enter the tunnel.">
          <ImplDiagram />
        </DiagramFrame>
        <Callout tone="cyan" title="Selectors still matter with route-based VPNs">
          If one side proposes narrow selectors and the other only accepts different ones, the CHILD SA fails the same way, TS_UNACCEPTABLE, whatever the platform calls them.
        </Callout>
      </GuideSection>

      <GuideSection id="vpd-split" eyebrow="Steering" title="Split tunneling" tone="warning">
        <p>HOST-A browsing to WEB (192.0.2.80) doesn&apos;t match the selectors, so GW-A sends it out normally with source NAT. Only site-to-site traffic is encrypted. A capture on the internet shows ESP between the gateways and ordinary NATed traffic to WEB side by side.</p>
      </GuideSection>

      <GuideSection id="vpd-state" eyebrow="Operations" title="The state the gateways keep" tone="cyan">
        <FlowSteps
          steps={[
            { title: "The IKE SA", body: "One per peer pair: the control channel, with its agreed proposal and the peer's address. Cisco READY · Junos UP.", tone: "violet" },
            { title: "The CHILD SA: two one-way IPsec SAs", body: "One per direction, each with its SPI, its keys, a sequence counter, and the selectors it protects.", tone: "success" },
            { title: "The steering", body: "Crypto map on the WAN interface (Cisco) or a route via st0.0 (Junos).", tone: "ip" },
            { title: "Counters and the log", body: "Packets encrypted and decrypted per SA, and every negotiation result: SA up, or why it failed.", tone: "warning" },
          ]}
        />
      </GuideSection>

      <GuideSection id="vpd-verify" eyebrow="Operations" title="How to verify: one layer at a time" tone="success">
        <FlowSteps
          steps={[
            { title: "Is the IKE SA up, with the right peer?", body: <>Cisco <Mono>show crypto ikev2 sa</Mono> (READY) · Junos <Mono>show security ike security-associations</Mono> (UP).</>, tone: "violet" },
            { title: "Is a CHILD SA installed for the right traffic?", body: <>Cisco <Mono>show crypto ipsec sa</Mono> (idents, both SPIs) · Junos <Mono>show security ipsec security-associations</Mono> (<Mono>&lt;</Mono> inbound and <Mono>&gt;</Mono> outbound SPI).</>, tone: "success" },
            { title: "Is the traffic steered into the tunnel?", body: <>Cisco <Mono>show crypto map</Mono> (Interfaces using crypto map) · Junos <Mono>show route</Mono> (… via st0.0).</>, tone: "ip" },
            { title: "Is it used, and if not, why?", body: <>Cisco <Mono>show crypto ipsec sa</Mono> (#pkts encaps / decaps), <Mono>show logging</Mono> · Junos <Mono>show security ipsec statistics</Mono>, <Mono>show log messages</Mono>.</>, tone: "warning" },
          ]}
        />
        <p>Then prove it with traffic: a fresh ping between the sites, and the encrypt and decrypt counters moving on both gateways.</p>
      </GuideSection>

      <GuideSection id="vpd-normal" eyebrow="Operations" title="What a healthy tunnel looks like on the gateways" tone="success">
        <NormalState />
      </GuideSection>

      <GuideSection id="vpd-signatures" eyebrow="Troubleshooting" title="Failure signatures: the first layer that failed" tone="danger">
        <p>IPsec builds trust in layers: reach the peer, agree keys, authenticate, agree what to protect, then steer the traffic in. A failure stops at one layer, and the evidence names it:</p>
        <FailureSignatures
          items={[
            { tag: "peer", title: "Wrong peer / peer unreachable", tone: "danger", points: ["IKE_SA_INIT retransmitted, never answered", "Log: maximum retransmissions / peer not responding", "Check both peer addresses and the peer's link"] },
            { tag: "proposal", title: "No common IKE proposal", tone: "warning", points: ["Refused at the very first message", "Notify NO_PROPOSAL_CHOSEN", "Compare encryption / PRF / DH group on both ends"] },
            { tag: "auth", title: "Pre-shared key mismatch", tone: "violet", points: ["IKE_SA_INIT completes, IKE_AUTH fails", "AUTHENTICATION_FAILED · “IKE starts, then stops”", "Compare the key on both gateways"] },
            { tag: "selectors", title: "Selectors don't mirror", tone: "ip", points: ["IKE SA up, no CHILD SA (UP-NO-IPSEC)", "Notify TS_UNACCEPTABLE", "Local on one side = remote on the other"] },
            { tag: "steer", title: "Traffic not steered in", tone: "success", points: ["SAs up on both sides", "Encaps / decaps stay at 0 while you test", "Crypto map on the WAN · route via st0.0"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="vpd-layers" eyebrow="Troubleshooting" title="Symptom → most likely layer" tone="danger">
        <FieldTable
          title="Where it stops"
          columns={["Symptom", "Likely cause", "Check"]}
          rows={[
            ["No IKE_SA_INIT response", "Reachability, UDP/500 filtered, wrong peer address", "Public path, filters, peer address on both sides"],
            ["NO_PROPOSAL_CHOSEN", "No common algorithms / DH group", "Proposals on both sides"],
            ["AUTHENTICATION_FAILED", "Wrong PSK, identity or certificate", "IDs, keys, certificate chain"],
            ["TS_UNACCEPTABLE", "Traffic selectors don't match the peer's policy", "Local/remote subnets on BOTH sides"],
            ["IKE up, CHILD up, no traffic", "Not steered into the tunnel, or filtered inside", "Crypto map / st0 route, SA counters"],
          ]}
        />
      </GuideSection>

      <GuideSection id="vpd-workflow" eyebrow="Troubleshooting" title="Investigation workflow: find the first layer that failed" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Is the traffic meant for the tunnel at all?", look: "Only the protected subnets go through IPsec; anything else is routed (and NATed) normally." },
            { question: "Does IKE_SA_INIT get an answer, with a common proposal?", look: "No answer: the peer address (both directions), the peer's internet link. NO_PROPOSAL_CHOSEN: compare the IKE proposals." },
            { question: "Does IKE_AUTH succeed?", look: "AUTHENTICATION_FAILED: the pre-shared key / identities on both gateways." },
            { question: "Is a CHILD SA installed?", look: "TS_UNACCEPTABLE with the IKE SA up: the selectors must mirror each other (local ↔ remote)." },
            { question: "Do the ESP counters move when you test?", look: "SAs up but 0 encrypted: the traffic isn't steered in (crypto map on the WAN / route via st0.0)." },
          ]}
        />
      </GuideSection>

      <GuideSection id="vpd-faults" eyebrow="Troubleshooting" title="Five faults, from evidence to proof" tone="danger">
        <FaultWalks />
      </GuideSection>

      <GuideSection id="vpd-prove" eyebrow="Troubleshooting" title="Prove the repair with fresh traffic" tone="success">
        <ChecklistCard
          tone="success"
          title="The proof, every time"
          mark="✓"
          items={[
            "The IKE SA is READY / UP with the right peer",
            "A CHILD SA is installed with the intended selectors and an SPI in each direction",
            "A fresh ping between the sites succeeds",
            "Encaps and decaps climb on both gateways while you test",
            "Traffic to the internet still leaves outside the tunnel (split tunneling)",
          ]}
        />
        <p>Shortcuts don&apos;t count: bypassing IPsec would make the ping work, but the traffic would cross the internet unprotected. The lab&apos;s tickets only close when the gateways&apos; state is right <em>and</em> a fresh run of the user&apos;s test succeeds.</p>
      </GuideSection>

      <GuideSection id="vpd-natt" eyebrow="Beyond this lesson" title="NAT traversal: UDP/4500" tone="warning">
        <DiagramFrame caption="Only when a NAT sits between the peers.">
          <NattDiagram />
        </DiagramFrame>
        <p>ESP has no ports, so a NAT between the gateways can&apos;t translate it. When IKE detects a NAT (with NAT-detection payloads in IKE_SA_INIT), both IKE and ESP move into UDP port 4500. The lab&apos;s gateways have public addresses on both sides, so none of this is needed there.</p>
      </GuideSection>

      <GuideSection id="vpd-myths" eyebrow="Master it" title="Common misconceptions" tone="warning">
        <Misconceptions
          items={[
            { myth: "The IKE SA is the tunnel.", correction: "Host packets travel in ESP under a CHILD SA. The IKE SA can be up while no CHILD SA exists." },
            { myth: "IKE_SA_INIT authenticates the peer.", correction: "It only agrees keys. Identity is proven in IKE_AUTH, inside the encrypted SK payload." },
            { myth: "Both directions use the same SPI.", correction: "Each one-way SA has its own SPI, chosen by its receiver." },
            { myth: "Sequence numbers encrypt the packet.", correction: "They let the receiver reject replays. AES-GCM does the encryption and integrity." },
            { myth: "If the SAs are up, the traffic is protected.", correction: "Only traffic steered into IPsec is encrypted. Without the crypto map or the st0 route it leaves in the clear." },
            { myth: "Selectors only matter on policy-based VPNs.", correction: "Route-based VPNs negotiate selectors too; mismatched ones fail with TS_UNACCEPTABLE." },
          ]}
        />
      </GuideSection>

      <GuideSection id="vpd-quiz" eyebrow="Master it" title="Knowledge check" tone="success">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>

      <GuideSection id="vpd-explain" eyebrow="Master it" title="Can you explain it?" tone="success">
        <ExplainIt
          items={[
            { q: "Why can monitoring show the VPN peer up while no host reaches the other site?", a: "Monitoring watches the IKE SA. If the CHILD SA was refused (TS_UNACCEPTABLE) or the traffic isn't steered in, the control channel is fine and no ESP carries host packets." },
            { q: "Why does a wrong peer address give no error at all, while a wrong proposal gives one immediately?", a: "With a wrong peer, IKE_SA_INIT goes to an address nobody answers on, so GW-A only retransmits. With a wrong proposal the peer answers, with NO_PROPOSAL_CHOSEN." },
            { q: "Why do the SPIs change after GW-B's internet link comes back?", a: "The old SAs died with the link. A new negotiation creates a new CHILD SA, with new SPIs chosen by each receiver and sequence numbers starting at 1." },
            { q: "Why does browsing from Site A still work when the crypto map is removed?", a: "Browsing never used the tunnel: WEB isn't covered by the selectors, so it always left with source NAT. Only Site B's traffic depended on the crypto map." },
          ]}
        />
      </GuideSection>

      <GuideSection id="vpd-practice" eyebrow="Practice" title="Practice in the VPN Lab" tone="cyan">
        <ChecklistCard
          tone="cyan"
          title="In the lab you will"
          mark="→"
          items={[
            "Find both SPIs on the wire, and read an IKE_AUTH exchange",
            "Prove split tunneling",
            "Change the IKE proposal on both ends, and let GW-B accept all of 10.10.0.0/16",
            "Survive a peer outage and see the new SPIs",
            "Solve five tickets from evidence, on Cisco IOS or Junos, and prove each repair",
          ]}
        />
        <PresentationBridge>See IKE_SA_INIT, IKE_AUTH, the CHILD SA and ESP with its SPIs in the VPN presentation.</PresentationBridge>
        <LabBridge />
      </GuideSection>
    </div>
  );
}
