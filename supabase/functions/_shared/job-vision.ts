// Shared vision-field readers/writers for /job edge functions.
// Single source of truth for fetching preference data out of
// job.vision_field. Replaces ad-hoc `SELECT … FROM job.vision …` calls
// scattered across pull-recommendations, narratives, opportunities,
// gen-asset, theirstack source, job-fit-haiku, etc.
//
// Helpers transparently fall back to job.vision for any field that
// isn't yet seeded into vision_field — defensive during the migration
// window, can be removed in Phase 3.

import type postgres from 'https://deno.land/x/postgresjs@v3.4.4/mod.js';

// We don't import postgres directly to avoid creating a second connection
// pool; the caller passes their own sql client (from db()).
type Sql = ReturnType<typeof postgres>;

// Per-call cache so a single edge-fn invocation doesn't issue N queries
// when N readers each want one field. Keyed on the underlying connection
// pool object identity (which is stable per function instance).
const _cache = new WeakMap<Sql, { at: number; userId: string; rows: Map<string, unknown> }>();
const CACHE_MS = 30_000;

// Pick the "primary" user — the existing single-tenant data model has
// one user_profile row. Multi-user callers should pass userId explicitly.
async function pickUserId(sql: Sql): Promise<string | null> {
  const rows = await sql<{ user_id: string }[]>`
    select user_id from public.user_profile order by onboarding_complete_at desc nulls last limit 1
  `;
  return rows[0]?.user_id || null;
}

async function ensureLoaded(sql: Sql, userId: string | null): Promise<{ userId: string; rows: Map<string, unknown> } | null> {
  const uid = userId ?? await pickUserId(sql);
  if (!uid) return null;
  const cached = _cache.get(sql);
  if (cached && cached.userId === uid && Date.now() - cached.at < CACHE_MS) return cached;
  const rows = await sql<{ name: string; value: unknown }[]>`
    select name, value from job.vision_field where user_id = ${uid}
  `;
  const map = new Map<string, unknown>(rows.map((r) => [r.name, r.value]));
  const entry = { at: Date.now(), userId: uid, rows: map };
  _cache.set(sql, entry);
  return entry;
}

// ── Public API ────────────────────────────────────────────────────────

export async function loadVisionField<T = unknown>(
  sql: Sql,
  name: string,
  opts: { userId?: string; fallbackToLegacy?: boolean } = {},
): Promise<T | null> {
  const entry = await ensureLoaded(sql, opts.userId ?? null);
  if (!entry) return null;
  const v = entry.rows.get(name);
  if (v !== undefined && v !== null) return v as T;
  // Defensive fallback to job.vision for fields not yet seeded into
  // vision_field (e.g. on a fresh install before migration 074 runs).
  if (opts.fallbackToLegacy !== false) {
    try {
      const rows = await sql<{ v: T | null }[]>`
        select ${sql(name)} as v from job.vision order by updated_at desc limit 1
      `;
      return (rows[0]?.v ?? null) as T | null;
    } catch (_) { /* column may not exist — return null */ }
  }
  return null;
}

export async function loadVisionFields(
  sql: Sql,
  names: string[],
  opts: { userId?: string } = {},
): Promise<Record<string, unknown>> {
  const entry = await ensureLoaded(sql, opts.userId ?? null);
  if (!entry) return {};
  const out: Record<string, unknown> = {};
  for (const n of names) {
    const v = entry.rows.get(n);
    out[n] = v === undefined ? null : v;
  }
  return out;
}

// String-array reader with sensible coercion. Returns lowercased values
// to match how the existing readers compared.
export async function loadVisionStringArray(
  sql: Sql,
  name: string,
  opts: { userId?: string; defaults?: string[] } = {},
): Promise<string[]> {
  const v = await loadVisionField<unknown>(sql, name, { userId: opts.userId });
  if (Array.isArray(v) && v.length) return v.map((x) => String(x).toLowerCase()).filter(Boolean);
  return opts.defaults ?? [];
}
