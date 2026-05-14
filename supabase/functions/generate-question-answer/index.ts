// generate-question-answer — given an application's custom question,
// the user's narratives, vision, and the role's analysis, return a
// structured answer with sourced stories and annotated rationale.
//
//   POST {
//     slug,            // role slug (used to load role analysis)
//     question_id,
//     prompt,          // the question itself
//     type,            // long_text | short_text | select | …
//     max_length?,
//     options?,
//   } →  {
//     intent,                  // string — what the company is really asking
//     standout,                // string — what a great answer would look like
//     stories: [{ id, title, why }], // narratives sourced from job.narratives
//     draft,                   // markdown draft answer in the user's voice
//     highlights:    [{ phrase, label, rationale }],
//     opportunities: [{ phrase, gap, ask }],
//   }
//
// The frontend persists this into application_draft.answers[question_id]
// and re-uses the rationale + opportunities the same way the cover letter
// step does.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { verifyJobUserDetailed, jsonResp, err, corsHeaders } from '../_shared/job-auth.ts';
import { db } from '../_shared/job-db.ts';
import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.30.1?target=deno&deno-std=0.168.0';

const VERSION = '0.1.0';
console.log(`[generate-question-answer] v${VERSION} - per-question annotated drafts`);

const MODEL = 'claude-haiku-4-5-20251001';

const SYS = `You write application answers for a senior product / strategy operator (the user) and return them in a strict JSON shape that downstream UI consumes.

Output ONLY valid JSON — no prose, no markdown fences. Schema:

{
  "intent":   string,    // 1-2 sentences — what the company is *really* asking. Distinguish surface ask from underlying signal.
  "standout": string,    // 1-3 sentences — what a *standout* answer demonstrates. Be specific, not generic.
  "stories":  Array<{ id: string, title: string, why: string }>,  // up to 3 narratives from the supplied list that best fit. why = 1 sentence linking narrative to question.
  "draft":    string,    // The actual answer, in markdown, in the user's voice. Tight, specific, no clichés, no "I am passionate." Match the question's tone.
  "highlights":    Array<{ phrase: string, label: string, rationale: string }>,  // verbatim substrings of "draft". label = short tag (≤4 words). rationale = why this phrase is load-bearing.
  "opportunities": Array<{ phrase: string, gap: string, ask: string }>           // verbatim substrings of "draft" that are weakest. gap = what's missing. ask = one targeted question the user could answer to strengthen it.
}

Rules:
- Voice: confident, plainspoken, concrete. No corporate filler ("synergies", "passionate", "thrilled"). No em-dashes unless the user's narratives use them.
- Length: respect max_length when given (count characters, not tokens). For long_text aim for 120-220 words unless max_length forces shorter.
- Stories: only cite stories from the supplied narrative list. Do not invent.
- Highlights: 2-5 entries. Each phrase MUST be a verbatim substring of draft (case sensitive). Skip if you cannot identify load-bearing phrases.
- Opportunities: 0-3. Each opportunity's phrase MUST be a verbatim substring of draft. If the user has clear evidence already, leave opportunities empty.`;

async function loadContext(sql: ReturnType<typeof db>, userId: string, slug: string) {
  const [narrRows, profileRows, analysisRows, narrAddRows, jdRows] = await Promise.all([
    sql`select id, title, tags, linked_company_slug, content_md from job.narratives where user_id = ${userId}`,
    sql`select identity, location, capability, values_seed, targeting from public.user_profile where user_id = ${userId} limit 1;`,
    sql`select content_md from job.role_assets where role_slug = ${slug} and kind = 'analysis' limit 1;`,
    sql`select content_md from job.global_assets where kind = 'narrative-additions' limit 1;`,
    sql`select description_md from job.pipeline_roles where slug = ${slug} limit 1;`,
  ]);
  return {
    narratives: narrRows,
    profile: profileRows[0] || null,
    analysisMd: analysisRows[0]?.content_md || '',
    narrativeAdditionsMd: narrAddRows[0]?.content_md || '',
    jdMd: jdRows[0]?.description_md || '',
  };
}

function parseAnalysis(md: string): Record<string, unknown> | null {
  if (!md) return null;
  const fence = md.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : md;
  try { return JSON.parse(body); } catch { return null; }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST')    return err('method not allowed', 405);

  try {
    const user = await verifyJobUserDetailed(req);
    if (!user) return err('unauthorized', 401);

    const body = await req.json().catch(() => ({}));
    const slug = String(body.slug || '').toLowerCase();
    const prompt = String(body.prompt || '').trim();
    const qid = String(body.question_id || '').trim();
    const type = String(body.type || 'long_text');
    const maxLen = Number.isFinite(body.max_length) ? Number(body.max_length) : null;
    const options = Array.isArray(body.options) ? body.options : null;
    if (!/^[a-z0-9_-]+$/.test(slug)) return err('invalid slug', 400);
    if (!prompt) return err('prompt required', 400);

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) return err('ANTHROPIC_API_KEY unset', 500);

    const sql = db();
    const ctx = await loadContext(sql, user.id, slug);
    const analysis = parseAnalysis(ctx.analysisMd);
    const role = analysis?.role || null;

    const narrBlocks = (ctx.narratives || []).map((n: { id: string; title: string; tags: string[]; content_md: string }) =>
      `## ${n.title}  (id: ${n.id})  tags: ${(n.tags || []).join(', ')}\n${(n.content_md || '').slice(0, 1400)}`
    ).join('\n\n');

    const identity = ctx.profile?.identity || {};
    const values   = ctx.profile?.values_seed || {};
    const targeting= ctx.profile?.targeting || {};
    const profileBlock = JSON.stringify({ identity, values, targeting }, null, 2);

    const lengthLine = maxLen ? `Hard maximum: ${maxLen} characters.` : 'No hard length limit.';
    const typeLine = (type === 'short_text') ? 'Short answer (1-3 sentences).'
                    : (type === 'long_text') ? 'Long answer (markdown, 1-3 short paragraphs).'
                    : (type === 'yes_no')    ? 'Yes/No with a 1-2 sentence rationale.'
                    : (type === 'select' || type === 'multiselect') ? `Selection from: ${(options || []).join(' | ')}. Draft a short justification too.`
                    : 'Open response.';

    const userMsg = `# Role
${role ? JSON.stringify(role, null, 2) : '(see analysis below)'}

# Analysis
\`\`\`json
${ctx.analysisMd.slice(0, 6000) || '(none)'}
\`\`\`

# JD excerpt
${(ctx.jdMd || '').slice(0, 3000) || '(no JD on file)'}

# User profile
\`\`\`json
${profileBlock}
\`\`\`

# Narratives (the only allowed story source)
${narrBlocks || '(no narratives yet)'}

# Extra narrative additions
${(ctx.narrativeAdditionsMd || '').slice(0, 4000) || '(none)'}

# The question
${prompt}

# Format
${typeLine}
${lengthLine}

Produce the JSON object now. JSON only.`;

    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 3000,
      system: SYS,
      messages: [{ role: 'user', content: userMsg }],
    });
    const text = msg.content?.[0]?.type === 'text' ? msg.content[0].text : '';
    const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(cleaned); }
    catch (e) {
      console.warn('[generate-question-answer] parse fail', e, cleaned.slice(0, 300));
      return err('invalid model output', 500);
    }
    // Defensive coercion to the documented shape.
    const out = {
      question_id: qid,
      intent:   typeof parsed.intent === 'string' ? parsed.intent : '',
      standout: typeof parsed.standout === 'string' ? parsed.standout : '',
      stories:  Array.isArray(parsed.stories) ? parsed.stories : [],
      draft:    typeof parsed.draft === 'string' ? parsed.draft : '',
      highlights:    Array.isArray(parsed.highlights)    ? parsed.highlights    : [],
      opportunities: Array.isArray(parsed.opportunities) ? parsed.opportunities : [],
      generated_at: new Date().toISOString(),
      model: MODEL,
    };
    return jsonResp(out);
  } catch (e) {
    console.error('[generate-question-answer] error', e);
    return err((e as Error).message || 'server error', 500);
  }
});
