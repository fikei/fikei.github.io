// ats-radar — verified-open postings from the /job-radar local ATS sweep.
//
// The sweep runs on Ian's machine (first-party ATS APIs + HTML boards the
// server can't parse) and pushes each run into job.ats_radar_scans via the
// ats-radar-ingest endpoint. This plugin reads the LATEST run's structured
// rows and emits them as RecommendedRoleInput, so the pull-recommendations
// worker applies the same universe gate, dedupe, grading, and bullets as
// every other source.
//
// Prime directive (from the skill): only postings that appeared in a
// first-party fetch of the latest run are emitted. Boards that errored are
// UNVERIFIED — absent here, and excluded from liveness closure by the
// worker (atsRadarLiveness only closes recs for boards fetched OK).
import { db } from '../job-db.ts';
import type { Source, RecommendedRoleInput } from './types.ts';

interface ScanJob { title?: string; location?: string; url?: string; posted?: string }
interface ScanRow {
  company: string; company_slug: string; ats_type: string | null;
  segments: string[] | null; location: string | null; careers_url: string | null;
  fetched_at: string | null; jobs: ScanJob[] | null;
}

// Stable per-posting key: the ATS job id when the URL carries one (digits
// or a uuid-ish tail segment), else the normalized URL. Prefixed with the
// company slug so liveness can scope closures per board — mirrors the
// tracked-ats `<provider>:<slug>:<id>` shape (slug = split_part(…, 2)).
export function atsRadarSourceId(slug: string, url: string): string {
  let key = url.toLowerCase().replace(/[?#].*$/, '').replace(/\/+$/, '');
  const tail = key.split('/').pop() || '';
  if (/^\d+$/.test(tail) || /^[0-9a-f-]{8,}$/.test(tail)) key = tail;
  return `ats:${slug}:${key}`;
}

export const atsRadarSource: Source = {
  type: 'ats-radar',
  async pull(): Promise<RecommendedRoleInput[]> {
    const sql = db();
    const rows = await sql<ScanRow[]>`
      select company, company_slug, ats_type, segments, location, careers_url, fetched_at, jobs
        from job.ats_radar_scans
       where scan_run_at = (select max(scan_run_at) from job.ats_radar_scans)
         and ok
         and kind = 'structured'`;
    const out: RecommendedRoleInput[] = [];
    for (const r of rows) {
      for (const j of (r.jobs || [])) {
        if (!j?.url || !j?.title) continue;
        out.push({
          source:      'ats-radar',
          sourceId:    atsRadarSourceId(r.company_slug, j.url),
          sourceLabel: `ATS boards · ${r.company}`,
          url:         j.url,
          company:     r.company,
          title:       j.title,
          location:    j.location || r.location || undefined,
          postedAt:    j.posted || undefined,
          sector:      'outdoor / soft goods',
          payload: {
            fetchedAt:  r.fetched_at,
            careersUrl: r.careers_url,
            atsType:    r.ats_type,
            segments:   r.segments || [],
            board:      'job-radar',
          },
        });
      }
    }
    return out;
  },
};
