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

interface TheirStackConfig {
  job_title_or?:           string[];
  job_location_or?:        Array<{ id: number }>;
  posted_at_max_age_days?: number;
  limit?:                  number;
  remote?:                 boolean;
  extra?:                  Record<string, unknown>;
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

    const body = {
      include_total_results:   false,
      posted_at_max_age_days:  cfg.posted_at_max_age_days ?? 15,
      job_title_or:            cfg.job_title_or && cfg.job_title_or.length ? cfg.job_title_or : ['product manager'],
      ...(cfg.job_location_or?.length ? { job_location_or: cfg.job_location_or } : {}),
      ...(cfg.remote !== undefined    ? { remote: cfg.remote } : {}),
      page:                    0,
      limit:                   Math.max(1, Math.min(100, cfg.limit ?? 50)),
      blur_company_data:       false,
      ...(cfg.extra || {}),
    };

    // Daily cache: per (source, config_hash, today) we hit the API once.
    // Subsequent runs the same day use the cached raw response — lets us
    // re-score / re-bullet without re-billing TheirStack.
    const sql = db();
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
