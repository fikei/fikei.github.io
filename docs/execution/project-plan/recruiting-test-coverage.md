# Recruiting — test coverage user stories

Full footprint of testable functionality in the Recruiting product (`applications/` frontend + `supabase/functions/recruit-*`, `discord-membership`). Each story is one testable behavior. Grouped by area; numbered continuously so stories can be referenced individually.

Status legend (fill in as coverage lands): ☐ untested · ◐ partial · ☑ covered

---

## A. Authentication & access control

1. A visitor who is not signed in sees the Discord sign-in gate, not applicant data.
2. A signed-in Discord user who is **not** in the Recruiting Society channel is denied with the gate message and fallback sign-in options.
3. A Recruiting Society member passes the gate and sees the app.
4. A member who can see `#recruiting-automation` is treated as admin (house settings editable); others see values disabled with attribution line.
5. An admin who loses `#recruiting-automation` access has their `recruit_admins` row removed on next verify.
6. Stale membership cache (>7 days) triggers auto re-verify; fresh cache is served without a Discord call.
7. Discord API down: fresh cache is returned; stale cache returns an error (no silent grant).
8. First sign-in with an email on `recruit_group_roster` auto-seeds `recruit_profiles` (display name, group email).
9. Sign-in tokens expire after 10 minutes and are burned on first redemption (second redeem fails).
10. All gate outcomes (pass, no-channel, not-linked, error) are logged to `recruit_auth_events`.

## B. Application ingest

11. A new sheet/push row creates a `recruit_applicants` record in `stage='review'`.
12. Ingest dedupes by email (case-insensitive) — re-submission does not create a second applicant.
13. Duplicate emails within one batch: most recent submission wins, one row inserted.
14. ID slugs collide → numbered suffix (`-2`, `-3`); legacy timestamp IDs never collide with numbered form.
15. Flexible header mapping: renamed sheet columns still map via regex patterns; full name splits into first/last when no separate fields.
16. `dryRun: true` returns mapping preview and writes nothing.
17. Cron auth: valid one-time nonce accepted and burned; reused nonce rejected; shared-secret path works.
18. Sheets 403 (scope not granted) returns the specific reconnect error, not a generic failure.
19. Review-comment import creates `recruit_comments` + `recruit_votes`, matching authors to roster by fuzzy name; only unmistakable verdict language becomes a verdict.
20. Successful import posts an audit embed to the automation channel.

## C. Inbox (review) & verdicts

21. Inbox lists only `stage='review'` applicants; badge count matches.
22. Opening a row records `recruit_applicant_views` and clears the "new" response dot for that user only (persists across devices, not across users).
23. Decision sheet: Save is disabled until a verdict is picked **and** a comment is entered (comment required, ≤2000 chars).
24. **Not a fit** → stage `rejected`, applicant leaves Inbox, update email queued (respecting `update_email_default`).
25. **Needs input** → applicant stays in Inbox; "wants another read" notification posted once; prior reviewers see verdict + who asked.
26. **Move forward** → stage `candidate`; auto-placement sweep runs in the same pass.
27. Optional "attach to a listing" appears only for Move forward and scopes to valid listings.
28. Stage recompute is DB-trigger-driven (`recruit_recompute_stage`); direct client writes to `recruit_applicants.stage` are rejected by RLS.
29. Verdict undo: row fades with outcome chip + 6s Undo; row does not move during the window; Undo restores without a compensating write.
30. Reopening a decided applicant softens the verdict to `needs_input` and keeps the comment.
31. Overlay navigation: Previous/Next and arrow keys cycle the filtered queue in view order; progress "X of Y" is correct.
32. Auto-advance after a decision shows the banner describing the outcome on the next applicant.
33. Note draft survives navigating between applicants; cleared only on save or cancel.
34. Legacy sheet-imported verdicts display "from the application sheet" and become editable once that roster email signs in.
35. Empty Inbox shows the "All caught up" state.

## D. Candidates & auto-placement

36. Candidate qualifying for ≥1 open listing shows a placement pill per active placement (`Room · M/D`).
37. Candidate qualifying for nothing shows the waiting state (no pills, no CTA).
38. Auto-placement qualification: track match; budget ≥ rent only when both known; move-in window inside listing window.
39. "Flexible" move-in rides any window (± `movein_flex_months`, default 1); "ASAP" fits rooms opening within 1 month.
40. One active placement per applicant enforced (unique partial index); tombstoned removals are exempt and never re-added by the sweep.
41. Manual placement beats auto-sweep; adding a manual placement drops the previous active one.
42. Tie-breaking order: closest start to confirmed move-in → earliest start → lowest id; deterministic run-to-run.
43. Sweep runs on: candidate stage change, "bring back now", move-in confirmed — and leaves existing placements alone.
44. Manual placement that doesn't auto-qualify sticks, with a toast explaining it.
45. Draft listings are ignored by the sweep (only `status='open'` qualifies).

## E. Openings view & CTA state machine

46. Listings group open-first then draft; draft cards (dashed) offer one-click Open and Dismiss.
47. Occupancy gaps ≥28 days in the next 6 months auto-generate draft listings (source `gap`/`leaving`), posted once (O1 notification).
48. Fresh placement (no email) → primary CTA "Get started".
49. We emailed, no reply → "Follow up" with `sent Nh ago` context; turns amber after `followup_stale_days` (default 3).
50. Manual-scheduling language detected → "Invite promised" chip + Follow up.
51. They replied, no availability parsed → blue dot + "Reply" primary.
52. Availability windows on file, no screening → "Review times" primary with window count.
53. Call booked → slot chip + "Join call" (when Meet link exists) + claimer context.
54. Post-screening (recording or completed call) → "Schedule visit" primary + Watch secondary; `no recording` context when absent.
55. Exactly one primary CTA per row; someone else's move renders as a chip, not a button.
56. ⋯ menu contents are state-dependent: Copy availability link only with windows; Give decision only post-call.
57. Drag row to another listing moves the placement (source deleted, target added); drag within a group reorders.
58. "See other qualified applicants" expander splits Moved forward (with "Move here" CTA) vs Not reviewed yet (no action); excludes archived and needs-input.
59. Listing at-risk/overdue notifications fire at the documented thresholds (≤21d daily, ≤7d now, past-date now + on-call escalation).
60. ✕ on a placement removes from that listing only (tombstone) and the tooltip names the scope.

## F. Removal & exit flows

61. Remove sheet offers the four outcomes in least→most-final order with correct copy per option.
62. **From this listing**: placement tombstoned; applicant stays candidate elsewhere; no email.
63. **Save for future**: stage candidate, all placements cleared, return date defaults +3 months; auto-return fires when the date passes; "Bring back now" works during the saved period.
64. **Opted out**: archived, no update email.
65. **Not a fit** (from remove sheet): rejected + update email queued.
66. Exit metadata persisted via `recruit_set_exit` RPC (reason, until, note, by, at); date field shown only for Save for future.
67. Removal undo: 6s window, row frozen, no reflow; re-render flushes held rows.
68. Archive view chips reflect exit reason and flip to "Update sent [date]" after the update email goes out.

## G. Screening claim & scheduling (Discord)

69. Discord PING and button interactions pass Ed25519 signature verification; invalid signatures rejected.
70. Claim custom_id `claim|<applicantId>|<epochMs>` parses correctly (epoch format, no ISO-colon collisions).
71. First-write-wins: two simultaneous claims → exactly one wins (`UPDATE WHERE status='open'`); loser gets a clear response.
72. Successful claim: ACK within 3s, then calendar event + Meet link created, Discord post edited to claimed, claimer DM'd, applicant intro email sent (reply-in-thread when a thread exists).
73. Claim by non-recruiting member is rejected.
74. Claim failure after the atomic win never reopens the post; claimer is DM'd the manual-booking path.
75. Shadow-email claimer (`discord-<id>@signin.ctrl.rodeo`) falls into the manual-booking path — no invite sent to a synthetic address.
76. Booking in-app closes any open claim post for that applicant.
77. Stuck claim posts (>96h open) get one channel nudge per post.
78. House calendar 403/404 falls back to `primary` and logs loudly.
79. Recall bot added as attendee with `sendUpdates=none` after human invites; missing bots are backfilled by the 15-min sweep.
80. Reminder DM ~1h before intro calls fires once (`reminder_sent_at`), only for `kind='intro_call'`, and checks GCal liveness first — cancelled events mark the screening cancelled silently.
81. Past-end calls flip to `completed`; live calls starting ±5min get one members-channel announcement.
82. Swept calendar events with unrecognized external guests trigger one unmatched-call DM per event.

## H. Applicant availability & email extraction

83. Public availability endpoint: valid `schedule_token` returns first name + saved windows; invalid token → 404.
84. Window validation: date/time regex, start < end, 1–14 windows; violations → 400.
85. Saving windows triggers the Discord claim post; Discord being down never blocks the applicant's save.
86. Gmail scan matches inbound mail to applicants by from-address and logs `recruit_emails` with direction, snippet, thread id (unique on gmail_id — no duplicate rows on re-scan).
87. Haiku extraction resolves relative dates forward (never past), converts stated timezones to Pacific, maps day-parts (morning 9–12 etc.), caps at 10 windows ≥30 min.
88. Intent classification: nine intents; confidence <0.6 → `unclear`; parsed availability overrides classifier for availability.
89. High-urgency intents (reschedule, withdrawing, plans_changed) route to the Now lane; ledger rows recorded per reply kind.
90. Agreed-time detection is conservative: both sides converge on one specific date+time; autoschedule only on high/medium confidence, future, within 60 days, one call per applicant, and only when `email_autoschedule=true` (default off).
91. Autoschedule only applies to applicants in `review` or `candidate` stage.
92. Send-via-Gmail logs the outbound to `recruit_emails` with sender name; sync pulls both directions.

## I. Tour polls

93. Tour in `asked`/`polled` with extracted windows → poll posted with Tue–Thu 5–7pm slots (5/6/7pm on qualifying days).
94. No overlap with preferred hours → raw windows posted with `off_hours=true` flag.
95. Tour vote toggle: same user + slot votes again → vote withdrawn (unique-constraint toggle); counts stay accurate.
96. Vote count reaching `tour_confirm_votes` threshold auto-confirms: status `confirmed`, confirmation email sent, poll updated.
97. Poll refresh on new windows edits the existing Discord message rather than posting a duplicate.
98. Confirmed tour records `confirmed_slot`, `confirmed_count`, and the confirmation gmail id.
99. Cancelled/re-dated tours re-run the scheduling ladder with the new date.
100. Tour emails (recruit-match visit drafts) include unanswered questions from the thread ("added" array).

## J. Recordings & watch links

101. `recruit-watch` with a valid token returns nameless title, timestamp, summary, and a 6-hour signed URL.
102. Bad-format, unknown, or revoked tokens are indistinguishable 404s; revocation = share_token NULL.
103. Legacy 64-char tokens and their 20-char prefixes both resolve (backward compat).
104. Screening with `recall_status='done'` but no `recording_path` is archived by the sweep; `media_expired` handled without crash.
105. Recording without archive returns `url: null` + reason (no 500).
106. Watch modal: playback speed persists via localStorage; pop-out PiP toggles; app-level docked player survives navigation and re-inlines on the Call tab.
107. Orphaned calendar event link (`?link=<event id>`) opens the link modal; searching + selecting an applicant associates the recording.
108. Post-screening decision modal ("Would you accept them?") tallies yes/no with names and optional line for the house.

## K. Occupancy, trials & promotion

109. Stays render by room/date range with kind (resident | sublet | candidate | shared); clicking opens the drawer.
110. Trial-candidate stays get `checkin_on` (start +1mo) and `decision_on` (end −1mo) defaults; both editable; check-in must be inside the trial window and decision after check-in.
111. Changing a stay to non-trial clears both milestone dates.
112. Trial decision reminder posts 7 days ahead, once; moving the date clears the stamp; backdates >14 days stamp silently.
113. Trial vote ladder: nudges 4 days out + morning of meeting; escalation milestones logged to the ledger.
114. Promotion ("Welcome them in") is one transaction: trial closed day-before, open-ended residency opened, stage → `resident`, listing placements retired.
115. Promotion works from both entry points: candidate applicant and orphaned trial stay (no applicant link).
116. Onboarding checklist seeds on promotion; ticks record who/when; items unticked 14 days later fire the weekly notification.
117. Residents are excluded from all funnel views/badges.
118. Occupancy conflicts (overlapping stays in one room) surface the conflict notification.

## L. Notification ledger & delivery

119. Every notification writes a ledger row **before** dispatch; the log is complete even when delivery is muted or fails.
120. `dedupe_key` uniqueness: identical condition fires once; changed segment (date moved, step escalated) re-fires; unsent rows are deleted when the underlying fact changes.
121. Lane routing: Now → immediate post; Daily → 8:30am PT digest as one embed with counted sections; Weekly → Monday roll-up.
122. `notify_house_posts=false` keeps everything in the automation channel; flipping it routes to members channel.
123. Muted kinds (`notify_muted`) suppress Discord delivery but still log.
124. ≥4 notifications of one kind in a pass collapse to a line list; escalation moves lanes rather than re-posting daily.
125. Activity view lists newest-first grouped by day, with delivery meta (housemates / escalated / DM / automation / muted / not sent yet) accurate per row.
126. Resolve stamps `acked_at` (per row and per subject via RPC); Unresolved filter and Activity badge count track acks.
127. Kind-chip filters show only kinds actually present; clicking a subject navigates to the right surface (applicant → review, listing → openings, stay → occupancy).
128. Discord replies to bot notification posts become house notes (author = Discord username, source `discord`), deduped by message id, accepted only from recruiting members.

## M. Settings

129. Schema-driven render: all six sections appear with correct field types and scope routing (house → recruit_settings, profile → recruit_profiles, local → localStorage).
130. Autosave: toggles/selects save immediately, text on blur; "Saved" flash appears; no Save button exists.
131. Non-admin house/funnel fields are visible but disabled, with who-decided attribution; admin writes succeed (RLS `is_recruiting_admin()`).
132. Defaults from the schema apply when no DB row exists; `setting()` resolves scope without caller branching.
133. Funnel numbers flow through: changing `followup_stale_days` changes amber threshold; `movein_flex_months` changes sweep padding.
134. Connections section reflects real state (Gmail connected/reconnect-needed with who connected; Discord channel ids; Recall optional).
135. Data export produces a CSV of decisions, verdicts, and comments.

## N. Outreach emails & update queue

136. AI email modal drafts per kind (outreach, follow-up, visit, decision) with subject + editable body; Regenerate produces a new draft.
137. Email classification (classifyOutreach) picks the right template from thread + call state deterministically.
138. Send via Agape Gmail sends from the shared account and logs to `recruit_emails`; Open in Mail and Copy work.
139. Rejection queue: not-a-fit decisions enqueue an update email; Edit and Skip work per person; "Send all" batches.
140. Sent updates stamp `update_email_sent_at` and flip the archive chip.
141. Rejection personalization (Sonnet) produces the warm middle paragraph from the applicant's survey; AI failure degrades to the template, not a crash.
142. `open_to_couples` setting changes couple-flag severity in match suggestions.

## O. Parsing, filters & display

143. Move-in normalization covers: exact date, month-year, month range, explicit range, ASAP, Flexible, unparseable → blank; info-dot shows raw text when normalized differs; recruiter-confirmed window replaces parsed.
144. Budget normalization covers: `$2k`, `2000–2500`, `up to X`, `X+`, flexible; numbers filtered to 300–10000; buckets (<2k / 2–2.5k / >2.5k) match the filter bar.
145. Filters (track, move-in month, budget) compose, persist across views, and Clear appears only when active; empty-filter state distinct from empty view.
146. Link extraction finds all supported platforms + bare domains, dedupes, filters stopwords, renders correct icons.
147. Avatar pipeline: candidate priority order (GitHub → X → IG → TikTok → FB → bare handle → Gravatar); NULL=unchecked vs ''=none; backfill paces 2.5s; initials fallback renders.
148. Subline grammar renders track badge, pronouns (lowercase only when given), and canonical move-in per spec.
149. Response dot semantics differ by view: Inbox = you haven't opened; elsewhere = last email direction is inbound.
150. Mobile: top bar + rail scrim work; tap opens the review overlay.

## P. Diagnostics & misc

151. Boot logs `[applications] vX.Y.Z`; cache-bust guard warns when CSS/JS `?v=` mismatch.
152. Toasts appear for errors/confirmations and auto-dismiss.
153. Second-opinion action posts an "AI · second opinion" comment.
154. Cron nonces purge after 1 hour; all cron endpoints reject missing/expired nonces.
155. RLS spot-checks: applicants read-only to members; comments writable/deletable only by author; screenings insert service-role only; notifications write service-role only.

---

*Derived from `applications/index.html` + `app.js` (v3.68), `docs/ux/row-states.md`, `docs/strategy/prds/*recruiting*`, `docs/infrastructure/technical-design/recruiting-*`, and the recruit-* edge functions, 2026-08-05.*
