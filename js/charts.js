/**
 * js/charts.js
 * Responsive Mobile Analytics & Biomechanical Trend Visualizers (Chart.js + 30-Day Adherence Grid)
 */

import { getDateRangeStrings, getLocalDateString, offsetDateString } from './db.js';

let symptomChartInstance = null;
let volumeReadinessChartInstance = null;

/**
 * Estimates mechanical training volume (lbs) for an exercise entry,
 * normalizing timed holds and turf sled yardage so chart tonnage stays clinically proportional.
 * @param {Object} ex - { name, sets, reps, load, rpe }
 * @returns {number}
 */
export function estimateExerciseVolume(ex = {}) {
  const sets = Math.max(0, Number(ex.sets) || 0);
  const load = Math.max(0, Number(ex.load) || 0);
  const repsRaw = String(ex.reps ?? '').toLowerCase().trim();

  if (sets === 0) return 0;

  // Timed conditioning (e.g. "25 min", "30s / 60s")
  if (repsRaw.includes('min')) {
    return Math.round(sets * (load > 0 ? load * 10 : 150));
  }

  // Turf sled distance (e.g. "40 yds") -> ~10 stride equivalents per 40 yds
  if (repsRaw.includes('yd')) {
    const yardsMatch = repsRaw.match(/(\d+(\.\d+)?)/);
    const yards = yardsMatch ? Number(yardsMatch[1]) : 30;
    const strideEquiv = Math.max(4, Math.round(yards / 4));
    return Math.round(sets * strideEquiv * (load || 90));
  }

  // Isometric clusters (e.g. "5 x 8s") -> count cluster reps
  const firstNumberMatch = repsRaw.match(/(\d+(\.\d+)?)/);
  const numericReps = firstNumberMatch ? Number(firstNumberMatch[1]) : 10;

  // Bodyweight neuromuscular prep (e.g. Serratus Wall Slides, Prone Ys at 0 lb) -> small baseline tonic load
  const effectiveLoad = load > 0 ? load : 10;
  return Math.round(sets * numericReps * effectiveLoad);
}

/**
 * Computes total session volume for a workout record.
 * @param {Object} workout
 * @returns {number}
 */
export function computeWorkoutVolume(workout) {
  if (!workout || !Array.isArray(workout.exercises)) return 0;
  return workout.exercises.reduce((sum, ex) => sum + estimateExerciseVolume(ex), 0);
}

/**
 * 1. Renders the 14-Day Dual-Axis Trend Chart:
 *    Scalp Pressure ("Tight Hat") vs. Interscapular Soreness
 */
export function renderSymptomTrendChart(canvasId, checkins = [], todayStr = getLocalDateString()) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  if (typeof window.Chart === 'undefined') {
    renderChartFallback(canvas, 'Chart.js library unavailable offline before initial cache.');
    return;
  }

  const dates14 = getDateRangeStrings(14, todayStr);
  const byDate = new Map(checkins.map((c) => [c.date, c]));

  const labels = dates14.map(formatShortMonthDay);
  const scalpData = dates14.map((d) => {
    const rec = byDate.get(d);
    return rec ? Number(rec.scalpPressure) : null;
  });
  const interscapData = dates14.map((d) => {
    const rec = byDate.get(d);
    return rec ? Number(rec.interscapularSoreness) : null;
  });
  const radicularFlags = dates14.map((d) => Boolean(byDate.get(d)?.radicularActive));

  if (symptomChartInstance) {
    symptomChartInstance.destroy();
    symptomChartInstance = null;
  }

  const ctx = canvas.getContext('2d');
  symptomChartInstance = new window.Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Scalp Pressure ("Tight Hat")',
          data: scalpData,
          yAxisID: 'yScalp',
          borderColor: '#38bdf8',
          backgroundColor: 'rgba(56, 189, 248, 0.14)',
          pointBackgroundColor: dates14.map((_, idx) =>
            radicularFlags[idx] ? '#f43f5e' : '#38bdf8'
          ),
          pointBorderColor: dates14.map((_, idx) =>
            radicularFlags[idx] ? '#fecdd3' : '#020617'
          ),
          pointRadius: dates14.map((d, idx) =>
            byDate.has(d) ? (radicularFlags[idx] ? 6 : 4) : 0
          ),
          pointHoverRadius: 6,
          borderWidth: 2.5,
          tension: 0.32,
          fill: true,
          spanGaps: true
        },
        {
          label: 'Interscapular Soreness',
          data: interscapData,
          yAxisID: 'yInterscap',
          borderColor: '#f59e0b',
          backgroundColor: 'rgba(245, 158, 11, 0.08)',
          pointBackgroundColor: '#f59e0b',
          pointBorderColor: '#020617',
          pointRadius: dates14.map((d) => (byDate.has(d) ? 4 : 0)),
          pointHoverRadius: 6,
          borderWidth: 2.5,
          borderDash: [5, 3],
          tension: 0.32,
          fill: false,
          spanGaps: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          position: 'top',
          labels: {
            color: '#cbd5e1',
            boxWidth: 12,
            usePointStyle: true,
            font: { size: 11, weight: '600' }
          }
        },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 42, 0.96)',
          titleColor: '#f8fafc',
          bodyColor: '#e2e8f0',
          borderColor: '#334155',
          borderWidth: 1,
          padding: 10,
          callbacks: {
            afterBody(items) {
              if (!items || !items.length) return '';
              const idx = items[0].dataIndex;
              const rec = byDate.get(dates14[idx]);
              if (!rec) return 'No check-in logged';
              const lines = [`Readiness: ${String(rec.trafficLight || '').toUpperCase()}`];
              if (rec.radicularActive) lines.push('⚠ Radicular Symptoms Active');
              return lines;
            }
          }
        }
      },
      scales: {
        x: {
          ticks: {
            color: '#94a3b8',
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 7,
            font: { size: 10 }
          },
          grid: {
            color: 'rgba(51, 65, 85, 0.25)'
          }
        },
        yScalp: {
          type: 'linear',
          position: 'left',
          min: 0,
          max: 10,
          ticks: {
            stepSize: 2,
            color: '#38bdf8',
            font: { size: 10, weight: '600' }
          },
          title: {
            display: true,
            text: 'Scalp (0-10)',
            color: '#38bdf8',
            font: { size: 10, weight: '600' }
          },
          grid: {
            color: (ctxLine) => {
              if (ctxLine.tick.value === 4) return 'rgba(245, 158, 11, 0.28)';
              if (ctxLine.tick.value === 7) return 'rgba(244, 63, 94, 0.32)';
              return 'rgba(51, 65, 85, 0.25)';
            }
          }
        },
        yInterscap: {
          type: 'linear',
          position: 'right',
          min: 0,
          max: 10,
          ticks: {
            stepSize: 2,
            color: '#f59e0b',
            font: { size: 10, weight: '600' }
          },
          title: {
            display: true,
            text: 'Interscap (0-10)',
            color: '#f59e0b',
            font: { size: 10, weight: '600' }
          },
          grid: {
            drawOnChartArea: false
          }
        }
      }
    }
  });
}

/**
 * 2. Renders Weekly Volume vs. Traffic Light Readiness Chart (Last 5 Weekly Windows)
 */
export function renderVolumeReadinessChart(
  canvasId,
  workouts = [],
  checkins = [],
  todayStr = getLocalDateString()
) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  if (typeof window.Chart === 'undefined') {
    renderChartFallback(canvas, 'Chart.js library unavailable offline before initial cache.');
    return;
  }

  // Construct 5 calendar-week buckets (Sun-Sat or Mon-Sun; using Sun-Sat gives crisp multi-week visibility)
  const buckets = buildWeeklyBuckets(todayStr, 5);

  for (const c of checkins) {
    const bucket = buckets.find((b) => c.date >= b.start && c.date <= b.end);
    if (!bucket) continue;
    if (c.trafficLight === 'green') bucket.green += 1;
    else if (c.trafficLight === 'yellow') bucket.yellow += 1;
    else if (c.trafficLight === 'red') bucket.red += 1;
  }

  for (const w of workouts) {
    const bucket = buckets.find((b) => w.date >= b.start && w.date <= b.end);
    if (!bucket) continue;
    bucket.volume += computeWorkoutVolume(w);
    bucket.sessions += 1;
  }

  if (volumeReadinessChartInstance) {
    volumeReadinessChartInstance.destroy();
    volumeReadinessChartInstance = null;
  }

  const ctx = canvas.getContext('2d');
  volumeReadinessChartInstance = new window.Chart(ctx, {
    type: 'bar',
    data: {
      labels: buckets.map((b) => b.label),
      datasets: [
        {
          type: 'line',
          label: 'Weekly Volume (lbs)',
          data: buckets.map((b) => b.volume),
          yAxisID: 'yVolume',
          borderColor: '#f8fafc',
          backgroundColor: '#38bdf8',
          pointBackgroundColor: '#38bdf8',
          pointBorderColor: '#020617',
          pointRadius: 4.5,
          borderWidth: 2.5,
          tension: 0.25,
          order: 0
        },
        {
          type: 'bar',
          label: 'Green Ready',
          data: buckets.map((b) => b.green),
          yAxisID: 'yDays',
          backgroundColor: 'rgba(16, 185, 129, 0.78)',
          borderRadius: 4,
          stack: 'readiness',
          barPercentage: 0.58,
          order: 1
        },
        {
          type: 'bar',
          label: 'Yellow Autoreg',
          data: buckets.map((b) => b.yellow),
          yAxisID: 'yDays',
          backgroundColor: 'rgba(245, 158, 11, 0.82)',
          borderRadius: 4,
          stack: 'readiness',
          barPercentage: 0.58,
          order: 1
        },
        {
          type: 'bar',
          label: 'Red Decompress',
          data: buckets.map((b) => b.red),
          yAxisID: 'yDays',
          backgroundColor: 'rgba(244, 63, 94, 0.85)',
          borderRadius: 4,
          stack: 'readiness',
          barPercentage: 0.58,
          order: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          position: 'top',
          labels: {
            color: '#cbd5e1',
            boxWidth: 10,
            usePointStyle: true,
            font: { size: 10.5, weight: '600' }
          }
        },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 42, 0.96)',
          titleColor: '#f8fafc',
          bodyColor: '#e2e8f0',
          borderColor: '#334155',
          borderWidth: 1,
          padding: 10,
          callbacks: {
            afterBody(items) {
              if (!items || !items.length) return '';
              const b = buckets[items[0].dataIndex];
              return `Logged Workouts: ${b.sessions}`;
            }
          }
        }
      },
      scales: {
        x: {
          stacked: true,
          ticks: {
            color: '#94a3b8',
            font: { size: 10 }
          },
          grid: {
            color: 'rgba(51, 65, 85, 0.2)'
          }
        },
        yDays: {
          type: 'linear',
          position: 'left',
          stacked: true,
          min: 0,
          max: 7,
          ticks: {
            stepSize: 1,
            color: '#10b981',
            font: { size: 10, weight: '600' }
          },
          title: {
            display: true,
            text: 'Check-In Days',
            color: '#94a3b8',
            font: { size: 10 }
          },
          grid: {
            color: 'rgba(51, 65, 85, 0.25)'
          }
        },
        yVolume: {
          type: 'linear',
          position: 'right',
          min: 0,
          suggestedMax: 5000,
          ticks: {
            color: '#e2e8f0',
            font: { size: 10 },
            callback(val) {
              if (val >= 1000) return `${(val / 1000).toFixed(1)}k`;
              return val;
            }
          },
          title: {
            display: true,
            text: 'Volume (lbs)',
            color: '#e2e8f0',
            font: { size: 10 }
          },
          grid: {
            drawOnChartArea: false
          }
        }
      }
    }
  });
}

/**
 * 3. Renders the 30-Day Visual Adherence Grid + Interactive Tap Inspector
 */
export function renderAdherenceGrid(
  gridContainerId,
  detailContainerId,
  checkins = [],
  todayStr = getLocalDateString()
) {
  const container = document.getElementById(gridContainerId);
  const detailEl = document.getElementById(detailContainerId);
  if (!container) return;

  const dates30 = getDateRangeStrings(30, todayStr);
  const byDate = new Map(checkins.map((c) => [c.date, c]));

  container.innerHTML = '';

  const showDayDetail = (dateStr) => {
    if (!detailEl) return;
    const rec = byDate.get(dateStr);
    const niceDate = formatReadableDate(dateStr);

    if (!rec) {
      detailEl.innerHTML = `
        <div class="flex items-center justify-between text-xs text-slate-400">
          <span class="font-semibold text-slate-200">${niceDate}</span>
          <span>No check-in recorded</span>
        </div>
      `;
      return;
    }

    const statusBadgeClass =
      rec.trafficLight === 'red'
        ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
        : rec.trafficLight === 'yellow'
        ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
        : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';

    const pill = (done, label) =>
      `<span class="px-2 py-0.5 rounded-full text-[11px] font-medium border ${
        done
          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/35'
          : 'bg-slate-800/80 text-slate-500 border-slate-700/60'
      }">${done ? '✓' : '○'} ${label}</span>`;

    detailEl.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-2 mb-1.5">
        <span class="text-xs font-semibold text-slate-100">${niceDate}</span>
        <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${statusBadgeClass}">
          ${rec.trafficLight} • Scalp ${rec.scalpPressure}/10 • Interscap ${rec.interscapularSoreness}/10
        </span>
      </div>
      <div class="flex flex-wrap gap-1.5">
        ${pill(rec.stepsCompleted, '10k+ Steps')}
        ${pill(rec.journalCompleted, 'Journal')}
        ${pill(rec.anchorCompleted, 'Daily Anchor')}
      </div>
    `;
  };

  dates30.forEach((dateStr) => {
    const rec = byDate.get(dateStr);
    const habitsDone = rec
      ? Number(Boolean(rec.stepsCompleted)) +
        Number(Boolean(rec.journalCompleted)) +
        Number(Boolean(rec.anchorCompleted))
      : 0;

    let cellClasses = 'bg-slate-900/90 border-slate-800 text-slate-500';
    if (habitsDone === 1) {
      cellClasses = 'bg-emerald-950/70 border-emerald-800/60 text-emerald-200';
    } else if (habitsDone === 2) {
      cellClasses = 'bg-emerald-800/50 border-emerald-500/60 text-emerald-100';
    } else if (habitsDone === 3) {
      cellClasses = 'bg-emerald-500/30 border-emerald-400 text-white shadow-sm shadow-emerald-500/20';
    }

    const isToday = dateStr === todayStr;
    const dayNumber = dateStr.slice(8, 10);

    let dotHtml = '';
    if (rec) {
      const dotColor =
        rec.trafficLight === 'red'
          ? 'bg-rose-400'
          : rec.trafficLight === 'yellow'
          ? 'bg-amber-400'
          : 'bg-emerald-400';
      dotHtml = `<span class="w-1.5 h-1.5 rounded-full ${dotColor}"></span>`;
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = `relative h-11 rounded-lg border flex flex-col items-center justify-center transition active:scale-95 ${cellClasses} ${
      isToday ? 'ring-2 ring-sky-400/80 ring-offset-1 ring-offset-slate-950' : ''
    }`;
    button.title = `${dateStr}: ${habitsDone}/3 habits`;
    button.innerHTML = `
      <div class="absolute top-1 right-1">${dotHtml}</div>
      <span class="text-[11px] font-bold leading-none">${dayNumber}</span>
      <span class="text-[9px] opacity-75 mt-0.5">${habitsDone}/3</span>
    `;
    button.addEventListener('click', () => showDayDetail(dateStr));
    container.appendChild(button);
  });

  showDayDetail(todayStr);
}

/**
 * Resize/reflow active Chart.js instances when Analytics tab becomes visible.
 */
export function resizeAnalyticsCharts() {
  if (symptomChartInstance) symptomChartInstance.resize();
  if (volumeReadinessChartInstance) volumeReadinessChartInstance.resize();
}

/* ==========================================================================
   INTERNAL DATE & FORMATTING HELPERS
   ========================================================================== */

function buildWeeklyBuckets(todayStr, weekCount = 5) {
  const [y, m, d] = todayStr.split('-').map(Number);
  const todayDate = new Date(y, m - 1, d);
  // Anchor buckets to Sunday-Saturday calendar weeks so multi-week progressions read naturally
  const dayOfWeek = todayDate.getDay(); // 0 = Sun ... 6 = Sat
  const currentWeekStartStr = offsetDateString(todayStr, -dayOfWeek);

  const buckets = [];
  for (let i = weekCount - 1; i >= 0; i -= 1) {
    const start = offsetDateString(currentWeekStartStr, -i * 7);
    const end = offsetDateString(start, 6);
    buckets.push({
      start,
      end,
      label: i === 0 ? `Wk ${formatShortMonthDay(start)}*` : `Wk ${formatShortMonthDay(start)}`,
      green: 0,
      yellow: 0,
      red: 0,
      volume: 0,
      sessions: 0
    });
  }
  return buckets;
}

function formatShortMonthDay(dateStr) {
  const [, m, d] = dateStr.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[m - 1]} ${d}`;
}

function formatReadableDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function renderChartFallback(canvas, message) {
  const parent = canvas.parentElement;
  if (!parent) return;
  parent.innerHTML = `
    <div class="h-full flex items-center justify-center text-center p-4 text-xs text-slate-400 border border-dashed border-slate-800 rounded-xl">
      ${message}
    </div>
  `;
}
