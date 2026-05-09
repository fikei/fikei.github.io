// tracked-ats — pulls open postings from every row in
// job.tracked_companies that has an `ats` + `ats_slug`. One plugin
// covers Greenhouse, Lever, and Ashby because their public job-board
// APIs don't require auth and return roughly the same shape.
//
// Config is empty: the company list comes from the DB, not from the
// user_sources row. That keeps "tracked companies" a single concept —
// you add a company once, it shows up everywhere.

import type { Source, RecommendedRoleInput } from './types.ts';
import { db } from '../job-db.ts';

interface TrackedCompany {
  slug: string;
  name: string;
  ats: string | null;
  ats_slug: string | null;
  sector: string | null;
}

// ---------- Per-ATS adapters ----------
// Each returns the same RecommendedRoleInput shape so the worker
// downstream is ATS-agnostic.

async function pullGreenhouse(c: TrackedCompany): Promise<RecommendedRoleInput[]> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(c.ats_slug!)}/jobs`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`greenhouse ${c.ats_slug} → ${res.status}`);
  const data = await res.json() as { jobs: Array<{ id: number; title: string; absolute_url: string; updated_at: string; location?: { name: string } }> };
  return (data.jobs || []).map(j => ({
    source:      'tracked-ats',
    sourceId:    `gh:${c.ats_slug}:${j.id}`,
    sourceLabel: `Greenhouse · ${c.name}`,
    url:         j.absolute_url,
    company:     c.name,
    title:       j.title,
    location:    j.location?.name,
    postedAt:    j.updated_at,
    payload:     { ats: 'Greenhouse', companySlug: c.slug, atsSlug: c.ats_slug, jobId: j.id },
  }));
}

async function pullLever(c: TrackedCompany): Promise<RecommendedRoleInput[]> {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(c.ats_slug!)}?mode=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`lever ${c.ats_slug} → ${res.status}`);
  const data = await res.json() as Array<{ id: string; text: string; hostedUrl: string; createdAt: number; categories?: { location?: string } }>;
  return (data || []).map(j => ({
    source:      'tracked-ats',
    sourceId:    `lever:${c.ats_slug}:${j.id}`,
    sourceLabel: `Lever · ${c.name}`,
    url:         j.hostedUrl,
    company:     c.name,
    title:       j.text,
    location:    j.categories?.location,
    postedAt:    j.createdAt ? new Date(j.createdAt).toISOString() : undefined,
    payload:     { ats: 'Lever', companySlug: c.slug, atsSlug: c.ats_slug, jobId: j.id },
  }));
}

async function pullAshby(c: TrackedCompany): Promise<RecommendedRoleInput[]> {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(c.ats_slug!)}?includeCompensation=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ashby ${c.ats_slug} → ${res.status}`);
  const data = await res.json() as { jobs?: Array<{ id: string; title: string; jobUrl: string; publishedAt?: string; locationName?: string; compensationTierSummary?: string }> };
  return (data.jobs || []).map(j => ({
    source:      'tracked-ats',
    sourceId:    `ashby:${c.ats_slug}:${j.id}`,
    sourceLabel: `Ashby · ${c.name}`,
    url:         j.jobUrl,
    company:     c.name,
    title:       j.title,
    location:    j.locationName,
    salary:      j.compensationTierSummary,
    postedAt:    j.publishedAt,
    payload:     { ats: 'Ashby', companySlug: c.slug, atsSlug: c.ats_slug, jobId: j.id },
  }));
}

const ADAPTERS: Record<string, (c: TrackedCompany) => Promise<RecommendedRoleInput[]>> = {
  greenhouse: pullGreenhouse,
  lever:      pullLever,
  ashby:      pullAshby,
};

// Best-effort derivation from a posting URL — used as a fallback when
// tracked_companies is empty / un-backfilled. Returns null if the URL
// isn't a recognized ATS posting.
function deriveFromUrl(url: string): { ats: string; atsSlug: string } | null {
  try {
    const u = new URL(url);
    const host = u.hostname;
    const seg = u.pathname.split('/').filter(Boolean);
    if (/(?:^|\.)(boards|job-boards)\.greenhouse\.io$/i.test(host) && seg[0]) {
      return { ats: 'Greenhouse', atsSlug: seg[0] };
    }
    if (/(?:^|\.)jobs\.lever\.co$/i.test(host) && seg[0]) {
      return { ats: 'Lever', atsSlug: seg[0] };
    }
    if (/(?:^|\.)jobs\.ashbyhq\.com$/i.test(host) && seg[0]) {
      return { ats: 'Ashby', atsSlug: seg[0] };
    }
    return null;
  } catch { return null; }
}

export const trackedAtsSource: Source = {
  type: 'tracked-ats',
  async pull(_cfg, ctx) {
    const sql = db();

    // 1) Companies you've explicitly tracked.
    const tracked = await sql<TrackedCompany[]>`
      select slug, name, ats, ats_slug, sector
      from job.tracked_companies
      where ats is not null and ats_slug is not null
    `;

    // 2) Fallback: scan existing pipeline rows for ATS URLs and derive
    //    company-board pairs we haven't seen yet. Means you don't have
    //    to backfill anything for the source to start working — the
    //    moment you add a Greenhouse/Lever/Ashby URL to the pipeline,
    //    we'll start pulling that company's whole board.
    const pipelineRows = await sql<{ company_name: string; url: string; sector: string | null }[]>`
      select company_name, url, sector
      from job.pipeline_roles
      where url is not null
        and url ~* '(greenhouse|lever|ashbyhq)'
    `;
    const seen = new Set(tracked.map(c => `${(c.ats || '').toLowerCase()}:${(c.ats_slug || '').toLowerCase()}`));
    const companies: TrackedCompany[] = [...tracked];
    for (const r of pipelineRows) {
      const d = deriveFromUrl(r.url);
      if (!d) continue;
      const key = `${d.ats.toLowerCase()}:${d.atsSlug.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      companies.push({
        slug:     d.atsSlug.toLowerCase(),
        name:     r.company_name,
        ats:      d.ats,
        ats_slug: d.atsSlug,
        sector:   r.sector,
      });
    }
    const out: RecommendedRoleInput[] = [];
    for (const c of companies) {
      const adapter = ADAPTERS[(c.ats || '').toLowerCase()];
      if (!adapter) continue;
      try {
        const rawRows = await adapter(c);
        // Stamp the company's sector onto every posting so the worker's
        // fit step has signal beyond just the title.
        const rows = rawRows.map(r => ({ ...r, sector: r.sector ?? c.sector ?? undefined }));
        // Optional `since` filter — postedAt is sometimes missing, in
        // which case we keep the row (better to overshoot than to lose
        // a posting that lacks a timestamp).
        const filtered = ctx.since
          ? rows.filter(r => !r.postedAt || new Date(r.postedAt) >= ctx.since!)
          : rows;
        out.push(...filtered);
      } catch (e) {
        console.warn(`[tracked-ats] ${c.ats}/${c.ats_slug}: ${(e as Error).message}`);
      }
    }
    return out;
  },
};
