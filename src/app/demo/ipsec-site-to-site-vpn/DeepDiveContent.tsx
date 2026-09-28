import { Callout, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DNode, DPill, FieldTable, Glossary, GuideSection } from "@/components/lesson/GuideBlocks";
import { DFieldRow, DTable } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { EXCHANGE, NOTIFY_TS_UNACCEPTABLE } from "@/lib/sim-engine/scenarios/ipsecVpn";

export const VPN_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "vpd-header", label: "IKEv2 header, SPIs, Message ID" },
  { id: "vpd-exchanges", label: "Exchange types" },
  { id: "vpd-proposals", label: "SA proposals & KE / nonces" },
  { id: "vpd-auth", label: "Authentication" },
  { id: "vpd-modes", label: "Tunnel vs transport" },
  { id: "vpd-replay", label: "Anti-replay" },
  { id: "vpd-pfs", label: "PFS & rekeying" },
  { id: "vpd-natt", label: "NAT-T (UDP/4500)" },
  { id: "vpd-impl", label: "Route- vs policy-based" },
  { id: "vpd-verify", label: "Verification & troubleshooting" },
  { id: "vpd-model", label: "Mental model" },
  { id: "vpd-glossary", label: "Glossary" },
];

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

function AuthDiagram() {
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

export function VpnDeepDiveContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="vpd-header" eyebrow="Wire format" title="The IKEv2 header" tone="violet">
        <DiagramFrame caption="28 bytes in front of every IKE message.">
          <HeaderDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="vpd-exchanges" eyebrow="Exchanges" title="Four exchange types" tone="cyan">
        <DiagramFrame caption="Only the first one is readable on the wire.">
          <ExchangeDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="vpd-proposals" eyebrow="Negotiation" title="SA proposals, KE and nonces" tone="success">
        <DiagramFrame caption="The initiator offers; the responder picks exactly one proposal.">
          <ProposalDiagram />
        </DiagramFrame>
        <p>If the two sides share no acceptable proposal, the responder answers NO_PROPOSAL_CHOSEN — a different failure from TS_UNACCEPTABLE ({NOTIFY_TS_UNACCEPTABLE}), which is about selectors, not algorithms.</p>
      </GuideSection>

      <GuideSection id="vpd-auth" eyebrow="Identity" title="How AUTH proves who you are" tone="warning">
        <DiagramFrame caption="Pre-shared key or certificate signature, same idea.">
          <AuthDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "Pre-shared key", tone: "warning", tag: "simple", points: ["Both gateways configured with the same secret", "AUTH is a MAC keyed from it", "Key never sent; rotate it like a password"] },
            { title: "Certificates", tone: "violet", tag: "scalable", points: ["Each gateway signs with its private key", "Peer validates the certificate chain", "No shared secret to distribute"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="vpd-modes" eyebrow="ESP" title="Tunnel vs transport mode" tone="mpls">
        <DiagramFrame caption="Where the new header goes, and what is encrypted.">
          <ModesDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="vpd-replay" eyebrow="ESP" title="The anti-replay window" tone="danger">
        <DiagramFrame caption="Duplicates and stale packets are rejected even if they decrypt.">
          <ReplayDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="vpd-pfs" eyebrow="Lifetimes" title="PFS and rekeying" tone="cyan">
        <DiagramFrame caption="Make before break: the new CHILD SA exists before the old one is deleted.">
          <PfsRekeyDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="vpd-natt" eyebrow="NAT" title="NAT traversal: UDP/4500" tone="warning">
        <DiagramFrame caption="Only when a NAT sits between the peers.">
          <NattDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="vpd-impl" eyebrow="Implementations" title="Route-based vs policy-based" tone="violet">
        <DiagramFrame caption="Two ways to decide which packets enter the tunnel.">
          <ImplDiagram />
        </DiagramFrame>
        <Callout tone="cyan" title="Selectors still matter with route-based VPNs">
          If one side proposes narrow selectors and the other only accepts different ones, CREATE_CHILD_SA fails the same way — TS_UNACCEPTABLE — whatever the platform calls them.
        </Callout>
      </GuideSection>

      <GuideSection id="vpd-verify" eyebrow="Operations" title="Verification and troubleshooting" tone="success">
        <FieldTable
          title="Symptom → most likely layer"
          columns={["Symptom", "Likely cause", "Check"]}
          rows={[
            ["No IKE_SA_INIT response", "Reachability, UDP/500 filtered, wrong peer address", "Public path, filters"],
            ["NO_PROPOSAL_CHOSEN", "No common algorithms / DH group", "Proposals on both sides"],
            ["AUTHENTICATION_FAILED", "Wrong PSK, identity or certificate", "IDs, keys, certificate chain"],
            ["TS_UNACCEPTABLE", "Traffic selectors don't match the peer's policy", "Local/remote subnets on BOTH sides"],
            ["IKE up, CHILD up, no traffic", "Routing into the tunnel, filters inside", "Routes, SA counters, inner filters"],
          ]}
        />
      </GuideSection>

      <GuideSection id="vpd-model" eyebrow="Mental model" title="Phone call, then sealed mail" tone="violet">
        <p>IKE_SA_INIT is agreeing a private language over an open phone line; IKE_AUTH is showing ID once nobody else can understand you. CHILD SAs are the sealed mailbags, one per direction, each labelled with a number the receiver chose. ESP is the mail itself. Traffic selectors are the list of whose letters go in the bags.</p>
      </GuideSection>

      <GuideSection id="vpd-glossary" eyebrow="Glossary" title="Terms" tone="cyan">
        <Glossary
          items={[
            { term: "Message ID", def: "Per-IKE-SA counter pairing each request with its response." },
            { term: "KE / Nonce", def: "Diffie-Hellman public value / fresh random input to key derivation." },
            { term: "SKEYSEED, SK_d", def: "Keying material derived after IKE_SA_INIT; SK_d seeds CHILD SA keys." },
            { term: "PFS", def: "Perfect Forward Secrecy: a new DH exchange for new keys." },
            { term: "NAT-T", def: "UDP/4500 encapsulation of IKE and ESP when a NAT is detected." },
            { term: "AEAD", def: "Authenticated encryption (e.g. AES-GCM): confidentiality and integrity in one transform." },
          ]}
        />
      </GuideSection>
    </div>
  );
}
