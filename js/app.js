/**
 * js/app.js
 * Application Lifecycle, Tab Router, Timers, Autoregulation UI, Workout Builder, & Event Controller
 */

import {
  openDatabase,
  getLocalDateString,
  getCheckin,
  getAllCheckins,
  upsertCheckin,
  addWorkout,
  getAllWorkouts,
  deleteWorkout,
  addBodyworkLog,
  getLatestBodyworkLog,
  getSetting,
  setSetting,
  getAllSettings,
  exportDatabaseJSON,
  importDatabaseJSON,
  seedSevenDayDemoData
} from './db.js';

import {
  evaluateTrafficLight,
  evaluateBodyworkWindow,
  ANCHOR_STAGES,
  CROSS_GATES_LIBRARY,
  BLACKLIST_MOVEMENTS,
  detectBlacklistedMovement,
  getExerciseById,
  computeHabitStreaks,
  formatDurationCountdown
} from './clinical-engine.js';

import {
  computeWorkoutVolume,
  renderSymptomTrendChart,
  renderVolumeReadinessChart,
  renderAdherenceGrid,
  resizeAnalyticsCharts
} from './charts.js';

import {
  DEFAULT_GEMINI_MODEL,
  buildClinicalSystemPrompt,
  askGeminiConsultant,
  formatTacticalBulletsHTML,
  VoiceDictationController
} from './ai-consultant.js';

import { audioEngine, initOrResumeAudio } from './audio.js';

/* ==========================================================================
   CENTRAL APPLICATION STATE
   ========================================================================== */
const state = {
  activeTab: 'dashboard',
  todayStr: getLocalDateString(),
  todayCheckin: null,
  allCheckins: [],
  allWorkouts: [],
  latestBodywork: null,
  settings: {
    geminiApiKey: '',
    geminiModel: DEFAULT_GEMINI_MODEL,
    baselineSteps: 0,
    baselineJournal: 0,
    baselineAnchor: 0,
    baselineSetDate: null
  },
  streaks: null,

  // Tab 2: Tier 1 Daily Anchor Timer State
  anchor: {
    stageIndex: 0,
    remainingSec: ANCHOR_STAGES[0].durationSeconds,
    isRunning: false,
    endTimestampMs: null,
    intervalId: null,
    soundEnabled: true,
    wakeLock: null,
    breathPhase: 'idle',
    breathTimeouts: []
  },

  // Tab 3: Cross Gates Workout Builder State
  workoutBuilder: {
    selectedCategory: 'prep',
    flaggedBlacklistItem: null,
    draftExercises: []
  },

  // Live 1s Ticker for 48h Bodywork Countdown
  bodyworkTickerId: null,
  deferredInstallPrompt: null,
  voiceController: null
};

const STREAK_RING_CIRCUMFERENCE = 2 * Math.PI * 32; // r=32 -> 201.06
const ANCHOR_RING_CIRCUMFERENCE = 2 * Math.PI * 96; // r=96 -> 603.19

/* ==========================================================================
   BOOTSTRAP & LIFECYCLE INITIALIZATION
   ========================================================================== */
async function initApp() {
  try {
    await openDatabase();
    registerServiceWorker();
    setupInstallPrompt();

    await reloadAllData();
    seedInitialWorkoutDraft();

    bindNavigationEvents();
    bindDashboardEvents();
    bindAnchorTimerEvents();
    bindWorkoutBuilderEvents();
    bindConsultantAndSettingsEvents();

    renderHeaderDate();
    renderAllViews();
    startBodyworkLiveTicker();

    // Respect URL hash shortcut (#dashboard, #anchor, #workout, #analytics, #consultant)
    const initialHash = window.location.hash.replace('#', '').trim();
    const validTabs = ['dashboard', 'anchor', 'workout', 'analytics', 'consultant'];
    if (validTabs.includes(initialHash)) {
      switchTab(initialHash);
    }
  } catch (err) {
    console.error('Initialization error:', err);
    showToast(`Init warning: ${err.message}`);
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    // DOM already parsed (deferred ES module execution)
    initApp();
  }
}

async function reloadAllData() {
  state.todayStr = getLocalDateString();
  const [todayCheckin, allCheckins, allWorkouts, latestBodywork, rawSettings] = await Promise.all([
    getCheckin(state.todayStr),
    getAllCheckins(),
    getAllWorkouts(),
    getLatestBodyworkLog(),
    getAllSettings()
  ]);

  state.todayCheckin = todayCheckin;
  state.allCheckins = allCheckins;
  state.allWorkouts = allWorkouts;
  state.latestBodywork = latestBodywork;

  state.settings = {
    geminiApiKey: rawSettings.geminiApiKey || '',
    geminiModel: rawSettings.geminiModel || DEFAULT_GEMINI_MODEL,
    baselineSteps: Number(rawSettings.baselineSteps) || 0,
    baselineJournal: Number(rawSettings.baselineJournal) || 0,
    baselineAnchor: Number(rawSettings.baselineAnchor) || 0,
    baselineSetDate: rawSettings.baselineSetDate || null
  };

  state.streaks = computeHabitStreaks(
    state.allCheckins,
    {
      steps: state.settings.baselineSteps,
      journal: state.settings.baselineJournal,
      anchor: state.settings.baselineAnchor,
      baselineSetDate: state.settings.baselineSetDate
    },
    state.todayStr
  );
}

function renderAllViews() {
  renderStreakRings();
  renderBodyworkTracker();
  syncCheckinControlsFromState();
  renderLiveTrafficLightEvaluation();
  renderAnchorTimerView();
  renderWorkoutReadinessBanner();
  renderCrossGatesLibrary();
  renderActiveWorkoutDraft();
  renderWorkoutHistory();
  renderAnalyticsTab();
  syncSettingsInputs();
  refreshClinicalPromptPreview();
}

/* ==========================================================================
   TAB ROUTING & TOP HEADER
   ========================================================================== */
function bindNavigationEvents() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetTab = btn.dataset.tab;
      if (targetTab) switchTab(targetTab);
    });
  });

  const headerPill = document.getElementById('headerReadinessPill');
  headerPill?.addEventListener('click', () => {
    switchTab('dashboard');
    document.getElementById('checkinCardShell')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  document.getElementById('openBaselineSettingsBtn')?.addEventListener('click', () => {
    switchTab('consultant');
    setTimeout(() => {
      document.getElementById('baselineSettingsCard')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
  });
}

export function switchTab(tabName) {
  state.activeTab = tabName;

  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === `tab-${tabName}`);
  });

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    const isActive = btn.dataset.tab === tabName;
    btn.classList.toggle('text-emerald-400', isActive);
    btn.classList.toggle('font-bold', isActive);
    btn.classList.toggle('text-slate-400', !isActive);
    btn.classList.toggle('font-semibold', !isActive);
  });

  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (tabName === 'analytics') {
    // Re-render & resize Chart.js canvases once container has non-zero layout dimensions
    requestAnimationFrame(() => {
      renderAnalyticsTab();
      resizeAnalyticsCharts();
    });
  } else if (tabName === 'consultant') {
    refreshClinicalPromptPreview();
  } else if (tabName === 'workout') {
    renderWorkoutReadinessBanner();
  }
}
if (typeof window !== 'undefined') {
  window.switchTab = switchTab;
  window.audioEngine = audioEngine;
  window.initOrResumeAudio = initOrResumeAudio;
}

function renderHeaderDate() {
  const label = document.getElementById('headerDateLabel');
  if (!label) return;
  const formatted = new Date().toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });
  label.textContent = formatted.toUpperCase();
}

function updateHeaderReadinessPill(evalResult) {
  const pill = document.getElementById('headerReadinessPill');
  const dot = document.getElementById('headerReadinessDot');
  const text = document.getElementById('headerReadinessText');
  if (!pill || !dot || !text) return;

  pill.className =
    'px-2.5 py-1.5 rounded-full text-[11px] font-bold tracking-wide border flex items-center gap-1.5 active:scale-95 transition ';

  if (evalResult.status === 'red') {
    pill.className += 'bg-rose-500/15 text-rose-300 border-rose-500/40';
    dot.className = 'w-2 h-2 rounded-full bg-rose-400 animate-pulse';
    text.textContent = 'RED • DECOMPRESS';
  } else if (evalResult.status === 'yellow') {
    pill.className += 'bg-amber-500/15 text-amber-300 border-amber-500/40';
    dot.className = 'w-2 h-2 rounded-full bg-amber-400';
    text.textContent = 'YELLOW • -25%';
  } else {
    pill.className += 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40';
    dot.className = 'w-2 h-2 rounded-full bg-emerald-400';
    text.textContent = 'GREEN • READY';
  }
}

/* ==========================================================================
   TAB 1: DASHBOARD, STREAK RINGS, 48H BODYWORK, & DAILY CHECK-IN
   ========================================================================== */
function bindDashboardEvents() {
  // Habit Ring Toggles
  document.getElementById('toggleStepsBtn')?.addEventListener('click', () =>
    toggleDailyHabit('stepsCompleted', '10,000+ Daily Steps')
  );
  document.getElementById('toggleJournalBtn')?.addEventListener('click', () =>
    toggleDailyHabit('journalCompleted', 'Daily Journaling')
  );
  document.getElementById('toggleAnchorBtn')?.addEventListener('click', () =>
    toggleDailyHabit('anchorCompleted', 'Tier 1 Daily Anchor')
  );

  // Bodywork Drawer Events
  const bodyworkPanel = document.getElementById('bodyworkFormPanel');
  const offsetSelect = document.getElementById('bodyworkOffsetSelect');
  const customWrapper = document.getElementById('bodyworkCustomTimeWrapper');

  document.getElementById('openBodyworkModalBtn')?.addEventListener('click', () => {
    bodyworkPanel?.classList.toggle('hidden');
  });

  document.getElementById('cancelBodyworkBtn')?.addEventListener('click', () => {
    bodyworkPanel?.classList.add('hidden');
  });

  offsetSelect?.addEventListener('change', () => {
    customWrapper?.classList.toggle('hidden', offsetSelect.value !== 'custom');
  });

  document.getElementById('saveBodyworkBtn')?.addEventListener('click', async () => {
    const modality = document.getElementById('bodyworkModalitySelect')?.value;
    const offsetVal = offsetSelect?.value || '0';
    const notes = document.getElementById('bodyworkNotesInput')?.value || '';

    let timestampIso;
    if (offsetVal === 'custom') {
      const customVal = document.getElementById('bodyworkCustomTimeInput')?.value;
      timestampIso = customVal ? new Date(customVal).toISOString() : new Date().toISOString();
    } else {
      const hoursAgo = Number(offsetVal) || 0;
      timestampIso = new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString();
    }

    await addBodyworkLog({ timestamp: timestampIso, modality, notes });
    if (document.getElementById('bodyworkNotesInput')) {
      document.getElementById('bodyworkNotesInput').value = '';
    }
    bodyworkPanel?.classList.add('hidden');

    await reloadAllData();
    renderBodyworkTracker();
    renderWorkoutReadinessBanner();
    refreshClinicalPromptPreview();
    showToast('48-Hour Post-Bodywork Countdown Activated');
  });

  // 3-Zone Segmented Pill & Stepper Buttons: Event Delegation on Card Container
  const checkinCard = document.getElementById('checkinCardShell');
  if (checkinCard) {
    checkinCard.addEventListener('click', (e) => {
      // 1. Tactile Stepper (+ / -)
      const actionBtn = e.target.closest('[data-action]');
      if (actionBtn && checkinCard.contains(actionBtn)) {
        e.preventDefault();
        const metric = actionBtn.dataset.metric || actionBtn.dataset.symptom;
        const action = actionBtn.dataset.action;
        if (metric && (action === 'increment' || action === 'decrement')) {
          const currentVal = Number(symptomValues[metric] ?? 2);
          const delta = action === 'increment' ? 1 : -1;
          setSymptomValue(metric, currentVal + delta, true);
          return;
        }
      }

      // 2. 3-Zone Segmented Pill (Calm / Caution / Flare)
      const zoneBtn = e.target.closest('[data-zone]');
      if (zoneBtn && checkinCard.contains(zoneBtn)) {
        e.preventDefault();
        const metric = zoneBtn.dataset.metric || zoneBtn.dataset.symptom;
        const zone = zoneBtn.dataset.zone;
        if (metric && zone) {
          const targetVal = zone === 'calm' ? 2 : zone === 'caution' ? 5 : 8;
          setSymptomValue(metric, targetVal, true);
          return;
        }
      }
    });
  }

  // Backward compatibility with programmatic range input events (e.g. automated tests)
  document.getElementById('scalpSlider')?.addEventListener('input', (e) => {
    setSymptomValue('scalp', e.target.value, true);
  });
  document.getElementById('interscapSlider')?.addEventListener('input', (e) => {
    const v = Number(e.target.value) || 0;
    setSymptomValue('interscap', v, false);
    setSymptomValue('levator', v, true);
  });
  document.getElementById('levatorSlider')?.addEventListener('input', (e) => {
    setSymptomValue('levator', e.target.value, true);
  });

  document.getElementById('radicularToggle')?.addEventListener('change', () => {
    triggerHapticFeedback();
    renderLiveTrafficLightEvaluation();
    triggerOptimisticAutoSave();
  });

  document.getElementById('checkinNotesInput')?.addEventListener('input', () => {
    triggerOptimisticAutoSave();
  });

  document.getElementById('saveCheckinBtn')?.addEventListener('click', async () => {
    const metrics = readCurrentCheckinFormValues();
    await upsertCheckin({
      date: state.todayStr,
      ...metrics
    });

    await reloadAllData();
    renderAllViews();

    const indicator = document.getElementById('checkinSavedIndicator');
    if (indicator) {
      indicator.textContent = 'Auto-Saved ✓';
      indicator.className =
        'text-[11px] font-semibold text-emerald-300 bg-emerald-500/15 border border-emerald-500/35 px-2 py-0.5 rounded-md';
    }
    showToast(`Saved ${metrics.trafficLight.toUpperCase()} Light Check-In`);
  });

  document.getElementById('trafficLightJumpBtn')?.addEventListener('click', async () => {
    const metrics = readCurrentCheckinFormValues();
    await upsertCheckin({ date: state.todayStr, ...metrics });
    await reloadAllData();
    renderAllViews();

    const evalResult = evaluateTrafficLight(metrics);
    switchTab(evalResult.recommendedTab);
  });
}

async function toggleDailyHabit(fieldKey, label) {
  const currentlyDone = Boolean(state.todayCheckin?.[fieldKey]);
  const nextVal = !currentlyDone;

  // Preserve current slider positions when toggling habit ring
  const formMetrics = readCurrentCheckinFormValues();
  await upsertCheckin({
    date: state.todayStr,
    ...formMetrics,
    [fieldKey]: nextVal
  });

  await reloadAllData();
  renderStreakRings();
  renderAnchorTimerView();
  renderAnalyticsTab();
  refreshClinicalPromptPreview();

  showToast(nextVal ? `✓ ${label} logged!` : `${label} marked pending`);
}

function renderStreakRings() {
  if (!state.streaks) return;

  const updateSingleRing = ({
    circleId,
    countId,
    badgeId,
    habitData,
    completedStroke
  }) => {
    const circle = document.getElementById(circleId);
    const countEl = document.getElementById(countId);
    const badgeEl = document.getElementById(badgeId);

    if (countEl) {
      countEl.textContent = habitData.totalStreak.toLocaleString('en-US');
    }

    if (circle) {
      // Completed today = full ring (0 offset); active pending = 78% ring in amber; 0 streak = minimal arc
      let progressRatio = 0.08;
      let strokeColor = '#475569';
      if (habitData.completedToday) {
        progressRatio = 1;
        strokeColor = completedStroke;
      } else if (habitData.totalStreak > 0) {
        progressRatio = 0.78;
        strokeColor = '#f59e0b';
      }
      const offset = STREAK_RING_CIRCUMFERENCE * (1 - progressRatio);
      circle.style.strokeDashoffset = offset.toFixed(2);
      circle.style.stroke = strokeColor;
    }

    if (badgeEl) {
      if (habitData.completedToday) {
        badgeEl.textContent =
          habitData.totalStreak >= 365 ? habitData.milestoneBadge : '✓ Done Today';
        badgeEl.className =
          'mt-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/35';
      } else if (habitData.totalStreak > 0) {
        badgeEl.textContent = 'Pending Today';
        badgeEl.className =
          'mt-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-amber-500/15 text-amber-300 border border-amber-500/35';
      } else {
        badgeEl.textContent = 'Tap to Log';
        badgeEl.className =
          'mt-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-slate-800 text-slate-400';
      }
    }
  };

  updateSingleRing({
    circleId: 'ringStepsCircle',
    countId: 'streakStepsCount',
    badgeId: 'streakStepsBadge',
    habitData: state.streaks.steps,
    completedStroke: '#10b981'
  });

  updateSingleRing({
    circleId: 'ringJournalCircle',
    countId: 'streakJournalCount',
    badgeId: 'streakJournalBadge',
    habitData: state.streaks.journal,
    completedStroke: '#38bdf8'
  });

  updateSingleRing({
    circleId: 'ringAnchorCircle',
    countId: 'streakAnchorCount',
    badgeId: 'streakAnchorBadge',
    habitData: state.streaks.anchor,
    completedStroke: '#10b981'
  });
}

function startBodyworkLiveTicker() {
  if (state.bodyworkTickerId) clearInterval(state.bodyworkTickerId);
  state.bodyworkTickerId = setInterval(() => {
    if (state.latestBodywork) {
      renderBodyworkTracker();
    }
  }, 1000);
}

function renderBodyworkTracker() {
  const activeBox = document.getElementById('bodyworkActiveContainer');
  const inactiveBox = document.getElementById('bodyworkInactiveContainer');
  if (!activeBox || !inactiveBox) return;

  const win = evaluateBodyworkWindow(state.latestBodywork, Date.now());

  if (!win.active) {
    activeBox.classList.add('hidden');
    inactiveBox.classList.remove('hidden');
    const summaryEl = document.getElementById('bodyworkLastSummary');
    if (summaryEl) summaryEl.textContent = win.lastSessionSummary;
    return;
  }

  inactiveBox.classList.add('hidden');
  activeBox.classList.remove('hidden');

  const phaseBadge = document.getElementById('bodyworkPhaseBadge');
  const phaseTitle = document.getElementById('bodyworkPhaseTitle');
  const clockEl = document.getElementById('bodyworkCountdownClock');
  const modalityEl = document.getElementById('bodyworkModalityLabel');
  const progressBar = document.getElementById('bodyworkProgressBar');
  const headlineEl = document.getElementById('bodyworkHeadline');
  const listEl = document.getElementById('bodyworkGuidelinesList');

  const isPhase1 = win.phase === 1;
  if (phaseBadge) {
    phaseBadge.textContent = win.phaseCode;
    phaseBadge.className = isPhase1
      ? 'inline-block px-2 py-0.5 rounded text-[10px] font-extrabold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/40'
      : 'inline-block px-2 py-0.5 rounded text-[10px] font-extrabold uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/40';
  }

  if (phaseTitle) phaseTitle.textContent = win.phaseTitle;
  if (clockEl) {
    clockEl.textContent = formatDurationCountdown(win.phaseRemainingMs);
    clockEl.className = `font-mono text-xl font-extrabold tracking-tight ${
      isPhase1 ? 'text-amber-400' : 'text-emerald-400'
    }`;
  }
  if (modalityEl) {
    modalityEl.textContent = `${win.modality} • ${win.elapsedHours.toFixed(1)}h elapsed of 48h window`;
  }
  if (progressBar) {
    progressBar.style.width = `${win.progressPercent}%`;
  }
  if (headlineEl) {
    headlineEl.textContent = win.headline;
  }
  if (listEl) {
    listEl.innerHTML = win.guidelines
      .map(
        (g) => `
        <li class="flex items-start gap-2">
          <span class="${isPhase1 ? 'text-amber-400' : 'text-emerald-400'} font-bold mt-0.5">•</span>
          <span>${escapeHtml(g)}</span>
        </li>
      `
      )
      .join('');
  }
}

// State for 3-zone segmented symptom inputs
const symptomValues = {
  scalp: 2,
  levator: 2,
  interscap: 2
};

function triggerHapticFeedback() {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(15);
    } catch {
      // Ignore vibration error on unsupported or policy-blocked environments
    }
  }
}

function updateSymptomUI(symptomKey, value) {
  const clamped = Math.max(0, Math.min(10, Math.round(Number(value) || 0)));
  symptomValues[symptomKey] = clamped;

  const badgeEl = document.getElementById(`${symptomKey}ValueBadge`);
  let zone = 'calm';
  let zoneLabel = 'Calm';
  if (clamped >= 7) {
    zone = 'flare';
    zoneLabel = 'Flare';
  } else if (clamped >= 4) {
    zone = 'caution';
    zoneLabel = 'Caution';
  }

  if (badgeEl) {
    badgeEl.textContent = `${clamped} / 10 • ${zoneLabel}`;
    if (zone === 'flare') {
      badgeEl.className =
        'min-w-[4.25rem] text-center px-2.5 py-1 rounded-xl text-xs font-extrabold bg-rose-500/20 text-rose-300 border border-rose-500/40';
    } else if (zone === 'caution') {
      badgeEl.className =
        'min-w-[4.25rem] text-center px-2.5 py-1 rounded-xl text-xs font-extrabold bg-amber-500/20 text-amber-300 border border-amber-500/40';
    } else {
      badgeEl.className =
        'min-w-[4.25rem] text-center px-2.5 py-1 rounded-xl text-xs font-extrabold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40';
    }
  }

  // Highlight active zone segmented pill
  document.querySelectorAll(`.zone-pill-btn[data-symptom="${symptomKey}"], .zone-pill-btn[data-metric="${symptomKey}"]`).forEach((btn) => {
    const btnZone = btn.dataset.zone;
    btn.classList.remove('zone-calm-active', 'zone-caution-active', 'zone-flare-active');
    if (btnZone === zone) {
      btn.classList.add(`zone-${zone}-active`);
    }
  });

  // Keep hidden slider synced for backward compatibility
  const hiddenSlider = document.getElementById(`${symptomKey}Slider`);
  if (hiddenSlider && Number(hiddenSlider.value) !== clamped) {
    hiddenSlider.value = clamped;
  }
}

function setSymptomValue(symptomKey, nextVal, userInitiated = true) {
  const clamped = Math.max(0, Math.min(10, Math.round(Number(nextVal) || 0)));
  updateSymptomUI(symptomKey, clamped);

  if (userInitiated) {
    triggerHapticFeedback();
    renderLiveTrafficLightEvaluation();
    triggerOptimisticAutoSave();
  }
}

let autoSaveTimer = null;
async function triggerOptimisticAutoSave() {
  const saveBadge = document.getElementById('headerAutoSaveBadge');
  const cardBadge = document.getElementById('checkinSavedIndicator');

  if (saveBadge) {
    saveBadge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span><span>Saving…</span>';
    saveBadge.className =
      'text-[11px] font-medium text-amber-300 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900/90 border border-slate-800 transition-opacity duration-300';
  }
  if (cardBadge) {
    cardBadge.textContent = 'Saving…';
    cardBadge.className =
      'text-[11px] font-semibold text-amber-300 bg-amber-500/15 border border-amber-500/35 px-2 py-0.5 rounded-md';
  }

  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(async () => {
    try {
      const metrics = readCurrentCheckinFormValues();
      await upsertCheckin({
        date: state.todayStr,
        ...metrics
      });
      await reloadAllData();

      if (saveBadge) {
        saveBadge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span><span>Saved</span>';
        saveBadge.className =
          'text-[11px] font-medium text-emerald-400/90 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900/90 border border-slate-800 transition-opacity duration-300';
      }
      if (cardBadge) {
        cardBadge.textContent = 'Auto-Saved ✓';
        cardBadge.className =
          'text-[11px] font-semibold text-emerald-300 bg-emerald-500/15 border border-emerald-500/35 px-2 py-0.5 rounded-md';
      }
    } catch {
      if (saveBadge) {
        saveBadge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-rose-400"></span><span>Save error</span>';
        saveBadge.className =
          'text-[11px] font-medium text-rose-300 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900/90 border border-slate-800';
      }
    }
  }, 100);
}

function syncCheckinControlsFromState() {
  const c = state.todayCheckin;
  symptomValues.scalp = c ? Number(c.scalpPressure ?? 2) : 2;
  symptomValues.levator = c ? Number(c.levatorTension ?? c.interscapularSoreness ?? 2) : 2;
  symptomValues.interscap = c ? Number(c.interscapularSoreness ?? 2) : 2;

  updateSymptomUI('scalp', symptomValues.scalp);
  updateSymptomUI('levator', symptomValues.levator);
  updateSymptomUI('interscap', symptomValues.interscap);

  const radicularToggle = document.getElementById('radicularToggle');
  const notesInput = document.getElementById('checkinNotesInput');
  const savedInd = document.getElementById('checkinSavedIndicator');
  const headerSaved = document.getElementById('headerAutoSaveBadge');

  if (radicularToggle) radicularToggle.checked = Boolean(c?.radicularActive);
  if (notesInput) notesInput.value = c?.notes || '';

  if (savedInd) {
    if (c) {
      savedInd.textContent = 'Auto-Saved ✓';
      savedInd.className =
        'text-[11px] font-semibold text-emerald-300 bg-emerald-500/15 border border-emerald-500/35 px-2 py-0.5 rounded-md';
    } else {
      savedInd.textContent = 'Ready';
      savedInd.className =
        'text-[11px] font-semibold text-slate-300 bg-slate-800 border border-slate-700 px-2 py-0.5 rounded-md';
    }
  }

  if (headerSaved) {
    headerSaved.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span><span>Saved</span>';
    headerSaved.className =
      'text-[11px] font-medium text-emerald-400/90 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900/90 border border-slate-800 transition-opacity duration-300';
  }
}

function readCurrentCheckinFormValues() {
  const scalpPressure = symptomValues.scalp;
  const levatorTension = symptomValues.levator;
  const rawInterscap = symptomValues.interscap;
  // Guarding metric encompasses max of levator and interscapular tone
  const interscapularSoreness = Math.max(rawInterscap, levatorTension);
  const radicularActive = Boolean(document.getElementById('radicularToggle')?.checked);
  const notes = document.getElementById('checkinNotesInput')?.value || '';
  const evalResult = evaluateTrafficLight({
    scalpPressure,
    interscapularSoreness,
    radicularActive
  });

  return {
    scalpPressure,
    interscapularSoreness,
    levatorTension,
    radicularActive,
    notes,
    trafficLight: evalResult.status
  };
}

function renderLiveTrafficLightEvaluation() {
  const metrics = readCurrentCheckinFormValues();
  const evalResult = evaluateTrafficLight(metrics);

  // Update symptom badges
  updateSymptomUI('scalp', symptomValues.scalp);
  updateSymptomUI('levator', symptomValues.levator);
  updateSymptomUI('interscap', symptomValues.interscap);

  const radLabel = document.getElementById('radicularStateLabel');
  if (radLabel) {
    radLabel.textContent = metrics.radicularActive
      ? '⚠ ACTIVE RADICULAR FLARE — Restrict heavy resistance immediately'
      : 'No arm/hand paresthesia, tingling, or nerve root zingers';
    radLabel.className = metrics.radicularActive
      ? 'text-[11px] font-semibold text-rose-300'
      : 'text-[11px] text-slate-400';
  }

  const shell = document.getElementById('checkinCardShell');
  const banner = document.getElementById('trafficLightBanner');
  const badge = document.getElementById('trafficLightCodeBadge');
  const directive = document.getElementById('trafficLightDirective');
  const title = document.getElementById('trafficLightTitle');
  const rationale = document.getElementById('trafficLightRationale');
  const actionsList = document.getElementById('trafficLightActionsList');
  const saveBtn = document.getElementById('saveCheckinBtn');
  const jumpBtn = document.getElementById('trafficLightJumpBtn');

  if (shell) {
    shell.classList.remove('glow-green', 'glow-yellow', 'glow-red');
    shell.classList.add(`glow-${evalResult.status}`);
  }

  if (banner && badge && directive && saveBtn) {
    if (evalResult.status === 'red') {
      banner.className = 'rounded-xl p-4 border bg-rose-500/10 border-rose-500/40 space-y-2.5';
      badge.className =
        'px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-rose-500 text-white';
      directive.className = 'text-[11px] font-bold text-rose-300';
      saveBtn.className =
        'flex-1 py-3 px-4 rounded-xl bg-rose-500 hover:bg-rose-400 text-white font-extrabold text-sm active:scale-98 transition shadow-md';
    } else if (evalResult.status === 'yellow') {
      banner.className = 'rounded-xl p-4 border bg-amber-500/10 border-amber-500/40 space-y-2.5';
      badge.className =
        'px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-amber-500 text-slate-950';
      directive.className = 'text-[11px] font-bold text-amber-300';
      saveBtn.className =
        'flex-1 py-3 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-sm active:scale-98 transition shadow-md';
    } else {
      banner.className = 'rounded-xl p-4 border bg-emerald-500/10 border-emerald-500/35 space-y-2.5';
      badge.className =
        'px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-emerald-500 text-slate-950';
      directive.className = 'text-[11px] font-bold text-emerald-300';
      saveBtn.className =
        'flex-1 py-3 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-sm active:scale-98 transition shadow-md';
    }

    badge.textContent = evalResult.badgeText;
    directive.textContent = evalResult.loadDirective;
  }

  if (title) title.textContent = evalResult.title;
  if (rationale) rationale.textContent = evalResult.biomechanicalRationale;
  if (actionsList) {
    actionsList.innerHTML = evalResult.actions
      .map(
        (act) => `
        <li class="flex items-start gap-2">
          <span class="font-bold opacity-80">→</span>
          <span>${escapeHtml(act)}</span>
        </li>
      `
      )
      .join('');
  }
  if (jumpBtn) {
    jumpBtn.textContent = `${evalResult.recommendedTabLabel} →`;
  }

  updateHeaderReadinessPill(evalResult);
}

function styleMetricBadge(elId, val) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = `${val} / 10`;

  if (val >= 7) {
    el.className =
      'min-w-[3.25rem] text-center px-2.5 py-1 rounded-lg text-sm font-extrabold bg-rose-500/20 text-rose-300 border border-rose-500/45';
  } else if (val >= 4) {
    el.className =
      'min-w-[3.25rem] text-center px-2.5 py-1 rounded-lg text-sm font-extrabold bg-amber-500/20 text-amber-300 border border-amber-500/45';
  } else {
    el.className =
      'min-w-[3.25rem] text-center px-2.5 py-1 rounded-lg text-sm font-extrabold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40';
  }
}

/* ==========================================================================
   TAB 2: THE DAILY ANCHOR (SENSORY BREATHING PACER & NEURO-DECOMPRESSION)
   ========================================================================== */
function clearBreathingCycle() {
  if (state.anchor.breathTimeouts && state.anchor.breathTimeouts.length > 0) {
    state.anchor.breathTimeouts.forEach((id) => clearTimeout(id));
    state.anchor.breathTimeouts = [];
  }
}

function setBreathingPhase(phase) {
  state.anchor.breathPhase = phase;
  const sphere = document.getElementById('sensoryBreathSphere');
  const phaseLabel = document.getElementById('anchorBreathPhaseLabel');
  const ambPhase = document.getElementById('ambientPhaseLabel');

  if (sphere) {
    sphere.className = `sensory-breath-sphere breath-${phase} absolute inset-2 rounded-full border-2 transition-all pointer-events-none`;
  }

  if (ambPhase) {
    ambPhase.textContent = phase === 'idle' ? 'REST & PREPARE' : phase.toUpperCase();
  }

  if (phaseLabel) {
    if (phase === 'inhale') {
      phaseLabel.textContent = 'INHALE • 4.0s';
      phaseLabel.className =
        'px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-emerald-500/25 text-emerald-300 border border-emerald-400/60 shadow-[0_0_12px_rgba(16,185,129,0.3)] transition-all duration-300';
    } else if (phase === 'hold') {
      phaseLabel.textContent = 'HOLD • 0.5s';
      phaseLabel.className =
        'px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-teal-500/25 text-teal-300 border border-teal-400/60 shadow-[0_0_12px_rgba(20,184,166,0.3)] transition-all duration-300';
    } else if (phase === 'exhale') {
      phaseLabel.textContent = 'EXHALE • 6.0s';
      phaseLabel.className =
        'px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-sky-500/20 text-sky-300 border border-sky-400/50 shadow-[0_0_10px_rgba(56,189,248,0.2)] transition-all duration-300';
    } else {
      const isMidway = state.anchor.remainingSec < ANCHOR_STAGES[state.anchor.stageIndex].durationSeconds;
      phaseLabel.textContent = isMidway ? 'PAUSED' : 'READY';
      phaseLabel.className =
        'px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest bg-slate-800 text-slate-400 border border-slate-700 transition-all duration-300';
    }
  }
}

function startBreathingCycle() {
  clearBreathingCycle();
  if (!state.anchor.isRunning) return;

  // 1. INHALE (4.0s): Smooth scale-up from 0.85 to 1.15, upward sweeping harmonic tone (220 Hz -> 330 Hz)
  setBreathingPhase('inhale');
  audioEngine.playInhaleTone(4.0);

  // Inhale inflection: single gentle pulse (20ms)
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    try {
      navigator.vibrate(20);
    } catch {
      // Ignore vibration error on unsupported policy-blocked environments
    }
  }

  const holdTimeout = setTimeout(() => {
    if (!state.anchor.isRunning) return;

    // 2. PAUSE / HOLD (0.5s): Hold at top with subtle warm hum (261 Hz)
    setBreathingPhase('hold');
    audioEngine.playHoldTone(0.5);

    const exhaleTimeout = setTimeout(() => {
      if (!state.anchor.isRunning) return;

      // 3. EXHALE (6.0s): Smooth scale-down back to 0.85, relaxing downward sweep (330 Hz -> 196 Hz)
      setBreathingPhase('exhale');
      audioEngine.playExhaleTone(6.0);

      // Exhale inflection: soft double pulse ([25, 40, 25]ms)
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try {
          navigator.vibrate([25, 40, 25]);
        } catch {
          // Ignore vibration error
        }
      }

      const nextCycleTimeout = setTimeout(() => {
        if (!state.anchor.isRunning) return;
        startBreathingCycle(); // Recurse smoothly
      }, 6000);

      state.anchor.breathTimeouts.push(nextCycleTimeout);
    }, 500);

    state.anchor.breathTimeouts.push(exhaleTimeout);
  }, 4000);

  state.anchor.breathTimeouts.push(holdTimeout);
}

function bindAnchorTimerEvents() {
  // Mobile audio unlocking on first user interaction
  if (typeof window !== 'undefined') {
    const unlockAudio = async () => {
      await audioEngine.initOrResumeAudio();
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
      window.removeEventListener('touchend', unlockAudio);
    };
    window.addEventListener('click', unlockAudio, { once: true });
    window.addEventListener('touchstart', unlockAudio, { once: true });
    window.addEventListener('touchend', unlockAudio, { once: true });
  }

  // Start / Pause Anchor Session Button
  document.getElementById('anchorPlayPauseBtn')?.addEventListener('click', () => {
    // Explicitly resume / unlock audio immediately as the very first line of user gesture handler
    initOrResumeAudio();
    if (state.anchor.isRunning) {
      pauseAnchorTimer();
    } else {
      startAnchorTimer();
    }
  });

  document.getElementById('anchorResetBtn')?.addEventListener('click', () => {
    pauseAnchorTimer();
    clearBreathingCycle();
    audioEngine.stopActiveTones();
    state.anchor.stageIndex = 0;
    state.anchor.remainingSec = ANCHOR_STAGES[0].durationSeconds;
    setBreathingPhase('idle');
    renderAnchorTimerView();
  });

  document.getElementById('anchorPrevStageBtn')?.addEventListener('click', () => {
    const prevIdx = Math.max(0, state.anchor.stageIndex - 1);
    jumpToAnchorStage(prevIdx);
  });

  document.getElementById('anchorNextStageBtn')?.addEventListener('click', () => {
    const nextIdx = Math.min(ANCHOR_STAGES.length - 1, state.anchor.stageIndex + 1);
    jumpToAnchorStage(nextIdx);
  });

  // Master Sound Toggle
  document.getElementById('anchorSoundToggleBtn')?.addEventListener('click', async () => {
    await audioEngine.initOrResumeAudio();
    state.anchor.soundEnabled = !state.anchor.soundEnabled;
    audioEngine.setSoundEnabled(state.anchor.soundEnabled);
    const label = document.getElementById('anchorSoundLabel');
    if (label) {
      label.textContent = state.anchor.soundEnabled ? '🔔 Tones On' : '🔕 Muted';
    }
    if (state.anchor.soundEnabled) {
      audioEngine.playFeedbackBlip(528, 0.08);
    }
    showToast(state.anchor.soundEnabled ? 'Breathwork audio tones on' : 'Breathwork audio muted');
  });

  // Audio Volume Slider with tactile 440 Hz test feedback blip
  let volumeFeedbackTimer = null;
  document.getElementById('anchorVolumeSlider')?.addEventListener('input', async (e) => {
    const val = parseFloat(e.target.value);
    audioEngine.setVolume(val);
    if (state.anchor.soundEnabled) {
      clearTimeout(volumeFeedbackTimer);
      volumeFeedbackTimer = setTimeout(async () => {
        await audioEngine.initOrResumeAudio();
        audioEngine.playFeedbackBlip(440, 0.06);
      }, 70);
    }
  });

  // Ambient "Eyes-Closed Mode" Screen Dimmer
  const ambientModal = document.getElementById('anchorAmbientDimmerModal');
  document.getElementById('anchorEyesClosedBtn')?.addEventListener('click', () => {
    initOrResumeAudio();
    if (!state.anchor.isRunning) {
      startAnchorTimer();
    }
    ambientModal?.classList.remove('hidden');
    setTimeout(() => ambientModal?.classList.add('dimmed'), 50);
  });

  ambientModal?.addEventListener('click', () => {
    ambientModal.classList.remove('dimmed');
    ambientModal.classList.add('hidden');
  });

  document.getElementById('markAnchorCompleteManualBtn')?.addEventListener('click', async () => {
    await completeAnchorRoutineForToday();
  });
}

function jumpToAnchorStage(stageIdx) {
  const wasRunning = state.anchor.isRunning;
  pauseAnchorTimer();
  clearBreathingCycle();
  audioEngine.stopActiveTones();
  state.anchor.stageIndex = stageIdx;
  state.anchor.remainingSec = ANCHOR_STAGES[stageIdx].durationSeconds;
  setBreathingPhase('idle');
  renderAnchorTimerView();
  if (wasRunning) {
    startAnchorTimer();
  }
}

function startAnchorTimer() {
  if (state.anchor.isRunning) return;

  state.anchor.isRunning = true;
  state.anchor.endTimestampMs = Date.now() + state.anchor.remainingSec * 1000;

  // Prime Web Audio context directly within user gesture pipeline
  initOrResumeAudio()
    .then(() => {
      audioEngine.playRoundBell();
    })
    .catch(() => {});

  requestScreenWakeLock().catch(() => {});

  // Start smooth sensory breathing cadence pacer + audio tones
  startBreathingCycle();

  state.anchor.intervalId = setInterval(() => {
    const msLeft = state.anchor.endTimestampMs - Date.now();
    const secLeft = Math.max(0, Math.ceil(msLeft / 1000));
    state.anchor.remainingSec = secLeft;

    if (secLeft <= 0) {
      advanceAnchorStageOrFinish();
    } else {
      renderAnchorClockOnly();
    }
  }, 250);

  renderAnchorTimerView();
}

function pauseAnchorTimer() {
  if (state.anchor.intervalId) {
    clearInterval(state.anchor.intervalId);
    state.anchor.intervalId = null;
  }
  state.anchor.isRunning = false;
  state.anchor.endTimestampMs = null;
  clearBreathingCycle();
  audioEngine.stopActiveTones();
  setBreathingPhase('idle');
  releaseScreenWakeLock();
  renderAnchorTimerView();
}

async function advanceAnchorStageOrFinish() {
  clearBreathingCycle();
  audioEngine.stopActiveTones();

  if (state.anchor.stageIndex < ANCHOR_STAGES.length - 1) {
    state.anchor.stageIndex += 1;
    const nextStage = ANCHOR_STAGES[state.anchor.stageIndex];
    state.anchor.remainingSec = nextStage.durationSeconds;
    state.anchor.endTimestampMs = Date.now() + nextStage.durationSeconds * 1000;

    // Resonant meditation bell + mobile haptic pulse on stage switch
    audioEngine.playRoundBell();
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try {
        navigator.vibrate([40, 60, 40]);
      } catch {}
    }

    startBreathingCycle();
    renderAnchorTimerView();
    showToast(`Stage ${nextStage.step}: ${nextStage.name}`);
  } else {
    pauseAnchorTimer();
    state.anchor.stageIndex = 0;
    state.anchor.remainingSec = ANCHOR_STAGES[0].durationSeconds;
    audioEngine.playRoutineCompleteChime();
    await completeAnchorRoutineForToday();
    renderAnchorTimerView();
  }
}

async function completeAnchorRoutineForToday() {
  const formMetrics = readCurrentCheckinFormValues();
  await upsertCheckin({
    date: state.todayStr,
    ...formMetrics,
    anchorCompleted: true
  });

  await reloadAllData();
  renderStreakRings();
  renderAnchorTimerView();
  renderAnalyticsTab();
  refreshClinicalPromptPreview();
  showToast('✓ Tier 1 Daily Anchor Complete — Streak Updated!');
}

function renderAnchorTimerView() {
  const stage = ANCHOR_STAGES[state.anchor.stageIndex];
  const pillsContainer = document.getElementById('anchorStagePills');
  const doneBanner = document.getElementById('anchorCompletionBanner');

  if (doneBanner) {
    doneBanner.classList.toggle('hidden', !Boolean(state.todayCheckin?.anchorCompleted));
  }

  if (pillsContainer) {
    pillsContainer.innerHTML = '';
    ANCHOR_STAGES.forEach((s, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      const isCurrent = idx === state.anchor.stageIndex;
      const isPast = idx < state.anchor.stageIndex;
      btn.className = `py-2 px-1 rounded-xl text-[11px] font-bold border transition ${
        isCurrent
          ? 'bg-emerald-500 text-slate-950 border-emerald-400 shadow'
          : isPast
          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/35'
          : 'bg-slate-950 text-slate-400 border-slate-800'
      }`;
      btn.textContent = `${s.step}. 90s`;
      btn.addEventListener('click', () => jumpToAnchorStage(idx));
      pillsContainer.appendChild(btn);
    });
  }

  const stepLabel = document.getElementById('anchorStageStepLabel');
  const cadenceHint = document.getElementById('anchorCadenceHint');
  const playIcon = document.getElementById('anchorPlayIcon');
  const playLabel = document.getElementById('anchorPlayLabel');
  const stageName = document.getElementById('anchorStageName');
  const stageTarget = document.getElementById('anchorStageTarget');
  const stageSummary = document.getElementById('anchorStageSummary');
  const cuesList = document.getElementById('anchorStageCuesList');
  const faultWarning = document.getElementById('anchorStageFaultWarning');

  if (stepLabel) stepLabel.textContent = `STAGE ${stage.step} OF ${ANCHOR_STAGES.length}`;
  if (cadenceHint) cadenceHint.textContent = '4.0s Inhale • 0.5s Hold • 6.0s Exhale';
  if (playIcon) playIcon.textContent = state.anchor.isRunning ? '⏸' : '▶';
  if (playLabel) {
    playLabel.textContent = state.anchor.isRunning
      ? 'Pause Session'
      : state.anchor.remainingSec < stage.durationSeconds
      ? 'Resume Session'
      : 'Start Session';
  }

  if (stageName) stageName.textContent = `${stage.step}. ${stage.name}`;
  if (stageTarget) stageTarget.textContent = stage.targetFocus;
  if (stageSummary) stageSummary.textContent = stage.summary;
  if (cuesList) {
    cuesList.innerHTML = stage.cues
      .map(
        (cue) => `
        <li class="flex items-start gap-2">
          <span class="text-emerald-400 font-bold">•</span>
          <span>${escapeHtml(cue)}</span>
        </li>
      `
      )
      .join('');
  }
  if (faultWarning) faultWarning.textContent = ` ${stage.faultWarning}`;

  // If paused, ensure breathing sphere and phase label show idle/ready/paused
  if (!state.anchor.isRunning) {
    setBreathingPhase('idle');
  }

  renderAnchorClockOnly();
}

function renderAnchorClockOnly() {
  const stage = ANCHOR_STAGES[state.anchor.stageIndex];
  const timeEl = document.getElementById('anchorTimeDisplay');
  const ringCircle = document.getElementById('anchorRingCircle');

  const mins = String(Math.floor(state.anchor.remainingSec / 60)).padStart(2, '0');
  const secs = String(state.anchor.remainingSec % 60).padStart(2, '0');
  if (timeEl) timeEl.textContent = `${mins}:${secs}`;

  const ambTime = document.getElementById('ambientTimeDisplay');
  if (ambTime) ambTime.textContent = `${mins}:${secs}`;

  const ambStage = document.getElementById('ambientStageLabel');
  if (ambStage) {
    ambStage.textContent = `Stage ${stage.step} of ${ANCHOR_STAGES.length} • ${stage.name}`;
  }

  if (ringCircle) {
    const fractionRemaining = state.anchor.remainingSec / stage.durationSeconds;
    const offset = ANCHOR_RING_CIRCUMFERENCE * (1 - fractionRemaining);
    ringCircle.style.strokeDashoffset = offset.toFixed(2);
  }
}

/* ==========================================================================
   TAB 3: CROSS GATES WORKOUT BUILDER & BLACKLIST GUARDRAILS
   ========================================================================== */
function seedInitialWorkoutDraft() {
  const cableEr = getExerciseById('cable-er-iso');
  const wallSlide = getExerciseById('serratus-wall-slides');
  if (cableEr && wallSlide) {
    state.workoutBuilder.draftExercises = [
      createDraftRowFromLibrary(cableEr),
      createDraftRowFromLibrary(wallSlide)
    ];
  }
}

function createDraftRowFromLibrary(libItem) {
  const currentLight = getEffectiveTodayTrafficLight();
  const isYellow = currentLight.status === 'yellow';
  const adjustedLoad =
    isYellow && libItem.defaultLoad > 0
      ? roundToNearest2Point5(libItem.defaultLoad * 0.75)
      : libItem.defaultLoad;

  return {
    uid: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: libItem.name,
    isPrep: Boolean(libItem.isPrep),
    sets: libItem.defaultSets,
    reps: libItem.defaultReps,
    load: adjustedLoad,
    rpe: isYellow ? Math.min(6.5, libItem.defaultRpe) : libItem.defaultRpe,
    notes: isYellow ? libItem.yellowNote : ''
  };
}

function bindWorkoutBuilderEvents() {
  // Category filter buttons
  document.querySelectorAll('.cg-cat-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.workoutBuilder.selectedCategory = btn.dataset.cat || 'prep';
      document.querySelectorAll('.cg-cat-btn').forEach((b) => {
        const active = b.dataset.cat === state.workoutBuilder.selectedCategory;
        if (b.dataset.cat === 'blacklist') {
          b.className = active
            ? 'cg-cat-btn shrink-0 px-3 py-1.5 rounded-full text-xs font-bold bg-rose-500 text-white'
            : 'cg-cat-btn shrink-0 px-3 py-1.5 rounded-full text-xs font-bold bg-rose-500/15 text-rose-300 border border-rose-500/40';
        } else {
          b.className = active
            ? 'cg-cat-btn shrink-0 px-3 py-1.5 rounded-full text-xs font-bold bg-emerald-500 text-slate-950'
            : 'cg-cat-btn shrink-0 px-3 py-1.5 rounded-full text-xs font-bold bg-slate-800 text-slate-300 border border-slate-700';
        }
      });
      renderCrossGatesLibrary();
    });
  });

  // Live Custom Exercise Blacklist Guardrail Scanner
  const customInput = document.getElementById('customExerciseInput');
  customInput?.addEventListener('input', () => {
    const hit = detectBlacklistedMovement(customInput.value);
    if (hit) {
      showBlacklistGuardrailAlert(hit);
    }
  });

  customInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleCustomExerciseAdd();
    }
  });

  document.getElementById('addCustomExerciseBtn')?.addEventListener('click', handleCustomExerciseAdd);

  document.getElementById('blacklistDismissBtn')?.addEventListener('click', () => {
    document.getElementById('blacklistAlertCard')?.classList.add('hidden');
  });

  document.getElementById('blacklistSwapBtn')?.addEventListener('click', () => {
    const flagged = state.workoutBuilder.flaggedBlacklistItem;
    if (flagged) {
      const safeEx = getExerciseById(flagged.safeSwapId);
      if (safeEx) {
        state.workoutBuilder.draftExercises.push(createDraftRowFromLibrary(safeEx));
        renderActiveWorkoutDraft();
        showToast(`Swapped in safe alternative: ${safeEx.name}`);
      }
    }
    if (customInput) customInput.value = '';
    document.getElementById('blacklistAlertCard')?.classList.add('hidden');
  });

  document.getElementById('applyYellowLoadBtn')?.addEventListener('click', () => {
    if (!state.workoutBuilder.draftExercises.length) {
      showToast('Add exercises first to apply -25% load autoregulation');
      return;
    }
    state.workoutBuilder.draftExercises = state.workoutBuilder.draftExercises.map((ex) => ({
      ...ex,
      load: ex.load > 0 ? roundToNearest2Point5(ex.load * 0.75) : 0,
      rpe: Math.min(7, Number(ex.rpe) || 7)
    }));
    renderActiveWorkoutDraft();
    showToast('Applied -25% Yellow Light load reduction');
  });

  document.getElementById('clearWorkoutDraftBtn')?.addEventListener('click', () => {
    state.workoutBuilder.draftExercises = [];
    renderActiveWorkoutDraft();
  });

  document.getElementById('saveWorkoutBtn')?.addEventListener('click', async () => {
    if (state.workoutBuilder.draftExercises.length === 0) {
      showToast('Queue at least 1 exercise before saving');
      return;
    }

    const currentEval = getEffectiveTodayTrafficLight();
    const focus =
      document.getElementById('workoutFocusSelect')?.value || 'Cross Gates Autoreg Session';

    await addWorkout({
      date: state.todayStr,
      trafficLight: currentEval.status,
      focus,
      exercises: state.workoutBuilder.draftExercises
    });

    await reloadAllData();
    renderWorkoutHistory();
    renderAnalyticsTab();
    refreshClinicalPromptPreview();
    showToast('✓ Cross Gates Workout Saved to IndexedDB');
  });
}

function handleCustomExerciseAdd() {
  const input = document.getElementById('customExerciseInput');
  const rawName = String(input?.value || '').trim();
  if (!rawName) return;

  const blacklisted = detectBlacklistedMovement(rawName);
  if (blacklisted) {
    showBlacklistGuardrailAlert(blacklisted);
    showToast(`⚠ Blocked high-risk movement: ${blacklisted.name}`);
    return;
  }

  state.workoutBuilder.draftExercises.push({
    uid: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: rawName,
    isPrep: rawName.toLowerCase().includes('iso') || rawName.toLowerCase().includes('serratus'),
    sets: 3,
    reps: '10',
    load: 25,
    rpe: getEffectiveTodayTrafficLight().status === 'yellow' ? 6.5 : 7.5,
    notes: ''
  });

  if (input) input.value = '';
  renderActiveWorkoutDraft();
  showToast(`Added ${rawName}`);
}

function showBlacklistGuardrailAlert(item) {
  state.workoutBuilder.flaggedBlacklistItem = item;
  const card = document.getElementById('blacklistAlertCard');
  const tag = document.getElementById('blacklistAlertTag');
  const title = document.getElementById('blacklistAlertTitle');
  const body = document.getElementById('blacklistAlertBody');
  const swapBtn = document.getElementById('blacklistSwapBtn');

  if (!card) return;
  if (tag) tag.textContent = `CONTRAINDICATED • ${item.riskTag}`;
  if (title) title.textContent = `${item.name} — Clinical Guardrail Triggered`;
  if (body) body.textContent = item.clinicalWarning;
  if (swapBtn) swapBtn.textContent = `+ Swap Safe Alternative: ${item.safeSwapName}`;

  card.classList.remove('hidden');
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderWorkoutReadinessBanner() {
  const banner = document.getElementById('workoutReadinessBanner');
  if (!banner) return;

  const evalResult = getEffectiveTodayTrafficLight();
  const bodyworkWin = evaluateBodyworkWindow(state.latestBodywork, Date.now());

  const bodyworkCallout =
    bodyworkWin.active && bodyworkWin.phase === 1
      ? `<div class="mt-2 pt-2 border-t border-amber-500/30 text-[11px] text-amber-200 font-medium">
           ⏱ <strong>Post-Bodywork Phase 1 Active:</strong> Avoid heavy interscapular rowing for ${formatDurationCountdown(
             bodyworkWin.phaseRemainingMs
           )} to prevent rebound rhomboid/levator spasm.
         </div>`
      : bodyworkWin.active && bodyworkWin.phase === 2
      ? `<div class="mt-2 pt-2 border-t border-emerald-500/30 text-[11px] text-emerald-200 font-medium">
           ✨ <strong>Neuroplastic Window (24-48h):</strong> Ideal day for Serratus Wall Slides, Incline Prone Ys, and Towel-Roll Cable ER centration.
         </div>`
      : '';

  if (evalResult.status === 'red') {
    banner.className = 'rounded-2xl p-3.5 border bg-rose-500/10 border-rose-500/40';
    banner.innerHTML = `
      <div class="flex items-center justify-between gap-2">
        <div>
          <span class="text-[10px] font-extrabold uppercase tracking-wider text-rose-400">RED LIGHT ACTIVE</span>
          <h3 class="text-xs font-bold text-white mt-0.5">Restrict Heavy Resistance Today</h3>
          <p class="text-[11px] text-slate-300 mt-0.5">Prioritize Tier 1 Daily Anchor &amp; relaxed 10k-step walking.</p>
        </div>
        <button id="workoutBannerAnchorBtn" type="button" class="px-3 py-2 rounded-xl bg-rose-500 text-white text-xs font-extrabold shrink-0">
          Open Anchor
        </button>
      </div>
      ${bodyworkCallout}
    `;
    document.getElementById('workoutBannerAnchorBtn')?.addEventListener('click', () => switchTab('anchor'));
  } else if (evalResult.status === 'yellow') {
    banner.className = 'rounded-2xl p-3.5 border bg-amber-500/10 border-amber-500/40';
    banner.innerHTML = `
      <div>
        <span class="text-[10px] font-extrabold uppercase tracking-wider text-amber-400">YELLOW LIGHT AUTOREGULATION (-20% TO -30%)</span>
        <p class="text-xs text-slate-200 mt-0.5">New exercises auto-scale load down 25% &amp; cap RPE ≤ 7. Eliminate end-range shoulder shear.</p>
      </div>
      ${bodyworkCallout}
    `;
  } else {
    banner.className = 'rounded-2xl p-3.5 border bg-emerald-500/10 border-emerald-500/35';
    banner.innerHTML = `
      <div>
        <span class="text-[10px] font-extrabold uppercase tracking-wider text-emerald-400">GREEN LIGHT • PROGRESSIVE OVERLOAD</span>
        <p class="text-xs text-slate-200 mt-0.5">Cleared for full working loads after mandatory rotator cuff centration prep.</p>
      </div>
      ${bodyworkCallout}
    `;
  }
}

function renderExerciseVisualSvg(ex) {
  const targetColor = '#10B981'; // emerald
  const targetGlow = 'rgba(16, 185, 129, 0.4)';
  const neckColor = '#64748B';   // slate-500
  const bodyColor = '#94A3B8';   // slate-400
  const benchColor = '#334155';  // slate-700
  const id = ex.id;

  let visualContent = '';

  if (id === 'cable-er-iso') {
    visualContent = `
      <line x1="40" y1="110" x2="160" y2="110" stroke="#38BDF8" stroke-width="2.5" stroke-dasharray="4 2"/>
      <circle cx="40" cy="110" r="5" fill="#38BDF8"/>
      <ellipse cx="230" cy="120" rx="20" ry="42" fill="#1E293B" stroke="${bodyColor}" stroke-width="2.5"/>
      <line x1="230" y1="78" x2="230" y2="60" stroke="${neckColor}" stroke-width="6" stroke-linecap="round"/>
      <circle cx="230" cy="46" r="14" fill="#1E293B" stroke="${bodyColor}" stroke-width="2.5"/>
      <rect x="214" y="112" width="10" height="18" rx="4" fill="#F59E0B" opacity="0.9"/>
      <line x1="225" y1="90" x2="225" y2="125" stroke="${bodyColor}" stroke-width="6" stroke-linecap="round"/>
      <line x1="225" y1="125" x2="160" y2="110" stroke="${bodyColor}" stroke-width="5" stroke-linecap="round"/>
      <ellipse cx="238" cy="98" rx="9" ry="14" fill="${targetColor}" opacity="0.85" filter="drop-shadow(0 0 6px ${targetGlow})"/>
      <path d="M 185 130 A 25 25 0 0 0 160 108" fill="none" stroke="#10B981" stroke-width="2" stroke-dasharray="3 2"/>
      <polygon points="156,112 163,107 165,114" fill="#10B981"/>
      <text x="280" y="102" fill="#10B981" font-size="11" font-weight="800">ROTATOR CUFF</text>
      <text x="280" y="117" fill="#64748B" font-size="9" font-weight="600">Neck Slack (Zero Shrug)</text>
    `;
  } else if (id === 'serratus-wall-slides') {
    visualContent = `
      <line x1="280" y1="20" x2="280" y2="205" stroke="${benchColor}" stroke-width="8" stroke-linecap="square"/>
      <path d="M 175 90 Q 185 130 180 180" stroke="${bodyColor}" stroke-width="14" fill="none" stroke-linecap="round"/>
      <circle cx="185" cy="50" r="14" fill="#1E293B" stroke="${bodyColor}" stroke-width="2.5"/>
      <line x1="185" y1="64" x2="183" y2="82" stroke="${neckColor}" stroke-width="5" stroke-linecap="round"/>
      <path d="M 194 95 Q 212 110 206 135" stroke="#14B8A6" stroke-width="8" fill="none" stroke-linecap="round" opacity="0.9" filter="drop-shadow(0 0 6px rgba(20,184,166,0.6))"/>
      <line x1="192" y1="108" x2="218" y2="114" stroke="#14B8A6" stroke-width="3"/>
      <line x1="190" y1="120" x2="214" y2="126" stroke="#14B8A6" stroke-width="3"/>
      <line x1="186" y1="88" x2="235" y2="92" stroke="${bodyColor}" stroke-width="6" stroke-linecap="round"/>
      <line x1="235" y1="92" x2="278" y2="72" stroke="${bodyColor}" stroke-width="6" stroke-linecap="round"/>
      <line x1="288" y1="110" x2="288" y2="60" stroke="#14B8A6" stroke-width="3"/>
      <polygon points="288,52 283,62 293,62" fill="#14B8A6"/>
      <text x="60" y="112" fill="#14B8A6" font-size="11" font-weight="800">SERRATUS WRAPPERS</text>
      <text x="60" y="127" fill="#64748B" font-size="9" font-weight="600">Ribs Wide • Neck Down</text>
    `;
  } else if (id === 'incline-prone-y') {
    visualContent = `
      <line x1="100" y1="180" x2="220" y2="90" stroke="${benchColor}" stroke-width="9" stroke-linecap="round"/>
      <line x1="130" y1="160" x2="215" y2="95" stroke="${bodyColor}" stroke-width="14" stroke-linecap="round"/>
      <circle cx="236" cy="80" r="13" fill="#1E293B" stroke="${bodyColor}" stroke-width="2.5"/>
      <line x1="220" y1="90" x2="230" y2="84" stroke="${neckColor}" stroke-width="5"/>
      <path d="M 185 108 L 198 120 L 175 125" stroke="#10B981" stroke-width="5" fill="none" opacity="0.9" filter="drop-shadow(0 0 6px ${targetGlow})"/>
      <line x1="205" y1="96" x2="280" y2="48" stroke="#10B981" stroke-width="5" stroke-linecap="round"/>
      <circle cx="280" cy="48" r="4" fill="#10B981"/>
      <polygon points="282,38 276,46 287,44" fill="#10B981"/>
      <text x="50" y="70" fill="#10B981" font-size="11" font-weight="800">LOWER TRAP PULL</text>
      <text x="50" y="85" fill="#64748B" font-size="9" font-weight="600">Chest Glued • Zero Upper Shrug</text>
    `;
  } else if (id === 'chest-supported-row') {
    visualContent = `
      <line x1="200" y1="65" x2="200" y2="160" stroke="${benchColor}" stroke-width="10" stroke-linecap="round"/>
      <line x1="140" y1="165" x2="195" y2="165" stroke="${benchColor}" stroke-width="6"/>
      <path d="M 180 85 L 180 155" stroke="${bodyColor}" stroke-width="15" stroke-linecap="round"/>
      <circle cx="178" cy="48" r="14" fill="#1E293B" stroke="${bodyColor}" stroke-width="2.5"/>
      <line x1="178" y1="62" x2="178" y2="78" stroke="${neckColor}" stroke-width="5"/>
      <ellipse cx="170" cy="115" rx="8" ry="22" fill="${targetColor}" opacity="0.85" filter="drop-shadow(0 0 6px ${targetGlow})"/>
      <line x1="180" y1="88" x2="135" y2="108" stroke="${bodyColor}" stroke-width="6" stroke-linecap="round"/>
      <line x1="135" y1="108" x2="230" y2="115" stroke="#38BDF8" stroke-width="4" stroke-dasharray="3 2"/>
      <circle cx="230" cy="115" r="5" fill="#38BDF8"/>
      <line x1="135" y1="75" x2="135" y2="145" stroke="#F59E0B" stroke-width="1.5" stroke-dasharray="2 2"/>
      <text x="120" y="68" fill="#F59E0B" font-size="9" font-weight="700">ROM STOP (Torso Line)</text>
      <text x="250" y="90" fill="#10B981" font-size="11" font-weight="800">LATS &amp; RHOMBOIDS</text>
      <text x="250" y="105" fill="#64748B" font-size="9" font-weight="600">Zero Neck Extension</text>
    `;
  } else if (id === 'dual-cable-high-low-row') {
    visualContent = `
      <circle cx="320" cy="45" r="7" fill="#38BDF8"/>
      <line x1="320" y1="45" x2="225" y2="112" stroke="#38BDF8" stroke-width="2.5" stroke-dasharray="4 2"/>
      <line x1="160" y1="100" x2="150" y2="175" stroke="${bodyColor}" stroke-width="14" stroke-linecap="round"/>
      <circle cx="165" cy="58" r="14" fill="#1E293B" stroke="${bodyColor}" stroke-width="2.5"/>
      <line x1="165" y1="72" x2="162" y2="92" stroke="${neckColor}" stroke-width="5"/>
      <path d="M 152 110 Q 158 135 150 155" stroke="#10B981" stroke-width="9" fill="none" opacity="0.9" filter="drop-shadow(0 0 6px ${targetGlow})"/>
      <line x1="160" y1="98" x2="195" y2="128" stroke="${bodyColor}" stroke-width="6" stroke-linecap="round"/>
      <line x1="195" y1="128" x2="225" y2="112" stroke="${bodyColor}" stroke-width="5" stroke-linecap="round"/>
      <polygon points="190,135 198,124 187,126" fill="#10B981"/>
      <text x="50" y="95" fill="#10B981" font-size="11" font-weight="800">LOWER LATS BIAS</text>
      <text x="50" y="110" fill="#64748B" font-size="9" font-weight="600">Pulls Down Away From Neck</text>
    `;
  } else if (id === 'half-kneeling-landmine-press') {
    visualContent = `
      <circle cx="80" cy="180" r="8" fill="${benchColor}"/>
      <line x1="80" y1="180" x2="270" y2="70" stroke="#94A3B8" stroke-width="5"/>
      <circle cx="270" cy="70" r="12" fill="#F59E0B" opacity="0.9"/>
      <path d="M 180 110 L 175 160 M 175 160 L 155 195 M 175 160 L 210 195" stroke="${bodyColor}" stroke-width="8" stroke-linecap="round"/>
      <circle cx="185" cy="70" r="13" fill="#1E293B" stroke="${bodyColor}" stroke-width="2.5"/>
      <line x1="185" y1="83" x2="182" y2="102" stroke="${neckColor}" stroke-width="5"/>
      <ellipse cx="192" cy="108" rx="8" ry="12" fill="#10B981" opacity="0.85" filter="drop-shadow(0 0 6px ${targetGlow})"/>
      <line x1="184" y1="102" x2="235" y2="88" stroke="${bodyColor}" stroke-width="6" stroke-linecap="round"/>
      <line x1="235" y1="88" x2="265" y2="72" stroke="${bodyColor}" stroke-width="5" stroke-linecap="round"/>
      <path d="M 230 140 A 60 60 0 0 0 260 90" stroke="#38BDF8" stroke-width="1.5" stroke-dasharray="3 2" fill="none"/>
      <text x="270" y="130" fill="#38BDF8" font-size="9" font-weight="700">60° NATURAL ARC</text>
      <text x="60" y="60" fill="#10B981" font-size="11" font-weight="800">SERRATUS + DELT</text>
      <text x="60" y="75" fill="#64748B" font-size="9" font-weight="600">Zero Overhead Impingement</text>
    `;
  } else if (id === 'dual-cable-incline-press') {
    visualContent = `
      <line x1="110" y1="165" x2="230" y2="95" stroke="${benchColor}" stroke-width="9" stroke-linecap="round"/>
      <line x1="150" y1="140" x2="225" y2="98" stroke="${bodyColor}" stroke-width="14" stroke-linecap="round"/>
      <circle cx="242" cy="85" r="13" fill="#1E293B" stroke="${bodyColor}" stroke-width="2.5"/>
      <ellipse cx="215" cy="100" rx="10" ry="14" fill="#10B981" opacity="0.85" filter="drop-shadow(0 0 6px ${targetGlow})"/>
      <circle cx="80" cy="130" r="5" fill="#38BDF8"/>
      <line x1="80" y1="130" x2="190" y2="95" stroke="#38BDF8" stroke-width="2" stroke-dasharray="3 2"/>
      <line x1="210" y1="98" x2="230" y2="52" stroke="${bodyColor}" stroke-width="5" stroke-linecap="round"/>
      <text x="250" y="60" fill="#10B981" font-size="11" font-weight="800">CHEST &amp; SERRATUS</text>
      <text x="250" y="75" fill="#64748B" font-size="9" font-weight="600">Elbows Forward • Safe Labrum</text>
    `;
  } else if (id === 'sled-push-backward-drag') {
    visualContent = `
      <line x1="30" y1="185" x2="370" y2="185" stroke="#10B981" stroke-width="3" stroke-dasharray="6 3"/>
      <rect x="250" y="165" width="80" height="15" rx="3" fill="#334155"/>
      <line x1="265" y1="170" x2="265" y2="85" stroke="#475569" stroke-width="6"/>
      <line x1="295" y1="170" x2="295" y2="85" stroke="#475569" stroke-width="6"/>
      <rect x="255" y="130" width="70" height="25" rx="4" fill="#F59E0B" opacity="0.8"/>
      <line x1="140" y1="165" x2="185" y2="115" stroke="${bodyColor}" stroke-width="12" stroke-linecap="round"/>
      <circle cx="198" cy="100" r="13" fill="#1E293B" stroke="${bodyColor}" stroke-width="2.5"/>
      <line x1="190" y1="110" x2="265" y2="105" stroke="${bodyColor}" stroke-width="5" stroke-linecap="round"/>
      <path d="M 140 165 L 110 185 M 150 150 L 165 185" stroke="#F59E0B" stroke-width="7" stroke-linecap="round" filter="drop-shadow(0 0 6px rgba(245,158,11,0.5))"/>
      <text x="40" y="65" fill="#F59E0B" font-size="11" font-weight="800">ZERO SPINAL COMPRESSION</text>
      <text x="40" y="80" fill="#10B981" font-size="9" font-weight="700">100% Quad &amp; Glute Output</text>
    `;
  } else if (id === 'db-goblet-squat') {
    visualContent = `
      <line x1="60" y1="195" x2="340" y2="195" stroke="${benchColor}" stroke-width="2"/>
      <path d="M 195 95 L 195 140" stroke="${bodyColor}" stroke-width="14" stroke-linecap="round"/>
      <circle cx="195" cy="58" r="14" fill="#1E293B" stroke="${bodyColor}" stroke-width="2.5"/>
      <line x1="195" y1="72" x2="195" y2="88" stroke="${neckColor}" stroke-width="5"/>
      <rect x="202" y="90" width="16" height="24" rx="4" fill="#38BDF8" stroke="#FFFFFF" stroke-width="1"/>
      <path d="M 195 140 L 165 160 L 175 195 M 195 140 L 225 160 L 215 195" stroke="#F59E0B" stroke-width="8" stroke-linecap="round" filter="drop-shadow(0 0 6px rgba(245,158,11,0.5))"/>
      <text x="245" y="85" fill="#10B981" font-size="11" font-weight="800">FRONT-LOADED CORE</text>
      <text x="245" y="100" fill="#64748B" font-size="9" font-weight="600">Zero Barbell on Neck</text>
    `;
  } else {
    visualContent = `
      <line x1="60" y1="180" x2="340" y2="180" stroke="${benchColor}" stroke-width="4"/>
      <circle cx="200" cy="65" r="14" fill="#1E293B" stroke="${bodyColor}" stroke-width="2.5"/>
      <line x1="200" y1="80" x2="195" y2="135" stroke="${bodyColor}" stroke-width="12" stroke-linecap="round"/>
      <path d="M 80 120 Q 140 70 200 120 T 320 120" fill="none" stroke="#10B981" stroke-width="3" stroke-dasharray="4 2" opacity="0.8" filter="drop-shadow(0 0 6px ${targetGlow})"/>
      <text x="140" y="45" fill="#10B981" font-size="11" font-weight="800">AEROBIC FLUSH</text>
      <text x="140" y="60" fill="#64748B" font-size="9" font-weight="600">Spine Supported • Natural Gait</text>
    `;
  }

  return `
    <svg viewBox="0 0 400 225" class="w-full h-full" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <defs>
        <radialGradient id="grad-card-bg-${ex.id}" cx="50%" cy="50%" r="70%">
          <stop offset="0%" stop-color="#14141E" />
          <stop offset="100%" stop-color="#0A0A0E" />
        </radialGradient>
      </defs>
      <rect width="400" height="225" fill="url(#grad-card-bg-${ex.id})" />
      <line x1="0" y1="112.5" x2="400" y2="112.5" stroke="rgba(255,255,255,0.03)" stroke-width="1"/>
      <line x1="200" y1="0" x2="200" y2="225" stroke="rgba(255,255,255,0.03)" stroke-width="1"/>
      ${visualContent}
    </svg>
  `;
}

function renderCrossGatesLibrary() {
  const container = document.getElementById('cgExerciseLibraryList');
  if (!container) return;

  const cat = state.workoutBuilder.selectedCategory;
  container.innerHTML = '';

  if (cat === 'blacklist') {
    BLACKLIST_MOVEMENTS.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'card-alpha rounded-3xl p-4 bg-rose-950/20 border border-rose-500/40 space-y-3';
      card.innerHTML = `
        <div class="flex items-start justify-between gap-2">
          <div>
            <span class="px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-rose-500/25 text-rose-300 border border-rose-500/40 shadow-sm">
              ${escapeHtml(item.riskTag)}
            </span>
            <h4 class="text-base font-extrabold text-white mt-1.5 flex items-center gap-1.5">
              <span>⛔</span> <span>${escapeHtml(item.name)}</span>
            </h4>
          </div>
        </div>
        <p class="text-xs text-rose-200/90 leading-relaxed">${escapeHtml(item.clinicalWarning)}</p>
        <div class="pt-2 flex items-center justify-between gap-2 border-t border-rose-500/20 flex-wrap">
          <span class="text-xs text-emerald-300 font-bold">Safe Swap: ${escapeHtml(item.safeSwapName)}</span>
          <button
            type="button"
            class="px-3.5 py-2 rounded-2xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300 text-xs font-black shrink-0 cursor-pointer active:scale-95 transition"
          >
            + Queue Safe Swap
          </button>
        </div>
      `;
      card.querySelector('button')?.addEventListener('click', () => {
        const safeEx = getExerciseById(item.safeSwapId);
        if (safeEx) {
          state.workoutBuilder.draftExercises.push(createDraftRowFromLibrary(safeEx));
          renderActiveWorkoutDraft();
          showToast(`Queued safe alternative: ${safeEx.name}`);
        }
      });
      container.appendChild(card);
    });
    return;
  }

  const isYellow = getEffectiveTodayTrafficLight().status === 'yellow';
  const filtered = CROSS_GATES_LIBRARY.filter((ex) => ex.category === cat);

  filtered.forEach((ex) => {
    const card = document.createElement('div');
    card.className = 'card-alpha rounded-3xl p-4 space-y-3.5 transition-all';
    card.dataset.exerciseId = ex.id;

    const yellowPill =
      isYellow && ex.yellowPriority
        ? `<span class="px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm">YELLOW PRIORITY</span>`
        : '';

    card.innerHTML = `
      <!-- Dedicated 16:9 Visual Demonstration Container -->
      <div class="exercise-visual-container">
        ${renderExerciseVisualSvg(ex)}
        <div class="absolute top-2.5 left-2.5 flex items-center gap-1.5 pointer-events-none">
          <span class="px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm backdrop-blur-sm">
            Target: ${escapeHtml(ex.targetMuscles || 'Primary Target')}
          </span>
        </div>
        <div class="absolute top-2.5 right-2.5 flex items-center gap-1.5 pointer-events-none">
          <span class="px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-slate-900/80 text-slate-400 border border-white/10 backdrop-blur-sm">
            Neck: Zero Strain
          </span>
        </div>
      </div>

      <!-- Exercise Header Info -->
      <div class="flex items-start justify-between gap-3">
        <div class="flex-1">
          <div class="flex flex-wrap items-center gap-1.5">
            <span class="text-[10px] font-extrabold uppercase tracking-wider text-emerald-400">${escapeHtml(ex.categoryLabel)}</span>
            ${yellowPill}
          </div>
          <h4 class="text-base font-extrabold text-white tracking-tight mt-0.5">${escapeHtml(ex.name)}</h4>
          <p class="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
            <span class="opacity-70">📍</span> ${escapeHtml(ex.setupEquipment || ex.equipment)}
          </p>
        </div>
        <button
          type="button"
          data-action="add-exercise"
          class="add-exercise-btn px-3.5 py-2 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs active:scale-95 transition shadow-lg shadow-emerald-500/20 shrink-0 cursor-pointer"
        >
          + Add
        </button>
      </div>

      <!-- 3-Way Pill Segmented Switcher (Alpha Progression Style) -->
      <div class="flex items-center gap-1 p-1 rounded-2xl bg-[#0D0D12] border border-white/5 select-none">
        <button type="button" class="exercise-tab-pill active flex-1 text-center" data-tab-target="technique" data-tab="technique">
          Technique
        </button>
        <button type="button" class="exercise-tab-pill flex-1 text-center" data-tab-target="why" data-tab="why">
          Why It Protects
        </button>
        <button type="button" class="exercise-tab-pill flex-1 text-center" data-tab-target="setup" data-tab="setup">
          Setup &amp; Gear
        </button>
      </div>

      <!-- Tab 1: Technique (3 Plain-English Action Cues) -->
      <div class="exercise-pane pane-technique space-y-2">
        <ul class="space-y-1.5 text-xs text-slate-200">
          ${(ex.techniqueCues || [ex.clinicalCue]).map((cue, i) => `
            <li class="flex items-start gap-2">
              <span class="w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 text-[10px] font-black flex items-center justify-center shrink-0 mt-0.5">${i + 1}</span>
              <span class="leading-relaxed">${escapeHtml(cue)}</span>
            </li>
          `).join('')}
        </ul>
      </div>

      <!-- Tab 2: Why It Protects You (1-Sentence Safety Anchor) -->
      <div class="exercise-pane pane-why hidden">
        <div class="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 text-xs text-emerald-200 leading-relaxed flex items-start gap-2.5">
          <span class="text-base shrink-0">🛡️</span>
          <div>
            <strong class="font-extrabold text-emerald-300 block mb-0.5">Clinical Safety Anchor</strong>
            <span>${escapeHtml(ex.whyProtects || ex.clinicalCue)}</span>
          </div>
        </div>
      </div>

      <!-- Tab 3: Setup & Equipment (Cross Gates Specific) -->
      <div class="exercise-pane pane-setup hidden">
        <div class="p-3 rounded-2xl bg-white/5 border border-white/10 text-xs text-slate-300 space-y-1.5">
          <div class="flex items-center justify-between text-[11px] font-semibold text-slate-400">
            <span>Machine / Station:</span>
            <span class="text-emerald-400 font-bold">${escapeHtml(ex.equipment)}</span>
          </div>
          <p class="leading-relaxed text-slate-200">${escapeHtml(ex.setupEquipment || ex.equipment)}</p>
        </div>
      </div>

      ${
        isYellow
          ? `<div class="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-[11px] text-amber-300">
               <strong>Yellow Light Protocol:</strong> ${escapeHtml(ex.yellowNote)}
             </div>`
          : ''
      }
    `;

    // 3-Way Pill Tab Switching
    card.querySelectorAll('.exercise-tab-pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        const target = pill.dataset.tabTarget;
        card.querySelectorAll('.exercise-tab-pill').forEach((p) => p.classList.toggle('active', p === pill));
        card.querySelector('.pane-technique')?.classList.toggle('hidden', target !== 'technique');
        card.querySelector('.pane-why')?.classList.toggle('hidden', target !== 'why');
        card.querySelector('.pane-setup')?.classList.toggle('hidden', target !== 'setup');
      });
    });

    // Add to Workout Draft
    card.querySelector('.add-exercise-btn')?.addEventListener('click', () => {
      state.workoutBuilder.draftExercises.push(createDraftRowFromLibrary(ex));
      renderActiveWorkoutDraft();
      showToast(`Added ${ex.name}`);
    });

    container.appendChild(card);
  });
}

function renderActiveWorkoutDraft() {
  const container = document.getElementById('activeWorkoutExercisesContainer');
  const volPreview = document.getElementById('workoutVolumePreview');
  const prepBadge = document.getElementById('workoutPrepStatusBadge');
  if (!container) return;

  const draft = state.workoutBuilder.draftExercises;

  const hasPrep = draft.some(
    (d) =>
      d.isPrep ||
      d.name.toLowerCase().includes('er iso') ||
      d.name.toLowerCase().includes('wall slide') ||
      d.name.toLowerCase().includes('prone y')
  );

  if (prepBadge) {
    if (hasPrep) {
      prepBadge.textContent = '✓ Cuff Prep Included';
      prepBadge.className =
        'px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/35';
    } else {
      prepBadge.textContent = '⚠ Add Cuff Centration Prep';
      prepBadge.className =
        'px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/35';
    }
  }

  const totalSets = draft.reduce((sum, e) => sum + (Number(e.sets) || 0), 0);
  const estVol = computeWorkoutVolume({ exercises: draft });
  if (volPreview) {
    volPreview.textContent = `${draft.length} movements • ${totalSets} sets • ~${estVol.toLocaleString()} lbs est. volume`;
  }

  if (draft.length === 0) {
    container.innerHTML = `
      <div class="p-4 rounded-xl border border-dashed border-slate-800 text-center text-xs text-slate-400">
        No exercises queued yet. Tap <strong>+ Add</strong> from the Cross Gates library above.
      </div>
    `;
    return;
  }

  container.innerHTML = '';

  draft.forEach((row, idx) => {
    const itemEl = document.createElement('div');
    itemEl.className = 'p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5';
    itemEl.innerHTML = `
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs font-bold text-white leading-snug">${idx + 1}. ${escapeHtml(row.name)}</span>
        <button
          type="button"
          data-remove="${row.uid}"
          class="text-xs text-slate-400 hover:text-rose-400 px-2 py-0.5 rounded bg-slate-900 border border-slate-800"
          aria-label="Remove exercise"
        >
          Remove
        </button>
      </div>
      <div class="grid grid-cols-4 gap-2">
        <div>
          <label class="block text-[10px] font-semibold text-slate-400 mb-0.5">Sets</label>
          <input data-field="sets" type="number" inputmode="numeric" pattern="[0-9]*" min="1" max="20" value="${Number(row.sets) || 3}"
            class="w-full rounded-lg bg-slate-900 border border-slate-700 px-2 py-1.5 text-slate-100 text-center font-bold text-sm" />
        </div>
        <div>
          <label class="block text-[10px] font-semibold text-slate-400 mb-0.5">Reps/Dist</label>
          <input data-field="reps" type="text" inputmode="numeric" pattern="[0-9]*" value="${escapeHtml(row.reps)}"
            class="w-full rounded-lg bg-slate-900 border border-slate-700 px-2 py-1.5 text-slate-100 text-center font-bold text-sm" />
        </div>
        <div>
          <label class="block text-[10px] font-semibold text-slate-400 mb-0.5">Load (lb)</label>
          <input data-field="load" type="number" inputmode="decimal" pattern="[0-9]*" min="0" step="2.5" value="${Number(row.load) || 0}"
            class="w-full rounded-lg bg-slate-900 border border-slate-700 px-2 py-1.5 text-slate-100 text-center font-bold text-sm" />
        </div>
        <div>
          <label class="block text-[10px] font-semibold text-slate-400 mb-0.5">RPE</label>
          <input data-field="rpe" type="number" inputmode="decimal" min="1" max="10" step="0.5" value="${Number(row.rpe) || 7}"
            class="w-full rounded-lg bg-slate-900 border border-slate-700 px-2 py-1.5 text-slate-100 text-center font-bold text-sm" />
        </div>
      </div>

      <!-- Quick-Adjust Stepper Chips for Load: -5, +5, +10 -->
      <div class="flex items-center justify-between pt-0.5 px-0.5">
        <span class="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Quick Load Adjust:</span>
        <div class="flex items-center gap-1.5">
          <button
            type="button"
            data-stepper="-5"
            class="quick-load-chip px-3 py-1 rounded-lg bg-slate-900 active:bg-slate-800 hover:bg-slate-800/90 border border-slate-700 text-slate-300 font-extrabold text-xs active:scale-95 transition shadow-sm"
            aria-label="Decrease load by 5 pounds"
          >
            -5
          </button>
          <button
            type="button"
            data-stepper="+5"
            class="quick-load-chip px-3 py-1 rounded-lg bg-slate-900 active:bg-slate-800 hover:bg-emerald-500/20 border border-slate-700 hover:border-emerald-500/50 text-emerald-400 font-extrabold text-xs active:scale-95 transition shadow-sm"
            aria-label="Increase load by 5 pounds"
          >
            +5
          </button>
          <button
            type="button"
            data-stepper="+10"
            class="quick-load-chip px-3 py-1 rounded-lg bg-slate-900 active:bg-slate-800 hover:bg-sky-500/20 border border-slate-700 hover:border-sky-500/50 text-sky-400 font-extrabold text-xs active:scale-95 transition shadow-sm"
            aria-label="Increase load by 10 pounds"
          >
            +10
          </button>
        </div>
      </div>
      <input
        data-field="notes"
        type="text"
        value="${escapeHtml(row.notes)}"
        placeholder="Set notes / cable height / scapular cue…"
        class="w-full rounded-lg bg-slate-900/70 border border-slate-800 px-2.5 py-1.5 text-slate-200 placeholder-slate-500"
      />
    `;

    itemEl.querySelector('[data-remove]')?.addEventListener('click', () => {
      state.workoutBuilder.draftExercises = state.workoutBuilder.draftExercises.filter(
        (x) => x.uid !== row.uid
      );
      renderActiveWorkoutDraft();
    });

    itemEl.querySelectorAll('input[data-field]').forEach((inp) => {
      inp.addEventListener('input', () => {
        const field = inp.dataset.field;
        if (field === 'sets' || field === 'load' || field === 'rpe') {
          row[field] = Number(inp.value) || 0;
        } else {
          row[field] = inp.value;
        }
        const setsSum = state.workoutBuilder.draftExercises.reduce(
          (s, e) => s + (Number(e.sets) || 0),
          0
        );
        const updatedVol = computeWorkoutVolume({ exercises: state.workoutBuilder.draftExercises });
        if (volPreview) {
          volPreview.textContent = `${state.workoutBuilder.draftExercises.length} movements • ${setsSum} sets • ~${updatedVol.toLocaleString()} lbs est. volume`;
        }
      });
    });

    itemEl.querySelectorAll('[data-stepper]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const delta = Number(btn.dataset.stepper);
        const currentLoad = Number(row.load) || 0;
        const newLoad = Math.max(0, currentLoad + delta);
        row.load = newLoad;

        const loadInput = itemEl.querySelector('input[data-field="load"]');
        if (loadInput) loadInput.value = newLoad;

        triggerHapticFeedback();

        const setsSum = state.workoutBuilder.draftExercises.reduce(
          (s, e) => s + (Number(e.sets) || 0),
          0
        );
        const updatedVol = computeWorkoutVolume({ exercises: state.workoutBuilder.draftExercises });
        if (volPreview) {
          volPreview.textContent = `${state.workoutBuilder.draftExercises.length} movements • ${setsSum} sets • ~${updatedVol.toLocaleString()} lbs est. volume`;
        }
      });
    });

    container.appendChild(itemEl);
  });
}

function renderWorkoutHistory() {
  const container = document.getElementById('workoutHistoryList');
  if (!container) return;

  if (!state.allWorkouts.length) {
    container.innerHTML = `
      <p class="text-xs text-slate-400 py-2">
        No workouts logged yet. Save a Cross Gates session above or load 7-Day Demo Data in Setup.
      </p>
    `;
    return;
  }

  container.innerHTML = '';
  state.allWorkouts.slice(0, 10).forEach((w) => {
    const vol = computeWorkoutVolume(w);
    const badgeStyle =
      w.trafficLight === 'red'
        ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
        : w.trafficLight === 'yellow'
        ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
        : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';

    const card = document.createElement('div');
    card.className = 'p-3.5 rounded-xl bg-slate-950/85 border border-slate-800 space-y-2';

    const exListHtml = (w.exercises || [])
      .map(
        (ex) => `
        <li class="flex items-center justify-between gap-2 text-xs text-slate-300">
          <span class="truncate">${escapeHtml(ex.name)}</span>
          <span class="font-mono text-[11px] text-slate-400 shrink-0">
            ${ex.sets}×${escapeHtml(ex.reps)} @ ${ex.load}lb (RPE ${ex.rpe})
          </span>
        </li>
      `
      )
      .join('');

    card.innerHTML = `
      <div class="flex items-start justify-between gap-2">
        <div>
          <div class="flex items-center gap-2">
            <span class="text-xs font-bold text-slate-200">${escapeHtml(w.date)}</span>
            <span class="px-2 py-0.5 rounded text-[9px] font-extrabold uppercase border ${badgeStyle}">
              ${escapeHtml(w.trafficLight)}
            </span>
            <span class="text-[11px] text-slate-400">~${vol.toLocaleString()} lbs</span>
          </div>
          <h4 class="text-sm font-bold text-white mt-0.5">${escapeHtml(w.focus)}</h4>
        </div>
        <button
          type="button"
          class="text-[11px] text-slate-500 hover:text-rose-400 px-2 py-1 rounded"
          title="Delete session"
        >
          Delete
        </button>
      </div>
      <ul class="space-y-1 pt-1 border-t border-slate-800/80">${exListHtml}</ul>
    `;

    card.querySelector('button')?.addEventListener('click', async () => {
      await deleteWorkout(w.id);
      await reloadAllData();
      renderWorkoutHistory();
      renderAnalyticsTab();
      refreshClinicalPromptPreview();
      showToast('Deleted workout log');
    });

    container.appendChild(card);
  });
}

/* ==========================================================================
   TAB 4: ANALYTICS & TRENDS ORCHESTRATION
   ========================================================================== */
function renderAnalyticsTab() {
  const last14 = state.allCheckins.slice(-14);

  const avgScalpEl = document.getElementById('kpiAvgScalp');
  const avgInterscapEl = document.getElementById('kpiAvgInterscap');
  const ratioEl = document.getElementById('kpiReadinessRatio');
  const totalWorkoutsEl = document.getElementById('kpiTotalWorkouts');

  if (last14.length > 0) {
    const avgScalp =
      last14.reduce((s, c) => s + Number(c.scalpPressure || 0), 0) / last14.length;
    const avgInterscap =
      last14.reduce((s, c) => s + Number(c.interscapularSoreness || 0), 0) / last14.length;
    const greenDays = last14.filter((c) => c.trafficLight === 'green').length;
    const greenPct = Math.round((greenDays / last14.length) * 100);

    if (avgScalpEl) avgScalpEl.textContent = `${avgScalp.toFixed(1)} / 10`;
    if (avgInterscapEl) avgInterscapEl.textContent = `${avgInterscap.toFixed(1)} / 10`;
    if (ratioEl) ratioEl.textContent = `${greenPct}% Green`;
  } else {
    if (avgScalpEl) avgScalpEl.textContent = '—';
    if (avgInterscapEl) avgInterscapEl.textContent = '—';
    if (ratioEl) ratioEl.textContent = '—';
  }

  if (totalWorkoutsEl) {
    totalWorkoutsEl.textContent = String(state.allWorkouts.length);
  }

  renderSymptomTrendChart('symptomTrendCanvas', state.allCheckins, state.todayStr);
  renderVolumeReadinessChart(
    'volumeReadinessCanvas',
    state.allWorkouts,
    state.allCheckins,
    state.todayStr
  );
  renderAdherenceGrid(
    'adherenceGridContainer',
    'adherenceDayDetail',
    state.allCheckins,
    state.todayStr
  );
}

/* ==========================================================================
   TAB 5: AI CONSULTANT, SPEECH RECOGNITION, BASELINES, DEMO & BACKUP
   ========================================================================== */
function bindConsultantAndSettingsEvents() {
  const promptInput = document.getElementById('aiPromptInput');
  const micBtn = document.getElementById('voiceMicBtn');
  const micStatus = document.getElementById('voiceMicStatus');

  // Initialize Web Speech API controller
  state.voiceController = new VoiceDictationController({
    onTranscript: ({ finalChunk, interim }) => {
      if (!promptInput) return;
      if (finalChunk) {
        const prefix = promptInput.value.trim();
        promptInput.value = prefix ? `${prefix} ${finalChunk}` : finalChunk;
      }
      if (micStatus && interim) {
        micStatus.textContent = `🎙️ "${interim}…"`;
      }
    },
    onStatusChange: (listening, message) => {
      micBtn?.classList.toggle('mic-listening', listening);
      micBtn?.classList.toggle('bg-rose-500', listening);
      micBtn?.classList.toggle('border-rose-400', listening);
      if (micStatus) {
        micStatus.textContent = message;
        micStatus.classList.toggle('hidden', !listening && !message);
      }
    },
    onError: (errMsg) => {
      showToast(errMsg);
    }
  });

  micBtn?.addEventListener('click', () => {
    state.voiceController?.toggle();
  });

  // Quick clinical prompt chips
  document.querySelectorAll('.ai-prompt-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      if (promptInput) {
        promptInput.value = chip.dataset.prompt || '';
        promptInput.focus();
      }
    });
  });

  // Ask Gemini Consultant
  const askBtn = document.getElementById('askAiBtn');
  askBtn?.addEventListener('click', async () => {
    const apiKeyInput = document.getElementById('geminiApiKeyInput');
    const modelInput = document.getElementById('geminiModelInput');

    const apiKey = (apiKeyInput?.value || state.settings.geminiApiKey || '').trim();
    const model = (modelInput?.value || state.settings.geminiModel || DEFAULT_GEMINI_MODEL).trim();

    if (!apiKey) {
      showToast('Enter your Google AI Studio API Key below first');
      apiKeyInput?.focus();
      return;
    }

    // Persist API key & model seamlessly if entered directly
    await setSetting('geminiApiKey', apiKey);
    await setSetting('geminiModel', model);
    state.settings.geminiApiKey = apiKey;
    state.settings.geminiModel = model;

    const systemPrompt = getCompiledClinicalSystemPrompt();
    const userPrompt = promptInput?.value || '';

    askBtn.disabled = true;
    const originalLabel = askBtn.textContent;
    askBtn.textContent = 'Analyzing Biomechanics & Trends…';

    try {
      const result = await askGeminiConsultant({
        apiKey,
        model,
        systemPrompt,
        userPrompt
      });

      const responseCard = document.getElementById('aiResponseCard');
      const modelBadge = document.getElementById('aiModelBadge');
      const responseBody = document.getElementById('aiResponseBody');

      if (modelBadge) modelBadge.textContent = result.modelUsed;
      if (responseBody) responseBody.innerHTML = formatTacticalBulletsHTML(result.text);
      responseCard?.classList.remove('hidden');
      showToast('Received 3-Bullet Clinical Directive');
    } catch (err) {
      const responseCard = document.getElementById('aiResponseCard');
      const responseBody = document.getElementById('aiResponseBody');
      if (responseBody) {
        responseBody.innerHTML = `<p class="text-xs text-rose-300">${escapeHtml(err.message)}</p>`;
      }
      responseCard?.classList.remove('hidden');
      showToast('Gemini request error — check API key or connection');
    } finally {
      askBtn.disabled = false;
      askBtn.textContent = originalLabel;
    }
  });

  // Show/Hide API Key
  const apiKeyField = document.getElementById('geminiApiKeyInput');
  const toggleVisBtn = document.getElementById('toggleApiKeyVisibilityBtn');
  toggleVisBtn?.addEventListener('click', () => {
    if (!apiKeyField) return;
    const isPassword = apiKeyField.type === 'password';
    apiKeyField.type = isPassword ? 'text' : 'password';
    toggleVisBtn.textContent = isPassword ? 'Hide' : 'Show';
  });

  // Model Preset Chips
  document.querySelectorAll('.model-preset-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const modelInput = document.getElementById('geminiModelInput');
      if (modelInput && chip.dataset.model) {
        modelInput.value = chip.dataset.model;
      }
    });
  });

  // Save API Key & Model
  document.getElementById('saveAiSettingsBtn')?.addEventListener('click', async () => {
    const keyVal = String(document.getElementById('geminiApiKeyInput')?.value || '').trim();
    const modelVal =
      String(document.getElementById('geminiModelInput')?.value || '').trim() ||
      DEFAULT_GEMINI_MODEL;

    await setSetting('geminiApiKey', keyVal);
    await setSetting('geminiModel', modelVal);
    state.settings.geminiApiKey = keyVal;
    state.settings.geminiModel = modelVal;
    showToast('Saved Gemini API Key & Model in IndexedDB');
  });

  // Save Multi-Year Streak Baselines
  document.getElementById('saveBaselinesBtn')?.addEventListener('click', async () => {
    const stepsBase = Math.max(
      0,
      Math.floor(Number(document.getElementById('baselineStepsInput')?.value) || 0)
    );
    const journalBase = Math.max(
      0,
      Math.floor(Number(document.getElementById('baselineJournalInput')?.value) || 0)
    );
    const anchorBase = Math.max(
      0,
      Math.floor(Number(document.getElementById('baselineAnchorInput')?.value) || 0)
    );

    await Promise.all([
      setSetting('baselineSteps', stepsBase),
      setSetting('baselineJournal', journalBase),
      setSetting('baselineAnchor', anchorBase),
      setSetting('baselineSetDate', state.todayStr)
    ]);

    await reloadAllData();
    renderStreakRings();
    refreshClinicalPromptPreview();
    showToast('✓ Streak Baselines Updated');
  });

  // Load 7-Day Demo Data
  document.getElementById('loadDemoDataBtn')?.addEventListener('click', async () => {
    await seedSevenDayDemoData();
    await reloadAllData();
    renderAllViews();
    showToast('⚡ Loaded 7-Day Demo Trends & Post-Massage Timer');
    switchTab('dashboard');
  });

  // Single-Click JSON Export
  document.getElementById('exportJsonBtn')?.addEventListener('click', async () => {
    try {
      const dump = await exportDatabaseJSON();
      const jsonBlob = new Blob([JSON.stringify(dump, null, 2)], {
        type: 'application/json'
      });
      const url = URL.createObjectURL(jsonBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `autoreg-pt-backup-${state.todayStr}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast('⬇ Exported Local JSON Backup');
    } catch (err) {
      showToast(`Export failed: ${err.message}`);
    }
  });

  // Single-Click JSON Import
  const importFileInput = document.getElementById('importJsonFileInput');
  document.getElementById('importJsonBtn')?.addEventListener('click', () => {
    importFileInput?.click();
  });

  importFileInput?.addEventListener('change', async () => {
    const file = importFileInput.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      await importDatabaseJSON(parsed);
      await reloadAllData();
      renderAllViews();
      showToast('⬆ Restored Backup into IndexedDB');
    } catch (err) {
      showToast(`Import error: ${err.message}`);
    } finally {
      importFileInput.value = '';
    }
  });
}

function syncSettingsInputs() {
  const apiKeyEl = document.getElementById('geminiApiKeyInput');
  const modelEl = document.getElementById('geminiModelInput');
  const stepsEl = document.getElementById('baselineStepsInput');
  const journalEl = document.getElementById('baselineJournalInput');
  const anchorEl = document.getElementById('baselineAnchorInput');

  if (apiKeyEl) apiKeyEl.value = state.settings.geminiApiKey;
  if (modelEl) modelEl.value = state.settings.geminiModel || DEFAULT_GEMINI_MODEL;
  if (stepsEl) stepsEl.value = state.settings.baselineSteps || '';
  if (journalEl) journalEl.value = state.settings.baselineJournal || '';
  if (anchorEl) anchorEl.value = state.settings.baselineAnchor || '';
}

function getCompiledClinicalSystemPrompt() {
  const bodyworkWindow = evaluateBodyworkWindow(state.latestBodywork, Date.now());
  return buildClinicalSystemPrompt({
    todayCheckin: state.todayCheckin || readCurrentCheckinFormValues(),
    recentCheckins: state.allCheckins,
    recentWorkouts: state.allWorkouts,
    bodyworkWindow,
    streaks: state.streaks
  });
}

function refreshClinicalPromptPreview() {
  const preview = document.getElementById('clinicalSystemPromptPreview');
  if (preview) {
    preview.textContent = getCompiledClinicalSystemPrompt();
  }
}

/* ==========================================================================
   WEB AUDIO CHIME, WAKE LOCK, PWA SERVICE WORKER & UTILITIES
   ========================================================================== */
function getEffectiveTodayTrafficLight() {
  if (state.todayCheckin) {
    return evaluateTrafficLight(state.todayCheckin);
  }
  return evaluateTrafficLight(readCurrentCheckinFormValues());
}

function playClinicalChime(type = 'stage') {
  if (!state.anchor.soundEnabled) return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const notes =
      type === 'complete'
        ? [523.25, 659.25, 783.99] // C5 - E5 - G5 major triad
        : type === 'start'
        ? [440]
        : [587.33, 880]; // D5 - A5 gentle interval

    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.14);
      gain.gain.setValueAtTime(0.001, now + i * 0.14);
      gain.gain.exponentialRampToValueAtTime(0.12, now + i * 0.14 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.14 + 0.45);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.14);
      osc.stop(now + i * 0.14 + 0.48);
    });

    setTimeout(() => ctx.close().catch(() => {}), 1200);
  } catch {
    // Ignore audio errors on restricted devices
  }
}

async function requestScreenWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    state.anchor.wakeLock = await navigator.wakeLock.request('screen');
  } catch {
    state.anchor.wakeLock = null;
  }
}

function releaseScreenWakeLock() {
  if (state.anchor.wakeLock) {
    state.anchor.wakeLock.release().catch(() => {});
    state.anchor.wakeLock = null;
  }
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch((err) => {
        console.warn('Service worker registration skipped:', err);
      });
    });
  }
}

function setupInstallPrompt() {
  const installBtn = document.getElementById('installPwaBtn');
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.deferredInstallPrompt = e;
    installBtn?.classList.remove('hidden');
  });

  installBtn?.addEventListener('click', async () => {
    if (!state.deferredInstallPrompt) return;
    state.deferredInstallPrompt.prompt();
    await state.deferredInstallPrompt.userChoice;
    state.deferredInstallPrompt = null;
    installBtn.classList.add('hidden');
  });
}

let toastTimerId = null;
function showToast(message) {
  const toast = document.getElementById('appToast');
  const text = document.getElementById('appToastText');
  if (!toast || !text) return;

  text.textContent = message;
  toast.classList.remove('hidden', 'toast-enter');
  void toast.offsetWidth; // trigger animation reflow
  toast.classList.add('toast-enter');

  if (toastTimerId) clearTimeout(toastTimerId);
  toastTimerId = setTimeout(() => {
    toast.classList.add('hidden');
  }, 2600);
}

function roundToNearest2Point5(num) {
  return Math.round(num / 2.5) * 2.5;
}

function escapeHtml(raw) {
  return String(raw ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
