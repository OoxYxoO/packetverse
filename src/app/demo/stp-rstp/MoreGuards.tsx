import { DIAGRAM as D, DiagramSvg, FieldTable, GuideSection } from "@/components/lesson/GuideBlocks";
import { CliPair } from "@/components/lesson/GuideCli";
import { GUARD_WHERE, HELLO, MAX_MISSED, alternatePortTimeline, reaction, type Event, type Guard } from "@/lib/sim-engine/scenarios/ccna/stpGuards";

/** Deep Dive section (CCNA 2.5): Loop Guard and BPDU filter, beside the lesson's BPDU Guard and Root Guard. */
export function LoopGuardSection() {
  const plain = alternatePortTimeline("none");
  const guarded = alternatePortTimeline("loop-guard");
  const W = 600;
  const x = (t: number) => 110 + (t / 12) * (W - 130);
  const colour = (st: string) => (st === "forwarding" ? D.danger : st === "loop-inconsistent" ? D.warning : D.success);
  const guards: Guard[] = ["PortFast", "BPDU Guard", "BPDU filter", "Root Guard", "Loop Guard"];
  const events: Event[] = ["BPDU arrives on an edge port", "Superior BPDU arrives", "BPDUs stop arriving on a blocking port"];
  return (
    <GuideSection id="std-loopguard" eyebrow="Protection" title="Loop Guard and BPDU filter" tone="danger">
      <p>
        BPDU Guard and Root Guard react to BPDUs that <em>arrive</em>. Loop Guard protects against BPDUs that <em>stop</em> arriving. If a fiber pair fails in one direction, SW3&apos;s blocking Alternate port stops hearing SW2 but can still
        talk. After {MAX_MISSED} missed hellos ({HELLO * MAX_MISSED} s) RSTP ages the information out, the port thinks it is Designated — and starts forwarding into a loop.
      </p>
      <DiagramSvg h={150} label="SW3 Alternate port state per second after BPDUs stop at t = 1: without Loop Guard it becomes forwarding at 6 seconds; with Loop Guard it becomes loop-inconsistent">
        {[
          ["no guard", plain, 40],
          ["Loop Guard", guarded, 90],
        ].map(([label, tl, y]) => (
          <g key={label as string}>
            <text x={10} y={(y as number) + 4} fill={D.muted} fontSize={10.5}>
              {label as string}
            </text>
            {(tl as typeof plain).map((p) => (
              <g key={p.t}>
                <rect x={x(p.t) - 18} y={(y as number) - 10} width={36} height={18} rx={4} fill={colour(p.state)} opacity={0.35} />
                {p.bpdu ? <circle cx={x(p.t)} cy={(y as number) - 16} r={3} fill={D.cyan} /> : null}
              </g>
            ))}
          </g>
        ))}
        {plain.map((p) => (
          <text key={p.t} x={x(p.t)} y={130} textAnchor="middle" fill={D.faint} fontSize={9}>{`${p.t}s`}</text>
        ))}
        <text x={10} y={146} fill={D.muted} fontSize={9.5}>
          green = discarding · red = forwarding (loop) · amber = loop-inconsistent · dot = BPDU received
        </text>
      </DiagramSvg>
      <FieldTable
        title="Computed by the lesson's guard model — what each feature does, and where it belongs"
        columns={["Feature", ...events, "Configure on"]}
        rows={guards.map((g) => [g, ...events.map((e) => reaction(g, e)), GUARD_WHERE[g]])}
      />
      <CliPair
        cisco={{ prompt: "SW3(config)#", command: "spanning-tree loopguard default", output: "interface GigabitEthernet1/0/10\n spanning-tree portfast\n spanning-tree bpduguard enable\n!\nSW3# show spanning-tree inconsistentports" }}
        junos={{ prompt: "admin@SW3# ", command: "set protocols rstp interface ge-0/0/24 bpdu-timeout-action block", output: "set protocols rstp interface ge-0/0/10 edge\nset protocols rstp bpdu-block-on-edge" }}
      />
    </GuideSection>
  );
}
