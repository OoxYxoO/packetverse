# Practice Lab framework

Reusable learning-experience framework extracted from the ARP reference lab
(`src/app/demo/arp-resolution/arp-lab`). It covers the learning EXPERIENCE only.
Protocol truth, table schemas, PDUs, predictions, the Teaching Board copy and CLI
adapters always stay in the lesson.

**Hard rules:**
- A Practice Lab never writes progress, XP, streaks or achievements.
- It never gates the guided lesson's Next Step.
- Its state is independent of the guided lesson.

## Pieces

| Piece | Where | Owns |
| --- | --- | --- |
| `LabModel<S, A>` | `@/lib/practice-lab/types` | The lesson's pure model: `initial`, `hops`, `start`, `arrive`, optional `revision` |
| `useLabRunner` | `@/lib/practice-lab/useLabRunner` | When the model is applied: animated vs instant, `run`, `runSequence`, `replay` (visual frame counter only, never mutates state), `reset`, `revision` for CLI stale hints |
| `PracticeLabShell` | `practice-lab` | Dialog, sandbox note, Reset/Return/animation, lab timeline, Predict→Act→Observe→Verify strip, desktop split, mobile tabs (derived from the slots you pass), scroll lock, Escape, focus |
| `usePracticeLab`, `PracticeLabButton`, `PracticeLabCard` | `practice-lab` | Opening the lab: header button, optional card, lazy mount, stays mounted so the session survives closing |
| `TeachingBoard`, `BoardSection`, `TeachingEventRows`, `StateDeltaChips`, `KeyLesson`, `EngineerCheck`, `PredictionBlock`, `Verdict`, `NextAction`, `DeepenUnderstanding`, `CommandHelp` | `practice-lab` | Teaching Board layout primitives |
| `LiveStateCard` | `practice-lab` | Any live table: rows with a "learned this step" highlight, pulse and an inline "Why?" |
| `LabEventLog` | `practice-lab` | Collapsible tagged log |
| `LabTopology`, `LabPacketOverlay` | `practice-lab` | Generic topology on `GraphTopologyViewer`: regions, active/selected/dimmed nodes, tags, cue pill, animated packet pill (`packet`), or several at once (`packets[]`) |
| `LabDeviceDetails`, `InspectInCliButton`, `LabPacketFields` | `practice-lab` | Small device card; read-only PDU view (records no progress) |
| `TroubleshootingFlow`, `FailureSignatures`, `Misconceptions` | `components/lesson/GuideBlocks` | Lesson Guide primitives |
| `CLITerminal` + `src/lib/cli` | existing | Optional. Pass `stateVersion={runner.revision}` for stale hints, and keep `sessions`/`focus` in lab state so each vendor×device keeps its own session |

## 1. Pure model (the lesson writes this)

```ts
// src/lib/sim-engine/scenarios/ethernetLab.ts
import type { LabModel } from "@/lib/practice-lab/types";

export interface EthLabState { fdb: Record<string, string>; inFlight?: { kind: Kind; hop: number }; log: Entry[] }
export type Kind = "pcA-to-pcB" | "pcB-to-pcA";
const PATHS: Record<Kind, string[]> = { "pcA-to-pcB": ["pcA", "sw1", "pcB"], "pcB-to-pcA": ["pcB", "sw1", "pcA"] };

export const ETH_LAB_MODEL: LabModel<EthLabState, Kind> = {
  initial: () => ({ fdb: {}, log: [] }),
  hops: (_s, kind) => PATHS[kind].length - 1,
  start: (s, kind) => ({ ...s, inFlight: { kind, hop: 0 } }),
  // State changes ONLY here, at the hop boundary (e.g. learning on frame arrival).
  arrive: (s) => {
    /* learn source MAC when the frame reaches sw1; append a log entry */
    return s;
  },
  revision: (s) => Object.keys(s.fdb).length,
};
```

## 2a. Shell-based lesson (FundamentalsLessonShell)

Add one optional field to the lesson config. Lessons without it render exactly as before.

```tsx
practiceLab: {
  entry: { title: "Ethernet Lab", buttonLabel: "Practice switching", description: "Send frames yourself and watch SW1 learn." },
  contextNote: (stepId) => (stepId?.startsWith("learn") ? "Want to experiment instead of only watching?" : undefined),
  render: ({ open, onClose }) => <EthernetLabWorkspace open={open} onClose={onClose} />,
},
```

## 2b. Bespoke page (like /demo/arp-resolution or /demo/tcp-udp)

```tsx
const lab = usePracticeLab(() => setAutoPlay(false));
<PracticeLabButton label="Practice ARP" onOpen={lab.openLab} />
<PracticeLabCard entry={ENTRY} onOpen={lab.openLab} />
{lab.mounted && <MyLabWorkspace open={lab.open} onClose={lab.closeLab} />}
```

`openLab` is stable, so a Lesson Guide "practice bridge" can capture it in memoised content.

## 3. Workspace

```tsx
function EthernetLabWorkspace({ open, onClose }: { open: boolean; onClose: () => void }) {
  const runner = useLabRunner(ETH_LAB_MODEL, { segmentMs: 1100 });
  const [prediction, setPrediction] = useState<string>();
  const s = runner.state;
  const hop = runner.replayFrame?.hop ?? s.inFlight?.hop;
  return (
    <PracticeLabShell
      open={open} onClose={onClose} title="Ethernet Lab"
      onReset={() => { runner.reset(); setPrediction(undefined); }}
      animate={runner.animate} onToggleAnimate={() => runner.setAnimate(!runner.animate)}
      stages={[{ id: "t0", label: "Baseline" }, { id: "t1", label: "First frame" }]} currentStage={0}
      loop={{ current: prediction ? 1 : 0 }}
      primaryAction={(compact) => <Button size={compact ? "sm" : "md"} disabled={!prediction || runner.busy} onClick={() => runner.run("pcA-to-pcB")}>Send frame</Button>}
      topology={<LabTopology nodes={NODES} edges={EDGES} packet={hop === undefined ? undefined : { id: 1, path: PATH, hop, done: false, label: "Frame", color: "#22d3ee" }} segmentMs={runner.segmentMs} />}
      board={
        <TeachingBoard phase="T0 · Baseline" title="Before anything moves">
          <PredictionBlock prompt="What will SW1 do with the first frame?" options={OPTS} value={prediction} onChange={setPrediction} />
        </TeachingBoard>
      }
      liveState={<LiveStateCard title="SW1 MAC" caption="MAC → PORT" rows={fdbRows(s)} pulseKey={runner.revision} empty="Empty" />}
      eventLog={<LabEventLog entries={s.log} />}
      // cli={<CLITerminal stateVersion={runner.revision} … />}   ← optional
    />
  );
}
```

## Notes

- **Replay** calls `runner.replay(hops)` and renders `runner.replayFrame`. It never calls the model, so tables and logs cannot change.
- **Instant mode** (`runner.setAnimate(false)`) applies `start` plus every `arrive` synchronously.
- **CLI stale hints:** `runner.revision` is `${resetCount}:${model.revision(state)}`. Any protocol can define what counts as a meaningful change.
- **Topology:** `LabTopology` uses percentage coordinates. Leave vertical room above nodes, because the packet pill lifts by `lift` (46px). A specialised diagram (like ARP's SVG with subnet boundary and vendor port labels) can be passed to the `topology` slot instead.
- **Several packets at once:** pass `packets?: LabPacketView[]` (in addition to, or instead of, `packet`) when one event puts several copies on different links — e.g. a flooded frame leaving three ports. Each view has its own `path`, `hop` and `done`, so copies advance and finish independently; give each a stable, unique `id` (change it per replay to restart the animation). LabTopology knows nothing about why there are several — the lesson maps its own state to views (Ethernet: `ethernet-switching/ethernet-lab`).
- **Mobile tabs** come from the slots you pass: no `cli` gives Topology/State, and no live state or log gives Topology only.
