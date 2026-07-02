// Shape every Source plugin returns. Maps 1:1 onto the columns the
// pull-recommendations worker writes into job.recommended_roles.
//
// `source` and `sourceId` together must be unique across all rows the
// plugin ever emits — the worker relies on the unique(source, source_id)
// constraint to dedupe across runs.
export interface RecommendedRoleInput {
  source:        string;            // 'tracked-ats' | 'linkedin-rss' | …
  sourceId:      string;            // stable per posting (e.g. ATS posting ID)
  sourceLabel?:  string;            // user-facing, e.g. "Greenhouse · Abridge"
  url:           string;
  company?:      string;
  title?:        string;
  location?:     string;
  salary?:       string;
  logoUrl?:      string;
  postedAt?:     string;            // ISO8601
  description?:  string;
  // Scoring hints — plugins fill these from whatever metadata they can
  // grab so the fit-score step has signal to work with. Optional;
  // missing fields fall back to neutral defaults inside computeFit.
  sector?:       string;
  investors?:    string[];
  // matchBullets are produced post-pull by the worker; plugins leave
  // this empty and let the worker generate them once per new row.
  payload?:      Record<string, unknown>;
  // Enrichment status for sources that resolve a canonical posting in a
  // separate step (e.g. gmail-jobs → enrich-job-source). 'unresolved'
  // means we surfaced the row with the alert/aggregator URL because we
  // couldn't find the canonical JD; the widget should flag it. Sources
  // that don't have this concept can leave these undefined.
  enrichmentStatus?:    'resolved' | 'unresolved' | 'failed';
  enrichmentRetryAt?:   string;       // ISO8601
  canonicalUrl?:        string;       // canonical apply URL when resolved
  companyId?:           string;       // job.hiring_companies.id when known
  // Set by the company-watch plugin: the job.watched_companies row that
  // produced this posting. Drives per-company filter_mode at read time
  // and suppresses the public/mega-cap hard-fail at scoring time.
  watchedCompanyId?:    string;
}

// A Source<Cfg> is a pure function from config → array of postings. No
// DB access, no env vars beyond what the plugin needs for the upstream
// API. Throwing is fine — the worker captures errors per source.
export interface Source<Cfg = Record<string, unknown>> {
  type:        string;
  pull(cfg: Cfg, ctx: SourceContext): Promise<RecommendedRoleInput[]>;
}

// What the worker passes to every plugin. Kept tiny on purpose —
// expand only when a plugin actually needs it.
export interface SourceContext {
  userEmail: string;
  // `since` lets a plugin skip postings older than the last successful
  // run. May be null on first run.
  since: Date | null;
}
