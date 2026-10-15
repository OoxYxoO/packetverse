import { Callout, CompareCards, DIAGRAM as D, DiagramFrame, DiagramSvg, FieldTable, Glossary, GuideSection, Mono, ProtocolStory, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { KnowledgeCheck } from "@/components/lesson/GuideInteractive";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { BSSID, LAPTOP_AT, WIFI_FACTS, centreMHz, createWifiState, dist, overlap, r1, rssi, type Ap } from "@/lib/sim-engine/scenarios/ccna/wireless";

export const WIFI_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "wfl-mission", label: "What this lesson teaches" },
  { id: "wfl-floor", label: "The floor of this lesson" },
  { id: "wfl-rf", label: "Signal, noise and SINR" },
  { id: "wfl-ssid", label: "SSID, BSSID and the BSS" },
  { id: "wfl-join", label: "Joining a network" },
  { id: "wfl-frame", label: "The 802.11 frame" },
  { id: "wfl-csma", label: "CSMA/CA" },
  { id: "wfl-channels", label: "Channels and overlap" },
  { id: "wfl-bands", label: "2.4, 5 and 6 GHz" },
  { id: "wfl-incident", label: "The incident" },
  { id: "wfl-fix", label: "Repair and prove it" },
  { id: "wfl-glossary", label: "Glossary" },
  { id: "wfl-recap", label: "Recap" },
];

export function ChannelChart() {
  const w = 600;
  const fx = (mhz: number) => 20 + ((mhz - 2398) / 90) * w;
  const aps: Ap[] = Array.from({ length: 11 }, (_, i) => ({ id: String(i + 1), x: 0, y: 0, channel: i + 1, band: "2.4", txDbm: 0 }));
  return (
    <DiagramSvg h={150} label="2.4 GHz channels 1 to 11, each 22 MHz wide and 5 MHz apart; only 1, 6 and 11 do not overlap">
      {aps.map((a) => {
        const c = centreMHz(a.channel, "2.4");
        const clean = [1, 6, 11].includes(a.channel);
        return (
          <g key={a.id}>
            <path d={`M${fx(c - 11)},110 Q${fx(c - 11)},${clean ? 30 : 60} ${fx(c)},${clean ? 30 : 60} Q${fx(c + 11)},${clean ? 30 : 60} ${fx(c + 11)},110`} fill="none" stroke={clean ? D.success : D.faint} strokeWidth={clean ? 2.2 : 1} />
            <text x={fx(c)} y={128} textAnchor="middle" fill={clean ? D.success : D.muted} fontSize={10}>
              {a.channel}
            </text>
          </g>
        );
      })}
      <text x={20} y={146} fill={D.muted} fontSize={9.5}>
        {`centre = 2407 + 5 × channel MHz · overlap 1↔6: ${overlap(aps[0], aps[5]) * 100}% · 3↔6: ${Math.round(overlap(aps[2], aps[5]) * 100)}% · 1↔4: ${Math.round(overlap(aps[0], aps[3]) * 100)}%`}
      </text>
    </DiagramSvg>
  );
}

function FloorDiagram() {
  const s = createWifiState();
  const all = [...s.aps, { id: "AP3", x: 20, y: 17, channel: 3, band: "2.4" as const, txDbm: 17 }];
  const X = (x: number) => 30 + x * 14.5;
  const Y = (y: number) => 20 + y * 8;
  return (
    <DiagramSvg h={200} label="Floor plan 40 by 20 metres: AP1 west on channel 1, AP2 east on channel 6, the laptop near AP2, AP3 added at the south wall">
      <rect x={X(0)} y={Y(0)} width={40 * 14.5} height={20 * 8} rx={6} fill="none" stroke={D.line} />
      {all.map((a) => (
        <g key={a.id}>
          <circle cx={X(a.x)} cy={Y(a.y)} r={30} fill={a.id === "AP3" ? D.warning : D.cyan} opacity={0.08} />
          <circle cx={X(a.x)} cy={Y(a.y)} r={5} fill={a.id === "AP3" ? D.warning : D.cyan} />
          <text x={X(a.x)} y={Y(a.y) - 10} textAnchor="middle" fill={D.text} fontSize={10.5}>{`${a.id} · ch ${a.channel}${a.id === "AP3" ? " (added)" : ""}`}</text>
        </g>
      ))}
      <rect x={X(LAPTOP_AT.x) - 6} y={Y(LAPTOP_AT.y) - 4} width={12} height={8} fill={D.success} />
      <text x={X(LAPTOP_AT.x)} y={Y(LAPTOP_AT.y) - 8} textAnchor="middle" fill={D.success} fontSize={10.5}>
        LAPTOP
      </text>
    </DiagramSvg>
  );
}

export function WifiLessonGuideContent() {
  const s = createWifiState();
  const { q0, fault, fixed } = WIFI_FACTS;
  return (
    <>
      <GuideSection id="wfl-mission" eyebrow="Mission" title="What this lesson teaches">
        <p>
          Wi-Fi carries Ethernet frames over radio, and radio is shared, fading and noisy. You will watch a laptop discover a network, pick an access point by signal, associate and send its first frame — and then see a well-meant
          new AP cut everyone&apos;s speed by two-thirds because of one channel number.
        </p>
        <Callout tone="violet" title="CCNA 1.11">
          Wireless principles: nonoverlapping Wi-Fi channels, SSID, RF and encryption (encryption is taught in depth in Wireless Security).
        </Callout>
      </GuideSection>

      <GuideSection id="wfl-floor" eyebrow="Topology" title="The floor of this lesson">
        <DiagramFrame caption="40 m × 20 m. Positions drive every signal level in the lesson.">
          <FloorDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="wfl-rf" eyebrow="RF" title="Signal, noise and SINR">
        <FieldTable
          title="Computed at the laptop (log-distance path loss, exponent 3)"
          columns={["AP", "Distance", "Channel", "Signal"]}
          rows={s.aps.map((a) => [a.id, `${r1(dist(a, LAPTOP_AT))} m`, String(a.channel), <Mono key="r">{`${rssi(a, LAPTOP_AT)} dBm`}</Mono>])}
        />
        <p>
          dBm is logarithmic: +3 dB doubles power, +10 dB is ten times. The noise floor here is −95 dBm, so AP2&apos;s signal sits {q0.sinr} dB above it — a SINR that supports the top rate. Rate depends on SINR, not on signal
          alone.
        </p>
        <KnowledgeCheck
          label="Check"
          question={{
            id: "wfl-k1",
            prompt: "Signal −60 dBm, noise + interference −70 dBm. What is the SINR?",
            options: [
              { id: "10", label: "10 dB" },
              { id: "130", label: "130 dB" },
              { id: "-10", label: "−10 dB" },
            ],
            correctId: "10",
            explanation: "SINR = signal − (noise + interference) = −60 − (−70) = 10 dB. That's a slow, retry-heavy link.",
          }}
        />
      </GuideSection>

      <GuideSection id="wfl-ssid" eyebrow="Identity" title="SSID, BSSID and the BSS">
        <CompareCards
          items={[
            { title: "SSID", tone: "cyan", tag: "network name", points: ["“CORP” — what users pick", "The same on every AP of the network", "Many SSIDs can share one radio"] },
            { title: "BSSID", tone: "violet", tag: "one radio's MAC", points: [`AP2's is ${BSSID.AP2}`, "Identifies one BSS", "Address 3 of most frames"] },
            { title: "BSS / ESS", tone: "success", tag: "cell / whole network", points: ["BSS: one AP and its clients", "ESS: all BSSs with one SSID, joined by the wired LAN", "Roaming moves a client between BSSs"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="wfl-join" eyebrow="Join" title="Joining a network">
        <ProtocolStory
          steps={[
            { actor: "APs", action: "Beacon every 102.4 ms with SSID, BSSID, channel, rates and security." },
            { actor: "Laptop", action: "Scans every channel; hears CORP from AP1 and AP2; measures each.", changes: "Picks the strongest: AP2." },
            { actor: "Laptop → AP2", action: "Authentication (open system) then Association Request." },
            { actor: "AP2", action: "Association Response with an association ID.", changes: "The laptop is in AP2's BSS." },
            { actor: "Laptop ↔ AP2", action: "WPA2/WPA3 4-way handshake derives encryption keys (see Wireless Security)." },
          ]}
        />
      </GuideSection>

      <GuideSection id="wfl-frame" eyebrow="Frame" title="The 802.11 frame">
        <FieldTable
          title="A data frame from the laptop to its gateway (To DS)"
          columns={["Field", "Value", "Why"]}
          rows={[
            ["Address 1 — receiver", BSSID.AP2, "The radio that must receive it: the AP"],
            ["Address 2 — transmitter", "the laptop", "Who sent it on the air"],
            ["Address 3 — destination", "gateway MAC", "Where the AP bridges it on the wired side"],
            ["Retry bit", "0 / 1", "Set when the frame is a retransmission"],
          ]}
        />
      </GuideSection>

      <GuideSection id="wfl-csma" eyebrow="Medium" title="CSMA/CA">
        <p>
          A radio can&apos;t hear a collision while it transmits, so Wi-Fi <em>avoids</em> them: sense the channel, wait a random backoff, transmit, and require an ACK for each unicast frame. Optional RTS/CTS reserves the air for
          large frames. The whole channel is one half-duplex medium shared by every device in range.
        </p>
      </GuideSection>

      <GuideSection id="wfl-channels" eyebrow="Channels" title="Channels and overlap">
        <ChannelChart />
        <Callout tone="warning" title="Two kinds of trouble">
          Same channel (co-channel): devices hear each other and politely share airtime. Overlapping channel (adjacent-channel): they can&apos;t decode each other, so they don&apos;t wait — their energy is pure noise.
        </Callout>
      </GuideSection>

      <GuideSection id="wfl-bands" eyebrow="Bands" title="2.4, 5 and 6 GHz">
        <FieldTable
          title="Bands at a glance"
          columns={["Band", "Non-overlapping 20 MHz channels", "Range", "Notes"]}
          rows={[
            ["2.4 GHz", "3 (1, 6, 11)", "Longest", "Crowded; microwaves and Bluetooth share it"],
            ["5 GHz", "~25", "Shorter", "Some channels need DFS (radar detection)"],
            ["6 GHz", "up to 59", "Shortest", "Wi-Fi 6E/7 only; WPA3 required"],
          ]}
        />
      </GuideSection>

      <GuideSection id="wfl-incident" eyebrow="Incident" title="The incident" tone="danger">
        <p>
          AP3 goes in at the south wall on channel 3 (centre {centreMHz(3, "2.4")} MHz). At the laptop, still on AP2, SINR drops from {q0.sinr} dB to {fault.sinr} dB and throughput from about {q0.goodputMbps} to {fault.goodputMbps} Mb/s.
        </p>
        <TroubleshootingFlow
          steps={[
            { question: "Is the client associated, to which AP?", look: "WLC client details or the OS Wi-Fi status." },
            { question: "Is the signal strong enough?", look: "RSSI: −67 dBm or better for data." },
            { question: "What is the noise and interference?", look: "SINR / SNR on the WLC or a spectrum analyzer." },
            { question: "Do any channels overlap?", look: "The channel plan: 2.4 GHz must use 1, 6 and 11 only." },
          ]}
        />
      </GuideSection>

      <GuideSection id="wfl-fix" eyebrow="Repair" title="Repair and prove it" tone="success">
        <p>
          Channel 11 makes the plan 1-6-11: no overlap anywhere, SINR back to {fixed.sinr} dB, about {fixed.goodputMbps} Mb/s. Raising AP3&apos;s power only adds interference; another SSID changes nothing in the spectrum. In
          production, a WLC&apos;s radio resource management usually picks channels and power automatically.
        </p>
      </GuideSection>

      <GuideSection id="wfl-glossary" eyebrow="Words" title="Glossary">
        <Glossary
          items={[
            { term: "dBm", def: "Power relative to 1 mW on a log scale." },
            { term: "RSSI", def: "Received signal strength, in dBm." },
            { term: "SINR / SNR", def: "How far the signal rises above noise (and interference), in dB." },
            { term: "SSID / BSSID", def: "Network name / one AP radio's MAC address." },
            { term: "CSMA/CA", def: "Carrier sense, collision avoidance: listen, back off, transmit, expect an ACK." },
            { term: "Co-channel / adjacent-channel interference", def: "Shared airtime / overlapping noise." },
          ]}
        />
      </GuideSection>

      <GuideSection id="wfl-recap" eyebrow="Recap" title="Recap" tone="success">
        <ul className="list-disc space-y-1 pl-5">
          <li>Clients find SSIDs from beacons and join the strongest BSS.</li>
          <li>SINR, not raw signal, sets the data rate.</li>
          <li>Wi-Fi is half duplex and shared: CSMA/CA and ACKs.</li>
          <li>2.4 GHz: 1, 6 and 11 only. 5 and 6 GHz: many more channels, less range.</li>
        </ul>
      </GuideSection>
    </>
  );
}
