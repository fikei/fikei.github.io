// Supabase Edge Function: enrich-music
// Enriches music links with genre, label from external APIs
// BPM/key are fetched client-side via GetSongBPM (Cloudflare blocks server-side)
//
// POST /functions/v1/enrich-music
// Body: { artist: string, track: string, album?: string }
// Returns: { genre?, label?, album?, releaseDate?, genreTags?, sources, cached, confidence }
//
// APIs used:
//   - MusicBrainz (free, no key) → genre, label, album, releaseDate
//   - Last.fm (free, key required) → genre tags (track-level, then artist-level fallback)

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

/** Fuzzy compare two strings (lowercase, strip non-alphanumeric) */
function fuzzyMatch(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^\w]/g, '')
  return norm(a) === norm(b)
}

/** Check if artist name roughly matches (handles "feat." variations, "&" vs "and") */
function artistMatches(query: string, candidate: string): boolean {
  if (fuzzyMatch(query, candidate)) return true
  // Try matching just the primary artist (before "feat", "ft", "&", "and", ",")
  const primaryQuery = query.split(/\s*(?:feat\.?|ft\.?|&|and|,|featuring)\s*/i)[0].trim()
  const primaryCandidate = candidate.split(/\s*(?:feat\.?|ft\.?|&|and|,|featuring)\s*/i)[0].trim()
  return fuzzyMatch(primaryQuery, primaryCandidate)
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
// Improved: filters results by artist match, prefers original releases

async function queryMusicBrainz(artist: string, track: string): Promise<{
  genre?: string
  label?: string
  album?: string
  releaseDate?: string
  confidence: number
} | null> {
  try {
    const query = encodeURIComponent(`"${track}" AND artist:"${artist}"`)
    const url = `https://musicbrainz.org/ws/2/recording/?query=${query}&fmt=json&limit=10`

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

    // Filter recordings that match our artist
    const matchedRecordings = data.recordings.filter((rec: any) => {
      const artists = rec['artist-credit'] || []
      return artists.some((ac: any) =>
        artistMatches(artist, ac.artist?.name || '') ||
        artistMatches(artist, ac.name || '')
      )
    })

    // Use matched recordings, or fall back to all with lower confidence
    const useRecordings = matchedRecordings.length > 0 ? matchedRecordings : data.recordings
    const confidenceMultiplier = matchedRecordings.length > 0 ? 1 : 0.5
    if (matchedRecordings.length === 0) {
      console.log('[musicbrainz] No exact artist match, using all results with lower confidence')
    }

    const bestRec = useRecordings[0]
    const confidence = ((bestRec.score || 0) / 100) * confidenceMultiplier

    // Collect ALL releases across matched recordings for better album selection
    const allReleases: any[] = []
    for (const rec of useRecordings) {
      for (const rel of (rec.releases || [])) {
        allReleases.push(rel)
      }
    }
    let bestRelease = null

    // Priority 1: Official album release with label
    for (const rel of allReleases) {
      const group = rel['release-group']
      const isAlbum = group?.['primary-type'] === 'Album'
      const isNotCompilation = !group?.['secondary-types']?.includes('Compilation')
      const hasLabel = rel['label-info']?.[0]?.label?.name
      if (isAlbum && isNotCompilation && hasLabel) {
        bestRelease = rel
        break
      }
    }

    // Priority 2: Any album release (even without label)
    if (!bestRelease) {
      for (const rel of allReleases) {
        const group = rel['release-group']
        if (group?.['primary-type'] === 'Album' && !group?.['secondary-types']?.includes('Compilation')) {
          bestRelease = rel
          break
        }
      }
    }

    // Priority 3: Single release (non-compilation)
    if (!bestRelease) {
      for (const rel of allReleases) {
        const group = rel['release-group']
        const isNotCompilation = !group?.['secondary-types']?.includes('Compilation')
        if (group?.['primary-type'] === 'Single' && isNotCompilation) {
          bestRelease = rel
          break
        }
      }
    }

    // Priority 4: EP release (non-compilation)
    if (!bestRelease) {
      for (const rel of allReleases) {
        const group = rel['release-group']
        const isNotCompilation = !group?.['secondary-types']?.includes('Compilation')
        if (group?.['primary-type'] === 'EP' && isNotCompilation) {
          bestRelease = rel
          break
        }
      }
    }

    // Priority 5: Any non-compilation release with a label
    if (!bestRelease) {
      for (const rel of allReleases) {
        const group = rel['release-group']
        const isNotCompilation = !group?.['secondary-types']?.includes('Compilation')
          && !group?.['secondary-types']?.includes('Soundtrack')
        if (isNotCompilation && rel['label-info']?.[0]?.label?.name) {
          bestRelease = rel
          break
        }
      }
    }

    // Do NOT fall back to compilations — returning a compilation album name
    // (like "F*** You I'm F.A.P!") is worse than returning nothing
    if (!bestRelease) {
      console.log('[musicbrainz] Only compilations found, skipping album/label')
    }

    // Extract genre from recording tags
    const genre = bestRec.tags?.[0]?.name || null

    return {
      genre,
      label: bestRelease?.['label-info']?.[0]?.label?.name || null,
      album: bestRelease?.title || null,
      releaseDate: bestRelease?.date || null,
      confidence,
    }
  } catch (e) {
    console.error('[musicbrainz] Error:', e.message)
    return null
  }
}

// ── Last.fm ──
// Free with API key. 5 req/sec. Returns genre tags.
// Improved: falls back to artist.getTopTags when track tags are empty

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

    // Try track-level tags first
    const trackUrl = `https://ws.audioscrobbler.com/2.0/?method=track.getInfo&api_key=${apiKey}&artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(track)}&format=json`

    const trackResp = await fetch(trackUrl)
    let tags: string[] = []

    if (trackResp.ok) {
      const trackData = await trackResp.json()
      if (!trackData.error && trackData.track) {
        tags = (trackData.track.toptags?.tag || []).map((t: any) => t.name).slice(0, 5)
      }
    }

    // If no track tags, try track.getTopTags (sometimes has more)
    if (tags.length === 0) {
      try {
        const topTagsUrl = `https://ws.audioscrobbler.com/2.0/?method=track.getTopTags&api_key=${apiKey}&artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(track)}&format=json`
        const topTagsResp = await fetch(topTagsUrl)
        if (topTagsResp.ok) {
          const topTagsData = await topTagsResp.json()
          if (!topTagsData.error && topTagsData.toptags?.tag) {
            tags = topTagsData.toptags.tag.map((t: any) => t.name).slice(0, 5)
          }
        }
      } catch (e) {
        console.log('[lastfm] track.getTopTags failed:', e.message)
      }
    }

    // If still no tags, fall back to artist-level tags
    if (tags.length === 0) {
      console.log('[lastfm] No track tags, trying artist tags for:', artist)
      try {
        const artistUrl = `https://ws.audioscrobbler.com/2.0/?method=artist.getTopTags&api_key=${apiKey}&artist=${encodeURIComponent(artist)}&format=json`
        const artistResp = await fetch(artistUrl)
        if (artistResp.ok) {
          const artistData = await artistResp.json()
          if (!artistData.error && artistData.toptags?.tag) {
            tags = artistData.toptags.tag
              .filter((t: any) => t.count > 0)
              .map((t: any) => t.name)
              .slice(0, 5)
            console.log('[lastfm] Got artist tags:', tags)
          }
        }
      } catch (e) {
        console.log('[lastfm] artist.getTopTags failed:', e.message)
      }
    }

    if (tags.length === 0) {
      console.log('[lastfm] No tags found at all')
      return null
    }

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

    // Query MusicBrainz + Last.fm in parallel
    // (GetSongBPM removed — blocked by Cloudflare from server-side, called client-side instead)
    const [mb, lfm] = await Promise.all([
      queryMusicBrainz(artist, track),
      queryLastfm(artist, track),
    ])

    // Merge results
    const result: Record<string, any> = {
      sources: {},
      cached: false,
      confidence: 0,
    }

    if (mb?.label) { result.label = mb.label; result.sources.label = 'musicbrainz' }
    if (mb?.genre) { result.genre = mb.genre; result.sources.genre = 'musicbrainz' }
    if (lfm?.genre && !result.genre) { result.genre = lfm.genre; result.sources.genre = 'lastfm' }
    if (lfm?.genreTags) { result.genreTags = lfm.genreTags }
    if (mb?.album && !album) { result.album = mb.album }
    if (mb?.releaseDate) { result.releaseDate = mb.releaseDate }

    // Average confidence
    const scores = [mb?.confidence, lfm?.confidence].filter((c): c is number => c != null)
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
