// Supabase Edge Function: enrich-music
// Enriches music links with BPM, key, genre, label from external APIs
//
// POST /functions/v1/enrich-music
// Body: { artist: string, track: string, album?: string }
// Returns: { bpm?, key?, genre?, label?, sources, cached, confidence }
//
// APIs used:
//   - MusicBrainz (free, no key) → genre, label, album
//   - GetSongBPM (free, key required) → BPM, musical key
//   - Last.fm (free, key required) → genre tags

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── Helpers ──

function normalizeLookupKey(artist: string, track: string): string {
  const norm = (s: string) => s.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim()
  return `${norm(artist)}:${norm(track)}`
}

// ── Cache ──

async function getCache(supabase: any, artist: string, track: string): Promise<any | null> {
  const key = normalizeLookupKey(artist, track)
  const { data, error } = await supabase
    .from('music_metadata_cache')
    .select('*')
    .eq('lookup_key', key)
    .single()

  if (error || !data) return null

  // Check TTL: 90 days
  const age = Date.now() - new Date(data.cached_at).getTime()
  if (age > 90 * 24 * 60 * 60 * 1000) return null

  // Bump hit count (fire and forget)
  supabase
    .from('music_metadata_cache')
    .update({ hit_count: data.hit_count + 1, last_hit_at: new Date().toISOString() })
    .eq('id', data.id)
    .then(() => {})

  return data.metadata
}

async function setCache(supabase: any, artist: string, track: string, metadata: any): Promise<void> {
  const key = normalizeLookupKey(artist, track)
  await supabase
    .from('music_metadata_cache')
    .upsert({
      lookup_key: key,
      artist,
      track,
      metadata,
      cached_at: new Date().toISOString(),
      last_hit_at: new Date().toISOString(),
      hit_count: 1,
    }, { onConflict: 'lookup_key' })
}

// ── MusicBrainz ──
// Free, no auth. 50 req/sec. Must send User-Agent.
// Returns: genre, label, album, releaseDate

async function queryMusicBrainz(artist: string, track: string): Promise<{
  genre?: string
  label?: string
  album?: string
  releaseDate?: string
  confidence: number
} | null> {
  try {
    const query = encodeURIComponent(`"${track}" AND artist:"${artist}"`)
    const url = `https://musicbrainz.org/ws/2/recording/?query=${query}&fmt=json&limit=3`

    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'ctrl.rodeo/1.0 (https://ctrl.rodeo)',
        'Accept': 'application/json',
      },
    })

    if (!resp.ok) {
      console.error('[musicbrainz] HTTP', resp.status)
      return null
    }

    const data = await resp.json()
    if (!data.recordings?.length) {
      console.log('[musicbrainz] No results')
      return null
    }

    const rec = data.recordings[0]
    const confidence = (rec.score || 0) / 100
    const release = rec.releases?.[0]

    return {
      genre: rec.tags?.[0]?.name || null,
      label: release?.['label-info']?.[0]?.label?.name || null,
      album: release?.title || null,
      releaseDate: release?.date || null,
      confidence,
    }
  } catch (e) {
    console.error('[musicbrainz] Error:', e.message)
    return null
  }
}

// ── GetSongBPM ──
// Free with API key. Returns BPM + musical key.

async function queryGetSongBPM(artist: string, track: string): Promise<{
  bpm?: number
  key?: string
  confidence: number
} | null> {
  try {
    const apiKey = Deno.env.get('GETSONGBPM_API_KEY')
    if (!apiKey) {
      console.log('[getsongbpm] No API key')
      return null
    }

    // Search by artist + track
    const query = encodeURIComponent(`${artist} ${track}`)
    const url = `https://api.getsongbpm.com/search/?api_key=${apiKey}&type=both&lookup=${query}`

    const resp = await fetch(url)
    if (!resp.ok) {
      console.error('[getsongbpm] HTTP', resp.status)
      return null
    }

    const data = await resp.json()
    if (!data.search?.length) {
      console.log('[getsongbpm] No results')
      return null
    }

    const hit = data.search[0]
    return {
      bpm: hit.tempo ? parseInt(hit.tempo, 10) : undefined,
      key: hit.key_of || hit.song_key || undefined,
      confidence: 0.8,
    }
  } catch (e) {
    console.error('[getsongbpm] Error:', e.message)
    return null
  }
}

// ── Last.fm ──
// Free with API key. 5 req/sec. Returns genre tags.

async function queryLastfm(artist: string, track: string): Promise<{
  genre?: string
  genreTags?: string[]
  confidence: number
} | null> {
  try {
    const apiKey = Deno.env.get('LASTFM_API_KEY')
    if (!apiKey) {
      console.log('[lastfm] No API key')
      return null
    }

    const url = `https://ws.audioscrobbler.com/2.0/?method=track.getInfo&api_key=${apiKey}&artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(track)}&format=json`

    const resp = await fetch(url)
    if (!resp.ok) {
      console.error('[lastfm] HTTP', resp.status)
      return null
    }

    const data = await resp.json()
    if (data.error || !data.track) {
      console.log('[lastfm] No results')
      return null
    }

    const tags = (data.track.toptags?.tag || []).map((t: any) => t.name).slice(0, 5)
    return {
      genre: tags[0] || undefined,
      genreTags: tags.length ? tags : undefined,
      confidence: 0.9,
    }
  } catch (e) {
    console.error('[lastfm] Error:', e.message)
    return null
  }
}

// ── Main ──

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const start = Date.now()

  try {
    const { artist, track, album } = await req.json()

    if (!artist || !track) {
      return new Response(
        JSON.stringify({ error: 'artist and track are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('[enrich-music] Query:', artist, '-', track)

    // Init Supabase client with service role for cache writes
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Check cache first
    const cached = await getCache(supabase, artist, track)
    if (cached) {
      console.log('[enrich-music] Cache hit:', Date.now() - start, 'ms')
      return new Response(
        JSON.stringify({ ...cached, cached: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Query all 3 APIs in parallel
    const [mb, gsb, lfm] = await Promise.all([
      queryMusicBrainz(artist, track),
      queryGetSongBPM(artist, track),
      queryLastfm(artist, track),
    ])

    // Merge results
    const result: Record<string, any> = {
      sources: {},
      cached: false,
      confidence: 0,
    }

    if (gsb?.bpm) { result.bpm = gsb.bpm; result.sources.bpm = 'getsongbpm' }
    if (gsb?.key) { result.key = gsb.key; result.sources.key = 'getsongbpm' }
    if (mb?.label) { result.label = mb.label; result.sources.label = 'musicbrainz' }
    if (mb?.genre) { result.genre = mb.genre; result.sources.genre = 'musicbrainz' }
    if (lfm?.genre && !result.genre) { result.genre = lfm.genre; result.sources.genre = 'lastfm' }
    if (lfm?.genreTags) { result.genreTags = lfm.genreTags }
    if (mb?.album && !album) { result.album = mb.album }
    if (mb?.releaseDate) { result.releaseDate = mb.releaseDate }

    // Average confidence
    const scores = [mb?.confidence, gsb?.confidence, lfm?.confidence].filter((c): c is number => c != null)
    result.confidence = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0

    // Cache merged result
    if (result.confidence > 0) {
      await setCache(supabase, artist, track, result)
    }

    console.log('[enrich-music] Done:', Date.now() - start, 'ms', result)

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('[enrich-music] Error:', error.message)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
