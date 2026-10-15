import type { CheckpointQuestion } from "./types";
import { NF_CHECKPOINT } from "./checkpoints/networkFundamentals";
import { NA_CHECKPOINT } from "./checkpoints/networkAccess";
import { IC_CHECKPOINT } from "./checkpoints/ipConnectivity";
import { IS_CHECKPOINT } from "./checkpoints/ipServices";
import { SF_CHECKPOINT } from "./checkpoints/securityFundamentals";
import { AP_CHECKPOINT } from "./checkpoints/automationProgrammability";

/**
 * Exam-style checkpoint questions for each CCNA domain — original questions, written to test understanding (a
 * scenario, a table or an output to reason about), not recall of a phrase. Each names the objective it tests and the
 * lesson to revisit when it is missed. One file per domain under ./checkpoints.
 */
export const CCNA_CHECKPOINTS: Record<string, CheckpointQuestion[]> = {
  "network-fundamentals": NF_CHECKPOINT,
  "network-access": NA_CHECKPOINT,
  "ip-connectivity": IC_CHECKPOINT,
  "ip-services": IS_CHECKPOINT,
  "security-fundamentals": SF_CHECKPOINT,
  "automation-programmability": AP_CHECKPOINT,
};
