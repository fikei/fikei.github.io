# Bug Classification Reference

Detailed rules for deciding whether a bug can be auto-fixed or needs human review.

## Auto-Fix Decision Tree

```
Is the fix objectively correct? (only one valid fix exists)
├── NO → Flag for review
└── YES
    ├── Could the fix break other functionality?
    │   ├── YES → Flag for review
    │   └── NO
    │       ├── Does the fix touch auth, payments, or user data?
    │       │   ├── YES → Flag for review
    │       │   └── NO
    │       │       └── AUTO-FIX ✓
    └── UNSURE → Flag for review
```

## Auto-Fix Categories (with examples)

### 1. Broken Internal Links
**Pattern:** `<a href="/wrong-path/">` where the correct path is obvious
**How to verify:** Check if the target file/directory exists on disk
**Fix:** Update href to the correct path
**Risk:** Low — worst case the link still doesn't work

### 2. Missing Image Alt Text
**Pattern:** `<img src="..." >` without `alt` attribute
**How to fix:** Infer alt text from:
  - Filename (e.g., `logo.png` → `alt="Logo"`)
  - Surrounding context (heading, caption, nearby text)
  - If purely decorative, use `alt=""`
**Risk:** Low — adding alt text never breaks functionality

### 3. Broken Image/Asset Paths
**Pattern:** `<img src="/old/path.png">` where the file was moved
**How to verify:** `ls` the expected path, search for the file by name
**Fix:** Update src to the actual file location
**Risk:** Low — same as broken links

### 4. Console Errors: Typos in Variable Names
**Pattern:** `ReferenceError: boardData is not defined` when `boardsData` exists
**How to verify:** Search the file for similar names, check git blame for recent renames
**Fix:** Correct the typo
**Risk:** Medium-low — verify the correct variable is in scope at that point

### 5. Console Errors: Missing Semicolons/Syntax
**Pattern:** `SyntaxError: Unexpected token`
**How to verify:** The error message points to exact location
**Fix:** Add the missing syntax element
**Risk:** Low — fixing syntax errors is unambiguous

### 6. Dead Script/CSS References
**Pattern:** `<script src="/js/old-file.js">` where `old-file.js` was deleted
**How to verify:** Check if the file exists and if it was recently deleted in git
**Fix:** Remove the reference (if the script was deleted, it's no longer needed)
**Risk:** Medium — verify nothing depends on what the deleted file provided

### 7. Empty Links
**Pattern:** `<a href="">Click</a>` or `<a>Click</a>`
**How to fix:**
  - If the intended destination is obvious from context, add it
  - If unclear, flag for review
**Risk:** Depends — only auto-fix when destination is unambiguous

### 8. CSS Class References to Deleted Classes
**Pattern:** Element has `class="old-class"` but `.old-class` no longer exists in any CSS
**How to verify:** Grep all CSS files for the class name
**Fix:** Remove the class from the element, or add the CSS if it was accidentally deleted
**Risk:** Medium — check git to determine if deletion was intentional

### 9. Duplicate IDs
**Pattern:** Multiple elements with the same `id` attribute
**How to fix:** Make IDs unique by appending a suffix
**Risk:** Medium — check if any JS references the ID (querySelector, getElementById)

### 10. Console Warnings: Deprecated APIs
**Pattern:** `Warning: <method> is deprecated, use <replacement> instead`
**How to fix:** Only auto-fix if:
  - The browser/runtime suggests the exact replacement
  - The replacement is a drop-in (same arguments, same return value)
**Risk:** Medium — verify API compatibility

---

## iOS-Specific Auto-Fix Categories

### 11. Swift Compiler Warnings: Unused Variables
**Pattern:** `warning: variable 'x' was written to, but never read`
**Fix:** Prefix with underscore: `let _x = ...` or remove if truly dead code
**Risk:** Low — compiler tells you exactly what's wrong

### 12. Swift Compiler Warnings: Deprecated API with Replacement
**Pattern:** `warning: 'oldMethod()' is deprecated: use 'newMethod()' instead`
**Fix:** Only auto-fix when the compiler provides the exact replacement AND it's a drop-in
**Risk:** Medium — verify the replacement has the same behavior

### 13. Missing `@MainActor` or `Sendable` Conformance
**Pattern:** `warning: ... is not sendable` in Swift concurrency
**Fix:** Only auto-fix when the fix is adding `@MainActor` to a view or `Sendable` to a simple data struct
**Risk:** Medium — concurrency changes can have subtle effects. Only fix when obvious.

### 14. Info.plist Mismatches
**Pattern:** Plist references a file/identifier that doesn't exist
**Fix:** Update to the correct identifier (e.g., storyboard name changed)
**Risk:** Low — the app won't launch without the correct reference anyway

### 15. Mismatched Entitlements
**Pattern:** App Group identifier in entitlements doesn't match `Constants.swift`
**Fix:** Only auto-fix if the correct value is obvious from `Constants.swift`
**Risk:** High — get this wrong and the Share Extension can't communicate with the main app. Flag for review unless it's a clear typo.

---

## iOS: Never Auto-Fix

### Critical iOS patterns that always need human review:

1. **Auth bridge changes** — the JS injection in `ContentView.swift` that intercepts `localStorage.setItem` is the single most fragile piece of the iOS app. Any change to the auth token key (`sb-yfhudwakpgzswiylhfbh-auth-token`), the injection script, or the `window.__iosAuthCapture` code in `boards/index.html` MUST be reviewed by a human.

2. **App Group / Keychain changes** — the shared storage between the main app and Share Extension. A mismatch means the extension silently fails.

3. **URL scheme changes** — `ctrlrodeo://` deep link handling. Breaking this breaks magic link auth flow on iOS.

4. **Universal Link AASA changes** — the `.well-known/apple-app-site-association` file. Apple caches this aggressively; mistakes are hard to undo.

5. **Provisioning / code signing** — never attempt to fix. Only the user can resolve these in Xcode.

6. **SwiftUI view hierarchy changes** — the state machine (AuthView → UsernameView → BoardsWebView) has specific ordering. Don't rearrange.

7. **WKWebView configuration** — `WKWebViewConfiguration`, `WKUserContentController`, or `WKScriptMessageHandler` changes affect how the web content runs inside the native app.

8. **Network security / ATS** — App Transport Security exceptions. Changing these affects what domains the app can connect to.

---

## Web: Never Auto-Fix

These patterns should always be flagged for human review:

1. **Any change to authentication logic** — login, logout, session handling, tokens
2. **Any change to data mutations** — create, update, delete operations
3. **API endpoint changes** — URL, method, headers, body format
4. **Environment-specific code** — anything that behaves differently in dev vs prod
5. **Third-party SDK updates** — version changes, API migrations
6. **Database queries or schema** — any SQL or ORM changes
7. **User-visible text changes** — unless it's a clear typo (misspelling)
8. **Layout changes** — unless clearly broken (element at x:-9999)
9. **Conditional logic** — if/else, switch, ternary changes
10. **Event handlers** — click, submit, change behavior modifications
11. **State management** — variable initialization, state updates
12. **Anything you'd want a second opinion on** — trust your gut
