// opportunities — persisted Career-Opportunities cache + on-demand audit.
//
//   GET                          → { opportunities: [...open...], last_audit_ts, stale }
//   POST { audit: true }         → run a fresh AI audit; replace open rows
//   POST { dismiss: id }         → mark dismissed_at
//   POST { resolve: id, narrative_id? } → mark resolved_at + link narrative
//
// "stale" is true when the latest narrative.updated_at is newer than the
// most recent audit_ts. The frontend reuses the cached list on every
// page load (instant) and triggers a background re-audit only when
// stale — matching the user's "reuse from BE unless a new matching
// story has been added since last load" requirement.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { verifyJobUser, jsonResp, err, corsHeaders } from '../_shared/job-auth.ts';
import { db } from '../_shared/job-db.ts';
import { loadVisionField } from '../_shared/job-vision.ts';

const VERSION = '0.1.0';
console.log(`[opportunities] v${VERSION} - persisted audit cache + stale check`);

const ANTHROPIC_MODEL = 'claude-haiku-4-5';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ID_RE = /^[a-z0-9_-]+$/;

function newId(): string { return Math.random().toString(36).slice(2, 12); }

const AUDIT_SYSTEM = `You audit a candidate's career KB and surface the highest-leverage gaps to fill — places where adding a story, project detail, metric, or client name would materially improve every future cover letter, resume, or pitch.

You will receive:
- The candidate's vision (job goals / industry framing).
- Their work history (companies + roles + role-projects + clients).
- Their existing narratives (titles + tags + linked company).

Return 4–8 opportunities, prioritized by leverage. Each:
- "title":      short, action-oriented (≤8 words).
- "gap":        one sentence (≤25 words) — what's missing and why it matters for the job-search target. Reference specific company/role/project slugs when relevant.
- "ask":        one short question (≤20 words), second person, the candidate can answer to fill the gap.
- "scope":      one of "narrative" | "project" | "client" | "metric".
- "anchor_company_slug": exact slug from the work history if anchored; null otherwise.

Output ONLY a JSON object: { "opportunities": [...] }. No prose, no code fence.

Rules:
- Don't suggest filling things already captured in the narratives.
- Be specific. Skip generic asks.
- Prefer fillable gaps (one metric, one story) over open-ended ones.
- Lean toward the candidate's job-search target when prioritizing.`;

async function callClaudeJson(system: string, user: string, maxTokens = 4096): Promise<any> {
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
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json() as { content: { type: string; text: string }[]; stop_reason?: string };
  const text = (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('').trim();
  let stripped = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '').trim();
  try { return JSON.parse(stripped); } catch { /* */ }
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(stripped.slice(start, end + 1)); } catch { /* */ }
  }
  console.warn('[opportunities] JSON parse failed', { stop_reason: data.stop_reason, head: text.slice(0, 200), tail: text.slice(-200) });
  return null;
}

async function runAudit(sql: any): Promise<any[]> {
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

  const user = `# Vision\n\n${visionText || '(no vision recorded)'}\n\n# Work history\n\n${companyBlocks || '(no companies)'}\n\n# Existing narratives\n\n${narrativeBlocks || '(no narratives yet)'}\n\n# Ask\n\nProduce the JSON object now. JSON only.`;
  const parsed = await callClaudeJson(AUDIT_SYSTEM, user, 4096);
  return Array.isArray(parsed?.opportunities) ? parsed.opportunities : [];
}

async function loadOpen(sql: any) {
  return await sql`
    select id, audit_ts, title, gap, ask, scope, anchor_company_slug,
           resolved_at, dismissed_at, created_at
    from job.career_opportunities
    where resolved_at is null and dismissed_at is null
    order by audit_ts desc, created_at;
  `;
}

async function lastAuditTs(sql: any): Promise<string | null> {
  const r = await sql`select max(audit_ts) as ts from job.career_opportunities`;
  return r[0]?.ts ? new Date(r[0].ts).toISOString() : null;
}

async function isStale(sql: any, lastTs: string | null): Promise<boolean> {
  if (!lastTs) return true;
  const r = await sql`select count(*)::int as n from job.narratives where updated_at > ${lastTs}`;
  return (r[0]?.n || 0) > 0;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const email = await verifyJobUser(req);
    if (!email) return err('unauthorized', 401);
    const sql = db();

    if (req.method === 'GET') {
      const opportunities = await loadOpen(sql);
      const last = await lastAuditTs(sql);
      const stale = await isStale(sql, last);
      return jsonResp({ opportunities, last_audit_ts: last, stale });
    }

    if (req.method !== 'POST') return err('GET or POST only', 405);

    const body = await req.json().catch(() => ({}));

    if (body.audit === true) {
      const items = await runAudit(sql);
      const auditTs = new Date().toISOString();
      // Replace the open set with the fresh audit. Resolved + dismissed
      // rows are preserved so the user keeps their history.
      await sql`
        delete from job.career_opportunities
        where resolved_at is null and dismissed_at is null;
      `;
      const inserted: any[] = [];
      for (const o of items) {
        const title = String(o?.title || '').trim();
        if (!title) continue;
        const id = newId();
        const rows = await sql`
          insert into job.career_opportunities
            (id, audit_ts, title, gap, ask, scope, anchor_company_slug)
          values
            (${id}, ${auditTs}, ${title},
             ${String(o.gap || '')}, ${String(o.ask || '')},
             ${String(o.scope || 'narrative')},
             ${o.anchor_company_slug ? String(o.anchor_company_slug) : null})
          returning id, audit_ts, title, gap, ask, scope, anchor_company_slug,
                    resolved_at, dismissed_at, created_at;
        `;
        inserted.push(rows[0]);
      }
      return jsonResp({ opportunities: inserted, last_audit_ts: auditTs, stale: false, audited: inserted.length });
    }

    if (body.dismiss) {
      const id = String(body.dismiss);
      if (!ID_RE.test(id)) return err('invalid id', 400);
      const rows = await sql`
        update job.career_opportunities
           set dismissed_at = now()
         where id = ${id}
         returning id, dismissed_at;
      `;
      if (rows.length === 0) return err('not found', 404);
      return jsonResp({ ok: true, ...rows[0] });
    }

    if (body.resolve) {
      const id = String(body.resolve);
      if (!ID_RE.test(id)) return err('invalid id', 400);
      const nid = body.narrative_id ? String(body.narrative_id) : null;
      if (nid && !ID_RE.test(nid)) return err('invalid narrative_id', 400);
      const rows = await sql`
        update job.career_opportunities
           set resolved_at = now(),
               resolved_by_narrative_id = ${nid}
         where id = ${id}
         returning id, resolved_at, resolved_by_narrative_id;
      `;
      if (rows.length === 0) return err('not found', 404);
      return jsonResp({ ok: true, ...rows[0] });
    }

    return err('unknown action', 400);
  } catch (e) {
    console.error('[opportunities] error', e);
    return err((e as Error).message || 'server error', 500);
  }
});
