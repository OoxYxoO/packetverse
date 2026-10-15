import { CompareCards, FailureSignatures, FieldTable, GuideSection, Misconceptions, Mono } from "@/components/lesson/GuideBlocks";
import { ExplainIt, KnowledgeQuiz, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { LAPTOP_AT, rssi, type Ap } from "@/lib/sim-engine/scenarios/ccna/wireless";
import { ChannelChart } from "./LessonGuideContent";

export const WIFI_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "wfd-standards", label: "802.11 generations" },
  { id: "wfd-distance", label: "Distance and signal" },
  { id: "wfd-width", label: "Channel width" },
  { id: "wfd-channels", label: "The 2.4 GHz chart again" },
  { id: "wfd-security", label: "Encryption at a glance" },
  { id: "wfd-signatures", label: "How Wi-Fi problems look" },
  { id: "wfd-myths", label: "Misconceptions" },
  { id: "wfd-explain", label: "Explain it" },
  { id: "wfd-quiz", label: "Check yourself" },
];

const QUIZ: KnowledgeQuestion[] = [
  {
    id: "wfd-q1",
    prompt: "Two neighbouring APs both use channel 6. What happens?",
    options: [
      { id: "share", label: "They hear each other and share airtime (co-channel contention)" },
      { id: "noise", label: "Each becomes noise to the other" },
      { id: "nothing", label: "Nothing — same channel is ideal" },
    ],
    correctId: "share",
    explanation: "Devices on the same channel decode each other's frames and defer, so capacity is split. Overlapping-but-different channels are worse: they can't decode, don't defer, and add noise.",
  },
  {
    id: "wfd-q2",
    prompt: "Why do 6 GHz networks need more APs for the same floor?",
    options: [
      { id: "range", label: "Higher frequencies lose more signal over the same distance" },
      { id: "power", label: "6 GHz radios are not allowed to transmit" },
      { id: "wpa3", label: "WPA3 slows them down" },
    ],
    correctId: "range",
    explanation: "Free-space loss grows with 20·log10(frequency): 6 GHz loses about 8 dB more than 2.4 GHz at every distance.",
  },
];

export function WifiDeepDiveContent() {
  const ap: Ap = { id: "X", x: 0, y: 0, channel: 6, band: "2.4", txDbm: 17 };
  const distances = [1, 5, 10, 20, 40];
  return (
    <>
      <GuideSection id="wfd-standards" eyebrow="Standards" title="802.11 generations">
        <FieldTable
          title="Generations you will meet"
          columns={["Standard", "Wi-Fi name", "Bands", "Notes"]}
          rows={[
            ["802.11n", "Wi-Fi 4", "2.4 / 5 GHz", "MIMO, 40 MHz channels"],
            ["802.11ac", "Wi-Fi 5", "5 GHz", "80/160 MHz, MU-MIMO downstream"],
            ["802.11ax", "Wi-Fi 6 / 6E", "2.4 / 5 / 6 GHz", "OFDMA, BSS colouring, efficiency in crowds"],
            ["802.11be", "Wi-Fi 7", "2.4 / 5 / 6 GHz", "320 MHz, multi-link operation"],
          ]}
        />
      </GuideSection>

      <GuideSection id="wfd-distance" eyebrow="RF" title="Distance and signal">
        <FieldTable
          title="Computed: 17 dBm AP on channel 6, indoor exponent 3"
          columns={["Distance", "Signal"]}
          rows={distances.map((d) => [`${d} m`, <Mono key="s">{`${rssi(ap, { x: d, y: 0 })} dBm`}</Mono>])}
        />
        <p>Each doubling of distance costs about 9 dB indoors (30·log10 2). Walls add more: drywall a few dB, concrete 10–15 dB. The lesson&apos;s laptop at ({LAPTOP_AT.x}, {LAPTOP_AT.y}) m sees AP2 at about −50 dBm.</p>
      </GuideSection>

      <GuideSection id="wfd-width" eyebrow="Width" title="Channel width">
        <CompareCards
          items={[
            { title: "20 MHz", tone: "success", tag: "most channels", points: ["Best for dense offices", "Always in 2.4 GHz"] },
            { title: "40 / 80 MHz", tone: "cyan", tag: "bonded", points: ["2× / 4× the rate", "Uses 2 / 4 channels — fewer left for neighbours"] },
            { title: "160 / 320 MHz", tone: "violet", tag: "6 GHz", points: ["Very high rates", "Only practical where spectrum is plentiful"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="wfd-channels" eyebrow="Channels" title="The 2.4 GHz chart again">
        <ChannelChart />
      </GuideSection>

      <GuideSection id="wfd-security" eyebrow="Security" title="Encryption at a glance">
        <FieldTable
          title="What protects the air"
          columns={["Method", "Status"]}
          rows={[
            ["Open / WEP", "Never use — no or broken encryption"],
            ["WPA2-Personal (PSK) / Enterprise (802.1X)", "AES-CCMP; still common"],
            ["WPA3-Personal (SAE) / Enterprise", "Current standard; required on 6 GHz"],
          ]}
        />
        <p>The Wireless Security lesson in Security Fundamentals walks through the handshake and its attacks.</p>
      </GuideSection>

      <GuideSection id="wfd-signatures" eyebrow="Troubleshooting" title="How Wi-Fi problems look">
        <FailureSignatures
          items={[
            { tag: "Overlap", title: "Adjacent-channel interference", tone: "danger", points: ["Signal fine, noise high", "Low SINR, low rate, many retries", "Channels not on 1/6/11"] },
            { tag: "Co-channel", title: "Too many APs on one channel", tone: "warning", points: ["Good SINR, still slow", "Airtime shared between cells", "Reduce power or re-plan"] },
            { tag: "Coverage", title: "Weak signal", tone: "violet", points: ["RSSI below −70 dBm", "Rate drops, roaming sticky", "Add or move APs"] },
            { tag: "Sticky", title: "Sticky client", tone: "cyan", points: ["Client stays on a far AP", "Strong AP nearby ignored", "Tune roaming / 802.11k/v"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="wfd-myths" eyebrow="Misconceptions" title="Misconceptions">
        <Misconceptions
          items={[
            { myth: "More transmit power is always better.", correction: "It enlarges the cell and the interference it causes; clients can't match it on the way back." },
            { myth: "Every AP needs its own SSID.", correction: "One SSID across all APs is what lets clients roam." },
            { myth: "Full bars means fast.", correction: "Bars show signal; speed depends on SINR and how many share the channel." },
          ]}
        />
      </GuideSection>

      <GuideSection id="wfd-explain" eyebrow="Explain" title="Explain it">
        <ExplainIt
          items={[
            { q: "Why is channel 3 worse than putting AP3 on channel 6?", a: "On 6, AP2 and AP3 would decode each other and share airtime. On 3 they can't decode each other, so AP3's energy is just noise inside AP2's channel." },
            { q: "Why does Wi-Fi ACK every unicast frame?", a: "A transmitting radio can't detect collisions, so the only proof of delivery is an ACK. No ACK → retry." },
          ]}
        />
      </GuideSection>

      <GuideSection id="wfd-quiz" eyebrow="Quiz" title="Check yourself">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>
    </>
  );
}
