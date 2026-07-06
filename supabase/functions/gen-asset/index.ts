// gen-asset — generate a resume or cover letter for a pipeline role using
// Ian's career KB + Anthropic Claude, then commit the result to Postgres
// (job.role_assets). KB is read from job.* tables (cutover from GitHub).
//
// POST { slug?, rowNumber?, kind: 'resume' | 'cover-letter' }
//   → { slug, kind, content }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { verifyJobUser, jsonResp, err, corsHeaders } from '../_shared/job-auth.ts';
import { db } from '../_shared/job-db.ts';
import { loadVisionField } from '../_shared/job-vision.ts';
import { buildSystemPrompt, buildUserMessage } from './prompts.ts';

const VERSION = '0.8.0';
console.log(`[gen-asset] v${VERSION} - career-opportunities kind: AI audit of work history + narratives`);

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
  const [companies, projects, skills, wins, rawMd] = await Promise.all([
    sql`select slug, name, sector, stage_at_time, location, body_md from job.companies`,
    sql`select slug, company_slug, title, role, body_md, metric_value from job.projects`,
    sql`select slug, name, type, level, years_practiced, body_md, cover_letter_blurb from job.skills`,
    sql`select slug, company_slug, project_slug, headline, body_md, metric_value from job.wins`,
    loadVisionField<string>(sql, 'raw_md'),
  ]);

  const sections: string[] = [];

  if (rawMd) sections.push(`## Vision\n\n${rawMd}`);
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
  const apiKey = (Deno.env.get('LADDER_ANTHROPIC_API_KEY') || Deno.env.get('ANTHROPIC_API_KEY'));
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
    const kind: 'resume' | 'cover-letter' | 'analysis' | 'base-resume' | 'format-resume' | 'cover-rationale' | 'cover-edit' | 'narrative-add' | 'career-opportunities' | null =
      kindIn === 'cover-letter' ? 'cover-letter'
      : kindIn === 'resume'     ? 'resume'
      : kindIn === 'analysis'   ? 'analysis'
      : kindIn === 'base-resume' ? 'base-resume'
      : kindIn === 'format-resume' ? 'format-resume'
      : kindIn === 'cover-rationale' ? 'cover-rationale'
      : kindIn === 'cover-edit' ? 'cover-edit'
      : kindIn === 'narrative-add' ? 'narrative-add'
      : kindIn === 'career-opportunities' ? 'career-opportunities'
      : null;
    if (!kind) return err('kind must be a known value', 400);

    // narrative-add: append a markdown snippet to job.global_assets with
    // kind='narrative-additions'. No AI call — pure persistence. The
    // frontend uses this from opportunity threads to capture missing
    // info the candidate volunteers.
    if (kind === 'narrative-add') {
      const snippet = String(body.snippet || '').trim();
      const sourceRole = String(body.source_role || '').trim();
      const ask = String(body.ask || '').trim();
      if (!snippet) return err('snippet required', 400);
      if (snippet.length > 8 * 1024) return err('snippet exceeds 8KB', 413);
      const ts = new Date().toISOString();
      const header = `\n\n### ${ts.slice(0, 10)}${sourceRole ? ` — from ${sourceRole}` : ''}${ask ? `\n_${ask}_` : ''}\n\n`;
      const blob = header + snippet + '\n';
      const sql = db();
      await sql`
        insert into job.global_assets (kind, content_md, generated_by, edited_at)
        values ('narrative-additions', ${blob}, 'manual', now())
        on conflict (kind) do update set
          content_md = job.global_assets.content_md || ${blob},
          edited_at = now(),
          updated_at = now();
      `;
      return jsonResp({ ok: true, kind });
    }

    // cover-edit is stateless: take cover letter + comment context +
    // user instruction, return the full revised markdown. No DB write —
    // the frontend persists via writeRoleAsset.
    if (kind === 'cover-edit') {
      const coverText = String(body.cover_text || '').trim();
      const instruction = String(body.instruction || '').trim();
      const comment = body.comment && typeof body.comment === 'object' ? body.comment : null;
      if (!coverText) return err('cover_text required', 400);
      if (!instruction) return err('instruction required', 400);
      if (coverText.length > 16 * 1024) return err('cover_text exceeds 16KB', 413);
      if (instruction.length > 2 * 1024) return err('instruction exceeds 2KB', 413);
      const system = buildSystemPrompt(kind);
      const commentBlock = comment
        ? `# Anchored comment\n\nLabel: ${String(comment.label || '')}\nAnchor phrase: ${String(comment.anchor_phrase || '')}\nRationale: ${String(comment.rationale || '')}\n\n`
        : '';
      const user = `# Cover letter

${coverText}

${commentBlock}# Instruction

${instruction}

# Ask

Return the full revised cover letter markdown. Markdown only, no preamble.`;
      const content = await callClaude(system, user);
      return jsonResp({ ok: true, kind, content });
    }

    // cover-rationale is stateless: take cover letter + analysis sources,
    // return a JSON list of {phrase, label, rationale}. No DB write.
    if (kind === 'cover-rationale') {
      const coverText = String(body.cover_text || '').trim();
      const sources = Array.isArray(body.sources) ? body.sources : [];
      if (!coverText) return err('cover_text required', 400);
      if (!sources.length) return err('sources required', 400);
      if (coverText.length > 16 * 1024) return err('cover_text exceeds 16KB', 413);
      const system = buildSystemPrompt(kind);
      const user = `# Cover letter

${coverText}

# Sources

${sources.map((s: any) => `## ${s.label || ''}\n${s.text || ''}`).join('\n\n')}

# Ask

Produce the JSON object now. JSON only.`;
      const raw = await callClaude(system, user);
      const stripped = raw.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
      let parsed: any = null;
      try { parsed = JSON.parse(stripped); } catch { /* ignore */ }
      const highlights = Array.isArray(parsed?.highlights) ? parsed.highlights : [];
      const opportunities = Array.isArray(parsed?.opportunities) ? parsed.opportunities : [];
      return jsonResp({ ok: true, kind, highlights, opportunities });
    }

    // career-opportunities: audit work history + narratives + KB and
    // return the highest-leverage gaps to fill. Stateless — frontend
    // shows them as callouts and persists the answers via narrative-add
    // or project upserts as appropriate.
    if (kind === 'career-opportunities') {
      const sql = db();
      const [narrativeArc, rawMd, companies, projects, clients, narratives] = await Promise.all([
        loadVisionField<string>(sql, 'narrative_arc'),
        loadVisionField<string>(sql, 'raw_md'),
        sql`select slug, name, sector, body_md from job.companies`,
        sql`select id, company_slug, role_title, name, description, outcome, metric from job.role_projects`,
        sql`select project_id, name, kind, description from job.project_clients`,
        sql`select id, title, tags, linked_company_slug, content_md from job.narratives`,
      ]);
      const visionText = (narrativeArc || rawMd || '').slice(0, 6000);
      const clientsByProject = new Map<string, any[]>();
      for (const c of clients) {
        if (!clientsByProject.has(c.project_id)) clientsByProject.set(c.project_id, []);
        clientsByProject.get(c.project_id)!.push(c);
      }
      const projectsByCompany = new Map<string, any[]>();
      for (const p of projects) {
        if (!projectsByCompany.has(p.company_slug)) projectsByCompany.set(p.company_slug, []);
        projectsByCompany.get(p.company_slug)!.push({ ...p, clients: clientsByProject.get(p.id) || [] });
      }
      const companyBlocks = companies.map((c: any) => {
        const ps = (projectsByCompany.get(c.slug) || []).map((p: any) =>
          `  - Project ${p.id}: ${p.name}${p.metric ? ` (metric: ${p.metric})` : ''}${p.outcome ? ` — outcome: ${p.outcome.slice(0, 160)}` : ''}${p.clients.length ? ` — clients: ${p.clients.map((c: any) => `${c.name} [${c.kind}]`).join(', ')}` : ''}`
        ).join('\n');
        return `## ${c.slug}: ${c.name}${c.sector ? ` — ${c.sector}` : ''}\n${ps || '  (no projects captured)'}`;
      }).join('\n\n');
      const narrativeBlocks = narratives.map((n: any) =>
        `- ${n.id}: "${n.title}" — tags: ${(n.tags || []).join(', ') || '(none)'} — linked: ${n.linked_company_slug || '(unlinked)'}`
      ).join('\n');

      const system = buildSystemPrompt(kind);
      const user = `# Vision\n\n${visionText || '(no vision recorded)'}\n\n# Work history\n\n${companyBlocks || '(no companies)'}\n\n# Existing narratives\n\n${narrativeBlocks || '(no narratives yet)'}\n\n# Ask\n\nProduce the JSON object now. JSON only.`;
      const raw = await callClaude(system, user);
      const stripped = raw.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
      let parsedOps: any = null;
      try { parsedOps = JSON.parse(stripped); } catch { /* ignore */ }
      const opportunities = Array.isArray(parsedOps?.opportunities) ? parsedOps.opportunities : [];
      return jsonResp({ ok: true, kind, opportunities });
    }

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
