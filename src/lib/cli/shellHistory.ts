import type { CliCommandSet } from "./types";

/**
 * A host shell's own history command: bash `history` (numbered) or cmd.exe `doskey /history`. Like the real ones it
 * lists the command being run as the last line (the console records a line after running it, so it is added here).
 * Sets that already have the command are returned unchanged.
 */
export function withShellHistory(set: CliCommandSet, os: "linux" | "windows", history: string[] | undefined): CliCommandSet {
  const syntax = os === "linux" ? "history" : "doskey /history";
  if (set.commands.some((c) => c.syntax === syntax)) return set;
  const lines = [...(history ?? []), syntax];
  return {
    ...set,
    commands: [...set.commands, { id: "hist", syntax, summary: "Commands typed in this session", run: () => ({ output: os === "linux" ? lines.map((x, n) => `${String(n + 1).padStart(5)}  ${x}`).join("\n") : lines.join("\n") }) }],
  };
}
