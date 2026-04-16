# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the App

There is no build step. The entire app is a single `index.html` file.

**To test locally on Android:**
- Transfer `index.html` to an Android device and open in Chrome, OR
- Serve via any static file server (e.g. `python3 -m http.server 8080`) and open on Android Chrome via LAN IP

**Deployed URL:** `https://mhann37.github.io/running-coach/` (GitHub Pages, auto-deploys from `main`)

**Critical runtime constraint:** Web Bluetooth API requires Chrome on Android. It does not work in Firefox, Safari, Samsung Internet, or on desktop Chrome (Web Bluetooth is disabled on non-Android desktop). HTTPS or `file://` is required.

## Architecture

The entire application lives in `index.html` — all HTML structure, CSS, and JavaScript are in one file. There are no modules, no build tools, no external dependencies.

### Card Visibility System

The UI is composed of cards that are shown/hidden by toggling the `.active` CSS class (or `.hidden` for the metrics card). Cards only appear after treadmill connection:

- `goalCard` — shown on connect; hides input section and shows `goalSummary` after `confirmGoal()`
- `coachingCard` — shown on connect
- `controlsCard` — shown only if the treadmill exposes a FTMS Control Point characteristic
- `metricsCard` — starts with `.hidden`, removed on connect
- `historyCard` — always visible (rendered on page load from localStorage)

### Two Independent BLE Connections

**Treadmill (FTMS protocol):**
- Service `0x1826`, Treadmill Data characteristic `0x2ACD` (notifications), Control Point `0x2AD9` (write)
- Data arrives as a flags-based variable-length binary packet. The flags `uint16` at bytes 0–1 determines which optional fields follow. Speed is always present at bytes 2–3 (value × 0.01 = km/h). See `parseTreadmillData()` for the full flag map.
- Control Point is optional — some treadmills don't expose it. If unavailable, the controls card is not shown but data still flows.
- Speed command opcode `0x02` (value in 0.01 km/h units as uint16 LE), incline opcode `0x03` (value in 0.1% units as int16 LE). Must send `0x00` (request control) before first write.

**Heart Rate Monitor (standard BLE HR Service):**
- Service `0x180D`, HR Measurement characteristic `0x2A37` (notifications)
- Flags byte bit 0: `0` = HR is uint8 at byte 1, `1` = HR is uint16 LE at bytes 1–2
- Completely independent from the treadmill connection — connects/disconnects separately, has its own reconnect loop and status indicator
- If the external HR monitor is not connected but the treadmill reports HR via flag `0x100` in the FTMS packet, that value is used as fallback in `updateMetrics()`

Both connections share the same reconnect pattern: up to `MAX_RECONNECT_TRIES` (5) attempts, delay of `attempt × 1500ms`. The `manualDisconnect` / `hrManualDisconnect` flags prevent auto-reconnect when the user explicitly disconnects.

### Coaching System

Coaching messages fire every `COACHING_INTERVAL` (15 000 ms) via `setInterval`, with a countdown displayed.

**`buildCoachMessage(data)`** is the main logic function. When both `goalDistance` and `goalTime` are set, it delegates to **`analyzePace(data)`** which computes:
- `requiredSpeedKmh` = remaining distance ÷ remaining time (converted to km/h)
- `speedGap` = required − current (positive = runner is too slow)
- `projectedTotalMin` = elapsed + (remaining distance ÷ current speed × 60)

Coaching tone based on `speedGap`:
| `speedGap` | Emoji | Tone |
|---|---|---|
| speed is 0 | 🚀 / ⏸️ | Prompt to start |
| > 2.5 km/h | ⚠️ | Pace alert with projected finish time |
| 0.5 – 2.5 km/h | 📈 | Behind, push harder |
| ±0.5 km/h | ✅/🏃/💪/💥 | On pace, progress-dependent |
| < −0.5 km/h | 🚀/💪/💥 | Ahead of pace |

HR zone feedback is appended to every message when HR data is available: Easy (<120), Aerobic (120–139), Tempo (140–159), Threshold (160–174), Max (175+).

`analyzePace()` returns `null` when only distance or only time is set (no combined pace target is computable), or when the goal is already complete.

### State Management

All state is plain `let` variables in the script's top scope. Key variables:
- `goalDistance` (km | null), `goalTime` (minutes | null), `goalConfirmed` (bool)
- `lastData` — last parsed treadmill packet, shape: `{ speed, incline, distance, calories, time, heartRate }`
- `hrBpm` — current HR from external monitor (0 if not connected)
- `sessionMaxSpeed`, `sessionSpeedSum`, `sessionSpeedCount` — reset on each `onConnected()`, used to compute avg/max for history

### Workout History

Saved to `localStorage` under key `'runHistory'` as a JSON array (max 10 entries, oldest dropped). A workout is only saved if `distance >= 0.05 km` AND `time >= 30s`. Goal achievement uses a 95% threshold (`distOk`, `timeOk`).

History is saved on `manualDisconnect` or after exhausting reconnect attempts.

## Key Constants

```
FTMS_SERVICE_UUID   = 0x1826   HR_SERVICE_UUID     = 0x180D
TREADMILL_DATA_UUID = 0x2ACD   HR_MEASUREMENT_UUID = 0x2A37
CONTROL_POINT_UUID  = 0x2AD9

SPEED_STEP = 0.5 km/h    SPEED_MIN = 0    SPEED_MAX = 25
INCLINE_STEP = 0.5%      INCLINE_MIN = 0  INCLINE_MAX = 15
COACHING_INTERVAL = 15 000 ms
MAX_RECONNECT_TRIES = 5
HISTORY_MAX = 10
```

## Target Device

Black Lord treadmill, Bluetooth name **FS-4FF13D**. Exposes FTMS with speed, distance, incline, calories, time, and HR (via flag `0x100`). Control Point is available on this device.
