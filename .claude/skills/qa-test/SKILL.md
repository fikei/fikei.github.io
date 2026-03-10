---
name: qa-test
description: "QA test web and iOS applications after deploying new code. Analyzes recent code changes, tests affected pages in a real browser AND on iOS device (via Xcode build + Safari Web Inspector), finds bugs (console errors, broken links, visual regressions, accessibility issues, functional problems, WKWebView issues, Share Extension failures, deep link breakage), then automatically spawns an agent team to fix safe bugs without asking — and flags critical bugs for human review. Use this skill whenever the user says things like 'QA this', 'test my deploy', 'check for bugs', 'run QA', 'test the site', 'smoke test', 'regression test', 'test mobile', 'test the app', 'test iOS', or after any deploy/merge. Also trigger when the user mentions checking pages after a code change, verifying a PR works, wants a post-deploy sanity check, or needs to validate the iOS app works after web changes."
---

# QA Test — Automated Post-Deploy Bug Hunter

You are a QA engineer. Your job: find bugs in recently deployed code, fix the ones that are safe to fix autonomously, and flag everything else for human review.

## Philosophy

Speed matters after a deploy. The user wants confidence that nothing is broken. You should be thorough but efficient — test what actually changed, not the entire site. When you find bugs, fix the easy ones immediately rather than creating a long report the user has to triage manually. Only escalate things that genuinely need a human decision.

---

## Step 1: Analyze What Changed

Start by understanding the scope of changes. This determines what to test.

```bash
# What changed since last deploy/merge to master?
git log --oneline master..HEAD  # if on a feature branch
git diff master --name-only     # files that changed
git diff master --stat          # summary of changes
```

If the user just merged to master, compare against the previous state:
```bash
git log --oneline -10           # recent commits
git diff HEAD~1 --name-only    # what the last commit changed
```

### Map Changes to Test Targets

Build a mental map of what needs testing based on file paths:

| Files Changed | What to Test | Platform |
|--------------|-------------|----------|
| `boards/index.html` or `boards/*.js` | Boards app at `/boards/` | Web + iOS (WKWebView loads this) |
| `boards/sw.js` or `boards/pwa-share.html` | PWA share flow, service worker cache | Web + iOS (PWA share target) |
| `ios/CtrlRodeo/*` | iOS native app (auth, WebView, UI) | iOS only |
| `ios/ShareExtension/*` | iOS Share Extension ("Save to Boards") | iOS only |
| `ios/Shared/*` | Shared models/services (affects both app + extension) | iOS only |
| `soundscape/*` | Soundscape app at `/soundscape/` | Web only |
| `systemic/*` | Systemic app at `/systemic/` | Web only |
| `design-system/*` | Design system at `/design-system/` + all pages using it | Web + iOS (WebView renders it) |
| `css/*`, `js/*` | Homepage + any page importing those files | Web |
| `index.html` (root) | Homepage | Web |
| `.well-known/apple-app-site-association` | Universal Links | iOS only |
| `supabase/functions/<name>/*` | The specific edge function | Backend (static analysis) |
| `docs/*` | Skip — documentation only | — |
| `*.md` | Skip — markdown only | — |

**Key cross-platform rule:** Any change to `boards/index.html`, `design-system/*`, or `boards/*.js` requires BOTH web and iOS testing because the iOS app is a WKWebView shell loading the same page from `https://ctrl.rodeo/boards/`.

If changes touch shared files (design-system CSS, global JS), expand the test surface to include all apps that import them.

---

## Step 2: Start Dev Server and Test in Browser

Use the Preview tools to test pages. If no launch.json exists, create one first.

### Setting Up the Server

Check if `.claude/launch.json` exists. If not, create it:

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "jekyll",
      "runtimeExecutable": "bundle",
      "runtimeArgs": ["exec", "jekyll", "serve"],
      "port": 4000
    }
  ]
}
```

Then start the server with `preview_start(name="jekyll")`.

If the site is already deployed (user said "I just deployed"), you can also test against the live URL using Chrome browser tools (`navigate` to `https://ctrl.rodeo/boards/` etc.).

### What to Check on Each Page

For every affected page, run through these checks:

#### 2a. Console Errors
```
preview_console_logs(serverId, level="error")
```
Any JavaScript errors, failed network requests, or unhandled promise rejections.

#### 2b. Visual Snapshot
```
preview_screenshot(serverId)
```
Look for: broken layouts, overlapping elements, missing images, text overflow, invisible text (white on white), elements pushed off-screen.

#### 2c. Accessibility Check
```javascript
// Run in preview_eval
(function() {
  const issues = [];
  // Images without alt text
  document.querySelectorAll('img:not([alt])').forEach(img => {
    issues.push({ type: 'missing-alt', element: img.src || img.outerHTML.slice(0, 100) });
  });
  // Buttons/links without accessible text
  document.querySelectorAll('button, a').forEach(el => {
    if (!el.textContent.trim() && !el.getAttribute('aria-label') && !el.getAttribute('title')) {
      issues.push({ type: 'no-accessible-text', element: el.outerHTML.slice(0, 100) });
    }
  });
  // Missing form labels
  document.querySelectorAll('input:not([type="hidden"]), select, textarea').forEach(el => {
    const id = el.id;
    if (!id || !document.querySelector(`label[for="${id}"]`)) {
      if (!el.getAttribute('aria-label') && !el.closest('label')) {
        issues.push({ type: 'no-label', element: el.outerHTML.slice(0, 100) });
      }
    }
  });
  // Low contrast (basic check)
  // Empty links
  document.querySelectorAll('a[href=""], a:not([href])').forEach(el => {
    issues.push({ type: 'empty-link', element: el.outerHTML.slice(0, 100) });
  });
  return JSON.stringify(issues, null, 2);
})()
```

#### 2d. Broken Links Check
```javascript
// Run in preview_eval
(async function() {
  const links = [...document.querySelectorAll('a[href]')];
  const internal = links.filter(a => {
    const href = a.getAttribute('href');
    return href && !href.startsWith('http') && !href.startsWith('mailto:') && !href.startsWith('tel:') && !href.startsWith('#');
  });
  return JSON.stringify(internal.map(a => ({
    href: a.getAttribute('href'),
    text: a.textContent.trim().slice(0, 50)
  })));
})()
```

Then verify each internal link resolves by navigating to it or checking the network response.

#### 2e. Functional Smoke Tests
Based on what changed, perform basic interactions:
- If a form changed: try filling it out
- If navigation changed: click through menu items
- If a modal/dialog changed: open and close it
- If data loading changed: verify data appears

#### 2f. Mobile Responsiveness
```
preview_resize(serverId, preset="mobile")
preview_screenshot(serverId)
```
Check the same page at mobile viewport. Look for horizontal overflow, tiny text, unreachable buttons, overlapping elements.

Then reset: `preview_resize(serverId, preset="desktop")`

---

## Step 2.5: iOS Testing (when mobile changes detected)

Run this step when the change map (Step 1) shows iOS-relevant changes — anything in `ios/`, `boards/index.html`, `boards/*.js`, `design-system/*`, or `.well-known/apple-app-site-association`.

### Prerequisites (one-time user setup)

The user must have completed these before the skill can run iOS tests. If any are missing, tell them what to set up and skip to web-only testing.

1. **Xcode installed** with command line tools (`xcode-select -p` should return a path)
2. **Physical iPhone connected** via USB/WiFi and trusted
3. **Safari Web Inspector enabled on device** — Settings > Safari > Advanced > Web Inspector = ON
4. **Device registered for development** — Xcode > Window > Devices and Simulators should show the device
5. **`ios/CtrlRodeo.xcodeproj` builds successfully** — user should have built at least once manually

### Verify Device Connection

```bash
# Check connected devices (Xcode 15+ / iOS 17+)
xcrun devicectl list devices 2>/dev/null || xcrun xctrace list devices
```

If no device is found, report it and skip to web-only testing. Don't block the entire QA on this.

### Phase A: Build and Install

Build the iOS app and install it on the connected device:

```bash
# Get the device ID (first connected iPhone)
DEVICE_ID=$(xcrun devicectl list devices 2>/dev/null | grep -i iphone | head -1 | awk '{print $NF}')

# Build for physical device
xcodebuild \
  -project ios/CtrlRodeo.xcodeproj \
  -scheme CtrlRodeo \
  -destination "id=$DEVICE_ID" \
  -configuration Debug \
  build 2>&1 | tail -20
```

If the build fails:
- **Signing errors** → Flag for user (they need to fix provisioning profiles)
- **Swift compilation errors** → These are auto-fixable bugs (typos, missing imports). Classify them in Step 3.
- **Dependency issues** → Flag for user

If the build succeeds, install:
```bash
xcodebuild \
  -project ios/CtrlRodeo.xcodeproj \
  -scheme CtrlRodeo \
  -destination "id=$DEVICE_ID" \
  -configuration Debug \
  install 2>&1 | tail -10
```

### Phase B: Swift Static Analysis

Even if you can't run the app, you can catch issues statically:

```bash
# Swift compilation check (catches type errors, missing imports, etc.)
xcodebuild \
  -project ios/CtrlRodeo.xcodeproj \
  -scheme CtrlRodeo \
  -destination "generic/platform=iOS" \
  build 2>&1 | grep -E "(error:|warning:)" | head -30
```

Review the Swift files that changed for:

#### B1. API Contract Mismatches
The iOS app talks to Supabase directly. Check `ios/Shared/SupabaseClient.swift` and `ios/Shared/Constants.swift`:
- Do endpoint URLs match what the edge functions expect?
- Do request/response models in `Models.swift` match the API?
- If the web app's `boards/index.html` changed its localStorage key format, does the auth bridge in `ContentView.swift` still match?

The auth bridge key is `sb-yfhudwakpgzswiylhfbh-auth-token` — it must match exactly between the web JS (`localStorage`) and Swift (`UserDefaults` via App Group).

#### B2. Auth Flow Integrity
If auth-related code changed, verify the chain:
1. `AuthView.swift` → sends OTP / starts OAuth
2. `SupabaseClient.swift` → `parseAuthFromCallback` parses tokens from URL
3. `CtrlRodeoApp.swift` → handles `ctrlrodeo://auth-callback` deep link
4. `ContentView.swift` → auth bridge JS injection matches web's `window.__iosAuthCapture`

#### B3. Share Extension
If `ios/ShareExtension/ShareViewController.swift` or `ios/Shared/QueueService.swift` changed:
- Verify the extension's `NSExtensionActivationRule` in `Info.plist` still allows URLs
- Verify `QueueService` queue format is compatible between extension and main app
- Check App Group identifier matches in both entitlements files

#### B4. Deep Links and Universal Links
If `CtrlRodeoApp.swift` or `.well-known/apple-app-site-association` changed:
- Parse the AASA file and verify `appID` = `RJ8FB5M6HX.com.ctrlrodeo.boards`
- Verify URL scheme handling covers all `ctrlrodeo://` paths the app uses
- Check `NSUserActivityTypeBrowsingWeb` handler for Universal Link paths

### Phase C: WKWebView-Specific Checks

The iOS app loads `https://ctrl.rodeo/boards/` in a WKWebView. WKWebView has quirks that don't exist in desktop browsers. When `boards/index.html` or related web code changed, check for:

#### C1. JS Bridge Compatibility
The app injects a userScript at document start that intercepts `localStorage.setItem`. If the web code changed how it stores auth tokens, this bridge can break silently. Check:

```javascript
// This pattern in boards/index.html must still exist for the iOS bridge to work:
// localStorage.setItem('sb-yfhudwakpgzswiylhfbh-auth-token', ...)
```

Search the changed files for any modification to localStorage calls involving the auth token key.

#### C2. WKWebView CSS/Layout
WKWebView respects `viewport-fit=cover` and `env(safe-area-inset-*)`. Check that:
- The viewport meta tag still has `viewport-fit=cover`
- Safe area CSS variables (`--safe-top`, etc.) are still applied
- No new fixed/absolute positioned elements ignore safe areas

#### C3. iOS Detection Code
The web app has iOS-specific behavior (app redirect overlay, `window.webkit.messageHandlers` detection). If this code changed:
- Verify the WKWebView detection still works (`window.webkit.messageHandlers.authBridge`)
- Verify the app redirect overlay still shows on Safari but NOT inside the native WKWebView
- Check deep link construction: `ctrlrodeo://auth#access_token=...` format

#### C4. Service Worker in WKWebView
WKWebView has limited service worker support. If `boards/sw.js` changed:
- Verify the service worker registration doesn't throw in WKWebView
- Verify the cache strategy doesn't break first-load in the native app
- Flag any new `navigator.serviceWorker` usage for review (might not work in WKWebView)

### Phase D: Automated Device Tests (if XCUITest available)

If the project has UI tests (check for a `*Tests` or `*UITests` target):
```bash
xcodebuild test \
  -project ios/CtrlRodeo.xcodeproj \
  -scheme CtrlRodeo \
  -destination "id=$DEVICE_ID" \
  2>&1 | tail -30
```

Currently the project has no XCUITest target — skip this unless one is added.

### Phase E: Runtime Check via Safari Web Inspector

If the app is installed and running on the device, you can inspect the WKWebView through Safari Web Inspector. This requires Safari on the Mac:

```bash
# Open Safari (it must be open for Web Inspector to connect)
open -a Safari
```

Then use Chrome/browser tools to navigate to `safari://` — but note: **Safari Web Inspector cannot be automated via CLI**. Instead, flag this as a manual verification step in the report:

> "iOS app built and installed successfully. Open Safari > Develop > [Device Name] > ctrl.rodeo to inspect the WKWebView console for errors."

For the automated portion, rely on Phases B-D (static analysis, build verification, and any XCUITests).

---

## Step 3: Classify Bugs

Every issue found gets classified into one of two buckets:

### Auto-Fix (no approval needed)

These are bugs where the fix is unambiguous and low-risk:

- **Console errors from typos** — misspelled variable/function names, missing semicolons
- **Broken internal links** — href pointing to wrong path (e.g., `/board/` instead of `/boards/`)
- **Missing image alt text** — add descriptive alt based on context
- **CSS issues** — missing styles causing layout breaks when the fix is obvious (e.g., a deleted class that's still referenced)
- **Broken image paths** — src pointing to moved/renamed file
- **Empty href attributes** — links with `href=""` or missing href
- **Obvious typos in visible text** — misspelled words in headings, buttons, labels
- **Missing meta viewport** — mobile pages without viewport meta tag
- **Console warnings about deprecated APIs** — when the modern replacement is clear
- **Dead code references** — imports or script tags pointing to deleted files
- **Swift compiler warnings** — unused variables, deprecated API calls with clear replacements
- **Missing `@objc` or access modifiers** — when the compiler error message tells you exactly what's needed
- **Mismatched bundle paths** — Info.plist referencing wrong storyboard/asset name

### Needs Human Review (flag and report)

These require judgment, have multiple valid fixes, or carry risk:

- **Functional logic bugs** — code that runs but produces wrong results
- **Design/UX regressions** — layout changes that might be intentional
- **API errors** — backend returning errors (might be config/env issue)
- **Security concerns** — XSS vectors, exposed credentials, insecure patterns
- **Performance issues** — slow loading, large bundles, render blocking
- **Data integrity** — wrong data displayed, missing data
- **Auth/permission issues** — access control problems
- **Third-party integration failures** — external services not responding
- **Auth bridge breakage** — any mismatch between web localStorage keys and iOS UserDefaults keys
- **Deep link / Universal Link changes** — routing changes affect how iOS opens the app
- **Share Extension failures** — NSExtensionActivationRule or App Group mismatches
- **WKWebView JS injection changes** — the auth bridge userScript is fragile; any change needs review
- **Provisioning / code signing errors** — user must fix these in Xcode
- **Anything ambiguous** — if you're not sure whether the fix is right, flag it

**When in doubt, flag it.** The cost of flagging something unnecessarily is low. The cost of an autonomous bad fix is high.

---

## Step 4: Spawn Agent Team for Auto-Fixes

If you found auto-fixable bugs, create a team to fix them in parallel. Each fixer agent works in an isolated worktree so there are no conflicts.

### Team Structure

Create one team with you as lead. Spawn fixer agents based on the number and type of bugs:

```
Team: qa-fixes
├── You (team lead) — coordinate, assign tasks, review results
├── fixer-css — handles CSS/styling fixes (web + WKWebView safe area issues)
├── fixer-links — handles broken links and paths (web + AASA)
├── fixer-a11y — handles accessibility fixes
├── fixer-js — handles JS console errors and dead code
└── fixer-swift — handles Swift compiler warnings and simple iOS fixes
```

Only spawn agents for categories where you found bugs. If you only found broken links, just spawn one fixer agent. The `fixer-swift` agent is only needed when iOS code changes produced auto-fixable compiler warnings or simple fixes.

### Fixer Agent Instructions

When spawning each fixer agent, give them:
1. The exact file path and line number of each bug
2. What the current (broken) code looks like
3. What the fix should be
4. The classification rule that made this auto-fixable

Example task for a fixer:

```
Fix these bugs in boards/index.html:

1. Line 234: Broken link href="/board/" should be href="/boards/"
   Context: Internal navigation link to Boards app

2. Line 567: Image missing alt text - <img src="/images/logo.png">
   Fix: Add alt="ctrl.rodeo logo"

3. Line 890: Console error - reference to undefined variable 'boardData'
   should be 'boardsData' (typo, the correct variable is defined on line 445)

After fixing, verify the file still has valid HTML/JS syntax.
Create a commit with message: "fix(boards): broken link, missing alt text, typo in variable name"
```

### Important Fixer Rules

- Each fixer works on a **specific set of files** — no overlapping edits
- Fixers should **read the surrounding code** before making changes
- Fixers must **not refactor or improve** anything beyond the specific bug
- Fixers should **verify their fix** doesn't introduce new issues (e.g., run the page again)
- If a fixer discovers the bug is more complex than expected, they should **report back** instead of attempting a risky fix

---

## Step 5: Create PR with Fixes

After all fixer agents complete:

1. Verify all changes compile/render correctly
2. Take a final screenshot of each affected page to confirm fixes
3. Create a single commit (or squash fixer commits) with a clear message
4. Push and create a PR

### PR Format

```markdown
## Summary
- Automated QA found N bugs after deploy
- M bugs auto-fixed, K flagged for review
- Platforms tested: [Web / iOS / Both]

## Auto-Fixed Bugs
- [file:line] Description of fix

## Flagged for Review (not fixed)
- [severity] Description of issue — why it needs human judgment

## Test Evidence

### Web
- Screenshots of affected pages after fixes
- Console output showing no errors

### iOS (if tested)
- Build result: [success/failed with errors]
- Swift static analysis: [N warnings, M errors]
- Auth bridge check: [pass/mismatch found]
- Deep link check: [pass/issues found]
- Manual verification needed: Open Safari > Develop > [Device] > ctrl.rodeo

## Pages/Screens Tested
- /boards/ (web) — [pass/issues found]
- /boards/ (iOS WKWebView) — [pass/issues found]
- Share Extension — [pass/issues found/not tested]
- Deep Links — [pass/issues found/not tested]
- etc.
```

Assign the PR to `fikei` per project conventions.

---

## Step 6: Report to User

After everything is done, give the user a concise summary:

1. **What was tested** — which pages/apps, based on what changes
2. **What was auto-fixed** — with PR link
3. **What needs their attention** — flagged bugs with enough context to act on
4. **Clean bill of health** — if nothing was found, say so confidently

Keep the report scannable. Use a table for bugs if there are many. Lead with the most important findings.

---

## Edge Cases

### No browser tools available
If Chrome/Preview tools aren't available, fall back to static analysis:
- Parse HTML for broken links, missing alt text, invalid markup
- Check JS for syntax errors with `node --check`
- Verify file references exist on disk
- Report that browser testing was skipped and recommend manual verification

### No Xcode / no device connected
If `xcode-select -p` fails or `xcrun devicectl list devices` shows nothing:
- Skip all of Step 2.5 (iOS testing)
- Still do web testing at mobile viewport (Step 2f) as a partial substitute
- Report: "iOS device testing skipped — no device connected. Web mobile viewport tests ran instead."
- If iOS-specific code changed (`ios/*`), still run Phase B (Swift static analysis via `xcodebuild build`) targeting `generic/platform=iOS` — this doesn't need a physical device

### Xcode build fails on signing
This is common when the provisioning profile expires or the device isn't registered:
- Do NOT try to fix signing issues automatically
- Flag for user: "iOS build failed due to code signing. Please open Xcode, resolve signing, and re-run QA."
- Continue with web-only testing

### Web changes that affect iOS
Changes to `boards/index.html` are especially tricky because the iOS app loads this page in WKWebView. The most dangerous class of bug is a web change that works fine in Chrome but breaks in WKWebView. Common culprits:
- New JS APIs not supported in WKWebView's JavaScriptCore
- CSS features with different rendering in WebKit
- Changes to `localStorage` key names (breaks auth bridge)
- New `navigator.*` API usage (some don't exist in WKWebView)

When web code changes, always check for WKWebView compatibility even if no iOS code changed.

### Supabase function changes
Edge functions can't be browser-tested locally without the Supabase CLI running. For these:
- Check TypeScript syntax: `deno check supabase/functions/<name>/index.ts`
- Verify imports resolve
- Look for obvious issues in the diff
- Flag any API contract changes for human review
- If the function is called by the iOS app (`enrich-link`, auth endpoints), check that `SupabaseClient.swift` request/response models still match

### No changes detected
If git shows no changes from master, ask the user what they want tested. They might want a full-site smoke test, or they might have already merged and want to test the live site.

### Large change sets
If more than 10 files changed across multiple apps, prioritize:
1. Files with the most lines changed
2. User-facing pages over internal utilities
3. New files over modified files (new code = more bugs)
4. Cross-platform files (boards/index.html) over platform-specific files

---

## Version Bumping

If fixes touch application code, bump the patch version per project conventions:
- `boards/index.html`: `const VERSION = 'X.Y.Z'` — bump Z
- Edge functions: `const VERSION` in each `index.ts` — bump Z
