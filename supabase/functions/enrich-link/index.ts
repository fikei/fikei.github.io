// Supabase Edge Function: enrich-link
// Handles AI classification, image resolution, and watch enrichment for links
//
// POST /functions/v1/enrich-link
// Body: { url, title?, description?, linkId?, skipClassification?, skipImage?, enrichWatch?, enrichBook?, enrichListen?, category? }
// Returns: { content_type, type_confidence, type_source, image_url, image_source, cached, video?, book?, music? }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Visual standards — product gate for URL pattern and technical checks
import { checkGateUrlPatterns, checkGateTechnical } from '../generate-widget/config/visual-standards.ts'

// CORS headers for browser requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Content types and their image resolution strategies
const CONTENT_TYPES = ['product', 'article', 'book', 'video', 'music', 'repository', 'social', 'document', 'tool', 'unknown']

const IMAGE_STRATEGIES: Record<string, string[]> = {
  product: ['scrape', 'search', 'favicon', 'template'],
  article: ['scrape', 'search', 'favicon', 'template'],
  book: ['platform', 'scrape', 'search', 'template'],
  video: ['platform', 'scrape', 'template'],              // platform thumbnails are best
  music: ['platform', 'scrape', 'search', 'template'],
  repository: ['platform', 'template'],                    // GitHub OG is sufficient
  social: ['platform', 'scrape', 'template'],              // platform images are best
  document: ['search', 'template'],
  tool: ['scrape', 'search', 'favicon', 'template'],
  unknown: ['scrape', 'search', 'favicon', 'template']
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    let { url, title, description, linkId, skipClassification, skipImage,
            skipIfHasImage, currentImage, forceRefresh, enrichWatch, enrichBook, enrichListen, category } = await req.json()

    // Support skipIfHasImage: skip image resolution if client already has a valid image
    const shouldSkipImage = skipImage || (skipIfHasImage && !!currentImage)

    if (!url) {
      return new Response(
        JSON.stringify({ error: 'URL is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('[enrich-link] Processing:', url)

    const domain = new URL(url).hostname.replace('www.', '')
    const path = new URL(url).pathname

    // ========================================
    // STEP 0: Platform API metadata for sites that block scraping
    // YouTube blocks CORS proxies — use YouTube Data API v3 for full metadata.
    // Vimeo uses oEmbed (simple, reliable).
    // ========================================
    const isYouTube = domain.includes('youtube.com') || domain.includes('youtu.be')
    let youtubeData: YouTubeVideoData | null = null
    const oembedTitle = await (async () => {
      // YouTube: use Data API v3 (full metadata) with oEmbed fallback
      if (isYouTube) {
        youtubeData = await lookupYouTube(url)
        if (youtubeData) {
          return {
            title: youtubeData.title,
            author: youtubeData.channelTitle,
            thumbnail: youtubeData.thumbnailUrl
          }
        }
        // YouTube API/oEmbed both failed (deleted/private video) —
        // Still construct a minimal result with the video ID so we have
        // a thumbnail and correct content_type
        const videoId = extractYouTubeVideoId(url)
        if (videoId) {
          console.log('[enrich-link] YouTube API/oEmbed failed, using fallback for videoId:', videoId)
          youtubeData = {
            videoId,
            title: '',
            description: '',
            channelTitle: '',
            publishedAt: '',
            thumbnailUrl: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
            duration: null,
            tags: [],
            categoryId: null,
            viewCount: null,
            likeCount: null
          }
          return {
            title: '',  // empty — won't override existing title
            author: null,
            thumbnail: youtubeData.thumbnailUrl
          }
        }
      }
      // Vimeo: oEmbed
      return await resolveOembedMetadata(url, domain)
    })()

    if (oembedTitle) {
      // Only override if title is missing or generic
      const genericTitles = ['youtube', 'youtu.be', 'vimeo', 'watch', '']
      if (!title || genericTitles.includes(title.toLowerCase().trim())) {
        if (oembedTitle.title) {
          console.log('[enrich-link] Platform API resolved title:', oembedTitle.title)
          title = oembedTitle.title
        }
      }
      if ((!description || description.length < 20) && youtubeData?.description) {
        description = youtubeData.description.slice(0, 500)
      } else if (!description && oembedTitle.author) {
        description = `By ${oembedTitle.author}`
      }
    }

    // ========================================
    // STEP 0.5: JSON-LD title resolution for non-platform URLs
    // When the client title looks like a raw <title> tag (has | or – separators),
    // try to get a cleaner title from the page's JSON-LD structured data.
    // This handles PBS, BBC, news sites, etc. without hardcoding network names.
    // ========================================
    if (title && !isYouTube && /[\|–—]/.test(title)) {
      console.log('[enrich-link] Title has separators, trying JSON-LD resolution:', title)
      const jsonLdTitle = await resolveJsonLdTitle(url)
      if (jsonLdTitle && jsonLdTitle !== title) {
        console.log('[enrich-link] JSON-LD resolved better title:', jsonLdTitle)
        title = jsonLdTitle
      }
    }

    let contentType = 'unknown'
    let typeConfidence = 0
    let typeSource: 'cache' | 'rules' | 'ai' = 'rules'
    let imageUrl: string | null = null
    let imageSource: 'scraped' | 'platform' | 'generated' | 'template' | 'favicon' = 'template'
    let imageScores: Record<string, any> | null = null
    let cached = false

    // Force content_type for known platforms — no need for AI classification
    if (isYouTube) {
      contentType = 'video'
      typeConfidence = 1.0
      typeSource = 'rules'
      console.log('[enrich-link] YouTube URL detected, forcing content_type=video')
    }

    const isMusicPlatform = domain.includes('spotify.com') ||
      domain.includes('soundcloud.com') || domain.includes('bandcamp.com') ||
      domain.includes('beatport.com') || domain.includes('music.apple.com') ||
      domain.includes('tidal.com') || domain.includes('deezer.com') ||
      domain.includes('audiomack.com') || domain.includes('music.youtube.com')
    if (isMusicPlatform) {
      contentType = 'music'
      typeConfidence = 1.0
      typeSource = 'rules'
      console.log('[enrich-link] Music platform detected, forcing content_type=music:', domain)
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // ========================================
    // STEP 1: Content Type Classification
    // ========================================
    if (!skipClassification && contentType === 'unknown') {
      console.log('[enrich-link] Step 1: Classification')

      // Check domain profile cache first
      const { data: profile } = await supabase
        .from('domain_profiles')
        .select('*')
        .eq('domain', domain)
        .single()

      if (profile && profile.confidence > 0.85) {
        console.log('[enrich-link] Cache hit:', profile.primary_type, profile.confidence)
        contentType = profile.primary_type
        typeConfidence = profile.confidence
        typeSource = 'cache'
        cached = true
      } else {
        // Try AI classification
        const aiResult = await classifyWithAI(url, title, description)
        console.log('[enrich-link] AI result:', aiResult)

        if (aiResult) {
          contentType = aiResult.type
          typeConfidence = aiResult.confidence
          typeSource = 'ai'

          // Update domain profile cache
          await updateDomainProfile(supabase, domain, path, aiResult)
        }
      }
    }

    // ========================================
    // STEP 2: Image Resolution (with Tier 3 quality gate)
    // ========================================
    const imageLog: Array<Record<string, any>> = []
    let bestCandidate: { url: string, source: string, scores: Record<string, any> } | null = null

    if (!shouldSkipImage) {
      console.log('[enrich-link] Step 2: Image resolution for type:', contentType)

      // YouTube shortcut: use thumbnail directly from API/oEmbed/fallback
      // This avoids the full strategy loop which can fail for YouTube
      if (isYouTube && youtubeData?.thumbnailUrl) {
        console.log('[enrich-link] Using YouTube thumbnail directly:', youtubeData.thumbnailUrl)
        imageUrl = youtubeData.thumbnailUrl
        imageSource = 'platform'
        imageScores = {
          visual_quality: 0.9, distinctiveness: 1.0,
          evaluated_at: new Date().toISOString(),
          evaluation_method: 'youtube_thumbnail_direct'
        }
        imageLog.push({
          strategy: 'youtube_direct', result: 'accepted',
          image_url: imageUrl, duration_ms: 0
        })
      }

      // Only run strategy loop if we don't already have an image (e.g. from YouTube shortcut)
      const strategies = IMAGE_STRATEGIES[contentType] || IMAGE_STRATEGIES.unknown

      for (const strategy of strategies) {
        if (imageUrl) break  // Already resolved (e.g. YouTube direct)
        const attemptStart = Date.now()
        console.log('[enrich-link] Trying strategy:', strategy)

        try {
          const result = await executeImageStrategy(strategy, url, title, description)
          if (!result || !result.url) {
            imageLog.push({ strategy, result: 'no_image', duration_ms: Date.now() - attemptStart })
            continue
          }

          // Tier 2 validation: check image loads, dimensions, format
          console.log('[enrich-link] Validating image via Tier 2:', result.url)
          const validation = await validateImageTier2(result.url)

          if (!validation.pass) {
            console.log('[enrich-link] Tier 2 rejected:', result.url, validation.reason)
            imageLog.push({
              strategy, result: 'tier2_rejected', reason: validation.reason,
              image_url: result.url, duration_ms: Date.now() - attemptStart,
              tier2: { pass: false, checks: validation.checks?.filter((c: any) => !c.pass) }
            })
            continue
          }

          const tier2Scores = {
            visual_quality: validation.scores.visual_quality,
            distinctiveness: validation.scores.distinctiveness,
            dimensions: validation.dimensions || null,
            file_size: validation.fileSize || null,
            content_type_header: validation.contentType || null
          }

          // Tier 3: AI vision quality gate
          const tier3 = await evaluateImageQuality(result.url, title, category || contentType, contentType)

          if (tier3 && tier3.tier === 'rejected') {
            console.log('[enrich-link] Tier 3 rejected:', result.url, tier3.reason)
            imageLog.push({
              strategy, result: 'tier3_rejected', reason: tier3.reason,
              image_url: result.url, duration_ms: Date.now() - attemptStart,
              tier2: { pass: true, ...tier2Scores },
              tier3: tier3.scores
            })
            continue
          }

          if (tier3 && tier3.tier === 'poor') {
            console.log('[enrich-link] Tier 3 poor quality, saving as candidate:', result.url)
            if (!bestCandidate) {
              bestCandidate = {
                url: result.url,
                source: result.source,
                scores: {
                  ...tier2Scores,
                  ...tier3.scores,
                  evaluated_at: new Date().toISOString(),
                  evaluation_method: 'tier3_ai_vision'
                }
              }
            }
            imageLog.push({
              strategy, result: 'tier3_poor', reason: 'Poor quality, kept as candidate',
              image_url: result.url, duration_ms: Date.now() - attemptStart,
              tier2: { pass: true, ...tier2Scores },
              tier3: tier3.scores
            })
            continue
          }

          // Good/excellent or Tier 3 unavailable (budget/error) — accept it
          imageUrl = result.url
          imageSource = result.source
          imageScores = {
            ...tier2Scores,
            ...(tier3?.scores || {}),
            evaluated_at: new Date().toISOString(),
            evaluation_method: tier3 ? 'tier3_ai_vision' : 'tier2_technical',
            tier2_checks: validation.checks
          }
          imageLog.push({
            strategy, result: 'accepted',
            image_url: result.url, duration_ms: Date.now() - attemptStart,
            tier2: { pass: true, ...tier2Scores },
            tier3: tier3?.scores || null,
            tier: tier3?.tier || 'tier2_only'
          })
          console.log('[enrich-link] Image accepted via', strategy, ':', imageUrl,
            tier3 ? `(tier: ${tier3.tier})` : '(tier2 only)',
            validation.dimensions ? `${validation.dimensions.width}x${validation.dimensions.height}` : '')
          break
        } catch (e) {
          console.error('[enrich-link] Strategy failed:', strategy, e)
          imageLog.push({
            strategy, result: 'error', reason: (e as Error).message,
            duration_ms: Date.now() - attemptStart
          })
        }
      }

      // If no excellent/good image found, use best candidate (poor > nothing)
      if (!imageUrl && bestCandidate) {
        console.log('[enrich-link] Using best candidate (poor quality):', bestCandidate.url)
        imageUrl = bestCandidate.url
        imageSource = bestCandidate.source as any
        imageScores = bestCandidate.scores
        imageLog.push({
          strategy: 'fallback_to_candidate', result: 'accepted_poor',
          image_url: bestCandidate.url, reason: 'Best available from poor-quality candidates'
        })
      }
    } else {
      imageLog.push({ strategy: 'skipped', result: 'skip', reason: shouldSkipImage ? 'skipIfHasImage' : 'skipImage' })
    }

    // Truncate summary to ~60 words for card display (shared by watch + book enrichment)
    const truncSummary = (text: string | null): string | null => {
      if (!text) return null
      const words = text.split(/\s+/)
      if (words.length <= 60) return text
      return words.slice(0, 60).join(' ') + '…'
    }

    // ========================================
    // STEP 2.5: Watch Enrichment — YouTube API / TMDB / AI
    // ========================================
    let videoMeta: Record<string, any> | null = null
    if (enrichWatch || category === 'watch' || contentType === 'video') {
      // YouTube videos: use YouTube Data API directly (skip TMDB — it's for movies/TV)
      if (youtubeData) {
        console.log('[enrich-link] Step 2.5: Watch enrichment from YouTube API')
        const publishYear = youtubeData.publishedAt
          ? parseInt(youtubeData.publishedAt.split('-')[0], 10)
          : null

        videoMeta = {
          title: youtubeData.title,
          summary: truncSummary(youtubeData.description),
          type: 'video',
          genre: youtubeData.tags?.[0] || null,
          genres: youtubeData.tags?.slice(0, 3) || [],
          year: publishYear,
          creator: youtubeData.channelTitle || null,
          rating: null,
          runtime: youtubeData.duration,
          voteAverage: null,
          tmdbId: null,
          imdbId: null,
          tmdbUrl: null,
          posterPath: null,
          streamingServices: [{ name: 'YouTube', type: 'free', logoPath: null }],
          // YouTube-specific fields
          youtubeVideoId: youtubeData.videoId,
          viewCount: youtubeData.viewCount,
          likeCount: youtubeData.likeCount,
          channelTitle: youtubeData.channelTitle,
          publishedAt: youtubeData.publishedAt,
          tags: youtubeData.tags?.slice(0, 10) || []
        }
        console.log('[enrich-link] YouTube watch enrichment result:', videoMeta)
      } else {
        // Non-YouTube: TMDB first, AI fills gaps
        console.log('[enrich-link] Step 2.5: Watch enrichment (TMDB → AI)')

        // 1. Try TMDB first (structured, real-time data)
        const tmdbResult = await lookupTMDB(title || '', null, null)

        // 2. Only call AI if TMDB left gaps
        const needsAI = !tmdbResult
          || !tmdbResult.overview
          || !tmdbResult.streamingServices?.length

        let aiResult: Record<string, any> | null = null
        if (needsAI) {
          console.log('[enrich-link] TMDB incomplete, calling AI for gaps')
          aiResult = await enrichWatchWithAI(url, title, description)
        } else {
          console.log('[enrich-link] TMDB complete, skipping AI call')
        }

        // 3. Merge: TMDB is primary, AI fills gaps
        videoMeta = {
          title: tmdbResult?.title || null,
          summary: truncSummary(tmdbResult?.overview || aiResult?.summary || null),
          type: aiResult?.type || (tmdbResult ? inferTypeFromTMDB(tmdbResult.mediaType) : null),
          genre: tmdbResult?.genres?.[0] || aiResult?.genre || null,
          genres: tmdbResult?.genres || (aiResult?.genres?.length ? aiResult.genres : (aiResult?.genre ? [aiResult.genre] : [])),
          year: tmdbResult?.year || aiResult?.year || null,
          creator: tmdbResult?.creator || aiResult?.creator || null,
          rating: aiResult?.rating || null,
          runtime: tmdbResult?.runtime ? tmdbResult.runtime * 60 : null,
          voteAverage: tmdbResult?.voteAverage || null,
          tmdbId: tmdbResult?.tmdbId || null,
          imdbId: tmdbResult?.imdbId || null,
          tmdbUrl: tmdbResult?.tmdbUrl || null,
          posterPath: tmdbResult?.posterPath || null,
          streamingServices: tmdbResult?.streamingServices?.length
            ? tmdbResult.streamingServices
            : aiResult?.streamingServices || [],
        }
      }

      console.log('[enrich-link] Watch enrichment result:', videoMeta)
    }

    // ========================================
    // STEP 2.6: Book Enrichment — Open Library first, AI fills gaps
    // ========================================
    let bookMeta: Record<string, any> | null = null
    if (enrichBook || category === 'read') {
      console.log('[enrich-link] Step 2.6: Book enrichment (Open Library → AI)')

      // 1. Try Open Library first (free, structured data)
      const olResult = await lookupOpenLibrary(title || '')

      // 2. Only call AI if Open Library left gaps
      const needsAI = !olResult
        || !olResult.summary
        || !olResult.author
        || !olResult.genre

      let aiResult: Record<string, any> | null = null
      if (needsAI) {
        console.log('[enrich-link] Open Library incomplete, calling AI for gaps')
        aiResult = await enrichBookWithAI(url, title, description)
      } else {
        console.log('[enrich-link] Open Library complete, skipping AI call')
      }

      // 3. Merge: Open Library is primary, AI fills gaps
      bookMeta = {
        title: olResult?.title || null,
        author: olResult?.author || aiResult?.author || null,
        isbn: olResult?.isbn || null,
        year: olResult?.year || aiResult?.year || null,
        pages: olResult?.pages || aiResult?.pages || null,
        genre: olResult?.genre || aiResult?.genre || null,
        summary: truncSummary(olResult?.summary || aiResult?.summary || null),
        coverPath: olResult?.coverPath || null,
        openLibraryKey: olResult?.openLibraryKey || null,
        goodreadsUrl: null,
        format: aiResult?.format || 'book'
      }

      console.log('[enrich-link] Book enrichment result:', bookMeta)
    }

    // ========================================
    // STEP 2.7: Music Enrichment — oEmbed + URL parsing + MusicBrainz/Last.fm
    // ========================================
    let musicMeta: Record<string, any> | null = null
    if (enrichListen || category === 'listen' || contentType === 'music') {
      console.log('[enrich-link] Step 2.7: Music enrichment for:', url)

      const musicResult: Record<string, any> = {
        artist: null,
        trackTitle: null,
        albumTitle: null,
        genre: null,
        duration: null,
        contentFormat: null,
        releaseDate: null,
        label: null,
        isExplicit: null,
        embedUrl: null,
        embedType: null,
        embedHeight: null,
        server_enriched_at: new Date().toISOString(),
      }

      // 1. Infer contentFormat from URL
      if (/\/track[\/s]/.test(path)) musicResult.contentFormat = 'track'
      else if (/\/album[\/s]/.test(path)) musicResult.contentFormat = 'album'
      else if (/\/playlist[\/s]/.test(path)) musicResult.contentFormat = 'playlist'
      else if (/\/episode[\/s]/.test(path) || /\/podcast/.test(path)) musicResult.contentFormat = 'podcast-episode'
      else if (/\/artist[\/s]/.test(path)) musicResult.contentFormat = 'artist'
      else if (/\/sets?[\/]/.test(path) && domain.includes('soundcloud.com')) musicResult.contentFormat = 'mix'

      // 2. Spotify: scrape page meta tags + oEmbed
      // Spotify's oEmbed doesn't return author_name, but the HTML page has rich meta tags:
      //   music:musician_description → artist name
      //   music:duration → seconds
      //   music:release_date → YYYY-MM-DD
      //   og:description → "Artist · Track · Type · Year"
      //   <title> → "Track - song and lyrics by Artist | Spotify"
      //   og:image → album art
      if (domain.includes('spotify.com')) {
        // 2a. Fetch page HTML for meta tags
        try {
          const pageResp = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ctrl.rodeo/1.0)' },
            redirect: 'follow',
          })
          if (pageResp.ok) {
            const html = await pageResp.text()

            // music:musician_description → direct artist name (most reliable)
            const artistMeta = html.match(/<meta\s+name="music:musician_description"\s+content="([^"]+)"/i)
            if (artistMeta) {
              musicResult.artist = artistMeta[1].trim()
              console.log('[enrich-link] Spotify meta artist:', musicResult.artist)
            }

            // music:duration → seconds
            const durMeta = html.match(/<meta\s+name="music:duration"\s+content="(\d+)"/i)
            if (durMeta) {
              musicResult.duration = parseInt(durMeta[1], 10)
            }

            // music:release_date → YYYY-MM-DD
            const releaseMeta = html.match(/<meta\s+name="music:release_date"\s+content="([^"]+)"/i)
            if (releaseMeta) {
              musicResult.releaseDate = releaseMeta[1].trim()
            }

            // og:title → track title
            const ogTitle = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i)
            if (ogTitle) {
              musicResult.trackTitle = ogTitle[1].trim()
            }

            // og:image → album art (we'll pass this through separately)
            const ogImage = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i)
            if (ogImage) {
              musicResult.imageUrl = ogImage[1].trim()
            }

            // <title> fallback: "Track - song and lyrics by Artist | Spotify"
            if (!musicResult.artist) {
              const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i)
              if (titleTag) {
                const spTitle = titleTag[1].match(/^(.+?)\s*-\s*(?:song and lyrics by|Song by|Album by)\s+(.+?)\s*\|/i)
                if (spTitle) {
                  musicResult.trackTitle = musicResult.trackTitle || spTitle[1].trim()
                  musicResult.artist = spTitle[2].trim()
                }
              }
            }

            // og:description fallback: "Artist · Track · Type · Year" or "Type · Artist · Year"
            if (!musicResult.artist) {
              const ogDesc = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i)
              if (ogDesc) {
                const desc = ogDesc[1]
                // Format: "Artist · Track · Song · 2026"
                const parts = desc.split(/\s*[·]\s*/)
                if (parts.length >= 3) {
                  // Check if a part is a type keyword
                  const typeIdx = parts.findIndex(p => /^(Song|Album|Playlist|EP|Single|Podcast)$/i.test(p.trim()))
                  if (typeIdx === 0 && parts.length >= 2) {
                    // "Song · Artist · Year"
                    musicResult.artist = parts[1].trim()
                  } else if (typeIdx >= 2) {
                    // "Artist · Track · Song · Year"
                    musicResult.artist = parts[0].trim()
                  }
                }
              }
            }

            console.log('[enrich-link] Spotify page scrape:', {
              artist: musicResult.artist, track: musicResult.trackTitle,
              duration: musicResult.duration, releaseDate: musicResult.releaseDate
            })
          }
        } catch (e) { console.warn('[enrich-link] Spotify page scrape failed:', (e as Error).message) }

        // 2b. Spotify oEmbed for embed URL (lightweight, always works)
        try {
          const oembedResp = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`)
          if (oembedResp.ok) {
            const oe = await oembedResp.json()
            musicResult.trackTitle = musicResult.trackTitle || oe.title || null
            if (!musicResult.artist && oe.author_name) {
              musicResult.artist = oe.author_name
            }
            if (oe.html) {
              const m = oe.html.match(/src=["']([^"']+)["']/)
              if (m) { musicResult.embedUrl = m[1]; musicResult.embedType = 'iframe'; musicResult.embedHeight = oe.height || 152 }
            }
          }
        } catch (e) { console.warn('[enrich-link] Spotify oEmbed failed:', (e as Error).message) }
      }

      // 3. SoundCloud oEmbed
      if (domain.includes('soundcloud.com')) {
        try {
          const oembedResp = await fetch(`https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(url)}`)
          if (oembedResp.ok) {
            const oe = await oembedResp.json()
            musicResult.trackTitle = musicResult.trackTitle || oe.title || null
            musicResult.artist = musicResult.artist || oe.author_name || null
            if (oe.html) {
              const m = oe.html.match(/src=["']([^"']+)["']/)
              if (m) { musicResult.embedUrl = m[1]; musicResult.embedType = 'iframe'; musicResult.embedHeight = oe.height || 166 }
            }
          }
        } catch (e) { console.warn('[enrich-link] SoundCloud oEmbed failed:', (e as Error).message) }
      }

      // 4. Title-based fallback for artist/track (from client-provided title)
      if (!musicResult.artist && title) {
        // "Track - song and lyrics by Artist | Spotify"
        const spTitle = title.match(/^(.+?)\s*-\s*(?:song and lyrics by|Song by|Album by)\s+(.+?)\s*\|/i)
        if (spTitle) {
          musicResult.trackTitle = musicResult.trackTitle || spTitle[1].trim()
          musicResult.artist = spTitle[2].trim()
        }
        // "Artist - Track" or "Track by Artist"
        if (!musicResult.artist) {
          const dashSplit = title.match(/^(.+?)\s*[-–—]\s+(.+?)(?:\s*\|.*)?$/)
          if (dashSplit) {
            musicResult.artist = musicResult.artist || dashSplit[1].trim()
            musicResult.trackTitle = musicResult.trackTitle || dashSplit[2].trim()
          }
        }
      }

      // 5. Description-based fallback
      if (!musicResult.artist && description) {
        // "Listen to Track on Spotify. Song · Artist · Year"
        const spDesc = description.match(/(?:Song|Album|Playlist|EP)\s*[·•]\s*(.+?)\s*[·•]\s*(\d{4})/i)
        if (spDesc) {
          musicResult.artist = spDesc[1].trim()
          musicResult.releaseDate = musicResult.releaseDate || spDesc[2]
        }
        // "Artist · Track · Song · Year" (og:description format)
        if (!musicResult.artist) {
          const parts = description.split(/\s*[·•]\s*/)
          if (parts.length >= 3) {
            const typeIdx = parts.findIndex(p => /^(Song|Album|Playlist|EP|Single)$/i.test(p.trim()))
            if (typeIdx >= 2) {
              musicResult.artist = parts[0].trim()
              musicResult.releaseDate = musicResult.releaseDate || (parts[parts.length - 1].match(/\d{4}/) || [])[0] || null
            }
          }
        }
      }

      // 6. MusicBrainz + Last.fm for genre/label (if we have artist + track)
      if (musicResult.artist && musicResult.trackTitle) {
        try {
          // Call our own enrich-music function internally
          const supabaseUrl = Deno.env.get('SUPABASE_URL')!
          const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
          const enrichResp = await fetch(`${supabaseUrl}/functions/v1/enrich-music`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseServiceKey}`,
            },
            body: JSON.stringify({
              artist: musicResult.artist,
              track: musicResult.trackTitle,
              album: musicResult.albumTitle,
            }),
          })
          if (enrichResp.ok) {
            const enrichData = await enrichResp.json()
            if (enrichData.genre) musicResult.genre = enrichData.genre
            if (enrichData.genreTags) musicResult.genreTags = enrichData.genreTags
            if (enrichData.label) musicResult.label = enrichData.label
            if (enrichData.album) musicResult.albumTitle = musicResult.albumTitle || enrichData.album
            if (enrichData.releaseDate) musicResult.releaseDate = musicResult.releaseDate || enrichData.releaseDate
            console.log('[enrich-link] enrich-music result:', enrichData)
          }
        } catch (e) { console.warn('[enrich-link] enrich-music call failed:', (e as Error).message) }
      }

      // Return if we got anything useful
      const hasData = musicResult.artist || musicResult.trackTitle || musicResult.contentFormat
      if (hasData) {
        musicMeta = musicResult
      }

      // Use Spotify og:image as fallback if no image was resolved
      if (musicMeta?.imageUrl && !imageUrl) {
        imageUrl = musicMeta.imageUrl
        imageSource = 'platform'
        imageLog.push({ strategy: 'music_page_scrape', result: 'accepted', url: imageUrl })
        console.log('[enrich-link] Using Spotify og:image as fallback:', imageUrl)
      }
      // Remove imageUrl from musicMeta (it's handled by the image pipeline)
      if (musicMeta?.imageUrl) delete musicMeta.imageUrl

      console.log('[enrich-link] Music enrichment result:', musicMeta)
    }

    // ========================================
    // STEP 3: Update link in database (if linkId provided)
    // ========================================
    if (linkId) {
      console.log('[enrich-link] Step 3: Updating link', linkId)

      const updatePayload: Record<string, any> = {
        content_type: contentType,
        type_confidence: typeConfidence,
        image: imageUrl,
        image_source: imageSource,
        image_resolved_at: new Date().toISOString()
      }
      // Save platform-resolved title to DB (overrides generic "YouTube" etc.)
      // Only save if we actually resolved a meaningful title
      if (oembedTitle) {
        const genericTitleValues = ['youtube', 'youtu.be', 'vimeo', 'watch', '']
        const titleIsGeneric = !title || genericTitleValues.includes(title.toLowerCase().trim())
          || title.toLowerCase().trim() === domain
        if (!titleIsGeneric) {
          updatePayload.title = title
        }
        if (youtubeData?.description) {
          updatePayload.description = youtubeData.description.slice(0, 500)
        }
      }
      if (imageScores) {
        updatePayload.image_scores = imageScores
      }
      if (videoMeta) {
        updatePayload.video = videoMeta
      }
      if (bookMeta) {
        updatePayload.book = bookMeta
      }
      if (musicMeta) {
        updatePayload.music = musicMeta
      }
      await supabase
        .from('links')
        .update(updatePayload)
        .eq('id', linkId)
    }

    // Build image resolution log
    const imageResolutionLog = {
      resolved_at: new Date().toISOString(),
      attempts: imageLog,
      final_image: imageUrl,
      final_source: imageUrl ? imageSource : null,
      final_tier: imageScores?.tier || imageScores?.evaluation_method || null,
      final_reason: imageUrl
        ? `Accepted via ${imageSource}${imageScores?.tier ? ` (${imageScores.tier})` : ''}`
        : (imageLog.length > 0
          ? `All ${imageLog.length} strategies failed: ${imageLog.map(a => `${a.strategy}(${a.result})`).join(', ')}`
          : 'Image resolution skipped')
    }

    // Return result
    const response: Record<string, any> = {
      content_type: contentType,
      type_confidence: typeConfidence,
      type_source: typeSource,
      image_url: imageUrl,
      image_source: imageSource,
      image_scores: imageScores,
      image_resolution_log: imageResolutionLog,
      cached
    }
    // Include platform-resolved title so client can update its stored data
    // Only include if we actually resolved a meaningful title (not empty or generic domain names)
    if (oembedTitle) {
      const genericTitleValues = ['youtube', 'youtu.be', 'vimeo', 'watch', '']
      const titleIsGeneric = !title || genericTitleValues.includes(title.toLowerCase().trim())
        || title.toLowerCase().trim() === domain
      if (!titleIsGeneric) {
        response.title = title
      }
      if (oembedTitle.author) response.author = oembedTitle.author
      if (youtubeData?.description) response.description = youtubeData.description.slice(0, 500)
    }
    if (videoMeta) {
      response.video = videoMeta
    }
    if (bookMeta) {
      response.book = bookMeta
    }
    if (musicMeta) {
      response.music = musicMeta
    }

    console.log('[enrich-link] Complete:', response)

    return new Response(
      JSON.stringify(response),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('[enrich-link] Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

// ========================================
// oEmbed Metadata Resolution (Vimeo, etc.)
// YouTube is handled by lookupYouTube() which uses Data API v3 + oEmbed fallback
// ========================================
async function resolveOembedMetadata(
  url: string,
  domain: string
): Promise<{ title: string, author: string | null, thumbnail: string | null } | null> {
  // Vimeo oEmbed
  if (domain.includes('vimeo.com')) {
    try {
      const resp = await fetch(
        `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`
      )
      if (resp.ok) {
        const data = await resp.json()
        if (data.title) {
          return {
            title: data.title,
            author: data.author_name || null,
            thumbnail: data.thumbnail_url || null
          }
        }
      }
    } catch (e) {
      console.error('[oembed] Vimeo oEmbed error:', e)
    }
  }

  return null
}

// ========================================
// JSON-LD Title Resolution — extract clean titles from structured data
// Pages often have messy <title> tags ("SHOW | Episode | Season | Network")
// but clean names in JSON-LD structured data. This is a generalized approach
// that works across content types (videos, articles, products, recipes, etc.)
// ========================================
const JSON_LD_TITLE_TYPES = new Set([
  'TVEpisode', 'VideoObject', 'Movie', 'TVSeries', 'Episode', 'Clip',
  'Article', 'NewsArticle', 'BlogPosting', 'Review',
  'Product', 'Book', 'Recipe',
  'MusicRecording', 'MusicAlbum', 'PodcastEpisode',
  'SoftwareApplication', 'Course', 'Event', 'CreativeWork'
])

async function resolveJsonLdTitle(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      }
    })
    if (!response.ok) return null

    const html = await response.text()
    const jsonLdMatches = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)

    for (const match of jsonLdMatches) {
      try {
        const ld = JSON.parse(match[1])
        const candidates = ld['@graph'] ? ld['@graph'] : [ld]
        for (const item of candidates) {
          if (item?.name && JSON_LD_TITLE_TYPES.has(item['@type'])) {
            // Skip very short names (likely just a site name)
            if (item.name.length < 5) continue
            console.log('[json-ld] Resolved title:', item.name, 'from @type:', item['@type'])
            return item.name
          }
        }
      } catch (_e) { /* JSON parse error, continue */ }
    }
  } catch (e) {
    console.log('[json-ld] Fetch failed:', e.message)
  }
  return null
}

// ========================================
// YouTube Data API v3 — full video metadata
// ========================================
interface YouTubeVideoData {
  videoId: string
  title: string
  description: string
  channelTitle: string
  publishedAt: string
  thumbnailUrl: string | null
  duration: number | null      // seconds
  tags: string[]
  categoryId: string | null
  viewCount: number | null
  likeCount: number | null
}

/**
 * Extract YouTube video ID from various URL formats.
 */
function extractYouTubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url)
    // youtube.com/watch?v=ID
    if (parsed.hostname.includes('youtube.com')) {
      return parsed.searchParams.get('v')
    }
    // youtu.be/ID
    if (parsed.hostname.includes('youtu.be')) {
      return parsed.pathname.slice(1).split(/[?#]/)[0] || null
    }
  } catch {}
  return null
}

/**
 * Parse ISO 8601 duration (PT1H2M3S) to seconds.
 */
function parseISO8601Duration(iso: string): number | null {
  if (!iso) return null
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!match) return null
  const hours = parseInt(match[1] || '0', 10)
  const minutes = parseInt(match[2] || '0', 10)
  const seconds = parseInt(match[3] || '0', 10)
  return hours * 3600 + minutes * 60 + seconds
}

/**
 * Look up a YouTube video using the Data API v3.
 * Returns rich metadata: title, description, channel, duration, tags, thumbnails, stats.
 * Falls back to oEmbed if no API key.
 */
async function lookupYouTube(url: string): Promise<YouTubeVideoData | null> {
  const videoId = extractYouTubeVideoId(url)
  if (!videoId) {
    console.log('[youtube] Could not extract video ID from:', url)
    return null
  }

  const apiKey = Deno.env.get('YOUTUBE_API_KEY')
  if (!apiKey) {
    console.log('[youtube] No YOUTUBE_API_KEY, falling back to oEmbed')
    // Fallback: use oEmbed for basic title/author
    try {
      const resp = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`
      )
      if (resp.ok) {
        const data = await resp.json()
        if (data.title) {
          return {
            videoId,
            title: data.title,
            description: '',
            channelTitle: data.author_name || '',
            publishedAt: '',
            thumbnailUrl: data.thumbnail_url || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
            duration: null,
            tags: [],
            categoryId: null,
            viewCount: null,
            likeCount: null
          }
        }
      }
    } catch (e) {
      console.error('[youtube] oEmbed fallback error:', e)
    }
    return null
  }

  try {
    const apiUrl = `https://www.googleapis.com/youtube/v3/videos?` +
      `id=${videoId}` +
      `&part=snippet,contentDetails,statistics` +
      `&key=${apiKey}`

    console.log('[youtube] Fetching video data for:', videoId)
    const resp = await fetch(apiUrl)

    if (!resp.ok) {
      console.error('[youtube] API error:', resp.status, await resp.text())
      return null
    }

    const data = await resp.json()
    const items = data.items || []

    if (items.length === 0) {
      console.log('[youtube] Video not found:', videoId)
      return null
    }

    const video = items[0]
    const snippet = video.snippet || {}
    const contentDetails = video.contentDetails || {}
    const statistics = video.statistics || {}

    // Pick best thumbnail: maxres > standard > high > medium > default
    const thumbs = snippet.thumbnails || {}
    const thumbnailUrl = thumbs.maxres?.url
      || thumbs.standard?.url
      || thumbs.high?.url
      || thumbs.medium?.url
      || thumbs.default?.url
      || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`

    const result: YouTubeVideoData = {
      videoId,
      title: snippet.title || '',
      description: snippet.description || '',
      channelTitle: snippet.channelTitle || '',
      publishedAt: snippet.publishedAt || '',
      thumbnailUrl,
      duration: parseISO8601Duration(contentDetails.duration),
      tags: snippet.tags || [],
      categoryId: snippet.categoryId || null,
      viewCount: statistics.viewCount ? parseInt(statistics.viewCount, 10) : null,
      likeCount: statistics.likeCount ? parseInt(statistics.likeCount, 10) : null
    }

    console.log('[youtube] Video data:', result.title, `(${result.duration}s)`, 'by', result.channelTitle)
    return result
  } catch (e) {
    console.error('[youtube] API lookup error:', e)
    return null
  }
}

// ========================================
// AI Classification using Anthropic
// ========================================
async function classifyWithAI(url: string, title: string, description: string): Promise<{ type: string, confidence: number } | null> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')

  if (!apiKey) {
    console.log('[enrich-link] No ANTHROPIC_API_KEY, skipping AI classification')
    return null
  }

  const prompt = `Classify this link into exactly one content type.

URL: ${url}
Title: ${title || 'N/A'}
Description: ${description?.slice(0, 300) || 'N/A'}

Content types:
- product: E-commerce product pages, items for sale
- article: Blog posts, news articles, written content
- book: Books, ebooks, audiobooks (Goodreads, Amazon books, Open Library, etc.)
- video: Video content (YouTube, Vimeo, etc.)
- music: Music, podcasts, audio content
- repository: Code repositories, GitHub projects
- social: Social media posts, profiles
- document: PDFs, docs, spreadsheets
- tool: Web apps, SaaS, utilities
- unknown: Cannot determine

Respond with JSON only: {"type": "...", "confidence": 0.0-1.0}`

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 100,
        messages: [{ role: 'user', content: prompt }]
      })
    })

    if (!response.ok) {
      console.error('[enrich-link] Anthropic API error:', response.status)
      return null
    }

    const data = await response.json()
    const text = data.content?.[0]?.text || ''
    const match = text.match(/\{[\s\S]*\}/)

    if (match) {
      const result = JSON.parse(match[0])
      // Validate type
      if (CONTENT_TYPES.includes(result.type)) {
        return result
      }
    }
  } catch (e) {
    console.error('[enrich-link] AI classification error:', e)
  }

  return null
}

// ========================================
// Watch Enrichment using TMDB
// ========================================

interface TMDBResult {
  tmdbId: number
  mediaType: 'movie' | 'tv'
  imdbId: string | null
  title: string
  overview: string | null
  year: number | null
  runtime: number | null   // minutes
  genres: string[]
  voteAverage: number | null
  creator: string | null
  posterPath: string | null
  streamingServices: Array<{ name: string, type: string, logoPath: string | null }>
  tmdbUrl: string
}

/**
 * Look up a title on TMDB. Tries movie search first, then TV.
 * Uses append_to_response to get details + watch providers + credits in one call.
 */
async function lookupTMDB(rawTitle: string, type: string | null, year: number | null): Promise<TMDBResult | null> {
  const tmdbKey = Deno.env.get('TMDB_API_KEY')
  if (!tmdbKey || !rawTitle) {
    console.log('[tmdb] No TMDB_API_KEY or title, skipping')
    return null
  }

  // Clean title: strip platform/network suffixes after separators
  const cleanTitle = rawTitle
    .replace(/\s*[\|\-–—]\s*(Netflix|YouTube|Hulu|Disney\+?|HBO|Max|Prime Video|Apple TV\+?|Vimeo|IMDb|Letterboxd|Rotten Tomatoes|Watch|Stream|Official|Wikipedia|Wiki|Fandom|PBS|BBC|CBC|ABC|NBC|CBS|CNN|FOX|ITV|NHK|Season\s+\d|Episode\s+\d).*$/i, '')
    .replace(/\s*\(\d{4}\)\s*$/, '')  // strip trailing (2024)
    .replace(/\s*-\s*(IMDb|Wikipedia)\s*$/i, '')
    .replace(/\s*\(TV series\)\s*$/i, '')  // strip "(TV series)" from Wikipedia titles
    .replace(/\s*\(film\)\s*$/i, '')  // strip "(film)" from Wikipedia titles
    .replace(/\s*\(TV programme\)\s*$/i, '')
    .trim()

  if (!cleanTitle) return null
  console.log('[tmdb] Searching for:', cleanTitle, type ? `(${type})` : '', year || '')

  const baseUrl = 'https://api.themoviedb.org/3'
  const headers = {
    'Authorization': `Bearer ${Deno.env.get('TMDB_READ_TOKEN') || ''}`,
    'Accept': 'application/json'
  }
  // Use API key auth (simpler, no bearer token needed)
  const authParam = `api_key=${tmdbKey}`

  try {
    // Determine search order based on type hint
    const searchOrder: Array<'movie' | 'tv'> =
      type === 'tv-show' || type === 'anime' ? ['tv', 'movie'] : ['movie', 'tv']

    let searchResult: { id: number, mediaType: 'movie' | 'tv' } | null = null

    for (const mediaType of searchOrder) {
      const yearParam = year
        ? (mediaType === 'movie' ? `&year=${year}` : `&first_air_date_year=${year}`)
        : ''
      const searchUrl = `${baseUrl}/search/${mediaType}?${authParam}&query=${encodeURIComponent(cleanTitle)}${yearParam}`

      console.log('[tmdb] Search:', mediaType, cleanTitle)
      const searchResp = await fetch(searchUrl)

      if (!searchResp.ok) {
        console.error('[tmdb] Search error:', searchResp.status)
        continue
      }

      const searchData = await searchResp.json()
      const results = searchData.results || []

      if (results.length > 0) {
        // Pick best match: exact title match > first result (sorted by popularity)
        const titleLower = cleanTitle.toLowerCase()
        const exactMatch = results.find((r: any) => {
          const rTitle = (mediaType === 'movie' ? r.title : r.name)?.toLowerCase()
          return rTitle === titleLower
        })
        const best = exactMatch || results[0]
        searchResult = { id: best.id, mediaType }
        console.log('[tmdb] Found:', mediaType, best.id, mediaType === 'movie' ? best.title : best.name)
        break
      }
    }

    if (!searchResult) {
      console.log('[tmdb] No results found for:', cleanTitle)
      return null
    }

    // Get details + watch providers + credits in one call
    const appendParts = ['watch/providers', 'credits']
    if (searchResult.mediaType === 'tv') {
      appendParts.push('external_ids')  // TV needs this for imdb_id
    }
    const detailsUrl = `${baseUrl}/${searchResult.mediaType}/${searchResult.id}?${authParam}&append_to_response=${appendParts.join(',')}`

    console.log('[tmdb] Getting details for:', searchResult.mediaType, searchResult.id)
    const detailsResp = await fetch(detailsUrl)

    if (!detailsResp.ok) {
      console.error('[tmdb] Details error:', detailsResp.status)
      return null
    }

    const details = await detailsResp.json()

    // Extract fields based on media type
    const isMovie = searchResult.mediaType === 'movie'
    const tmdbTitle = isMovie ? details.title : details.name
    const releaseDate = isMovie ? details.release_date : details.first_air_date
    const releaseYear = releaseDate ? parseInt(releaseDate.split('-')[0], 10) : null
    const runtime = isMovie ? details.runtime : (details.episode_run_time?.[0] || null)
    const genres = (details.genres || []).map((g: any) => g.name)

    // Extract creator/director
    let creator: string | null = null
    if (isMovie) {
      const director = details.credits?.crew?.find((c: any) => c.job === 'Director')
      creator = director?.name || null
    } else {
      creator = details.created_by?.[0]?.name || null
    }

    // Extract IMDB ID
    const imdbId = isMovie ? (details.imdb_id || null) : (details.external_ids?.imdb_id || null)

    // Extract US streaming providers
    const usProviders = details['watch/providers']?.results?.US || {}
    const streamingServices: Array<{ name: string, type: string, logoPath: string | null }> = []

    // Flatrate (subscription streaming) first
    for (const provider of (usProviders.flatrate || [])) {
      streamingServices.push({
        name: provider.provider_name,
        type: 'flatrate',
        logoPath: provider.logo_path || null
      })
    }
    // Then free/ads
    for (const provider of (usProviders.free || [])) {
      streamingServices.push({
        name: provider.provider_name,
        type: 'free',
        logoPath: provider.logo_path || null
      })
    }
    // Then rent/buy (limited to top 3)
    const rentBuy = [...(usProviders.rent || []), ...(usProviders.buy || [])]
    const seenRentBuy = new Set<string>()
    for (const provider of rentBuy) {
      if (!seenRentBuy.has(provider.provider_name) && seenRentBuy.size < 3) {
        seenRentBuy.add(provider.provider_name)
        streamingServices.push({
          name: provider.provider_name,
          type: 'rent',
          logoPath: provider.logo_path || null
        })
      }
    }

    const tmdbUrl = `https://www.themoviedb.org/${searchResult.mediaType}/${searchResult.id}`

    console.log('[tmdb] Enrichment complete:', tmdbTitle, `(${releaseYear})`,
      streamingServices.length, 'providers', imdbId || 'no imdb')

    return {
      tmdbId: searchResult.id,
      mediaType: searchResult.mediaType,
      imdbId,
      title: tmdbTitle,
      overview: details.overview || null,
      year: releaseYear,
      runtime,
      genres,
      voteAverage: details.vote_average || null,
      creator,
      posterPath: details.poster_path || null,
      streamingServices,
      tmdbUrl
    }
  } catch (e) {
    console.error('[tmdb] Lookup error:', e)
    return null
  }
}

/**
 * Infer content type from TMDB media type
 */
function inferTypeFromTMDB(mediaType: 'movie' | 'tv'): string {
  if (mediaType === 'movie') return 'movie'
  if (mediaType === 'tv') return 'tv-show'
  return 'video'
}

// ========================================
// Watch Enrichment using AI (fallback)
// ========================================
async function enrichWatchWithAI(url: string, title: string, description: string): Promise<Record<string, any> | null> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')

  if (!apiKey) {
    console.log('[enrich-link] No ANTHROPIC_API_KEY, skipping watch enrichment')
    return null
  }

  const prompt = `Given this video/film link, provide structured metadata. Be concise and accurate.

URL: ${url}
Title: ${title || 'N/A'}
Description: ${description?.slice(0, 500) || 'N/A'}

Return JSON only:
{
  "summary": "1-2 sentence summary, max 50 words. Present tense, no spoilers.",
  "type": "movie|tv-show|documentary|short|anime|video|trailer",
  "genre": "primary genre (e.g. drama, comedy, thriller, sci-fi, horror, action, romance, animation)",
  "genres": ["primary genre", "secondary genre if applicable"],
  "year": year as number or null if unknown,
  "creator": "director name for films, showrunner for TV, channel name for YouTube, or null",
  "streamingServices": ["list of major streaming services where this is typically available, e.g. Netflix, Hulu, Disney+, Amazon Prime Video, HBO Max, Apple TV+"],
  "rating": "content rating (G, PG, PG-13, R, NC-17, TV-Y, TV-G, TV-PG, TV-14, TV-MA) or null"
}`

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }]
      })
    })

    if (!response.ok) {
      console.error('[enrich-link] Watch enrichment API error:', response.status)
      return null
    }

    const data = await response.json()
    const text = data.content?.[0]?.text || ''
    const match = text.match(/\{[\s\S]*\}/)

    if (match) {
      const result = JSON.parse(match[0])
      // Validate and clean the result
      const validTypes = ['movie', 'tv-show', 'documentary', 'short', 'anime', 'video', 'trailer']
      return {
        summary: typeof result.summary === 'string' ? result.summary.slice(0, 500) : null,
        type: validTypes.includes(result.type) ? result.type : null,
        genre: typeof result.genre === 'string' ? result.genre : null,
        genres: Array.isArray(result.genres) ? result.genres.filter((g: any) => typeof g === 'string').slice(0, 3) : (typeof result.genre === 'string' ? [result.genre] : []),
        year: typeof result.year === 'number' && result.year > 1800 && result.year < 2100 ? result.year : null,
        creator: typeof result.creator === 'string' ? result.creator : null,
        streamingServices: Array.isArray(result.streamingServices) ? result.streamingServices.filter((s: any) => typeof s === 'string').slice(0, 10) : [],
        rating: typeof result.rating === 'string' ? result.rating : null
      }
    }
  } catch (e) {
    console.error('[enrich-link] Watch enrichment error:', e)
  }

  return null
}

// ========================================
// Open Library Lookup for Books
// ========================================
async function lookupOpenLibrary(rawTitle: string): Promise<{
  openLibraryKey: string, title: string, author: string | null, isbn: string | null,
  year: number | null, pages: number | null, genre: string | null,
  summary: string | null, coverPath: string | null
} | null> {
  if (!rawTitle) {
    console.log('[openlibrary] No title, skipping')
    return null
  }

  // Clean title: strip common suffixes
  const cleanTitle = rawTitle
    .replace(/\s*[\|\-–—]\s*(Goodreads|Amazon|Barnes & Noble|Bookshop|Book|Read|Review|Buy|Kindle|Audible|Open Library).*$/i, '')
    .replace(/\s*by\s+.+$/i, '')
    .replace(/\s*\(\d{4}\)\s*$/, '')
    .trim()

  if (!cleanTitle) return null
  console.log('[openlibrary] Searching for:', cleanTitle)

  try {
    const searchUrl = `https://openlibrary.org/search.json?q=${encodeURIComponent(cleanTitle)}&fields=key,title,author_name,first_publish_year,number_of_pages_median,isbn,cover_i,subject&limit=5`
    const searchResp = await fetch(searchUrl)
    if (!searchResp.ok) {
      console.error('[openlibrary] Search error:', searchResp.status)
      return null
    }

    const searchData = await searchResp.json()
    const results = searchData.docs || []

    if (results.length === 0) {
      console.log('[openlibrary] No results for:', cleanTitle)
      return null
    }

    // Take first result (Open Library ranks by relevance)
    const book = results[0]
    const workKey = book.key  // e.g., "/works/OL45883W"

    // Fetch work details for description
    let summary: string | null = null
    if (workKey) {
      try {
        const workResp = await fetch(`https://openlibrary.org${workKey}.json`)
        if (workResp.ok) {
          const workData = await workResp.json()
          summary = typeof workData.description === 'string'
            ? workData.description
            : workData.description?.value || null
        }
      } catch (e) {
        console.error('[openlibrary] Work details error:', e)
      }
    }

    // Extract primary subject as genre
    const genre = book.subject?.[0] || null

    const result = {
      openLibraryKey: workKey,
      title: book.title,
      author: book.author_name?.[0] || null,
      isbn: book.isbn?.[0] || null,
      year: book.first_publish_year || null,
      pages: book.number_of_pages_median || null,
      genre,
      summary,
      coverPath: book.cover_i ? String(book.cover_i) : null
    }

    console.log('[openlibrary] Found:', result.title, 'by', result.author)
    return result
  } catch (e) {
    console.error('[openlibrary] Lookup error:', e)
    return null
  }
}

// ========================================
// Book Enrichment using AI (fallback)
// ========================================
async function enrichBookWithAI(url: string, title: string, description: string): Promise<Record<string, any> | null> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    console.log('[enrich-link] No ANTHROPIC_API_KEY, skipping book enrichment')
    return null
  }

  const prompt = `Given this book/reading link, provide structured metadata. Be concise and accurate.

URL: ${url}
Title: ${title || 'N/A'}
Description: ${description?.slice(0, 500) || 'N/A'}

Return JSON only:
{
  "author": "Primary author name or null",
  "year": year as number or null,
  "pages": page count as number or null,
  "genre": "primary genre (e.g. Fiction, Non-Fiction, Science, Biography, History, Fantasy, Mystery, Self-Help)",
  "summary": "1-2 sentence description, max 50 words.",
  "format": "book|ebook|audiobook|article|paper"
}`

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }]
      })
    })

    if (!response.ok) {
      console.error('[enrich-link] Book enrichment API error:', response.status)
      return null
    }

    const data = await response.json()
    const text = data.content?.[0]?.text || ''
    const match = text.match(/\{[\s\S]*\}/)

    if (match) {
      const result = JSON.parse(match[0])
      const validFormats = ['book', 'ebook', 'audiobook', 'article', 'paper']
      return {
        author: typeof result.author === 'string' ? result.author : null,
        year: typeof result.year === 'number' && result.year > 1800 && result.year < 2100 ? result.year : null,
        pages: typeof result.pages === 'number' && result.pages > 0 ? result.pages : null,
        genre: typeof result.genre === 'string' ? result.genre : null,
        summary: typeof result.summary === 'string' ? result.summary.slice(0, 500) : null,
        format: validFormats.includes(result.format) ? result.format : 'book'
      }
    }
  } catch (e) {
    console.error('[enrich-link] Book enrichment error:', e)
  }

  return null
}

// ========================================
// Update Domain Profile Cache
// ========================================
async function updateDomainProfile(supabase: any, domain: string, path: string, result: { type: string, confidence: number }) {
  try {
    // Get existing profile
    const { data: existing } = await supabase
      .from('domain_profiles')
      .select('*')
      .eq('domain', domain)
      .single()

    if (existing) {
      // Update types seen
      const typesSeen = existing.types_seen || {}
      typesSeen[result.type] = (typesSeen[result.type] || 0) + 1

      // Calculate if single or multi-type domain
      const types = Object.keys(typesSeen)
      const total = Object.values(typesSeen).reduce((a: number, b: number) => a + b, 0) as number
      const dominant = Object.entries(typesSeen).sort((a, b) => (b[1] as number) - (a[1] as number))[0]
      const dominantRatio = (dominant[1] as number) / total

      await supabase
        .from('domain_profiles')
        .update({
          types_seen: typesSeen,
          sample_count: total,
          primary_type: dominant[0],
          confidence: dominantRatio,
          classification: types.length === 1 || dominantRatio > 0.9 ? 'single_type' : 'multi_type',
          updated_at: new Date().toISOString()
        })
        .eq('domain', domain)
    } else {
      // Create new profile
      await supabase
        .from('domain_profiles')
        .insert({
          domain,
          primary_type: result.type,
          types_seen: { [result.type]: 1 },
          sample_count: 1,
          confidence: result.confidence,
          classification: 'unknown'
        })
    }
  } catch (e) {
    console.error('[enrich-link] Domain profile update error:', e)
  }
}

// ========================================
// Image Resolution Strategies
// ========================================
async function executeImageStrategy(
  strategy: string,
  url: string,
  title: string,
  description: string
): Promise<{ url: string, source: 'scraped' | 'platform' | 'generated' | 'template' | 'favicon' } | null> {

  switch (strategy) {
    case 'platform':
      return await resolvePlatformImage(url)

    case 'search':
      return await searchImageSerpApi(url, title, description)

    case 'scrape':
      return await scrapeImage(url)

    case 'favicon':
      return await resolveFavicon(url)

    case 'template':
    default:
      return null
  }
}

// Platform-specific image resolution (YouTube, GitHub, Vimeo)
async function resolvePlatformImage(url: string): Promise<{ url: string, source: 'platform' } | null> {
  const domain = new URL(url).hostname

  // YouTube — verify thumbnail exists (deleted/private videos return 404)
  if (domain.includes('youtube.com') || domain.includes('youtu.be')) {
    const videoId = url.match(/(?:v=|youtu\.be\/)([^&\?]+)/)?.[1]
    if (videoId) {
      for (const quality of ['hqdefault', 'mqdefault']) {
        const thumbUrl = `https://img.youtube.com/vi/${videoId}/${quality}.jpg`
        try {
          const check = await fetch(thumbUrl, { method: 'HEAD' })
          if (check.ok) {
            return { url: thumbUrl, source: 'platform' }
          }
        } catch (e) { /* try next quality */ }
      }
      console.log('[platform] YouTube thumbnail not found for videoId:', videoId)
    }
  }

  // Vimeo
  if (domain.includes('vimeo.com')) {
    const videoId = url.match(/vimeo\.com\/(\d+)/)?.[1]
    if (videoId) {
      try {
        const response = await fetch(`https://vimeo.com/api/v2/video/${videoId}.json`)
        if (response.ok) {
          const data = await response.json()
          if (data[0]?.thumbnail_large) {
            return { url: data[0].thumbnail_large, source: 'platform' }
          }
        }
      } catch (e) {
        console.error('[platform] Vimeo API error:', e)
      }
    }
  }

  // Spotify (oEmbed API — bypasses bot detection)
  if (domain.includes('spotify.com')) {
    try {
      const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`
      console.log('[platform] Spotify oEmbed request:', oembedUrl)
      const response = await fetch(oembedUrl)
      console.log('[platform] Spotify oEmbed response:', response.status)
      if (response.ok) {
        const data = await response.json()
        if (data.thumbnail_url) {
          console.log('[platform] Spotify oEmbed thumbnail:', data.thumbnail_url)
          return { url: data.thumbnail_url, source: 'platform' }
        }
        console.log('[platform] Spotify oEmbed response missing thumbnail_url:', JSON.stringify(data).slice(0, 200))
      }
    } catch (e) {
      console.error('[platform] Spotify oEmbed error:', e)
    }
  }

  // SoundCloud (oEmbed API)
  if (domain.includes('soundcloud.com')) {
    try {
      const response = await fetch(`https://soundcloud.com/oembed?url=${encodeURIComponent(url)}&format=json`)
      if (response.ok) {
        const data = await response.json()
        if (data.thumbnail_url) {
          console.log('[platform] SoundCloud oEmbed thumbnail:', data.thumbnail_url)
          return { url: data.thumbnail_url, source: 'platform' }
        }
      }
    } catch (e) {
      console.error('[platform] SoundCloud oEmbed error:', e)
    }
  }

  // GitHub
  if (domain.includes('github.com')) {
    const match = url.match(/github\.com\/([^\/]+)\/([^\/]+)/)
    if (match) {
      return {
        url: `https://opengraph.githubassets.com/1/${match[1]}/${match[2]}`,
        source: 'platform'
      }
    }
  }

  return null
}

// Scrape OG image from URL (server-side, no CORS issues)
async function scrapeImage(url: string): Promise<{ url: string, source: 'scraped' } | null> {
  try {
    // Use a more browser-like User-Agent to avoid bot blocks
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Cache-Control': 'no-cache'
      }
    })

    if (!response.ok) {
      console.log('[scrape] HTTP error:', response.status, 'for', url)
      return null
    }

    const html = await response.text()

    // Detect error pages that return 200 — check title for error patterns
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i)
    if (titleMatch) {
      const pageTitle = titleMatch[1].toLowerCase().trim()
      const errorPatterns = [
        /page\s*not\s*found/, /^404/, /not\s*found/, /access\s*denied/,
        /403\s*forbidden/, /something\s*went\s*wrong/, /unavailable/,
        /page\s*doesn'?t?\s*exist/, /this\s*page\s*isn'?t?\s*available/
      ]
      if (errorPatterns.some(p => p.test(pageTitle))) {
        console.log('[scrape] Error page detected (title:', titleMatch[1].trim(), '), skipping:', url)
        return null
      }
    }

    const base = new URL(url)

    // Helper to resolve relative URLs
    const resolveUrl = (imgUrl: string): string => {
      if (!imgUrl) return ''
      if (imgUrl.startsWith('//')) return `https:${imgUrl}`
      if (imgUrl.startsWith('/')) return `${base.origin}${imgUrl}`
      if (!imgUrl.startsWith('http')) return `${base.origin}/${imgUrl}`
      return imgUrl
    }

    // 1. Try og:image first (handle both single and double quotes)
    const ogMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i)

    if (ogMatch?.[1]) {
      const imageUrl = resolveUrl(ogMatch[1])
      if (!isRejectedByGate(imageUrl)) {
        console.log('[scrape] Found og:image:', imageUrl)
        return { url: imageUrl, source: 'scraped' }
      }
      console.log('[scrape] Skipping og:image (rejected by gate):', imageUrl)
    }

    // 2. Try twitter:image (handle both single and double quotes)
    const twitterMatch = html.match(/<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:image["']/i)

    if (twitterMatch?.[1]) {
      const imageUrl = resolveUrl(twitterMatch[1])
      if (!isRejectedByGate(imageUrl)) {
        console.log('[scrape] Found twitter:image:', imageUrl)
        return { url: imageUrl, source: 'scraped' }
      }
    }

    // 3. Try JSON-LD structured data (common in Shopify, e-commerce)
    const jsonLdMatches = html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)
    for (const match of jsonLdMatches) {
      try {
        const jsonLd = JSON.parse(match[1])
        // Handle Product schema
        const product = jsonLd['@type'] === 'Product' ? jsonLd : jsonLd['@graph']?.find((item: any) => item['@type'] === 'Product')
        if (product?.image) {
          const productImage = Array.isArray(product.image) ? product.image[0] : product.image
          const imageUrl = typeof productImage === 'string' ? productImage : productImage?.url
          if (imageUrl && !isRejectedByGate(resolveUrl(imageUrl))) {
            console.log('[scrape] Found JSON-LD product image:', imageUrl)
            return { url: resolveUrl(imageUrl), source: 'scraped' }
          }
        }
      } catch (e) {
        // JSON parse error, continue
      }
    }

    // 4. Try Shopify CDN pattern (common in Shopify stores)
    const shopifyMatch = html.match(/https:\/\/cdn\.shopify\.com\/s\/files\/[^"'\s]+\.(?:jpg|jpeg|png|webp)/i)
    if (shopifyMatch?.[0] && !isRejectedByGate(shopifyMatch[0])) {
      console.log('[scrape] Found Shopify CDN image:', shopifyMatch[0])
      return { url: shopifyMatch[0], source: 'scraped' }
    }

    // 5. Try first large image in srcset (common in Next.js sites)
    const srcsetMatch = html.match(/srcset="([^"]+)"/i)
    if (srcsetMatch?.[1]) {
      const srcsetParts = srcsetMatch[1].split(',').map(s => s.trim())
      // Get the largest image (usually last in srcset)
      const largestSrc = srcsetParts[srcsetParts.length - 1]?.split(' ')[0]
      if (largestSrc && !isRejectedByGate(resolveUrl(largestSrc))) {
        console.log('[scrape] Found srcset image:', largestSrc)
        return { url: resolveUrl(largestSrc), source: 'scraped' }
      }
    }

    console.log('[scrape] No suitable image found for:', url)

  } catch (e) {
    console.error('[scrape] Error:', e)
  }

  return null
}

// Patterns that indicate a logo/icon rather than product image
const LOGO_PATTERNS = [
  /logo/i, /icon/i, /favicon/i, /brand/i, /avatar/i,
  /placeholder/i, /default/i, /blank/i, /spacer/i,
  /pixel/i, /1x1/i, /transparent/i, /sprite/i,
  /tracking/i, /beacon/i, /badge/i, /button/i,
  /banner-ad/i, /ad-banner/i, /widget-icon/i
]

// Known CDN placeholder URL patterns
const PLACEHOLDER_URL_PATTERNS = [
  /no-image/i, /noimage/i, /no_image/i,
  /missing/i, /not-found/i, /not_found/i,
  /fallback/i,
  /placeholder\.(jpg|png|gif|svg|webp)/i,
  /default\.(jpg|png|gif|svg|webp)/i,
  /blank\.(jpg|png|gif|svg|webp)/i
]

function isLikelyLogo(url: string): boolean {
  return LOGO_PATTERNS.some(p => p.test(url))
}

function isPlaceholderUrl(url: string): boolean {
  return PLACEHOLDER_URL_PATTERNS.some(p => p.test(url))
}

/**
 * Combined URL-level rejection: logo patterns + placeholder patterns + visual standards gate.
 * Runs before any network requests.
 */
function isRejectedByGate(url: string): boolean {
  if (isLikelyLogo(url)) return true
  if (isPlaceholderUrl(url)) return true
  const gateCheck = checkGateUrlPatterns(url)
  if (!gateCheck.pass) {
    console.log('[gate] URL rejected by visual standards:', gateCheck.reason)
    return true
  }
  return false
}

// ========================================
// Tier 2: Server-Side Image Validation
// ========================================

// Known-good image sources that bypass Tier 2 checks
const KNOWN_GOOD_SOURCES = [
  /img\.youtube\.com\/vi\//,
  /i\.vimeocdn\.com\//,
  /opengraph\.githubassets\.com\//,
  /i\.scdn\.co\//,
  /mosaic\.scdn\.co\//,
  /image\.tmdb\.org\//,
  /m\.media-amazon\.com\//,
  /images-na\.ssl-images-amazon\.com\//,
  /covers\.openlibrary\.org\//
]

// Card context minimum dimensions
const CARD_THRESHOLDS: Record<string, { minWidth: number, minHeight: number, maxAspect: number }> = {
  grid:   { minWidth: 300, minHeight: 200, maxAspect: 3 },
  hero:   { minWidth: 600, minHeight: 400, maxAspect: 2.5 },
  thumb:  { minWidth: 100, minHeight: 100, maxAspect: 2 },
  widget: { minWidth: 200, minHeight: 200, maxAspect: 2 }
}

// Valid image content types
const VALID_IMAGE_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif', 'image/svg+xml'
]

interface Tier2Result {
  pass: boolean
  reason?: string
  scores: {
    visual_quality: number
    distinctiveness: number
  }
  checks: Array<{ check: string, pass: boolean, detail?: string }>
  dimensions?: { width: number, height: number }
  fileSize?: number
  contentType?: string
}

/**
 * Tier 2 server-side image validation.
 * Uses HEAD request + optional partial download to check dimensions, format, and file size.
 */
async function validateImageTier2(imageUrl: string, cardContext: string = 'grid'): Promise<Tier2Result> {
  const checks: Array<{ check: string, pass: boolean, detail?: string }> = []
  let visualQuality = 1.0
  let distinctiveness = 1.0
  let dimensions: { width: number, height: number } | undefined
  let fileSize: number | undefined
  let contentType: string | undefined

  // Known-good source bypass
  if (KNOWN_GOOD_SOURCES.some(p => p.test(imageUrl))) {
    checks.push({ check: 'known_good_source', pass: true, detail: 'trusted source' })
    return {
      pass: true,
      scores: { visual_quality: 0.9, distinctiveness: 1.0 },
      checks,
      dimensions: undefined,
      fileSize: undefined,
      contentType: undefined
    }
  }

  // Placeholder URL check
  if (isPlaceholderUrl(imageUrl)) {
    return {
      pass: false,
      reason: 'placeholder_url',
      scores: { visual_quality: 0, distinctiveness: 0 },
      checks: [{ check: 'placeholder_url', pass: false }]
    }
  }

  // Visual standards gate — URL pattern check (ad networks, stock watermarks, data URIs)
  const gateUrlCheck = checkGateUrlPatterns(imageUrl)
  if (!gateUrlCheck.pass) {
    checks.push({ check: 'visual_gate_url', pass: false, detail: gateUrlCheck.reason })
    return {
      pass: false,
      reason: 'visual_gate_url_rejected',
      scores: { visual_quality: 0, distinctiveness: 0 },
      checks
    }
  }
  checks.push({ check: 'visual_gate_url', pass: true })

  try {
    // HEAD request to get metadata without downloading full image
    const headResponse = await fetch(imageUrl, {
      method: 'HEAD',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ctrl.rodeo image validator)',
        'Accept': 'image/*'
      }
    })

    // Check 1: Image loads (HTTP 200)
    if (!headResponse.ok) {
      checks.push({ check: 'http_status', pass: false, detail: `HTTP ${headResponse.status}` })
      return {
        pass: false,
        reason: 'http_error',
        scores: { visual_quality: 0, distinctiveness: 0 },
        checks
      }
    }
    checks.push({ check: 'http_status', pass: true })

    // Check 2: Content-Type is an image
    contentType = headResponse.headers.get('content-type')?.split(';')[0]?.trim() || ''
    const isValidType = VALID_IMAGE_TYPES.some(t => contentType!.startsWith(t))
    checks.push({ check: 'content_type', pass: isValidType, detail: contentType })
    if (!isValidType) {
      return {
        pass: false,
        reason: 'not_image',
        scores: { visual_quality: 0, distinctiveness: 0 },
        checks,
        contentType
      }
    }

    // Check 3: File size (from Content-Length header)
    const contentLength = headResponse.headers.get('content-length')
    if (contentLength) {
      fileSize = parseInt(contentLength, 10)

      // Too small — likely placeholder/pixel
      if (fileSize < 5000) { // 5KB
        visualQuality = Math.min(visualQuality, 0.1)
        distinctiveness = Math.min(distinctiveness, 0.1)
        checks.push({ check: 'file_size', pass: false, detail: `${fileSize} bytes (< 5KB minimum)` })
      }
      // Very small — suspicious but not definitive
      else if (fileSize < 15000) { // 15KB
        visualQuality = Math.min(visualQuality, 0.5)
        checks.push({ check: 'file_size', pass: true, detail: `${fileSize} bytes (small but acceptable)` })
      } else {
        checks.push({ check: 'file_size', pass: true, detail: `${fileSize} bytes` })
      }
    } else {
      checks.push({ check: 'file_size', pass: true, detail: 'no Content-Length header' })
    }

    // Check 4: Redirect detection — if final URL differs significantly, might be error page
    const finalUrl = headResponse.url
    if (finalUrl && finalUrl !== imageUrl) {
      const finalLower = finalUrl.toLowerCase()
      if (finalLower.includes('error') || finalLower.includes('404') || finalLower.includes('not-found')) {
        checks.push({ check: 'redirect_check', pass: false, detail: `redirected to error page: ${finalUrl}` })
        return {
          pass: false,
          reason: 'redirect_to_error',
          scores: { visual_quality: 0, distinctiveness: 0 },
          checks,
          contentType,
          fileSize
        }
      }
      checks.push({ check: 'redirect_check', pass: true, detail: `redirected to ${finalUrl}` })
    }

    // Check 5: Try to extract dimensions by partial download (first 32KB for JPEG/PNG headers)
    try {
      const partialResponse = await fetch(imageUrl, {
        headers: {
          'Range': 'bytes=0-32768',
          'User-Agent': 'Mozilla/5.0 (compatible; ctrl.rodeo image validator)',
          'Accept': 'image/*'
        }
      })

      if (partialResponse.ok || partialResponse.status === 206) {
        const buffer = await partialResponse.arrayBuffer()
        const bytes = new Uint8Array(buffer)
        dimensions = extractDimensions(bytes, contentType!)

        if (dimensions) {
          // Visual standards gate — technical checks (min resolution, aspect ratio, file size)
          const gateTechCheck = checkGateTechnical(dimensions, fileSize || null)
          if (!gateTechCheck.pass) {
            checks.push({ check: 'visual_gate_technical', pass: false, detail: gateTechCheck.reason })
            return {
              pass: false,
              reason: 'visual_gate_technical_rejected',
              scores: { visual_quality: 0, distinctiveness: 0 },
              checks,
              dimensions,
              fileSize,
              contentType
            }
          }
          checks.push({ check: 'visual_gate_technical', pass: true, detail: `${dimensions.width}x${dimensions.height}` })

          const thresholds = CARD_THRESHOLDS[cardContext] || CARD_THRESHOLDS.grid
          const aspect = dimensions.width / dimensions.height

          // Card-context-specific resolution check (stricter than gate for larger display contexts)
          if (dimensions.width < 50 || dimensions.height < 50) {
            visualQuality = 0
            checks.push({ check: 'dimensions', pass: false, detail: `${dimensions.width}x${dimensions.height} (below absolute minimum 50px)` })
          } else if (dimensions.width < thresholds.minWidth || dimensions.height < thresholds.minHeight) {
            visualQuality = Math.min(visualQuality, 0.4)
            checks.push({ check: 'dimensions', pass: false, detail: `${dimensions.width}x${dimensions.height} (below ${cardContext} minimum ${thresholds.minWidth}x${thresholds.minHeight})` })
          } else {
            checks.push({ check: 'dimensions', pass: true, detail: `${dimensions.width}x${dimensions.height}` })
          }

          // Aspect ratio check
          if (aspect > thresholds.maxAspect || aspect < (1 / thresholds.maxAspect)) {
            visualQuality = Math.min(visualQuality, 0.3)
            checks.push({ check: 'aspect_ratio', pass: false, detail: `${aspect.toFixed(2)} (outside ${thresholds.maxAspect}:1 limit)` })
          } else {
            checks.push({ check: 'aspect_ratio', pass: true, detail: `${aspect.toFixed(2)}` })
          }
        } else {
          checks.push({ check: 'dimensions', pass: true, detail: 'could not extract from headers' })
        }
      }
    } catch (e) {
      // Partial download failed — not critical, skip dimension checks
      checks.push({ check: 'dimensions', pass: true, detail: 'partial download failed, skipping' })
    }

  } catch (e) {
    checks.push({ check: 'network', pass: false, detail: (e as Error).message })
    return {
      pass: false,
      reason: 'network_error',
      scores: { visual_quality: 0, distinctiveness: 0 },
      checks
    }
  }

  const pass = visualQuality > 0 && distinctiveness > 0

  return {
    pass,
    reason: !pass ? 'below_quality_threshold' : undefined,
    scores: { visual_quality: visualQuality, distinctiveness },
    checks,
    dimensions,
    fileSize,
    contentType
  }
}

/**
 * Extract image dimensions from the first bytes of an image file.
 * Supports JPEG (SOF markers) and PNG (IHDR chunk).
 */
function extractDimensions(bytes: Uint8Array, contentType: string): { width: number, height: number } | null {
  // PNG: width/height at bytes 16-23 in IHDR
  if (contentType.includes('png') && bytes.length >= 24) {
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
      const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]
      const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]
      if (width > 0 && height > 0 && width < 100000 && height < 100000) {
        return { width, height }
      }
    }
  }

  // JPEG: scan for SOF0 (0xFFC0) or SOF2 (0xFFC2) marker
  if (contentType.includes('jpeg') || contentType.includes('jpg')) {
    for (let i = 0; i < bytes.length - 9; i++) {
      if (bytes[i] === 0xFF && (bytes[i + 1] === 0xC0 || bytes[i + 1] === 0xC2)) {
        const height = (bytes[i + 5] << 8) | bytes[i + 6]
        const width = (bytes[i + 7] << 8) | bytes[i + 8]
        if (width > 0 && height > 0 && width < 100000 && height < 100000) {
          return { width, height }
        }
      }
    }
  }

  return null
}

// Search for image using Unsplash API
// searchImage removed — Unsplash search strategy deprecated (no API key, generic results)

// Get high-res favicon
async function resolveFavicon(url: string): Promise<{ url: string, source: 'favicon' } | null> {
  try {
    const domain = new URL(url).hostname
    // Use Google's favicon service for high-res icons
    const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=128`

    // Verify it exists
    const response = await fetch(faviconUrl, { method: 'HEAD' })
    if (response.ok) {
      return { url: faviconUrl, source: 'favicon' }
    }
  } catch (e) {
    console.error('[favicon] Error:', e)
  }

  return null
}

// Search for image using SerpApi Google Images
async function searchImageSerpApi(
  url: string,
  title: string,
  description: string
): Promise<{ url: string, source: 'scraped' } | null> {
  const serpApiKey = Deno.env.get('SERP_API_KEY')
  if (!serpApiKey) {
    console.log('[search] SERP_API_KEY not configured, skipping')
    return null
  }

  try {
    // Build search query: prefer title, fall back to domain
    const query = title && title.length > 3
      ? title
      : new URL(url).hostname.replace('www.', '')

    console.log('[search] SerpApi Google Images query:', query)

    const params = new URLSearchParams({
      api_key: serpApiKey,
      engine: 'google_images',
      q: query,
      num: '5'
    })

    const response = await fetch(`https://serpapi.com/search?${params}`)
    if (!response.ok) {
      console.log('[search] SerpApi returned', response.status)
      return null
    }

    const data = await response.json()
    const results = data.images_results || []

    if (results.length === 0) {
      console.log('[search] No image results for:', query)
      return null
    }

    // Find first result with a full-res original URL
    for (const result of results) {
      const imageUrl = result.original
      if (imageUrl && imageUrl.startsWith('http')) {
        console.log('[search] Found image via SerpApi:', imageUrl)
        return { url: imageUrl, source: 'scraped' }
      }
    }

    console.log('[search] No usable image URLs in results')
    return null
  } catch (e) {
    console.error('[search] SerpApi error:', e)
    return null
  }
}

// ========================================
// Tier 3: AI Vision Quality Gate
// ========================================

// Known-good sources skip AI evaluation entirely
const KNOWN_GOOD_SOURCES_T3 = [
  /img\.youtube\.com\/vi\//,
  /i\.vimeocdn\.com\//,
  /opengraph\.githubassets\.com\//,
  /i\.scdn\.co\//,
  /mosaic\.scdn\.co\//,
  /image\.tmdb\.org\//,
  /m\.media-amazon\.com\//,
  /images-na\.ssl-images-amazon\.com\//,
  /covers\.openlibrary\.org\//
]

const TIER3_WEIGHTS = {
  accuracy: 0.35,
  visual_quality: 0.25,
  aesthetic_fit: 0.20,
  distinctiveness: 0.15,
  safety: 0.05
}

function computeTier3Composite(scores: Record<string, number>): number {
  if (scores.safety === 0) return 0
  return (
    (scores.accuracy || 0) * TIER3_WEIGHTS.accuracy +
    (scores.visual_quality || 0) * TIER3_WEIGHTS.visual_quality +
    (scores.aesthetic_fit || 0) * TIER3_WEIGHTS.aesthetic_fit +
    (scores.distinctiveness || 0) * TIER3_WEIGHTS.distinctiveness +
    (scores.safety || 1) * TIER3_WEIGHTS.safety
  )
}

function getTier3Label(composite: number): string {
  if (composite >= 0.85) return 'excellent'
  if (composite >= 0.65) return 'good'
  if (composite >= 0.40) return 'marginal'
  if (composite >= 0.15) return 'poor'
  return 'rejected'
}

interface Tier3Result {
  scores: Record<string, any>
  tier: string
  safety_tier: string
  reason?: string
}

async function evaluateImageQuality(
  imageUrl: string,
  title: string,
  category: string,
  contentType: string
): Promise<Tier3Result | null> {
  // Known-good sources get automatic high scores
  if (KNOWN_GOOD_SOURCES_T3.some(p => p.test(imageUrl))) {
    console.log('[tier3] Known-good source, bypassing AI:', imageUrl)
    const scores = {
      accuracy: 0.9, visual_quality: 0.9, aesthetic_fit: 0.8,
      distinctiveness: 1.0, safety: 1.0
    }
    const composite = computeTier3Composite(scores)
    return {
      scores: { ...scores, composite: Math.round(composite * 100) / 100, tier: getTier3Label(composite) },
      tier: getTier3Label(composite),
      safety_tier: 'safe'
    }
  }

  // Budget check — share the daily budget with validate-image
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  const today = new Date().toISOString().split('T')[0]
  try {
    const { data } = await supabase
      .from('image_validation_cache')
      .select('scores')
      .gte('evaluated_at', `${today}T00:00:00Z`)
    const todayCount = data?.length || 0
    const estimatedCostCents = todayCount * 0.1
    if (estimatedCostCents >= 50) { // $0.50/day budget
      console.log('[tier3] Daily budget exhausted, passing through')
      return null // null = pass through (don't block)
    }
  } catch (e) {
    console.log('[tier3] Budget check failed, passing through')
    return null
  }

  // Check cache first
  const urlHash = await hashImageUrl(imageUrl)
  try {
    const { data: cached } = await supabase
      .from('image_validation_cache')
      .select('*')
      .eq('image_url_hash', urlHash)
      .single()
    if (cached && cached.scores) {
      console.log('[tier3] Cache hit:', imageUrl)
      return {
        scores: cached.scores,
        tier: cached.scores.tier || 'unknown',
        safety_tier: cached.scores.safety_tier || 'safe'
      }
    }
  } catch {
    // No cache entry, continue to AI evaluation
  }

  // AI Vision evaluation
  const prompt = `Evaluate this image for a pin titled "${title || 'Unknown'}" (category: ${category || 'unknown'}, type: ${contentType || 'unknown'}).

Score each dimension from 0.0 to 1.0:

1. accuracy: Does this image depict "${title || 'the content'}"? 1.0 = clearly shows the specific item/content. 0.0 = completely unrelated.

2. aesthetic_fit: Is the image visually clean, high-contrast, and minimal? 1.0 = editorial quality, no text overlays or watermarks. 0.0 = heavy watermarks, all-text image, extreme visual clutter.

3. distinctiveness: Is this a real, content-specific image (not a logo, favicon, stock placeholder, or generic site asset)? 1.0 = unique content image. 0.0 = logo/placeholder.

4. safety: Content safety classification. Use one of:
   - "safe": General content, no concerns
   - "mature": Contains nudity, graphic language, drug references, or mature themes (ALLOWED — do not block)
   - "blocked": Pornographic content (explicit sexual acts), child exploitation, or extreme gore (BLOCKED)
   IMPORTANT: Artistic nudity, fashion photography, swimwear, and lingerie are "mature" NOT "blocked". Only classify as "blocked" for exploitative, illegal, or explicitly pornographic content.

Respond with ONLY this JSON, no other text:
{"accuracy": 0.0, "aesthetic_fit": 0.0, "distinctiveness": 0.0, "safety": "safe"}`

  // Try Claude first, then OpenAI
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
  const openaiKey = Deno.env.get('OPENAI_API_KEY')

  let aiResult: { scores: Record<string, number>, safety_tier: string, model: string, tokens_used: number } | null = null

  if (anthropicKey) {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 300,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'url', url: imageUrl } },
              { type: 'text', text: prompt }
            ]
          }]
        })
      })

      if (response.ok) {
        const data = await response.json()
        const text = data.content?.[0]?.text || ''
        const tokensUsed = (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0)
        aiResult = parseTier3Response(text, 'claude-sonnet-4-5-20250929', tokensUsed)
      } else {
        console.error('[tier3] Claude API error:', response.status)
      }
    } catch (e) {
      console.error('[tier3] Claude evaluation error:', e)
    }
  }

  if (!aiResult && openaiKey) {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          max_tokens: 300,
          messages: [{
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: imageUrl, detail: 'low' } },
              { type: 'text', text: prompt }
            ]
          }]
        })
      })

      if (response.ok) {
        const data = await response.json()
        const text = data.choices?.[0]?.message?.content || ''
        const tokensUsed = (data.usage?.prompt_tokens || 0) + (data.usage?.completion_tokens || 0)
        aiResult = parseTier3Response(text, 'gpt-4o-mini', tokensUsed)
      } else {
        console.error('[tier3] OpenAI API error:', response.status)
      }
    } catch (e) {
      console.error('[tier3] OpenAI evaluation error:', e)
    }
  }

  if (!aiResult) {
    console.log('[tier3] No AI result available, passing through')
    return null
  }

  // Compute composite and tier
  const composite = computeTier3Composite(aiResult.scores)
  const tier = getTier3Label(composite)
  const fullScores = {
    ...aiResult.scores,
    composite: Math.round(composite * 100) / 100,
    tier,
    safety_tier: aiResult.safety_tier,
    evaluated_at: new Date().toISOString(),
    evaluation_method: 'tier3_ai_vision',
    evaluation_model: aiResult.model
  }

  // Cache the result
  try {
    await supabase
      .from('image_validation_cache')
      .upsert({
        image_url_hash: urlHash,
        image_url: imageUrl,
        scores: fullScores,
        evaluated_at: new Date().toISOString(),
        ttl_days: 30,
        source_domain: new URL(imageUrl).hostname.replace('www.', ''),
        content_type: contentType || null
      })
  } catch (e) {
    console.error('[tier3] Cache write error:', e)
  }

  console.log('[tier3] Evaluated:', imageUrl, '→', tier, `(${composite.toFixed(2)})`)

  return {
    scores: fullScores,
    tier,
    safety_tier: aiResult.safety_tier,
    reason: tier === 'rejected' || tier === 'poor'
      ? `${tier}: accuracy=${aiResult.scores.accuracy}, aesthetic_fit=${aiResult.scores.aesthetic_fit}, distinctiveness=${aiResult.scores.distinctiveness}`
      : undefined
  }
}

function parseTier3Response(text: string, model: string, tokensUsed: number) {
  try {
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return null

    const parsed = JSON.parse(match[0])
    const safetyTier = ['safe', 'mature', 'blocked'].includes(parsed.safety) ? parsed.safety : 'safe'
    const safetyScore = safetyTier === 'blocked' ? 0 : 1
    const clamp = (v: number) => Math.max(0, Math.min(1, Number(v) || 0))

    return {
      scores: {
        accuracy: clamp(parsed.accuracy),
        visual_quality: 0.9, // Tier 2 already validated
        aesthetic_fit: clamp(parsed.aesthetic_fit),
        distinctiveness: clamp(parsed.distinctiveness),
        safety: safetyScore
      },
      safety_tier: safetyTier,
      model,
      tokens_used: tokensUsed
    }
  } catch {
    return null
  }
}

async function hashImageUrl(url: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(url.toLowerCase().trim())
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}
