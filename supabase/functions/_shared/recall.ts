// _shared/recall.ts
// Recall.ai meeting-recording bot for Agape Intro Calls. Entirely inert until
// RECALL_API_KEY is set. The bot ("Agape Notes") joins the Meet at start
// time, records, and captures the transcript via Meet's own captions (free
// tier — no per-minute transcription cost).
//
// RECALL_API_BASE defaults to the us-west-2 region; set it if the account
// lives in another region (the key is region-scoped).

// deno-lint-ignore-file no-explicit-any

const RECALL_API_BASE = Deno.env.get('RECALL_API_BASE') || 'https://us-west-2.recall.ai'

export function recallEnabled(): boolean {
  return Boolean(Deno.env.get('RECALL_API_KEY'))
}

async function recallFetch(path: string, options: RequestInit = {}): Promise<any> {
  const key = Deno.env.get('RECALL_API_KEY')
  if (!key) throw new Error('RECALL_API_KEY not set')
  const resp = await fetch(`${RECALL_API_BASE}${path}`, {
    ...options,
    headers: { Authorization: `Token ${key}`, 'Content-Type': 'application/json' },
  })
  const text = await resp.text()
  if (!resp.ok) throw new Error(`Recall ${resp.status} ${options.method || 'GET'} ${path}: ${text.slice(0, 200)}`)
  return text ? JSON.parse(text) : null
}

// Create a bot that joins the meeting at start time. Returns the bot id.
export async function createRecordingBot(meetingUrl: string, joinAtISO: string): Promise<string> {
  const bot = await recallFetch('/api/v1/bot/', {
    method: 'POST',
    body: JSON.stringify({
      meeting_url: meetingUrl,
      bot_name: 'Agape Notes',
      join_at: joinAtISO,
      recording_config: {
        transcript: { provider: { meeting_captions: {} } },
      },
    }),
  })
  if (!bot?.id) throw new Error(`Recall bot create returned no id: ${JSON.stringify(bot).slice(0, 150)}`)
  return bot.id
}

export interface BotResult {
  done: boolean
  failed: boolean
  statusCode: string
  videoUrl: string | null
  transcriptUrl: string | null
}

// Poll a bot: done once its lifecycle ended; URLs come from media_shortcuts.
export async function getBotResult(botId: string): Promise<BotResult> {
  const bot = await recallFetch(`/api/v1/bot/${botId}/`)
  const changes = bot.status_changes || []
  const statusCode = String(changes[changes.length - 1]?.code || bot.status?.code || 'unknown')
  const terminal = ['done', 'fatal', 'call_ended', 'media_expired'].includes(statusCode)
  const rec = (bot.recordings || [])[0]
  const videoUrl = rec?.media_shortcuts?.video_mixed?.data?.download_url || bot.video_url || null
  const transcriptUrl = rec?.media_shortcuts?.transcript?.data?.download_url || null
  return {
    done: terminal && statusCode !== 'fatal',
    failed: statusCode === 'fatal',
    statusCode,
    videoUrl,
    transcriptUrl,
  }
}

// Download a transcript and flatten it to "Speaker: text" lines. Recall's
// transcript JSON is a list of participant segments with word arrays.
export async function fetchTranscriptText(transcriptUrl: string): Promise<string> {
  const resp = await fetch(transcriptUrl)
  if (!resp.ok) throw new Error(`transcript download ${resp.status}`)
  const data = await resp.json()
  const lines: string[] = []
  for (const seg of (Array.isArray(data) ? data : [])) {
    const speaker = seg.participant?.name || seg.speaker || 'Speaker'
    const words = (seg.words || []).map((w: any) => w.text).join(' ').trim()
    if (words) lines.push(`${speaker}: ${words}`)
  }
  return lines.join('\n')
}

// Generic meeting summary for non-applicant calls hosted by the shared account.
export async function summarizeMeeting(transcript: string, title: string): Promise<string | null> {
  const key = Deno.env.get('RECRUIT_ANTHROPIC_API_KEY') || Deno.env.get('ANTHROPIC_API_KEY')
  if (!key || !transcript.trim()) return null
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001', max_tokens: 700,
      system: 'You summarize meetings for the Agape co-op house. Be concrete and neutral.',
      messages: [{
        role: 'user',
        content: `Summarize this meeting ("${title}") for housemates who missed it: what was discussed, decisions made, and open follow-ups. Under 250 words, bullets welcome. Transcript:\n\n${transcript.slice(0, 24000)}`,
      }],
    }),
  })
  if (!resp.ok) {
    console.warn(`summarizeMeeting: anthropic ${resp.status} ${(await resp.text()).slice(0, 200)}`)
    return null
  }
  const data = await resp.json()
  // deno-lint-ignore no-explicit-any
  return (data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim() || null
}

// Haiku summary of the call — the "screener representation" that rides back
// to Discord and the applicant's profile.
export async function summarizeIntroCall(transcript: string, applicantName: string, residentName: string): Promise<string | null> {
  const key = Deno.env.get('RECRUIT_ANTHROPIC_API_KEY') || Deno.env.get('ANTHROPIC_API_KEY')
  if (!key || !transcript.trim()) return null
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001', max_tokens: 700,
      system: 'You summarize housing-community intro calls for the housemates deciding on an applicant. Be concrete and neutral; quote sparingly.',
      messages: [{
        role: 'user',
        content: `This is the transcript of an Agape Intro Call between resident ${residentName} and applicant ${applicantName}. Write a summary for the house:

**Vibe** — one sentence on how the conversation felt.
**About them** — 3-5 bullets: work, background, why they want co-op living, logistics (move-in, budget) if mentioned.
**Highlights** — anything that stood out, positive or concerning.
**Follow-ups** — open questions the house should still ask.

Keep it under 250 words. Transcript:

${transcript.slice(0, 24000)}`,
      }],
    }),
  })
  if (!resp.ok) {
    console.warn(`summarizeIntroCall: anthropic ${resp.status} ${(await resp.text()).slice(0, 200)}`)
    return null
  }
  const data = await resp.json()
  return (data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim() || null
}
