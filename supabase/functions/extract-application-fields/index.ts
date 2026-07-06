// extract-application-fields — given a job apply URL, return a normalized
// schema describing every field and custom question the user has to fill
// out. The Apply takeover consumes this to drive the wizard.
//
//   POST { slug, url }   → { ats, source_url, general, requires, custom_questions, raw? }
//
// Strategy:
//   1. Detect the ATS from the URL.
//   2. For Greenhouse / Lever / Ashby, hit their public read APIs which
//      expose application questions structurally. No scraping, no auth.
//   3. Fallback: fetch the HTML and ask Claude Haiku to extract a
//      schema, returning a best-effort guess (works for one-off ATSes,
//      Workday and Notion-careers landings).
//
// Persists the schema into job.application_draft.fields keyed by
// (auth.uid(), slug) so subsequent steps can read it without re-fetching.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { verifyJobUserDetailed, jsonResp, err, corsHeaders } from '../_shared/job-auth.ts';
import { db } from '../_shared/job-db.ts';

const VERSION = '0.2.0';
console.log(`[extract-application-fields] v${VERSION} - raw-fetch Anthropic (no SDK)`);

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-haiku-4-5';

async function callClaude(system: string, user: string, maxTokens = 4000): Promise<string> {
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
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`anthropic ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json() as { content: { type: string; text: string }[] };
  return (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
}

// ----- ATS detection -----------------------------------------------------
type Ats =
  | { kind: 'greenhouse'; board: string; id: string }
  | { kind: 'lever';      company: string; id: string }
  | { kind: 'ashby';      company: string; id: string }
  | { kind: 'workday';    host: string; path: string }
  | { kind: 'unknown'                                       };

function detectAts(rawUrl: string): Ats {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.toLowerCase();
    const segs = u.pathname.split('/').filter(Boolean);

    // Greenhouse classic: boards.greenhouse.io/<board>/jobs/<id>
    // Greenhouse embed:   <co>.greenhouse.io/embed/job_app?token=<id> (rare)
    if (host.endsWith('greenhouse.io')) {
      const i = segs.findIndex(s => s === 'jobs');
      if (i >= 0 && segs[i + 1]) {
        const board = segs[0];
        const id = segs[i + 1].split('?')[0];
        if (board && id) return { kind: 'greenhouse', board, id };
      }
      const tok = u.searchParams.get('token') || u.searchParams.get('gh_jid');
      if (tok && segs[0]) return { kind: 'greenhouse', board: segs[0], id: tok };
    }

    // Lever: jobs.lever.co/<company>/<id>
    if (host.endsWith('lever.co')) {
      const [company, id] = segs;
      if (company && id) return { kind: 'lever', company, id: id.split('?')[0] };
    }

    // Ashby: jobs.ashbyhq.com/<company>/<id>  (or /<company>/jobs/<id> rarely)
    if (host.endsWith('ashbyhq.com')) {
      const company = segs[0];
      const id = (segs[1] === 'jobs' ? segs[2] : segs[1]) || '';
      if (company && id) return { kind: 'ashby', company, id: id.split('?')[0] };
    }

    // Workday: <tenant>.myworkdayjobs.com/<site>/job/<…>/<jobReq>
    if (host.endsWith('myworkdayjobs.com')) {
      return { kind: 'workday', host, path: u.pathname };
    }
  } catch { /* fall through */ }
  return { kind: 'unknown' };
}

// ----- Normalized schema -------------------------------------------------
type GenField = {
  id: string;
  label: string;
  type: 'text' | 'email' | 'phone' | 'url' | 'select' | 'textarea';
  required: boolean;
  maps_to?: string;        // 'first_name'|'last_name'|'email'|'phone'|'location'|'linkedin'|'github'|'portfolio'|'work_auth'|'sponsorship'
  options?: string[];
};
type CustomQ = {
  id: string;
  prompt: string;
  type: 'long_text' | 'short_text' | 'select' | 'multiselect' | 'yes_no' | 'file' | 'url';
  required: boolean;
  options?: string[];
  max_length?: number;
};
type Schema = {
  ats: string;
  source_url: string;
  job_id?: string;
  general: GenField[];
  requires: { resume: boolean; cover_letter: boolean; photo?: boolean };
  custom_questions: CustomQ[];
  notes?: string;
};

// Best-effort label → maps_to inference for general info auto-fill.
function inferMapping(label: string): string | undefined {
  const l = (label || '').toLowerCase();
  if (/first\s*name/.test(l))                         return 'first_name';
  if (/last\s*name|surname|family/.test(l))           return 'last_name';
  if (/full\s*name|^name$/.test(l))                   return 'full_name';
  if (/e-?mail/.test(l))                              return 'email';
  if (/phone|mobile|cell/.test(l))                    return 'phone';
  if (/linkedin/.test(l))                             return 'linkedin';
  if (/github/.test(l))                               return 'github';
  if (/portfolio|website|personal\s*site/.test(l))    return 'portfolio';
  if (/city|location|where.*based|address/.test(l))   return 'location';
  if (/authoriz(e|ed).*work|work\s*authoriz|legally.*work/.test(l)) return 'work_auth';
  if (/sponsor/.test(l))                              return 'sponsorship';
  if (/pronoun/.test(l))                              return 'pronouns';
  return undefined;
}

// ----- Greenhouse --------------------------------------------------------
async function extractGreenhouse(g: Extract<Ats, { kind: 'greenhouse' }>, sourceUrl: string): Promise<Schema> {
  // Public read API — questions array exposes every form field structurally.
  const api = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(g.board)}/jobs/${encodeURIComponent(g.id)}?questions=true`;
  const res = await fetch(api, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`greenhouse ${res.status} for ${g.board}/${g.id}`);
  const data = await res.json();
  const questions = Array.isArray(data.questions) ? data.questions : [];

  const general: GenField[] = [];
  const custom:  CustomQ[]  = [];
  let needsResume = false;
  let needsCover  = false;

  for (const q of questions) {
    const label   = String(q?.label || '').trim();
    const required = !!q?.required;
    const fields  = Array.isArray(q?.fields) ? q.fields : [];
    if (!fields.length) continue;
    const f0 = fields[0];
    const name = String(f0?.name || '').toLowerCase();
    const ftype = String(f0?.type || '').toLowerCase();

    // Resume / cover letter file uploads
    if (name === 'resume') { needsResume = true; continue; }
    if (name === 'cover_letter' || /cover\s*letter/.test(label.toLowerCase())) { needsCover = true; continue; }

    // Map structured Greenhouse types → our schema.
    const id = String(f0?.name || label).toLowerCase().replace(/[^a-z0-9_]+/g, '_');
    const opts = Array.isArray(f0?.values) ? f0.values.map((v: { label: string }) => String(v.label)) : undefined;

    if (ftype === 'input_text') {
      const mapped = inferMapping(label);
      if (mapped) general.push({ id, label, type: 'text', required, maps_to: mapped });
      else        custom.push({ id, prompt: label, type: 'short_text', required });
    } else if (ftype === 'input_file') {
      custom.push({ id, prompt: label, type: 'file', required });
    } else if (ftype === 'textarea') {
      custom.push({ id, prompt: label, type: 'long_text', required });
    } else if (ftype === 'multi_value_single_select_fields' || ftype === 'multi_value_multi_select_fields') {
      const t = ftype.startsWith('multi_value_multi') ? 'multiselect' : 'select';
      // Yes/no shortcut
      const yes = (opts || []).map(o => o.toLowerCase());
      if (t === 'select' && yes.length === 2 && yes.every(v => /^(yes|no)$/.test(v))) {
        custom.push({ id, prompt: label, type: 'yes_no', required });
      } else {
        custom.push({ id, prompt: label, type: t, required, options: opts });
      }
    } else if (ftype === 'input_url' || /linkedin|website|portfolio|github/.test(label.toLowerCase())) {
      const mapped = inferMapping(label);
      if (mapped) general.push({ id, label, type: 'url', required, maps_to: mapped });
      else        custom.push({ id, prompt: label, type: 'url', required });
    } else {
      // Unknown → safest is short text custom question.
      custom.push({ id, prompt: label, type: 'short_text', required });
    }
  }

  return {
    ats: 'greenhouse',
    source_url: sourceUrl,
    job_id: g.id,
    general,
    requires: { resume: needsResume, cover_letter: needsCover },
    custom_questions: custom,
  };
}

// ----- Lever -------------------------------------------------------------
async function extractLever(l: Extract<Ats, { kind: 'lever' }>, sourceUrl: string): Promise<Schema> {
  // Lever's public postings API doesn't include the application form
  // questions (they live in the apply iframe HTML). Hit /apply on the
  // job page and parse the form. As of 2024 Lever forms ship with
  // visible `data-qa` attributes per field.
  const applyUrl = sourceUrl.replace(/\/?$/, '/apply');
  const html = await fetchText(applyUrl);
  const general: GenField[] = [];
  const custom:  CustomQ[]  = [];

  // Standard Lever fields — name, email, phone, current_company, urls.
  const labels = Array.from(html.matchAll(/<label[^>]*>([\s\S]*?)<\/label>/gi)).map(m => stripHtml(m[1]).trim()).filter(Boolean);
  const requiredFlags = (html.match(/required/gi) || []).length;

  // We can't reliably parse Lever without DOM. Hand off to HTML fallback.
  return await extractHtmlFallback(sourceUrl, html, 'lever', { labelsHint: labels, requiredHint: requiredFlags });
}

// ----- Ashby -------------------------------------------------------------
async function extractAshby(a: Extract<Ats, { kind: 'ashby' }>, sourceUrl: string): Promise<Schema> {
  // Ashby exposes a public GraphQL endpoint for the unauthenticated
  // applicant-facing job page. Schema fields below match what their JS
  // bundle requests on the apply page (verified 2025-Q2). If the
  // response shape changes we fall back to HTML extraction.
  const query = `
    query ApiJobPosting($organizationHostedJobsPageName: String!, $jobPostingId: String!) {
      jobPosting(
        organizationHostedJobsPageName: $organizationHostedJobsPageName,
        jobPostingId: $jobPostingId
      ) {
        id title
        applicationFormDefinition {
          sections {
            descriptionHtml
            fields {
              path field { type title isNullable selectableValues descriptionHtml }
              isRequired
            }
          }
        }
      }
    }`;
  try {
    const res = await fetch('https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        operationName: 'ApiJobPosting',
        query,
        variables: { organizationHostedJobsPageName: a.company, jobPostingId: a.id },
      }),
    });
    if (!res.ok) throw new Error(`ashby ${res.status}`);
    const data = await res.json();
    const sections = data?.data?.jobPosting?.applicationFormDefinition?.sections;
    if (!Array.isArray(sections)) throw new Error('ashby: missing form definition');

    const general: GenField[] = [];
    const custom:  CustomQ[]  = [];
    let needsResume = false;
    let needsCover  = false;

    for (const sec of sections) {
      for (const f of (sec.fields || [])) {
        const path = String(f?.path || '');
        const title = stripHtml(String(f?.field?.title || '')).trim();
        const type  = String(f?.field?.type || '').toLowerCase();
        const required = !!f?.isRequired;
        const id = path || title.toLowerCase().replace(/[^a-z0-9_]+/g, '_');

        if (/resume/.test(path) || /resume/i.test(title))         { needsResume = true; continue; }
        if (/cover/.test(path)  || /cover\s*letter/i.test(title)) { needsCover  = true; continue; }

        const options = Array.isArray(f?.field?.selectableValues)
          ? f.field.selectableValues.map((v: { label?: string; value?: string }) => String(v.label ?? v.value ?? ''))
          : undefined;

        if (type === 'shorttext' || type === 'string') {
          const mapped = inferMapping(title);
          if (mapped) general.push({ id, label: title, type: 'text', required, maps_to: mapped });
          else        custom.push({ id, prompt: title, type: 'short_text', required });
        } else if (type === 'longtext') {
          custom.push({ id, prompt: title, type: 'long_text', required });
        } else if (type === 'email') {
          general.push({ id, label: title || 'Email', type: 'email', required, maps_to: 'email' });
        } else if (type === 'phone') {
          general.push({ id, label: title || 'Phone', type: 'phone', required, maps_to: 'phone' });
        } else if (type === 'url' || type === 'socialmediaurl') {
          const mapped = inferMapping(title);
          if (mapped) general.push({ id, label: title, type: 'url', required, maps_to: mapped });
          else        custom.push({ id, prompt: title, type: 'url', required });
        } else if (type === 'singleselect' || type === 'yesno' || type === 'boolean') {
          if (type === 'yesno' || type === 'boolean') custom.push({ id, prompt: title, type: 'yes_no', required });
          else custom.push({ id, prompt: title, type: 'select', required, options });
        } else if (type === 'multiselect') {
          custom.push({ id, prompt: title, type: 'multiselect', required, options });
        } else if (type === 'file') {
          custom.push({ id, prompt: title, type: 'file', required });
        } else {
          custom.push({ id, prompt: title, type: 'short_text', required });
        }
      }
    }

    return {
      ats: 'ashby',
      source_url: sourceUrl,
      job_id: a.id,
      general,
      requires: { resume: needsResume, cover_letter: needsCover },
      custom_questions: custom,
    };
  } catch (e) {
    console.warn('[extract-application-fields] ashby graphql failed, falling back', e);
    const html = await fetchText(sourceUrl);
    return await extractHtmlFallback(sourceUrl, html, 'ashby');
  }
}

// ----- HTML fallback (Workday, one-off ATSes, paranoid extraction) ------
async function extractHtmlFallback(sourceUrl: string, html: string, ats: string, hint?: { labelsHint?: string[]; requiredHint?: number }): Promise<Schema> {
  const apiKey = (Deno.env.get('LADDER_ANTHROPIC_API_KEY') || Deno.env.get('ANTHROPIC_API_KEY'));
  if (!apiKey) {
    return {
      ats,
      source_url: sourceUrl,
      general: [],
      requires: { resume: true, cover_letter: false },
      custom_questions: [],
      notes: 'fallback skipped: ANTHROPIC_API_KEY unset',
    };
  }
  // Trim the HTML aggressively — most apply forms fit in well under 30k
  // chars of visible text. We strip scripts/styles and collapse whitespace.
  const trimmed = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 40_000);

  const sys = `You analyze a job application form's raw HTML and return a strict JSON schema describing the fields the applicant must fill out.

Output ONLY valid JSON matching this TypeScript type — no prose, no markdown fences:

type Out = {
  general: Array<{ id: string; label: string; type: "text"|"email"|"phone"|"url"|"select"|"textarea"; required: boolean; maps_to?: "first_name"|"last_name"|"full_name"|"email"|"phone"|"location"|"linkedin"|"github"|"portfolio"|"work_auth"|"sponsorship"|"pronouns" }>,
  requires: { resume: boolean; cover_letter: boolean; photo?: boolean },
  custom_questions: Array<{ id: string; prompt: string; type: "long_text"|"short_text"|"select"|"multiselect"|"yes_no"|"file"|"url"; required: boolean; options?: string[]; max_length?: number }>,
  notes?: string
};

Rules:
- "general" = name/contact/links/standard demographics. Set maps_to when obvious.
- "custom_questions" = anything the candidate writes prose for, or selects from job-specific options.
- For long free-text fields use "long_text".
- Skip EEO / voluntary self-id sections — leave them out.
- If a field's required state is unclear, set required=false.
- ids must be short snake_case strings unique within their array.`;

  const user = `Application URL: ${sourceUrl}\nATS guess: ${ats}\n\nHTML (truncated):\n${trimmed}`;

  const text = await callClaude(sys, user, 4000);
  let parsed: Partial<Schema> = {};
  try {
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
  } catch (e) {
    console.warn('[extract-application-fields] fallback parse fail', e, text.slice(0, 200));
  }
  return {
    ats,
    source_url: sourceUrl,
    general: Array.isArray(parsed.general) ? parsed.general : [],
    requires: parsed.requires && typeof parsed.requires === 'object'
      ? { resume: !!parsed.requires.resume, cover_letter: !!parsed.requires.cover_letter, photo: !!parsed.requires.photo }
      : { resume: true, cover_letter: false },
    custom_questions: Array.isArray(parsed.custom_questions) ? parsed.custom_questions : [],
    notes: parsed.notes || `fallback via Haiku (${ats})`,
  };
}

// ----- utils --------------------------------------------------------------
async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; ctrl-rodeo-apply/0.1)',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  return await res.text();
}
function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// ----- handler ------------------------------------------------------------
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST')    return err('method not allowed', 405);

  try {
    const user = await verifyJobUserDetailed(req);
    if (!user) return err('unauthorized', 401);

    const body = await req.json().catch(() => ({}));
    const slug = String(body.slug || '').toLowerCase();
    const url  = String(body.url || '').trim();
    if (!/^[a-z0-9_-]+$/.test(slug)) return err('invalid slug', 400);
    if (!/^https?:\/\//.test(url))   return err('invalid url', 400);

    const ats = detectAts(url);
    let schema: Schema;
    try {
      if (ats.kind === 'greenhouse')      schema = await extractGreenhouse(ats, url);
      else if (ats.kind === 'ashby')      schema = await extractAshby(ats, url);
      else if (ats.kind === 'lever')      schema = await extractLever(ats, url);
      else {
        const html = await fetchText(url);
        schema = await extractHtmlFallback(url, html, ats.kind);
      }
    } catch (e) {
      console.warn('[extract-application-fields] primary path failed, html fallback', e);
      const html = await fetchText(url);
      schema = await extractHtmlFallback(url, html, ats.kind);
    }

    // Persist into the draft row so the takeover can pick it up.
    const sql = db();
    await sql`
      insert into job.application_draft (user_id, role_slug, apply_url, ats, fields, extracted_at)
      values (${user.id}, ${slug}, ${url}, ${schema.ats}, ${JSON.stringify(schema)}::jsonb, now())
      on conflict (user_id, role_slug) do update set
        apply_url = excluded.apply_url,
        ats       = excluded.ats,
        fields    = excluded.fields,
        extracted_at = now(),
        updated_at = now();
    `;

    return jsonResp(schema);
  } catch (e) {
    console.error('[extract-application-fields] error', e);
    return err((e as Error).message || 'server error', 500);
  }
});
