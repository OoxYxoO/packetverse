/**
 * Writes every narrated clip (id, spoken text, caption text, hash) as JSON for the narration renderer:
 *   node --import ./scripts/arp-video/register.mjs scripts/arp-video/export-lines.ts > lines.json
 * The lines are the same for every teacher.
 */
import { allClips, cleanText, markedSpeech, spokenText, textHash } from "@/app/demo/arp-resolution/arp-video/timeline";

const out = allClips().map((c) => ({ id: c.id, say: spokenText(c.line), marked: markedSpeech(c.line), text: cleanText(c.line.text), hash: textHash(markedSpeech(c.line)) }));
process.stdout.write(JSON.stringify(out, null, 1));
