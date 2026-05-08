// Shared Postgres helper for /job Edge Functions.
// Lazy-init a single connection per function instance.
import postgres from 'https://deno.land/x/postgresjs@v3.4.4/mod.js';

let _sql: ReturnType<typeof postgres> | null = null;

export function db() {
  if (_sql) return _sql;
  const url = Deno.env.get('SUPABASE_DB_URL');
  if (!url) throw new Error('SUPABASE_DB_URL not configured');
  _sql = postgres(url, { prepare: false, max: 4 });
  return _sql;
}
