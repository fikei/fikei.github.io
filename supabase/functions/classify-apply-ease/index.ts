// classify-apply-ease — sweep Saved + Drafting pipeline roles, extract each
// application form, and stamp an apply-ease tier onto the row so the tables
// can badge "⚡ Easy apply" without the user opening anything.
//
//   POST {}              → batch (oldest-checked first). User auth or cron.
//   POST { slug }        → single role, force-recheck (user auth).
//   POST cron mode       → header 'x-cron-secret: <CRON_SECRET>' bypasses
//                          user auth. Scheduled in migration 104.
//
// LinkedIn saves carry an aggregator URL, not the form. We resolve the
// offsite apply URL via LinkedIn's guest jobPosting endpoint (no auth) and
// store it in canonical_apply_url; classification runs against that. When
// resolution fails (blocked IP, native Easy Apply, closed job) the row is
// stamped `unknown` with a reason and retried on the next stale cycle.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { verifyJobUser, jsonResp, err, corsHeaders } from '../_shared/job-auth.ts';
import { db } from '../_shared/job-db.ts';
import { extractSchema } from '../_shared/apply-extract.ts';
import { classifyApplyEase, type ApplyEaseTier, type ApplyEaseMeta } from '../_shared/apply-ease.ts';

const VERSION = '0.1.0';
console.log(`[classify-apply-ease] v${VERSION} - apply-ease sweep for Saved+Drafting`);

const BATCH = 8;
const STALE_DAYS = 14;
const LI_JOB_RE = /linkedin\.com\/jobs\/view\/(\d+)/i;

type RowResult = {
  slug: string;
  tier: ApplyEaseTier;
  applyUrl: string | null;
  reason?: string;
};

// ----- LinkedIn guest resolution ------------------------------------------
// The guest jobPosting endpoint serves the public job card HTML. Offsite
// jobs embed the external apply URL in <code id="applyUrl">…</code> (JSON
// string, sometimes wrapped in an interstitial redirect). Best-effort: any
// failure returns null and the role stays `unknown` until the next cycle.
async function resolveLinkedInApplyUrl(jobId: string): Promise<{ url: string | null; closed: boolean }> {
  try {
    const res = await fetch(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${jobId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });
    if (!res.ok) return { url: null, closed: res.status === 404 };
    const html = await res.text();
    const closed = /no longer accepting applications/i.test(html);

    const m = html.match(/<code[^>]*id="applyUrl"[^>]*>([\s\S]*?)<\/code>/i);
    if (!m) return { url: null, closed };
    let raw = m[1].replace(/<!--|-->/g, '').trim();
    try { raw = JSON.parse(raw); } catch { /* already a plain string */ }
    // LinkedIn wraps externals in a click-tracking interstitial with the
    // target in ?url=.
    try {
      const u = new URL(String(raw));
      const inner = u.searchParams.get('url');
      return { url: inner ? decodeURIComponent(inner) : String(raw), closed };
    } catch {
      return { url: null, closed };
    }
  } catch (e) {
    console.warn('[classify-apply-ease] linkedin resolve failed', jobId, (e as Error).message);
    return { url: null, closed: false };
  }
}

async function classifyRole(sql: ReturnType<typeof db>, row: { slug: string; url: string; canonical_apply_url: string | null }): Promise<RowResult> {
  let applyUrl = row.canonical_apply_url || row.url;
  let tier: ApplyEaseTier = 'unknown';
  let meta: ApplyEaseMeta | { reason: string; source_url: string } = { reason: 'unclassified', source_url: applyUrl };

  // LinkedIn aggregator link → resolve to the underlying ATS first.
  const li = applyUrl.match(LI_JOB_RE);
  if (li) {
    const resolved = await resolveLinkedInApplyUrl(li[1]);
    if (resolved.closed) {
      meta = { reason: 'closed on LinkedIn', source_url: applyUrl };
      await sql`
        update job.pipeline_roles set
          apply_ease = 'unknown',
          apply_ease_meta = ${sql.json(meta)},
          apply_ease_checked_at = now(),
          is_live = false,
          closed_detected_at = coalesce(closed_detected_at, now())
        where slug = ${row.slug};
      `;
      return { slug: row.slug, tier: 'unknown', applyUrl: null, reason: 'closed on LinkedIn' };
    }
    if (!resolved.url) {
      meta = { reason: 'linkedin apply URL unresolved', source_url: applyUrl };
      await sql`
        update job.pipeline_roles set
          apply_ease = 'unknown',
          apply_ease_meta = ${sql.json(meta)},
          apply_ease_checked_at = now()
        where slug = ${row.slug};
      `;
      return { slug: row.slug, tier: 'unknown', applyUrl: null, reason: 'linkedin unresolved' };
    }
    applyUrl = resolved.url;
    await sql`update job.pipeline_roles set canonical_apply_url = ${applyUrl} where slug = ${row.slug};`;
  }

  if (applyUrl.startsWith('mailto:')) {
    tier = 'special';
    meta = { reason: 'apply by email', source_url: applyUrl };
  } else {
    const schema = await extractSchema(applyUrl);
    const c = classifyApplyEase(schema);
    tier = c.tier;
    meta = c.meta;
  }

  await sql`
    update job.pipeline_roles set
      apply_ease = ${tier},
      apply_ease_meta = ${sql.json(meta)},
      apply_ease_checked_at = now()
    where slug = ${row.slug};
  `;
  return { slug: row.slug, tier, applyUrl, reason: (meta as ApplyEaseMeta).reason };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return err('POST only', 405);

  const cronSecret = req.headers.get('x-cron-secret');
  const expected = Deno.env.get('CRON_SECRET');
  const cronAuthed = expected && cronSecret && cronSecret === expected;

  if (!cronAuthed) {
    const email = await verifyJobUser(req);
    if (!email) return err('unauthorized', 401);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const slug = body.slug ? String(body.slug).toLowerCase() : undefined;

    const sql = db();
    const rows = slug
      ? await sql`
          select slug, url, canonical_apply_url from job.pipeline_roles
          where slug = ${slug} and url is not null
            and deleted_at is null and archived_at is null;
        `
      : await sql`
          select slug, url, canonical_apply_url from job.pipeline_roles
          where url is not null
            and deleted_at is null and archived_at is null
            and (status = 'Saved' or (status = 'Active' and coalesce(stage, 'drafting') = 'drafting'))
            and (apply_ease_checked_at is null or apply_ease_checked_at < now() - make_interval(days => ${STALE_DAYS}))
          order by apply_ease_checked_at nulls first
          limit ${BATCH};
        `;

    const results: RowResult[] = [];
    for (const r of rows) {
      try {
        results.push(await classifyRole(sql, r));
      } catch (e) {
        console.warn('[classify-apply-ease] role failed', r.slug, (e as Error).message);
        // Stamp checked_at so one persistently-broken URL can't wedge the
        // sweep at the front of the oldest-first queue forever.
        await sql`
          update job.pipeline_roles set
            apply_ease = 'unknown',
            apply_ease_meta = ${sql.json({ reason: `extraction error: ${(e as Error).message.slice(0, 120)}` })},
            apply_ease_checked_at = now()
          where slug = ${r.slug};
        `;
        results.push({ slug: r.slug, tier: 'unknown', applyUrl: null, reason: 'extraction error' });
      }
    }

    return jsonResp({
      ok: true,
      version: VERSION,
      checked: results.length,
      tiers: results.reduce((acc, r) => { acc[r.tier] = (acc[r.tier] || 0) + 1; return acc; }, {} as Record<string, number>),
      results,
    });
  } catch (e) {
    console.error('[classify-apply-ease] error', e);
    return err((e as Error).message || 'server error', 500);
  }
});
