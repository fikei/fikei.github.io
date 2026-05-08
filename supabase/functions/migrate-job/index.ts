// migrate-job — one-shot migration: applies the job.* schema, then seeds
// from the GitHub fikei/job repo + the Job Search Google Sheet.
//
// POST /functions/v1/migrate-job
//   { mode?: 'schema' | 'seed' | 'both' (default), dryRun?: boolean }
//
// Idempotent: schema uses IF NOT EXISTS, seed upserts on slug.
// Calls require allowlisted Supabase user.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import postgres from 'https://deno.land/x/postgresjs@v3.4.4/mod.js';
import { verifyJobUser, jsonResp, err, corsHeaders, slugify, roleSlug } from '../_shared/job-auth.ts';
import { ghTree, ghReadFile } from '../_shared/job-github.ts';
import { readSheetValues } from '../jobs-pipe/sheets.ts';
import { SCHEMA_SQL } from './schema.ts';
import { DESKTOP_ASSETS } from './desktop-bundle.ts';

const VERSION = '0.1.0';
console.log(`[migrate-job] v${VERSION}`);

const SHEET_ID = '1YtZp3vxlsVP8t_eWpcYzYEVjaSKu8rVYmVRPr4AGeAU';

interface Counts {
  companies: number;
  projects: number;
  skills: number;
  wins: number;
  vision: number;
  tracked_companies: number;
  pipeline_roles: number;
  project_skills: number;
  win_skills: number;
}

// --- markdown header parser (mirrors the frontend) -------------------------

interface DocHeader { title: string; fields: Record<string, string>; body: string; }

function parseDoc(md: string): DocHeader {
  const out: DocHeader = { title: '', fields: {}, body: '' };
  const lines = md.split(/\r?\n/);
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!out.title) {
      const h1 = line.match(/^#\s+(.+)$/);
      if (h1) { out.title = h1[1].trim(); continue; }
    }
    const m = line.match(/^\*\*([^*:]+):\*\*\s*(.+)$/);
    if (m) { out.fields[m[1].trim()] = m[2].trim(); continue; }
    if (line.startsWith('## ')) break;
  }
  out.body = lines.slice(i).join('\n').trim();
  return out;
}

function extractWikiLinks(md: string): string[] {
  const out = new Set<string>();
  const re = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) out.add(m[1].trim().toLowerCase());
  return Array.from(out);
}

// Resolve a "Company" / "Project" field that can be either:
//   "[[livongo-teladoc]]"
//   "Personal project (within [[independent-consulting]] period)"
//   "Strava"
// Returns the first wiki-link slug if any, otherwise null (we don't want
// "Personal project (within…)" to become its own slug).
function resolveLinkedSlug(s: string | undefined): string | null {
  if (!s) return null;
  const links = extractWikiLinks(s);
  return links[0] || null;
}

function parseDateLoose(s: string | undefined): string | null {
  if (!s) return null;
  const txt = s.toLowerCase().trim();
  if (txt.includes('present')) return null;
  // "2016 – 2021" — keep first 4-digit year as Jan 1.
  const yr = txt.match(/(\d{4})/);
  if (!yr) return null;
  return `${yr[1]}-01-01`;
}

function parseSalary(s: string | undefined): { low: number | null; high: number | null } {
  if (!s) return { low: null, high: null };
  const norm = s.toLowerCase().replace(/[,$]/g, '').replace(/\s+/g, '');
  const nums = Array.from(norm.matchAll(/(\d+(?:\.\d+)?)(k)?/g)).map(m => {
    const n = parseFloat(m[1]);
    return m[2] === 'k' ? Math.round(n * 1000) : Math.round(n);
  }).filter(n => n >= 1000);
  if (nums.length === 0) return { low: null, high: null };
  if (nums.length === 1) return { low: nums[0], high: nums[0] };
  return { low: Math.min(...nums), high: Math.max(...nums) };
}

// --- KB → tables -----------------------------------------------------------

async function loadKbFiles(prefix: string) {
  const tree = await ghTree(prefix);
  const files = tree.filter(t => /\.md$/.test(t.path) && !t.path.includes('/_'));
  const fetched = await Promise.all(files.map(async f => {
    const r = await ghReadFile(f.path);
    if (!r) return null;
    return { path: f.path, slug: f.path.split('/').pop()!.replace(/\.md$/, ''), content: r.content };
  }));
  return fetched.filter(Boolean) as { path: string; slug: string; content: string }[];
}

async function seedKb(sql: ReturnType<typeof postgres>): Promise<Pick<Counts, 'companies' | 'projects' | 'skills' | 'wins' | 'project_skills' | 'win_skills' | 'vision'>> {
  const [companies, projects, skills, wins, vision] = await Promise.all([
    loadKbFiles('01-job-history/companies/'),
    loadKbFiles('01-job-history/projects/'),
    loadKbFiles('01-job-history/skills/'),
    loadKbFiles('01-job-history/wins/'),
    loadKbFiles('02-goals-intents/'),
  ]);

  // Companies
  for (const f of companies) {
    const d = parseDoc(f.content);
    const fields = d.fields;
    await sql`
      insert into job.companies (slug, name, sector, stage_at_time, tenure_start, tenure_end, location, body_md)
      values (${f.slug}, ${d.title || f.slug}, ${fields['Sector'] || null}, ${fields['Stage at the time of joining'] || fields['Stage at the time'] || fields['Stage of clients'] || null},
              ${parseDateLoose(fields['My tenure'] || fields['Tenure'])}, ${/Present/i.test(fields['My tenure'] || '') ? null : null},
              ${fields['Location'] || null}, ${f.content})
      on conflict (slug) do update set
        name = excluded.name, sector = excluded.sector, stage_at_time = excluded.stage_at_time,
        tenure_start = excluded.tenure_start, tenure_end = excluded.tenure_end,
        location = excluded.location, body_md = excluded.body_md, updated_at = now();
    `;
  }

  // Projects
  for (const f of projects) {
    const d = parseDoc(f.content);
    const fields = d.fields;
    const companySlug = resolveLinkedSlug(fields['Company']);
    await sql`
      insert into job.projects (slug, company_slug, title, role, team_size, status, body_md, metric_value)
      values (${f.slug}, ${companySlug}, ${d.title || f.slug}, ${fields['Role'] || null}, ${fields['Team'] || fields['Team size'] || null},
              ${fields['Status'] || null}, ${f.content}, ${fields['Headline metric'] || fields['Metric'] || null})
      on conflict (slug) do update set
        title = excluded.title, company_slug = excluded.company_slug, role = excluded.role,
        team_size = excluded.team_size, status = excluded.status, body_md = excluded.body_md,
        metric_value = excluded.metric_value, updated_at = now();
    `;
    // Project ↔ skills via wiki-link extraction
    const linked = extractWikiLinks(f.content);
    for (const slug of linked) {
      // Will succeed only if the linked slug exists in skills; otherwise no-op.
      await sql`
        insert into job.project_skills (project_slug, skill_slug)
        select ${f.slug}, slug from job.skills where slug = ${slug}
        on conflict do nothing;
      `;
    }
  }

  // Skills
  for (const f of skills) {
    const d = parseDoc(f.content);
    const fields = d.fields;
    const yrs = parseInt(fields['Years practiced'] || '0', 10) || null;
    await sql`
      insert into job.skills (slug, name, type, level, years_practiced, body_md, cover_letter_blurb)
      values (${f.slug}, ${d.title || f.slug}, ${fields['Type'] || null}, ${fields['Level'] || null},
              ${yrs}, ${f.content}, ${fields['How I talk about this'] || null})
      on conflict (slug) do update set
        name = excluded.name, type = excluded.type, level = excluded.level,
        years_practiced = excluded.years_practiced, body_md = excluded.body_md,
        cover_letter_blurb = excluded.cover_letter_blurb, updated_at = now();
    `;
  }

  // Wins
  for (const f of wins) {
    const d = parseDoc(f.content);
    const fields = d.fields;
    const companySlug = resolveLinkedSlug(fields['Company']);
    const projectSlug = resolveLinkedSlug(fields['Project']);
    await sql`
      insert into job.wins (slug, company_slug, project_slug, headline, body_md, metric_value)
      values (${f.slug}, ${companySlug}, ${projectSlug}, ${d.title || f.slug}, ${f.content},
              ${fields['Metric'] || fields['Headline metric'] || null})
      on conflict (slug) do update set
        company_slug = excluded.company_slug, project_slug = excluded.project_slug,
        headline = excluded.headline, body_md = excluded.body_md,
        metric_value = excluded.metric_value, updated_at = now();
    `;
    const linked = extractWikiLinks(f.content);
    for (const slug of linked) {
      await sql`
        insert into job.win_skills (win_slug, skill_slug)
        select ${f.slug}, slug from job.skills where slug = ${slug}
        on conflict do nothing;
      `;
    }
  }

  // Vision: fold all 02-goals-intents/*.md into a single row.
  const visionMd = vision.map(v => `# ${v.slug}\n\n${v.content}`).join('\n\n---\n\n');
  // Pull a couple of the lighter fields out for structured access.
  const narrative = vision.find(v => v.slug === 'narrative-arc')?.content || null;
  const dealBreakers = vision.find(v => v.slug === 'deal-breakers')?.content || null;
  const voiceRules = vision.find(v => v.slug === 'voice-and-cover-letter-rules')?.content || null;
  await sql`
    insert into job.vision (id, narrative_arc, deal_breakers, voice_rules_md, raw_md)
    values (1, ${narrative}, ${dealBreakers ? [dealBreakers] : []}, ${voiceRules}, ${visionMd})
    on conflict (id) do update set
      narrative_arc = excluded.narrative_arc, deal_breakers = excluded.deal_breakers,
      voice_rules_md = excluded.voice_rules_md, raw_md = excluded.raw_md, updated_at = now();
  `;

  return {
    companies: companies.length,
    projects: projects.length,
    skills: skills.length,
    wins: wins.length,
    project_skills: 0, // computed; not tracked here
    win_skills: 0,
    vision: 1,
  };
}

// --- Sheet → pipeline_roles ------------------------------------------------

async function seedPipeline(sql: ReturnType<typeof postgres>): Promise<{ tracked_companies: number; pipeline_roles: number }> {
  const [rolesRows, companiesRows] = await Promise.all([
    readSheetValues(SHEET_ID, 'Roles!A2:M1000'),
    readSheetValues(SHEET_ID, 'Companies!A2:Z200').catch(() => []),
  ]);

  // Tracked companies (best-effort; sheet column order on Companies tab varies — keep it minimal).
  const tracked = new Map<string, { slug: string; name: string; sector?: string }>();
  for (const r of rolesRows) {
    const company = (r[3] || '').trim();
    if (!company) continue;
    const slug = slugify(company);
    if (!tracked.has(slug)) tracked.set(slug, { slug, name: company, sector: (r[9] || '').trim() || undefined });
  }
  for (const t of tracked.values()) {
    await sql`
      insert into job.tracked_companies (slug, name, sector)
      values (${t.slug}, ${t.name}, ${t.sector || null})
      on conflict (slug) do update set name = excluded.name, sector = coalesce(excluded.sector, job.tracked_companies.sector), updated_at = now();
    `;
  }

  let inserted = 0;
  for (let idx = 0; idx < rolesRows.length; idx++) {
    const r = rolesRows[idx];
    const company = (r[3] || '').trim();
    const title = (r[4] || '').trim();
    if (!company && !title) continue;

    const status = (r[2] || '').trim() || 'New';
    const url = (r[5] || '').trim();
    const source = (r[6] || '').trim();
    const contact = (r[7] || '').trim();
    const salary = (r[8] || '').trim();
    const sector = (r[9] || '').trim();
    const investorsRaw = (r[10] || '').trim();
    const investors = investorsRaw ? investorsRaw.split(/,|;/).map(s => s.trim()).filter(Boolean) : [];

    const slug = roleSlug(company, title);
    if (!slug) continue;
    const { low, high } = parseSalary(salary);

    await sql`
      insert into job.pipeline_roles (
        slug, source_row, company_slug, company_name, title, url, source, status,
        contact, salary_range, salary_low, salary_high, sector, investors
      ) values (
        ${slug}, ${idx + 2}, ${slugify(company)}, ${company}, ${title}, ${url || null},
        ${source || null}, ${status}, ${contact || null}, ${salary || null},
        ${low}, ${high}, ${sector || null}, ${investors}
      )
      on conflict (slug) do update set
        source_row = excluded.source_row, company_name = excluded.company_name,
        title = excluded.title, url = excluded.url, source = excluded.source,
        status = excluded.status, contact = excluded.contact,
        salary_range = excluded.salary_range, salary_low = excluded.salary_low,
        salary_high = excluded.salary_high, sector = excluded.sector,
        investors = excluded.investors, updated_at = now();
    `;
    inserted += 1;
  }

  return { tracked_companies: tracked.size, pipeline_roles: inserted };
}

// --- entrypoint ------------------------------------------------------------

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return err('POST only', 405);

  try {
    const email = await verifyJobUser(req);
    if (!email) return err('unauthorized', 401);

    const body = await req.json().catch(() => ({}));
    const mode: 'schema' | 'seed' | 'both' | 'assets' = body.mode || 'both';
    const dryRun = !!body.dryRun;

    const dbUrl = Deno.env.get('SUPABASE_DB_URL');
    if (!dbUrl) return err('SUPABASE_DB_URL not configured', 500);

    const sql = postgres(dbUrl, { prepare: false });

    try {
      if (mode === 'schema' || mode === 'both') {
        if (!dryRun) await sql.unsafe(SCHEMA_SQL);
      }

      let counts: Partial<Counts> & { role_assets?: number; orphans?: string[] } = {};
      if ((mode === 'seed' || mode === 'both') && !dryRun) {
        const kbCounts = await seedKb(sql);
        const pipelineCounts = await seedPipeline(sql);
        counts = { ...kbCounts, ...pipelineCounts };
      }

      if (mode === 'assets' && !dryRun) {
        // body.assets: [{ slug, kind, content_md, source_path?, generated_by?, company_name?, title?, status? }]
        // OR if body.useDesktopBundle is true, use the embedded DESKTOP_ASSETS.
        const assets = body.useDesktopBundle
          ? (DESKTOP_ASSETS as unknown as Array<Record<string, unknown>>)
          : (Array.isArray(body.assets) ? body.assets : []);
        const orphans: string[] = [];
        let inserted = 0;
        for (const a of assets) {
          if (!a?.slug || !a?.kind || !a?.content_md) continue;
          const exists = await sql`select 1 from job.pipeline_roles where slug = ${a.slug} limit 1`;
          if (exists.length === 0) {
            if (a.company_name && a.title) {
              await sql`
                insert into job.pipeline_roles (slug, company_name, title, status, source)
                values (${a.slug}, ${a.company_name}, ${a.title}, ${a.status || 'Closed'}, 'Imported')
                on conflict (slug) do nothing;
              `;
            } else {
              orphans.push(a.slug);
              continue;
            }
          }
          await sql`
            insert into job.role_assets (role_slug, kind, content_md, source_path, generated_by, generated_at)
            values (${a.slug}, ${a.kind}, ${a.content_md}, ${a.source_path || null}, ${a.generated_by || 'imported-pdf'}, ${a.generated_at || null})
            on conflict (role_slug, kind) do update set
              content_md = excluded.content_md,
              source_path = excluded.source_path,
              generated_by = excluded.generated_by,
              updated_at = now();
          `;
          inserted += 1;
        }
        counts = { ...counts, role_assets: inserted, orphans };
      }

      return jsonResp({ ok: true, version: VERSION, mode, dryRun, counts });
    } finally {
      await sql.end();
    }
  } catch (e) {
    console.error('[migrate-job] error', e);
    return err((e as Error).message || 'server error', 500);
  }
});
