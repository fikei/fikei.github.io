# Setup Guide: Link Capture Tools

## Overview

Boards provides six ways to capture links — from automatic mobile features to advanced AI image scanning. All methods funnel to the same processing pipeline for consistent categorization and storage.

**What You Get:**
- **Mobile Quick-Add Bar** - Auto-appears on phones, zero setup
- **Deep Link / URL Scheme** - `ctrl.rodeo/boards/?add=URL` for automation
- **PWA Share Target** - Share from any app → Boards (requires PWA install)
- **Bookmarklet** - One-click save from any webpage
- **Image Scan (Claude Vision)** - Extract products/URLs from photos
- **PWA Install Button** - Add Boards to home screen

All capture methods work together — use what fits your workflow.

---

## 1. Mobile Quick-Add Bar

**Setup:** None required — automatically appears on mobile devices

**How It Works:**
- Automatically shows on viewports < 600px wide
- Fixed to bottom of screen, always accessible
- Three input methods:
  1. **Paste button** - Reads from clipboard, auto-processes URL
  2. **Type/paste URL** - Manual entry with auto-process on paste
  3. **Tap +** - Processes whatever's in the input field

**Usage:**
1. Copy a link from any app (Twitter, Instagram, Safari, etc.)
2. Open Boards in your mobile browser
3. Tap the paste icon (📋) in the quick-add bar
4. Link is automatically processed and added to your board

**Tips:**
- The bar stays visible while scrolling
- Auto-clears input after successful add
- Works in mobile Safari, Chrome, Firefox

---

## 2. Deep Link / URL Scheme

**Setup:** None required — works in any browser

**Format:**
```
https://ctrl.rodeo/boards/?add=<encoded-url>
```

**Example:**
```
https://ctrl.rodeo/boards/?add=https%3A%2F%2Fexample.com
```

**Use Cases:**

### A. Apple Shortcuts (iOS/macOS)
1. Open Shortcuts app
2. Create new shortcut
3. Add action: "Get URLs from Input"
4. Add action: "URL Encode" the URLs
5. Add action: "Open URLs" with this format:
   ```
   https://ctrl.rodeo/boards/?add=[Encoded URL]
   ```
6. Enable "Show in Share Sheet"
7. Now you can share any link to this shortcut → auto-opens Boards

### B. Tasker (Android)
1. Create new Task
2. Add action: Net → HTTP Get
3. URL: `https://ctrl.rodeo/boards/?add=%url`
4. Create App → Event → Share → choose apps
5. Link to your Task

### C. IFTTT / Zapier
Use the deep link URL format in any webhook/automation that handles URLs.

### D. Custom Scripts
```bash
# Bash script to add URL to Boards
#!/bin/bash
URL=$(echo "$1" | jq -sRr @uri)
open "https://ctrl.rodeo/boards/?add=$URL"
```

---

## 3. PWA Share Target

**Setup Required:** Install Boards as a Progressive Web App (PWA)

### Installation

#### iOS (Safari 16.4+)
1. Open https://ctrl.rodeo/boards in Safari
2. Tap the Share button (square with arrow)
3. Scroll down, tap "Add to Home Screen"
4. Tap "Add"
5. Boards icon appears on your home screen

#### Android (Chrome 75+)
1. Open https://ctrl.rodeo/boards in Chrome
2. Tap the three-dot menu
3. Tap "Add to Home Screen" or "Install App"
4. Tap "Install"
5. Boards icon appears in your app drawer

#### Desktop (Chrome, Edge, Arc)
1. Open https://ctrl.rodeo/boards
2. Look for the install icon (⊕) in the address bar
3. Click "Install"
4. Boards opens as a standalone app

### Usage (After Installation)

1. In any app (Twitter, Reddit, Safari, etc.), tap Share on a link
2. Scroll through the share sheet
3. Select "Boards" from the app list
4. Link is automatically captured and saved

**How It Works:**
- Share data goes to `/boards/pwa-share.html`
- Page extracts URL from share params (`url`, `text`, or `title`)
- Redirects to `boards/?add=<extracted-url>`
- Main app processes the link normally

**Troubleshooting:**
- "Boards" doesn't appear in share sheet → Reinstall PWA, ensure it's actually installed
- Share opens to blank Boards → Check browser console for errors
- Works on Android, not iOS → iOS requires Safari 16.4+ (iOS 16.4 released March 2023)

---

## 4. Bookmarklet

**Setup:** One-time drag to bookmarks bar

### Installation

1. Open https://ctrl.rodeo/boards
2. Tap the + FAB button (bottom right)
3. Tap "Tools"
4. Find the "Bookmarklet" section
5. Drag the **"+ Save to Boards"** button to your bookmarks bar
   - Desktop: Drag directly
   - Mobile Safari: Tap and hold → "Add Bookmark" → edit name if desired

### Usage

1. Browse to any webpage you want to save
2. Click the "Save to Boards" bookmark
3. You'll be redirected to Boards with that link auto-processed

**Bookmarklet Code:**
```javascript
javascript:void(window.location='https://ctrl.rodeo/boards/?add='+encodeURIComponent(window.location.href))
```

**Use Cases:**
- Quick save from desktop browser
- Backup method when PWA share isn't available
- Works in any browser (Safari, Chrome, Firefox, Arc, etc.)

**Alternative Setup (Manual):**
1. Create a new bookmark
2. Name it "Save to Boards"
3. Paste the bookmarklet code above into the URL field
4. Save

---

## 5. Image Scan (Claude Vision)

**Setup Required:** Deploy edge function + set API key

### Prerequisites
- Anthropic API key (Claude Vision access)
- Supabase CLI installed and linked to Boards project

### Step 1: Get Anthropic API Key

1. Go to https://console.anthropic.com/
2. Sign up or log in
3. Navigate to API Keys
4. Create a new key, name it "boards-image-scan"
5. Copy the key (starts with `sk-ant-`)
6. **Cost:** Claude Sonnet 4 Vision costs ~$3 per 1000 images

### Step 2: Set Environment Variable in Supabase

```bash
# Set the API key
supabase secrets set ANTHROPIC_API_KEY=sk-ant-your-key-here --project-ref yfhudwakpgzswiylhfbh

# Verify it was set
supabase secrets list --project-ref yfhudwakpgzswiylhfbh
```

**Or via Supabase Dashboard:**
1. Go to https://supabase.com/dashboard/project/yfhudwakpgzswiylhfbh
2. Navigate to Project Settings → Edge Functions
3. Add secret: `ANTHROPIC_API_KEY` = `sk-ant-your-key-here`

### Step 3: Deploy the Edge Function

```bash
# Navigate to project root
cd /Users/ian/.claude-worktrees/fikei.github.io/intelligent-edison

# Link to Boards project (if not already linked)
supabase link --project-ref yfhudwakpgzswiylhfbh

# Deploy the function
supabase functions deploy scan-image --project-ref yfhudwakpgzswiylhfbh
```

### Step 4: Test the Function

```bash
# Test with a sample image (base64 string)
curl -X POST "https://yfhudwakpgzswiylhfbh.supabase.co/functions/v1/scan-image" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"image": "BASE64_IMAGE_DATA", "mimeType": "image/jpeg"}'
```

Expected response:
```json
{
  "items": [
    {
      "title": "Nike Air Max 90",
      "description": "White and blue sneakers",
      "url": "https://nike.com/...",
      "category": "wear",
      "confidence": 0.9
    }
  ]
}
```

### Usage

1. Open Boards in browser
2. Tap the + FAB button (bottom right)
3. Tap "Scan"
4. Choose:
   - **Take Photo** (mobile) - Opens camera
   - **Choose Image** - Opens file picker
5. Image is uploaded and analyzed
6. Results appear in a modal showing detected items
7. Review and tap "Add All" or individual items to save

**What It Detects:**
- Products in photos (brands, items, descriptions)
- URLs visible in screenshots
- Website content from app/browser screenshots
- Creative content (artwork, designs, etc.)
- Multiple items in a single image

**Tips:**
- Works best with clear, well-lit product photos
- Screenshots should be high-resolution
- Can detect 1-10+ items per image
- Confidence score helps filter low-quality matches

**Cost Management:**
- Each scan = 1 Claude API call (~$0.003)
- Set spending limits in Anthropic console
- Monitor usage in function logs:
  ```bash
  supabase functions logs scan-image --tail
  ```

### Troubleshooting

**"AI service not configured" error:**
- Check `ANTHROPIC_API_KEY` is set in Supabase secrets
- Verify key starts with `sk-ant-` and is valid

**"Image analysis failed" error:**
- Check function logs: `supabase functions logs scan-image`
- Verify image is < 10MB and valid format (JPEG, PNG, WebP, GIF)
- Check Anthropic API status

**No items returned:**
- Image might not contain recognizable products/URLs
- Try a clearer/higher-resolution image
- Check function logs for Claude's raw response

---

## 6. PWA Install Button

**Setup:** None required — auto-appears when available

**How It Works:**
- Install button appears in Tools modal (FAB → Tools → Install)
- Only shows when:
  1. Browser supports PWA installation (Chrome, Edge, Safari 16.4+)
  2. App is not already installed
  3. User hasn't previously dismissed the prompt
- Triggers browser's native install prompt

**Usage:**
1. Open Boards → tap + FAB → Tools
2. If "Install Boards App" button appears, tap it
3. Confirm in browser's install dialog
4. App installs to home screen/app drawer

**Alternative:** Use browser's built-in install option (address bar icon, menu, etc.)

---

## Architecture Overview

All capture methods converge on the same processing pipeline:

```
[Capture Method] → ?add=URL query param → processLinks(url) → AI categorization → Save
```

### Data Flow

1. **Capture** - User provides URL via one of 6 methods
2. **Extract** - URL is extracted/encoded
3. **Route** - All methods redirect to `boards/?add=<url>`
4. **Process** - `processLinks()` function handles URL
5. **Enrich** - Content fetched, AI categorizes, metadata extracted
6. **Save** - Link added to Supabase database
7. **Render** - UI updates with new link

### Key Files

| File | Purpose |
|------|---------|
| `boards/index.html` | Main app, all UI, capture logic |
| `boards/pwa-share.html` | PWA share target receiver |
| `supabase/functions/scan-image/` | Image analysis edge function |
| `images/icons/favicons/site.webmanifest` | PWA configuration |

### URL Parameter Format

All methods use the same query parameter:
```
?add=<url-encoded-string>
```

Examples:
```
?add=https%3A%2F%2Fexample.com
?add=https%3A%2F%2Ftwitter.com%2Fuser%2Fstatus%2F123
?add=https%3A%2F%2Fopen.spotify.com%2Ftrack%2Fabc
```

The app detects this parameter on load and auto-processes it.

---

## Browser Compatibility

| Feature | iOS Safari | Android Chrome | Desktop Chrome | Desktop Safari | Desktop Firefox |
|---------|-----------|---------------|---------------|---------------|----------------|
| Mobile Quick-Add | ✅ 15+ | ✅ 75+ | N/A | N/A | N/A |
| Deep Link | ✅ All | ✅ All | ✅ All | ✅ All | ✅ All |
| PWA Share Target | ✅ 16.4+ | ✅ 75+ | ❌ | ✅ 16.4+ | ❌ |
| Bookmarklet | ✅ All | ✅ All | ✅ All | ✅ All | ✅ All |
| Image Scan | ✅ 15+ | ✅ 75+ | ✅ 90+ | ✅ 15+ | ✅ 90+ |
| PWA Install | ✅ 16.4+ | ✅ 75+ | ✅ 90+ | ✅ 16.4+ | ❌ |

---

## Testing Checklist

### Mobile Quick-Add Bar
- [ ] Open Boards on mobile (< 600px width)
- [ ] Quick-add bar appears at bottom
- [ ] Tap paste icon → reads clipboard
- [ ] Paste URL into input → auto-processes on paste event
- [ ] Type URL + tap + → processes
- [ ] Bar stays visible while scrolling

### Deep Link
- [ ] Visit `https://ctrl.rodeo/boards/?add=https%3A%2F%2Fexample.com`
- [ ] Link is auto-processed and added
- [ ] Board shows the new link
- [ ] Test with Apple Shortcut (iOS)
- [ ] Test with automation tool (IFTTT, Tasker, etc.)

### PWA Share Target
- [ ] Install Boards as PWA (Add to Home Screen)
- [ ] Share a link from Twitter → select Boards
- [ ] Link appears in Boards
- [ ] Share a link from Safari → select Boards
- [ ] Test on both iOS and Android

### Bookmarklet
- [ ] Drag bookmarklet to bookmarks bar
- [ ] Browse to a test page (e.g., https://example.com)
- [ ] Click "Save to Boards" bookmarklet
- [ ] Redirected to Boards with link processed
- [ ] Test in multiple browsers

### Image Scan
- [ ] Edge function deployed with ANTHROPIC_API_KEY set
- [ ] Open Boards → + FAB → Scan
- [ ] Take/select photo with products
- [ ] Results modal shows detected items
- [ ] Items have title, description, category
- [ ] Tap "Add All" → all items saved
- [ ] Check function logs for errors

### PWA Install Button
- [ ] Open Boards in supported browser (not already installed)
- [ ] Tap + FAB → Tools
- [ ] "Install Boards App" button appears
- [ ] Tap button → browser install prompt appears
- [ ] Install → app added to home screen
- [ ] After install, button disappears from Tools

---

## Cost Estimates

### Image Scan (Claude Vision)
- **Model:** Claude Sonnet 4 (2025-05-14)
- **Cost:** ~$3.00 per 1000 images
- **Per scan:** ~$0.003
- **Example:** 100 scans/month = $0.30

### Link Enrichment (Optional, not part of capture)
- Uses `enrich-link` edge function with Claude Haiku
- Cost: ~$0.25 per 1000 links
- Most links don't need enrichment (client-side rules handle 60-80%)

### Free Tier (Supabase)
- Edge function invocations: 500K/month free
- Database storage: 500MB free
- All capture methods (except image scan) use zero external API calls

---

## Rollback / Disable Instructions

### Disable Mobile Quick-Add Bar
```javascript
// In boards/index.html, find and comment out:
// if (window.innerWidth < 600) { showQuickAddBar(); }
```

### Disable Deep Link Processing
```javascript
// In boards/index.html, find and comment out:
// const addParam = new URLSearchParams(window.location.search).get('add');
// if (addParam) { processLinks(addParam); }
```

### Disable PWA Share Target
```json
// In images/icons/favicons/site.webmanifest, remove:
// "share_target": { ... }
```

### Disable Image Scan
```bash
# Delete the edge function
supabase functions delete scan-image --project-ref yfhudwakpgzswiylhfbh
```

Or hide the button in UI:
```javascript
// In boards/index.html, find and hide:
// <div class="fab-menu__item" data-action="scan">
```

---

## Next Steps After Setup

1. **Test each capture method** - Use the checklist above
2. **Set cost limits** - Configure Anthropic API spending cap
3. **Monitor usage** - Check Supabase function logs weekly
4. **Share with users** - Provide instructions for your preferred method
5. **Collect feedback** - Which methods do people actually use?
6. **Optimize** - Disable unused methods to reduce complexity

---

## Related Documentation

- [Content Type System Setup](./content-type-system.md) - AI categorization for captured links
- [Boards PRD](../strategy/prds/boards-mvp.md) - Product requirements
- [Client Architecture](../infrastructure/technical-design/client-architecture.md) - Technical implementation
- [UX: Link Capture](../ux/boards/link-capture.md) - User experience documentation (if exists)

---

## Support

**Function logs:**
```bash
supabase functions logs scan-image --tail
```

**Common issues:**
- CORS errors → Check function includes corsHeaders
- Auth errors → Verify anon key in client code
- API key errors → Check secrets are set correctly
- Install issues → Verify manifest.json is valid

**GitHub Issues:** Report bugs at https://github.com/fikei/fikei.github.io/issues
