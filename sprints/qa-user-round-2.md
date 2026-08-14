# QA-User — mvp Round 2

## Variant: ui
## Depth: deep (items 12-17 attempted; most blocked by the auth failure below — see per-item notes)

## Build observed
Login screen was the "Sign in / SEO Platform · Crawler POC dashboard" card (white card, centered,
light theme, mail/lock icon inputs, blue "Sign in" button on a light-grey page background). No
sidebar/topbar redesign was visible at any point — if a sibling agent was mid-redesign, it had not
landed on the build I tested. Server: `npx next start -p 3985` after a clean `npm run build` (both
succeeded with no errors, only a Next.js static-analysis warning about `lib/mutes.ts` file tracing,
not a build failure).

## HEADLINE FINDING — the documented QA credentials do not authenticate

I could not get past `/login`. Every other item in the dispatch's priority list (2 through 6) is
**NOT TESTED** as a direct consequence — not because I inferred failure, but because there is no
way to reach the screens in question without a session.

**Evidence.** Filled the login form with exactly the credentials given to me:
- Email: `qa-user@seo-platform.test`
- Password: `<QA-PASSWORD-REDACTED>` (read from `.env.local.example`'s `SEED_QA_PASSWORD` line,
  as instructed)

Captured the actual outbound request via Playwright network interception (values shown are the
literal field values Playwright confirmed were in the DOM inputs before submit — 25 chars email,
24 chars password, matching the documented string exactly, no whitespace/typo):

```
POST https://jlmdsrrwfczgryilsjsy.supabase.co/auth/v1/token?grant_type=password
apikey: sb_publishable_6Zg8tingbXWCH_PGIixUyw_tw3Pc9eq
body:   {"email":"qa-user@seo-platform.test","password":"<QA-PASSWORD-REDACTED>","gotrue_meta_security":{}}

RESPONSE 400
{"code":"invalid_credentials","message":"Invalid login credentials"}
```

Reproduced twice, 8 seconds apart (in case of eventual-consistency lag right after seeding) — same
`400 invalid_credentials` both times. Screenshots: `auth-02-postlogin.png` (UI showing "Invalid
login credentials" in red under the password field).

This is not a client bug: the request payload the browser sent is byte-identical to what I was
told to send, hits the correct project (the one the app's own `NEXT_PUBLIC_SUPABASE_URL` is wired
to — same host that all other requests on this page also depend on), and Supabase's own Auth
service is the one rejecting it. I did not read source or config to reach this conclusion — it is
read straight off the network tab, which is within the framework's mandate ("capture console and
network on every screen").

One more data point I noticed without acting on it: `.env.local.example` (re-read at the top of
this session) still literally says `STATUS: NOT YET CREATED` in its header comment, and describes
the seed step as "PREPARED, not executed" — the file itself was not updated to reflect that the
account had since been seeded. I'm not asserting that's the cause (I can't see the seed script's
actual run or its target project), but it's consistent with "the seed step did not complete
against the project this build talks to" and is worth Main Claude's direct check.

**Severity: critical.** This blocks Core Element 1 in brief.md ("A crawl actually completes and is
cancellable for real. Start, watch it live, stop it...") completely — a real user with the
documented, sanctioned credentials cannot reach the crawl UI, the Stop control, the issues screen,
the health score, or any of the other Core Elements at all. It also directly contradicts this
round's premise ("the blocker is cleared") — from a QA-user perspective walking the real flow, it
is not cleared.

---

## Mental framework walkthrough

### Q1: Can I do the thing the brief said?
- **Verdict: FAIL.**
- **Evidence:** see headline finding above. Cannot reach any authenticated screen — cannot start a
  crawl, cannot view Activity, cannot view Issues, cannot check the health score.
- **What I could still verify:** the *unauthenticated* half of the workflow contract — see Q2.

### Q2: First-login empty state (here: first-VISIT state, since login itself is the gate)
- **Verdict: PASS.**
- Fresh browser, no cookies, navigated to `http://localhost:3985/` → clean 307 redirect to
  `/login?next=%2F`. Full `document.body.innerText`:
  ```
  Sign in
  SEO Platform · Crawler POC dashboard
  Email
  Password
  Sign in
  ```
  No sidebar, no topbar, no nav element (`document.querySelectorAll('nav').length === 0`), no run
  names, no leaked chrome of any kind.
- Navigated directly to a protected route while unauthenticated (`/pages`) → redirected to
  `/login?next=%2Fpages`, same bare card, `next` param correctly preserves the intended
  destination for a post-login bounce. Same clean body text, no leak.
- No console errors, no 4xx/5xx network responses on either load.
- Screenshots: `smoke.png` (root → login redirect), `check-login-dom` run output (body text dump).

### Q3: What breaks when I do something weird?
Tested everything reachable — the login form is the only input surface available to an
unauthenticated user. All boundary cases handled gracefully, no crashes, no console errors, no
unhandled exceptions:

| Case | Result |
|---|---|
| Empty submit | Native browser "Please fill out this field." validation tooltip on the Email input; form does not submit; no network call made. Screenshot `boundary-01-empty-submit.png`. |
| 10,000-char email + 200-char password | Native validation let it through (10k-char string is still syntactically a valid local-part+domain to the browser), request sent, server returned the same generic `Invalid login credentials` — no crash, no layout break, no truncation-induced garbage. Screenshot `boundary-02-huge-input.png`. |
| Emoji + `<script>alert(1)</script>` in email, `'; DROP TABLE users;--` in password | Browser's native email-format validator caught it before any network call: `"A part followed by '@' should not contain the symbol '😀'."` No script executed, no server round-trip, no console error. Screenshot `boundary-03-emoji-special.png`. |
| Rapid double/triple-click on Sign in (real creds, still invalid) | Single coherent error message, no duplicated/garbled UI state, no unhandled promise rejection in console. Screenshot `boundary-04-rapid-click.png`. |
| Browser back mid-action | Went to `about:blank` — this is the browser's own history boundary (only one prior SPA entry existed in the isolated test), not an app defect; re-verified in an isolated fresh context and confirmed same expected browser behavior. Not a bug. |
| Refresh mid-submit (network delayed 3s via route interception) | Refresh cleanly returns to a fresh, **empty** login form — no stuck spinner, no ghost "Signing in..." state surviving the reload, no console error. Screenshots `isolated-refresh-before.png` (shows the honest "Signing in…" loading state pre-refresh) / `isolated-refresh-after.png` (clean reset). |
| Keyboard-only fill + Enter to submit | Tab order Email → Password → Submit button, all three reachable; Enter key submits the form correctly (produced the same invalid-credentials flow as a click). |

- **Verdict: PASS** for everything testable on this one screen. Cannot test boundary inputs on any
  authenticated screen (settings, crawl config, filters, search boxes) — **NOT TESTED**.

### Q4: Does output match what was generated?
- **NOT TESTED.** No crawl could be started; no output (score, findings, evidence, activity log)
  exists to check.

### Q5: What's slow / confusing / off? (intuition bucket)
- The generic `Invalid login credentials` message is standard/correct Supabase behavior (doesn't
  leak whether the account exists) — fine as-is, not a complaint.
- No "forgot password" or self-serve recovery link on the login card. For a single QA/internal
  account this is plausibly intentional — **[owner-opinion]**: worth asking whether that's wanted
  before the tool has real named users.
- Native browser validation tooltips (grey/white OS-style popover) look visually disconnected from
  the app's own white-card / blue-button styling — functionally correct, just an aesthetic seam —
  **[owner-opinion]**.

### Q6: Does this feel like another org tool?
The brief explicitly overrides the standard design system for this build (`design_system:
port-from-predecessor — NOT BMW M`), so the mechanical `<StageComponent>` / display-font / glow /
portal checks from `org-tool-conventions` §6 do not apply here by design — I did not run them
against that spec since the brief pre-empts it. What I can say about what I *did* see: light theme,
white centered card on a flat light-grey (`#f2f3f1`-ish) background, `Inter` font
(`inter_ce929fb-module` variable font class on `<html>`), `data-theme="light"` attribute present
(confirms the app has a theme system wired even though I couldn't reach a toggle). Clean, minimal,
internally consistent on this one screen. No opinion possible on the rest of the shell (Overview,
Pages, Issues, etc.) since none of it was reachable.

### Q7: What's good?
- Bare, leak-free unauthenticated state — this was explicitly on the checklist and it's correct.
- `next` param round-trips correctly through the login redirect (`/login?next=%2Fpages`) — a real
  post-login bounce-back is wired, even though I couldn't complete a login to confirm the bounce
  actually lands.
- Honest, visible "Signing in…" loading state on submit (button disables and re-labels) — exactly
  the "purposeful loading, not a frozen screen" behavior the framework asks for.
- Native HTML5 form validation correctly blocks malformed email (including the XSS-shaped payload)
  before it ever reaches the network — no wasted round-trip, no injection risk from this vector.
- Refresh mid-submit self-heals cleanly with no stuck state.
- Full keyboard operability on the one form available (Tab order + Enter-to-submit both correct).
- `/api/health` → `{"ok":true}` and `/api/ready` → `{"db":"not-applicable","storage":true,
  "queue":"not-applicable","ok":true}` — the server itself is healthy and answering; this specific
  environment's `storage:true` also means the "artifact storage not configured" degraded state
  (acceptance criterion #11) is **not reproducible here** even setting auth aside (see item 3
  below) — that's a positive read on this environment, but means I could not exercise the negative
  path.
- `npm run build` completed clean (only a non-fatal static-analysis file-tracing warning on
  `lib/mutes.ts`, not an error) and the server boots in under 400ms.

### Q8: Would I use this tomorrow?
No — not because of anything in the product itself, but because I cannot get in. A real consultant
handed these exact credentials today would be fully blocked at the door. Until the account
authenticates, there is no tool to evaluate.

---

## Per-priority-item verification (dispatch's numbered list)

**1. Authentication flow.** Sign-in: **FAIL** (see headline finding — `invalid_credentials`,
reproduced twice). Session persistence across reload: **NOT TESTED** (never had a session). Sign-out
+ post-signout redirect: **NOT TESTED** (never had a session to sign out of). Unauthenticated bare
login + protected-route redirect: **PASS** (see Q2).

**2. Stop control.** **NOT TESTED.** Could not reach any crawl-start screen. No inference made
about whether it works, is reachable by keyboard, or is honest about page-count — I simply never
saw it.

**3. Artifact storage "not configured" state.** **NOT TESTED**, and additionally not reproducible
in this specific running environment even if auth were fixed: `/api/ready` reports
`"storage":true` here, meaning `SUPABASE_SERVICE_ROLE_KEY` is populated in whatever env this
`next start` process inherited. Verifying the degraded-state UI would need a second server
instance with that key deliberately empty — out of scope for me to set up (I don't read/edit env
files per the rules, and standing up a second server instance wasn't part of my brief).

**4. Deep-tier items (12-17).**
- Settings walk: **NOT TESTED** (behind auth).
- Boundary inputs: **DONE**, but only on the one input surface reachable — the login form (see Q3
  table above). All authenticated-screen inputs (crawl config, filters, search) **NOT TESTED**.
- Concurrent-session race testing: **NOT TESTED** (needs two authenticated sessions; have zero).
- Loading + error state screenshots: **PARTIAL** — captured for the login screen only ("Signing
  in…" loading, "Invalid login credentials" error, both clean). All authenticated-screen
  loading/error states **NOT TESTED**.
- Multiple artifacts: **N/A** (no media-generation surface in this tool per the brief; not a
  media tool).
- Mobile breakpoint (375px): **DONE for login only** — renders correctly, centered, no overflow, no
  console errors (`mobile-login.png`). Note the brief explicitly marks mobile-optimised layouts as
  **out of MVP scope** ("desktop-first"), so this was a bonus check, not a required one. Rest of
  the app **NOT TESTED**.

**5. Core measurement re-confirm (score ≈ 19/100).** **NOT TESTED.** Could not start a crawl.

**6. Spot-check Round 1 passes** (chip counts, sort keys, keyboard row access, Activity log).
**NOT TESTED.** Could not reach any of those screens.

---

## Intuition: what feels wrong (gut-check)
- No password-recovery affordance on login — **[owner-opinion]**, see Q5.
- Native validation tooltip styling doesn't match the app card — **[owner-opinion]**, see Q5.

## Practical issues: reproducible bugs
1. **The documented QA credentials (`qa-user@seo-platform.test` /
   `<QA-PASSWORD-REDACTED>`, read from `.env.local.example`'s `SEED_QA_PASSWORD` line exactly as
   instructed) fail Supabase Auth with `400 invalid_credentials`, reproduced twice 8 seconds apart.**
   Repro: `POST https://jlmdsrrwfczgryilsjsy.supabase.co/auth/v1/token?grant_type=password` with
   body `{"email":"qa-user@seo-platform.test","password":"<QA-PASSWORD-REDACTED>",...}` →
   `{"code":"invalid_credentials","message":"Invalid login credentials"}`. Screenshots:
   `auth-02-postlogin.png`. — **[critical]** — blocks Core Element 1 and every MVP acceptance
   criterion that requires being inside the app (criteria 1, 2, 3, 6, 7, 8, 9, 11 per brief.md §6);
   nothing downstream of login could be exercised as a result.

## Positives: what's good (prevent regression)
- Unauthenticated visitor gets a genuinely bare login page — no sidebar/topbar/nav/run-name leakage
  anywhere in the DOM, on `/` or on a direct protected-route hit.
- Protected routes redirect unauthenticated visitors and correctly preserve `?next=` for a
  post-login bounce.
- Native HTML5 validation blocks malformed/XSS-shaped email input before any network round-trip.
- Huge (10KB) input handled without crash or layout break.
- Honest "Signing in…" loading state on submit; clean self-recovery on a mid-submit refresh (no
  stuck spinner, no ghost request state).
- Full keyboard operability on the login form (correct Tab order, Enter submits).
- Clean `npm run build` and fast server boot; `/api/health` and `/api/ready` both healthy.
- Mobile (375px) rendering of the login screen is clean, despite mobile not being an MVP
  requirement.

## Overall verdict (as of the auth-blocked pass)
CRITICAL_ISSUES

## If issues: required fixes for main Claude (as of the auth-blocked pass)
1. **Get the QA account authenticating.** Either re-run the seed script against the actual project
   the app's `NEXT_PUBLIC_SUPABASE_URL` points to (host `jlmdsrrwfczgryilsjsy.supabase.co`,
   confirmed via network capture), confirm it completed without error, and update
   `.env.local.example`'s stale `STATUS: NOT YET CREATED` header — or provide a working credential
   pair through a different channel. Until sign-in succeeds, Round 2's entire mandate (items 2-6)
   is unreachable and stays NOT TESTED, not passed.
2. Once auth works, re-run this same round's item list (2-6) — none of it has been exercised yet,
   including the one thing Round 1 flagged as the single critical finding (the Stop control).
3. Separately: if item 3 (artifact storage degraded state) needs verifying, it will need a second
   server instance/environment with `SUPABASE_SERVICE_ROLE_KEY` deliberately unset — this
   environment's `/api/ready` shows storage is currently configured (`"storage":true`), so the
   negative path can't be exercised here even after auth is fixed.

---
---

# ADDENDUM — Round 2 RESUMED after credential fix

The coordinator reset the QA password server-side and confirmed a real sign-in against the live
project (`user=931771b2-e410-44c6-b283-0107f0697a45`). I rebuilt (`npm run build`), restarted
`next start -p 3985`, and re-verified with the same credentials. **This addendum supersedes the
"NOT TESTED" status on every item above that is now covered below; everything above this line is
kept as-is per instructions ("append, don't overwrite — the login-page work still counts").**

Build observed this pass: same login card as before at first; after sign-in, a light-theme sidebar
shell ("SEO Platform / Crawler POC", nav grouped under START HERE / FINDINGS / EXPLORE PAGES /
COMPARE & HISTORY / Account) — no sidebar/topbar redesign landed during this pass either, so I
believe I tested the same build referenced above, now successfully authenticated.

## 1. Authentication flow — RESULT: PASS (with one gap)

- **Sign-in: PASS.** Same exact credentials, now succeed. Landed on `/` → Overview, fully rendered
  (health score 19.4/100, chip row, charts, no console/network errors). Screenshot
  `r2-01-postlogin.png`.
- **Session persists across a full reload: PASS.** Reloaded `/` — stayed authenticated, no bounce
  to `/login`. Screenshot `r2-02-postreload.png`.
- **Sign-out: FAIL to locate in the UI.** Exhaustively swept the entire authenticated shell —
  full button/link text dump on Overview, sidebar scrolled to bottom, the "Help & support" button
  clicked (does nothing visible — no menu), the top-right run-picker dropdown opened (recent-runs
  list only, no account/sign-out entry), `Ctrl+K` command-palette attempt (nothing opens), the app
  logo clicked. **No element anywhere contains "sign out" / "log out" text, aria-label, title, or
  id**, confirmed via a full DOM sweep (`deep-signout-sweep.mjs`) — zero hits. The route does
  exist server-side (`GET http://localhost:3985/auth/signout` → `405 Method Not Allowed`, i.e. it's
  a POST-only action route from the Next.js build's own route list), but nothing in the rendered UI
  triggers a POST to it. A user who signs in today has no way to end their session from inside the
  app. Screenshots: `r2-01`–`r2-09` (sidebar-bottom, ctrlk, run-picker, logo-click — none show a
  sign-out affordance).
- **Post-signout protected-route redirect: NOT TESTED** — there's no way to sign out to test the
  "after" state (a `405` on a raw GET to the action route doesn't clear the session — confirmed the
  same browser context could still load `/pages` immediately afterward, still authenticated).

**Severity: minor.** Not a named Core Element or MVP Acceptance Criterion (brief.md §2/§6 don't
mention sign-out), and it doesn't block the core crawl→analyze→review workflow, which works fully
without it. It matters because the dispatch explicitly asked me to verify it and a real user
genuinely cannot do it today — this is a real, reproducible gap, not a taste call, so I'm not
filing it as owner-opinion. **Repro:** sign in, look anywhere in the shell for a way to end the
session — there isn't one.

## 2. The Stop control — RESULT: the core promise PASSES; one supporting claim FAILS

This was the single most important check and I ran it twice (once with the wrong selector by
mistake, then correctly) to be sure.

**Setup:** started a real crawl against `http://localhost:3105/` (Render mode: "Always" — every
page via headless Chromium — chosen deliberately to slow the crawl down enough to catch it
mid-flight; this is a supported first-class option in the New-crawl form, not a config hack).

**Keyboard accessibility — PASS.**
- The "Stop crawl" button appears the moment the run starts, `disabled:false`, `tabIndex:0`.
- `.focus()` successfully moves focus to it (`document.activeElement === el` confirmed true).
- Its accessible name is its own text content, unambiguously "Stop crawl" — a real, meaningful name,
  not an icon-only or aria-less control.
- Pressing `Enter` while focused activates it exactly like a click (opens the confirm dialog below).
- The dialog's two buttons ("Keep running" / "Yes, stop it") are themselves keyboard-focusable and
  Enter-activatable — I drove the entire stop flow with keyboard only, zero mouse clicks, and it
  worked end to end. Screenshots: `r2-20-before-stop-click.png`, `r2-24-confirm-dialog.png`.

**Deliberate two-step confirmation — a positive, not a defect.** Pressing "Stop crawl" doesn't
immediately cancel — it opens: *"Stop this crawl? Pages already crawled are kept, but the run will
not finish. [Keep running] [Yes, stop it]"*. This is good, deliberate friction against an accidental
stop. (My first attempt at this test only pressed Enter once and never confirmed — the crawl kept
running in the background for 50s and completed naturally; that was my test-script bug, not a
product bug, once I realized the confirm step existed.)

**State sequence — PASS, and it's honest.** After confirming "Yes, stop it":
`Running` → `Stopping…` → `Cancelled` (frozen at `0:03`), with an explicit technical note:
*"cancelled by user request (POST /crawls/:id/cancel) — process tree killed before completion"*.
This is a genuinely distinct, correctly-labeled terminal state in the UI (not reused/relabeled
"Failed" text on screen).

**THE DECISIVE CHECK — does the page count actually stop climbing: PASS.** I polled the UI every
1.2s for 18+ seconds after confirming stop. The panel stayed byte-identical across all 14 samples —
same "Cancelled 0:03" state, same note, no further page/request activity, no elapsed-timer
movement. This is the opposite of the audited competitor defect the dispatch called out (a tool
that said "Stopped" while still fetching 22 more pages) — here, once confirmed, nothing further
happens. I also independently confirmed via the run's own API record
(`GET /api/crawls/ui-20260813-215623`) that `startedAt` and `endedAt` are ~4 seconds apart, matching
the on-screen "0:03" — the process was actually torn down, not just the UI going quiet.

**One real gap found while verifying the above: the backend's own `state` field for this run is
`"failed"`, not a distinct `"cancelled"` value.**
```
GET /api/crawls/ui-20260813-215623
{"runId":"ui-20260813-215623","state":"failed", ...,
 "note":"cancelled by user request (POST /crawls/:id/cancel) — process tree killed before completion"}

GET /api/crawls/ui-20260813-215623/progress
{"state":"failed","crawled":0,"discovered":null,"failed":null,"blocked":null,"rendered":null}
```
The dispatch explicitly asked me to confirm "a `cancelled` terminal state distinct from `failed`" —
at the UI-label layer that's true (the screen says "Cancelled"), but at the data layer it is not:
the only place the distinction survives is the free-text `note` field, not a first-class state
value. A related, corroborating symptom: **cancelled runs are entirely absent from
`GET /api/crawls`** (the endpoint backing the Runs table and the run-picker) — confirmed both by
the JSON response (my cancelled run's ID never appears in the list) and by the server's own log
output, repeated dozens of times during this session: `[lib/data] listRuns: skipped N run(s) with
missing/malformed report.json`. A cancelled run never gets a `report.json` (it was killed before
one could be written), so it's silently dropped from history — it's still directly fetchable by
exact ID, and it does increment the sidebar's total "Runs" counter, but a user browsing Runs history
to audit "which crawls did I cancel" won't find it there.

**Severity: minor.** This does not violate MVP Acceptance Criterion #2 ("Pressing Stop halts
outbound requests — asserted by a test, not by the UI going quiet") — that criterion is about the
halt actually happening, and it does, verified two independent ways above. It's also not a Core
Element by name. What it does violate is the *literal wording of this round's own dispatch item 2*
("a cancelled terminal state distinct from failed"), and it's a real data-integrity gap (a future
"show me all cancelled runs" or "cancelled vs failed" report/filter would be built on a state field
that can't currently distinguish them) — worth fixing, not urgent. I'm not calling it critical
because the user-facing honesty the criterion cares about is intact: nobody looking at this screen
is deceived about what happened.

## 3. Artifact storage "not configured" state — RESULT: NOT TESTED (same reason as before, now confirmed from inside the app too)

`/api/ready` still reports `"storage":true` in this environment (checked again this pass), so the
degraded "not configured" message can't be triggered without a second server instance with
`SUPABASE_SERVICE_ROLE_KEY` deliberately unset — out of my scope (no env edits, no second
deployment). From inside the app: the page-detail "Screenshot" tab is correctly **disabled with a
clear, honest tooltip** when a run didn't capture screenshots — *"No screenshot stored for this
run — turn on 'Capture screenshots' in New crawl and run it again"* — but that's the
"screenshots weren't requested for this run" case, not the "storage isn't configured at all" case
acceptance criterion #11 is about. Per the dispatch's explicit rule, I did **not** enable
`--screenshots`/turn on "Capture screenshots" to try to force a comparison, so I can't say how a
*successfully stored* screenshot renders either. The `/pages/:id/preview` route itself (Page
replay: Live page / Screenshot / Captured HTML tabs) works cleanly for the two tabs I could check
(Live page renders an embedded iframe with a clear "this is the live site, not the snapshot"
disclaimer; the Screenshot tab is the same honestly-disabled state as above). Screenshots:
`r2-30-page-detail.png`, `r2-33-replay-clicked.png`.

## 4. Deep-tier items — settings walk, concurrent-session race, loading/error captures

- **Settings walk: DONE**, scoped to what exists — there is no separate `/settings` route in this
  app (confirmed against the full route list from `npm run build`'s own output: Overview, Runs,
  Crawl queue, Issues, Failures & Blocked, Sitemap & Robots, Site files, Pages, Measurements, Links,
  Images, Redirects, Compare, Activity, New crawl — no Settings). The closest analog is the
  Light/Dark/System theme control in the sidebar's Account section, which I walked fully: clicked
  Dark → applied instantly (`data-theme="dark"`), **persisted across a full reload**, clicked Light
  → reverted correctly, clicked System → resolved to `light` (this headless browser's OS preference
  is light — correct resolution, not a bug). Dark theme screenshot `r2-34-dark-theme.png` — clean,
  good contrast, no console errors. Per-crawl configuration (the actual "settings" surface in this
  tool) was exercised directly via the New-crawl form during the Stop-control test above (Start URL,
  page limit, render mode, robots respect, screenshots toggle, auth toggle — all worked, all
  correctly disabled themselves while a crawl was in progress).
- **Concurrent-session race testing: PASS (eventually consistent, no data loss).** Opened two
  separate authenticated browser contexts (same QA account — it's the only one that exists).
  Session A started a crawl; Session B, sitting idle on Overview, did **not** live-update its
  sidebar "Runs" count without a reload (checked every 1.5s for 7.5s — no change), but **did**
  correctly show the new count and the new run at the top of its run-picker after a reload, once
  enough time had passed for A's crawl to fully complete and persist. No promise of live
  cross-session push exists in brief.md (multi-tenant/real-time sync is explicitly out of MVP
  scope), so "requires a reload, no data lost" is a pass, not a gap. One minor, self-healing
  wrinkle: in one run of this test, even *Session A's own* sidebar counter under-counted by one
  until its own next reload — cosmetic staleness, not data loss (confirmed via direct
  `GET /api/crawls` that the run was correctly persisted throughout).
- **Loading + error state captures: DONE.**
  - Error state: navigated to `/pages/does-not-exist-xyz` (bogus page ID) → clean, friendly
    "Page detail / Page record not found / No does-not-exist-xyz.json under this run. Back to
    Pages" — not a crash, not a stack trace. Screenshot `r2-47-error-state-badpageid.png`.
  - Loading state: throttled network via CDP (`Network.emulateNetworkConditions`, 800ms latency)
    and screenshotted `/pages` at +400ms mid-fetch. Screenshot `r2-48-loading-state.png`.
- **Mobile breakpoint (375px): DONE** on Overview, Issues, and Pages (authenticated). All three
  render without horizontal overflow or layout collapse; sidebar content reflows into the single
  column correctly. Screenshots `r2-44/45/46`. (Still a bonus check — mobile is explicitly out of
  MVP scope per brief.md §5.)

## 5. Re-confirm the score (~19/100) — RESULT: PASS, strongly corroborated

Three independent readings, all in the expected 19-20 range, nowhere near the "high 80s = failed
build" line brief.md warns about:
- Pre-existing run on Overview at first login: **19.4/100** (12 error · 44 warning · 154 notice).
- My own fresh crawl #1 (Always-render mode, ran to natural completion): **19.1/100** (12 error ·
  44 warning · 175 notice, `pagesAnalyzed: 21`, `rulesRun: 105`).
- My own fresh crawl #2, later in the session: **19.1/100** again (Overview chip row + breakdown,
  screenshot `r2-49-restarted-overview.png`, taken after a full server restart on a clean rebuild —
  same result, not an artifact of server state).

This is a strong, repeated, multi-source confirmation of the specific thing this build exists to
get right.

## 6. Spot-check for regression — RESULT: one regression found, rest hold

- **Sort keys: PASS, not dropped.** Clicked the "Response" column header on `/pages` twice:
  `?sort=responseTime&dir=asc` → `?sort=responseTime&dir=desc`. Toggled cleanly, key preserved both
  times.
- **Keyboard access to table rows: PASS.** Traced the full Tab order on `/pages` from scratch (55
  tabs, logged every stop): sidebar nav (15) → theme buttons (3) → Help/run-picker (2) → search (1)
  → status filter chips (7) → rendered/depth filters (6) → group-by (1) → all 5 sortable column
  headers (URL/Status/Depth/Words/Response) → **tab 41 lands on the first row's page-detail link**
  (`/pages/0ee65adde711?run=...`). Long tab order, but complete and correct — no keyboard trap, no
  skipped row links.
- **Activity log live + replayed: PASS.** `/activity?run=<id>` for a completed run showed
  "Replay complete — 51 of 51 events," a fully itemized, timestamped, per-request log (Crawl
  started → Certificate check → Rendered in a browser / Request pairs per URL → Crawl finished),
  status codes visible per row. During the Stop-control test I also watched the **live** LOG TAIL
  stream real crawler stdout ("Crawl started: ...", "PlaywrightCrawler: Starting the crawler.") as
  it happened — genuinely live, not a static placeholder.
- **Chip counts matching destinations: FAIL — found a real, reproducible mismatch.** See below;
  this is the most significant finding of this pass.

### Chip-count mismatch (violates MVP Acceptance Criterion #9) — CRITICAL

On the Overview page for run `ui-20260813-220341`, the top status-filter bar shows
**"Client errors 4"**, linking to `/pages?run=ui-20260813-220341&status=4xx`. Clicking through, the
destination Pages table shows **"3 of 27 rows"** (3 rows actually rendered, confirmed by counting
the rendered `<a href="/pages/...">` links directly). This is not a one-off/timing artifact — I
triangulated it four independent ways, all on the exact same run:

| Surface | Count shown |
|---|---|
| Overview top chip, "Client errors" | **4** |
| Overview "Failed URLs" stat | 4 |
| Overview "Top: http-4xx (4)" | 4 |
| Overview "Pages by status" breakdown, "Client error (4xx)" | **3** |
| `/pages` screen's own status-filter button, "4xx (3)" | **3** |
| `/pages?status=4xx` destination — actual rendered rows | **3** |
| `/pages?status=4xx` destination — "X of Y rows" summary | **3 of 27** |

Root cause (established purely through the UI, via the Failures & Blocked report — no source
reading involved): the "4" figure is the broader **Failed** bucket, which correctly includes a
4th URL — `http://localhost:3105/members`, a 401 that was blocked after 3 attempts and **never
became a page record** ("never crawled" in the Failures table). The Pages table's `status=4xx`
filter can only match real page records, so it correctly returns 3 (the three genuine 404s:
`/gear-sale`, `/blog/ultralight-tents`, `/products/alpine-tent`). The Overview's top "Client
errors" chip is mislabeling/miscounting the *Failed* total (4) as if it were the *4xx page* count,
then linking to a filter that can only ever show 3. Re-confirmed after a full server restart on a
freshly rebuilt `.next` (screenshot `r2-49-restarted-overview.png`) — not transient.

**Severity: critical.** This is a direct, named violation of MVP Acceptance Criterion #9 in
brief.md §6: *"every filter chip's count matches its destination."* Repro: sign in → Overview →
read the "Client errors" chip value → click it → count the rows on the destination page → they
disagree (4 promised, 3 delivered), reproducible on every run this shape of failure occurs in (any
run with a non-page-forming 4xx/failure mixed in with true 404 pages, which is the seeded site's
normal, permanent state). Screenshots: `r2-41-overview-chips.png`, `r2-42-pages-4xx-filtered.png`,
`r2-43-failures-page.png`, `r2-49-restarted-overview.png`.

## Environmental note (not a product defect) — transient CSS-chunk 500s from a concurrent rebuild

Partway through this session, several screens started rendering as bare unstyled HTML (no
Tailwind), and the console showed repeated `500` responses for one specific hashed asset:
`_next/static/chunks/3aculyh21us63.css`. I checked whether this was a real product bug: the file
`3aculyh21us63.css` does **not exist** in the current `.next/static/chunks/` directory on disk — a
*different*-hashed CSS file (`0edq43aw0uad6.css`) is there instead. This means my `next start`
process was still serving HTML referencing an old build's chunk hash while another agent's
concurrent `npm run build` had already overwritten `.next` underneath it — exactly the "sibling
agent redesigning the login screen and sidebar" scenario the dispatch warned me about, not a defect
in the product's own code. I stopped my server, restarted it fresh against the current `.next`
output, and the styling and the 500s were both immediately resolved (screenshot
`r2-49-restarted-overview.png`, zero console/network errors). Flagging for completeness only — not
counted against the build.

## Updated buckets (this addendum)

### Intuition (new)
- Sidebar "Runs" counter can lag by one within the originating session until the next reload/nav —
  cosmetic staleness only, data itself is correct (confirmed via direct API read) — **[minor]**,
  noted for completeness, not chased further.

### Practical issues (new, in addition to the original credential-failure entry above)
1. **No sign-out control anywhere in the authenticated UI**, despite the route existing server-side.
   Repro: sign in, search every menu/dropdown/shortcut — none exists. — **[minor]**
2. **Overview's "Client errors" chip count (4) does not match its own destination page (3 rows)**,
   a direct violation of MVP Acceptance Criterion #9. Repro and evidence above. — **[critical]**
3. **A cancelled crawl's backend `state` is `"failed"`, not a distinct `"cancelled"` value**, and
   cancelled runs are silently absent from `GET /api/crawls` (server log: "skipped N run(s) with
   missing/malformed report.json"). Repro and evidence above. — **[minor]**

### Positives (new)
- Sign-in now works with the corrected credentials; session survives a full reload.
- Score independently re-confirmed at ~19/100 three times across two fresh crawls plus the
  pre-existing run — solidly in the expected range, nowhere near the "high 80s" failure signature.
- The Stop control is fully keyboard-operable end-to-end (button → confirm dialog → both dialog
  buttons), has a real accessible name, and — the decisive check — genuinely halts the crawl: 18+
  seconds of post-stop polling showed zero further activity, corroborated by the run's own
  `startedAt`/`endedAt` timestamps (~4s apart, matching the on-screen "0:03").
- Deliberate two-step "Stop this crawl?" confirmation before cancelling — good friction against an
  accidental stop.
- Clean, friendly error state for a non-existent page ID (no crash/stack trace).
- Full keyboard row access on the Pages table, confirmed via a complete 55-tab trace.
- Sort-key toggling works correctly, no key silently dropped.
- Activity log is genuinely live during a crawl (real streaming stdout) and correctly replayable
  after completion (51/51 events).
- Concurrent sessions are eventually consistent with no data loss (second session sees the first
  session's new crawl after a reload).
- Theme toggle (Light/Dark/System) works and persists across reload; dark theme is clean with good
  contrast.
- Mobile (375px) renders cleanly on Overview, Issues, and Pages — no overflow, no console errors —
  despite mobile being out of MVP scope.

## FINAL Overall verdict
CRITICAL_ISSUES

(Driven by the chip-count mismatch — MVP Acceptance Criterion #9 — found in this addendum. The
original credential-failure critical from earlier in this document is now resolved and superseded.)

## FINAL required fixes for main Claude (supersedes the earlier list)
1. **Fix the Overview "Client errors" chip** (and the matching "Failed URLs: N" / "Top: http-4xx
   (N)" stats that share the same inflated figure) so its count matches what `/pages?status=4xx`
   actually returns — either exclude non-page failures (like the 401 `/members` block) from that
   specific label/count, or route the chip to a destination that genuinely shows all N. This is a
   named MVP Acceptance Criterion (#9) failure.
2. **Give cancelled runs a first-class `state: "cancelled"`** distinct from `"failed"` at the API
   layer (currently only the free-text `note` field carries that distinction), and make sure
   `listRuns` doesn't require a `report.json` to include a run in `GET /api/crawls` — a cancelled
   run should be visible in Runs history, not silently dropped.
3. **Add a sign-out control to the UI** — the route works, nothing in the shell calls it.
4. Items still genuinely not exercisable in this environment/session (not required fixes, just
   scope notes for whoever picks this up next): artifact-storage "not configured" state (needs a
   second server instance with `SUPABASE_SERVICE_ROLE_KEY` unset) and a successfully-stored
   screenshot's rendering (I was instructed not to enable screenshot capture this round).
