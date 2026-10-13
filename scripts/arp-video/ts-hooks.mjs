// Resolve hook for running the lesson's TypeScript modules under plain Node (type stripping):
// maps "@/..." to src/ and adds the .ts/.tsx extension Next's bundler normally infers.
import { existsSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src");
export async function resolve(spec, ctx, next) {
  let target = spec;
  if (spec.startsWith("@/")) target = pathToFileURL(path.join(SRC, spec.slice(2))).href;
  else if (!(spec.startsWith(".") || spec.startsWith("file:"))) return next(spec, ctx);
  const base = target.startsWith("file:") ? fileURLToPath(target) : path.resolve(path.dirname(fileURLToPath(ctx.parentURL)), target);
  for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) if (existsSync(c) && statSync(c).isFile()) return next(pathToFileURL(c).href, ctx);
  return next(spec, ctx);
}
// JSON modules (the narration manifest) load as a default export, like the bundler does.
import { readFileSync } from "node:fs";
export async function load(url, ctx, next) {
  if (url.endsWith(".json")) return { format: "module", source: `export default ${readFileSync(fileURLToPath(url), "utf8")};`, shortCircuit: true };
  return next(url, ctx);
}
