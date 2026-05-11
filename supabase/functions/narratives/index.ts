// narratives — CRUD for discrete career stories with AI auto-tagging.
//
//   GET                 → { narratives: [...] }
//   POST  { title, content_md, id? } → upsert; runs an AI tag+link pass
//                                       on write and persists the result
//   POST  { id, linked_company_slug } → explicit re-link (skips AI)
//   POST  { id, delete: true }        → delete
//
// Auto-tag flow: when the user saves a narrative, we send the story +
// the canonical work-history company list + the user's vision (job
// goals / industry framing) to Claude Haiku. The model returns:
//   { tags: [...], linked_company_slug, confidence: 0..1 }
// We persist the tags unconditionally and set linked_company_slug only
// when confidence ≥ 0.6. Below that, needs_link=true so the UI prompts
// the user to wire it up.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { verifyJobUser, jsonResp, err, corsHeaders } from '../_shared/job-auth.ts';
import { db } from '../_shared/job-db.ts';

const VERSION = '0.1.0';
console.log(`[narratives] v${VERSION} - CRUD + AI auto-tag/link`);

const ANTHROPIC_MODEL = 'claude-haiku-4-5';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ID_RE = /^[a-z0-9_-]+$/;
const LINK_CONFIDENCE_FLOOR = 0.6;
const MAX_CONTENT = 16 * 1024;
const MAX_TITLE = 256;

function newId(): string {
  return Math.random().toString(36).slice(2, 12);
}

async function callClaudeJson(system: string, user: string): Promise<any> {
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
      max_tokens: 1024,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json() as { content: { type: string; text: string }[] };
  const text = (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('').trim();
  const stripped = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  try { return JSON.parse(stripped); } catch { return null; }
}

const TAG_SYSTEM = `You tag a candidate's career story for indexing.

You will receive:
- The narrative (a short story the candidate has written or extracted from a longer source).
- The candidate's job goals / industry framing (vision).
- A list of the canonical companies in their work history, each with slug + name + sector.

Return JSON only — no prose, no fence:
{
  "tags":                  ["..." x 3-6],   // freeform: industry (e.g. "healthcare", "fintech"), skill (e.g. "platform", "growth", "compliance"), theme (e.g. "zero-to-one", "founding-pm", "scale", "regulated"). Lowercase, hyphen-separated. Don't invent words that aren't supported by the narrative.
  "linked_company_slug":   "<slug or null>",// best-match company from the provided list. Use the exact slug. Null if the narrative doesn't clearly belong to any listed company.
  "confidence":            0.0..1.0,        // your confidence in linked_company_slug; ≥0.6 means we'll auto-link, below means we'll ask the user.
  "reason":                "..."            // one short sentence — why this company (or why no match).
}

Rules:
- Tags must be substantive. Skip generic ones like "story", "experience", "career".
- Prefer the candidate's framing (vision) for industry/theme tags so they match their job-search target.
- linked_company_slug must be a verbatim slug from the provided list — never invent one.
- If the story spans multiple companies, pick the one most central to it; the user can override.`;

async function tagNarrative(narrativeText: string, opts: { title: string }): Promise<{ tags: string[]; linked_company_slug: string | null; confidence: number; reason: string }> {
  const sql = db();
  const [companies, vision] = await Promise.all([
    sql`select slug, name, sector from job.companies order by name`,
    sql`select narrative_arc, raw_md from job.vision where id = 1`,
  ]);
  const visionText = (vision[0]?.narrative_arc || vision[0]?.raw_md || '').slice(0, 4000);
  const companyList = companies.map((c: any) => `- ${c.slug}: ${c.name}${c.sector ? ` — ${c.sector}` : ''}`).join('\n');
  const user = `# Vision\n\n${visionText || '(no vision recorded)'}\n\n# Companies\n\n${companyList || '(no companies recorded)'}\n\n# Narrative title\n\n${opts.title}\n\n# Narrative\n\n${narrativeText}\n\n# Ask\n\nProduce the JSON object now. JSON only.`;
  const parsed = await callClaudeJson(TAG_SYSTEM, user);
  return {
    tags:                Array.isArray(parsed?.tags) ? parsed.tags.slice(0, 8).map((t: any) => String(t).toLowerCase().trim()).filter(Boolean) : [],
    linked_company_slug: typeof parsed?.linked_company_slug === 'string' ? parsed.linked_company_slug : null,
    confidence:          Number(parsed?.confidence) || 0,
    reason:              String(parsed?.reason || ''),
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const email = await verifyJobUser(req);
    if (!email) return err('unauthorized', 401);
    const sql = db();

    if (req.method === 'GET') {
      const rows = await sql`
        select id, title, content_md, tags, linked_company_slug, needs_link,
               source_role, created_at, updated_at
        from job.narratives
        order by updated_at desc;
      `;
      return jsonResp({ narratives: rows });
    }

    if (req.method !== 'POST') return err('GET or POST only', 405);

    const body = await req.json().catch(() => ({}));

    // Delete branch
    if (body.delete === true) {
      const id = String(body.id || '');
      if (!ID_RE.test(id)) return err('invalid id', 400);
      await sql`delete from job.narratives where id = ${id}`;
      return jsonResp({ ok: true, deleted: id });
    }

    // Explicit re-link (no AI re-run)
    if (body.linked_company_slug !== undefined && !body.content_md && !body.title) {
      const id = String(body.id || '');
      if (!ID_RE.test(id)) return err('invalid id', 400);
      const slug = body.linked_company_slug ? String(body.linked_company_slug) : null;
      if (slug) {
        const ok = await sql`select 1 from job.companies where slug = ${slug} limit 1`;
        if (ok.length === 0) return err('linked_company_slug not found', 404);
      }
      const rows = await sql`
        update job.narratives
           set linked_company_slug = ${slug},
               needs_link = ${slug ? false : true}
         where id = ${id}
         returning id, title, content_md, tags, linked_company_slug, needs_link,
                   source_role, created_at, updated_at;
      `;
      if (rows.length === 0) return err('narrative not found', 404);
      return jsonResp({ narrative: rows[0] });
    }

    // Upsert with auto-tag pass
    const id = String(body.id || '') || newId();
    if (!ID_RE.test(id)) return err('invalid id', 400);
    const title = String(body.title || '').trim().slice(0, MAX_TITLE);
    const content_md = String(body.content_md || '').trim();
    const sourceRole = body.source_role ? String(body.source_role).slice(0, 256) : null;
    if (!title) return err('title required', 400);
    if (!content_md) return err('content_md required', 400);
    if (content_md.length > MAX_CONTENT) return err(`content_md exceeds ${MAX_CONTENT} bytes`, 413);

    // Best-effort AI tag pass. If it fails, persist with empty tags +
    // needs_link=true so the user can wire things up by hand.
    let tags: string[] = [];
    let linkedSlug: string | null = null;
    let needsLink = true;
    try {
      const ai = await tagNarrative(content_md, { title });
      tags = ai.tags;
      if (ai.linked_company_slug && ai.confidence >= LINK_CONFIDENCE_FLOOR) {
        const ok = await sql`select 1 from job.companies where slug = ${ai.linked_company_slug} limit 1`;
        if (ok.length > 0) {
          linkedSlug = ai.linked_company_slug;
          needsLink = false;
        }
      }
    } catch (e) {
      console.warn('[narratives] AI tag pass failed', e);
    }

    const rows = await sql`
      insert into job.narratives (id, title, content_md, tags, linked_company_slug, needs_link, source_role)
      values (${id}, ${title}, ${content_md}, ${tags}, ${linkedSlug}, ${needsLink}, ${sourceRole})
      on conflict (id) do update set
        title               = excluded.title,
        content_md          = excluded.content_md,
        tags                = excluded.tags,
        linked_company_slug = excluded.linked_company_slug,
        needs_link          = excluded.needs_link,
        source_role         = excluded.source_role,
        updated_at          = now()
      returning id, title, content_md, tags, linked_company_slug, needs_link,
                source_role, created_at, updated_at;
    `;
    return jsonResp({ narrative: rows[0] });
  } catch (e) {
    console.error('[narratives] error', e);
    return err((e as Error).message || 'server error', 500);
  }
});
