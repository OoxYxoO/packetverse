import { CompareCards, FieldTable, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { CliPair } from "@/components/lesson/GuideCli";
import { MODES, bundleResult } from "@/lib/sim-engine/scenarios/ccna/etherchannelModes";

/** Deep Dive section (CCNA 2.4): Cisco PAgP beside LACP and static, with every mode pair computed. */
export function PagpSection() {
  return (
    <GuideSection id="lcd-pagp" eyebrow="The protocol" title="PAgP, LACP and static: every mode pair" tone="warning">
      <CompareCards
        items={[
          { title: "LACP", tone: "success", tag: "IEEE 802.1AX · every vendor", points: ["active: sends LACPDUs", "passive: answers only", "Up to 16 members, 8 active (Cisco)"] },
          { title: "PAgP", tone: "cyan", tag: "Cisco-proprietary", points: ["desirable: sends PAgP packets", "auto: answers only", "Up to 8 members; Cisco-to-Cisco only"] },
          { title: "Static (on)", tone: "danger", tag: "no protocol", points: ["Bundles without asking", "No check that the far end agrees", "A miscabled member can loop or black-hole"] },
        ]}
      />
      <FieldTable
        title="Computed: does a bundle form? (rows = this side, columns = far side)"
        columns={["", ...MODES]}
        rows={MODES.map((a) => [<Mono key="m">{a}</Mono>, ...MODES.map((b) => {
          const r = bundleResult(a, b);
          return <span key={b} className={r.bundles ? "text-pv-success" : "text-pv-text-faint"} title={r.why}>{r.bundles ? "✓ bundles" : "✕"}</span>;
        })])}
      />
      <p>
        Rules hiding in the table: one side must start (active or desirable); both sides must speak the same protocol; and <Mono>on</Mono> only matches <Mono>on</Mono>. With a Juniper or any non-Cisco neighbour, LACP is the only
        negotiating choice — the lesson uses LACP for that reason.
      </p>
      <CliPair
        cisco={{ prompt: "SW1(config)#", command: "interface range gi1/0/1 - 2", output: " channel-group 1 mode desirable    ! PAgP\n! or: channel-group 1 mode active   ! LACP\n!\nSW1# show etherchannel summary" }}
        junos={{ prompt: "admin@SW2# ", command: "set interfaces ae0 aggregated-ether-options lacp active", output: "set interfaces ge-0/0/1 ether-options 802.3ad ae0\nset interfaces ge-0/0/2 ether-options 802.3ad ae0\n# Junos has no PAgP: LACP or static only" }}
      />
    </GuideSection>
  );
}
