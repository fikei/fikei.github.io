/* ============================================
   Image Enrichment Pipeline — MVP
   Client-side module for resolving contextual
   images based on content metadata.

   Strategies (in priority order):
     1. enrich  — call enrich-link edge function (needs URL + API key)
     2. unsplash — Unsplash search by keywords (needs API key)
     3. picsum  — picsum.photos seeded by content context (no key)

   Usage:
     var pipeline = ImageEnrichment({ strategy: 'picsum' });
     pipeline.resolve({ title: 'Severance S3', type: 'watch', meta: 'Apple TV+' })
       .then(function(result) { img.src = result.url; });

   Reusable for: widgets, pins, articles, PDFs, notes, etc.
   ============================================ */

(function(root) {
  'use strict';

  // --- Helpers ---
  function slugify(str) {
    return (str || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 40);
  }

  function pickKeywords(context) {
    // Extract meaningful words from title + meta for search queries
    var text = [context.title, context.meta, context.category].filter(Boolean).join(' ');
    var stops = ['the','a','an','and','or','but','in','on','at','to','for','of','is','it','by','from','with','as','your','you','my','this','that','s3','s4','s5'];
    return text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(function(w) { return w.length > 2 && stops.indexOf(w) === -1; })
      .slice(0, 5);
  }

  // --- Size map: pin type → default image dimensions ---
  var TYPE_SIZES = {
    thumb:   { w: 80,  h: 80  },
    card:    { w: 160, h: 160 },
    hero:    { w: 400, h: 300 },
    banner:  { w: 600, h: 200 },
    wide:    { w: 400, h: 225 },
    default: { w: 160, h: 160 }
  };

  // --- Strategy: picsum (no API key, seeded by content) ---
  function picsumResolve(context, size) {
    var seed = slugify(context.title || context.meta || 'default');
    if (context._randomize) {
      seed += '-' + Date.now().toString(36);
    }
    var dim = TYPE_SIZES[size] || TYPE_SIZES.default;
    return Promise.resolve({
      url: 'https://picsum.photos/seed/' + seed + '/' + dim.w + '/' + dim.h,
      source: 'picsum',
      seed: seed
    });
  }

  // --- Strategy: unsplash (needs access key) ---
  function unsplashResolve(context, size, accessKey) {
    var keywords = pickKeywords(context);
    if (!keywords.length) return picsumResolve(context, size);

    var query = keywords.join(' ');
    var dim = TYPE_SIZES[size] || TYPE_SIZES.default;
    var url = 'https://api.unsplash.com/search/photos?query=' +
      encodeURIComponent(query) +
      '&per_page=1&orientation=squarish' +
      '&w=' + dim.w + '&h=' + dim.h;

    return fetch(url, {
      headers: { 'Authorization': 'Client-ID ' + accessKey }
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data.results && data.results.length > 0) {
        var photo = data.results[0];
        return {
          url: photo.urls.small,
          source: 'unsplash',
          credit: photo.user.name,
          creditUrl: photo.user.links.html
        };
      }
      // Fallback to picsum if no results
      return picsumResolve(context, size);
    })
    .catch(function() {
      return picsumResolve(context, size);
    });
  }

  // --- Strategy: enrich (calls existing edge function) ---
  function enrichResolve(context, size, config) {
    if (!context.url) return picsumResolve(context, size);

    var endpoint = config.supabaseUrl + '/functions/v1/enrich-link';
    return fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + config.supabaseKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ url: context.url })
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data.image_url) {
        return {
          url: data.image_url,
          source: 'enrich',
          contentType: data.content_type
        };
      }
      return picsumResolve(context, size);
    })
    .catch(function() {
      return picsumResolve(context, size);
    });
  }

  // --- Main pipeline ---
  function ImageEnrichment(options) {
    options = options || {};
    var strategy = options.strategy || 'picsum';
    var unsplashKey = options.unsplashKey || null;
    var supabaseUrl = options.supabaseUrl || null;
    var supabaseKey = options.supabaseKey || null;

    return {
      /**
       * Resolve an image for content context.
       * @param {Object} context - { title, meta, category, type, url, _randomize }
       *   title:    Content title (e.g. "Severance S3")
       *   meta:     Supporting text (e.g. "Apple TV+ — Expected Q3 2026")
       *   category: Content category (e.g. "watch", "eat", "read")
       *   type:     Pin content type (e.g. "article", "product", "video")
       *   url:      Source URL (for enrich strategy)
       *   _randomize: true to get a fresh image (for refresh)
       * @param {string} size - Image size: 'thumb', 'card', 'hero', 'banner', 'wide'
       * @returns {Promise<{url, source, seed?, credit?, creditUrl?}>}
       */
      resolve: function(context, size) {
        size = size || 'card';
        switch (strategy) {
          case 'unsplash':
            if (unsplashKey) return unsplashResolve(context, size, unsplashKey);
            return picsumResolve(context, size);
          case 'enrich':
            if (supabaseUrl && supabaseKey) return enrichResolve(context, size, { supabaseUrl: supabaseUrl, supabaseKey: supabaseKey });
            return picsumResolve(context, size);
          case 'picsum':
          default:
            return picsumResolve(context, size);
        }
      },

      /**
       * Batch resolve images for multiple items.
       * @param {Array<{context, size}>} items
       * @returns {Promise<Array<{url, source, ...}>>}
       */
      resolveAll: function(items) {
        var self = this;
        return Promise.all(items.map(function(item) {
          return self.resolve(item.context || item, item.size || 'card');
        }));
      },

      /**
       * Apply images to all .w-img elements within a container.
       * Reads context from nearest title/meta text.
       * @param {Element} container - DOM element to scan
       * @param {boolean} randomize - true for fresh images
       */
      applyToContainer: function(container, randomize) {
        var self = this;
        var imgWrappers = container.querySelectorAll('.w-img');
        imgWrappers.forEach(function(wrapper) {
          var img = wrapper.querySelector('img');
          if (!img) return;

          // Determine size from class
          var sizeKey = 'card';
          if (wrapper.classList.contains('w-img--thumb')) sizeKey = 'thumb';
          else if (wrapper.classList.contains('w-img--hero')) sizeKey = 'hero';
          else if (wrapper.classList.contains('w-img--banner')) sizeKey = 'banner';
          else if (wrapper.classList.contains('w-img--wide')) sizeKey = 'wide';

          // Build context from surrounding DOM
          var parent = wrapper.closest('.w-row, .w-option, .w-body, .w-shell');
          var context = { _randomize: !!randomize };
          if (parent) {
            var titleEl = parent.querySelector('.w-text--title');
            var metaEl = parent.querySelector('.w-text--meta');
            if (titleEl) context.title = titleEl.textContent.trim();
            if (metaEl) context.meta = metaEl.textContent.trim();
          }
          // Category from shell data attribute
          var shell = wrapper.closest('.w-shell');
          if (shell && shell.dataset.widget) {
            var parts = shell.dataset.widget.split('-');
            if (parts.length > 0) context.category = parts[0];
          }

          self.resolve(context, sizeKey).then(function(result) {
            img.src = result.url;
          });
        });
      }
    };
  }

  // Expose globally
  root.ImageEnrichment = ImageEnrichment;

})(typeof window !== 'undefined' ? window : this);
