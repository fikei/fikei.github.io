// application-answers — the Easy Apply answer bank (Phase 16.2a).
// One row per (user_id, canonical_key) in job.application_answers.
//
//   POST { action: 'list' }                        → { answers: {key: {value, source, updated_at}} }
//   POST { action: 'upsert', answers: [{key, value, source?}] }
//                                                  → { saved: n }
//   POST { action: 'delete', keys: [key…] }        → { deleted: n }
//   POST { action: 'seed' }                        → derive answers from data
//        already on record (career history tenure, vision comp floors +
//        geographies, base-resume links, auth profile). Only fills keys with
//        no existing row; returns { seeded: {key: value}, coverage_keys }.
//   POST { action: 'coverage', slug }              → match the role's
//        extracted form (job.application_draft.fields — extracts on the fly
//        from the role URL when absent) against the bank → Coverage report.
//        Unmatched required questions get one Haiku pass before reporting.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { verifyJobUserDetailed, jsonResp, err, corsHeaders } from '../_shared/job-auth.ts';
import { db } from '../_shared/job-db.ts';
import { extractSchema, callClaude, type Schema } from '../_shared/apply-extract.ts';
import { CANONICAL_QUESTIONS, computeCoverage, matchPrompt } from '../_shared/answer-bank.ts';

const VERSION = '0.2.0';
console.log(`[application-answers] v${VERSION} - resume_extract action + coverage readiness stamping`);

const KEY_RE = /^[a-z0-9_]+$/;
const SLUG_RE = /^[a-z0-9_-]+$/;
const SOURCES = new Set(['onboarding', 'resume_extract', 'derived', 'writeback']);
const VALID_KEYS = new Set(CANONICAL_QUESTIONS.map(c => c.key));

type Sql = ReturnType<typeof db>;

async function listAnswers(sql: Sql, userId: string) {
  const rows = await sql`
    select canonical_key, value, source, updated_at
    from job.application_answers where user_id = ${userId};
  `;
  const answers: Record<string, unknown> = {};
  for (const r of rows) answers[r.canonical_key] = { value: r.value, source: r.source, updated_at: r.updated_at };
  return answers;
}

// ---- seed: prefill from what Ladder already knows -------------------------
async function seed(sql: Sql, user: { id: string; email?: string; user_metadata?: Record<string, unknown> }) {
  const existing = new Set((await sql`
    select canonical_key from job.application_answers where user_id = ${user.id};
  `).map((r: { canonical_key: string }) => r.canonical_key));

  const seeded: Record<string, unknown> = {};
  const put = (key: string, value: unknown) => {
    if (value == null || value === '' || existing.has(key) || key in seeded) return;
    seeded[key] = value;
  };

  // Auth profile → contact.
  put('email', user.email);
  const meta = user.user_metadata || {};
  put('legal_name', (meta.full_name || meta.name) as string | undefined);

  // Career history → years of experience + current employer/location.
  try {
    const hist = await sql`
      select name, tenure_start, tenure_end, location from job.companies
      where tenure_start is not null order by tenure_start asc;
    `;
    if (hist.length) {
      let months = 0;
      for (const h of hist) {
        const start = new Date(h.tenure_start).getTime();
        const end = h.tenure_end ? new Date(h.tenure_end).getTime() : Date.now();
        if (end > start) months += (end - start) / (1000 * 3600 * 24 * 30.44);
      }
      put('years_experience_pm', Math.round(months / 12));
      const current = hist.find((h: { tenure_end: string | null }) => !h.tenure_end);
      if (current?.location) put('location', current.location);
    }
  } catch (e) { console.warn('[application-answers] seed history failed', (e as Error).message); }

  // Vision → comp expectation + metro rules.
  try {
    const v = (await sql`select comp_floor_base, comp_floor_total, target_geographies from job.vision limit 1;`)[0];
    if (v?.comp_floor_base || v?.comp_floor_total) {
      put('comp_expectation', {
        base_floor: v.comp_floor_base ?? null,
        total_floor: v.comp_floor_total ?? null,
        policy: 'floor',      // phrase answers as "looking for at least X" until the user edits
      });
    }
    if (Array.isArray(v?.target_geographies) && v.target_geographies.length) {
      put('onsite_willingness', { metros: v.target_geographies, max_days_per_week: null });
    }
  } catch (e) { console.warn('[application-answers] seed vision failed', (e as Error).message); }

  // Base resume markdown → links.
  try {
    const g = (await sql`select content_md from job.global_assets where kind = 'resume' limit 1;`)[0];
    const md = String(g?.content_md || '');
    put('linkedin_url', md.match(/https?:\/\/(?:www\.)?linkedin\.com\/in\/[\w-]+/i)?.[0]);
    put('github_url',   md.match(/https?:\/\/(?:www\.)?github\.com\/[\w-]+/i)?.[0]);
    put('phone',        md.match(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/)?.[0]?.trim());
  } catch (e) { console.warn('[application-answers] seed resume failed', (e as Error).message); }

  // Universal sane defaults for rare Tier-4 booleans (user can flip in
  // Settings; these are the truthful answer for almost everyone).
  put('prior_employee', false);
  put('non_compete', false);
  put('family_relationship', false);
  put('gov_procurement', false);

  const entries = Object.entries(seeded);
  for (const [key, value] of entries) {
    await sql`
      insert into job.application_answers (user_id, canonical_key, value, source)
      values (${user.id}, ${key}, ${sql.json(value)}, 'derived')
      on conflict (user_id, canonical_key) do nothing;
    `;
  }
  return seeded;
}

// ---- coverage: match a role's form against the bank -----------------------
async function coverage(sql: Sql, userId: string, slug: string) {
  // Prefer the already-extracted schema; extract on the fly otherwise.
  let schema: Schema | null = null;
  const draft = (await sql`
    select fields from job.application_draft
    where user_id = ${userId} and role_slug = ${slug} limit 1;
  `)[0];
  if (draft?.fields && (draft.fields.general?.length || draft.fields.custom_questions?.length)) {
    schema = draft.fields as Schema;
  } else {
    const role = (await sql`
      select coalesce(canonical_apply_url, url) as apply_url from job.pipeline_roles
      where slug = ${slug} and deleted_at is null limit 1;
    `)[0];
    if (!role?.apply_url) return err('role has no apply URL', 404);
    schema = await extractSchema(role.apply_url);
  }

  const answered = new Set(Object.keys(await listAnswers(sql, userId)));
  const cov = computeCoverage(schema!, answered);
  let stamped = false;

  // Haiku tail: try to map required questions the heuristics missed.
  if (cov.unmatched_required.length) {
    try {
      const keyList = CANONICAL_QUESTIONS.map(c => `${c.key}: ${c.label}`).join('\n');
      const text = await callClaude(
        `You map job-application questions to canonical answer keys. Keys:\n${keyList}\n\nReturn ONLY JSON: {"<question>": "<key or null>", ...}`,
        JSON.stringify(cov.unmatched_required), 800);
      const mapped = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
      for (const m of cov.mappings) {
        if (m.canonical_key || m.consent) continue;
        const k = mapped[m.prompt];
        if (typeof k === 'string' && VALID_KEYS.has(k)) {
          m.canonical_key = k;
          m.answered = answered.has(k);
        }
      }
      // Recompute the aggregates with the Haiku-augmented mappings.
      const req = cov.mappings.filter(m => m.required && !m.consent);
      const covered = req.filter(m => m.answered);
      cov.total_required = req.length;
      cov.covered_required = covered.length;
      cov.pct = req.length ? Math.round((covered.length / req.length) * 100) : 100;
      cov.ready = req.length > 0 ? covered.length === req.length : false;
      cov.missing_keys = [...new Set(req.filter(m => m.canonical_key && !m.answered).map(m => m.canonical_key!))]
      cov.unmatched_required = req.filter(m => !m.canonical_key).map(m => m.prompt);
    } catch (e) {
      console.warn('[application-answers] haiku tail failed', (e as Error).message);
    }
  }

  // Stamp readiness onto the role row so the table can render the filled
  // "Ready to submit" chip without recomputing coverage per row.
  try {
    await sql`
      update job.pipeline_roles set
        apply_ease_meta = coalesce(apply_ease_meta, '{}'::jsonb)
          || jsonb_build_object('coverage_pct', ${cov.pct}::int, 'ready', ${cov.ready}::boolean)
      where slug = ${slug};
    `;
    stamped = true;
  } catch (e) { console.warn('[application-answers] coverage stamp failed', (e as Error).message); }

  return jsonResp({ slug, ats: schema!.ats, coverage: cov, stamped });
}

// ---- resume_extract: seed the bank from an uploaded resume's text ---------
async function resumeExtract(sql: Sql, userId: string, text: string) {
  const sys = `Extract application-form answers from a resume. Return ONLY JSON:
{"legal_name": string|null, "email": string|null, "phone": string|null,
 "location": string|null, "linkedin_url": string|null, "github_url": string|null,
 "portfolio_url": string|null, "years_experience_pm": number|null}
years_experience_pm = total years of product-management (or closest) experience from the work history dates. Use null when not present — never invent.`;
  const out = await callClaude(sys, text.slice(0, 30_000), 700);
  const parsed = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
  const seeded: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!VALID_KEYS.has(key) || value == null || value === '') continue;
    await sql`
      insert into job.application_answers (user_id, canonical_key, value, source, updated_at)
      values (${userId}, ${key}, ${sql.json(value)}, 'resume_extract', now())
      on conflict (user_id, canonical_key) do update set
        value = excluded.value, source = 'resume_extract', updated_at = now();
    `;
    seeded[key] = value;
  }
  return seeded;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return err('POST only', 405);

  try {
    const user = await verifyJobUserDetailed(req);
    if (!user) return err('unauthorized', 401);
    const sql = db();
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || 'list');

    if (action === 'list') {
      return jsonResp({ answers: await listAnswers(sql, user.id), registry: CANONICAL_QUESTIONS });
    }

    if (action === 'upsert') {
      const items = Array.isArray(body.answers) ? body.answers : [];
      let saved = 0;
      for (const it of items) {
        const key = String(it?.key || '');
        const source = SOURCES.has(it?.source) ? it.source : 'writeback';
        if (!KEY_RE.test(key) || !VALID_KEYS.has(key) || it?.value === undefined) continue;
        await sql`
          insert into job.application_answers (user_id, canonical_key, value, source, updated_at)
          values (${user.id}, ${key}, ${sql.json(it.value)}, ${source}, now())
          on conflict (user_id, canonical_key) do update set
            value = excluded.value, source = excluded.source, updated_at = now();
        `;
        saved++;
      }
      return jsonResp({ saved });
    }

    if (action === 'delete') {
      const keys = (Array.isArray(body.keys) ? body.keys : []).filter((k: unknown) => typeof k === 'string' && KEY_RE.test(k));
      if (!keys.length) return jsonResp({ deleted: 0 });
      const res = await sql`
        delete from job.application_answers
        where user_id = ${user.id} and canonical_key = any(${keys});
      `;
      return jsonResp({ deleted: res.count ?? keys.length });
    }

    if (action === 'seed') {
      const seeded = await seed(sql, user);
      return jsonResp({ seeded, answers: await listAnswers(sql, user.id) });
    }

    if (action === 'coverage') {
      const slug = String(body.slug || '').toLowerCase();
      if (!SLUG_RE.test(slug)) return err('invalid slug', 400);
      return await coverage(sql, user.id, slug);
    }

    if (action === 'resume_extract') {
      const text = String(body.text || '');
      if (text.trim().length < 100) return err('resume text too short', 400);
      const seeded = await resumeExtract(sql, user.id, text);
      return jsonResp({ seeded, answers: await listAnswers(sql, user.id) });
    }

    return err(`unknown action '${action}'`, 400);
  } catch (e) {
    console.error('[application-answers] error', e);
    return err((e as Error).message || 'server error', 500);
  }
});
