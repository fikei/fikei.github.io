# Voice — iOS app brief

**Status:** Draft v1 · 2026-09-12
**Owner:** Ian
**Design references:** [Design canvas](https://claude.ai/code/artifact/28111ab1-58f7-447f-b6e1-8309fa638a4f) · [Web prototype](https://claude.ai/code/artifact/df0882fd-d4db-4b64-89e0-f2f24d75c4ab)

---

## 1. What it is

Voice is a voice-first messaging app for small groups where an AI agent is a first-class participant. People talk; the agent listens, transcribes, summarizes, extracts actions, and — when it actually can — takes the next step.

**Core model:**
- **Threads are projects, not people.** Every thread is an intent/task/project group chat, auto-named by the agent from its first voice note (renameable). Members are invited per thread.
- **Two surfaces per thread:** **Chat** (voice notes, text, files, agent cards interleaved) and **Actions** (daily digest + open action items with review states).
- **Every voice note carries** a micro-summary and an expandable transcript. Audio is never a dead end.
- **Confirm-first:** nothing enters the system of record without a human tap (Keep / Dismiss). Scheduling intents are captured as ordinary actions ("Schedule: …"), not automated in v1.
- **Agent next steps:** an action gets a tailored "Claude takes the next step" chip only when the agent can actually do it. Steps above a complexity bar (money, bookings, anything hard to reverse) open **Claude's brief** — a 1:3:1 trade-off (headline question, three bullets, recommendation) plus Risks, Scale, Implications — with explicit Proceed / Not now.

## 2. Why native iOS

- **Capture is the product.** Friction at the moment of speaking kills it. Native gets: lock-screen/Dynamic Island recording, Action Button mapping, background audio, interruption handling (calls, CarPlay), and offline capture with deferred upload.
- **Push is the loop.** Agent replies, keep-requests, and digests need real notifications with actions (Keep / Dismiss from the banner).
- **Share sheet + Siri.** "Add this to the Tahoe thread" from anywhere; App Intents for "record a note to Voice."
- The web prototype stays as the desktop companion; iOS is the primary capture surface.

## 3. MVP scope (v1)

**In:**
1. Threads list (auto-named project threads, unread, per-thread open-action counts).
2. Thread view with Chat / Actions tabs (swipe between).
3. Record → upload → transcribe (Groq Whisper) → summarize + extract actions (Claude Sonnet) → agent card in thread. Target: summary visible < 10s after note ends.
4. Micro-summary + expandable transcript on every note.
5. Keep / Dismiss review; Actions tab with daily digest (digest lives in Actions only, not Chat).
6. Agent next-step chips (tailored, capability-gated) with the complexity-gated brief sheet. v1 executable steps are deliberately narrow: draft-and-propose actions (calendar hold proposals, option shortlists) — nothing that spends money without the brief.
7. Text messages and file attachments in threads (files land in a per-thread folder).
8. Push notifications: new note summary, keep-request, daily digest.

**Out (phase 2+):**
- Linear sync (scoped separately: Keep creates an issue in a dedicated "Voice notes" project, confirm-first, Ian's API key as Supabase secret, `owner:<name>` labels; digest reflects issue state).
- Calendar automation (v1 only captures "Schedule:" actions and proposes; no event writes).
- Android, iMessage/WhatsApp relays (transport work is paused).
- In-thread agent Q&A ("catch me up") — fast follow after MVP.

## 4. Architecture

**Client (Swift/SwiftUI):**
- SwiftUI app, iOS 17+. AVAudioEngine capture → m4a (AAC) chunks; local queue with retry (offline-first).
- Push via APNs; notification actions for Keep/Dismiss.
- App Intents (Siri + Action Button), Share extension (files/links into threads).
- Realtime thread updates via Supabase Realtime subscription.

**Backend (existing ctrl.rodeo Supabase pattern — Ops project):**
- Tables: `voice_threads`, `voice_thread_members`, `voice_messages` (voice/text/file/agent), `voice_actions` (status: suggested/confirmed/dismissed; agent-step state), `voice_files`. Storage bucket for audio + attachments. RLS per thread membership.
- Edge functions (versioned per repo convention):
  - `voice-ingest` — receives uploaded audio, calls Groq Whisper (`whisper-large-v3`), stores transcript.
  - `voice-agent` — Claude Sonnet with rolling thread context: micro-summary, thread naming (first note), action extraction, agent-card reply, complexity classification + brief generation for executable steps.
  - `voice-digest` — daily cron per thread; stale-action resurfacing (>48h suggested).
  - `voice-push` — APNs fan-out.
- **Keys:** `VOICE_ANTHROPIC_API_KEY` (dedicated `voice-notes` Console workspace, $50 cap, fallback to shared key — Ladder pattern), `GROQ_API_KEY`.

**Cost posture:** Whisper-on-Groq ≈ free at this volume; Sonnet per note ≈ cents. Two-digit monthly ceiling at 2-person usage.

## 5. Design system

Warm-dark "Claude-inspired" theme on the **Ladder token contract**: Inter body + Lora display, teal accent (`#2F8A74` fills / `#63C4AB` links & chips) reserved for actions, Wise structural rules (radius scale, pill-is-semantic, sentence case, 40/48pt controls, dismissed = reduced opacity). Ships as a `tokens-*-dark` slot so the CTRL theme can swap in. iOS maps tokens to SwiftUI semantic colors; SF Symbols replace the web line icons where native.

Key components (see canvas Components sheet): voice bubble (play pill, waveform, micro-summary, transcript disclosure), agent card, action row (suggested/kept/dismissed/linked), next-step chip, brief sheet, digest card, composer (attach + text + mic).

## 6. Risks & open questions

- **Recording UX vs. App Review:** background/lock-screen capture needs correct audio session categories; test early.
- **Alex onboarding:** invite flow + auth (Supabase auth; Sign in with Apple required on iOS).
- **Transcription of cross-talk / names:** Whisper is strong but thread-name and owner attribution need prompt care in `voice-agent`.
- **Agent-step safety:** the complexity classifier gates the brief; default to brief when uncertain. Money movement stays out of v1 executable steps entirely.
- **Push volume:** one notification per note + digest; batch agent cards into the note's notification.

## 7. Milestones

1. **M0 — Pipeline spike (backend only):** tables + `voice-ingest` + `voice-agent`; drive from the web prototype against real data.
2. **M1 — Capture app:** record/upload/threads/chat tab on device; TestFlight to Ian + Alex.
3. **M2 — Actions loop:** Actions tab, keep/dismiss, digest, push.
4. **M3 — Agent steps:** next-step chips + brief sheet, first executable step (dinner-time proposals).
5. **Phase 2:** Linear sync, calendar writes, catch-me-up.

**Definition of success (M2):** Ian ↔ Alex run one real project thread for two weeks; ≥80% of notes produce a correct action set with ≤1 tap of correction; both check the app's digest instead of asking "wait, what did we say?"
