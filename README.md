# Running Coach — Treadmill-first BLE Alpha

A static web app that turns a Chrome-on-Android phone into a coaching head-unit for your Bluetooth-LE treadmill. It connects directly to any FTMS-compatible treadmill (tested against a Black Lord **FS-4FF13D**), optionally pairs with a BLE heart-rate monitor, and surfaces live pace-aware coaching.

## Requirements

- Android phone running **Chrome** (Web Bluetooth is Chrome-on-Android only — Firefox, Safari, Samsung Internet, and desktop Chrome are not supported for Web Bluetooth).
- Bluetooth enabled on the phone.
- An FTMS-compatible treadmill powered on and not already paired to another app (e.g. Fit Show).
- HTTPS or `file://` origin (GitHub Pages and local files both work).

## Quick start

**Local on Android (BLE-only via `file://`):**
1. Download `index.html`, `style.css`, `app.js`, `manifest.json`, `icon-192.png` onto the phone.
2. Open `index.html` in Chrome.
3. Tap **Connect Treadmill** on the Today's Run card, choose your treadmill in the BLE picker, then **Start Run** / **Let's Go**.

> `file://` is fine for treadmill + BLE features. Google sign-in and Firestore sync are disabled on `file://` because OAuth requires HTTPS or localhost.

**Localhost/HTTPS (required for Google Auth + Firestore sync):**
1. Serve the app from `https://...` (recommended) or `http://localhost` during development.
2. Add runtime Firebase config using **one** of these:
   - Copy `config.example.js` to `config.js` and fill in your Firebase Web App config.
   - Copy `firebase-config.example.json` to `firebase-config.json` and fill in the same values.
3. In Firebase Console Auth settings, add your dev/prod origin to **Authorized domains** (for example `localhost` and your deployed HTTPS domain).
4. Open the app URL in Chrome and sign in with Google.

**Deployed:**
- **Primary (recommended for Google Sign-In):** `https://running-coach-ee164.web.app/` or `https://running-coach-ee164.firebaseapp.com/` — Firebase Hosting, auto-deploys from `main`.
- `https://mhann37.github.io/running-coach/` — legacy GitHub Pages mirror.

> **Why Firebase Hosting is primary:** the page origin matches the Firebase `authDomain`, so Google OAuth runs same-origin and avoids the cross-origin iframe path that Chrome's third-party storage partitioning frequently breaks. Google sign-in works reliably on Android Chrome only from the Firebase Hosting URL.

## Deploying to Firebase Hosting

Firebase Hosting config lives at `firebase.json` and `.firebaserc`. The project is `running-coach-ee164`.
Firestore uses the default database in `australia-southeast1` (Sydney), with owner-only rules from `firestore.rules`.

**Manual one-off deploy (from your machine):**

```bash
npm install -g firebase-tools
firebase login
firebase deploy --only hosting
```

Site will be live at `https://running-coach-ee164.web.app/` and `https://running-coach-ee164.firebaseapp.com/`.

**Automatic deploys via GitHub Actions:**

Workflows live at `.github/workflows/firebase-hosting-merge.yml` (pushes to `main`) and `.github/workflows/firebase-hosting-pull-request.yml` (PR previews). Both require a repo secret:

1. In the Firebase console, generate a **service account** JSON (Project settings → Service accounts → Generate new private key) or run `firebase init hosting:github` which does it for you.
2. Add the entire JSON as a GitHub repo secret named `FIREBASE_SERVICE_ACCOUNT_RUNNING_COACH_EE164`.
3. Push to `main` — the workflow deploys to the `live` channel. PRs get a temporary preview URL posted as a PR check.

**Authorized domains:** in Firebase Console → Authentication → Settings, ensure these are listed (they normally are by default for the hosting project):
- `running-coach-ee164.web.app`
- `running-coach-ee164.firebaseapp.com`
- `localhost`

## What it does today

### Pre-run
- **Today's Run** card with three session modes:
  - **Free Run** — no target, coach reacts to effort.
  - **Goal Run** — distance and/or time target with pace-aware feedback.
  - **Workout** — structured, block-based treadmill workout with 3 built-in presets (Easy Progression, Tempo Blocks, 6 × 1 min Intervals). Blocks auto-advance by elapsed time.
- A compact **status chip row** near the top showing treadmill, HR, and support-mode status at a glance.
- **Truthful support classification** on connect:
  - **Controllable FTMS** — treadmill exposes a control point; speed & incline can be set from the app.
  - **Read-only FTMS** — treadmill exposes data but no control point; controls UI stays hidden.
  - **Disconnected** — no BLE link.
- A **capability summary** lists the signals actually available (Speed, Distance, Incline, Calories, HR source, Control).

### Active run
- Live metrics: speed, pace, distance, time, incline, calories.
- Heart rate from an external BLE HR monitor, or from the treadmill's FTMS packet as fallback (flag `0x100`). HR zone is labelled Easy / Aerobic / Tempo / Threshold / Max.
- Goal progress bars (Goal Run).
- Session mode badge (`Free Run` / `Goal Run` / workout name / `Paused`) at the top of the metrics card.
- In Workout mode: current block, next block, per-block countdown, block progress bar.
- Target-vs-actual speed band with an `Under` / `On target` / `Over` pill (workout block target, or Goal Run required pace ±0.5 km/h).
- Goal Run: an explicit `Required / Current / Gap` row.
- Coach feedback every 15 s on-screen. **Coaching modes** — Quiet (screen only), Spoken (screen + `speechSynthesis`), Haptic (screen + `navigator.vibrate`). Sparse, debounced audible/haptic triggers: block transitions, HR zone changes, sustained drift off the target band, and goal / workout completion.
- Speed control via FTMS control point when supported (large presets: 7, 9, 11, 13, 15 km/h). Incline controls are intentionally hidden in run mode to keep the UI compact.

### Post-run
- **Review-run modal** with mode badge (Free Run / Goal Run / workout name) + support-mode + coaching-mode meta.
- Summary grid: distance, time, avg pace, best 1 km pace, calories.
- **Distance correction** — pre-filled with the machine-reported value; edit it if the treadmill's distance is off. "Reset to machine" restores the raw value. Corrected distance flows into `goalAchieved` and history.
- Workout-block summary (Workout mode): per-block duration, target band, and `✓`/`•` markers for completed / current.
- Local history (last 10 runs) in `localStorage`; Firestore sync when signed in with Google. Each run stores raw vs final distance, session mode, support mode, coaching mode, capability snapshot, and (for workouts) a block summary.
- Signed-in Firestore storage uses `users/{uid}/runs/{runId}` for the run summary and `users/{uid}/runs/{runId}/telemetryChunks/{chunkId}` for packet-level telemetry: speed, distance, raw distance, incline, calories, treadmill time, HR source/value, targets, pause state, workout block, and target band.
- Run History is available directly in the app and marks signed-in runs as Cloud saved or Sync pending. Pending local runs retry automatically after sign-in / Firestore recovery.
- History cards show a session-mode badge and a raw-vs-saved distance hint when corrected.
- Personal Bests (1–10 km) computed from split data.

## BLE details

- **Treadmill service** `0x1826` (FTMS), Treadmill Data `0x2ACD` (notify), Control Point `0x2AD9` (write).
- **HR service** `0x180D`, HR Measurement `0x2A37` (notify).
- Reconnect loop: up to 5 attempts with linear back-off (`attempt × 1500 ms`) on involuntary disconnects.

## Files

- `index.html` — structure
- `style.css` — styles
- `app.js` — all runtime logic
- `config.example.js` — template for local runtime Firebase config (`config.js` is gitignored)
- `firebase-config.example.json` — template for generated runtime config JSON (`firebase-config.json` is gitignored)
- `manifest.json` — PWA manifest
- `icon-192.png` / `icon-512.png` — app icons
- `CLAUDE.md` — architecture notes for AI coding sessions

No build step, no modules, no bundler. Firebase (auth + Firestore) is loaded from a CDN in `index.html`.

## Firebase runtime config strategy

Firebase is initialized at runtime only when valid config is present. There is no inline config in source anymore.

Config lookup order at startup:
1. `window.RUNNING_COACH_FIREBASE_CONFIG` (from optional `config.js`).
2. `window.FIREBASE_CONFIG` or `window.__FIREBASE_CONFIG__` (for host-injected runtime config).
3. Inline JSON script tag with id `firebaseConfigJson`.
4. `./firebase-config.json` fetched at runtime.

If both are missing/invalid, auth stays disabled and `#authStatus` shows a clear error message.

`config.js` and `firebase-config.json` are intentionally gitignored. Commit only the example templates.


## Google OAuth checklist

Before testing Google Sign-In, verify all of the following:

- **Google provider enabled** in Firebase Authentication > Sign-in method.
- **Authorized domains** include the exact production host (for GitHub Pages this is `mhann37.github.io`).
- **`authDomain` in runtime config** points to the same Firebase project used by this deployment.
- App is served over **HTTPS** (required for Firebase Auth redirect/popup flow on the web).
- Runtime config includes a matching **`projectId` + `apiKey`** pair for that Firebase project.

If any of these are wrong, sign-in may fail with domain/auth configuration errors. Use the in-app Account diagnostics block to confirm origin, config source, auth-enabled state, and last auth error.

## Firebase security/policy checklist (project operations)

### 1) Firestore rules: lock data to `users/{uid}/...`

Use strict per-user access controls so each user can only access their own document tree:

```text
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isSignedIn() {
      return request.auth != null;
    }
    function isOwner(uid) {
      return isSignedIn() && request.auth.uid == uid;
    }

    match /users/{uid} {
      allow read, write: if isOwner(uid);

      match /{document=**} {
        allow read, write: if isOwner(uid);
      }
    }

    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

### 2) Authentication hardening

In Firebase Console:
- Enable only required providers (Google for this app).
- Disable all unused providers.
- Restrict **Authorized domains** to production/staging origins only (plus localhost only if explicitly needed for development).

### 3) App Check (Web)

Enable Firebase App Check for web where feasible:
- Preferred: reCAPTCHA Enterprise.
- Fallback: reCAPTCHA v3.
- Enforce App Check for Firestore/Auth after rollout validation.
- Keep debug tokens limited to development environments.

## Troubleshooting

**"Web Bluetooth not supported"** — use Chrome on Android.

**Can't find treadmill in BLE picker** — make sure the treadmill is on, Bluetooth is enabled, and no other app (e.g. Fit Show) is already paired.

**Metrics show 0.0 / --:--** — the treadmill only emits most fields when the belt is actually moving. Check the Debug details section for parsing errors.

**Connection drops** — keep the phone within ~10 m of the treadmill and prevent the screen from sleeping during the run.

**Google sign-in is disabled / OAuth error on local files** — `file://` origins are unsupported for Firebase Google OAuth. Use an HTTPS deployment (for example GitHub Pages) or localhost development, and make sure that origin is added to Firebase Auth **Authorized domains**.

## Known limitations

- No Strava / Garmin sync.
- Cadence is not reported — treadmills don't provide a reliable cadence signal, so it's deliberately omitted.
- Signal strength / RSSI is not available through the Web Bluetooth API and is therefore not shown.
- Speech synthesis relies on browser TTS — Chrome on Android speaks fine, but voice quality / latency varies by device.
- Structured workouts are hard-coded presets; a user-editable workout builder is out of scope for this pass.

## License

MIT
