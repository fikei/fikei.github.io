/* ============================================
   Image Validation Engine — Tier 1 & Tier 2
   Scores images across quality dimensions before
   display. Shared constants + client-side heuristics.

   Tier 1: Client-side heuristic checks (~0ms, free)
   Tier 2: Server-side technical analysis (~100ms, free)

   Usage (client):
     var scores = ImageValidation.tier1(imageUrl, { title, domain, links });
     if (scores.composite < ImageValidation.THRESHOLDS.POOR) { ... }

   Usage (server — import constants):
     import patterns from './image-validation.js'
   ============================================ */

(function(root) {
  'use strict';

  // ============================================
  // Shared Constants
  // ============================================

  // Patterns indicating non-content images (logos, icons, placeholders)
  var BLOCKLIST_PATTERNS = [
    /logo/i, /icon/i, /favicon/i, /brand/i, /avatar/i,
    /placeholder/i, /default/i, /blank/i, /spacer/i,
    /pixel/i, /1x1/i, /transparent/i, /sprite/i,
    /tracking/i, /beacon/i, /badge/i, /button/i,
    /banner-ad/i, /ad-banner/i, /widget-icon/i
  ];

  // Known CDN placeholder patterns
  var PLACEHOLDER_URL_PATTERNS = [
    /no-image/i, /noimage/i, /no_image/i,
    /missing/i, /not-found/i, /not_found/i,
    /fallback/i, /generic/i,
    /placeholder\.(jpg|png|gif|svg|webp)/i,
    /default\.(jpg|png|gif|svg|webp)/i,
    /blank\.(jpg|png|gif|svg|webp)/i,
    /data:image\/gif;base64,R0lGOD/  // 1x1 tracking pixel
  ];

  // Minimum thresholds per card context
  var CARD_THRESHOLDS = {
    grid:   { minWidth: 300, minHeight: 200, maxAspect: 3 },
    hero:   { minWidth: 600, minHeight: 400, maxAspect: 2.5 },
    thumb:  { minWidth: 100, minHeight: 100, maxAspect: 2 },
    widget: { minWidth: 200, minHeight: 200, maxAspect: 2 }
  };

  // Score tier boundaries
  var TIERS = {
    EXCELLENT: 0.85,
    GOOD:     0.65,
    MARGINAL: 0.40,
    POOR:     0.15
    // Below POOR = REJECTED
  };

  // Composite weight configuration
  var WEIGHTS = {
    accuracy:        0.35,
    visual_quality:  0.25,
    aesthetic_fit:   0.20,
    distinctiveness: 0.15,
    safety:          0.05
  };

  // Known-good sources that bypass expensive checks
  var KNOWN_GOOD_SOURCES = [
    /img\.youtube\.com\/vi\//,
    /i\.vimeocdn\.com\//,
    /opengraph\.githubassets\.com\//,
    /i\.scdn\.co\//,              // Spotify
    /mosaic\.scdn\.co\//,         // Spotify playlists
    /image\.tmdb\.org\//,         // TMDB (movies/tv)
    /m\.media-amazon\.com\//,     // Amazon product images
    /images-na\.ssl-images-amazon\.com\// // Amazon
  ];

  // File extensions we accept
  var VALID_IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|avif|gif|svg)(\?|$)/i;

  // ============================================
  // Scoring Helpers
  // ============================================

  function getTierLabel(composite) {
    if (composite >= TIERS.EXCELLENT) return 'excellent';
    if (composite >= TIERS.GOOD)      return 'good';
    if (composite >= TIERS.MARGINAL)   return 'marginal';
    if (composite >= TIERS.POOR)       return 'poor';
    return 'rejected';
  }

  function computeComposite(scores) {
    // Safety is a hard gate
    if (scores.safety === 0) return 0;

    return (
      (scores.accuracy || 0)        * WEIGHTS.accuracy +
      (scores.visual_quality || 0)   * WEIGHTS.visual_quality +
      (scores.aesthetic_fit || 0)    * WEIGHTS.aesthetic_fit +
      (scores.distinctiveness || 0)  * WEIGHTS.distinctiveness +
      (scores.safety || 1)           * WEIGHTS.safety
    );
  }

  function makeScoreResult(scores, method) {
    var composite = computeComposite(scores);
    return {
      accuracy:        scores.accuracy || null,
      visual_quality:  scores.visual_quality || null,
      aesthetic_fit:   scores.aesthetic_fit || null,
      distinctiveness: scores.distinctiveness || null,
      safety:          scores.safety != null ? scores.safety : 1,
      composite:       Math.round(composite * 100) / 100,
      tier:            getTierLabel(composite),
      evaluated_at:    new Date().toISOString(),
      evaluation_method: method
    };
  }

  // ============================================
  // Tier 1: Client-Side Heuristic Checks
  // ============================================

  /**
   * Run Tier 1 heuristic validation on an image URL.
   * No network requests — purely pattern-based.
   *
   * @param {string} imageUrl - The image URL to validate
   * @param {Object} context - Additional context
   * @param {string} context.title - Pin title
   * @param {string} context.domain - Source domain
   * @param {string} context.faviconUrl - Site favicon URL (if known)
   * @param {Array} context.domainImages - Other image URLs from same domain (for duplicate detection)
   * @returns {Object} Validation result with scores and pass/fail
   */
  function tier1(imageUrl, context) {
    context = context || {};
    var checks = [];
    var distinctiveness = 1.0;
    var visualQuality = 1.0;

    if (!imageUrl || typeof imageUrl !== 'string') {
      return {
        pass: false,
        reason: 'no_image_url',
        scores: makeScoreResult({ distinctiveness: 0, visual_quality: 0, safety: 1 }, 'tier1_heuristic'),
        checks: [{ check: 'url_exists', pass: false }]
      };
    }

    var urlLower = imageUrl.toLowerCase();

    // Check 1: Data URI tracking pixel
    if (urlLower.startsWith('data:')) {
      var isSmallDataUri = imageUrl.length < 200;
      checks.push({ check: 'data_uri', pass: !isSmallDataUri, detail: isSmallDataUri ? 'likely tracking pixel' : 'embedded image' });
      if (isSmallDataUri) {
        distinctiveness = 0;
      }
    }

    // Check 2: Blocklist pattern matching (filename/path)
    var blockedPattern = null;
    for (var i = 0; i < BLOCKLIST_PATTERNS.length; i++) {
      if (BLOCKLIST_PATTERNS[i].test(urlLower)) {
        blockedPattern = BLOCKLIST_PATTERNS[i].source;
        break;
      }
    }
    if (blockedPattern) {
      distinctiveness = Math.min(distinctiveness, 0.1);
      checks.push({ check: 'blocklist_pattern', pass: false, detail: blockedPattern });
    } else {
      checks.push({ check: 'blocklist_pattern', pass: true });
    }

    // Check 3: Placeholder URL patterns
    var isPlaceholder = false;
    for (var j = 0; j < PLACEHOLDER_URL_PATTERNS.length; j++) {
      if (PLACEHOLDER_URL_PATTERNS[j].test(imageUrl)) {
        isPlaceholder = true;
        break;
      }
    }
    if (isPlaceholder) {
      distinctiveness = 0;
      checks.push({ check: 'placeholder_url', pass: false });
    } else {
      checks.push({ check: 'placeholder_url', pass: true });
    }

    // Check 4: Favicon match
    if (context.faviconUrl && imageUrl === context.faviconUrl) {
      distinctiveness = 0;
      checks.push({ check: 'favicon_match', pass: false, detail: 'image URL matches site favicon' });
    } else {
      checks.push({ check: 'favicon_match', pass: true });
    }

    // Check 5: Google favicon service (used as fallback — low distinctiveness)
    if (/google\.com\/s2\/favicons/i.test(urlLower)) {
      distinctiveness = Math.min(distinctiveness, 0.15);
      checks.push({ check: 'google_favicon', pass: false, detail: 'Google favicon service' });
    }

    // Check 6: Duplicate detection (same image used across pins from same domain)
    if (context.domainImages && context.domainImages.length > 0) {
      var dupeCount = 0;
      for (var k = 0; k < context.domainImages.length; k++) {
        if (context.domainImages[k] === imageUrl) dupeCount++;
      }
      if (dupeCount >= 2) {
        // Same image used 3+ times from same domain — likely a site-wide asset
        distinctiveness = Math.min(distinctiveness, 0.2);
        checks.push({ check: 'duplicate_detection', pass: false, detail: dupeCount + ' other pins use this image' });
      } else {
        checks.push({ check: 'duplicate_detection', pass: true });
      }
    }

    // Check 7: Known-good source bypass
    var isKnownGood = false;
    for (var m = 0; m < KNOWN_GOOD_SOURCES.length; m++) {
      if (KNOWN_GOOD_SOURCES[m].test(imageUrl)) {
        isKnownGood = true;
        break;
      }
    }
    if (isKnownGood) {
      checks.push({ check: 'known_good_source', pass: true, detail: 'trusted source — high confidence' });
      return {
        pass: true,
        knownGood: true,
        scores: makeScoreResult({
          accuracy: 0.9,
          visual_quality: 0.9,
          aesthetic_fit: 0.8,
          distinctiveness: 1.0,
          safety: 1
        }, 'tier1_known_good'),
        checks: checks
      };
    }

    // Check 8: Suspicious file extension
    // URLs with no extension are OK (CDN rewriting), but explicit non-image extensions are bad
    var hasNonImageExt = /\.(pdf|html|css|js|json|xml|txt|doc|xls)(\?|$)/i.test(urlLower);
    if (hasNonImageExt) {
      visualQuality = 0;
      checks.push({ check: 'file_extension', pass: false, detail: 'non-image extension' });
    } else {
      checks.push({ check: 'file_extension', pass: true });
    }

    // Compute scores
    var scores = {
      distinctiveness: distinctiveness,
      visual_quality: visualQuality,
      // These need Tier 2/3 to evaluate properly — leave as neutral
      accuracy: null,
      aesthetic_fit: null,
      safety: 1
    };

    var result = makeScoreResult(scores, 'tier1_heuristic');

    // Tier 1 pass/fail: reject if distinctiveness or visual_quality is 0
    var pass = distinctiveness > 0 && visualQuality > 0;

    return {
      pass: pass,
      reason: !pass ? (distinctiveness === 0 ? 'not_distinctive' : 'visual_quality_zero') : null,
      scores: result,
      checks: checks
    };
  }

  // ============================================
  // Public API
  // ============================================

  var ImageValidation = {
    // Run Tier 1 heuristic checks (client-side, synchronous)
    tier1: tier1,

    // Score computation utilities
    computeComposite: computeComposite,
    getTierLabel: getTierLabel,
    makeScoreResult: makeScoreResult,

    // Constants for external use
    TIERS: TIERS,
    WEIGHTS: WEIGHTS,
    CARD_THRESHOLDS: CARD_THRESHOLDS,
    BLOCKLIST_PATTERNS: BLOCKLIST_PATTERNS,
    PLACEHOLDER_URL_PATTERNS: PLACEHOLDER_URL_PATTERNS,
    KNOWN_GOOD_SOURCES: KNOWN_GOOD_SOURCES,
    VALID_IMAGE_EXTENSIONS: VALID_IMAGE_EXTENSIONS
  };

  // Expose globally
  root.ImageValidation = ImageValidation;

})(typeof window !== 'undefined' ? window : this);
