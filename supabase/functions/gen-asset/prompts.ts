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

export function buildSystemPrompt(kind: 'resume' | 'cover-letter' | 'analysis'): string {
  const voice =
    kind === 'cover-letter' ? COVER_LETTER_VOICE :
    kind === 'analysis'     ? ANALYSIS_VOICE :
                              RESUME_VOICE;
  const intro =
    kind === 'analysis'
      ? `You are reviewing a job posting for Ian Fike (senior PM) and producing a structured assessment.`
      : `You are drafting a ${kind === 'cover-letter' ? 'cover letter' : 'resume'} for Ian Fike, a senior PM. Your job: produce final-quality markdown that Ian could submit without further editing.`;

  return `${intro}

${voice}

Below is Ian's career knowledge base — companies, projects, skills, wins, and goals/intents. Use it as the source of truth for facts. Do not invent.`;
}

export function buildUserMessage(kind: 'resume' | 'cover-letter' | 'analysis', kbContext: string, role: { company: string; title: string; sector?: string; salary?: string; url?: string }): string {
  const meta = [
    `Company: ${role.company}`,
    `Title: ${role.title}`,
    role.sector ? `Sector: ${role.sector}` : '',
    role.salary ? `Salary: ${role.salary}` : '',
    role.url ? `Posting: ${role.url}` : '',
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
