// _shared/telemetry.ts — server-side error breadcrumbs into analytics_events.
// Call from a function's top-level catch with its service-role client. Rows
// land as type 'server_error' with app 'fn:<name>', so they surface on the
// /analytics errors tab next to client errors and feed the spike alerts.
// The insert path is service-role-only: the anon insert policy deliberately
// excludes 'server_error', so browsers can't forge one.

// deno-lint-ignore-file no-explicit-any

export async function logServerError(
  client: any, fn: string, err: unknown, meta?: Record<string, unknown>,
): Promise<void> {
  try {
    const e = err as Error
    await client.from('analytics_events').insert({
      type: 'server_error',
      app: `fn:${fn}`,
      path: `/functions/v1/${fn}`,
      message: String(e?.message || err).slice(0, 1000),
      stack: e?.stack ? String(e.stack).slice(0, 4000) : null,
      meta: meta ?? null,
    })
  } catch {
    // Telemetry must never take the function down with it.
  }
}
