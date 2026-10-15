import { jsonType, parseBody, type ApiState, type Json } from "@/lib/sim-engine/scenarios/ccna/restApi";

/** A JSON value as a small typed tree: each key with its JSON type, nested objects and arrays indented. */
export function JsonTree({ value, name, depth = 0 }: { value: Json; name?: string; depth?: number }) {
  const t = jsonType(value);
  const label = name !== undefined ? <span className="text-pv-text">{name}</span> : null;
  if (t === "object" || t === "array") {
    const entries = t === "array" ? (value as Json[]).map((v, i) => [String(i), v] as const) : Object.entries(value as Record<string, Json>);
    return (
      <li>
        {label}
        {label ? ": " : ""}
        <span className="text-pv-cyan-soft">{t}</span>
        <span className="text-pv-text-faint"> ({entries.length})</span>
        {depth < 3 ? (
          <ul className="ml-3 border-l border-white/10 pl-2">
            {entries.map(([k, v]) => (
              <JsonTree key={k} name={t === "array" ? `[${k}]` : `"${k}"`} value={v} depth={depth + 1} />
            ))}
          </ul>
        ) : null}
      </li>
    );
  }
  return (
    <li>
      {label}: <span className="text-pv-cyan-soft">{t}</span> <span className="text-pv-text-muted">{JSON.stringify(value)}</span>
    </li>
  );
}

/** Side panel: the latest request/response pair as raw text — what the script actually receives. */
export function ApiPanel({ s }: { s: ApiState }) {
  const ex = s.exchanges[s.exchanges.length - 1];
  return (
    <div className="space-y-3 text-xs">
      {ex ? (
        <section className="rounded-xl border border-pv-border bg-pv-surface/60 p-3" aria-label="Latest API call">
          <h3 className="font-semibold text-pv-text">Latest call</h3>
          <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[10.5px] leading-relaxed text-pv-text-muted">
            <span className="text-pv-text">
              {ex.method} {ex.uri}
            </span>
            {"\n"}X-Auth-Token: {ex.auth ? "eyJhbGciOi…" : "(none)"}
            {ex.body ? `\n\n${ex.body}` : ""}
          </pre>
          <p className={`mt-2 font-mono text-[11px] font-semibold ${ex.status >= 400 ? "text-pv-danger" : "text-pv-success"}`}>
            {ex.status} {ex.reason}
          </p>
          {ex.response ? <pre tabIndex={0} className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-[10.5px] text-pv-text-muted">{ex.response}</pre> : null}
        </section>
      ) : (
        <p className="text-pv-text-faint">No calls yet.</p>
      )}
      {s.monitoringLost ? <p className="font-mono text-[10.5px] text-pv-danger">monitoring: SW1 has no managementIp — polling stopped</p> : null}
    </div>
  );
}

/** Main-column panel: the latest response's JSON as a typed tree (hidden while a step asks the learner to read the raw JSON). */
export function JsonTypesPanel({ s }: { s: ApiState }) {
  const ex = s.exchanges[s.exchanges.length - 1];
  const parsed = ex?.response ? parseBody(ex.response) : undefined;
  if (!parsed?.ok) return null;
  return (
    <section className="rounded-xl border border-pv-border bg-pv-surface/60 p-3 text-xs" aria-label="Response JSON types">
      <h3 className="font-semibold text-pv-text">
        {ex.method} {ex.uri} — response, by JSON type
      </h3>
      <ul className="mt-2 font-mono text-[10.5px] text-pv-text-muted">
        <JsonTree value={parsed.value} />
      </ul>
    </section>
  );
}
