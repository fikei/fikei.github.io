# Setup Guide: Content Type & Image Systems

## What You Need to Decide

### Critical Decision 1: AI Provider for Classification

| Option | Monthly Cost (10K links) | Setup Complexity | Recommendation |
|--------|--------------------------|------------------|----------------|
| **Anthropic (claude-3-haiku)** | ~$2-5 | Medium | ✅ Best accuracy/cost |
| **OpenAI (gpt-4o-mini)** | ~$1-3 | Medium | Good backup |
| **Both (with fallback)** | ~$2-5 | Higher | Most reliable |

**Your decision:** Which AI provider(s) will you use?

### Critical Decision 2: Image Search Provider

| Option | Free Tier | Setup | Recommendation |
|--------|-----------|-------|----------------|
| **Unsplash** | 50 req/hr | Easy | ✅ Start here |
| **Pexels** | 200 req/hr | Easy | Good backup |
| **None (skip search)** | Free | None | Viable for MVP |

**Your decision:** Will you use image search? Which provider?

### Critical Decision 3: AI Image Generation

| Option | Cost/Image | Quality | Recommendation |
|--------|------------|---------|----------------|
| **Skip for now** | $0 | N/A | ✅ Start here |
| **Stability AI** | $0.002-0.006 | Good | Add later |
| **DALL-E 3** | $0.04-0.12 | Excellent | Premium option |

**Your decision:** Enable AI generation now or later?

### Critical Decision 4: Headless Scraping

| Option | Free Tier | Complexity | Recommendation |
|--------|-----------|------------|----------------|
| **Skip for MVP** | N/A | None | ✅ Start here |
| **Browserless** | 6 hrs/mo | Low | Add when needed |
| **Self-hosted Puppeteer** | Compute only | High | For high volume |

**Your decision:** Enable headless scraping now or later?

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| **AI API costs spike** | Medium | High | Domain caching (reduces 60-80%), daily cost limits, alerts |
| **AI API downtime** | Low | Medium | Client-side rules fallback, second provider fallback |
| **Rate limits hit** | Medium | Medium | Request queuing, exponential backoff, caching |
| **Poor classification accuracy** | Medium | Low | Human feedback loop, confidence thresholds, logging |
| **CORS issues on client** | High (already hit) | Medium | Server-side resolution for scraping/APIs |
| **Supabase Edge Function limits** | Low | Medium | Monitor usage, optimize function size |
| **Image search returns bad results** | Medium | Low | Filter by size/quality, allow user override |

---

## Step-by-Step Setup Instructions

### Step 1: Get API Keys

#### 1a. Anthropic API Key (Required for AI classification)
1. Go to https://console.anthropic.com/
2. Sign up or log in
3. Navigate to API Keys
4. Create a new key, name it "boards-classification"
5. Copy the key (starts with `sk-ant-`)
6. **Cost:** ~$5 credits to start, pay-as-you-go after

#### 1b. Unsplash API Key (Optional, for image search)
1. Go to https://unsplash.com/developers
2. Click "Register as a developer"
3. Create a new application
4. Copy the "Access Key"
5. **Cost:** Free for 50 requests/hour

#### 1c. OpenAI API Key (Optional, backup for classification)
1. Go to https://platform.openai.com/
2. Sign up or log in
3. Navigate to API Keys
4. Create a new key
5. Copy the key (starts with `sk-`)
6. **Cost:** ~$5 credits to start

### Step 2: Create the Edge Function

```bash
# Navigate to your project
cd /home/user/fikei.github.io

# Create the function directory
mkdir -p supabase/functions/enrich-link

# Create the function file
touch supabase/functions/enrich-link/index.ts
```

I'll create the function code for you in the next step.

### Step 3: Set Environment Variables in Supabase

1. Go to your Supabase dashboard
2. Navigate to Project Settings → Edge Functions
3. Add these secrets:

```
ANTHROPIC_API_KEY=sk-ant-your-key-here
OPENAI_API_KEY=sk-your-key-here        # Optional
UNSPLASH_ACCESS_KEY=your-key-here      # Optional
```

### Step 4: Deploy the Edge Function

```bash
# Login to Supabase CLI (if not already)
supabase login

# Link your project
supabase link --project-ref your-project-ref

# Deploy the function
supabase functions deploy enrich-link
```

### Step 5: Update Client Code

Update `boards/index.html` to call the Edge Function:

```javascript
// Add after client-side classification
if (contentType.confidence < 0.7 || !meta.image) {
  // Queue for server enrichment
  enrichLink(linkObj.id, url, meta.title, meta.description);
}

async function enrichLink(linkId, url, title, description) {
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/enrich-link`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabase.auth.session()?.access_token}`
      },
      body: JSON.stringify({ linkId, url, title, description })
    });

    if (response.ok) {
      const result = await response.json();
      // Update local state and re-render
      updateLinkFromEnrichment(linkId, result);
    }
  } catch (e) {
    console.error('[ENRICH] Failed:', e);
  }
}
```

### Step 6: Run Database Migrations

```bash
# Apply the migrations
supabase db push

# Or run manually in Supabase SQL Editor:
# - supabase/migrations/003_content_type_system.sql
# - supabase/migrations/004_image_resolution_system.sql
```

### Step 7: Test the Flow

1. Open your board in browser
2. Open DevTools Console (F12)
3. Paste a URL you've never saved before
4. Watch the logs:
   - `[LINK FLOW]` - Main pipeline
   - `[CLASSIFY]` - Client-side rules
   - `[ENRICH]` - Server call (if triggered)
5. Check Admin Panel (Ctrl+Shift+D) for stats

---

## Testing Checklist

### Client-Side (Works Now)
- [ ] Paste YouTube URL → Should classify as "video", get thumbnail
- [ ] Paste GitHub URL → Should classify as "repository", get social preview
- [ ] Paste Amazon URL → Should classify as "product"
- [ ] Paste Medium URL → Should classify as "article"
- [ ] Paste unknown URL → Should classify as "unknown", queue for enrichment
- [ ] Check Admin Panel → Shows content type breakdown

### Server-Side (After Setup)
- [ ] Unknown URL triggers enrich-link call
- [ ] AI classification returns type + confidence
- [ ] Image resolution finds/generates image
- [ ] Link updates with new image (fade-in animation)
- [ ] Domain profile cached for future links

---

## Monitoring & Costs

### Set Up Cost Alerts

#### Anthropic
1. Go to https://console.anthropic.com/settings/limits
2. Set a monthly spending limit (e.g., $10)
3. Enable email alerts at 50%, 80%, 100%

#### OpenAI
1. Go to https://platform.openai.com/account/limits
2. Set a monthly budget cap
3. Enable usage alerts

### Monitor Usage

Add to your admin panel:
- Daily API calls count
- Cache hit rate percentage
- Average cost per link
- Error rate

---

## Rollback Plan

If something goes wrong:

1. **Disable server enrichment:**
   ```javascript
   // In boards/index.html, comment out:
   // enrichLink(linkObj.id, url, meta.title, meta.description);
   ```

2. **Client-side rules still work** - Users can still add links with basic classification

3. **Delete Edge Function:**
   ```bash
   supabase functions delete enrich-link
   ```

---

## Next Steps After Setup

1. **Monitor for 1 week** - Check costs, accuracy, error rates
2. **Add Unsplash** - If image coverage is low
3. **Add AI generation** - If many links still have no images
4. **Tune confidence threshold** - Adjust 0.7 based on accuracy data
5. **Review domain cache** - Check which domains are cached, accuracy
