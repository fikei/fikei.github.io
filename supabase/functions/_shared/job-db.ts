// Shared Postgres helper for /job Edge Functions.
// Lazy-init a single connection per function instance.
//
// CRITICAL on Supabase Edge: every cold-started function instance opens
// its own pool. Hundreds of instances × multiple connections each
// quickly exhausts the project's connection budget (we hit "remaining
// connection slots are reserved for roles with the SUPERUSER attribute"
// at ~50 idle pgjs connections).
//
// max: 1               → one connection per instance is enough; edge
//                        functions handle requests serially.
// idle_timeout: 20     → release connections fast on warm instances.
// connect_timeout: 10  → fail fast if the pool is exhausted instead of
//                        holding the request open.
import postgres from 'https://deno.land/x/postgresjs@v3.4.4/mod.js';

let _sql: ReturnType<typeof postgres> | null = null;

export function db() {
  if (_sql) return _sql;
  const url = Deno.env.get('SUPABASE_DB_URL');
  if (!url) throw new Error('SUPABASE_DB_URL not configured');
  _sql = postgres(url, {
    prepare: false,
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  return _sql;
}
