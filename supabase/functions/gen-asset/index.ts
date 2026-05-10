// gen-asset — generate a resume or cover letter for a pipeline role using
// Ian's career KB + Anthropic Claude, then commit the result to Postgres
// (job.role_assets). KB is read from job.* tables (cutover from GitHub).
//
// POST { slug?, rowNumber?, kind: 'resume' | 'cover-letter' }
//   → { slug, kind, content }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { verifyJobUser, jsonResp, err, corsHeaders } from '../_shared/job-auth.ts';
import { db } from '../_shared/job-db.ts';
import { buildSystemPrompt, buildUserMessage } from './prompts.ts';

const VERSION = '0.4.0';
console.log(`[gen-asset] v${VERSION} - format-resume kind: reformat raw text into clean markdown`);

const BASE_RESUME_SLUG = '__base__';

const ANTHROPIC_MODEL = 'claude-haiku-4-5';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

async function loadRole(slug: string | null, rowNumber: number | null) {
  const sql = db();
  const rows = await sql`
    select slug, source_row, company_name as company, title, url, sector, salary_range as salary
    from job.pipeline_roles
    where (${slug}::text is not null and slug = ${slug})
       or (${rowNumber}::int is not null and source_row = ${rowNumber})
    limit 1;
  `;
  return rows[0] || null;
}

async function loadKb(): Promise<string> {
  const sql = db();
  const [companies, projects, skills, wins, vision] = await Promise.all([
    sql`select slug, name, sector, stage_at_time, location, body_md from job.companies`,
    sql`select slug, company_slug, title, role, body_md, metric_value from job.projects`,
    sql`select slug, name, type, level, years_practiced, body_md, cover_letter_blurb from job.skills`,
    sql`select slug, company_slug, project_slug, headline, body_md, metric_value from job.wins`,
    sql`select narrative_arc, voice_rules_md, raw_md from job.vision where id = 1`,
  ]);

  const sections: string[] = [];

  if (vision[0]?.raw_md) sections.push(`## Vision\n\n${vision[0].raw_md}`);
  for (const c of companies) {
    sections.push(`## Company: ${c.name} (${c.slug})\n\n${c.body_md || ''}`);
  }
  for (const p of projects) {
    sections.push(`## Project: ${p.title} (${p.slug}) — company=${p.company_slug || 'n/a'}\n\n${p.body_md || ''}`);
  }
  for (const s of skills) {
    sections.push(`## Skill: ${s.name} (${s.slug}) — ${s.type || ''} ${s.level || ''}\n\n${s.body_md || ''}`);
  }
  for (const w of wins) {
    sections.push(`## Win: ${w.headline} (${w.slug}) — metric=${w.metric_value || 'n/a'}\n\n${w.body_md || ''}`);
  }
  return sections.join('\n\n---\n\n');
}

async function callClaude(system: string, user: string): Promise<string> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 4096,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`anthropic ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json() as { content: { type: string; text: string }[] };
  const text = (data.content || [])
    .filter(c => c.type === 'text')
    .map(c => c.text)
    .join('\n')
    .trim();
  if (!text) throw new Error('empty model output');
  return text;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return err('POST only', 405);

  try {
    const email = await verifyJobUser(req);
    if (!email) return err('unauthorized', 401);

    const body = await req.json().catch(() => ({}));
    const slugIn = body.slug ? String(body.slug).toLowerCase() : null;
    const rowIn = Number.isInteger(Number(body.rowNumber)) ? Number(body.rowNumber) : null;
    const kindIn = body.kind;
    const kind: 'resume' | 'cover-letter' | 'analysis' | 'base-resume' | 'format-resume' | null =
      kindIn === 'cover-letter' ? 'cover-letter'
      : kindIn === 'resume'     ? 'resume'
      : kindIn === 'analysis'   ? 'analysis'
      : kindIn === 'base-resume' ? 'base-resume'
      : kindIn === 'format-resume' ? 'format-resume'
      : null;
    if (!kind) return err('kind must be "resume", "cover-letter", "analysis", "base-resume", or "format-resume"', 400);

    // format-resume is stateless: take raw text in, return clean markdown.
    // Does not touch the DB. The frontend persists separately.
    if (kind === 'format-resume') {
      const rawText = String(body.raw_text || '').trim();
      if (!rawText) return err('raw_text required', 400);
      if (rawText.length > 32 * 1024) return err('raw_text exceeds 32KB', 413);
      const system = buildSystemPrompt(kind);
      const content = await callClaude(system, rawText);
      return jsonResp({ ok: true, kind, content });
    }

    // base-resume is global — no role required, persisted in job.global_assets.
    if (kind === 'base-resume') {
      const kb = await loadKb();
      const system = buildSystemPrompt(kind);
      const user = buildUserMessage(kind, kb, null);
      const content = await callClaude(system, user);
      const sql = db();
      await sql`
        insert into job.global_assets (kind, content_md, generated_by, generated_at)
        values ('base-resume', ${content}, ${ANTHROPIC_MODEL}, now())
        on conflict (kind) do update set
          content_md = excluded.content_md,
          generated_by = excluded.generated_by,
          generated_at = excluded.generated_at,
          updated_at = now();
      `;
      return jsonResp({ ok: true, slug: BASE_RESUME_SLUG, kind, content });
    }

    if (!slugIn && !rowIn) return err('slug or rowNumber required', 400);

    const role = await loadRole(slugIn, rowIn);
    if (!role) return err('role not found', 404);

    const kb = await loadKb();
    const system = buildSystemPrompt(kind);
    const user = buildUserMessage(kind, kb, {
      company: role.company,
      title: role.title,
      sector: role.sector,
      salary: role.salary,
      url: role.url,
    });

    const content = await callClaude(system, user);

    const sql = db();
    await sql`
      insert into job.role_assets (role_slug, kind, content_md, generated_by, generated_at)
      values (${role.slug}, ${kind}, ${content}, ${ANTHROPIC_MODEL}, now())
      on conflict (role_slug, kind) do update set
        content_md = excluded.content_md,
        generated_by = excluded.generated_by,
        generated_at = excluded.generated_at,
        updated_at = now();
    `;

    return jsonResp({ ok: true, slug: role.slug, kind, content });
  } catch (e) {
    console.error('[gen-asset] error', e);
    return err((e as Error).message || 'server error', 500);
  }
});
