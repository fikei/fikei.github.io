// submit-application — Easy Apply review + submit (Phase 16.2c).
//
//   POST { action: 'prepare', slug }
//     Assemble the full submission: map the role's extracted form onto the
//     answer bank (+ any draft-answer overrides), pick the resume, itemize
//     consent checkboxes. Persists to job.application_draft.answers and
//     returns the review payload. No traffic to the ATS.
//
//   POST { action: 'submit', slug, confirm: true, consents: [id…], overrides?: {id: value} }
//     Guardrailed transport. Greenhouse only in v1, gated by the
//     SUBMIT_ENABLED env flag. Never bypasses CAPTCHAs: when the board
//     enforces one (or the flag is off, or the POST is rejected) it returns
//     { status: 'assisted_required', reason } and the client falls back to
//     the assisted-apply panel. On success: stage → applied, an
//     applied_confirmation event (source 'easy-apply'), and a full answer
//     snapshot in application_draft.
//
// Guardrails (decisions 3/4 in the phase doc): explicit confirm flag from
// the review screen tap, every consent itemized + ticked, liveness probe at
// submit time, policy_daily_cap enforced, no silent submissions.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { verifyJobUserDetailed, jsonResp, err, corsHeaders } from '../_shared/job-auth.ts';
import { db } from '../_shared/job-db.ts';
import { extractSchema, detectAts, type Schema } from '../_shared/apply-extract.ts';
import { computeCoverage, canonicalQuestion, type QuestionMapping } from '../_shared/answer-bank.ts';

const VERSION = '0.2.0';
console.log(`[submit-application] v${VERSION} - Easy Apply prepare/submit (Greenhouse, flag-gated)`);

const SLUG_RE = /^[a-z0-9_-]+$/;
type Sql = ReturnType<typeof db>;

// ---- answer rendering ------------------------------------------------------
// Turn a bank value into the string an ATS text field expects.
function renderAnswer(key: string, value: unknown, prompt: string): string | boolean | null {
  if (value == null) return null;
  const reg = canonicalQuestion(key);
  if (reg?.kind === 'boolean' || typeof value === 'boolean') return !!value;
  if (key === 'comp_expectation' && typeof value === 'object') {
    const v = value as { base_floor?: number; total_floor?: number; policy?: string };
    const n = v.base_floor ?? v.total_floor;
    if (n == null) return null;
    if (v.policy === 'flexible') return 'Flexible depending on total compensation';
    if (v.policy === 'range') return `$${n.toLocaleString()} – $${Math.round(n * 1.15).toLocaleString()}`;
    return `$${n.toLocaleString()}+`;
  }
  if (key === 'onsite_willingness' && typeof value === 'object') {
    const v = value as { metros?: string[]; max_days_per_week?: number };
    // The concrete question is usually a yes/no gate; a textual answer is the
    // fallback for short-text variants.
    const days = v.max_days_per_week != null ? ` up to ${v.max_days_per_week} days/week` : '';
    return `Yes — based near ${(v.metros || []).join(' / ')}${days}`;
  }
  if (key.startsWith('eeoc_') && value === 'decline') return 'Decline to self-identify';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// Match a rendered answer to a select's options (Greenhouse wants option
// labels/ids, and "Decline to self-identify" phrasing varies).
function pickOption(answer: string | boolean, options: string[] | undefined): string | null {
  if (!options?.length) return typeof answer === 'boolean' ? (answer ? 'Yes' : 'No') : String(answer);
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (typeof answer === 'boolean') {
    const target = answer ? 'yes' : 'no';
    return options.find(o => norm(o).startsWith(target)) ?? null;
  }
  const a = norm(String(answer));
  return options.find(o => norm(o) === a)
      ?? options.find(o => norm(o).includes(a) || a.includes(norm(o)))
      ?? (a.startsWith('decline') ? options.find(o => /decline|do not wish|don.t wish/i.test(o)) ?? null : null);
}

type ReviewRow = {
  id: string;
  prompt: string;
  required: boolean;
  type: string;
  kind: 'field' | 'consent' | 'missing';
  canonical_key: string | null;
  answer: string | boolean | null;
  options?: string[];
};

async function buildReview(sql: Sql, userId: string, slug: string) {
  const role = (await sql`
    select slug, company_name, title, coalesce(canonical_apply_url, url) as apply_url, apply_ease, apply_schema
    from job.pipeline_roles where slug = ${slug} and deleted_at is null limit 1;
  `)[0];
  if (!role?.apply_url) throw new Error('role has no apply URL');

  // Schema precedence: the user's own draft extraction, then the role's
  // persisted apply_schema (written by classify/extract when the ATS API
  // last succeeded), then a fresh live extraction as the last resort. Live
  // extraction is flaky from the edge (ATS rate-limiting), so the persisted
  // copy is what keeps the review reliable.
  const draft = (await sql`
    select fields, answers from job.application_draft
    where user_id = ${userId} and role_slug = ${slug} limit 1;
  `)[0];
  const usable = (o: any) => o && (o.general?.length || o.custom_questions?.length) ? o as Schema : null;
  let persisted: any = draft?.fields;
  if (typeof persisted === 'string') { try { persisted = JSON.parse(persisted); } catch { persisted = null; } }
  let schema: Schema | null = usable(persisted) || usable(role.apply_schema);
  if (!schema) schema = await extractSchema(role.apply_url);

  const bankRows = await sql`
    select canonical_key, value from job.application_answers where user_id = ${userId};
  `;
  const bank = new Map<string, unknown>(bankRows.map((r: { canonical_key: string; value: unknown }) => [r.canonical_key, r.value]));
  const overrides = (draft?.answers && typeof draft.answers === 'object') ? draft.answers as Record<string, unknown> : {};

  const cov = computeCoverage(schema, new Set(bank.keys()));
  const rows: ReviewRow[] = [];
  for (const m of cov.mappings as QuestionMapping[]) {
    const schemaQ = (schema.custom_questions || []).find(q => q.id === m.id);
    const options = schemaQ?.options;
    let answer: string | boolean | null = null;
    if (overrides[m.id] !== undefined) answer = overrides[m.id] as string;
    else if (m.canonical_key && bank.has(m.canonical_key)) {
      answer = renderAnswer(m.canonical_key, bank.get(m.canonical_key), m.prompt);
    }
    rows.push({
      id: m.id, prompt: m.prompt, required: m.required, type: m.type,
      kind: m.consent ? 'consent' : (answer == null && m.required ? 'missing' : 'field'),
      canonical_key: m.canonical_key,
      answer,
      options,
    });
  }

  // Resume: role-tailored asset first, base resume otherwise.
  const asset = (await sql`
    select content_md from job.role_assets where role_slug = ${slug} and kind = 'resume' limit 1;
  `)[0] || (await sql`select content_md from job.global_assets where kind = 'resume' limit 1;`)[0];

  return {
    role: { slug: role.slug, company: role.company_name, title: role.title, apply_url: role.apply_url, apply_ease: role.apply_ease },
    ats: schema.ats,
    schema,
    rows,
    resume_available: !!asset?.content_md,
    resume_preview: asset?.content_md ? String(asset.content_md).slice(0, 400) : null,
    ready: rows.every(r => r.kind !== 'missing'),
  };
}

// ---- Greenhouse transport --------------------------------------------------
// Legacy boards.greenhouse.io multipart POST. Many boards accept it without a
// captcha; boards that enforce reCAPTCHA Enterprise reject — we detect and
// hand off to assisted mode. We NEVER attempt to solve or bypass a captcha.
async function submitGreenhouse(review: Awaited<ReturnType<typeof buildReview>>, resumeText: string | null): Promise<{ ok: boolean; reason?: string }> {
  const ats = detectAts(review.role.apply_url);
  if (ats.kind !== 'greenhouse') return { ok: false, reason: `transport for ${ats.kind} not implemented — assisted mode` };

  // Page-level captcha sniff before posting anything.
  const pageRes = await fetch(`https://boards.greenhouse.io/${ats.board}/jobs/${ats.id}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ctrl-rodeo-apply/0.1)' },
  });
  if (!pageRes.ok) return { ok: false, reason: `board page ${pageRes.status}` };
  const page = await pageRes.text();
  if (/g-recaptcha|data-sitekey|recaptcha\/enterprise|h-captcha/i.test(page)) {
    return { ok: false, reason: 'board enforces a CAPTCHA — completing it is on you, not the robot' };
  }
  const tokenMatch = page.match(/name="authenticity_token"[^>]*value="([^"]+)"/)
                  || page.match(/value="([^"]+)"[^>]*name="authenticity_token"/);
  if (!tokenMatch) return { ok: false, reason: 'no form token on board page — assisted mode' };

  const fd = new FormData();
  fd.set('utf8', '✓');
  fd.set('authenticity_token', tokenMatch[1]);
  const setField = (name: string, value: string) => fd.set(`job_application[${name}]`, value);

  // Contact fields come from mapped general rows.
  for (const r of review.rows) {
    if (r.kind === 'consent' || r.answer == null) continue;
    const q = (review.schema.custom_questions || []).find(q2 => q2.id === r.id);
    if (q) {
      const val = (q.type === 'select' || q.type === 'yes_no' || q.type === 'multiselect')
        ? pickOption(r.answer, q.options) : String(r.answer);
      if (val != null) fd.set(`job_application[answers_attributes][${r.id}]`, val);
    } else {
      // general field ids map to greenhouse names directly (first_name etc.)
      setField(r.id, String(r.answer));
    }
  }
  if (resumeText) fd.set('job_application[resume_text]', resumeText);

  const res = await fetch(`https://boards.greenhouse.io/${ats.board}/jobs/${ats.id}`, {
    method: 'POST',
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ctrl-rodeo-apply/0.1)' },
    body: fd,
    redirect: 'manual',
  });
  const body = res.status < 400 ? await res.text().catch(() => '') : '';
  if (res.status === 302 || /thank you|application.*(received|submitted)/i.test(body)) return { ok: true };
  return { ok: false, reason: `board rejected the POST (${res.status}) — assisted mode` };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return err('POST only', 405);

  try {
    const user = await verifyJobUserDetailed(req);
    if (!user) return err('unauthorized', 401);
    const sql = db();
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '');
    const slug = String(body.slug || '').toLowerCase();
    if (!SLUG_RE.test(slug)) return err('invalid slug', 400);

    if (action === 'prepare') {
      const review = await buildReview(sql, user.id, slug);
      // Persist the assembled answers for the record + later reuse.
      const answersById: Record<string, unknown> = {};
      for (const r of review.rows) if (r.answer != null) answersById[r.id] = r.answer;
      await sql`
        insert into job.application_draft (user_id, role_slug, apply_url, ats, fields, answers, current_step, status, extracted_at)
        values (${user.id}, ${slug}, ${review.role.apply_url}, ${review.ats},
                ${sql.json(review.schema)}, ${sql.json(answersById)}, 'review', 'draft', now())
        on conflict (user_id, role_slug) do update set
          fields = ${sql.json(review.schema)},
          answers = ${sql.json(answersById)},
          current_step = 'review',
          updated_at = now();
      `;
      // Don't ship the whole schema back — rows carry everything the UI needs.
      const { schema: _s, ...rest } = review;
      return jsonResp(rest);
    }

    if (action === 'submit') {
      if (body.confirm !== true) return err('missing explicit confirm', 400);
      const review = await buildReview(sql, user.id, slug);

      // Apply overrides typed on the review screen, then re-check readiness.
      const overrides = (body.overrides && typeof body.overrides === 'object') ? body.overrides as Record<string, string> : {};
      for (const r of review.rows) {
        if (overrides[r.id] !== undefined) { r.answer = overrides[r.id]; if (r.kind === 'missing') r.kind = 'field'; }
      }
      const consentRows = review.rows.filter(r => r.kind === 'consent');
      const ticked = new Set(Array.isArray(body.consents) ? body.consents : []);
      const unticked = consentRows.filter(r => !ticked.has(r.id));
      if (unticked.length) return jsonResp({ status: 'consent_required', items: unticked.map(r => ({ id: r.id, prompt: r.prompt })) });
      const missing = review.rows.filter(r => r.kind === 'missing');
      if (missing.length) return jsonResp({ status: 'incomplete', missing: missing.map(r => r.prompt) });

      // Guardrails: flag, daily cap, liveness.
      if (Deno.env.get('SUBMIT_ENABLED') !== 'true') {
        return jsonResp({ status: 'assisted_required', reason: 'server-side submission is flag-gated off (SUBMIT_ENABLED) — use assisted apply' });
      }
      const cap = Number(((await sql`
        select value from job.application_answers
        where user_id = ${user.id} and canonical_key = 'policy_daily_cap' limit 1;
      `)[0]?.value) ?? 5) || 5;
      const todayCount = Number((await sql`
        select count(*) as n from job.application_events
        where source = 'easy-apply' and created_at > now() - interval '24 hours';
      `)[0]?.n ?? 0);
      if (todayCount >= cap) return jsonResp({ status: 'capped', reason: `daily cap (${cap}) reached` });

      const live = await fetch(review.role.apply_url, { method: 'GET', redirect: 'follow' }).then(r => r.ok).catch(() => false);
      if (!live) return jsonResp({ status: 'assisted_required', reason: 'posting did not respond as live at submit time' });

      const resume = (await sql`
        select content_md from job.role_assets where role_slug = ${slug} and kind = 'resume' limit 1;
      `)[0] || (await sql`select content_md from job.global_assets where kind = 'resume' limit 1;`)[0];

      const result = await submitGreenhouse(review, resume?.content_md ?? null);
      if (!result.ok) return jsonResp({ status: 'assisted_required', reason: result.reason });

      // Success: snapshot + stage move + event.
      const answersById: Record<string, unknown> = {};
      for (const r of review.rows) if (r.answer != null) answersById[r.id] = r.answer;
      await sql`
        update job.application_draft set
          answers = ${sql.json(answersById)}, status = 'submitted', submitted_at = now(), updated_at = now()
        where user_id = ${user.id} and role_slug = ${slug};
      `;
      await sql`
        update job.pipeline_roles set
          status = 'Active', stage = 'applied', applied_at = coalesce(applied_at, now()),
          status_changed_at = now(), engaged_at = coalesce(engaged_at, now()),
          status_history = coalesce(status_history, '[]'::jsonb)
            || jsonb_build_array(jsonb_build_object('status', 'Active/applied', 'at', now(), 'by', 'easy-apply'))
        where slug = ${slug};
      `;
      const ts = new Date().toISOString();
      await sql`
        insert into job.application_events
          (role_slug, gmail_message_id, gmail_thread_id, event_type, detected_stage, summary,
           confidence, auto_applied, needs_review, received_at, source)
        values
          (${slug}, ${`easyapply:${slug}:${ts}`}, ${`easyapply:${slug}:${ts}`}, 'applied_confirmation', 'applied',
           ${'Submitted via Easy Apply to ' + (review.role.company || slug)}, 1.0, true, false, now(), 'easy-apply');
      `;
      return jsonResp({ status: 'submitted', slug });
    }

    return err(`unknown action '${action}'`, 400);
  } catch (e) {
    console.error('[submit-application] error', e);
    return err((e as Error).message || 'server error', 500);
  }
});
