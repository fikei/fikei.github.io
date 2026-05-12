// theirstack — pulls postings from TheirStack's /v1/jobs/search.
// Aggregates ~14M live postings across LinkedIn, Greenhouse, Lever,
// Indeed, BuiltIn, etc. Single API; one of the cheapest paid sources.
//
// Auth: env var THEIRSTACK_API_KEY (Bearer token).
// Config (any subset; everything is forwarded to TheirStack as-is):
//   {
//     job_title_or?:           string[]    // e.g. ['product manager','product lead']
//     job_location_or?:        Array<{ id: number }>  // TheirStack location IDs
//     posted_at_max_age_days?: number      // default 15
//     limit?:                  number      // default 50, max 100
//     remote?:                 boolean     // pass through if you want
//     extra?:                  Record<string, unknown>  // any other TheirStack params
//   }
//
// Docs: https://theirstack.com/en/docs/api-reference

import type { Source, RecommendedRoleInput } from './types.ts';
import { db } from '../job-db.ts';

// Full request-body passthrough. Anything you set here lands in the
// TheirStack body verbatim. When `auto: true`, the plugin starts from
// the user's job.vision row and only your explicit overrides win.
interface TheirStackConfig {
  // Convenience presets — used as defaults under `auto`, ignored when
  // the same field is set under `extra`.
  job_title_or?:           string[];
  job_location_or?:        Array<{ id: number }>;
  posted_at_max_age_days?: number;
  limit?:                  number;
  remote?:                 boolean;
  // Auto-build the body from job.vision (target_titles, geographies,
  // stages, sectors). Anything in `extra` still wins. Set this once
  // and forget — the request stays in sync as your vision evolves.
  auto?:                   boolean;
  // Escape hatch: set ANY TheirStack body field directly.
  extra?:                  Record<string, unknown>;
}

// Default seniority + exclusion floor. Same intent as the title
// keyword filter the worker applies, just pushed down to the API so
// the 25-result page budget isn't wasted on junior roles.
//
// theirstack's API only accepts: c_level | staff | senior | junior |
// mid_level. We used to pass 'principal' / 'director' / 'vp' / 'cxo'
// which returned a 422 every tick. Mapping: principal/director/vp/cxo
// → c_level (closest equivalent in their taxonomy).
const DEFAULT_SENIORITY    = ['senior', 'staff', 'c_level'];
const DEFAULT_TITLE_NOT    = ['junior', 'intern', 'associate', 'contract', 'apprentice'];
const DEFAULT_INDUSTRY_NOT = ['Staffing and Recruiting', 'Government Administration', 'Defense & Space'];

// Map common geo strings (vision.target_geographies) → ISO country codes.
function geosToCountryCodes(geos: string[]): string[] {
  const codes = new Set<string>();
  for (const raw of geos) {
    const g = raw.toLowerCase();
    if (/\bus\b|united states|san francisco|nyc|new york|sf|bay area|brooklyn|manhattan|oakland|berkeley|austin|seattle|chicago|boston|la\b|los angeles/.test(g)) codes.add('US');
    if (/\buk\b|britain|england|london|edinburgh/.test(g)) codes.add('GB');
    if (/canada|toronto|vancouver|montreal/.test(g)) codes.add('CA');
    if (/germany|berlin|munich/.test(g)) codes.add('DE');
  }
  return Array.from(codes);
}

// Map vision.target_stages strings → TheirStack funding_stage values.
function stagesToFundingStages(stages: string[]): string[] {
  const out = new Set<string>();
  for (const s of stages.map(x => x.toLowerCase())) {
    if (/pre[\s-]?seed|seed/.test(s))   out.add('seed');
    if (/series[\s-]?a/.test(s))        out.add('series_a');
    if (/series[\s-]?b/.test(s))        out.add('series_b');
    if (/series[\s-]?c/.test(s))        out.add('series_c');
    if (/series[\s-]?d/.test(s))        out.add('series_d');
    if (/early|early[\s-]?stage/.test(s)) { out.add('seed'); out.add('series_a'); }
  }
  return Array.from(out);
}

interface TheirStackJob {
  id?:                  string | number;
  job_title?:           string;
  url?:                 string;
  final_url?:           string;
  description?:         string;
  date_posted?:         string;
  location?:            string;
  long_location?:       string;
  remote?:              boolean;
  hybrid?:              boolean;
  salary_string?:       string;
  min_annual_salary?:   number;
  max_annual_salary?:   number;
  company_object?:      {
    name?: string;
    industry?: string;
    domain?: string;
    logo?: string;
  };
  company?:             string;
}

const ENDPOINT = 'https://api.theirstack.com/v1/jobs/search';

export const theirstackSource: Source<TheirStackConfig> = {
  type: 'theirstack',
  async pull(cfg) {
    const apiKey = Deno.env.get('THEIRSTACK_API_KEY');
    if (!apiKey) throw new Error('THEIRSTACK_API_KEY env var not set');
    const sql = db();

    // Auto-build mode: start from job.vision so the request stays in
    // sync with the user's stated preferences. Explicit fields on the
    // source's config still win.
    const auto: Record<string, unknown> = {};
    if (cfg.auto) {
      const v = await sql<{ target_titles: string[]|null; target_geographies: string[]|null; target_stages: string[]|null; target_sectors: string[]|null }[]>`
        select target_titles, target_geographies, target_stages, target_sectors
          from job.vision order by updated_at desc limit 1
      `;
      const row = v[0] || { target_titles: null, target_geographies: null, target_stages: null, target_sectors: null };
      const titles = (row.target_titles || []).map(s => s.toLowerCase()).filter(Boolean);
      if (titles.length) auto.job_title_or = titles;
      const geos = geosToCountryCodes(row.target_geographies || []);
      if (geos.length) auto.job_country_code_or = geos;
      const stages = stagesToFundingStages(row.target_stages || []);
      if (stages.length) auto.funding_stage_or = stages;
      const sectors = (row.target_sectors || []).filter(Boolean);
      if (sectors.length) auto.industry_or = sectors;
    }

    const body = {
      include_total_results:   false,
      // Quality defaults — apply unless the user explicitly overrides.
      posted_at_max_age_days:  cfg.posted_at_max_age_days ?? 7,
      order_by:                [{ field: 'date_posted', desc: true }],
      job_seniority_or:        DEFAULT_SENIORITY,
      job_title_pattern_not:   DEFAULT_TITLE_NOT,
      industry_not:            DEFAULT_INDUSTRY_NOT,
      // property_exists_or used to filter for 'salary' but theirstack's
      // API now only accepts a fixed list (company_object.domain |
      // company_object.linkedin_url | final_url | hiring_team |
      // employment_statuses). Use 'final_url' to require an actual
      // apply link — postings without one are unusable for the user
      // regardless of comp. The fit-score already weights comp, so
      // filtering for comp-present at API level is no longer needed.
      property_exists_or:      ['final_url'],
      // From the convenience config (or fallback).
      job_title_or:            cfg.job_title_or && cfg.job_title_or.length ? cfg.job_title_or : ['product manager'],
      ...(cfg.job_location_or?.length ? { job_location_or: cfg.job_location_or } : {}),
      ...(cfg.remote !== undefined    ? { remote: cfg.remote } : {}),
      // Auto-derived from vision (only fields present override defaults).
      ...auto,
      // Final escape hatch wins everything.
      page:                    0,
      limit:                   Math.max(1, Math.min(25, cfg.limit ?? 25)),  // free-tier ceiling
      blur_company_data:       false,
      ...(cfg.extra || {}),
    };

    // Daily cache: per (source, config_hash, today) we hit the API once.
    // Subsequent runs the same day use the cached raw response — lets us
    // re-score / re-bullet without re-billing TheirStack.
    const configHash = await sha1(JSON.stringify(body));
    const cached = await sql<{ raw: { data?: TheirStackJob[]; jobs?: TheirStackJob[] } }[]>`
      select raw
        from job.source_cache
       where source = 'theirstack'
         and config_hash = ${configHash}
         and fetched_on = current_date
       limit 1
    `;
    let json: { data?: TheirStackJob[]; jobs?: TheirStackJob[] };
    if (cached.length) {
      json = cached[0].raw;
      console.log(`[theirstack] cache HIT for ${configHash.slice(0, 12)}`);
    } else {
      console.log(`[theirstack] cache MISS for ${configHash.slice(0, 12)} — calling API`);
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Accept':        'application/json',
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`theirstack ${res.status}: ${text.slice(0, 240)}`);
      }
      json = await res.json() as { data?: TheirStackJob[]; jobs?: TheirStackJob[] };
      const count = (json.data || json.jobs || []).length;
      await sql`
        insert into job.source_cache (source, config_hash, raw, fetched_count)
        values ('theirstack', ${configHash}, ${sql.json(json as unknown as Record<string, unknown>)}, ${count})
        on conflict (source, config_hash, fetched_on)
        do update set raw = excluded.raw, fetched_count = excluded.fetched_count, fetched_at = now()
      `;
    }
    const jobs = json.data || json.jobs || [];

    return jobs.map(j => {
      const company = j.company_object?.name || j.company || '';
      const url     = j.final_url || j.url || '';
      const id      = String(j.id ?? '') || hashKey(`${company}|${j.job_title}|${url}`);
      const loc     = j.long_location || j.location || (j.remote ? 'Remote' : '');
      const sal     = j.salary_string ||
                      (j.min_annual_salary && j.max_annual_salary
                        ? `$${fmt(j.min_annual_salary)} – $${fmt(j.max_annual_salary)}`
                        : (j.max_annual_salary ? `up to $${fmt(j.max_annual_salary)}` : undefined));
      return {
        source:      'theirstack',
        sourceId:    `ts:${id}`,
        sourceLabel: 'TheirStack',
        url,
        company,
        title:       j.job_title || '',
        location:    loc,
        salary:      sal,
        logoUrl:     j.company_object?.logo,
        sector:      j.company_object?.industry,
        postedAt:    j.date_posted,
        description: j.description ? j.description.replace(/\s+/g, ' ').slice(0, 280) : undefined,
        payload:     { domain: j.company_object?.domain, remote: j.remote, hybrid: j.hybrid },
      };
    }).filter(r => r.url && r.title);
  },
};

function fmt(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

function hashKey(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i) | 0;
  return Math.abs(h).toString(36).slice(0, 12);
}

async function sha1(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
