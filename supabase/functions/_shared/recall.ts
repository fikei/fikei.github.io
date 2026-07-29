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

// Copy a finished recording into the permanent recruit-recordings bucket.
// Uses a signed upload URL (the token authenticates, so this works whether the
// project's service key is a JWT or an sb_secret) and streams Recall's bytes
// straight through — hour-long Meets exceed edge-function memory if buffered.
export async function archiveVideoToStorage(
  // deno-lint-ignore no-explicit-any
  client: any,
  videoUrl: string,
  path: string,
): Promise<string> {
  const { data: signed, error: signErr } = await client.storage
    .from('recruit-recordings').createSignedUploadUrl(path, { upsert: true })
  if (signErr || !signed?.signedUrl) throw new Error(`signed upload url: ${signErr?.message || 'none'}`)

  const src = await fetch(videoUrl)
  if (!src.ok || !src.body) throw new Error(`video download ${src.status}`)
  const resp = await fetch(signed.signedUrl, {
    method: 'PUT',
    // Force video/mp4 — Recall serves binary/octet-stream, which Safari/iOS
    // refuses to play in a <video> tag.
    headers: { 'Content-Type': 'video/mp4', 'x-upsert': 'true' },
    body: src.body,
    // Deno requires duplex on a streamed request body; without it fetch throws.
    duplex: 'half',
  } as RequestInit & { duplex: string })
  if (!resp.ok) throw new Error(`storage upload ${resp.status}: ${(await resp.text()).slice(0, 150)}`)
  return path
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
        content: `Summarize this meeting ("${title}") for housemates who missed it: what was discussed and any decisions made. Under 250 words, bullets welcome. Never include follow-ups, action items, open questions, or recommended next steps — describe the meeting only. Transcript:\n\n${transcript.slice(0, 24000)}`,
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

Keep it under 200 words. Never include follow-ups, action items, suggested questions, or next steps of any kind — describe the call only. Transcript:

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
