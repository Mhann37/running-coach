    // ── Constants ──────────────────────────────────────────────────────────────
    const FTMS_SERVICE_UUID   = 0x1826;
    const TREADMILL_DATA_UUID = 0x2ACD;
    const CONTROL_POINT_UUID  = 0x2AD9;

    const HR_SERVICE_UUID     = 0x180D;
    const HR_MEASUREMENT_UUID = 0x2A37;

    const SPEED_STEP    = 0.5;
    const INCLINE_STEP  = 0.5;
    const SPEED_MIN     = 0;
    const SPEED_MAX     = 25;
    const INCLINE_MIN   = 0;
    const INCLINE_MAX   = 15;
    const COACHING_INTERVAL   = 15000;
    const MAX_RECONNECT_TRIES = 5;
    const HISTORY_MAX         = 10;
    const SPEED_SAMPLE_INTERVAL_MS = 30000; // one sample per 30 s
    const SPEED_SAMPLE_MAX    = 120;

    // ── State ──────────────────────────────────────────────────────────────────
    let device                      = null;
    let treadmillDataCharacteristic = null;
    let controlPointCharacteristic  = null;
    let lastCoachingTime            = 0;
    let targetSpeed                 = 0;
    let targetIncline               = 0;
    let manualDisconnect            = false;
    let sessionStopped              = false;  // true after Stop Run modal completes
    let endRunBusy                 = false;  // prevents double-taps on Save/Discard
    let paused                      = false;
    let reconnectAttempts           = 0;
    let coachingIntervalId          = null;
    let nextCoachCountdown          = COACHING_INTERVAL / 1000;
    let goalDistance                = null;
    let goalTime                    = null;
    let goalConfirmed               = false;

    // Session mode: 'free' | 'goal' | 'workout'.
    let sessionMode                 = 'free';
    // App state: 'prerun' | 'active' | 'postrun'.
    let appState                    = 'prerun';

    // ── Workout engine ──────────────────────────────────────────────────
    // Built-in treadmill-first presets. Blocks are time-first; targets
    // are optional and only shown/used when defined.
    const WORKOUT_PRESETS = {
        easyProgression: {
            id: 'easyProgression',
            name: 'Easy Progression',
            desc: '20 min progressive build + short cool down',
            blocks: [
                { kind: 'warmup',   label: 'Warm-up',   durationSec: 300, targetSpeedMin: 6,    targetSpeedMax: 8 },
                { kind: 'work',     label: 'Easy',      durationSec: 300, targetSpeedMin: 8,    targetSpeedMax: 10 },
                { kind: 'work',     label: 'Steady',    durationSec: 300, targetSpeedMin: 10,   targetSpeedMax: 12 },
                { kind: 'work',     label: 'Strong',    durationSec: 180, targetSpeedMin: 12,   targetSpeedMax: 13.5 },
                { kind: 'cooldown', label: 'Cool down', durationSec: 120, targetSpeedMin: 5,    targetSpeedMax: 7 }
            ]
        },
        tempoBlocks: {
            id: 'tempoBlocks',
            name: 'Tempo Blocks',
            desc: '3 × 6 min tempo with 2 min easy',
            blocks: [
                { kind: 'warmup',   label: 'Warm-up',   durationSec: 300, targetSpeedMin: 7,  targetSpeedMax: 9 },
                { kind: 'work',     label: 'Tempo 1',   durationSec: 360, targetSpeedMin: 12, targetSpeedMax: 13.5, targetHrZoneMin: 140, targetHrZoneMax: 160 },
                { kind: 'recovery', label: 'Recovery',  durationSec: 120, targetSpeedMin: 7,  targetSpeedMax: 8.5 },
                { kind: 'work',     label: 'Tempo 2',   durationSec: 360, targetSpeedMin: 12, targetSpeedMax: 13.5, targetHrZoneMin: 140, targetHrZoneMax: 160 },
                { kind: 'recovery', label: 'Recovery',  durationSec: 120, targetSpeedMin: 7,  targetSpeedMax: 8.5 },
                { kind: 'work',     label: 'Tempo 3',   durationSec: 360, targetSpeedMin: 12, targetSpeedMax: 13.5, targetHrZoneMin: 140, targetHrZoneMax: 160 },
                { kind: 'cooldown', label: 'Cool down', durationSec: 300, targetSpeedMin: 6,  targetSpeedMax: 8 }
            ]
        },
        sixOneMin: {
            id: 'sixOneMin',
            name: '6 × 1 min Intervals',
            desc: '6 × (1 min hard / 1 min easy) + warmup / cool',
            blocks: (function buildIntervals() {
                const arr = [{ kind: 'warmup', label: 'Warm-up', durationSec: 300, targetSpeedMin: 7, targetSpeedMax: 9 }];
                for (let i = 1; i <= 6; i++) {
                    arr.push({ kind: 'work',     label: `Interval ${i}`, durationSec: 60, targetSpeedMin: 14, targetSpeedMax: 16 });
                    arr.push({ kind: 'recovery', label: 'Recovery',      durationSec: 60, targetSpeedMin: 6,  targetSpeedMax: 8 });
                }
                arr.push({ kind: 'cooldown', label: 'Cool down', durationSec: 300, targetSpeedMin: 5, targetSpeedMax: 7 });
                return arr;
            })()
        }
    };

    let selectedWorkoutId    = null;
    let activeWorkout        = null;   // { id, name, blocks } when running
    let workoutBlockIdx      = 0;
    let workoutCompleted     = false;

    // Coaching mode: 'quiet' | 'spoken' | 'haptic'. Persisted in localStorage.
    let coachingMode         = (localStorage.getItem('coachingMode') || 'spoken');

    // Sparse coach event debounce state
    let lastBlockIdxAnnounced = -1;
    let lastHrZoneAnnounced   = null;
    let driftSinceMs          = 0;     // wall-clock ms at which drift began
    let lastDriftAnnounceMs   = 0;     // wall-clock ms of last drift speech
    let goalCompleteAnnounced = false;

    // Firebase Auth / Firestore state
    let authUser      = null;
    let authEnabled  = false; // true only when Firebase config is available
    let authDisabledReason = 'Cloud sync unavailable on this build (missing Firebase config).';
    let authStatusLevel = 'disconnected';
    let firebaseAuth  = null;
    let firebaseDb    = null;
    let firebaseConfig = null;
    let firebaseConfigSource = null;
    let lastAuthErrorCode = null;
    let lastAuthErrorMessage = null;
    const FIREBASE_JSON_CONFIG_PATH = './firebase-config.json';
    let authBusy = false;
    let authBusyAction = null; // 'signin' | 'signout'
    let authPersistenceMode = 'unknown';
    let authCurrentUserSummary = 'none';
    let authRedirectResultSummary = 'pending';
    let authStorageSummary = 'unknown';
    let authLastStateChange = 'none';

    const AUTH_SIGN_IN_LABEL = 'Sign in with Google';
    const AUTH_SIGN_OUT_LABEL = 'Sign out';
    const AUTH_SIGNING_IN_LABEL = 'Signing in…';
    const AUTH_SIGNING_OUT_LABEL = 'Signing out…';

    // HR Monitor state
    let hrDevice            = null;
    let hrCharacteristic    = null;
    let hrBpm               = 0;
    let hrManualDisconnect  = false;
    let hrReconnectAttempts = 0;

    // Raw last BLE packet (cumulative treadmill values)
    let lastData = { speed: 0, incline: 0, distance: 0, calories: 0, time: 0, heartRate: 0 };

    // Session-relative tracking (lazy-initialised on first packet)
    let sessionStartDistance      = null;
    let sessionStartTreadmillTime = null;
    let sessionStartCalories      = null;

    // Per-session accumulators
    let sessionMaxSpeed   = 0;
    let sessionSpeedSum   = 0;
    let sessionSpeedCount = 0;
    let splits            = [];      // [{ km, time }]
    let lastSplitDistance = 0;       // session-relative km of last recorded split
    let prevSdDistance    = null;    // previous packet's session-relative distance (km)
    let prevSdTime        = null;    // previous packet's session-relative time (s)
    let speedSamples      = [];      // [[sessionTimeSec, speedKmh], ...]
    let lastSpeedSampleMs = 0;

    // ── UI refs ────────────────────────────────────────────────────────────────
    const connectBtn       = document.getElementById('connectBtn');
    const statusDiv        = document.getElementById('status');
    const metricsCard      = document.getElementById('metricsCard');
    const coachingCard     = document.getElementById('coachingCard');
    const controlsCard     = document.getElementById('controlsCard');
    const goalCard         = document.getElementById('goalCard');
    const debugDiv         = document.getElementById('debug');

    const paceEl           = document.getElementById('pace');
    const speedEl          = document.getElementById('speed');
    const distanceEl       = document.getElementById('distance');
    const timeEl           = document.getElementById('time');
    const inclineEl        = document.getElementById('incline');
    const caloriesEl       = document.getElementById('calories');
    const coachingMessageEl = document.getElementById('coachingMessage');
    const coachTimerEl     = document.getElementById('coachTimer');
    const targetSpeedEl    = document.getElementById('targetSpeed');
    const targetInclineEl  = document.getElementById('targetIncline');

    const speedUpBtn    = document.getElementById('speedUp');
    const speedDownBtn  = document.getElementById('speedDown');
    const inclineUpBtn  = document.getElementById('inclineUp');
    const inclineDownBtn = document.getElementById('inclineDown');
    const preset7Btn    = document.getElementById('preset7');
    const preset9Btn    = document.getElementById('preset9');
    const preset11Btn   = document.getElementById('preset11');
    const preset13Btn   = document.getElementById('preset13');
    const preset15Btn   = document.getElementById('preset15');

    // Chip row + mode selector + capability refs
    const treadmillChip      = document.getElementById('treadmillChip');
    const treadmillChipText  = document.getElementById('treadmillChipText');
    const hrChip             = document.getElementById('hrChip');
    const hrChipText         = document.getElementById('hrChipText');
    const supportModeChip    = document.getElementById('supportModeChip');
    const supportModeChipText= document.getElementById('supportModeChipText');
    const modeSelector       = document.getElementById('modeSelector');
    const modeFreeBtn        = document.getElementById('modeFreeBtn');
    const modeGoalBtn        = document.getElementById('modeGoalBtn');
    const modeWorkoutBtn     = document.getElementById('modeWorkoutBtn');
    const modeHeader         = document.getElementById('modeHeader');
    const modeSubtext        = document.getElementById('modeSubtext');
    const goalInputsWrap     = document.getElementById('goalInputsWrap');
    const capabilitySummary  = document.getElementById('capabilitySummary');
    const capListEl          = document.getElementById('capList');
    const ctaHintEl          = document.getElementById('ctaHint');
    const workoutPickerEl    = document.getElementById('workoutPicker');

    // Active-run Section 2 refs
    const sessionModeBadge   = document.getElementById('sessionModeBadge');
    const workoutPanelEl     = document.getElementById('workoutPanel');
    const wpCurrentBlockEl   = document.getElementById('wpCurrentBlock');
    const wpCountdownEl      = document.getElementById('wpCountdown');
    const wpNextBlockEl      = document.getElementById('wpNextBlock');
    const wpProgressFillEl   = document.getElementById('wpProgressFill');
    const targetBandEl       = document.getElementById('targetBand');
    const tbRangeEl          = document.getElementById('tbRange');
    const tbStatusEl         = document.getElementById('tbStatus');
    const paceTargetsEl      = document.getElementById('paceTargets');
    const ptRequiredEl       = document.getElementById('ptRequired');
    const ptCurrentEl        = document.getElementById('ptCurrent');
    const ptGapEl            = document.getElementById('ptGap');
    const coachingModeSel    = document.getElementById('coachingModeSel');

    const hrConnectBtn   = document.getElementById('hrConnectBtn');
    const hrStatusDiv    = document.getElementById('hrStatus');
    const hrMetricWrap   = document.getElementById('hrMetricWrap');
    const hrMetricEl     = document.getElementById('hrMetric');
    const hrZoneLabelEl  = document.getElementById('hrZoneLabel');

    const goalDistanceInput = document.getElementById('goalDistanceInput');
    const goalTimeInput     = document.getElementById('goalTimeInput');
    const setGoalBtn        = document.getElementById('setGoalBtn');
    const goalSummary       = document.getElementById('goalSummary');
    const goalSummaryText   = document.getElementById('goalSummaryText');
    const editGoalBtn       = document.getElementById('editGoalBtn');
    const goalInputSection  = document.getElementById('goalInputSection');

    const distanceProgress     = document.getElementById('distanceProgress');
    const timeProgress         = document.getElementById('timeProgress');
    const distanceProgressText = document.getElementById('distanceProgressText');
    const timeProgressText     = document.getElementById('timeProgressText');
    const distanceProgressFill = document.getElementById('distanceProgressFill');
    const timeProgressFill     = document.getElementById('timeProgressFill');

    const sessionControlsEl = document.getElementById('sessionControls');
    const pauseBtn          = document.getElementById('pauseBtn');
    const stopBtn           = document.getElementById('stopBtn');

    const stopModal       = document.getElementById('stopModal');
    const stopModalDistEl = document.getElementById('stopModalDist');
    const stopModalTimeEl = document.getElementById('stopModalTime');
    const stopModalCalEl  = document.getElementById('stopModalCal');
    const stopModalAvgPaceEl  = document.getElementById('stopModalAvgPace');
    const stopModalBest1kEl   = document.getElementById('stopModalBest1k');
    const stopModalModeEl     = document.getElementById('stopModalMode');
    const stopModalMetaEl     = document.getElementById('stopModalMeta');
    const stopModalFinalDist  = document.getElementById('stopModalFinalDist');
    const stopModalRawDist    = document.getElementById('stopModalRawDist');
    const stopModalResetDist  = document.getElementById('stopModalResetDist');
    const stopModalBlocksEl   = document.getElementById('stopModalBlocks');
    const saveRunBtn      = document.getElementById('saveRunBtn');
    const discardRunBtn   = document.getElementById('discardRunBtn');

    const historyFab      = document.getElementById('historyFab');
    const historyOverlay  = document.getElementById('historyOverlay');
    const closeHistoryBtn = document.getElementById('closeHistoryBtn');
    const historyList     = document.getElementById('historyList');
    const personalBestsCard      = document.getElementById('personalBestsCard');
    const personalBestsEmpty     = document.getElementById('personalBestsEmpty');
    const personalBestsTable     = document.getElementById('personalBestsTable');

    const authStatusEl        = document.getElementById('authStatus');
    const googleSignInBtn     = document.getElementById('googleSignInBtn');
    const googleSignOutBtn    = document.getElementById('googleSignOutBtn');
    const authCardEl          = document.getElementById('authCard');

    const authDiagnosticsEl = document.createElement('pre');
    authDiagnosticsEl.id = 'authDiagnostics';
    authDiagnosticsEl.className = 'debug';
    if (authCardEl) authCardEl.appendChild(authDiagnosticsEl);

    // ── Init ───────────────────────────────────────────────────────────────────
    if (!navigator.bluetooth) {
        statusDiv.textContent = 'Web Bluetooth not supported — use Chrome on Android';
        statusDiv.className = 'status disconnected';
        connectBtn.disabled = true;
    }

    // Show history FAB if there are saved runs
    if (getHistory().length > 0) historyFab.classList.remove('hidden');

    // Initial PR visibility + Firebase initialization.
    refreshPersonalBestsVisibility();
    initFirebaseAuth();
    renderAuthDiagnostics();
    window.setInterval(renderAuthDiagnostics, 5000);

    // Initial chip + CTA + state rendering (pre-run, disconnected).
    setCoachingMode(coachingMode);
    renderWorkoutPicker();
    setSessionMode('free');
    setAppState('prerun');
    renderStatusChips();
    renderCapabilitySummary();
    updatePrimaryCTA();

    // ── Event listeners ────────────────────────────────────────────────────────
    googleSignInBtn.addEventListener('click', async () => {
        if (authBusy) return;
        if (!authEnabled || !firebaseAuth) {
            const reason = authDisabledReason || 'Google sign-in is unavailable right now.';
            setAuthStatus(reason, 'error');
            captureAuthError(null, reason);
            return;
        }
        const provider = new firebase.auth.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        setAuthBusy(true, 'signin');
        setAuthStatus('Opening Google sign-in…', 'connecting');
        log('Google sign-in: attempting popup first.');
        try {
            // Popup-first on all platforms. Modern Chrome on Android supports this and
            // avoids the cross-origin iframe restoration that the redirect flow relies
            // on when authDomain (firebaseapp.com) ≠ page origin.
            await firebaseAuth.signInWithPopup(provider);
        } catch (e) {
            const popupUnavailable = e && (
                e.code === 'auth/popup-blocked' ||
                e.code === 'auth/popup-closed-by-user' ||
                e.code === 'auth/cancelled-popup-request' ||
                e.code === 'auth/operation-not-supported-in-this-environment'
            );
            log(`Google sign-in popup failed (${e && e.code ? e.code : 'unknown'}): ${e && e.message ? e.message : e}`);
            if (popupUnavailable) {
                try {
                    setAuthBusy(true, 'signin');
                    setAuthStatus('Redirecting to Google sign-in…', 'connecting');
                    log('Google sign-in: falling back to redirect.');
                    await firebaseAuth.signInWithRedirect(provider);
                    return;
                } catch (redirectErr) {
                    setAuthStatus(getAuthErrorMessage(redirectErr), 'error');
                    captureAuthError(redirectErr);
                    log(`Google sign-in redirect error: ${redirectErr.message}`);
                }
            }
            setAuthStatus(getAuthErrorMessage(e), 'error');
            captureAuthError(e);
            setAuthBusy(false);
        }
    });

    googleSignOutBtn.addEventListener('click', async () => {
        if (!authEnabled || !firebaseAuth || authBusy) return;
        setAuthBusy(true, 'signout');
        try {
            await firebaseAuth.signOut();
        } catch (e) {
            captureAuthError(e);
            log(`Google sign-out error: ${e.message}`);
            setAuthBusy(false);
        }
    });

    connectBtn.addEventListener('click', async () => {
        if (device && device.gatt.connected) {
            manualDisconnect = true;
            disconnect();
        } else {
            try {
                manualDisconnect = false;
                await connectToTreadmill();
            } catch (err) {
                log(`Connection error: ${err.message}`);
                updateStatus('disconnected', `Error: ${err.message}`);
            }
        }
    });

    // Treadmill chip acts as the compact connect/disconnect control
    treadmillChip.addEventListener('click', () => connectBtn.click());
    hrChip.addEventListener('click', () => hrConnectBtn.click());

    // Session mode selector
    modeFreeBtn.addEventListener('click',    () => setSessionMode('free'));
    modeGoalBtn.addEventListener('click',    () => setSessionMode('goal'));
    modeWorkoutBtn.addEventListener('click', () => setSessionMode('workout'));

    // Workout preset click delegation (rendered dynamically)
    workoutPickerEl.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-preset-workout');
        if (!btn) return;
        selectedWorkoutId = btn.dataset.wid;
        renderWorkoutPicker();
        updatePrimaryCTA();
    });

    // Coaching mode selector
    coachingModeSel.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-cmode');
        if (!btn) return;
        setCoachingMode(btn.dataset.cmode);
    });

    speedUpBtn.addEventListener('click',    () => adjustSpeed(SPEED_STEP));
    speedDownBtn.addEventListener('click',  () => adjustSpeed(-SPEED_STEP));
    inclineUpBtn.addEventListener('click',  () => adjustIncline(INCLINE_STEP));
    inclineDownBtn.addEventListener('click',() => adjustIncline(-INCLINE_STEP));
    preset7Btn.addEventListener('click',    () => setTargetSpeed(7));
    preset9Btn.addEventListener('click',    () => setTargetSpeed(9));
    preset11Btn.addEventListener('click',   () => setTargetSpeed(11));
    preset13Btn.addEventListener('click',   () => setTargetSpeed(13));
    preset15Btn.addEventListener('click',   () => setTargetSpeed(15));

    setGoalBtn.addEventListener('click', () => {
        const action = setGoalBtn.dataset.action || 'connect';
        if (action === 'connect') {
            connectBtn.click();
        } else if (action === 'start') {
            confirmGoal();
        }
    });
    editGoalBtn.addEventListener('click', () => {
        goalSummary.classList.remove('active');
        goalInputSection.style.display = '';
        goalConfirmed = false;
    });

    // Pause / Resume
    pauseBtn.addEventListener('click', () => {
        paused = !paused;
        if (paused) {
            pauseBtn.textContent = 'Resume';
            pauseBtn.classList.add('paused');
            stopCoachingTimer();
            setCoachingMessage('⏸️ Paused', 'Tap Resume when ready.');
            coachTimerEl.textContent = '';
            log('Session paused');
        } else {
            pauseBtn.textContent = 'Pause';
            pauseBtn.classList.remove('paused');
            startCoachingTimer();
            log('Session resumed');
        }
        renderSessionModeBadge();
    });

    // Stop Run
    stopBtn.addEventListener('click', () => stopSession());

    // Stop modal actions
    saveRunBtn.addEventListener('click', () => {
        if (endRunBusy) return;
        endRunBusy = true;

        const sd = getSessionData(lastData);
        if (sd) {
            // Read user-corrected distance from the input (falls back to raw).
            const parsed = parseFloat(stopModalFinalDist.value);
            const finalDistanceKm = (Number.isFinite(parsed) && parsed >= 0) ? parsed : sd.distance;
            const workout = buildWorkoutRecord(sd, { finalDistanceKm });
            persistWorkout(workout);
            historyFab.classList.remove('hidden');
        }
        stopModal.classList.remove('active');
        finishSession();
        endRunBusy = false;
    });

    // Reset distance input to machine-reported raw value
    stopModalResetDist.addEventListener('click', () => {
        const raw = stopModalFinalDist.dataset.raw;
        if (raw !== undefined) stopModalFinalDist.value = raw;
    });

    discardRunBtn.addEventListener('click', () => {
        if (endRunBusy) return;
        endRunBusy = true;
        stopModal.classList.remove('active');
        finishSession();
        log('Run discarded');
        endRunBusy = false;
    });

    // History overlay
    historyFab.addEventListener('click', () => {
        renderHistoryOverlay();
        historyOverlay.classList.add('active');
    });
    closeHistoryBtn.addEventListener('click', () => {
        historyOverlay.classList.remove('active');
    });

    hrConnectBtn.addEventListener('click', async () => {
        if (hrDevice && hrDevice.gatt.connected) {
            hrManualDisconnect = true;
            hrDevice.gatt.disconnect();
        } else {
            try {
                hrManualDisconnect = false;
                hrReconnectAttempts = 0;
                await connectToHRMonitor();
            } catch (err) {
                log(`HR connection error: ${err.message}`);
                updateHRStatus('disconnected', 'HR Not Connected');
            }
        }
    });

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && device && !device.gatt.connected && !manualDisconnect) {
            log('App foregrounded — attempting reconnect...');
            tryReconnect();
        }
    });

    // ── Firebase Auth helpers ────────────────────────────────────────────────
    function isUserSignedIn() {
        // If Firebase isn't configured, we keep existing local behaviour.
        return !authEnabled || !!authUser;
    }

    function refreshPersonalBestsVisibility() {
        if (!authEnabled) {
            renderPersonalBestsUI(getPersonalBests());
            return;
        }

        if (!authUser) {
            personalBestsEmpty.textContent = 'Sign in with Google to sync Personal Bests (PRs).';
            personalBestsEmpty.classList.remove('hidden');
            personalBestsTable.classList.add('hidden');
            personalBestsTable.replaceChildren();
            return;
        }

        renderPersonalBestsUI(getPersonalBests());
    }


    function clearAuthError() {
        lastAuthErrorCode = null;
        lastAuthErrorMessage = null;
        renderAuthDiagnostics();
    }

    function captureAuthError(err, fallbackMessage) {
        lastAuthErrorCode = (err && err.code) ? err.code : null;
        lastAuthErrorMessage = (err && err.message) ? err.message : (fallbackMessage || null);
        renderAuthDiagnostics();
    }

    function describeFirebaseUser(user) {
        if (!user) return 'none';
        const email = user.email || '(no email)';
        const uid = user.uid ? user.uid.slice(0, 8) + '…' : '(no uid)';
        return `${email} [${uid}]`;
    }

    function probeAuthStorage() {
        const result = [];
        try {
            const k = '__auth_probe__';
            localStorage.setItem(k, '1');
            localStorage.removeItem(k);
            result.push('localStorage:ok');
        } catch (e) {
            result.push(`localStorage:blocked(${e.name || 'err'})`);
        }
        try {
            const k = '__auth_probe__';
            sessionStorage.setItem(k, '1');
            sessionStorage.removeItem(k);
            result.push('sessionStorage:ok');
        } catch (e) {
            result.push(`sessionStorage:blocked(${e.name || 'err'})`);
        }
        result.push(`cookieEnabled:${navigator.cookieEnabled ? 'yes' : 'no'}`);
        return result.join(' · ');
    }

    function renderAuthDiagnostics() {
        if (!authDiagnosticsEl) return;
        const authDomain = (firebaseConfig && firebaseConfig.authDomain) || 'unknown';
        const origin = (location && location.origin) || 'unknown';
        const authDomainOrigin = `https://${authDomain}`;
        const crossOrigin = authDomain !== 'unknown' && origin !== authDomainOrigin;
        const lines = [
            'Auth diagnostics',
            `origin: ${origin}`,
            `authDomain: ${authDomain}${crossOrigin ? ' (cross-origin → iframe flow)' : ''}`,
            `config source: ${firebaseConfigSource || 'not found'}`,
            `auth enabled: ${authEnabled ? 'yes' : 'no'}`,
            `auth persistence: ${authPersistenceMode}`,
            `current user: ${authCurrentUserSummary}`,
            `last state change: ${authLastStateChange}`,
            `redirect result: ${authRedirectResultSummary}`,
            `storage: ${authStorageSummary}`,
            `UA: ${(navigator.userAgent || '').slice(0, 90)}`,
            `last auth error code: ${lastAuthErrorCode || 'none'}`,
            `last auth error message: ${lastAuthErrorMessage || 'none'}`
        ];
        authDiagnosticsEl.textContent = lines.join('\n');
    }

    function setAuthStatus(message, level = 'disconnected') {
        if (!authStatusEl) return;
        authStatusEl.textContent = message || 'Signed out';
        authStatusEl.className = `status ${level}`;
    }

    function setAuthBusy(busy, action = null) {
        authBusy = !!busy;
        authBusyAction = authBusy ? (action || authBusyAction || 'signin') : null;
        updateAuthUI();
        renderAuthDiagnostics();
    }

    function isAuthOriginSupported() {
        if (typeof location === 'undefined') return false;
        if (location.protocol === 'https:') return true;
        if (location.protocol !== 'http:') return false;
        const host = (location.hostname || '').toLowerCase();
        return host === 'localhost' || host === '127.0.0.1' || host === '::1';
    }

    async function configureAuthPersistence() {
        if (!firebaseAuth || typeof firebase === 'undefined' || !firebase.auth || !firebase.auth.Auth || !firebase.auth.Auth.Persistence) {
            authPersistenceMode = 'unknown';
            return;
        }

        try {
            await firebaseAuth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
            authPersistenceMode = 'local';
        } catch (errLocal) {
            try {
                await firebaseAuth.setPersistence(firebase.auth.Auth.Persistence.SESSION);
                authPersistenceMode = 'session';
                captureAuthError(errLocal, 'Falling back to session auth persistence.');
                log(`Auth persistence fallback (session): ${errLocal && errLocal.message ? errLocal.message : 'LOCAL persistence failed.'}`);
            } catch (errSession) {
                authPersistenceMode = 'none';
                captureAuthError(errSession, 'Browser storage is unavailable; sign-in will not persist.');
                log(`Auth persistence disabled: ${errSession && errSession.message ? errSession.message : 'SESSION persistence failed.'}`);
            }
        }
    }

    function getAuthErrorMessage(err, phase = 'auth') {
        if (!err) return 'Google sign-in is temporarily unavailable.';
        const code = err.code || '';
        if (code === 'auth/unauthorized-domain') {
            return 'This domain is not authorized in Firebase Authentication settings.';
        }
        if (code === 'auth/operation-not-allowed') {
            return 'Google sign-in is disabled in Firebase Authentication providers.';
        }
        if (code === 'auth/invalid-api-key') {
            return 'Firebase API key is invalid for this build.';
        }
        if (code === 'auth/invalid-app-credential' || code === 'auth/app-not-authorized') {
            return 'OAuth app credentials are invalid for this origin.';
        }
        if (phase === 'init') {
            return `Cloud sync unavailable: ${err.message || 'Firebase initialization failed.'}`;
        }
        return err.message || 'Google sign-in failed.';
    }

    function updateAuthUI() {
        const disableAuthActions = authBusy || !firebaseAuth;
        if (!authEnabled) {
            setAuthStatus(authDisabledReason, authStatusLevel || 'disconnected');
            if (googleSignInBtn) {
                googleSignInBtn.disabled = true;
                googleSignInBtn.style.opacity = 0.55;
                googleSignInBtn.style.display = '';
                googleSignInBtn.textContent = AUTH_SIGN_IN_LABEL;
                googleSignInBtn.classList.remove('is-loading');
            }
            if (googleSignOutBtn) {
                googleSignOutBtn.style.display = 'none';
                googleSignOutBtn.disabled = true;
                googleSignOutBtn.textContent = AUTH_SIGN_OUT_LABEL;
                googleSignOutBtn.classList.remove('is-loading');
            }
            return;
        }

        const signedIn = !!authUser;
        if (signedIn) {
            authStatusLevel = 'connected';
            setAuthStatus(`Signed in: ${authUser.displayName || authUser.email || 'Google'}`, 'connected');
        } else {
            authStatusLevel = 'disconnected';
            setAuthStatus('Signed out', 'disconnected');
        }

        if (googleSignInBtn) {
            const signInBusy = authBusyAction === 'signin' && authBusy;
            googleSignInBtn.disabled = signedIn || disableAuthActions;
            googleSignInBtn.style.opacity = (signedIn || disableAuthActions) ? 0.6 : 1;
            googleSignInBtn.style.display = '';
            googleSignInBtn.textContent = signInBusy ? AUTH_SIGNING_IN_LABEL : AUTH_SIGN_IN_LABEL;
            googleSignInBtn.classList.toggle('is-loading', signInBusy);
        }
        if (googleSignOutBtn) {
            const signOutBusy = authBusyAction === 'signout' && authBusy;
            googleSignOutBtn.style.display = signedIn ? '' : 'none';
            googleSignOutBtn.disabled = disableAuthActions;
            googleSignOutBtn.textContent = signOutBusy ? AUTH_SIGNING_OUT_LABEL : AUTH_SIGN_OUT_LABEL;
            googleSignOutBtn.classList.toggle('is-loading', signOutBusy);
        }
    }

    function isFirebaseConfigured(config) {
        if (!config) return false;

        return !!(
            config.apiKey &&
            config.authDomain &&
            config.projectId &&
            config.appId &&
            !String(config.apiKey).startsWith('YOUR_')
        );
    }

    function getFirebaseConfigFromWindow() {
        if (typeof window === 'undefined') return null;
        const candidates = [
            { name: 'RUNNING_COACH_FIREBASE_CONFIG', value: window.RUNNING_COACH_FIREBASE_CONFIG },
            { name: 'FIREBASE_CONFIG', value: window.FIREBASE_CONFIG },
            { name: '__FIREBASE_CONFIG__', value: window.__FIREBASE_CONFIG__ }
        ];

        for (const candidate of candidates) {
            if (isFirebaseConfigured(candidate.value)) {
                firebaseConfigSource = `window.${candidate.name}`;
                return candidate.value;
            }
        }

        return null;
    }

    function getFirebaseConfigFromInlineJsonScript() {
        if (typeof document === 'undefined') return null;
        const scriptEl = document.getElementById('firebaseConfigJson');
        if (!scriptEl) return null;

        try {
            const parsed = JSON.parse(scriptEl.textContent || '{}');
            if (isFirebaseConfigured(parsed)) {
                firebaseConfigSource = '#firebaseConfigJson';
                return parsed;
            }
        } catch (e) {
            log(`Inline Firebase config parse error: ${e.message}`);
        }

        return null;
    }

    async function loadFirebaseConfig() {
        const configFromWindow = getFirebaseConfigFromWindow();
        if (isFirebaseConfigured(configFromWindow)) return configFromWindow;

        const configFromInlineJson = getFirebaseConfigFromInlineJsonScript();
        if (isFirebaseConfigured(configFromInlineJson)) return configFromInlineJson;

        try {
            const response = await fetch(FIREBASE_JSON_CONFIG_PATH, { cache: 'no-store' });
            if (response.ok) {
                const configFromJson = await response.json();
                if (isFirebaseConfigured(configFromJson)) {
                    firebaseConfigSource = FIREBASE_JSON_CONFIG_PATH;
                    return configFromJson;
                }
            }
        } catch (_) {
            // json config is optional; we report a clear status in initFirebaseAuth.
        }

        firebaseConfigSource = null;
        return null;
    }

    async function initFirebaseAuth() {
        try {
            if (!isAuthOriginSupported()) {
                authEnabled = false;
                const originText = (typeof location !== 'undefined' && location.origin) ? location.origin : 'this origin';
                authDisabledReason = `Google sign-in requires HTTPS (or localhost). Current origin is ${originText}.`;
                updateAuthUI();
                return;
            }

            if (typeof firebase === 'undefined') {
                authEnabled = false;
                authDisabledReason = 'Cloud sync unavailable right now.';
                authStatusLevel = 'error';
                updateAuthUI();
                return;
            }

            firebaseConfig = await loadFirebaseConfig();
            if (!isFirebaseConfigured(firebaseConfig)) {
                authEnabled = false;
                authDisabledReason = 'Cloud sync unavailable on this build (missing Firebase config).';
                authStatusLevel = 'disconnected';
                log('Firebase init failed: config missing/invalid in window.RUNNING_COACH_FIREBASE_CONFIG and firebase-config.json.');
                updateAuthUI();
                return;
            }

            if (!firebase.apps || firebase.apps.length === 0) {
                firebase.initializeApp(firebaseConfig);
            }

            firebaseAuth = firebase.auth();
            await configureAuthPersistence();
            firebaseDb = firebase.firestore();
            authEnabled = true;
            authDisabledReason = 'Cloud sync unavailable on this build (missing Firebase config).';
            authStatusLevel = 'disconnected';

            updateAuthUI();

            authStorageSummary = probeAuthStorage();
            authCurrentUserSummary = describeFirebaseUser(firebaseAuth.currentUser);
            log(`Firebase initialized from ${firebaseConfigSource || 'runtime config'}. currentUser=${authCurrentUserSummary}; storage=${authStorageSummary}.`);
            renderAuthDiagnostics();

            firebaseAuth.onAuthStateChanged(user => {
                authUser = user || null;
                authCurrentUserSummary = describeFirebaseUser(user);
                authLastStateChange = `${new Date().toISOString().slice(11, 19)} ${user ? 'signed-in' : 'signed-out'}`;
                log(`Auth state changed: ${authLastStateChange} user=${authCurrentUserSummary}`);
                clearAuthError();
                setAuthBusy(false);
                updateAuthUI();
                if (authUser) {
                    syncUserDataFromFirestore(authUser.uid).catch(e => log(`PR sync error: ${e.message}`));
                }
                refreshPersonalBestsVisibility();
            });

            // Resolve any pending redirect sign-in (mobile flow) so errors surface
            // and the busy UI unsticks when the user returns to the page.
            firebaseAuth.getRedirectResult()
                .then(result => {
                    if (result && result.user) {
                        authRedirectResultSummary = `success · ${describeFirebaseUser(result.user)}`;
                        log(`Google sign-in redirect completed for ${describeFirebaseUser(result.user)}.`);
                    } else {
                        authRedirectResultSummary = 'no pending redirect';
                    }
                })
                .catch(err => {
                    authRedirectResultSummary = `error · ${err && err.code ? err.code : 'unknown'}`;
                    setAuthStatus(getAuthErrorMessage(err), 'error');
                    captureAuthError(err);
                    log(`Google sign-in redirect result error: ${err && err.code ? err.code + ' ' : ''}${err && err.message ? err.message : err}`);
                })
                .finally(() => {
                    setAuthBusy(false);
                    renderAuthDiagnostics();
                });
        } catch (e) {
            authEnabled = false;
            authDisabledReason = getAuthErrorMessage(e, 'init');
            authStatusLevel = 'error';
            setAuthStatus(authDisabledReason, 'error');
            log(`Firebase init error: ${e.message}`);
            updateAuthUI();
        }
    }

    // ── Firestore sync (runs + PRs) ──────────────────────────────────────────
    async function syncUserDataFromFirestore(uid) {
        if (!firebaseDb || !uid) return;
        await Promise.all([
            loadPersonalBestsFromFirestore(uid),
            loadRunsFromFirestore(uid)
        ]);
    }

    async function loadPersonalBestsFromFirestore(uid) {
        if (!firebaseDb || !uid) return {};
        const pb = {};

        const snap = await firebaseDb.collection('users').doc(uid).collection('pr').get();
        snap.forEach(doc => {
            const km = parseInt(doc.id, 10);
            if (!(km >= 1 && km <= 10)) return;
            const d = doc.data() || {};
            pb[String(km)] = {
                bestTimeSec: isFinite(d.bestTimeSec) ? d.bestTimeSec : undefined,
                bestAvgPaceMinPerKm: isFinite(d.bestAvgPaceMinPerKm) ? d.bestAvgPaceMinPerKm : undefined,
                best1kPaceMinPerKm: isFinite(d.best1kPaceMinPerKm) ? d.best1kPaceMinPerKm : undefined
            };
        });

        localStorage.setItem(`personalBests:${uid}`, JSON.stringify(pb));
        // Only rerender if PR is currently allowed to show.
        refreshPersonalBestsVisibility();
        return pb;
    }

    async function loadRunsFromFirestore(uid) {
        if (!firebaseDb || !uid) return [];

        const runsRef = firebaseDb
            .collection('users').doc(uid)
            .collection('runs')
            .orderBy('date', 'desc')
            .limit(HISTORY_MAX);

        const snap = await runsRef.get();
        const runs = snap.docs.map(d => d.data());

        localStorage.setItem(`runHistory:${uid}`, JSON.stringify(runs));

        // Update History FAB + overlay content when available.
        historyFab.classList.toggle('hidden', runs.length === 0);
        if (historyOverlay.classList.contains('active')) {
            renderHistoryOverlay();
        }
        return runs;
    }

    // ── Session-relative helpers ───────────────────────────────────────────────
    /**
     * Returns session-relative metrics derived from raw cumulative BLE data.
     * Returns null if session start hasn't been captured yet.
     */
    function getSessionData(data) {
        if (sessionStartDistance === null) return null;
        return {
            distance:  Math.max(0, data.distance  - sessionStartDistance),
            time:      Math.max(0, data.time       - sessionStartTreadmillTime),
            calories:  Math.max(0, data.calories   - sessionStartCalories),
            speed:     data.speed,
            incline:   data.incline,
            heartRate: data.heartRate || 0
        };
    }

    function resetSessionState() {
        sessionStartDistance      = null;
        sessionStartTreadmillTime = null;
        sessionStartCalories      = null;
        sessionMaxSpeed   = 0;
        sessionSpeedSum   = 0;
        sessionSpeedCount = 0;
        splits            = [];
        lastSplitDistance = 0;
        prevSdDistance    = null;
        prevSdTime        = null;
        speedSamples      = [];
        lastSpeedSampleMs = 0;
        paused            = false;
        pauseBtn.textContent = 'Pause';
        pauseBtn.classList.remove('paused');
        // Workout + coaching debounce resets
        workoutBlockIdx       = 0;
        workoutCompleted      = false;
        lastBlockIdxAnnounced = -1;
        lastHrZoneAnnounced   = null;
        driftSinceMs          = 0;
        lastDriftAnnounceMs   = 0;
        goalCompleteAnnounced = false;
    }

    // ── Goal logic ─────────────────────────────────────────────────────────────
    function confirmGoal() {
        // Only parse goal values when the user is actually in Goal Run mode.
        if (sessionMode === 'goal') {
            const dVal = parseFloat(goalDistanceInput.value);
            const tVal = parseFloat(goalTimeInput.value);
            goalDistance = (!isNaN(dVal) && dVal > 0) ? dVal : null;
            goalTime     = (!isNaN(tVal) && tVal > 0) ? tVal : null;
        } else {
            goalDistance = null;
            goalTime     = null;
        }

        // Initialise workout engine if in workout mode.
        if (sessionMode === 'workout') {
            if (!selectedWorkoutId || !WORKOUT_PRESETS[selectedWorkoutId]) return;
            const preset = WORKOUT_PRESETS[selectedWorkoutId];
            activeWorkout = { id: preset.id, name: preset.name, blocks: preset.blocks };
            workoutBlockIdx = 0;
            workoutCompleted = false;
            lastBlockIdxAnnounced = -1;
        } else {
            activeWorkout = null;
        }

        goalConfirmed = true;

        let parts = [];
        if (goalDistance) parts.push(`${goalDistance} km`);
        if (goalTime)     parts.push(`${goalTime} min`);
        let summaryStr;
        if (sessionMode === 'workout' && activeWorkout) {
            summaryStr = `🏋 Workout: ${activeWorkout.name}`;
        } else if (sessionMode === 'goal' && parts.length) {
            summaryStr = `🎯 Goal: ${parts.join(' · ')}`;
        } else {
            summaryStr = '🏃 Free Run — no target';
        }

        goalSummaryText.textContent = summaryStr;
        goalSummary.classList.add('active');
        goalInputSection.style.display = 'none';

        distanceProgress.classList.toggle('active', !!goalDistance);
        timeProgress.classList.toggle('active', !!goalTime);

        // Bring the active-run UI online now.
        metricsCard.classList.remove('hidden');
        coachingCard.classList.add('active');
        sessionControlsEl.classList.add('active');
        setAppState('active');

        renderSessionModeBadge();
        renderWorkoutPanel(null);
        renderTargetBand(null);
        renderPaceTargets(null);

        log(`Session started — mode: ${sessionMode}, distance: ${goalDistance} km, time: ${goalTime} min, workout: ${activeWorkout?.name || '-'}`);

        // Restart coaching timer (may have been stopped by finishSession)
        startCoachingTimer();
        lastCoachingTime = Date.now();
    }

    function updateGoalProgress(sd) {
        if (!sd) return;
        if (goalDistance) {
            const pct = Math.min(100, (sd.distance / goalDistance) * 100);
            distanceProgressFill.style.width = pct + '%';
            distanceProgressText.textContent =
                `${sd.distance.toFixed(2)} / ${goalDistance} km`;
        }
        if (goalTime) {
            const elapsedMin = sd.time / 60;
            const pct = Math.min(100, (elapsedMin / goalTime) * 100);
            timeProgressFill.style.width = pct + '%';
            timeProgressText.textContent =
                `${elapsedMin.toFixed(1)} / ${goalTime} min`;
        }
    }

    // ── Stop / Finish session ──────────────────────────────────────────────────
    /**
     * Called when the user taps Stop Run.
     * If there's nothing meaningful to save, just reset silently.
     * Otherwise show the Save/Discard modal.
     */
    function stopSession() {
        const sd = getSessionData(lastData);
        if (!sd || (sd.distance < 0.05 && sd.time < 10)) {
            // Nothing worth saving — silent reset
            log('Stop tapped with no meaningful session data — resetting');
            finishSession();
            return;
        }
        renderStopModal(sd);
        stopModal.classList.add('active');
        setAppState('postrun');
        // Stop coaching while modal is open
        stopCoachingTimer();
    }

    /**
     * Populates the Review-run modal with session stats, mode context,
     * distance correction input, and (when applicable) a workout block summary.
     */
    function renderStopModal(sd) {
        // Summary grid
        stopModalDistEl.textContent = sd.distance.toFixed(2);
        stopModalTimeEl.textContent = formatDuration(sd.time);
        stopModalCalEl.textContent  = sd.calories;

        // Derived Strava-like stats for the end-of-run summary.
        const preview = buildWorkoutRecord(sd);
        stopModalAvgPaceEl.textContent = Number.isFinite(preview.avgPaceMinPerKm)
            ? formatPace(preview.avgPaceMinPerKm).replace('/km', '')
            : '--:--';
        stopModalBest1kEl.textContent = Number.isFinite(preview.best1kPaceMinPerKm)
            ? formatPace(preview.best1kPaceMinPerKm).replace('/km', '')
            : '--:--';

        // Mode badge + meta (support mode, coaching mode)
        let modeLabel = 'Free Run';
        let modeKey = 'free';
        if (sessionMode === 'goal') { modeLabel = 'Goal Run'; modeKey = 'goal'; }
        else if (sessionMode === 'workout' && activeWorkout) { modeLabel = activeWorkout.name; modeKey = 'workout'; }
        stopModalModeEl.textContent = modeLabel;
        stopModalModeEl.dataset.mode = modeKey;

        const metaParts = [supportModeLabel(getSupportMode())];
        if (coachingMode && coachingMode !== 'quiet') metaParts.push(`Coach: ${coachingMode}`);
        else if (coachingMode === 'quiet') metaParts.push('Coach: quiet');
        stopModalMetaEl.textContent = metaParts.join(' · ');

        // Distance correction
        stopModalRawDist.textContent = sd.distance.toFixed(2);
        stopModalFinalDist.value     = sd.distance.toFixed(2);
        stopModalFinalDist.dataset.raw = sd.distance.toFixed(2);

        // Workout block summary (only in Workout mode)
        if (activeWorkout) {
            const titleEl = document.createElement('div');
            titleEl.className = 'modal-blocks-title';
            titleEl.textContent = 'Workout blocks';

            stopModalBlocksEl.replaceChildren(titleEl);
            activeWorkout.blocks.forEach((b, i) => {
                const mins = Math.floor(b.durationSec / 60);
                const secs = b.durationSec % 60;
                const dur  = mins > 0 ? `${mins}:${String(secs).padStart(2,'0')}` : `${secs}s`;
                const target = (b.targetSpeedMin && b.targetSpeedMax)
                    ? `${b.targetSpeedMin}–${b.targetSpeedMax} km/h`
                    : '—';
                const status = (workoutCompleted || i < workoutBlockIdx) ? '✓ ' : (i === workoutBlockIdx ? '• ' : '');

                const rowEl = document.createElement('div');
                rowEl.className = 'mb-item';

                const labelEl = document.createElement('span');
                labelEl.className = 'mb-item-label';
                labelEl.textContent = `${status}${b.label || 'Block'}`;

                const metaEl = document.createElement('span');
                metaEl.className = 'mb-item-meta';
                metaEl.textContent = `${dur} · ${target}`;

                rowEl.append(labelEl, metaEl);
                stopModalBlocksEl.appendChild(rowEl);
            });
            stopModalBlocksEl.classList.remove('hidden');
        } else {
            stopModalBlocksEl.classList.add('hidden');
            stopModalBlocksEl.replaceChildren();
        }
    }

    /**
     * Resets all session state after a Stop Run (Save or Discard).
     * BLE stays connected — user can start a new session immediately.
     */
    function finishSession() {
        endRunBusy = false;
        sessionStopped = false;
        stopCoachingTimer();
        resetSessionState();

        // Reset goal state
        goalDistance  = null;
        goalTime      = null;
        goalConfirmed = false;

        // Return goal UI to input mode
        goalSummary.classList.remove('active');
        goalInputSection.style.display = '';
        goalDistanceInput.value = '';
        goalTimeInput.value     = '';

        // Hide progress bars
        distanceProgress.classList.remove('active');
        timeProgress.classList.remove('active');

        // Hide the live-run cards; return to pre-run layout.
        metricsCard.classList.add('hidden');
        coachingCard.classList.remove('active');
        sessionControlsEl.classList.remove('active');
        // Clear active-run-only panels
        activeWorkout = null;
        if (workoutPanelEl) workoutPanelEl.classList.add('hidden');
        if (targetBandEl)   targetBandEl.classList.add('hidden');
        if (paceTargetsEl)  paceTargetsEl.classList.add('hidden');

        // Set idle coaching message (no timer restart — waits for next goal confirm)
        setCoachingMessage('Ready when you are', 'Connect your treadmill, choose a mode, then tap the primary button to start.');
        coachTimerEl.textContent = '';

        setAppState('prerun');
        updatePrimaryCTA();

        log('Session finished — ready for next run');
    }

    // ── Connection ─────────────────────────────────────────────────────────────
    async function connectToTreadmill() {
        updateStatus('connecting', 'Searching...');
        log('Requesting BLE device...');

        device = await navigator.bluetooth.requestDevice({
            filters: [{ services: [FTMS_SERVICE_UUID] }],
            optionalServices: [FTMS_SERVICE_UUID]
        });

        log(`Device: ${device.name}`);
        updateStatus('connecting', `Connecting to ${device.name}…`);

        await establishGattConnection();
        device.addEventListener('gattserverdisconnected', handleDisconnection);
        updateStatus('connected', `Connected: ${device.name}`);
        onConnected();
    }

    async function establishGattConnection() {
        const server  = await device.gatt.connect();
        const service = await server.getPrimaryService(FTMS_SERVICE_UUID);
        log('Got Fitness Machine Service');

        treadmillDataCharacteristic = await service.getCharacteristic(TREADMILL_DATA_UUID);
        await treadmillDataCharacteristic.startNotifications();
        treadmillDataCharacteristic.addEventListener('characteristicvaluechanged', handleTreadmillData);
        log('Treadmill data notifications started');

        try {
            controlPointCharacteristic = await service.getCharacteristic(CONTROL_POINT_UUID);
            const reqBuf = new ArrayBuffer(1);
            new DataView(reqBuf).setUint8(0, 0x00);
            await controlPointCharacteristic.writeValue(reqBuf);
            log('Control point acquired');
            controlsCard.classList.add('active');
            enableControls(true);
        } catch (e) {
            log(`Control point unavailable: ${e.message}`);
            controlPointCharacteristic = null;
        }
    }

    function onConnected() {
        // On connect we're still pre-run. User must confirm Start Run / Let's Go
        // to enter the active state. So we do NOT show metrics / coach / session
        // controls here — those come online when confirmGoal() fires.
        connectBtn.textContent = 'Disconnect';
        reconnectAttempts = 0;

        renderStatusChips();
        renderCapabilitySummary();
        updatePrimaryCTA();

        // Session-relative state is NOT initialised here — lazy-init on first packet.
        resetSessionState();
    }

    function disconnect() {
        if (device && device.gatt.connected) device.gatt.disconnect();
    }

    async function handleDisconnection() {
        log('Device disconnected');
        stopCoachingTimer();

        // Safety check: Stop Run should never trigger a BLE disconnect
        if (sessionStopped) {
            log('Warning: BLE disconnected unexpectedly while sessionStopped=true');
            sessionStopped = false;
            return;
        }

        if (manualDisconnect) {
            // User tapped Disconnect button — treat it like ending the run.
            // Show the Save/Discard modal (same as Stop Run) instead of silently auto-saving.
            stopSession();
            resetUI(false); // Keep stop modal open while user decides.
            manualDisconnect = false;
            return;
        }

        // Involuntary disconnect — attempt reconnect
        await tryReconnect();
    }

    async function tryReconnect() {
        if (reconnectAttempts >= MAX_RECONNECT_TRIES) {
            log('Max reconnect attempts reached — giving up');
            autoSaveOnDisconnect();
            resetUI();
            updateStatus('disconnected', 'Connection lost');
            return;
        }

        reconnectAttempts++;
        const delay = reconnectAttempts * 1500;
        updateStatus('reconnecting', `Reconnecting… (${reconnectAttempts}/${MAX_RECONNECT_TRIES})`);
        log(`Reconnect attempt ${reconnectAttempts} in ${delay}ms`);

        await new Promise(r => setTimeout(r, delay));

        try {
            treadmillDataCharacteristic?.removeEventListener('characteristicvaluechanged', handleTreadmillData);
            await establishGattConnection();
            updateStatus('connected', `Connected: ${device.name}`);
            reconnectAttempts = 0;
            log('Reconnected successfully');
            if (!paused) startCoachingTimer();
        } catch (e) {
            log(`Reconnect attempt ${reconnectAttempts} failed: ${e.message}`);
            await tryReconnect();
        }
    }

    function resetUI(closeStopModal = true) {
        metricsCard.classList.add('hidden');
        coachingCard.classList.remove('active');
        controlsCard.classList.remove('active');
        goalCard.classList.remove('active');
        sessionControlsEl.classList.remove('active');
        connectBtn.textContent = 'Connect';
        enableControls(false);
        controlPointCharacteristic = null;
        updateStatus('disconnected', 'Disconnected');
        setAppState('prerun');
        renderStatusChips();
        renderCapabilitySummary();
        updatePrimaryCTA();
        // Close stop modal if open (except when we intentionally keep it open).
        if (closeStopModal) stopModal.classList.remove('active');
    }

    function enableControls(on) {
        [speedUpBtn, speedDownBtn, inclineUpBtn, inclineDownBtn,
         preset7Btn, preset9Btn, preset11Btn, preset13Btn, preset15Btn].forEach(b => { if (b) b.disabled = !on; });
    }

    // ── Heart Rate Monitor ─────────────────────────────────────────────────────
    async function connectToHRMonitor() {
        updateHRStatus('connecting', 'Searching for HR...');
        log('Requesting HR monitor device...');
        hrDevice = await navigator.bluetooth.requestDevice({
            filters: [{ services: [HR_SERVICE_UUID] }],
            optionalServices: [HR_SERVICE_UUID]
        });
        log(`HR device: ${hrDevice.name}`);
        updateHRStatus('connecting', `Connecting to ${hrDevice.name}…`);
        await establishHRConnection();
        hrDevice.addEventListener('gattserverdisconnected', handleHRDisconnection);
        updateHRStatus('connected', `HR: ${hrDevice.name}`);
        hrConnectBtn.textContent = 'Disconnect HR';
    }

    async function establishHRConnection() {
        const server  = await hrDevice.gatt.connect();
        const service = await server.getPrimaryService(HR_SERVICE_UUID);
        hrCharacteristic = await service.getCharacteristic(HR_MEASUREMENT_UUID);
        await hrCharacteristic.startNotifications();
        hrCharacteristic.addEventListener('characteristicvaluechanged', handleHRData);
        log('HR Monitor notifications started');
    }

    function handleHRData(event) {
        const value = event.target.value;
        const flags = value.getUint8(0);
        hrBpm = (flags & 0x01) ? value.getUint16(1, true) : value.getUint8(1);
        updateHRDisplay(hrBpm);
        log(`HR: ${hrBpm} bpm`);
    }

    function updateHRDisplay(bpm) {
        // Refresh capability summary lazily in case HR-from-treadmill just appeared.
        renderCapabilitySummary();
        if (bpm <= 0) { hrMetricWrap.classList.add('hidden'); return; }
        hrMetricEl.textContent = bpm;
        let zoneClass, zoneText;
        if      (bpm < 120) { zoneClass = 'easy';      zoneText = 'Easy'; }
        else if (bpm < 140) { zoneClass = 'aerobic';   zoneText = 'Aerobic'; }
        else if (bpm < 160) { zoneClass = 'tempo';     zoneText = 'Tempo'; }
        else if (bpm < 175) { zoneClass = 'threshold'; zoneText = 'Threshold'; }
        else                { zoneClass = 'max';       zoneText = 'Max'; }
        hrZoneLabelEl.className = `hr-zone ${zoneClass}`;
        hrZoneLabelEl.textContent = zoneText;
        hrMetricWrap.classList.remove('hidden');

        // Sparse coach event on HR zone transitions while actively running.
        if (appState === 'active' && lastHrZoneAnnounced !== zoneText) {
            // Don't announce the very first zone readout.
            if (lastHrZoneAnnounced !== null) {
                fireCoachEvent('hr-zone', `Heart rate ${zoneText} zone, ${bpm} BPM.`, 100);
            }
            lastHrZoneAnnounced = zoneText;
        }
    }

    async function handleHRDisconnection() {
        log('HR monitor disconnected');
        if (hrManualDisconnect) {
            hrBpm = 0;
            updateHRDisplay(0);
            updateHRStatus('disconnected', 'HR Not Connected');
            hrConnectBtn.textContent = 'HR Monitor';
            return;
        }
        if (hrReconnectAttempts < MAX_RECONNECT_TRIES) {
            hrReconnectAttempts++;
            updateHRStatus('reconnecting', `HR reconnecting… (${hrReconnectAttempts}/${MAX_RECONNECT_TRIES})`);
            await new Promise(r => setTimeout(r, hrReconnectAttempts * 1500));
            try {
                hrCharacteristic?.removeEventListener('characteristicvaluechanged', handleHRData);
                await establishHRConnection();
                updateHRStatus('connected', `HR: ${hrDevice.name}`);
                hrReconnectAttempts = 0;
                log('HR Monitor reconnected');
            } catch (e) {
                log(`HR reconnect ${hrReconnectAttempts} failed: ${e.message}`);
                await handleHRDisconnection();
            }
        } else {
            hrBpm = 0;
            updateHRDisplay(0);
            updateHRStatus('disconnected', 'HR signal lost');
            hrConnectBtn.textContent = 'HR Monitor';
        }
    }

    function updateHRStatus(state, message) {
        hrStatusDiv.className = `status ${state}`;
        hrStatusDiv.textContent = message;
        renderStatusChips();
        renderCapabilitySummary();
    }

    // ── Speed / Incline ────────────────────────────────────────────────────────
    function adjustSpeed(delta) {
        const v = parseFloat((targetSpeed + delta).toFixed(1));
        setTargetSpeed(Math.max(SPEED_MIN, Math.min(SPEED_MAX, v)));
    }

    function adjustIncline(delta) {
        const v = parseFloat((targetIncline + delta).toFixed(1));
        setTargetIncline(Math.max(INCLINE_MIN, Math.min(INCLINE_MAX, v)));
    }

    async function setTargetSpeed(speed) {
        targetSpeed = speed;
        targetSpeedEl.textContent = speed.toFixed(1);
        await sendSpeedCommand(speed);
    }

    async function setTargetIncline(incline) {
        targetIncline = incline;
        targetInclineEl.textContent = incline.toFixed(1);
        await sendInclineCommand(incline);
    }

    async function sendSpeedCommand(speedKmh) {
        if (!controlPointCharacteristic) return;
        try {
            const buf  = new ArrayBuffer(3);
            const view = new DataView(buf);
            view.setUint8(0, 0x02);
            view.setUint16(1, Math.round(speedKmh * 100), true);
            await controlPointCharacteristic.writeValue(buf);
            log(`Speed → ${speedKmh} km/h`);
        } catch (e) { log(`Speed write error: ${e.message}`); }
    }

    async function sendInclineCommand(inclinePct) {
        if (!controlPointCharacteristic) return;
        try {
            const buf  = new ArrayBuffer(3);
            const view = new DataView(buf);
            view.setUint8(0, 0x03);
            view.setInt16(1, Math.round(inclinePct * 10), true);
            await controlPointCharacteristic.writeValue(buf);
            log(`Incline → ${inclinePct}%`);
        } catch (e) { log(`Incline write error: ${e.message}`); }
    }

    // ── Data handling ──────────────────────────────────────────────────────────
    function handleTreadmillData(event) {
        const data = parseTreadmillData(event.target.value);
        lastData = data;

        // ── Lazy session-start initialisation ─────────────────────────────────
        if (sessionStartDistance === null) {
            sessionStartDistance      = data.distance;
            sessionStartTreadmillTime = data.time;
            sessionStartCalories      = data.calories;
            log(`Session start captured: dist=${data.distance.toFixed(3)}, time=${data.time}s, cal=${data.calories}`);
        }

        const sd = getSessionData(data);

        // ── Speed accumulators ─────────────────────────────────────────────────
        if (data.speed > 0) {
            sessionSpeedSum += data.speed;
            sessionSpeedCount++;
            if (data.speed > sessionMaxSpeed) sessionMaxSpeed = data.speed;
        }

        // ── Speed sample (throttled to once per 30 s) ──────────────────────────
        const now = Date.now();
        if (sd && data.speed > 0 && now - lastSpeedSampleMs >= SPEED_SAMPLE_INTERVAL_MS) {
            speedSamples.push([sd.time, data.speed]);
            if (speedSamples.length > SPEED_SAMPLE_MAX) speedSamples.shift();
            lastSpeedSampleMs = now;
        }

        // ── Per-km split tracking ──────────────────────────────────────────────
        if (sd) {
            const currDist = sd.distance;
            const currTime = sd.time;

            // Interpolate exact crossing times for each whole-km boundary.
            // We use linear interpolation between the previous packet and the current packet.
            if (prevSdDistance !== null && prevSdTime !== null && currDist > prevSdDistance) {
                const prevDist = prevSdDistance;
                const prevTime = prevSdTime;

                let nextSplitKm = Math.floor(lastSplitDistance) + 1;
                const endKm = Math.floor(currDist);

                while (nextSplitKm <= endKm) {
                    // Only interpolate if that km boundary is within (prevDist, currDist].
                    if (nextSplitKm <= prevDist) {
                        nextSplitKm++;
                        continue;
                    }
                    if (nextSplitKm > currDist) break;

                    const ratio = (nextSplitKm - prevDist) / (currDist - prevDist);
                    const crossTime = prevTime + ratio * (currTime - prevTime);

                    splits.push({ km: nextSplitKm, time: crossTime });
                    lastSplitDistance = nextSplitKm;

                    log(`Split ${nextSplitKm} km at ${formatDuration(crossTime)}`);
                    nextSplitKm++;
                }
            }

            prevSdDistance = currDist;
            prevSdTime = currTime;
        }

        // ── Workout engine tick & active-run panels ────────────────────────────
        tickWorkout(sd);
        renderWorkoutPanel(sd);
        renderTargetBand(sd);
        renderPaceTargets(sd);
        checkDriftEvent(sd);
        checkGoalCompleteEvent(sd);

        // ── UI updates (use session-relative values for display) ───────────────
        updateMetrics(data, sd);
        updateGoalProgress(sd);
    }

    // ── Workout engine ────────────────────────────────────────────────────────
    function tickWorkout(sd) {
        if (!activeWorkout || !sd) return;
        const elapsed = sd.time;
        let acc = 0, idx = 0;
        for (; idx < activeWorkout.blocks.length; idx++) {
            acc += activeWorkout.blocks[idx].durationSec;
            if (elapsed < acc) break;
        }
        if (idx >= activeWorkout.blocks.length) {
            if (!workoutCompleted) {
                workoutCompleted = true;
                fireCoachEvent('workout-complete', `${activeWorkout.name} complete. Great work!`, [200, 80, 200, 80, 400]);
            }
            workoutBlockIdx = activeWorkout.blocks.length - 1;
            return;
        }
        if (idx !== workoutBlockIdx) {
            workoutBlockIdx = idx;
        }
        // Announce new block once we've crossed into it.
        if (workoutBlockIdx !== lastBlockIdxAnnounced) {
            const b = activeWorkout.blocks[workoutBlockIdx];
            const mins = Math.round(b.durationSec / 60);
            const targetTxt = (b.targetSpeedMin && b.targetSpeedMax)
                ? ` — target ${b.targetSpeedMin}–${b.targetSpeedMax} km/h`
                : '';
            fireCoachEvent('block-change',
                `${b.label}${targetTxt}, ${mins > 0 ? mins + ' minute' + (mins === 1 ? '' : 's') : b.durationSec + ' seconds'}.`,
                [80, 40, 80]);
            lastBlockIdxAnnounced = workoutBlockIdx;
        }
    }

    function getCurrentBlock() {
        return activeWorkout ? activeWorkout.blocks[workoutBlockIdx] : null;
    }

    function getBlockTimeRemaining(sd) {
        if (!activeWorkout || !sd) return null;
        let acc = 0;
        for (let i = 0; i <= workoutBlockIdx; i++) acc += activeWorkout.blocks[i].durationSec;
        return Math.max(0, acc - sd.time);
    }

    function renderSessionModeBadge() {
        if (!sessionModeBadge) return;
        const mode = paused ? 'paused' : sessionMode;
        let label = 'Free Run';
        if (mode === 'goal')    label = 'Goal Run';
        if (mode === 'workout') label = activeWorkout ? activeWorkout.name : 'Workout';
        if (mode === 'paused')  label = 'Paused';
        sessionModeBadge.textContent = label;
        sessionModeBadge.dataset.mode = mode;
    }

    function renderWorkoutPanel(sd) {
        if (!workoutPanelEl) return;
        if (!activeWorkout) {
            workoutPanelEl.classList.add('hidden');
            return;
        }
        const cur = getCurrentBlock();
        const next = activeWorkout.blocks[workoutBlockIdx + 1] || null;
        const remain = getBlockTimeRemaining(sd);
        wpCurrentBlockEl.textContent = cur ? cur.label : '—';
        wpNextBlockEl.textContent    = next ? `${next.label} · ${Math.round(next.durationSec/60) || '<1'} min` : 'Cool down done';
        wpCountdownEl.textContent    = remain != null ? formatDuration(remain) : '--:--';

        // Per-block progress bar
        if (cur && sd) {
            let acc = 0;
            for (let i = 0; i < workoutBlockIdx; i++) acc += activeWorkout.blocks[i].durationSec;
            const inBlock = Math.max(0, sd.time - acc);
            const pct = Math.min(100, (inBlock / cur.durationSec) * 100);
            wpProgressFillEl.style.width = pct + '%';
        }
        workoutPanelEl.classList.remove('hidden');
    }

    function getActiveTargetBand() {
        // Priority: workout block target > goal pace ±0.5 km/h > none.
        if (activeWorkout) {
            const b = getCurrentBlock();
            if (b && b.targetSpeedMin && b.targetSpeedMax) {
                return { min: b.targetSpeedMin, max: b.targetSpeedMax, source: 'block' };
            }
        }
        if (sessionMode === 'goal' && goalDistance && goalTime && lastData) {
            const sd = getSessionData(lastData);
            if (sd) {
                const pace = analyzePace(sd);
                if (pace && pace.requiredSpeedKmh > 0) {
                    const req = pace.requiredSpeedKmh;
                    return { min: parseFloat((req - 0.5).toFixed(1)), max: parseFloat((req + 0.5).toFixed(1)), source: 'goal' };
                }
            }
        }
        return null;
    }

    function classifyBand(speed, band) {
        if (!band) return 'none';
        if (speed < band.min) return 'under';
        if (speed > band.max) return 'over';
        return 'on';
    }

    function renderTargetBand(sd) {
        if (!targetBandEl) return;
        const band = getActiveTargetBand();
        if (!band || !lastData) {
            targetBandEl.classList.add('hidden');
            return;
        }
        tbRangeEl.textContent = `${band.min.toFixed(1)}–${band.max.toFixed(1)} km/h`;
        const cls = classifyBand(lastData.speed, band);
        tbStatusEl.className = `tb-status ${cls}`;
        tbStatusEl.textContent = cls === 'on' ? 'On target' : cls === 'under' ? 'Under' : 'Over';
        targetBandEl.classList.remove('hidden');
    }

    function renderPaceTargets(sd) {
        if (!paceTargetsEl) return;
        if (sessionMode !== 'goal' || !goalDistance || !goalTime || !sd) {
            paceTargetsEl.classList.add('hidden');
            return;
        }
        const pace = analyzePace(sd);
        if (!pace) { paceTargetsEl.classList.add('hidden'); return; }

        ptRequiredEl.textContent = `${pace.requiredSpeedKmh.toFixed(1)} km/h`;
        ptCurrentEl.textContent  = `${(lastData.speed || 0).toFixed(1)} km/h`;
        const gap = pace.speedGap; // +ve = runner too slow
        const sign = gap > 0 ? '+' : gap < 0 ? '−' : '';
        ptGapEl.textContent = `${sign}${Math.abs(gap).toFixed(1)} km/h`;

        const gapCell = ptGapEl.parentElement;
        gapCell.classList.remove('gap-over','gap-under','gap-on');
        if (gap > 0.5)      gapCell.classList.add('gap-under'); // need to speed up
        else if (gap < -0.5) gapCell.classList.add('gap-over');  // ahead of pace — styled red? no, green-ish
        else                gapCell.classList.add('gap-on');

        paceTargetsEl.classList.remove('hidden');
    }

    function checkGoalCompleteEvent(sd) {
        if (goalCompleteAnnounced || sessionMode !== 'goal' || !sd) return;
        const distOk = !goalDistance || sd.distance >= goalDistance;
        const timeOk = !goalTime     || (sd.time / 60) >= goalTime;
        const either = goalDistance || goalTime;
        if (!either) return;
        if (distOk && timeOk) {
            goalCompleteAnnounced = true;
            fireCoachEvent('goal-complete', 'Goal complete. Great work!', [200, 80, 200, 80, 400]);
        }
    }

    function checkDriftEvent(sd) {
        if (!sd || !lastData) return;
        const band = getActiveTargetBand();
        if (!band) { driftSinceMs = 0; return; }
        const cls = classifyBand(lastData.speed, band);
        const now = Date.now();

        if (cls === 'on') { driftSinceMs = 0; return; }

        // Start tracking drift on first off-band reading
        if (!driftSinceMs) driftSinceMs = now;

        // Sustained > 15s off-band AND not announced in last 60s → fire
        if (now - driftSinceMs >= 15000 && now - lastDriftAnnounceMs >= 60000) {
            const msg = cls === 'under'
                ? `Pace is below target. Push to ${band.min.toFixed(1)} km/h or above.`
                : `Pace is above target. Ease back toward ${band.max.toFixed(1)} km/h.`;
            fireCoachEvent('drift-' + cls, msg, cls === 'over' ? [180, 80, 180] : [80, 40, 80, 40, 80]);
            lastDriftAnnounceMs = now;
        }
    }

    function parseTreadmillData(dataView) {
        const flags = dataView.getUint16(0, true);
        let offset  = 2;
        const data  = { speed: 0, incline: 0, distance: 0, calories: 0, time: 0, heartRate: 0 };

        try {
            data.speed = dataView.getUint16(offset, true) * 0.01;
            offset += 2;

            if (flags & 0x02) offset += 2;

            if (flags & 0x04) {
                data.distance = (dataView.getUint8(offset) +
                                (dataView.getUint8(offset + 1) << 8) +
                                (dataView.getUint8(offset + 2) << 16)) / 1000;
                offset += 3;
            }

            if (flags & 0x08) {
                data.incline = dataView.getInt16(offset, true) * 0.1;
                offset += 4;
            }

            if (flags & 0x10) offset += 2;
            if (flags & 0x20) offset += 1;
            if (flags & 0x40) offset += 1;

            if (flags & 0x80) {
                data.calories = dataView.getUint16(offset, true);
                offset += 5;
            }

            if (flags & 0x100) { data.heartRate = dataView.getUint8(offset); offset += 1; }
            if (flags & 0x200) offset += 1;
            if (flags & 0x400) { data.time = dataView.getUint16(offset, true); offset += 2; }

        } catch (e) { log(`Parse error: ${e.message}`); }

        log(`Parsed: spd=${data.speed.toFixed(1)} dist=${data.distance.toFixed(3)} t=${data.time}s cal=${data.calories}`);
        return data;
    }

    /**
     * Updates the UI metrics display.
     * @param {object} data  - raw BLE data (cumulative)
     * @param {object|null} sd - session-relative data from getSessionData()
     */
    function updateMetrics(data, sd) {
        speedEl.textContent = data.speed.toFixed(1);

        if (data.speed > 0) {
            const pace = 60 / data.speed;
            const m = Math.floor(pace);
            const s = Math.round((pace - m) * 60);
            paceEl.textContent = `${m}:${s.toString().padStart(2, '00')}`;
        } else {
            paceEl.textContent = '--:--';
        }

        // Show session-relative distance and time when available, else raw
        const displayDist = sd ? sd.distance : data.distance;
        const displayTime = sd ? sd.time     : data.time;

        distanceEl.textContent = displayDist.toFixed(2);

        if (displayTime > 0) {
            const m = Math.floor(displayTime / 60);
            const s = displayTime % 60;
            timeEl.textContent = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        }


        const displayCal = sd ? sd.calories : data.calories;
        inclineEl.textContent  = data.incline.toFixed(1);
        caloriesEl.textContent = displayCal;

        if (hrBpm === 0 && data.heartRate > 0) {
            updateHRDisplay(data.heartRate);
        }
    }

    // ── Coaching ───────────────────────────────────────────────────────────────
    function startCoachingTimer() {
        stopCoachingTimer();
        nextCoachCountdown = COACHING_INTERVAL / 1000;
        const sd = getSessionData(lastData);
        provideCoaching(sd || lastData);
        lastCoachingTime = Date.now();

        coachingIntervalId = setInterval(() => {
            nextCoachCountdown--;
            if (nextCoachCountdown <= 0) {
                const sd = getSessionData(lastData);
                provideCoaching(sd || lastData);
                lastCoachingTime = Date.now();
                nextCoachCountdown = COACHING_INTERVAL / 1000;
            } else {
                coachTimerEl.textContent = `Next update in ${nextCoachCountdown}s`;
            }
        }, 1000);
    }

    function stopCoachingTimer() {
        if (coachingIntervalId) {
            clearInterval(coachingIntervalId);
            coachingIntervalId = null;
        }
        coachTimerEl.textContent = '';
    }

    function provideCoaching(data) {
        const { emoji, message } = buildCoachMessage(data);
        setCoachingMessage(`${emoji} Coach Says:`, message);
        coachTimerEl.textContent = `Next update in ${COACHING_INTERVAL / 1000}s`;
        nextCoachCountdown = COACHING_INTERVAL / 1000;
    }

    // ── Pace analysis helpers ──────────────────────────────────────────────────
    function formatPace(minPerKm) {
        if (!isFinite(minPerKm) || minPerKm <= 0) return '--:--';
        const m = Math.floor(minPerKm);
        const s = Math.round((minPerKm - m) * 60);
        return `${m}:${s.toString().padStart(2, '0')}/km`;
    }

    function analyzePace(data) {
        if (!goalDistance || !goalTime) return null;
        const elapsedMin    = data.time / 60;
        const remainingDist = goalDistance - data.distance;
        const remainingMin  = goalTime - elapsedMin;
        if (remainingDist <= 0 || remainingMin <= 0) return null;
        const requiredSpeedKmh  = (remainingDist / remainingMin) * 60;
        const requiredPaceMin   = 60 / requiredSpeedKmh;
        const speedGap          = requiredSpeedKmh - data.speed;
        const projectedTotalMin = data.speed > 0
            ? elapsedMin + (remainingDist / data.speed) * 60
            : null;
        return { requiredSpeedKmh, requiredPaceMin, speedGap, projectedTotalMin };
    }

    /**
     * Builds a coaching message from session-relative data (or raw data before
     * session start is captured). All distance/time references here are
     * session-relative so goals compare against the current session only.
     */
    function buildCoachMessage(data) {
        const elapsedMin = data.time / 60;
        let emoji = '🎯';
        let lines = [];

        if (goalDistance && goalTime) {
            const distPct   = Math.min(100, (data.distance / goalDistance) * 100);
            const timePct   = Math.min(100, (elapsedMin / goalTime) * 100);
            const remaining = goalDistance - data.distance;
            const timeLeft  = goalTime - elapsedMin;
            const pace      = analyzePace(data);

            if (distPct >= 100 && timePct >= 100) {
                emoji = '🏆';
                lines.push(`Amazing — you've nailed it! ${goalDistance} km in ${goalTime} min. Absolute champion.`);
            } else if (distPct >= 100) {
                emoji = '🏅';
                lines.push(`Distance goal smashed! ${goalDistance} km done. Keep the legs moving — ${Math.max(0, timeLeft).toFixed(1)} min still on the clock.`);
            } else if (timePct >= 100) {
                emoji = '⏱️';
                lines.push(`Time's up! You covered ${data.distance.toFixed(2)} km — ${remaining > 0 ? remaining.toFixed(2) + ' km short of your goal.' : 'goal complete!'}`);
            } else if (pace) {
                const reqSpd     = pace.requiredSpeedKmh;
                const reqPaceStr = formatPace(pace.requiredPaceMin);

                if (data.speed === 0) {
                    emoji = data.time < 15 ? '🚀' : '⏸️';
                    lines.push(`Need ${reqSpd.toFixed(1)} km/h (${reqPaceStr}) to hit ${goalDistance} km in ${goalTime} min. Get moving!`);
                } else if (pace.speedGap > 2.5) {
                    emoji = '⚠️';
                    const overBy = pace.projectedTotalMin
                        ? ` At this pace you'll finish in ~${pace.projectedTotalMin.toFixed(0)} min — ${(pace.projectedTotalMin - goalTime).toFixed(0)} min over target.`
                        : '';
                    lines.push(`Pace alert! You need ${reqSpd.toFixed(1)} km/h (${reqPaceStr}) but you're only doing ${data.speed.toFixed(1)} km/h.${overBy} Lift the pace by ${pace.speedGap.toFixed(1)} km/h now to stay on course.`);
                } else if (pace.speedGap > 0.5) {
                    emoji = '📈';
                    lines.push(`Behind target pace — push to ${reqSpd.toFixed(1)} km/h (${reqPaceStr}). You're at ${data.speed.toFixed(1)} km/h, ${pace.speedGap.toFixed(1)} km/h short. ${remaining.toFixed(2)} km left.`);
                } else if (pace.speedGap < -0.5) {
                    emoji = distPct > 75 ? '💥' : distPct > 50 ? '💪' : '🚀';
                    const progressMsg = distPct > 75 ? 'Home stretch!'
                                      : distPct > 50 ? 'Over halfway!'
                                      : 'Great start!';
                    lines.push(`${progressMsg} You're ${(-pace.speedGap).toFixed(1)} km/h ahead of target pace — excellent! ${goalDistance} km in ${goalTime} min is comfortably within reach.`);
                } else {
                    emoji = distPct > 75 ? '💥' : distPct > 50 ? '💪' : distPct > 25 ? '🏃' : '✅';
                    const progressMsg = distPct > 75 ? `Final stretch — ${remaining.toFixed(2)} km to go!`
                                      : distPct > 50 ? `Over halfway! ${remaining.toFixed(2)} km left.`
                                      : distPct > 25 ? `Good progress — ${data.distance.toFixed(2)} km done.`
                                      : `Great start!`;
                    lines.push(`${progressMsg} Right on target pace — ${data.speed.toFixed(1)} km/h (need ${reqSpd.toFixed(1)} km/h). Keep it up!`);
                }
            }

        } else if (goalDistance) {
            const remaining = goalDistance - data.distance;
            const distPct   = Math.min(100, (data.distance / goalDistance) * 100);
            if (distPct >= 100) {
                emoji = '🏆'; lines.push(`Goal reached! ${goalDistance} km complete — outstanding effort!`);
            } else if (distPct > 75) {
                emoji = '💥'; lines.push(`Almost there! Only ${remaining.toFixed(2)} km left of your ${goalDistance} km goal. Dig in!`);
            } else if (distPct > 50) {
                emoji = '💪'; lines.push(`Past halfway! ${data.distance.toFixed(2)} / ${goalDistance} km done. Keep the same effort.`);
            } else {
                emoji = '🚀'; lines.push(`${goalDistance} km is the target. You're ${data.distance.toFixed(2)} km in — stay focused.`);
            }

        } else if (goalTime) {
            const timeLeft = goalTime - elapsedMin;
            const timePct  = Math.min(100, (elapsedMin / goalTime) * 100);
            if (timePct >= 100) {
                emoji = '🏆'; lines.push(`${goalTime} minutes done — you absolutely crushed it! Great session.`);
            } else if (timePct > 75) {
                emoji = '💥'; lines.push(`Last ${timeLeft.toFixed(1)} minutes — this is where champions are made. Push!`);
            } else if (timePct > 50) {
                emoji = '💪'; lines.push(`${elapsedMin.toFixed(1)} min in, ${timeLeft.toFixed(1)} to go. Over halfway — keep rolling.`);
            } else {
                emoji = '🚀'; lines.push(`${goalTime} min session underway. ${timeLeft.toFixed(1)} min remaining — pace yourself.`);
            }

        } else {
            if (data.speed === 0) {
                emoji = '⏸️';
                lines.push("Ready when you are. Set a goal above or jump on and start running!");
            } else if (data.speed < 5) {
                emoji = '🚶';
                lines.push(`Nice warm-up at ${data.speed.toFixed(1)} km/h. Loosen up those legs.`);
            } else if (data.speed < 8) {
                emoji = '🏃';
                lines.push(`Solid easy pace at ${data.speed.toFixed(1)} km/h. Building your aerobic base.`);
            } else if (data.speed < 11) {
                emoji = '💪';
                lines.push(`Great tempo at ${data.speed.toFixed(1)} km/h! Keep that breathing steady.`);
            } else {
                emoji = '🔥';
                lines.push(`Speed work at ${data.speed.toFixed(1)} km/h — stay tall, drive the arms.`);
            }
        }

        const displayHR = hrBpm > 0 ? hrBpm : (data.heartRate || 0);
        if (displayHR > 0) {
            if      (displayHR < 120) lines.push(`HR ${displayHR} bpm — very easy, plenty left in the tank.`);
            else if (displayHR < 140) lines.push(`HR ${displayHR} bpm — aerobic zone. Sustainable effort.`);
            else if (displayHR < 160) lines.push(`HR ${displayHR} bpm — tempo zone. Strong work.`);
            else if (displayHR < 175) lines.push(`HR ${displayHR} bpm — threshold zone. Tough, hold on!`);
            else                      lines.push(`HR ${displayHR} bpm — near max! Ease off if you need to.`);
        }

        if (data.incline >= 3) {
            lines.push(`${data.incline.toFixed(1)}% incline — serious hill work. Glutes on fire!`);
        } else if (data.incline >= 1) {
            lines.push(`${data.incline.toFixed(1)}% incline — simulating real-road effort.`);
        }

        if (data.distance >= 1 && data.distance % 1 < 0.05) {
            lines.push(`${Math.round(data.distance)} km — every kilometre counts!`);
        }

        return { emoji, message: lines.join(' ') };
    }

    // ── Workout persistence ────────────────────────────────────────────────────
    /**
     * Builds the full workout record from session-relative data.
     * Used by both the Stop modal save path and autoSaveOnDisconnect().
     * @param {object} sd    session-relative data
     * @param {object} [opts] { finalDistanceKm? } — user-corrected distance
     */
    function buildWorkoutRecord(sd, opts) {
        opts = opts || {};
        const rawDistanceKm = sd.distance;
        const finalDistanceKm = (Number.isFinite(opts.finalDistanceKm) && opts.finalDistanceKm >= 0)
            ? opts.finalDistanceKm
            : rawDistanceKm;
        // Distance used for all downstream metrics is the final (possibly corrected) value.
        const distanceKm = finalDistanceKm;

        // Overall pace: Strava-style "min/km" from total distance + total time.
        const avgPaceMinPerKm = distanceKm > 0
            ? (durationSec / 60) / distanceKm
            : null;

        // Enrich interpolated whole-km crossings into per-1km segment splits.
        // splits[] holds cumulative crossing times at each whole-km boundary.
        const crossings = (splits || [])
            .slice()
            .sort((a, b) => a.km - b.km);

        let prevCrossTimeSec = 0;
        let best1kPaceMinPerKm = null;
        const kmSplits = [];

        for (const c of crossings) {
            const km = c.km;
            const crossTimeSec = c.time;
            const segmentTimeSec = crossTimeSec - prevCrossTimeSec;

            // Guard against any weird non-monotonic readings.
            if (!(segmentTimeSec > 0) || !(km > 0)) {
                prevCrossTimeSec = crossTimeSec;
                continue;
            }

            const splitPaceMinPerKm = segmentTimeSec / 60; // 1 km segment
            best1kPaceMinPerKm = best1kPaceMinPerKm === null
                ? splitPaceMinPerKm
                : Math.min(best1kPaceMinPerKm, splitPaceMinPerKm);

            kmSplits.push({
                km,
                time: crossTimeSec,              // cumulative time at this km (s)
                segmentTimeSec,                // time to run the 1km segment (s)
                splitPaceMinPerKm              // 1km pace (min/km)
            });

            prevCrossTimeSec = crossTimeSec;
        }

        const avgSpeed = sessionSpeedCount > 0
            ? parseFloat((sessionSpeedSum / sessionSpeedCount).toFixed(2))
            : parseFloat(sd.speed.toFixed(2));

        const supportMode = getSupportMode();
        const capabilitySnapshot = {
            hasControl: !!controlPointCharacteristic,
            hasExtHR:   !!(hrDevice && hrDevice.gatt && hrDevice.gatt.connected),
            hasFtmsHR:  !!(lastData && lastData.heartRate > 0)
        };

        // Block summary: snapshot of the workout blueprint + current progress index.
        // Emitted only when a structured workout was active.
        const blockSummary = activeWorkout
            ? activeWorkout.blocks.map((b, i) => ({
                idx: i,
                kind: b.kind,
                label: b.label,
                durationSec: b.durationSec,
                targetSpeedMin: b.targetSpeedMin || null,
                targetSpeedMax: b.targetSpeedMax || null,
                completed: workoutCompleted || (i < workoutBlockIdx)
              }))
            : null;

        return {
            date:         new Date().toISOString(),
            duration:     sd.time,
            // `distance` is the saved/final value (possibly user-corrected).
            distance:     parseFloat(distanceKm.toFixed(3)),
            rawDistanceKm:   parseFloat(rawDistanceKm.toFixed(3)),
            finalDistanceKm: parseFloat(distanceKm.toFixed(3)),
            calories:     sd.calories,
            avgSpeed:     avgSpeed,
            avgPaceMinPerKm: avgPaceMinPerKm,
            best1kPaceMinPerKm,
            maxSpeed:     parseFloat(sessionMaxSpeed.toFixed(2)),
            incline:      parseFloat(sd.incline.toFixed(1)),
            goalDistance: goalDistance,
            goalTime:     goalTime,
            goalAchieved: checkGoalAchieved({ distance: distanceKm, time: sd.time }),
            sessionMode:     sessionMode,
            supportMode:     supportMode,
            coachingMode:    coachingMode,
            workoutPresetId: activeWorkout ? activeWorkout.id : null,
            workoutName:     activeWorkout ? activeWorkout.name : null,
            capabilitySummary: capabilitySnapshot,
            blockSummary: blockSummary,
            speedSamples: speedSamples.slice(),
            splits:       kmSplits
        };
    }

    async function persistWorkoutToFirestore(workout) {
        if (!authEnabled || !authUser || !firebaseDb || !workout) return;

        const uid = authUser.uid;
        const safeDatePart = String(workout.date || '').replace(/[^0-9a-zA-Z]/g, '');
        const runId = `run_${safeDatePart}_${Math.random().toString(16).slice(2)}`;

        // Save the full workout record (including splits + derived metrics).
        await firebaseDb
            .collection('users').doc(uid)
            .collection('runs').doc(runId)
            .set({ ...workout, runId }, { merge: false });

        log(`Run synced to cloud: ${runId}`);
    }

    function persistWorkout(workout) {
        const history = getHistory();
        history.unshift(workout);
        if (history.length > HISTORY_MAX) history.length = HISTORY_MAX;
        localStorage.setItem(getRunHistoryCacheKey(), JSON.stringify(history));

        // Update personal bests (1–10km) whenever we successfully save a run.
        if (isUserSignedIn()) updatePersonalBestsFromWorkout(workout);

        // Also persist the run to Firestore for per-user history.
        // Fire-and-forget: persistence failures shouldn't block local saving.
        if (authEnabled && authUser && firebaseDb) {
            persistWorkoutToFirestore(workout).catch(e => log(`Run save failed: ${e.message}`));
        }

        log(`Workout saved: ${workout.distance.toFixed(2)} km, ${formatDuration(workout.duration)}`);
    }

    /**
     * Auto-save path: called on Disconnect button or max-reconnect failure.
     * Uses session-relative data, same full format as modal save.
     */
    function autoSaveOnDisconnect() {
        const sd = getSessionData(lastData);
        if (!sd || sd.distance < 0.05 || sd.time < 30) {
            log('Nothing to auto-save (session too short)');
            return;
        }
        const workout = buildWorkoutRecord(sd);
        persistWorkout(workout);
        historyFab.classList.remove('hidden');
        log(`Auto-saved on disconnect: ${sd.distance.toFixed(2)} km, ${formatDuration(sd.time)}`);
    }

    function checkGoalAchieved(sd) {
        if (!goalDistance && !goalTime) return null;
        const distOk = !goalDistance || sd.distance >= goalDistance * 0.95;
        const timeOk = !goalTime     || (sd.time / 60) >= goalTime * 0.95;
        return distOk && timeOk ? 'achieved' : 'partial';
    }

    function getHistory() {
        try { return JSON.parse(localStorage.getItem(getRunHistoryCacheKey()) || '[]'); }
        catch { return []; }
    }

    function getRunHistoryCacheKey() {
        return (authEnabled && authUser) ? `runHistory:${authUser.uid}` : 'runHistory:guest';
    }

    // ── Personal bests (1–10 km) ──────────────────────────────────────────
    /**
     * localStorage format (temporary, pre-OAuth):
     * {
     *   "1":  { bestTimeSec: number, bestAvgPaceMinPerKm: number, best1kPaceMinPerKm: number },
     *   ...
     *   "10": { ... }
     * }
     */
    function getPersonalBests() {
        try { return JSON.parse(localStorage.getItem(getPersonalBestsCacheKey()) || '{}'); }
        catch { return {}; }
    }

    function getPersonalBestsCacheKey() {
        return (authEnabled && authUser) ? `personalBests:${authUser.uid}` : 'personalBests:guest';
    }

    function renderPersonalBestsUI(personalBests) {
        const pb = personalBests || {};
        let hasAny = false;
        personalBestsTable.replaceChildren();

        const headRow = document.createElement('div');
        headRow.className = 'pb-row pb-head';
        ['KM', 'BEST TIME', 'AVG PACE', 'BEST 1K'].forEach(label => {
            const cell = document.createElement('div');
            cell.textContent = label;
            headRow.appendChild(cell);
        });
        personalBestsTable.appendChild(headRow);

        for (let d = 1; d <= 10; d++) {
            const row = pb[d] || pb[String(d)];
            const timeSec = row && row.bestTimeSec;
            const avgPace  = row && row.bestAvgPaceMinPerKm;
            const best1k   = row && row.best1kPaceMinPerKm;

            const timeStr = (typeof timeSec === 'number' && isFinite(timeSec))
                ? formatDuration(Math.round(timeSec))
                : '--:--';
            const avgPaceStr = (typeof avgPace === 'number' && isFinite(avgPace))
                ? formatPace(avgPace)
                : '--:--/km';
            const best1kStr = (typeof best1k === 'number' && isFinite(best1k))
                ? formatPace(best1k)
                : '--:--/km';

            if (timeSec || avgPace || best1k) hasAny = true;

            const rowEl = document.createElement('div');
            rowEl.className = 'pb-row';

            const distEl = document.createElement('div');
            distEl.className = 'pb-dist';
            distEl.textContent = `${d}km`;

            const timeEl = document.createElement('div');
            timeEl.className = `pb-val ${timeSec ? '' : 'missing'}`.trim();
            timeEl.textContent = timeStr;

            const avgEl = document.createElement('div');
            avgEl.className = `pb-val ${avgPace ? '' : 'missing'}`.trim();
            avgEl.textContent = avgPaceStr;

            const bestEl = document.createElement('div');
            bestEl.className = `pb-val ${best1k ? '' : 'missing'}`.trim();
            bestEl.textContent = best1kStr;

            rowEl.append(distEl, timeEl, avgEl, bestEl);
            personalBestsTable.appendChild(rowEl);
        }

        personalBestsEmpty.classList.toggle('hidden', hasAny);
        personalBestsTable.classList.toggle('hidden', !hasAny);
        if (!hasAny) personalBestsTable.replaceChildren();
    }

    function updatePersonalBestsFromWorkout(workout) {
        if (!workout || !Array.isArray(workout.splits) || workout.splits.length === 0) return;

        // Bucket rule: floor distance to the nearest whole km, clamped to [1..10].
        const lastSplit = workout.splits[workout.splits.length - 1];
        const lastCrossKm = (lastSplit && isFinite(lastSplit.km)) ? Math.floor(lastSplit.km) : 0;

        let bucketKm = Math.min(10, lastCrossKm);
        if (bucketKm < 1) return;

        const splitAtBucket = workout.splits.find(s => s.km === bucketKm);
        if (!splitAtBucket || !isFinite(splitAtBucket.time)) return;

        const timeAtBucketSec = splitAtBucket.time;
        const avgPaceMinPerKm  = (timeAtBucketSec / 60) / bucketKm;

        // "Highest 1km pace" interpreted as fastest 1km segment => smallest min/km.
        let best1kPaceMinPerKm = null;
        for (const s of workout.splits) {
            if (!s || !isFinite(s.km) || s.km > bucketKm) break;
            if (!isFinite(s.splitPaceMinPerKm)) continue;
            best1kPaceMinPerKm = best1kPaceMinPerKm === null
                ? s.splitPaceMinPerKm
                : Math.min(best1kPaceMinPerKm, s.splitPaceMinPerKm);
        }

        const pb = getPersonalBests();
        const key = String(bucketKm);
        const existing = pb[key] || {};

        const next = { ...existing };
        if (!isFinite(existing.bestTimeSec) || timeAtBucketSec < existing.bestTimeSec) {
            next.bestTimeSec = timeAtBucketSec;
        }
        if (!isFinite(existing.bestAvgPaceMinPerKm) || avgPaceMinPerKm < existing.bestAvgPaceMinPerKm) {
            next.bestAvgPaceMinPerKm = avgPaceMinPerKm;
        }
        if (best1kPaceMinPerKm !== null &&
            (!isFinite(existing.best1kPaceMinPerKm) || best1kPaceMinPerKm < existing.best1kPaceMinPerKm)) {
            next.best1kPaceMinPerKm = best1kPaceMinPerKm;
        }

        pb[key] = next;
        localStorage.setItem(getPersonalBestsCacheKey(), JSON.stringify(pb));

        // Persist PR improvements to Firestore (per-user).
        if (authEnabled && authUser && firebaseDb) {
            const prPayload = JSON.parse(JSON.stringify(next)); // drops undefined keys
            firebaseDb
                .collection('users').doc(authUser.uid)
                .collection('pr').doc(key)
                .set(prPayload, { merge: true })
                .catch(e => log(`PR save failed: ${e.message}`));
        }

        renderPersonalBestsUI(pb);
    }

    // ── History overlay ────────────────────────────────────────────────────────
    function renderHistoryOverlay() {
        const history = getHistory();

        if (history.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'history-empty';
            empty.textContent = 'No runs saved yet — complete a session to see your history.';
            historyList.replaceChildren(empty);
            return;
        }

        historyList.replaceChildren();
        history.forEach((w, idx) => {
            // Collision-proof gradient ID using sanitised ISO date string
            const safeDateForId = String(w.date || '').replace(/[^a-zA-Z0-9]/g, '');
            const gradId = `spk-${safeDateForId || `run${idx}`}`;

            const sparklineHtml = renderSparkline(w.speedSamples || [], gradId);

            // Session-mode badge (legacy rows without sessionMode fall back to Free Run).
            const mode = (w.sessionMode === 'goal' || w.sessionMode === 'workout') ? w.sessionMode : 'free';
            let modeLabel = 'Free Run';
            if (mode === 'goal') modeLabel = 'Goal Run';
            else if (mode === 'workout') modeLabel = w.workoutName || 'Workout';

            // Raw-vs-final distance hint (only when user corrected the value).
            const itemEl = document.createElement('div');
            itemEl.className = 'history-item';

            const headerEl = document.createElement('div');
            headerEl.className = 'history-item-header';

            const dateEl = document.createElement('span');
            dateEl.className = 'history-date';
            dateEl.textContent = formatDate(w.date);

            const modeBadgeEl = document.createElement('span');
            modeBadgeEl.className = 'history-mode-badge';
            modeBadgeEl.dataset.mode = mode;
            modeBadgeEl.textContent = modeLabel;

            headerEl.append(dateEl, modeBadgeEl);

            if (w.goalAchieved) {
                const goalBadgeEl = document.createElement('span');
                const goalState = (w.goalAchieved === 'achieved' || w.goalAchieved === 'partial') ? w.goalAchieved : 'partial';
                goalBadgeEl.className = `history-goal-badge ${goalState}`;
                goalBadgeEl.textContent = goalState === 'achieved' ? '✓ Goal achieved' : '~ Partial goal';
                headerEl.appendChild(goalBadgeEl);
            }

            const metricsEl = document.createElement('div');
            metricsEl.className = 'history-metrics';
            const stats = [
                { value: Number(w.distance).toFixed(2), label: 'km' },
                { value: formatDuration(Number(w.duration) || 0), label: 'time' },
                { value: String(w.calories ?? 0), label: 'kcal' },
                { value: Number(w.avgSpeed).toFixed(1), label: 'avg km/h' },
                { value: Number(w.maxSpeed).toFixed(1), label: 'max km/h' },
                { value: `${Number(w.incline).toFixed(1)}%`, label: 'incline' },
                { value: Number.isFinite(w.avgPaceMinPerKm) ? formatPace(w.avgPaceMinPerKm) : '--:--/km', label: 'avg pace' },
                { value: Number.isFinite(w.best1kPaceMinPerKm) ? formatPace(w.best1kPaceMinPerKm) : '--:--/km', label: 'best 1km' }
            ];
            stats.forEach(s => {
                const statEl = document.createElement('div');
                statEl.className = 'history-stat';
                const valEl = document.createElement('div');
                valEl.className = 'history-stat-val';
                valEl.textContent = s.value;
                const lblEl = document.createElement('div');
                lblEl.className = 'history-stat-lbl';
                lblEl.textContent = s.label;
                statEl.append(valEl, lblEl);
                metricsEl.appendChild(statEl);
            });

            itemEl.append(headerEl, metricsEl);

            if (sparklineHtml) {
                const sparklineEl = document.createElement('div');
                sparklineEl.className = 'history-sparkline';
                sparklineEl.innerHTML = sparklineHtml;
                itemEl.appendChild(sparklineEl);
            }

            if (w.goalDistance || w.goalTime) {
                const goalLineEl = document.createElement('div');
                goalLineEl.className = 'history-goal-line';
                const goalParts = [
                    w.goalDistance ? `${w.goalDistance} km` : '',
                    w.goalTime ? `${w.goalTime} min` : ''
                ].filter(Boolean);
                goalLineEl.textContent = `Goal: ${goalParts.join(' · ')}`;
                itemEl.appendChild(goalLineEl);
            }

            if (Number.isFinite(w.rawDistanceKm) && Math.abs(w.rawDistanceKm - w.distance) > 0.005) {
                const rawHintEl = document.createElement('div');
                rawHintEl.className = 'history-raw-hint';
                rawHintEl.textContent = `Machine reported ${Number(w.rawDistanceKm).toFixed(2)} km · saved ${Number(w.distance).toFixed(2)} km`;
                itemEl.appendChild(rawHintEl);
            }
            historyList.appendChild(itemEl);
        });
    }

    /**
     * Renders a polyline sparkline SVG for speed samples.
     * @param {Array} samples - [[timeSec, speedKmh], ...]
     * @param {string} gradId - unique gradient element ID
     */
    function renderSparkline(samples, gradId) {
        if (!samples || samples.length < 2) return '';

        const speeds = samples.map(s => s[1]);
        const minS   = Math.min(...speeds);
        const maxS   = Math.max(...speeds);
        const range  = maxS - minS || 1;
        const W = 280, H = 32, pad = 2;

        const pts = samples.map((s, i) => {
            const x = pad + (i / (samples.length - 1)) * (W - pad * 2);
            const y = H - pad - ((s[1] - minS) / range) * (H - pad * 2);
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        }).join(' ');

        // Area fill path: down to bottom-right, across to bottom-left, close
        const firstX = pad.toFixed(1);
        const lastX  = (W - pad).toFixed(1);
        const bottom = (H - pad).toFixed(1);
        const areaPts = `${pts} ${lastX},${bottom} ${firstX},${bottom}`;

        const safeGradId = escapeHtml(gradId);
        return `<svg width="100%" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
            <defs>
                <linearGradient id="${safeGradId}" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#00B87A" stop-opacity="0.25"/>
                    <stop offset="100%" stop-color="#00B87A" stop-opacity="0"/>
                </linearGradient>
            </defs>
            <polygon points="${areaPts}" fill="url(#${safeGradId})"/>
            <polyline points="${pts}" fill="none" stroke="#00B87A" stroke-width="1.5"
                      stroke-linejoin="round" stroke-linecap="round"/>
        </svg>`;
    }

    // ── Utilities ──────────────────────────────────────────────────────────────
    function escapeHtml(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function setCoachingMessage(title, message) {
        const strongEl = document.createElement('strong');
        strongEl.textContent = title;
        const textNode = document.createTextNode(message || '');
        coachingMessageEl.replaceChildren(strongEl, textNode);
    }

    function formatDuration(seconds) {
        const rounded = Math.max(0, Math.round(seconds));
        const m = Math.floor(rounded / 60);
        const s = rounded % 60;
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    function formatDate(iso) {
        try {
            const d = new Date(iso);
            return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
                 + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        } catch { return iso; }
    }

    function updateStatus(state, message) {
        statusDiv.className = `status ${state}`;
        statusDiv.textContent = message;
        renderStatusChips();
        updatePrimaryCTA();
    }

    // ── Section 1: app state, session mode, chips, capability, CTA ────────────
    function setAppState(next) {
        appState = next;
        document.body.setAttribute('data-state', next);
    }

    function setSessionMode(mode) {
        if (!['free','goal','workout'].includes(mode)) return;
        sessionMode = mode;
        [modeFreeBtn, modeGoalBtn, modeWorkoutBtn].forEach(btn => {
            if (!btn) return;
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });
        // Show/hide goal inputs + workout picker based on mode.
        if (goalInputsWrap)  goalInputsWrap.hidden  = (mode !== 'goal');
        if (workoutPickerEl) workoutPickerEl.hidden = (mode !== 'workout');

        if (modeHeader && modeSubtext) {
            if (mode === 'free') {
                modeHeader.textContent  = 'Set out and run at your own pace.';
                modeSubtext.textContent = 'No target, no pressure — coach reacts to your effort.';
            } else if (mode === 'goal') {
                modeHeader.textContent  = 'Pick a distance or time target.';
                modeSubtext.textContent = 'Coach will push/pull you to hit it. Leave one blank for a simpler goal.';
            } else {
                modeHeader.textContent  = 'Pick a structured workout.';
                modeSubtext.textContent = 'Treadmill-first sessions with automatic block progression.';
            }
        }
        updatePrimaryCTA();
    }

    function renderWorkoutPicker() {
        if (!workoutPickerEl) return;
        workoutPickerEl.replaceChildren();
        Object.values(WORKOUT_PRESETS).forEach(p => {
            const totalMin = Math.round(p.blocks.reduce((s,b) => s + b.durationSec, 0) / 60);
            const btn = document.createElement('button');
            btn.className = `btn-preset-workout${selectedWorkoutId === p.id ? ' active' : ''}`;
            btn.dataset.wid = p.id;

            const nameWrap = document.createElement('span');
            nameWrap.className = 'wpick-name';
            nameWrap.textContent = `${p.name} `;

            const durationEl = document.createElement('span');
            durationEl.style.opacity = '0.55';
            durationEl.style.fontWeight = '600';
            durationEl.textContent = `· ${totalMin} min`;
            nameWrap.appendChild(durationEl);

            const descEl = document.createElement('span');
            descEl.className = 'wpick-desc';
            descEl.textContent = p.desc;

            btn.append(nameWrap, descEl);
            workoutPickerEl.appendChild(btn);
        });
    }

    function setCoachingMode(mode) {
        if (!['quiet','spoken','haptic'].includes(mode)) mode = 'spoken';
        coachingMode = mode;
        localStorage.setItem('coachingMode', mode);
        if (coachingModeSel) {
            coachingModeSel.querySelectorAll('.btn-cmode').forEach(b => {
                b.classList.toggle('active', b.dataset.cmode === mode);
            });
        }
    }

    // Speak / haptic wrappers. Graceful no-op when unavailable.
    function speak(text) {
        try {
            if (!('speechSynthesis' in window)) return;
            const u = new SpeechSynthesisUtterance(text);
            u.rate = 1.0; u.pitch = 1.0; u.volume = 1.0;
            window.speechSynthesis.cancel(); // interrupt backlog — coach is terse by design
            window.speechSynthesis.speak(u);
        } catch (e) { /* swallow */ }
    }
    function haptic(pattern) {
        try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* swallow */ }
    }
    // Central sparse-coach dispatcher. Respects Quiet / Spoken / Haptic.
    function fireCoachEvent(kind, text, vibratePattern) {
        // On-screen update is already done by the regular coach-loop message;
        // this function just handles speech / haptics for sparse events.
        if (coachingMode === 'quiet') return;
        if (coachingMode === 'spoken') speak(text);
        if (coachingMode === 'haptic') haptic(vibratePattern || 120);
    }

    function getSupportMode() {
        if (!device || !device.gatt || !device.gatt.connected) return 'disconnected';
        return controlPointCharacteristic ? 'controllable' : 'readonly';
    }

    function supportModeLabel(mode) {
        switch (mode) {
            case 'controllable': return 'Controllable FTMS';
            case 'readonly':     return 'Read-only FTMS';
            default:             return 'Disconnected';
        }
    }

    function renderStatusChips() {
        if (!treadmillChip) return;
        const tConnected   = !!(device && device.gatt && device.gatt.connected);
        const tState       = (statusDiv && statusDiv.className.replace('status','').trim()) || (tConnected ? 'connected' : 'disconnected');
        const tName        = (device && device.name) ? device.name : '';
        treadmillChip.className = `chip chip-tappable ${tState}`;
        treadmillChipText.textContent = tConnected
            ? (tName || 'Connected')
            : (tState === 'connecting' || tState === 'reconnecting' ? 'Connecting…' : 'Not connected');

        const hrConnected = !!(hrDevice && hrDevice.gatt && hrDevice.gatt.connected);
        const hrState     = (hrStatusDiv && hrStatusDiv.className.replace('status','').trim()) || (hrConnected ? 'connected' : 'disconnected');
        hrChip.className = `chip chip-tappable ${hrState}`;
        hrChipText.textContent = hrConnected
            ? (hrDevice.name || 'On')
            : (hrState === 'connecting' || hrState === 'reconnecting' ? 'Connecting…' : 'Off');

        const sm = getSupportMode();
        supportModeChip.className = `chip ${sm}`;
        supportModeChipText.textContent = supportModeLabel(sm);
    }

    function renderCapabilitySummary() {
        if (!capabilitySummary || !capListEl) return;
        const connected = !!(device && device.gatt && device.gatt.connected);
        if (!connected) {
            capabilitySummary.classList.add('hidden');
            capListEl.replaceChildren();
            return;
        }
        const hasControl = !!controlPointCharacteristic;
        const hasExtHR   = !!(hrDevice && hrDevice.gatt && hrDevice.gatt.connected);
        const hasFtmsHR  = !hasExtHR && (lastData && lastData.heartRate > 0);

        // Speed/distance/incline/calories/time are standard FTMS treadmill fields.
        // We only flag a capability "on" if we've truly observed or expect it.
        const items = [
            { label: 'Speed',    on: true },
            { label: 'Distance', on: true },
            { label: 'Incline',  on: true },
            { label: 'Calories', on: true },
            { label: hasExtHR ? 'HR (external)' : (hasFtmsHR ? 'HR (treadmill)' : 'HR'),
              on: hasExtHR || hasFtmsHR },
            { label: hasControl ? 'Control enabled' : 'Control unavailable',
              on: hasControl }
        ];

        capListEl.replaceChildren();
        items.forEach(i => {
            const chipEl = document.createElement('span');
            chipEl.className = `cap-item ${i.on ? 'on' : 'off'}`;
            chipEl.textContent = i.label;
            capListEl.appendChild(chipEl);
        });
        capabilitySummary.classList.remove('hidden');
    }

    function updatePrimaryCTA() {
        if (!setGoalBtn) return;
        const connected = !!(device && device.gatt && device.gatt.connected);
        const connecting = statusDiv && /connecting|reconnecting/.test(statusDiv.className);

        if (!connected && !connecting) {
            setGoalBtn.textContent = 'Connect Treadmill';
            setGoalBtn.dataset.action = 'connect';
            setGoalBtn.disabled = false;
            if (ctaHintEl) ctaHintEl.textContent = 'Tap to pair via Bluetooth (Chrome on Android).';
        } else if (connecting) {
            setGoalBtn.textContent = 'Connecting…';
            setGoalBtn.dataset.action = 'connect';
            setGoalBtn.disabled = true;
            if (ctaHintEl) ctaHintEl.textContent = '';
        } else {
            // connected
            if (sessionMode === 'workout') {
                const ok = !!selectedWorkoutId;
                setGoalBtn.textContent = ok ? 'Start Workout' : 'Pick a workout';
                setGoalBtn.dataset.action = 'start';
                setGoalBtn.disabled = !ok;
                if (ctaHintEl) ctaHintEl.textContent = ok
                    ? `${WORKOUT_PRESETS[selectedWorkoutId].name} — blocks advance automatically.`
                    : 'Select one of the presets above to continue.';
            } else {
                setGoalBtn.textContent = sessionMode === 'goal' ? "Let's Go" : 'Start Run';
                setGoalBtn.dataset.action = 'start';
                setGoalBtn.disabled = false;
                if (ctaHintEl) ctaHintEl.textContent = sessionMode === 'goal'
                    ? 'Leave a field blank to run against a simpler target.'
                    : 'Free Run — coach reacts to your effort.';
            }
        }
    }

    function log(message) {
        const ts = new Date().toLocaleTimeString();
        const lineEl = document.createElement('div');
        lineEl.textContent = `[${ts}] ${message}`;
        debugDiv.appendChild(lineEl);
        debugDiv.scrollTop = debugDiv.scrollHeight;
        console.log(message);
    }
