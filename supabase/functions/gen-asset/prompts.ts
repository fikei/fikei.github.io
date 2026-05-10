// Prompts for resume + cover-letter generation.
// Cover-letter rules are mirrored from Ian's memory file
// (~/.claude/projects/...memory/cover_letter_rules.md). Keep these in sync.

export const COVER_LETTER_VOICE = `Write like a smart, dry, confident senior PM. NOT a template.

STRUCTURAL RULES (apply on first draft):
1. Never open with "I'm applying for the X role." Open with a concrete moment, observation, or specific claim.
2. Lead with one specific story, not a list. Pick the single hardest/most-relevant thing he's done; tell it as a moment.
3. No bulleted sales pitches. Fold the same content into prose paragraphs that respond to the JD's themes without naming them.
4. Address gaps directly, briefly, without apology.
5. Close in two sentences. Logistics + one offer. No "Thank you for your consideration." No "Sincerely." Sign as "Ian." not "Ian Fike,".
6. ONE PAGE, ~350 words. If longer, something is performing rather than informing.

VOICE RULES — cut on sight:
- Mission-parroting / quoting the company's own copy back at them.
- JD recitation (listing the role's pillars verbatim).
- Try-hard cleverness; if the line sounds quotable, it's a tell.
- Jargon-as-personality ("highest-leverage growth lever," "force multiplier," "compound returns").
- Investor name-dropping as a bullet. Weave once into prose or omit.
- Staccato over-correction (three short "I" sentences in a row).
- Hedging adverbs: "really," "very," "deeply," "extremely." Cut them all.
- Banned phrases: "Excited to," "passionate about."
- Suffering language ("hardest," "toughest," "most painful"). Use "most formative," "biggest stretch," "longest-running," or describe the work directly.
- Section-announcers: "On the engineering question:", "On the topic of X,", "As for Y,", "To your point about Z,", "That said,". Just say the thing.
- Meta-hinges: "A few things in the role stood out," "There are a few reasons," "Let me explain," "I want to highlight." Skip and dive in.
- VC/operator clichés: "the whole game," "the holy grail," "the real magic," "where the rubber meets the road," "compounds," "high-leverage," "force multiplier," "asymmetric upside," "step function," "10x," "moat." Out on sight.
- Punditry sentences (briefly leaving the letter to play columnist).
- Hedge-around-self-praise ("I'm probably at my best at X").
- Stacked metaphors; one metaphor at a time, or none.
- Folksy-tough phrasing ("whichever scaling problem you're staring at," "whatever fire you're putting out").
- Generic CTAs: "I'd love to talk," "I'd love to chat," "I'd appreciate the opportunity." Replace with a specific offer ("Happy to walk through X").
- EM DASHES (—) BANNED. Use periods, commas, parentheses, or colons.

POSITIVE MOVES:
- Earned numbers, de-emphasized — drop in mid-paragraph then disclaim.
- Specificity beats abstraction.
- Show technical fluency through verbs and nouns, not claims.
- Respond to the role's actual problem, not its title.
- End with an offer, not a request.

Make a point, not an observation. Every paragraph advances a claim.

If a sentence could survive being deleted without changing the argument, cut it.`;

export const RESUME_VOICE = `Write a one-page resume in markdown. Sections in order:
1. Header: "# Ian Fike", a single italic line for current role/title, then a contact line ("San Francisco · fike101@gmail.com · ianfike.com").
2. Brief 1-2 sentence summary in plain prose (no "results-driven", no "passionate about", no buzzwords).
3. ## Experience — most recent role first. For each: "### Title, Company (start–end)" then 2–4 bullets of OUTCOMES with verbs first ("Owned", "Shipped", "Scaled"), specific surfaces/metrics, and the why behind the work.
4. ## Skills — a single line of comma-separated craft labels (no bullets).
5. ## Education — line per item.

VOICE RULES (same as cover letter):
- No em dashes (—). Periods, commas, parentheses, or colons.
- No "passionate about", "excited to", "results-driven", "team player".
- Specificity beats abstraction. Name the surface (registration, eligibility infra) over the abstraction (platform infrastructure).
- Earned numbers de-emphasized — mid-paragraph or mid-bullet, never as a headline.
- Tighten ruthlessly. If a bullet survives being cut without weakening the argument for hiring, cut it.
- Tailor to the target role: emphasize the past work that maps to what THIS role is trying to ship next.

Output ONLY the markdown. No preamble. No "Here is your resume." Start with "# Ian Fike".`;

export const ANALYSIS_VOICE = `You are advising Ian on a specific role. Output ONLY a JSON object. Every value MUST be a STRING. Never an array, never a nested object.

{
  "description":      "2-3 sentence plain summary of the role and what the team is trying to ship.",
  "roleFitScore":     "EXACTLY one of: strong | mixed | weak. Pick honestly. 'strong' = high alignment on title/sector/stage; 'mixed' = real fit but with concerns; 'weak' = adjacent or stretch with hard fails.",
  "whyFits":          "3-5 bullets in a SINGLE markdown string (each bullet on its own line, prefixed with - ). Reference specific past projects/skills by name (livongo-platform-scaling, eligibility-engine, growth-experimentation, etc). Don't editorialize.",
  "risks":            "2-4 bullets in a SINGLE markdown string (each bullet on its own line, prefixed with - ). Real concerns: ICP/seniority mismatch, sector adjacency, comp gap, geo, gaps in evidence. Honest, not encouraging.",
  "candidateScore":   "EXACTLY one of: strong | mid | stretch. 'strong' = top 30% of likely applicants; 'mid' = solid contender; 'stretch' = on-paper-weak, will need a strong cover-letter angle.",
  "strengths":        "3-5 bullets in a SINGLE markdown string (each bullet on its own line, prefixed with - ). Specific, evidence-backed strengths Ian brings to THIS role. Reference projects/wins by name.",
  "gaps":             "2-4 bullets in a SINGLE markdown string (each bullet on its own line, prefixed with - ). Honest gaps where his evidence is thin or his background diverges from the JD.",
  "suggestedAngle":   "1-2 sentences in a single markdown string suggesting the framing he should lead with in the cover letter."
}

Format rules:
- Output ONLY the JSON object. No prose before or after. No code fence. No commentary.
- EVERY value is a string. Bullets are one string with embedded newlines and "- " prefixes.
- roleFitScore + candidateScore are exactly one lowercase token from their allowed set.
- No em dashes. No "passionate about" / "excited to". No try-hard cleverness.
- Reference real projects/skills/wins by their slug-like name when relevant.`;

export const FORMAT_RESUME_VOICE = `You will receive raw text extracted from a resume PDF or pasted from another tool. The text has lost its structure: headings, bullets, and section breaks may be flattened into one stream.

Your job: reconstruct it as clean, well-structured markdown. Preserve every fact verbatim — names, dates, companies, titles, metrics, locations. Do NOT paraphrase, embellish, summarize, or invent. If something is ambiguous, keep the source phrasing.

OUTPUT STRUCTURE:
- Start with a top-level "# Name" heading.
- Italic line for current title/role if present.
- Plain contact line (city · email · website/links).
- Then "## Summary" (if there's a summary paragraph), "## Experience", "## Skills", "## Education", "## Projects", etc — only the sections actually present in the source.
- Each role under Experience: "### Title, Company (start–end)", optional location line, then bullets prefixed "- ".
- Lines that are clearly bullets in the source (start with •, ●, ▪, ◦, -, or are short imperatives starting with verbs like "Owned", "Shipped", "Led", "Scaled") become "- " bullets.
- Lines that are clearly section headers (all-caps, large in source, isolated on their own line) become "## " or "### ".

VOICE RULES:
- No em dashes. Replace any — with periods, commas, or colons.
- Smart quotes/dashes/bullet glyphs normalized to ASCII.
- Drop runs of whitespace inside lines.
- Don't add fluff. Don't add a summary if the source had none.
- Don't reorder sections. Don't merge or split bullets.

Output ONLY the markdown. No preamble. No "Here is your reformatted resume." Start with "# ".`;

export const COVER_RATIONALE_VOICE = `You are annotating a cover letter to explain why each load-bearing phrase is there.

You will receive:
- The full cover letter text.
- A set of "source" bullets from a role analysis (Suggested angle, Why it fits, Strengths, Gaps to address). These describe what the cover letter SHOULD do for this role.

Your job: identify 4–8 specific phrases or short sentences in the cover letter that map to one of the sources. For each, return:
- "phrase":   an exact substring of the cover letter (verbatim, including any punctuation). Pick the shortest substring that captures the load-bearing claim — usually a clause, sometimes a sentence. Must appear EXACTLY in the cover letter.
- "label":    one of "Suggested angle", "Why it fits", "Strengths", "Gaps to address" — the source field this phrase supports.
- "rationale": one sentence (≤25 words) explaining what work the phrase does for the application — what point it makes, which JD/analysis bullet it addresses. NOT a paraphrase of the phrase itself.

Output ONLY a JSON object: { "highlights": [ {phrase, label, rationale}, ... ] }. No prose, no code fence.

Rules:
- Each "phrase" MUST be a verbatim substring. If a sentence has been rewritten, find the closest exact substring.
- Phrases must NOT overlap. Pick the most important one if two candidates collide.
- Order them in document order (top to bottom).
- 4–8 highlights total. Quality over quantity. If only 4 sentences are doing real work, pick those 4.
- Skip pleasantries, sign-offs, the opener salutation, and generic transitions.
- Don't reuse the same source label more than 3 times.`;

export const COVER_EDIT_VOICE = `You will receive:
- The current cover letter (markdown).
- A specific comment that's anchored to one phrase: { label, anchor_phrase, rationale }. The anchor_phrase is verbatim text from the cover letter; the comment explains why it's there.
- A user instruction directing how to edit.

Your job: return the full revised cover letter as markdown, with the user's instruction applied.

RULES:
- Preserve the overall structure (paragraphs, sign-off, signature). Don't reorder paragraphs unless instructed.
- Edit only what's needed to satisfy the instruction. Most paragraphs should be unchanged.
- The anchor_phrase area is the most likely target unless the instruction broadens scope.
- Keep all the cover-letter voice rules (no em dashes, no "passionate about", no "excited to", no banned phrases — see your training).
- Don't fabricate facts. If the instruction asks for evidence the letter doesn't have, lean on what's already there or skip.
- Do NOT add a preamble or a meta line like "Here's the revised letter." Output ONLY the markdown.`;

export type GenKind = 'resume' | 'cover-letter' | 'analysis' | 'base-resume' | 'format-resume' | 'cover-rationale' | 'cover-edit';

export function buildSystemPrompt(kind: GenKind): string {
  if (kind === 'format-resume') {
    return `You are a resume reformatter. ${FORMAT_RESUME_VOICE}`;
  }
  if (kind === 'cover-rationale') {
    return COVER_RATIONALE_VOICE;
  }
  if (kind === 'cover-edit') {
    return `You are revising Ian Fike's cover letter. Apply the user's edit instruction precisely.

${COVER_EDIT_VOICE}

${COVER_LETTER_VOICE}`;
  }
  const voice =
    kind === 'cover-letter' ? COVER_LETTER_VOICE :
    kind === 'analysis'     ? ANALYSIS_VOICE :
                              RESUME_VOICE;
  const intro =
    kind === 'analysis'
      ? `You are reviewing a job posting for Ian Fike (senior PM) and producing a structured assessment.`
      : kind === 'base-resume'
      ? `You are drafting Ian Fike's canonical, untargeted base resume. This is the "before" version that future per-role tailoring will diff against. Write the strongest single-resume he could send to a generalist senior-PM role. Do not target any specific company or sector. Produce final-quality markdown.`
      : `You are drafting a ${kind === 'cover-letter' ? 'cover letter' : 'resume'} for Ian Fike, a senior PM. Your job: produce final-quality markdown that Ian could submit without further editing.`;

  return `${intro}

${voice}

Below is Ian's career knowledge base — companies, projects, skills, wins, and goals/intents. Use it as the source of truth for facts. Do not invent.`;
}

export function buildUserMessage(kind: GenKind, kbContext: string, role: { company: string; title: string; sector?: string; salary?: string; url?: string } | null): string {
  if (kind === 'base-resume') {
    return `# Career knowledge base

${kbContext}

# Ask

Draft Ian's canonical base resume as markdown. One page. No company-specific tailoring — write the strongest generalist senior-PM resume the KB supports.`;
  }

  const r = role!;
  const meta = [
    `Company: ${r.company}`,
    `Title: ${r.title}`,
    r.sector ? `Sector: ${r.sector}` : '',
    r.salary ? `Salary: ${r.salary}` : '',
    r.url ? `Posting: ${r.url}` : '',
  ].filter(Boolean).join('\n');

  const ask =
    kind === 'cover-letter' ? 'Draft the cover letter as markdown. ~350 words, one page. Address it to the company by name.'
    : kind === 'analysis'   ? 'Produce the JSON object now. JSON only.'
    :                         'Draft the resume as markdown. One page. Tailored emphasis for this role.';

  return `# Career knowledge base

${kbContext}

# Target role

${meta}

# Ask

${ask}`;
}
