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

const VERSION = '0.2.0';
console.log(`[migrate-job] v${VERSION} - search plan v2: sections + fields + summary`);

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

  // Vision (source of truth: job.vision_field). The sync trigger mirrors
  // each row back into the legacy job.vision columns so unmigrated
  // readers stay fresh during Phase 2. Writes are stamped
  // source='migrate-job' so a future audit can tell re-seeds apart from
  // agent or user edits.
  const visionMd = vision.map(v => `# ${v.slug}\n\n${v.content}`).join('\n\n---\n\n');
  const narrative = vision.find(v => v.slug === 'narrative-arc')?.content || null;
  const dealBreakers = vision.find(v => v.slug === 'deal-breakers')?.content || null;
  const voiceRules = vision.find(v => v.slug === 'voice-and-cover-letter-rules')?.content || null;

  const uidRows = await sql<{ user_id: string }[]>`
    select user_id from public.user_profile order by onboarding_complete_at desc nulls last limit 1
  `;
  const uid = uidRows[0]?.user_id;
  if (!uid) {
    console.warn('[migrate-job] no user_profile found — falling back to legacy job.vision write');
    await sql`
      insert into job.vision (id, narrative_arc, deal_breakers, voice_rules_md, raw_md)
      values (1, ${narrative}, ${dealBreakers ? [dealBreakers] : []}, ${voiceRules}, ${visionMd})
      on conflict (id) do update set
        narrative_arc = excluded.narrative_arc, deal_breakers = excluded.deal_breakers,
        voice_rules_md = excluded.voice_rules_md, raw_md = excluded.raw_md, updated_at = now();
    `;
  } else {
    const upsert = (name: string, value: unknown, kind: string) => sql`
      insert into job.vision_field (user_id, name, value, kind, source)
      values (${uid}, ${name}, ${JSON.stringify(value)}::jsonb, ${kind}, 'migrate-job')
      on conflict (user_id, name) do update set
        value = excluded.value, source = 'migrate-job', updated_at = now()
    `;
    await upsert('narrative_arc',  narrative ?? '',                       'text_md');
    await upsert('voice_rules_md', voiceRules ?? '',                      'text_md');
    await upsert('raw_md',         visionMd,                              'text_md');
    await upsert('deal_breakers',  dealBreakers ? [dealBreakers] : [],    'string_array');
  }

  // Search Plan v2 — parsed sections + fields. See migration 057.
  await populateSearchPlanV2(sql, vision);

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

// --- Search Plan v2: populate sections + fields + summary -----------------
//
// Mirrors the UI parse: between H1 and first H2 / non-field line, every
// `**Label:** value` line becomes a field. Lists are split on `,`, `;`, or
// ` / `. Money labels parse into cents.
//
// Filename → category mirrors the UI's CATEGORIES list so the two stay
// consistent. Anything unmatched lands in 'other'.

const SP_CATEGORIES: { id: string; test: (n: string) => boolean }[] = [
  { id: 'narrative', test: (n) => /^(narrative|voice|story|bio|about|arc)/.test(n) },
  { id: 'goals',     test: (n) => /^(goal|north|mission|vision|aim|ambition)/.test(n) },
  { id: 'intents',   test: (n) => /^(intent|target|seeking|looking|wants|preference|stage|sector|role|geo|comp|salary|location)/.test(n) },
  { id: 'filters',   test: (n) => /^(criteria|filter|dealbreaker|deal-breaker|anti|no-go|must|reject|exclud)/.test(n) },
];

function spCategoryFor(slug: string): string {
  const base = slug.toLowerCase();
  for (const c of SP_CATEGORIES) if (c.test(base)) return c.id;
  return 'other';
}

const SP_MONEY_LABEL_RE = /^(base|base floor|base target|salary|salary floor|cash|total comp|total comp target|all-in|all in|fractional|fractional rate|fractional day rate|day rate|hourly).*$/i;
const SP_EQUITY_LABEL_RE = /^(equity|equity target|equity expectation|options).*$/i;

function spNormalizeLabel(label: string): string {
  return label.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

function spSplitList(value: string): string[] | null {
  const parts = value.split(/\s*(?:,|;| \/ )\s*/).map(s => s.trim()).filter(Boolean);
  return parts.length >= 2 ? parts : null;
}

// Parse one money/range value into cents bounds. Handles "$180k", "180,000",
// "$180k–$220k", "180k-220k", "$2k/day". Returns null if no number found.
function spParseMoneyCents(value: string): { low: number | null; high: number | null } | null {
  if (!value) return null;
  const norm = value.toLowerCase().replace(/[,_]/g, '');
  const nums = Array.from(norm.matchAll(/\$?\s*(\d+(?:\.\d+)?)\s*(k|m)?/g)).map(m => {
    const n = parseFloat(m[1]);
    if (Number.isNaN(n)) return null;
    const scale = m[2] === 'm' ? 1_000_000 : m[2] === 'k' ? 1_000 : 1;
    return Math.round(n * scale * 100); // cents
  }).filter((n): n is number => n !== null && n >= 100); // require ≥ $1
  if (!nums.length) return null;
  if (nums.length === 1) return { low: nums[0], high: nums[0] };
  return { low: Math.min(...nums), high: Math.max(...nums) };
}

// Parse equity percentage range. Handles "0.5%", "0.5-1%", "0.5–1.0 %".
function spParseEquityPct(value: string): { low: number | null; high: number | null } | null {
  if (!value) return null;
  const nums = Array.from(value.matchAll(/(\d+(?:\.\d+)?)/g)).map(m => parseFloat(m[1])).filter(n => !Number.isNaN(n));
  if (!nums.length) return null;
  if (nums.length === 1) return { low: nums[0], high: nums[0] };
  return { low: Math.min(...nums), high: Math.max(...nums) };
}

interface ParsedField {
  label: string;
  value: string;
  ord: number;
  list: string[] | null;
  money: { low: number | null; high: number | null } | null;
  kind: 'money' | 'list' | 'range' | 'text';
}

function spClassifyField(label: string, value: string): ParsedField {
  const ord = 0;
  const list = spSplitList(value);
  const isMoney = SP_MONEY_LABEL_RE.test(label) && !/^equity/i.test(label);
  const money = isMoney ? spParseMoneyCents(value) : null;
  const kind: ParsedField['kind'] = money ? 'money' : list ? 'list' : /[-–—]/.test(value) && /\d/.test(value) ? 'range' : 'text';
  return { label, value, ord, list, money, kind };
}

async function populateSearchPlanV2(
  sql: ReturnType<typeof postgres>,
  vision: { path: string; slug: string; content: string }[],
) {
  // Wipe stale rows before re-upserting; sections cascade to fields.
  await sql`delete from job.search_plan_sections;`;

  const summary = {
    base_floor_cents: null as number | null,
    base_target_cents: null as number | null,
    total_comp_target_cents: null as number | null,
    equity_low: null as number | null,
    equity_high: null as number | null,
    fractional_day_rate_cents: null as number | null,
    fractional_hourly_cents: null as number | null,
    geo_primary: [] as string[],
    geo_remote: null as string | null,
    travel: null as string | null,
    stage_min: null as string | null,
    stage_max: null as string | null,
    headcount_min: null as number | null,
    headcount_max: null as number | null,
    sector_primary: [] as string[],
    sector_adjacent: [] as string[],
    sector_avoid: [] as string[],
    title_primary: [] as string[],
    title_adjacent: [] as string[],
    title_avoid: [] as string[],
    deal_breakers: [] as string[],
    narrative_arc_md: null as string | null,
    voice_rules_md: null as string | null,
  };

  for (let idx = 0; idx < vision.length; idx++) {
    const v = vision[idx];
    const doc = parseDoc(v.content);
    const title = doc.title || v.slug.replace(/[-_]+/g, ' ');
    const category = spCategoryFor(v.slug);

    await sql`
      insert into job.search_plan_sections (slug, title, category, source_path, body_md, raw_md, ord)
      values (${v.slug}, ${title}, ${category}, ${v.path}, ${doc.body || null}, ${v.content}, ${idx})
      on conflict (slug) do update set
        title = excluded.title, category = excluded.category, source_path = excluded.source_path,
        body_md = excluded.body_md, raw_md = excluded.raw_md, ord = excluded.ord, updated_at = now();
    `;

    const entries = Object.entries(doc.fields);
    for (let j = 0; j < entries.length; j++) {
      const [label, value] = entries[j];
      const pf = spClassifyField(label, value);
      const labelNorm = spNormalizeLabel(label);
      await sql`
        insert into job.search_plan_fields (
          section_slug, ord, label, label_norm, value, value_list,
          value_min_cents, value_max_cents, kind
        ) values (
          ${v.slug}, ${j}, ${label}, ${labelNorm}, ${value},
          ${pf.list}, ${pf.money?.low ?? null}, ${pf.money?.high ?? null}, ${pf.kind}
        );
      `;

      // Route well-known fields to the summary row.
      if (pf.money && /base floor/i.test(label)) summary.base_floor_cents = pf.money.low;
      else if (pf.money && /base target/i.test(label)) summary.base_target_cents = pf.money.high ?? pf.money.low;
      else if (pf.money && /total comp/i.test(label)) summary.total_comp_target_cents = pf.money.high ?? pf.money.low;
      else if (pf.money && /day rate|fractional rate|fractional day/i.test(label)) summary.fractional_day_rate_cents = pf.money.low;
      else if (pf.money && /hourly/i.test(label)) summary.fractional_hourly_cents = pf.money.low;

      if (SP_EQUITY_LABEL_RE.test(label)) {
        const eq = spParseEquityPct(value);
        if (eq) { summary.equity_low = eq.low; summary.equity_high = eq.high; }
      }

      if (/^primary( sectors?)?$/i.test(label) && /sector/.test(v.slug)) summary.sector_primary = pf.list ?? [value];
      else if (/^adjacent( sectors?)?$/i.test(label) && /sector/.test(v.slug)) summary.sector_adjacent = pf.list ?? [value];
      else if (/^avoid( sectors?)?$/i.test(label) && /sector/.test(v.slug)) summary.sector_avoid = pf.list ?? [value];

      if (/^primary( titles?)?$/i.test(label) && /role|title/.test(v.slug)) summary.title_primary = pf.list ?? [value];
      else if (/^adjacent( titles?)?$/i.test(label) && /role|title/.test(v.slug)) summary.title_adjacent = pf.list ?? [value];
      else if (/^avoid( titles?)?$/i.test(label) && /role|title/.test(v.slug)) summary.title_avoid = pf.list ?? [value];

      if (/^primary$/i.test(label) && /geo|location/.test(v.slug)) summary.geo_primary = pf.list ?? [value];
      else if (/^remote$/i.test(label) && /geo|location/.test(v.slug)) summary.geo_remote = value;
      else if (/^travel/i.test(label)) summary.travel = value;

      if (/^stage( range)?$/i.test(label)) {
        const parts = pf.list ?? value.split(/\s*[–—-]\s*/).map(s => s.trim()).filter(Boolean);
        if (parts.length >= 1) summary.stage_min = parts[0];
        if (parts.length >= 2) summary.stage_max = parts[parts.length - 1];
      }
      if (/^headcount( range)?$/i.test(label)) {
        const nums = Array.from(value.matchAll(/(\d+)/g)).map(m => parseInt(m[1], 10)).filter(n => !Number.isNaN(n));
        if (nums.length >= 1) summary.headcount_min = nums[0];
        if (nums.length >= 2) summary.headcount_max = nums[nums.length - 1];
      }
    }

    // Body-derived summary fields.
    if (v.slug === 'narrative-arc') summary.narrative_arc_md = v.content;
    if (v.slug === 'voice-and-cover-letter-rules') summary.voice_rules_md = v.content;
    if (/deal[-_]?breakers?/.test(v.slug)) {
      // Pull top-level bullets as discrete deal-breakers.
      const bullets = (doc.body || '').split(/\r?\n/)
        .map(l => l.match(/^\s*[-*+]\s+(.+?)\s*$/))
        .filter((m): m is RegExpMatchArray => !!m)
        .map(m => m[1].replace(/^[•·●○◦▪▫–—-]\s*/, '').trim())
        .filter(Boolean);
      if (bullets.length) summary.deal_breakers = bullets;
    }
  }

  await sql`
    update job.search_plan_summary set
      base_floor_cents          = ${summary.base_floor_cents},
      base_target_cents         = ${summary.base_target_cents},
      total_comp_target_cents   = ${summary.total_comp_target_cents},
      equity_target_pct_low     = ${summary.equity_low},
      equity_target_pct_high    = ${summary.equity_high},
      fractional_day_rate_cents = ${summary.fractional_day_rate_cents},
      fractional_hourly_cents   = ${summary.fractional_hourly_cents},
      geo_primary               = ${summary.geo_primary},
      geo_remote                = ${summary.geo_remote},
      travel_willingness        = ${summary.travel},
      stage_min                 = ${summary.stage_min},
      stage_max                 = ${summary.stage_max},
      headcount_min             = ${summary.headcount_min},
      headcount_max             = ${summary.headcount_max},
      sector_primary            = ${summary.sector_primary},
      sector_adjacent           = ${summary.sector_adjacent},
      sector_avoid              = ${summary.sector_avoid},
      title_primary             = ${summary.title_primary},
      title_adjacent            = ${summary.title_adjacent},
      title_avoid               = ${summary.title_avoid},
      deal_breakers             = ${summary.deal_breakers},
      narrative_arc_md          = ${summary.narrative_arc_md},
      voice_rules_md            = ${summary.voice_rules_md},
      updated_at                = now()
    where id = 1;
  `;
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
