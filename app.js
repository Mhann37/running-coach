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

    // Firebase Auth / Firestore state
    let authUser      = null;
    let authEnabled  = false; // true only when Firebase config is filled
    let firebaseAuth  = null;
    let firebaseDb    = null;

    // TODO: Fill this with your Firebase project's "Web app" config.
    // Keep keys out of git; treat this as a local-only placeholder.
    const FIREBASE_CONFIG = {
        apiKey: "AIzaSyCeTZWPAZ36HRoTFeOIBGwVEJ-fXbEpgQY",
        authDomain: "running-coach-ee164.firebaseapp.com",
        projectId: "running-coach-ee164",
        storageBucket: "running-coach-ee164.firebasestorage.app",
        messagingSenderId: "965560733067",
        appId: "1:965560733067:web:d32cb09a6840188dd8f38e"
    };

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
    const preset12Btn   = document.getElementById('preset12');
    const preset15Btn   = document.getElementById('preset15');

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
    const saveRunBtn      = document.getElementById('saveRunBtn');
    const discardRunBtn   = document.getElementById('discardRunBtn');

    const historyFab      = document.getElementById('historyFab');
    const historyOverlay  = document.getElementById('historyOverlay');
    const closeHistoryBtn = document.getElementById('closeHistoryBtn');
    const historyList     = document.getElementById('historyList');
    const personalBestsCard      = document.getElementById('personalBestsCard');
    const personalBestsEmpty     = document.getElementById('personalBestsEmpty');
    const personalBestsTable     = document.getElementById('personalBestsTable');

    const authStatusEl          = document.getElementById('authStatus');
    const googleSignInBtn      = document.getElementById('googleSignInBtn');
    const googleSignOutBtn     = document.getElementById('googleSignOutBtn');

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

    // ── Event listeners ────────────────────────────────────────────────────────
    googleSignInBtn.addEventListener('click', async () => {
        if (!authEnabled || !firebaseAuth) return;
        try {
            const provider = new firebase.auth.GoogleAuthProvider();
            await firebaseAuth.signInWithPopup(provider);
        } catch (e) {
            log(`Google sign-in error: ${e.message}`);
        }
    });

    googleSignOutBtn.addEventListener('click', async () => {
        if (!authEnabled || !firebaseAuth) return;
        try {
            await firebaseAuth.signOut();
        } catch (e) {
            log(`Google sign-out error: ${e.message}`);
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

    speedUpBtn.addEventListener('click',    () => adjustSpeed(SPEED_STEP));
    speedDownBtn.addEventListener('click',  () => adjustSpeed(-SPEED_STEP));
    inclineUpBtn.addEventListener('click',  () => adjustIncline(INCLINE_STEP));
    inclineDownBtn.addEventListener('click',() => adjustIncline(-INCLINE_STEP));
    preset7Btn.addEventListener('click',    () => setTargetSpeed(7));
    preset12Btn.addEventListener('click',   () => setTargetSpeed(12.5));
    preset15Btn.addEventListener('click',   () => setTargetSpeed(15));

    setGoalBtn.addEventListener('click', confirmGoal);
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
            coachingMessageEl.innerHTML = '<strong>⏸️ Paused</strong>Tap Resume when ready.';
            coachTimerEl.textContent = '';
            log('Session paused');
        } else {
            pauseBtn.textContent = 'Pause';
            pauseBtn.classList.remove('paused');
            startCoachingTimer();
            log('Session resumed');
        }
    });

    // Stop Run
    stopBtn.addEventListener('click', () => stopSession());

    // Stop modal actions
    saveRunBtn.addEventListener('click', () => {
        if (endRunBusy) return;
        endRunBusy = true;

        const sd = getSessionData(lastData);
        if (sd) {
            const workout = buildWorkoutRecord(sd);
            persistWorkout(workout);
            historyFab.classList.remove('hidden');
        }
        stopModal.classList.remove('active');
        finishSession();
        endRunBusy = false;
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
            personalBestsTable.innerHTML = '';
            return;
        }

        renderPersonalBestsUI(getPersonalBests());
    }

    function updateAuthUI() {
        if (!authEnabled) {
            if (authStatusEl) {
                authStatusEl.textContent = 'Firebase not configured';
                authStatusEl.className = 'status disconnected';
            }
            if (googleSignInBtn) {
                googleSignInBtn.disabled = true;
                googleSignInBtn.style.opacity = 0.55;
            }
            if (googleSignOutBtn) googleSignOutBtn.style.display = 'none';
            return;
        }

        const signedIn = !!authUser;
        if (authStatusEl) {
            if (signedIn) {
                authStatusEl.textContent = `Signed in: ${authUser.displayName || authUser.email || 'Google'}`;
                authStatusEl.className = 'status connected';
            } else {
                authStatusEl.textContent = 'Signed out';
                authStatusEl.className = 'status disconnected';
            }
        }

        if (googleSignInBtn) {
            googleSignInBtn.disabled = signedIn;
            googleSignInBtn.style.opacity = signedIn ? 0.6 : 1;
        }
        if (googleSignOutBtn) googleSignOutBtn.style.display = signedIn ? '' : 'none';
    }

    function isFirebaseConfigured() {
        return FIREBASE_CONFIG &&
            FIREBASE_CONFIG.apiKey &&
            !String(FIREBASE_CONFIG.apiKey).startsWith('YOUR_');
    }

    async function initFirebaseAuth() {
        try {
            if (typeof firebase === 'undefined') {
                authEnabled = false;
                updateAuthUI();
                return;
            }

            if (!isFirebaseConfigured()) {
                authEnabled = false;
                updateAuthUI();
                return;
            }

            if (!firebase.apps || firebase.apps.length === 0) {
                firebase.initializeApp(FIREBASE_CONFIG);
            }

            firebaseAuth = firebase.auth();
            firebaseDb = firebase.firestore();
            authEnabled = true;

            updateAuthUI();

            firebaseAuth.onAuthStateChanged(user => {
                authUser = user || null;
                updateAuthUI();
                if (authUser) {
                    syncUserDataFromFirestore(authUser.uid).catch(e => log(`PR sync error: ${e.message}`));
                }
                refreshPersonalBestsVisibility();
            });
        } catch (e) {
            authEnabled = false;
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
    }

    // ── Goal logic ─────────────────────────────────────────────────────────────
    function confirmGoal() {
        const dVal = parseFloat(goalDistanceInput.value);
        const tVal = parseFloat(goalTimeInput.value);

        goalDistance  = (!isNaN(dVal) && dVal > 0) ? dVal : null;
        goalTime      = (!isNaN(tVal) && tVal > 0) ? tVal : null;
        goalConfirmed = true;

        let parts = [];
        if (goalDistance) parts.push(`${goalDistance} km`);
        if (goalTime)     parts.push(`${goalTime} min`);
        const summaryStr = parts.length
            ? `🎯 Goal: ${parts.join(' · ')}`
            : '🎯 No target set — running freely';

        goalSummaryText.textContent = summaryStr;
        goalSummary.classList.add('active');
        goalInputSection.style.display = 'none';

        distanceProgress.classList.toggle('active', !!goalDistance);
        timeProgress.classList.toggle('active', !!goalTime);

        log(`Goal set — distance: ${goalDistance} km, time: ${goalTime} min`);

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
        // Populate modal
        stopModalDistEl.textContent = sd.distance.toFixed(2);
        stopModalTimeEl.textContent = formatDuration(sd.time);
        stopModalCalEl.textContent  = sd.calories;

        // Derived Strava-like stats for the end-of-run summary.
        const preview = buildWorkoutRecord(sd);
        const avgPaceStr = Number.isFinite(preview.avgPaceMinPerKm)
            ? formatPace(preview.avgPaceMinPerKm).replace('/km', '')
            : '--:--';
        const best1kStr = Number.isFinite(preview.best1kPaceMinPerKm)
            ? formatPace(preview.best1kPaceMinPerKm).replace('/km', '')
            : '--:--';

        stopModalAvgPaceEl.textContent = avgPaceStr;
        stopModalBest1kEl.textContent = best1kStr;

        stopModal.classList.add('active');
        // Stop coaching while modal is open
        stopCoachingTimer();
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

        // Set idle coaching message (no timer restart — waits for next goal confirm)
        coachingMessageEl.innerHTML =
            '<strong>⏸️ Ready when you are</strong>' +
            'Set a new goal above, then tap Let\'s Go! to start your next run.';
        coachTimerEl.textContent = '';

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
        metricsCard.classList.remove('hidden');
        coachingCard.classList.add('active');
        goalCard.classList.add('active');
        sessionControlsEl.classList.add('active');
        connectBtn.textContent = 'Disconnect';
        reconnectAttempts = 0;

        // Session-relative state is NOT initialised here — lazy-init on first packet.
        resetSessionState();
        startCoachingTimer();
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
        // Close stop modal if open (except when we intentionally keep it open).
        if (closeStopModal) stopModal.classList.remove('active');
    }

    function enableControls(on) {
        [speedUpBtn, speedDownBtn, inclineUpBtn, inclineDownBtn,
         preset7Btn, preset12Btn, preset15Btn].forEach(b => b.disabled = !on);
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

        // ── UI updates (use session-relative values for display) ───────────────
        updateMetrics(data, sd);
        updateGoalProgress(sd);
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
        coachingMessageEl.innerHTML = `<strong>${emoji} Coach Says:</strong>${message}`;
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
     */
    function buildWorkoutRecord(sd) {
        const distanceKm = sd.distance;
        const durationSec = sd.time;

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

        return {
            date:         new Date().toISOString(),
            duration:     sd.time,
            distance:     parseFloat(sd.distance.toFixed(3)),
            calories:     sd.calories,
            avgSpeed:     avgSpeed,
            avgPaceMinPerKm: avgPaceMinPerKm,
            best1kPaceMinPerKm,
            maxSpeed:     parseFloat(sessionMaxSpeed.toFixed(2)),
            incline:      parseFloat(sd.incline.toFixed(1)),
            goalDistance: goalDistance,
            goalTime:     goalTime,
            goalAchieved: checkGoalAchieved(sd),
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

        let tableHtml = `
            <div class="pb-row pb-head">
                <div>KM</div>
                <div>BEST TIME</div>
                <div>AVG PACE</div>
                <div>BEST 1K</div>
            </div>
        `;

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

            const missingClass = timeSec ? '' : 'missing';
            tableHtml += `
                <div class="pb-row">
                    <div class="pb-dist">${d}km</div>
                    <div class="pb-val ${missingClass}">${timeStr}</div>
                    <div class="pb-val ${avgPace ? '' : 'missing'}">${avgPaceStr}</div>
                    <div class="pb-val ${best1k ? '' : 'missing'}">${best1kStr}</div>
                </div>
            `;
        }

        personalBestsEmpty.classList.toggle('hidden', hasAny);
        personalBestsTable.classList.toggle('hidden', !hasAny);
        personalBestsTable.innerHTML = hasAny ? tableHtml : '';
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
            historyList.innerHTML = '<div class="history-empty">No runs saved yet — complete a session to see your history.</div>';
            return;
        }

        historyList.innerHTML = history.map(w => {
            // Collision-proof gradient ID using sanitised ISO date string
            const gradId = `spk-${w.date.replace(/[^a-zA-Z0-9]/g, '')}`;

            const sparklineHtml = renderSparkline(w.speedSamples || [], gradId);

            const badgeHtml = w.goalAchieved
                ? `<span class="history-goal-badge ${w.goalAchieved}">${w.goalAchieved === 'achieved' ? '✓ Goal achieved' : '~ Partial goal'}</span>`
                : '';

            const goalLineHtml = (w.goalDistance || w.goalTime)
                ? `<div class="history-goal-line">Goal: ${[w.goalDistance ? w.goalDistance + ' km' : '', w.goalTime ? w.goalTime + ' min' : ''].filter(Boolean).join(' · ')}</div>`
                : '';

            return `
            <div class="history-item">
                <div class="history-item-header">
                    <span class="history-date">${formatDate(w.date)}</span>
                    ${badgeHtml}
                </div>
                <div class="history-metrics">
                    <div class="history-stat">
                        <div class="history-stat-val">${w.distance.toFixed(2)}</div>
                        <div class="history-stat-lbl">km</div>
                    </div>
                    <div class="history-stat">
                        <div class="history-stat-val">${formatDuration(w.duration)}</div>
                        <div class="history-stat-lbl">time</div>
                    </div>
                    <div class="history-stat">
                        <div class="history-stat-val">${w.calories}</div>
                        <div class="history-stat-lbl">kcal</div>
                    </div>
                    <div class="history-stat">
                        <div class="history-stat-val">${w.avgSpeed.toFixed(1)}</div>
                        <div class="history-stat-lbl">avg km/h</div>
                    </div>
                    <div class="history-stat">
                        <div class="history-stat-val">${w.maxSpeed.toFixed(1)}</div>
                        <div class="history-stat-lbl">max km/h</div>
                    </div>
                    <div class="history-stat">
                        <div class="history-stat-val">${w.incline.toFixed(1)}%</div>
                        <div class="history-stat-lbl">incline</div>
                    </div>
                    <div class="history-stat">
                        <div class="history-stat-val">${Number.isFinite(w.avgPaceMinPerKm) ? formatPace(w.avgPaceMinPerKm) : '--:--/km'}</div>
                        <div class="history-stat-lbl">avg pace</div>
                    </div>
                    <div class="history-stat">
                        <div class="history-stat-val">${Number.isFinite(w.best1kPaceMinPerKm) ? formatPace(w.best1kPaceMinPerKm) : '--:--/km'}</div>
                        <div class="history-stat-lbl">best 1km</div>
                    </div>
                </div>
                ${sparklineHtml ? `<div class="history-sparkline">${sparklineHtml}</div>` : ''}
                ${goalLineHtml}
            </div>`;
        }).join('');
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

        return `<svg width="100%" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
            <defs>
                <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#00B87A" stop-opacity="0.25"/>
                    <stop offset="100%" stop-color="#00B87A" stop-opacity="0"/>
                </linearGradient>
            </defs>
            <polygon points="${areaPts}" fill="url(#${gradId})"/>
            <polyline points="${pts}" fill="none" stroke="#00B87A" stroke-width="1.5"
                      stroke-linejoin="round" stroke-linecap="round"/>
        </svg>`;
    }

    // ── Utilities ──────────────────────────────────────────────────────────────
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
    }

    function log(message) {
        const ts = new Date().toLocaleTimeString();
        debugDiv.innerHTML += `[${ts}] ${message}<br>`;
        debugDiv.scrollTop = debugDiv.scrollHeight;
        console.log(message);
    }
