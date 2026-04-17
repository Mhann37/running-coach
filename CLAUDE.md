# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

## Running the App

No build step. The app is a static PWA composed of:

- `index.html` — structure
- `style.css` — styles
- `app.js` — all runtime logic
- `manifest.json` — PWA manifest
- `icon-192.png` / `icon-512.png` — app icons
- `README.md` / `CLAUDE.md`

**To test locally on Android:**
- Transfer the files to an Android device and open `index.html` in Chrome, OR
- Serve via any static file server (e.g. `python3 -m http.server 8080`) and open on Android Chrome via LAN IP

**Deployed URL:** `https://mhann37.github.io/running-coach/` (GitHub Pages, auto-deploys from `main`)

**Runtime constraint:** Web Bluetooth requires Chrome on Android. Does not work in Firefox, Safari, Samsung Internet, or non-Android desktop Chrome. HTTPS or `file://` required.

## Architecture

Pure HTML / CSS / JS — no modules, no build, no bundler. Firebase (auth + Firestore) is pulled directly from the CDN in `index.html`. All runtime state lives as plain `let` variables at the top of `app.js`.

### App State Model

The app has three explicit states, tracked via `appState` and mirrored onto `body[data-state="..."]`:

- `prerun` — Today's Run card is dominant. Chip row shows treadmill / HR / support-mode status. Primary CTA is either "Connect Treadmill" (if disconnected) or "Start Run" / "Let's Go" (if connected).
- `active` — live metrics, coach, session controls visible. Today's Run card collapses to a goal-summary row.
- `postrun` — Stop Run modal is open for review / save / discard.

Transitions are driven by `setAppState(state)` in `app.js`.

### Session Modes

Tracked by `sessionMode`:
- `free` — no target, coach reacts to effort.
- `goal` — distance and/or time target, pace-aware coaching.
- `workout` — structured workout driven by the built-in engine (see below).

`setSessionMode(mode)` toggles goal-input visibility, workout-picker visibility, and updates the primary CTA text (`Connect Treadmill` → `Let's Go` / `Start Run` / `Start Workout`).

### Workout Engine

Three built-in, treadmill-first presets are defined inline in `app.js` under `WORKOUT_PRESETS`:
- **Easy Progression** — warm-up, easy, steady, strong, cool down.
- **Tempo Blocks** — 3 × 6 min tempo with 2 min easy between.
- **6 × 1 min Intervals** — warm-up, 6 × (1 min hard / 1 min easy), cool down.

Each block is plain data: `{ kind, label, durationSec, targetSpeedMin?, targetSpeedMax?, targetHrZoneMin?, targetHrZoneMax?, inclineTarget? }`. Targets are optional and only used when set.

Runtime state: `activeWorkout`, `workoutBlockIdx`, `workoutCompleted`, `selectedWorkoutId`. The engine is time-first — `tickWorkout(sd)` cumulatively sums block durations and advances the current block when session elapsed time crosses each boundary. When the total duration is crossed, `workoutCompleted` fires once.

`renderWorkoutPanel(sd)` draws current block, next block, per-block countdown, and a progress bar. Visible only in Workout mode.

### Target-vs-Actual

`getActiveTargetBand()` returns `{ min, max, source }` based on:
1. Workout: current block's `targetSpeedMin/Max`
2. Goal Run: required pace ±0.5 km/h (derived from `analyzePace()`)
3. Otherwise: `null`.

`renderTargetBand(sd)` draws the band and a status pill (`Under` / `On target` / `Over`). `renderPaceTargets(sd)` draws a 3-cell row (Required / Current / Gap) for Goal Run when both distance and time are set.

A session-mode badge (`Free Run` / `Goal Run` / workout name / `Paused`) is drawn at the top of the metrics card.

### Coaching Modes

Tracked by `coachingMode` (`'quiet' | 'spoken' | 'haptic'`), persisted in `localStorage` under `coachingMode`. A small selector in the coach card header switches between them. The 15 s periodic on-screen coach message runs regardless of mode; the mode only affects sparse audible / haptic events.

Sparse coach events, all debounced, dispatched via `fireCoachEvent(kind, text, vibratePattern)`:
- **Block change** (Workout): announced once per new block.
- **HR zone change**: announced when the current HR zone changes (skipped on first readout).
- **Drift**: when actual speed leaves the target band for ≥ 15 s continuously, announced at most once per 60 s.
- **Goal complete**: announced once when both distance and time targets are hit.
- **Workout complete**: announced once when all blocks are done.

Speech uses `window.speechSynthesis`; haptics use `navigator.vibrate`. Both degrade silently when unavailable.

### Support Mode / Capability Classification

On connect, the app derives a truthful support label via `getSupportMode()`:

- `disconnected` — "Disconnected"
- `readonly` — "Read-only FTMS" (treadmill data received, but no control point)
- `controllable` — "Controllable FTMS" (control point characteristic acquired)

The "Mode" chip in the top chip row reflects this label. `renderCapabilitySummary()` renders a capability list inside the Today's Run card (Speed / Distance / Incline / Calories / HR source / Control). Capabilities are marked on/off based on what's genuinely observable — HR is flagged as `HR (external)` when an external monitor is connected, `HR (treadmill)` when FTMS flag `0x100` appears, otherwise `HR` marked off.

### Two Independent BLE Connections

**Treadmill (FTMS protocol):**
- Service `0x1826`, Treadmill Data `0x2ACD` (notifications), Control Point `0x2AD9` (write)
- Data is a flags-based variable-length packet. The `uint16` flags field at bytes 0–1 determines which optional fields follow. Speed always present at bytes 2–3 (value × 0.01 = km/h). See `parseTreadmillData()` for the full flag map.
- Control Point is optional — some treadmills don't expose it. If unavailable, control UI stays hidden but data still flows (Read-only FTMS).
- Speed opcode `0x02` (uint16 LE, units of 0.01 km/h), incline opcode `0x03` (int16 LE, units of 0.1 %). Request control (`0x00`) is sent before first write.

**Heart Rate Monitor (standard BLE HR Service):**
- Service `0x180D`, HR Measurement `0x2A37` (notifications)
- Flags byte bit 0: `0` → uint8 at byte 1, `1` → uint16 LE at bytes 1–2
- Completely independent from the treadmill connection — connects/disconnects separately, own reconnect loop, own status chip.
- If no external HR monitor is connected but the treadmill reports HR via flag `0x100`, that value is used as fallback inside `updateMetrics()`.

Both connections share the same reconnect pattern: up to `MAX_RECONNECT_TRIES` (5) attempts, delay `attempt × 1500ms`. `manualDisconnect` / `hrManualDisconnect` flags suppress auto-reconnect on explicit disconnect.

### Pre-run Screen Hierarchy

1. Header (brand + History FAB)
2. Status chip row — treadmill status, HR status, support mode. Treadmill and HR chips are tappable (trigger connect/disconnect).
3. Today's Run card (hero) — mode selector (Free / Goal / Workout), goal inputs (Goal mode only), capability summary (when connected), primary CTA.
4. (Hidden pre-run: coach card, session controls, controls card, metrics card.)
5. Secondary `<details>` cards (collapsed by default) — Personal Bests, Account, Debug.

The legacy `#connectBtn` / `#status` / `#hrConnectBtn` / `#hrStatus` nodes still live in the DOM inside a `.legacy-hidden` wrapper so existing handlers continue to drive state — the visible UI is the chip row and primary CTA.

### Coaching System (current pass)

Coaching messages fire every `COACHING_INTERVAL` (15 000 ms) via `setInterval`, with a countdown displayed. `buildCoachMessage(data)` is the main logic function. When both `goalDistance` and `goalTime` are set, it delegates to `analyzePace(data)` which computes:

- `requiredSpeedKmh` = remaining distance ÷ remaining time (converted to km/h)
- `speedGap` = required − current
- `projectedTotalMin` = elapsed + remaining distance ÷ current speed × 60

HR zone feedback is appended when HR data is available: Easy (<120), Aerobic (120–139), Tempo (140–159), Threshold (160–174), Max (175+).

`analyzePace()` returns `null` when only distance or only time is set, or when the goal is already complete.

The periodic message is on-screen only. All audible / haptic output is driven by the sparse events described in "Coaching Modes" above.

### State Management

All state is plain `let` variables at the top of `app.js`. Key variables:

- `appState` — `'prerun' | 'active' | 'postrun'`
- `sessionMode` — `'free' | 'goal' | 'workout'`
- `goalDistance` (km | null), `goalTime` (minutes | null), `goalConfirmed`
- `lastData` — last parsed treadmill packet: `{ speed, incline, distance, calories, time, heartRate }`
- `hrBpm` — current HR from external monitor (0 if not connected)
- `sessionMaxSpeed`, `sessionSpeedSum`, `sessionSpeedCount` — reset on each session, used to compute avg/max for saved records
- `splits`, `speedSamples` — for per-km splits and sparklines

### Post-run Review Flow

`stopSession()` opens the Review-run modal (`#stopModal`) with:
- Mode badge (`Free Run` / `Goal Run` / workout name) + meta line (support mode · coaching mode).
- Summary grid: distance / time / avg pace / best 1 km / kcal.
- **Distance correction** input (`#stopModalFinalDist`) pre-filled with the machine-reported raw value. Users can overwrite when the treadmill's distance is off; a "Reset to machine" button restores the raw value. The raw value is stashed on `input.dataset.raw`.
- Workout block summary (Workout mode only) — each block with duration, target band, and a `✓`/`•` status marker indicating completed / current.
- Save / Discard actions.

The save handler reads the (possibly edited) final distance and passes it as `{ finalDistanceKm }` into `buildWorkoutRecord(sd, opts)`. If the user doesn't edit the field, final = raw.

`autoSaveOnDisconnect()` calls `buildWorkoutRecord(sd)` with no opts, so the raw machine distance is saved as-is (no correction possible without the user).

### Workout Record Schema

Every record emitted by `buildWorkoutRecord()` carries, in addition to legacy fields (`date`, `duration`, `distance`, `calories`, `avgSpeed`, `avgPaceMinPerKm`, `best1kPaceMinPerKm`, `maxSpeed`, `incline`, `goalDistance`, `goalTime`, `goalAchieved`, `speedSamples`, `splits`):

- `rawDistanceKm` — machine-reported distance at stop.
- `finalDistanceKm` — distance actually saved (= `distance`; equals `rawDistanceKm` unless user corrected).
- `sessionMode` — `'free' | 'goal' | 'workout'`.
- `supportMode` — `'disconnected' | 'readonly' | 'controllable'` at save time.
- `coachingMode` — `'quiet' | 'spoken' | 'haptic'` at save time.
- `workoutPresetId` / `workoutName` — present only in Workout mode.
- `capabilitySummary` — `{ hasControl, hasExtHR, hasFtmsHR }` snapshot.
- `blockSummary` — array of block metadata (`idx`, `kind`, `label`, `durationSec`, target speed range, `completed`) when a workout was active; `null` otherwise.

`goalAchieved` uses the final (possibly corrected) distance, so upward corrections can flip a Goal Run from `partial` → `achieved`.

Legacy rows in `localStorage` without these fields still render correctly — history code defaults missing fields (e.g. `sessionMode` → `'free'`).

### Workout History / Personal Bests

Local: `localStorage` under `runHistory:guest` (or `runHistory:<uid>` when signed in). Max 10 entries, oldest dropped. A workout is only saved if `distance >= 0.05 km` AND `time >= 30 s`. Goal achievement uses a 95 % threshold.

Personal Bests (1–10 km) kept under `personalBests:guest` or `personalBests:<uid>` and mirrored to Firestore when signed in. Computed from a workout's per-km splits.

History cards render a session-mode badge next to the date, plus a "Machine reported X · saved Y" hint when the user corrected the distance.

History is saved via the Review-run modal (user taps Save) or auto-saved when reconnect attempts are exhausted.

## Key Constants

```
FTMS_SERVICE_UUID   = 0x1826   HR_SERVICE_UUID     = 0x180D
TREADMILL_DATA_UUID = 0x2ACD   HR_MEASUREMENT_UUID = 0x2A37
CONTROL_POINT_UUID  = 0x2AD9

SPEED_STEP = 0.5 km/h    SPEED_MIN = 0    SPEED_MAX = 25
INCLINE_STEP = 0.5 %     INCLINE_MIN = 0  INCLINE_MAX = 15
COACHING_INTERVAL = 15 000 ms
MAX_RECONNECT_TRIES = 5
HISTORY_MAX = 10
```

## Target Device

Black Lord treadmill, Bluetooth name **FS-4FF13D**. Exposes FTMS with speed, distance, incline, calories, time, and HR (via flag `0x100`). Control Point is available on this device → classifies as Controllable FTMS.
