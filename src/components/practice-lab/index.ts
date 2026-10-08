/**
 * PacketVerse Practice Lab framework (Learning Contract). Generic learning
 * EXPERIENCE only — every protocol truth, table schema, PDU, prediction and
 * CLI adapter stays in the lesson. See README.md in this folder.
 */
export { PracticeLabShell, type PracticeLabShellProps, type PracticeLabTab, type LabStageDef } from "./PracticeLabShell";
export { PracticeLabButton, PracticeLabCard, usePracticeLab, type PracticeLabEntry } from "./PracticeLabLauncher";
export {
  TeachingBoard,
  BoardSection,
  TeachingEventRows,
  StateDeltaChips,
  KeyLesson,
  EngineerCheck,
  Verdict,
  PredictionBlock,
  NextAction,
  DeepenUnderstanding,
  CommandHelp,
  type TeachingEventRowDef,
  type StateDelta,
  type EngineerCheckFact,
  type PredictionOption,
  type CommandHelpItem,
  StepPrimer,
  StepWhy,
} from "./TeachingBoard";
export { LiveStateCard, type LiveStateRow } from "./LiveStateCard";
export { LabEventLog, type LabLogEntry } from "./LabEventLog";
export { LabTopology, LabPacketOverlay, type LabTopologyProps, type LabPacketView } from "./LabTopology";
export { LabDeviceDetails, InspectInCliButton } from "./LabDeviceDetails";
export { LabPacketFields } from "./LabPacketFields";
export { useLabRunner, type LabRunner, type LabRunnerOptions } from "@/lib/practice-lab/useLabRunner";
export type { LabModel, LabReplayFrame } from "@/lib/practice-lab/types";
