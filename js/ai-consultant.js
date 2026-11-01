/**
 * js/ai-consultant.js
 * In-App Gemini Flash Clinical Consultant & Mobile Web Speech API Voice Controller
 */

import { CLINICAL_PROFILE, evaluateTrafficLight } from './clinical-engine.js';
import { computeWorkoutVolume } from './charts.js';

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
export const PRESET_GEMINI_MODELS = Object.freeze([
  'gemini-2.5-flash',
  'gemini-3.8-flash'
]);

/**
 * Dynamically compiles the clinical system prompt from live IndexedDB telemetry.
 * @param {Object} context
 * @param {Object|null} context.todayCheckin
 * @param {Array<Object>} context.recentCheckins
 * @param {Array<Object>} context.recentWorkouts
 * @param {Object} context.bodyworkWindow
 * @param {Object} context.streaks
 * @returns {string}
 */
export function buildClinicalSystemPrompt({
  todayCheckin,
  recentCheckins = [],
  recentWorkouts = [],
  bodyworkWindow = null,
  streaks = null
} = {}) {
  const effectiveToday = todayCheckin || {
    scalpPressure: 2,
    interscapularSoreness: 2,
    radicularActive: false,
    stepsCompleted: false,
    journalCompleted: false,
    anchorCompleted: false,
    notes: 'Not yet submitted today'
  };

  const todayEval = evaluateTrafficLight(effectiveToday);

  // Compute 7-day trend telemetry
  const last7 = recentCheckins.slice(-7);
  const avgScalp = last7.length
    ? (last7.reduce((s, c) => s + Number(c.scalpPressure || 0), 0) / last7.length).toFixed(1)
    : 'N/A';
  const avgInterscap = last7.length
    ? (last7.reduce((s, c) => s + Number(c.interscapularSoreness || 0), 0) / last7.length).toFixed(1)
    : 'N/A';

  const lightCounts = last7.reduce(
    (acc, c) => {
      const k = c.trafficLight || 'green';
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    },
    { green: 0, yellow: 0, red: 0 }
  );

  const recent3Workouts = recentWorkouts.slice(0, 3).map((w) => {
    const vol = computeWorkoutVolume(w);
    const exSummary = (w.exercises || [])
      .map((e) => `${e.name} (${e.sets}x${e.reps} @ ${e.load}lb, RPE ${e.rpe})`)
      .join('; ');
    return `- ${w.date} [${String(w.trafficLight).toUpperCase()}] ${w.focus} (~${vol} lbs est. volume): ${exSummary}`;
  });

  const bodyworkSummary = bodyworkWindow?.active
    ? `ACTIVE (${bodyworkWindow.phaseCode} — ${bodyworkWindow.phaseTitle}; ${bodyworkWindow.modality}, ${bodyworkWindow.elapsedHours.toFixed(1)}h elapsed)`
    : bodyworkWindow?.lastSessionSummary || 'No active 48h post-bodywork window';

  const streakSummary = streaks
    ? `10k+ Steps: ${streaks.steps.totalStreak}d | Daily Journal: ${streaks.journal.totalStreak}d | Tier 1 Anchor: ${streaks.anchor.totalStreak}d`
    : 'Unavailable';

  return [
    'You are an elite Sports Physical Therapy Specialist and Strength & Conditioning Biomechanist advising an athletic patient training at Cross Gates Athletic Club.',
    '',
    '=== PATIENT SURGICAL & ORTHOPEDIC PROFILE ===',
    `- Cervical Spine: ${CLINICAL_PROFILE.surgicalHistory}; protect adjacent segments ${CLINICAL_PROFILE.adjacentSegmentsAtRisk.join(' & ')}.`,
    `- Neurogenic Sensitivity: ${CLINICAL_PROFILE.neurologicalHistory.join('; ')}.`,
    `- Glenohumeral Status: ${CLINICAL_PROFILE.glenohumeralPathology}.`,
    `- Compensatory Guarding Cascade: ${CLINICAL_PROFILE.compensatoryPattern.summary} ${CLINICAL_PROFILE.compensatoryPattern.cranialCascade}`,
    '- Permanent Contraindications (Blacklist): Barbell Back Squat, Overhead/Military Press, Upright Rows, Heavy Shrugs, end-range anterior shoulder shear.',
    '',
    '=== TODAY\'S LIVE AUTOREGULATION TELEMETRY ===',
    `- Readiness Status: ${todayEval.code} LIGHT (${todayEval.loadDirective})`,
    `- Scalp Pressure ("Tight Hat"): ${effectiveToday.scalpPressure}/10`,
    `- Interscapular Soreness (Rhomboid/Levator Guarding): ${effectiveToday.interscapularSoreness}/10`,
    `- Acute Cervical Radicular Symptoms: ${effectiveToday.radicularActive ? 'YES (ACTIVE — RED FLAG)' : 'No'}`,
    `- Habits Today: Steps=${effectiveToday.stepsCompleted ? 'Done' : 'Pending'}, Journal=${effectiveToday.journalCompleted ? 'Done' : 'Pending'}, Daily Anchor=${effectiveToday.anchorCompleted ? 'Done' : 'Pending'}`,
    `- Patient Check-In Note: "${effectiveToday.notes || 'None'}"`,
    `- 48-Hour Post-Bodywork Status: ${bodyworkSummary}`,
    '',
    '=== RECENT 7-DAY TRENDS & WORKOUT CONTEXT ===',
    `- 7-Day Avg Scalp Pressure: ${avgScalp}/10 | 7-Day Avg Interscapular Soreness: ${avgInterscap}/10`,
    `- 7-Day Readiness Distribution: Green=${lightCounts.green}, Yellow=${lightCounts.yellow}, Red=${lightCounts.red}`,
    `- Active Habit Streaks: ${streakSummary}`,
    recent3Workouts.length > 0
      ? `Recent Logged Workouts:\n${recent3Workouts.join('\n')}`
      : 'Recent Logged Workouts: None logged yet.',
    '',
    '=== RESPONSE DIRECTIVE ===',
    'Respond with EXACTLY 3 concise, high-impact tactical bullets tailored to the user\'s prompt and today\'s telemetry:',
    '1. **Autoregulation & Neural Tone Directive:** Immediate load/volume/RPE and cervical-occipital tone adjustment.',
    '2. **Neuromuscular Reset / Mobility Cue:** Specific cue for diaphragmatic breathing, deep neck flexors, serratus anterior, lower trapezius, or cuff centration.',
    '3. **Cross Gates Training Execution:** Exact exercise selection, cable/bench/sled setup, or ROM modification (and any red-flag stop rule).',
    'Keep total response under 190 words, clinically precise, actionable, and free of generic filler.'
  ].join('\n');
}

/**
 * Sends a prompt + clinical system instruction to Google AI Studio Gemini API.
 * @param {Object} params
 * @param {string} params.apiKey
 * @param {string} params.model
 * @param {string} params.systemPrompt
 * @param {string} params.userPrompt
 * @returns {Promise<{ text: string, modelUsed: string }>}
 */
export async function askGeminiConsultant({
  apiKey,
  model = DEFAULT_GEMINI_MODEL,
  systemPrompt,
  userPrompt
}) {
  const cleanKey = String(apiKey || '').trim();
  if (!cleanKey) {
    throw new Error('Missing Google AI Studio API Key. Enter and save your key in the Settings card below.');
  }

  const requestedModel = String(model || DEFAULT_GEMINI_MODEL).trim() || DEFAULT_GEMINI_MODEL;
  const question =
    String(userPrompt || '').trim() ||
    'Give me today\'s 3-bullet tactical physical therapy and Cross Gates training plan based on my check-in and trends.';

  const callEndpoint = async (targetModel) => {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      targetModel
    )}:generateContent`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': cleanKey
      },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: systemPrompt }]
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: question }]
          }
        ],
        generationConfig: {
          temperature: 0.35,
          maxOutputTokens: 650
        }
      })
    });

    const data = await response.json().catch(() => ({}));
    return { response, data, targetModel };
  };

  let attempt = await callEndpoint(requestedModel);

  // Graceful fallback to gemini-2.5-flash if user typed a preview/unreleased model ID (e.g. 404 Not Found)
  if (
    !attempt.response.ok &&
    attempt.response.status === 404 &&
    requestedModel !== 'gemini-2.5-flash'
  ) {
    attempt = await callEndpoint('gemini-2.5-flash');
  }

  if (!attempt.response.ok) {
    const apiMessage =
      attempt.data?.error?.message ||
      `Gemini API returned HTTP ${attempt.response.status}. Verify your API key and model name.`;
    throw new Error(apiMessage);
  }

  const candidateParts = attempt.data?.candidates?.[0]?.content?.parts || [];
  const rawText = candidateParts
    .map((p) => p.text || '')
    .join('\n')
    .trim();

  if (!rawText) {
    throw new Error('Gemini returned an empty response. Try phrasing your clinical question more specifically.');
  }

  return {
    text: rawText,
    modelUsed: attempt.targetModel
  };
}

/**
 * Safely renders Gemini's 3-bullet markdown response into styled HTML (XSS-safe).
 * @param {string} markdownText
 * @returns {string}
 */
export function formatTacticalBulletsHTML(markdownText = '') {
  const escaped = escapeHTML(markdownText);
  const lines = escaped
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const bulletItems = [];
  const introOrNotes = [];

  for (const line of lines) {
    const bulletMatch = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (bulletMatch) {
      bulletItems.push(applyBoldFormatting(bulletMatch[1]));
    } else if (bulletItems.length > 0) {
      // Continuation line of previous bullet
      bulletItems[bulletItems.length - 1] += ` ${applyBoldFormatting(line)}`;
    } else {
      introOrNotes.push(applyBoldFormatting(line));
    }
  }

  if (bulletItems.length === 0) {
    return introOrNotes
      .map(
        (p) =>
          `<p class="text-sm text-slate-200 leading-relaxed mb-2 last:mb-0">${p}</p>`
      )
      .join('');
  }

  const listHtml = bulletItems
    .map(
      (item, index) => `
      <li class="flex items-start gap-3 p-3 rounded-xl bg-slate-950/75 border border-slate-800/90">
        <span class="mt-0.5 w-6 h-6 shrink-0 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-bold flex items-center justify-center">
          ${index + 1}
        </span>
        <div class="text-sm text-slate-200 leading-relaxed">${item}</div>
      </li>
    `
    )
    .join('');

  return `<ul class="space-y-2.5">${listHtml}</ul>`;
}

/**
 * Mobile-compatible Web Speech API Controller (`SpeechRecognition` / `webkitSpeechRecognition`)
 */
export class VoiceDictationController {
  constructor({ onTranscript, onStatusChange, onError } = {}) {
    this.onTranscript = onTranscript || (() => {});
    this.onStatusChange = onStatusChange || (() => {});
    this.onError = onError || (() => {});
    this.recognition = null;
    this.isListening = false;

    const SpeechConstructor =
      window.SpeechRecognition || window.webkitSpeechRecognition || null;

    if (SpeechConstructor) {
      const rec = new SpeechConstructor();
      rec.lang = 'en-US';
      rec.continuous = false;
      rec.interimResults = true;
      rec.maxAlternatives = 1;

      rec.onstart = () => {
        this.isListening = true;
        this.onStatusChange(true, 'Listening… speak your symptoms or workout question');
      };

      rec.onresult = (event) => {
        let interim = '';
        let finalChunk = '';
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalChunk += transcript;
          } else {
            interim += transcript;
          }
        }
        this.onTranscript({ finalChunk: finalChunk.trim(), interim: interim.trim() });
      };

      rec.onerror = (event) => {
        this.isListening = false;
        this.onStatusChange(false, '');
        const code = event.error || 'unknown';
        if (code === 'not-allowed' || code === 'service-not-allowed') {
          this.onError('Microphone access denied. Enable microphone permission in Safari/Chrome settings.');
        } else if (code !== 'aborted' && code !== 'no-speech') {
          this.onError(`Voice recognition error (${code}). You can type your question directly.`);
        }
      };

      rec.onend = () => {
        this.isListening = false;
        this.onStatusChange(false, '');
      };

      this.recognition = rec;
    }
  }

  get isSupported() {
    return Boolean(this.recognition);
  }

  toggle() {
    if (!this.recognition) {
      this.onError('Web Speech API is not supported on this browser. Please type or use iOS keyboard dictation.');
      return;
    }

    if (this.isListening) {
      this.stop();
    } else {
      this.start();
    }
  }

  start() {
    if (!this.recognition || this.isListening) return;
    try {
      this.recognition.start();
    } catch {
      // Guard against rapid double-tap start exceptions on mobile WebKit
    }
  }

  stop() {
    if (!this.recognition || !this.isListening) return;
    try {
      this.recognition.stop();
    } catch {
      this.isListening = false;
      this.onStatusChange(false, '');
    }
  }
}

function escapeHTML(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function applyBoldFormatting(escapedText) {
  return escapedText.replace(
    /\*\*(.+?)\*\*/g,
    '<strong class="font-semibold text-white">$1</strong>'
  );
}
