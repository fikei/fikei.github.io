// Visual Standards for ctrl.rodeo
// Three-layer image quality and aesthetic system:
//   Layer 0: Product Gate — universal pass/fail for any image on the platform
//   Layer 1: Content Type — expectations per content type (product, article, video, etc.)
//   Layer 2: Category Aesthetic — mood/palette per board category (home, wear, listen, etc.)
//
// Usage:
//   - enrich-link: Gate rejects bad images, type + category scores rank candidates
//   - generate-widget: Category context shapes AI prompt tone and recommendations

// =============================================================================
// LAYER 0: PRODUCT GATE — Universal quality floor
// =============================================================================
// Every image on ctrl.rodeo must pass this gate. Category-agnostic, content-type-agnostic.
// This is the "would a creative person save this to their moodboard?" test.

export interface ProductGate {
  reject: {
    min_width: number
    min_height: number
    max_aspect_ratio: number
    min_file_bytes: number
    blocked_url_patterns: RegExp[]
    blocked_compositions: string[]
    max_text_coverage: number
    min_visual_interest: number
  }
  prefer: {
    professional_lighting: boolean
    clear_subject: boolean
    high_contrast: boolean
    human_curated_feel: boolean
  }
}

export const PRODUCT_GATE: ProductGate = {
  reject: {
    // Minimum resolution — anything smaller is a thumbnail or icon
    min_width: 400,
    min_height: 300,

    // Extreme aspect ratios — banner ads, pixel trackers, thin strips
    max_aspect_ratio: 3.5,

    // Below 5KB is almost certainly a placeholder, icon, or tracking pixel
    min_file_bytes: 5_000,

    // URL patterns that indicate non-content images
    blocked_url_patterns: [
      // Stock photo watermarks & ID patterns
      /shutterstock/i,
      /stock-photo-id/i,
      /gettyimages/i,
      /istockphoto.*watermark/i,
      /depositphotos/i,

      // Ad networks and tracking
      /doubleclick\.net/i,
      /googlesyndication/i,
      /facebook\.com\/tr/i,
      /pixel\.quantserve/i,
      /analytics/i,
      /ad-banner/i,
      /banner-ad/i,

      // Social share / generic OG fallbacks
      /default-share/i,
      /og-default/i,
      /social-share-default/i,
      /meta-image-default/i,

      // Emoji / icon CDNs
      /twemoji/i,
      /emoji/i,

      // Data URIs (inline SVG placeholders)
      /^data:image\/svg/i,
    ],

    // Compositions that don't belong on a curation platform
    // (evaluated by Claude Vision when scoring)
    blocked_compositions: [
      'screenshot-of-desktop-ui',        // someone's browser/app chrome visible
      'screenshot-of-mobile-ui',         // phone UI elements, status bars
      'text-only-no-imagery',            // just words on a solid background
      'meme-with-impact-font',           // top-text / bottom-text meme format
      'collage-of-unrelated-logos',       // brand logo grids, sponsor walls
      'qr-code',                         // QR codes as primary image
      'presentation-slide',              // PowerPoint/Keynote slides
      'spreadsheet-or-table',            // data tables, Excel screenshots
      'cookie-consent-or-popup',         // modal/popup captured in screenshot
      'stock-photo-handshake',           // the universal stock photo sin
    ],

    // If >40% of the image area is rendered text, it's a graphic, not a photo
    max_text_coverage: 0.40,

    // Solid colors, simple gradients, or near-blank images
    // 0.0 = no visual information, 1.0 = maximum complexity
    min_visual_interest: 0.25,
  },

  prefer: {
    // Penalize phone flash, overhead fluorescent, harsh direct flash
    professional_lighting: true,

    // Penalize images where you can't tell what the subject is
    clear_subject: true,

    // Penalize washed-out, low-contrast, hazy images
    high_contrast: true,

    // The Cosmos test: would a creative intentionally save this?
    // Penalizes: generic stock, clip art, auto-generated social cards
    human_curated_feel: true,
  },
}


// =============================================================================
// LAYER 1: CONTENT TYPE STANDARDS — What should this type of image depict?
// =============================================================================
// These define expectations for what a "good" image looks like given its content type.
// A product image should show the product. A video image should show a scene.
// Scores 0.0–1.0, used to rank candidates (not reject).

export interface ContentTypeStandard {
  content_type: string
  expected_subject: string
  good_framing: string[]
  good_backgrounds: string[]
  anti_patterns: string[]
  aspect_preference: 'landscape' | 'square' | 'portrait' | 'any'
}

export const CONTENT_TYPE_STANDARDS: Record<string, ContentTypeStandard> = {
  product: {
    content_type: 'product',
    expected_subject: 'the product itself, clearly visible and identifiable',
    good_framing: [
      'centered-product',               // product as hero, clean framing
      'flat-lay',                        // overhead product arrangement
      'on-model',                        // clothing/accessories worn by a person
      'in-context',                      // product in its natural environment
      'detail-close-up',                 // texture, material, craftsmanship
    ],
    good_backgrounds: [
      'clean-solid',                     // white, off-white, or neutral solid
      'contextual-environment',          // product in a real setting
      'gradient-subtle',                 // gentle gradient, not distracting
    ],
    anti_patterns: [
      'lifestyle-scene-product-tiny',    // product is <10% of the image
      'multiple-unrelated-products',     // collage of different items
      'heavy-text-overlay-on-product',   // price tags, sale banners covering product
      'low-res-upscaled',               // pixelated enlargement
      'cad-render-wireframe',           // 3D model, not final product
    ],
    aspect_preference: 'square',
  },

  article: {
    content_type: 'article',
    expected_subject: 'a scene, portrait, or concept that represents the article topic',
    good_framing: [
      'hero-landscape',                  // wide cinematic editorial image
      'environmental-portrait',          // person in context
      'establishing-shot',               // scene-setting wide angle
      'documentary',                     // candid, real-world moment
      'conceptual-still-life',           // abstract/artistic representation
    ],
    good_backgrounds: [
      'any',                             // articles have the widest latitude
    ],
    anti_patterns: [
      'generic-stock-business',          // handshake, laptop-person, meeting room
      'generic-stock-nature',            // random sunset with no article connection
      'author-headshot-only',            // tiny avatar used as hero
      'social-card-auto-generated',      // og:image that's just text + logo
      'chart-or-graph-only',             // data viz as hero (fine as inline, not hero)
    ],
    aspect_preference: 'landscape',
  },

  video: {
    content_type: 'video',
    expected_subject: 'a compelling frame from the video — a scene, face, or key moment',
    good_framing: [
      'cinematic-still',                 // movie-quality frame
      'key-moment',                      // dramatic or representative scene
      'artist-performance',              // live performance, music video frame
      'title-card-designed',             // intentionally designed title screen
    ],
    good_backgrounds: [
      'scene-natural',                   // whatever the video's setting is
      'designed-graphic',                // motion graphics, animation frame
    ],
    anti_patterns: [
      'youtube-thumbnail-clickbait',     // red arrows, shocked faces, ALL CAPS text
      'black-bars-letterboxed',          // frame with large black bars
      'buffering-or-player-ui',          // play button, progress bar visible
      'auto-generated-mid-frame',        // random mid-video frame, person mid-blink
    ],
    aspect_preference: 'landscape',
  },

  music: {
    content_type: 'music',
    expected_subject: 'album artwork, artist portrait, or venue/atmosphere shot',
    good_framing: [
      'album-cover-art',                 // designed square album artwork
      'artist-portrait',                 // musician, band, DJ portrait
      'venue-atmosphere',                // club, stage, concert setting
      'equipment-detail',                // turntables, instruments, studio
      'designed-graphic',                // label art, event flyer, visualizer
    ],
    good_backgrounds: [
      'designed-artwork',                // album art is its own world
      'atmospheric-dark',                // moody club/venue lighting
      'studio-controlled',               // professional portrait backdrop
    ],
    anti_patterns: [
      'waveform-only',                   // just an audio waveform image
      'generic-music-note-icon',         // clip art music symbols
      'spotify-embed-screenshot',        // screenshot of the player UI
      'podcast-talking-heads-grid',      // Zoom-style grid of faces
    ],
    aspect_preference: 'square',
  },

  repository: {
    content_type: 'repository',
    expected_subject: 'project logo, architectural diagram, or demo screenshot',
    good_framing: [
      'project-logo',                    // designed project identity
      'architecture-diagram',            // system design visualization
      'demo-screenshot',                 // the tool/app in action
      'social-card-designed',            // GitHub-style generated OG with branding
    ],
    good_backgrounds: [
      'clean-solid',
      'dark-theme',                      // dev tools tend dark
    ],
    anti_patterns: [
      'raw-code-screenshot',             // just lines of code, no context
      'terminal-output',                 // raw CLI output
      'github-default-og',              // the generic gray GitHub card
    ],
    aspect_preference: 'landscape',
  },

  social: {
    content_type: 'social',
    expected_subject: 'the person, their work, or the content they create',
    good_framing: [
      'portrait-headshot',               // clear, intentional portrait
      'portfolio-piece',                 // example of their work
      'candid-creative',                 // in-studio, at work, performing
    ],
    good_backgrounds: [
      'any',
    ],
    anti_patterns: [
      'default-avatar',                  // platform default profile picture
      'low-res-selfie',                  // blurry phone selfie
      'social-platform-ui-visible',      // screenshot of their profile page
    ],
    aspect_preference: 'square',
  },

  document: {
    content_type: 'document',
    expected_subject: 'document cover, key diagram, or representative visual',
    good_framing: [
      'cover-page',                      // designed document cover
      'key-figure',                      // the most important diagram/chart
      'infographic-section',             // a self-contained visual section
    ],
    good_backgrounds: [
      'clean-solid',
    ],
    anti_patterns: [
      'full-page-of-text',              // just a page of paragraphs
      'table-of-contents',              // structural page, not visual
    ],
    aspect_preference: 'portrait',
  },

  tool: {
    content_type: 'tool',
    expected_subject: 'the tool interface, key feature, or product identity',
    good_framing: [
      'app-screenshot-clean',            // the tool in use, no browser chrome
      'feature-highlight',               // a specific capability showcased
      'product-logo-designed',           // intentional brand mark
    ],
    good_backgrounds: [
      'app-canvas',                      // the tool's own UI
      'clean-solid',
      'dark-theme',
    ],
    anti_patterns: [
      'landing-page-full-screenshot',    // entire marketing page as image
      'pricing-table',                   // comparison grid
      'testimonial-section',             // customer quotes
    ],
    aspect_preference: 'landscape',
  },

  unknown: {
    content_type: 'unknown',
    expected_subject: 'any clear, well-composed image',
    good_framing: [
      'any-intentional',                 // anything that looks deliberately composed
    ],
    good_backgrounds: [
      'any',
    ],
    anti_patterns: [
      'auto-generated-placeholder',      // CMS default images
    ],
    aspect_preference: 'any',
  },
}


// =============================================================================
// LAYER 2: CATEGORY AESTHETICS — What should this board feel like?
// =============================================================================
// Derived from Cosmos discover pages + curatorial instinct.
// These define the visual tone of a board category.
// Scores 0.0–1.0, used to rank candidates alongside content type score.

export interface CategoryAesthetic {
  category: string
  palette: string[]             // dominant hex colors for this category's mood
  mood: string                  // one-line vibe description
  textures: string[]            // materials and surfaces common in this category
  lighting: string              // lighting quality that defines the category
  compositions: string[]        // typical image compositions
  anti_patterns: string[]       // things that feel wrong for this category
}

export const CATEGORY_AESTHETICS: Record<string, CategoryAesthetic> = {
  home: {
    category: 'home',
    palette: ['#E8DDD3', '#2C2C2C', '#8B7355', '#D4C5B2', '#F5F0EB', '#556B5A'],
    mood: 'warm, considered, lived-in — interiors that feel like someone thought about every object',
    textures: ['wood-grain', 'concrete', 'linen', 'ceramic', 'marble', 'brass', 'terracotta', 'rattan'],
    lighting: 'natural-warm — golden hour through windows, soft shadows, no flash',
    compositions: [
      'room-vignette',                   // corner of a room, curated scene
      'object-in-context',               // single piece in its environment
      'architectural-detail',            // staircase, doorway, ceiling
      'flat-lay-arrangement',            // overhead tabletop styling
      'editorial-interior',              // magazine-quality room shot
    ],
    anti_patterns: [
      'real-estate-listing-wide-angle',  // fisheye distortion, everything visible
      'showroom-fluorescent',            // retail floor lighting
      'render-uncanny-valley',           // CGI interior that looks almost real
      'cluttered-lived-in-messy',        // actual mess, not curated "lived-in"
      'catalog-grid-of-products',        // furniture lined up like a store
    ],
  },

  wear: {
    category: 'wear',
    palette: ['#1A1A1A', '#F5F5F5', '#4A4A4A', '#8C7B6B', '#2C3E50', '#C9B99A'],
    mood: 'clean, intentional, effortless — fashion that speaks through simplicity',
    textures: ['denim', 'leather', 'cotton-jersey', 'wool', 'canvas', 'suede', 'mesh', 'nylon'],
    lighting: 'studio-clean or natural-overcast — even, no harsh shadows',
    compositions: [
      'on-model-full',                   // full outfit, head to toe
      'on-model-detail',                 // close-up of fabric, stitching, fit
      'flat-lay-outfit',                 // laid out pieces composing a look
      'product-centered',                // single item, clean background
      'street-style-candid',             // real-world wearing context
    ],
    anti_patterns: [
      'fast-fashion-cluttered',          // busy patterns, neon sale graphics
      'heavily-retouched-skin',          // over-smoothed, uncanny
      'mannequin-only',                  // no person, just a form
      'instagram-filter-heavy',          // oversaturated, fake color grading
      'fit-pic-bathroom-mirror',         // mirror selfie, phone visible
    ],
  },

  watch: {
    category: 'watch',
    palette: ['#0D0D0D', '#1A1A2E', '#E0E0E0', '#C9A96E', '#2D3436', '#FF6B6B'],
    mood: 'cinematic, immersive — every frame could be a poster',
    textures: ['film-grain', 'digital-clean', 'neon-glow', 'lens-flare', 'atmospheric-haze'],
    lighting: 'cinematic — motivated lighting, dramatic contrast, color-graded',
    compositions: [
      'cinematic-wide',                  // 2.35:1 or 16:9 scene composition
      'character-portrait',              // subject with depth, emotion
      'establishing-atmosphere',         // mood-setting landscape or environment
      'key-frame-tension',               // dramatic moment, peak action
      'title-sequence-design',           // designed title treatment
    ],
    anti_patterns: [
      'tv-guide-thumbnail',             // small, text-heavy program listing
      'cam-quality-bootleg',            // low-res, tilted, screen recording
      'react-thumbnail-face',           // YouTuber reaction face overlay
      'spoiler-screenshot',             // key plot point visible
      'generic-streaming-card',         // auto-generated "watch now" card
    ],
  },

  listen: {
    category: 'listen',
    palette: ['#0D0D0D', '#1DB954', '#FF5500', '#E8E8E8', '#6B4C9A', '#FF2D55'],
    mood: 'atmospheric, designed — sound has a visual identity',
    textures: ['vinyl-texture', 'waveform', 'club-lighting', 'speaker-mesh', 'print-halftone'],
    lighting: 'moody-atmospheric — club neon, stage spots, studio dim, golden hour sessions',
    compositions: [
      'album-art-square',                // 1:1 designed artwork
      'artist-editorial',                // musician in an editorial/artistic setting
      'live-performance',                // on stage, behind decks, in the booth
      'studio-session',                  // recording, producing, creating
      'venue-atmosphere',                // the space where music lives
    ],
    anti_patterns: [
      'generic-music-note-clip-art',     // stock music symbols
      'podcast-zoom-grid',              // four faces in a video call
      'spotify-player-screenshot',       // screenshot of the app UI
      'low-res-phone-concert-video',     // shaky, blown-out phone footage
      'karaoke-lyric-text',             // scrolling lyrics on solid background
    ],
  },

  use: {
    category: 'use',
    palette: ['#0D0D0D', '#FFFFFF', '#007AFF', '#34C759', '#5856D6', '#64748B'],
    mood: 'precise, functional, refined — tools that feel good to use',
    textures: ['glass-ui', 'metal-hardware', 'matte-plastic', 'screen-glow', 'anodized-aluminum'],
    lighting: 'controlled — studio product lighting or screen-lit environments',
    compositions: [
      'product-hero',                    // single tool/device, clean background
      'app-interface-clean',             // UI screenshot without browser chrome
      'desk-setup',                      // workspace with tools in context
      'feature-detail',                  // close-up on a specific capability
      'in-hand-scale',                   // person holding/using the tool
    ],
    anti_patterns: [
      'cluttered-desk-mess',            // cables everywhere, dirty workspace
      'full-browser-screenshot',         // browser chrome, tabs, bookmarks visible
      'marketing-landing-page',          // full marketing page as image
      'comparison-table-screenshot',     // pricing grids
      'unboxing-cardboard',             // packaging, not the product
    ],
  },

  eat: {
    category: 'eat',
    palette: ['#F5E6D3', '#8B4513', '#2D5016', '#E85D3A', '#FFF8DC', '#C41E3A'],
    mood: 'appetizing, warm, inviting — food that makes you want to be there',
    textures: ['ceramic-plate', 'wood-table', 'linen-napkin', 'copper-pot', 'marble-counter', 'woven-placemat'],
    lighting: 'natural-warm — window light, candle glow, golden hour; never flash',
    compositions: [
      'overhead-flat-lay',               // bird's-eye table spread
      'hero-dish-45-degree',             // single dish at 45° angle, shallow DOF
      'restaurant-interior',             // the space, ambiance, design
      'ingredient-arrangement',          // raw ingredients, styled
      'action-cooking',                  // hands working, steam, motion
    ],
    anti_patterns: [
      'phone-flash-food',               // direct flash, shiny, unflattering
      'fast-food-ad-glossy',            // over-styled, fake-looking studio food
      'menu-screenshot',                // photo of a menu or price list
      'yelp-review-photo',              // low-quality user-generated food photo
      'empty-plate-or-wrapper',         // aftermath, not the food
    ],
  },

  go: {
    category: 'go',
    palette: ['#87CEEB', '#2E4057', '#E8D5B7', '#228B22', '#F4A460', '#FFFFFF'],
    mood: 'aspirational, expansive, atmospheric — places you want to experience',
    textures: ['stone', 'water', 'sand', 'foliage', 'weathered-wood', 'tile-pattern'],
    lighting: 'natural-dramatic — golden hour, blue hour, dappled light through trees',
    compositions: [
      'establishing-wide',               // grand landscape, architecture exterior
      'intimate-detail',                 // door handle, tile pattern, street sign
      'street-level-life',               // city scene with human activity
      'aerial-perspective',              // drone/elevated view of place
      'window-framing',                  // looking through a doorway, arch, window
    ],
    anti_patterns: [
      'google-maps-screenshot',          // map UI, pin markers
      'hotel-booking-site-photo',        // generic hotel room, white bedding
      'tourist-selfie-landmark',         // person blocking the actual place
      'travel-blog-text-overlay',        // "TOP 10 PLACES" over a photo
      'airport-or-transit',              // departure boards, airplane windows
    ],
  },

  follow: {
    category: 'follow',
    palette: ['#1A1A1A', '#FFFFFF', '#E8E8E8', '#4A90D9', '#333333', '#F0E68C'],
    mood: 'personal, authentic, distinctive — people worth paying attention to',
    textures: ['skin', 'fabric', 'studio-backdrop', 'natural-environment', 'creative-workspace'],
    lighting: 'portrait-quality — soft key light, natural fill, intentional',
    compositions: [
      'environmental-portrait',          // person in their world/workspace
      'headshot-editorial',              // intentional portrait, not a snapshot
      'at-work-candid',                  // creating, performing, building
      'portfolio-showcase',              // their best work as the image
      'event-speaking',                  // on stage, at a podium, presenting
    ],
    anti_patterns: [
      'default-social-avatar',           // platform default profile picture
      'linkedin-headshot-generic',       // corporate background, forced smile
      'group-photo-cant-tell-who',       // too many people, no clear subject
      'blurry-party-photo',             // dark, motion blur, red eye
      'logo-instead-of-person',         // brand logo where a face should be
    ],
  },

  read: {
    category: 'read',
    palette: ['#F5F1EB', '#2C2C2C', '#8B0000', '#1B4332', '#D4A574', '#4A4A4A'],
    mood: 'thoughtful, editorial, substantial — images that make you want to slow down',
    textures: ['paper', 'ink', 'book-cloth', 'library-wood', 'typeface-detail', 'print-grain'],
    lighting: 'natural-soft — reading light, desk lamp, overcast window',
    compositions: [
      'editorial-hero',                  // magazine-quality article header
      'author-portrait-editorial',       // writer in a thoughtful setting
      'book-cover-designed',             // published cover design
      'documentary-scene',               // real-world scene the article covers
      'data-visualization-designed',     // well-designed chart or infographic
    ],
    anti_patterns: [
      'stock-photo-person-reading',      // generic "person with book" stock
      'wall-of-text-screenshot',         // screenshot of article text
      'clickbait-headline-image',        // shocking/misleading imagery
      'auto-generated-blog-og',          // template OG image with just title text
      'generic-library-books',           // stock photo of book spines
    ],
  },
}


// =============================================================================
// PROMPT BUILDERS — Inject visual standards into AI prompts
// =============================================================================

/**
 * Build the product gate description for an AI scoring prompt.
 * Used when asking Claude Vision to evaluate an image.
 */
export function buildGatePrompt(): string {
  const gate = PRODUCT_GATE
  return `
IMAGE QUALITY GATE (pass/fail):
Reject the image if ANY of these are true:
- Image is primarily a screenshot of a UI (desktop app, mobile app, browser)
- Image is mostly text with little or no imagery
- Image is a meme format (impact font, top/bottom text)
- Image is a collage of unrelated logos or brand marks
- Image is a QR code, presentation slide, or spreadsheet
- Image is a generic stock photo (business handshake, empty meeting room)
- Image has a stock photo watermark (Shutterstock, Getty, etc.)
- Image is a cookie consent popup or error page
- More than ${Math.round(gate.reject.max_text_coverage * 100)}% of the image area is rendered text
- Image has essentially no visual content (solid color, simple gradient)

Quality preferences (score higher if true, but don't reject):
- Professional or natural lighting (not phone flash, not fluorescent)
- Clear identifiable subject
- Good contrast and color depth
- Feels intentionally composed — someone would save this to a moodboard`
}

/**
 * Build content type context for an AI prompt.
 * Tells the AI what kind of image to expect/prefer for this content type.
 */
export function buildContentTypePrompt(contentType: string): string {
  const standard = CONTENT_TYPE_STANDARDS[contentType]
  if (!standard) return ''

  return `
CONTENT TYPE CONTEXT ("${standard.content_type}"):
The image should depict: ${standard.expected_subject}
Good framing for this type: ${standard.good_framing.join(', ')}
Avoid: ${standard.anti_patterns.join(', ')}
Preferred aspect ratio: ${standard.aspect_preference}`
}

/**
 * Build category aesthetic context for an AI prompt.
 * Tells the AI what visual mood this board category has.
 */
export function buildCategoryPrompt(category: string): string {
  const aesthetic = CATEGORY_AESTHETICS[category]
  if (!aesthetic) return ''

  return `
BOARD CATEGORY VISUAL CONTEXT ("${aesthetic.category}"):
Mood: ${aesthetic.mood}
Color palette: ${aesthetic.palette.join(', ')}
Common textures/materials: ${aesthetic.textures.join(', ')}
Lighting character: ${aesthetic.lighting}
Strong compositions: ${aesthetic.compositions.join(', ')}
Anti-patterns (penalize): ${aesthetic.anti_patterns.join(', ')}`
}

/**
 * Build a combined scoring prompt for Claude Vision.
 * Used when ranking multiple candidate images for a link.
 */
export function buildImageScoringPrompt(
  contentType: string,
  category: string | null
): string {
  let prompt = `You are an image quality evaluator for a curation platform used by creatives.
Score this image on a 0.0–1.0 scale across three dimensions.

${buildGatePrompt()}

${buildContentTypePrompt(contentType)}
`

  if (category) {
    prompt += buildCategoryPrompt(category)
  }

  prompt += `

Respond with JSON only:
{
  "gate_pass": true/false,
  "gate_reason": "reason if failed, null if passed",
  "content_type_score": 0.0-1.0,
  "category_score": 0.0-1.0,
  "combined_score": 0.0-1.0,
  "notes": "brief explanation"
}`

  return prompt
}

/**
 * Check a URL against the product gate's blocked URL patterns.
 * Fast, synchronous check — no AI needed.
 */
export function checkGateUrlPatterns(imageUrl: string): { pass: boolean; reason?: string } {
  for (const pattern of PRODUCT_GATE.reject.blocked_url_patterns) {
    if (pattern.test(imageUrl)) {
      return { pass: false, reason: `blocked_url_pattern: ${pattern.source}` }
    }
  }
  return { pass: true }
}

/**
 * Check image dimensions and file size against product gate thresholds.
 * Synchronous check using data from HEAD request.
 */
export function checkGateTechnical(
  dimensions: { width: number; height: number } | null,
  fileSize: number | null
): { pass: boolean; reason?: string } {
  const gate = PRODUCT_GATE.reject

  if (fileSize !== null && fileSize < gate.min_file_bytes) {
    return { pass: false, reason: `file_too_small: ${fileSize} bytes < ${gate.min_file_bytes}` }
  }

  if (dimensions) {
    if (dimensions.width < gate.min_width || dimensions.height < gate.min_height) {
      return { pass: false, reason: `too_small: ${dimensions.width}x${dimensions.height}` }
    }

    const aspect = Math.max(dimensions.width, dimensions.height) / Math.min(dimensions.width, dimensions.height)
    if (aspect > gate.max_aspect_ratio) {
      return { pass: false, reason: `extreme_aspect: ${aspect.toFixed(1)} > ${gate.max_aspect_ratio}` }
    }
  }

  return { pass: true }
}
