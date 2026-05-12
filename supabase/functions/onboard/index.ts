// onboard — Phase 2/3 of the /job onboarding flow.
//
// One edge function, three modes (kept together so the prompt-shape +
// JSON-schema contract lives in one file):
//
//   POST { mode: 'parse',    text }                 → draft profile from resume/text
//   POST { mode: 'extract',  questionId, answer }   → tags/structured bits for one freeform answer
//   POST { mode: 'finalize', profile, demo? }       → commit (or preview) the full profile
//
// All routes require a signed-in user with a user_profile row
// (verifyJobUserDetailed). RLS does the second-line enforcement when we
// read/write user_profile.
//
// PRD: docs/strategy/prds/job-onboarding-flow.md

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { verifyJobUserDetailed, jsonResp, err, corsHeaders } from '../_shared/job-auth.ts';
import { db } from '../_shared/job-db.ts';

const VERSION = '0.2.0';
console.log(`[onboard] v${VERSION} - parse/bundle/insights/extract/finalize`);

const ANTHROPIC_MODEL = 'claude-haiku-4-5';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MAX_INPUT_CHARS = 32 * 1024;

interface Identity {
  name?: string;
  email?: string;
  phone?: string;
  linkedin?: string;
  portfolio?: string;
  github?: string;
}
interface Location {
  city?: string;
  region?: string;
  country?: string;
  timezone?: string;
  remotePreference?: 'remote' | 'hybrid' | 'onsite' | 'any';
  willingToRelocate?: string[];
  workAuth?: string[];
}
interface HistoryItem {
  company?: string;
  title?: string;
  start?: string;
  end?: string;
  scope?: string;
}
interface Skill { name: string; years?: number | null }
interface DraftProfile {
  identity: Identity;
  location: Location;
  capability: {
    skills: Skill[];
    pastSectors: string[];
    arcTags: string[];
    history: HistoryItem[];
  };
  values_seed: {
    missionKeywords: string[];
    impactThemes: string[];
    cultureKeywords: string[];
    antiCulture: string[];
  };
  targeting: {
    targetRoles: string[];
    targetSectors: string[];
    stagePreference: string[];
    antiMissionTerms: string[];
    missionRequired: boolean;
  };
  preferences: {
    compFloor: number | null;
    remotePreference: 'remote' | 'hybrid' | 'onsite' | 'any';
    missionRequired: boolean;
  };
  wins: Array<{ headline: string; metric?: string | null }>;
  narratives: Array<{ title: string; content_md: string; source_question?: string }>;
}

function emptyDraft(): DraftProfile {
  return {
    identity: {},
    location: {},
    capability: { skills: [], pastSectors: [], arcTags: [], history: [] },
    values_seed: { missionKeywords: [], impactThemes: [], cultureKeywords: [], antiCulture: [] },
    targeting: { targetRoles: [], targetSectors: [], stagePreference: [], antiMissionTerms: [], missionRequired: false },
    preferences: { compFloor: null, remotePreference: 'any', missionRequired: false },
    wins: [],
    narratives: [],
  };
}

async function callClaudeJson(system: string, user: string, maxTokens = 2048): Promise<unknown> {
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
  const data = await res.json() as { content: { type: string; text: string }[] };
  const text = (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('').trim();
  const stripped = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '').trim();
  try { return JSON.parse(stripped); } catch { /* fall through */ }
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(stripped.slice(start, end + 1)); } catch { /* */ }
  }
  throw new Error('claude returned non-JSON: ' + stripped.slice(0, 200));
}

// ---------- parse: resume text → draft profile ----------

const PARSE_SYSTEM = `You parse a person's resume or LinkedIn export into a structured draft profile for their job-search workspace. Be conservative: extract only what's clearly stated. Empty array > guessed value. Return ONLY JSON matching this shape:

{
  "identity": { "name": string?, "email": string?, "phone": string?, "linkedin": string?, "portfolio": string?, "github": string? },
  "location": { "city": string?, "region": string?, "country": string? },
  "capability": {
    "skills": [{ "name": string, "years": number|null }],
    "pastSectors": [string],
    "arcTags": [string],
    "history": [{ "company": string, "title": string, "start": string, "end": string|null, "scope": string }]
  }
}

Rules:
- skills: top 8-12 max, ordered by depth/prominence. years inferred conservatively from role tenure.
- pastSectors: sector tags like "fintech", "healthtech", "climate", "civic-tech", "edtech", "consumer-social".
- arcTags: stage/role-shape tags. Use only: "zero-to-one", "scale-up", "turnaround", "ic-to-manager", "founder", "scaling-team", "scaling-revenue".
- history: most recent first. Dates as "YYYY-MM" or "YYYY" or "Present" for end.
- scope: one short line (≤ 12 words) describing what they did in that role.`;

async function modeParse(text: string): Promise<unknown> {
  const trimmed = text.slice(0, MAX_INPUT_CHARS);
  return await callClaudeJson(PARSE_SYSTEM, trimmed, 3000);
}

// ---------- insights: profile → "what you bring" celebration narrative ----------
//
// Three distinct translation tracks so the user sees what kind of move each
// piece of their background unlocks. Domains (what industries you know) ≠
// work areas (what flows/problems you've shipped) ≠ craft (PM/IC skills).
// Each track lists what they HAVE and what it TRANSLATES TO so adjacent
// sectors become legible without claiming they have experience they don't.

const INSIGHTS_SYSTEM = `You generate a celebration / sector-translation insight card for a job-seeker's onboarding flow. Given their parsed profile (history, sectors, skills, scope lines), return ONLY JSON in this shape:

{
  "hero": string,
  "domains":   [{ "have": string, "translatesTo": [string] }],
  "workAreas": [{ "have": string, "translatesTo": [string] }],
  "skills":    [{ "have": string, "translatesTo": [string] }]
}

Rules:
- hero: one ≤ 60-word paragraph in Wise's voice (sentence case, warm, specific). Quote at least one number from their history. End by naming 2-3 directions their experience unlocks.
- domains: industries / verticals they've operated in. translatesTo lists adjacent verticals that hire that domain knowledge ("public-benefit navigation", "civic-tech eligibility", "patient onboarding for DTC mental health"). 2-4 entries max.
- workAreas: specific problem-spaces / flows / capabilities they've shipped — *not* industries ("user onboarding", "eligibility verification", "engagement loops", "retention", "growth experimentation"). translatesTo lists what that ships into next ("ID verification flows", "benefits applications", "conversion funnels for healthtech DTC"). 2-4 entries max.
- skills: craft they bring — *not* domains, *not* workflows ("product management", "growth experimentation", "user research", "team leadership"). translatesTo lists role shapes their craft unlocks next ("founding PM at seed civic-tech", "head of product at public-benefit org", "growth lead at DTC health"). 2-4 entries max.

Keep these three tracks DISTINCT. A "domain" is a vertical, a "work area" is a problem/flow, a "skill" is a craft. Do not mix them. If you can't fill one track confidently from their data, return [] for that track rather than padding.`;

async function modeInsights(profile: unknown): Promise<unknown> {
  const userText = `Parsed profile:\n${JSON.stringify(profile, null, 2)}`;
  return await callClaudeJson(INSIGHTS_SYSTEM, userText, 2000);
}

// ---------- bundle: multi-doc context pass ----------
//
// Resume text is the primary "parse" input; everything else (cover letters,
// writing samples, LLM transcripts, project descriptions, dream JDs) goes
// through this pass which pulls voice, values signals, projects, and
// dream-role tells without re-parsing structured history.

const BUNDLE_SYSTEM = `You read a bundle of supporting documents a job-seeker has uploaded (cover letters, writing samples, LLM-generated career docs, project descriptions, dream job descriptions, notes-to-self). Return ONLY JSON:

{
  "voiceSample":     string,
  "values":          [string],
  "projects":        [{ "title": string, "summary": string, "metric": string|null }],
  "dreamRoleSignals":[string],
  "wins":            [{ "headline": string, "metric": string|null }]
}

Rules:
- voiceSample: ≤ 200 words verbatim or lightly stitched from THEIR words — the cover-letter agent uses this for voice. Choose the most distinctive 2-3 sentences.
- values: 3-6 short phrases capturing what they care about ("public benefit", "high-agency teams", "research-led product").
- projects: anything they describe as a project/initiative they led. summary ≤ 25 words. metric null when no number stated.
- dreamRoleSignals: if any dream JDs are present, pull 3-5 short phrases describing the shape of role they want.
- wins: numbered accomplishments mentioned. Empty array if none.`;

async function modeBundle(text: string): Promise<unknown> {
  const trimmed = text.slice(0, MAX_INPUT_CHARS);
  return await callClaudeJson(BUNDLE_SYSTEM, trimmed, 2500);
}

// ---------- extract: per-question tag extraction ----------

interface QuestionSpec {
  id: string;
  label: string;
  schema: string;
  notes?: string;
}

const QUESTIONS: Record<string, QuestionSpec> = {
  q1_mission: {
    id: 'q1_mission',
    label: 'What problem do you want to spend the next five years on?',
    schema: `{ "missionKeywords": [string], "impactThemes": [string], "targetSectors": [string], "summary": string }`,
    notes: 'missionKeywords: 3-6 short phrases that capture the *problem domain*. impactThemes: the verbs/outcomes ("reduce friction in public services"). targetSectors: industry tags like "civic-tech", "climate", "healthtech". summary: one-sentence reframe of what they said.',
  },
  q2_self: {
    id: 'q2_self',
    label: 'Describe a time at work where you felt most yourself.',
    schema: `{ "cultureKeywords": [string], "arcTags": [string], "narrativeTitle": string, "narrativeMd": string }`,
    notes: 'cultureKeywords: 3-6 short phrases describing the working environment that energizes them ("high-agency", "research-led", "small team"). arcTags from: zero-to-one, scale-up, turnaround, ic-to-manager, founder, scaling-team, scaling-revenue. narrativeTitle: 4-8 word title. narrativeMd: the user\'s answer lightly cleaned (do not rewrite).',
  },
  q3_win: {
    id: 'q3_win',
    label: 'A win you\'re proud of — ideally with a number attached.',
    schema: `{ "headline": string, "metric": string|null, "narrativeTitle": string, "narrativeMd": string }`,
    notes: 'headline: ≤ 12 words capturing the win. metric: the number or measurable result if any (e.g. "+34% retention", "$2M ARR in 9 months", "team of 12"). null if none mentioned. narrative: same as q2.',
  },
  q4_walkaway: {
    id: 'q4_walkaway',
    label: 'What would make you walk away from a great offer?',
    schema: `{ "antiMissionTerms": [string], "antiCulture": [string], "dealbreakers": [string] }`,
    notes: 'antiMissionTerms: industry/category dealbreakers ("defense", "gambling", "crypto", "adtech"). antiCulture: environment dealbreakers ("hustle culture", "RTO", "ego-driven leadership"). dealbreakers: free-form catch-all for anything else.',
  },
  q5_titles: {
    id: 'q5_titles',
    label: 'What roles and titles should we be hunting for?',
    schema: `{ "targetRoles": [string], "stagePreference": [string], "antiTitles": [string] }`,
    notes: 'targetRoles: 2-4 title patterns ("Head of Product", "Founding PM"). stagePreference from: pre-seed, seed, series-a, series-b, growth, public. antiTitles: titles to exclude.',
  },
  q6_location: {
    id: 'q6_location',
    label: 'Where are you based, and how far are you willing to go?',
    schema: `{ "city": string, "willingToRelocate": [string], "remotePreference": "remote"|"hybrid"|"onsite"|"any" }`,
    notes: 'city: just the city name. willingToRelocate: city names + "Remote-US", "Remote-EU" style chips. remotePreference: the strongest signal in their answer.',
  },
};

async function modeExtract(questionId: string, answer: string): Promise<unknown> {
  const q = QUESTIONS[questionId];
  if (!q) throw new Error(`unknown questionId: ${questionId}`);
  const system = `You extract structured tags from a user's freeform answer to a single onboarding question. The question was: "${q.label}". Return ONLY JSON matching this shape:\n${q.schema}\n${q.notes || ''}\n\nBe specific and concise. Empty array > guessed value. Echo the user's own language where possible — do not impose vocabulary they didn't use.`;
  return await callClaudeJson(system, answer.slice(0, 8000), 1500);
}

// ---------- finalize: commit profile ----------

interface FinalizeBody {
  profile: Partial<DraftProfile>;
  demo?: boolean;
}

async function modeFinalize(userId: string, body: FinalizeBody): Promise<unknown> {
  const merged = { ...emptyDraft(), ...body.profile };
  if (body.demo) {
    return {
      ok: true,
      demo: true,
      preview: {
        wouldWrite: {
          identity: merged.identity,
          location: merged.location,
          targeting: merged.targeting,
          values_seed: merged.values_seed,
          capability: merged.capability,
          preferences: merged.preferences,
          wins: merged.wins,
          narrativeCount: (merged.narratives || []).length,
        },
        note: 'Demo mode — nothing was written to user_profile and onboarding_complete_at was not flipped.',
      },
    };
  }
  const sql = db();
  await sql`
    insert into public.user_profile (
      user_id, identity, location, targeting, values_seed, capability,
      preferences, wins, onboarding_step, onboarding_complete_at
    ) values (
      ${userId},
      ${sql.json(merged.identity)}, ${sql.json(merged.location)},
      ${sql.json(merged.targeting)}, ${sql.json(merged.values_seed)},
      ${sql.json(merged.capability)}, ${sql.json(merged.preferences)},
      ${sql.json(merged.wins)}, 5, now()
    )
    on conflict (user_id) do update set
      identity = excluded.identity,
      location = excluded.location,
      targeting = excluded.targeting,
      values_seed = excluded.values_seed,
      capability = excluded.capability,
      preferences = excluded.preferences,
      wins = excluded.wins,
      onboarding_step = 5,
      onboarding_complete_at = coalesce(public.user_profile.onboarding_complete_at, now())
  `;
  return { ok: true, demo: false, completed_at: new Date().toISOString() };
}

// ---------- HTTP ----------

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return err('POST only', 405);

  const user = await verifyJobUserDetailed(req);
  if (!user) return err('unauthorized', 401);

  let body: { mode?: string; text?: string; questionId?: string; answer?: string; profile?: Partial<DraftProfile>; demo?: boolean };
  try { body = await req.json(); } catch { return err('invalid json'); }

  try {
    switch (body.mode) {
      case 'parse': {
        if (!body.text) return err('text required');
        const draft = await modeParse(body.text);
        return jsonResp({ draft });
      }
      case 'bundle': {
        if (!body.text) return err('text required');
        const bundle = await modeBundle(body.text);
        return jsonResp({ bundle });
      }
      case 'insights': {
        if (!body.profile) return err('profile required');
        const insights = await modeInsights(body.profile);
        return jsonResp({ insights });
      }
      case 'extract': {
        if (!body.questionId || !body.answer) return err('questionId + answer required');
        const tags = await modeExtract(body.questionId, body.answer);
        return jsonResp({ tags });
      }
      case 'finalize': {
        if (!body.profile) return err('profile required');
        const result = await modeFinalize(user.id, { profile: body.profile, demo: !!body.demo });
        return jsonResp(result);
      }
      default:
        return err(`unknown mode: ${body.mode}`);
    }
  } catch (e) {
    console.error('[onboard] error', e);
    return err((e as Error).message || 'internal error', 500);
  }
});
