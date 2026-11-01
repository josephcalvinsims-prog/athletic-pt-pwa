/**
 * js/db.js
 * Promise-based IndexedDB Storage Layer for Apex Autoreg PT PWA.
 * Manages 4 object stores:
 *  1. daily_checkins (keyPath: 'date' YYYY-MM-DD)
 *  2. workouts       (keyPath: 'id' autoIncrement)
 *  3. bodywork_logs  (keyPath: 'id' autoIncrement)
 *  4. settings       (keyPath: 'key')
 */

import { evaluateTrafficLight } from './clinical-engine.js';

const DB_NAME = 'apex_autoreg_pt_db';
const DB_VERSION = 1;

export const STORES = Object.freeze({
  CHECKINS: 'daily_checkins',
  WORKOUTS: 'workouts',
  BODYWORK: 'bodywork_logs',
  SETTINGS: 'settings'
});

let dbInstancePromise = null;

/**
 * Formats a Date object as local YYYY-MM-DD (avoids UTC evening date-shift bugs).
 * @param {Date} date
 * @returns {string}
 */
export function getLocalDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Shifts a YYYY-MM-DD string by deltaDays in local calendar time.
 * @param {string} dateStr
 * @param {number} deltaDays
 * @returns {string}
 */
export function offsetDateString(dateStr, deltaDays) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + deltaDays);
  return getLocalDateString(dt);
}

/**
 * Generates an ascending array of YYYY-MM-DD strings ending at endDateStr.
 * @param {number} daysCount
 * @param {string} endDateStr
 * @returns {string[]}
 */
export function getDateRangeStrings(daysCount, endDateStr = getLocalDateString()) {
  const dates = [];
  for (let i = daysCount - 1; i >= 0; i -= 1) {
    dates.push(offsetDateString(endDateStr, -i));
  }
  return dates;
}

/**
 * Opens and initializes the IndexedDB connection (singleton promise).
 * @returns {Promise<IDBDatabase>}
 */
export function openDatabase() {
  if (dbInstancePromise) return dbInstancePromise;

  dbInstancePromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB is not supported in this browser environment.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // 1. daily_checkins
      if (!db.objectStoreNames.contains(STORES.CHECKINS)) {
        db.createObjectStore(STORES.CHECKINS, { keyPath: 'date' });
      }

      // 2. workouts
      if (!db.objectStoreNames.contains(STORES.WORKOUTS)) {
        const workoutStore = db.createObjectStore(STORES.WORKOUTS, {
          keyPath: 'id',
          autoIncrement: true
        });
        workoutStore.createIndex('by_date', 'date', { unique: false });
      }

      // 3. bodywork_logs
      if (!db.objectStoreNames.contains(STORES.BODYWORK)) {
        const bodyworkStore = db.createObjectStore(STORES.BODYWORK, {
          keyPath: 'id',
          autoIncrement: true
        });
        bodyworkStore.createIndex('by_timestamp', 'timestamp', { unique: false });
      }

      // 4. settings
      if (!db.objectStoreNames.contains(STORES.SETTINGS)) {
        db.createObjectStore(STORES.SETTINGS, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbInstancePromise = null;
      };
      resolve(db);
    };

    request.onerror = () => {
      dbInstancePromise = null;
      reject(request.error || new Error('Failed to open IndexedDB.'));
    };
  });

  return dbInstancePromise;
}

/**
 * Generic transaction helper wrapping IDBRequest / IDBTransaction in Promises.
 */
async function withStore(storeName, mode, callback) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let resultValue;

    try {
      const maybeRequestOrValue = callback(store, tx);
      if (maybeRequestOrValue && maybeRequestOrValue instanceof IDBRequest) {
        maybeRequestOrValue.onsuccess = () => {
          resultValue = maybeRequestOrValue.result;
        };
        maybeRequestOrValue.onerror = () => {
          reject(maybeRequestOrValue.error);
        };
      } else {
        resultValue = maybeRequestOrValue;
      }
    } catch (err) {
      reject(err);
      return;
    }

    tx.oncomplete = () => resolve(resultValue);
    tx.onerror = () => reject(tx.error || new Error(`Transaction failed on ${storeName}`));
    tx.onabort = () => reject(tx.error || new Error(`Transaction aborted on ${storeName}`));
  });
}

/* ==========================================================================
   1. DAILY CHECK-INS STORE OPERATIONS
   Schema: {
     date, trafficLight, scalpPressure, interscapularSoreness,
     radicularActive, stepsCompleted, journalCompleted, anchorCompleted, notes
   }
   ========================================================================== */

export async function getCheckin(dateStr = getLocalDateString()) {
  const rec = await withStore(STORES.CHECKINS, 'readonly', (store) => store.get(dateStr));
  return rec || null;
}

export async function getAllCheckins() {
  const all = await withStore(STORES.CHECKINS, 'readonly', (store) => store.getAll());
  return (all || []).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Safely merges partial updates into a date's check-in record and recalculates trafficLight.
 * @param {Object} partial
 * @returns {Promise<Object>} Saved check-in record
 */
export async function upsertCheckin(partial = {}) {
  const date = partial.date || getLocalDateString();
  const existing = await getCheckin(date);

  const scalpPressure = clampMetric(
    partial.scalpPressure !== undefined
      ? partial.scalpPressure
      : existing?.scalpPressure ?? 2
  );
  const interscapularSoreness = clampMetric(
    partial.interscapularSoreness !== undefined
      ? partial.interscapularSoreness
      : existing?.interscapularSoreness ?? 2
  );
  const radicularActive =
    partial.radicularActive !== undefined
      ? Boolean(partial.radicularActive)
      : Boolean(existing?.radicularActive ?? false);

  const evaluation = evaluateTrafficLight({
    scalpPressure,
    interscapularSoreness,
    radicularActive
  });

  const merged = {
    date,
    trafficLight: partial.trafficLight || evaluation.status,
    scalpPressure,
    interscapularSoreness,
    radicularActive,
    stepsCompleted:
      partial.stepsCompleted !== undefined
        ? Boolean(partial.stepsCompleted)
        : Boolean(existing?.stepsCompleted ?? false),
    journalCompleted:
      partial.journalCompleted !== undefined
        ? Boolean(partial.journalCompleted)
        : Boolean(existing?.journalCompleted ?? false),
    anchorCompleted:
      partial.anchorCompleted !== undefined
        ? Boolean(partial.anchorCompleted)
        : Boolean(existing?.anchorCompleted ?? false),
    notes:
      partial.notes !== undefined
        ? String(partial.notes).trim()
        : String(existing?.notes ?? ''),
    updatedAt: new Date().toISOString()
  };

  // Enforce strict clinical evaluation consistency
  merged.trafficLight = evaluation.status;

  await withStore(STORES.CHECKINS, 'readwrite', (store) => store.put(merged));
  return merged;
}

/* ==========================================================================
   2. WORKOUTS STORE OPERATIONS
   Schema: {
     id (autoIncrement), date, trafficLight, focus,
     exercises: [{ name, sets, reps, load, rpe, notes }]
   }
   ========================================================================== */

export async function addWorkout(workoutInput) {
  const record = {
    date: workoutInput.date || getLocalDateString(),
    trafficLight: workoutInput.trafficLight || 'green',
    focus: String(workoutInput.focus || 'Cross Gates Autoreg Session').trim(),
    exercises: Array.isArray(workoutInput.exercises)
      ? workoutInput.exercises.map((ex) => ({
          name: String(ex.name || '').trim(),
          sets: Number(ex.sets) || 1,
          reps: String(ex.reps ?? '10').trim(),
          load: Number(ex.load) || 0,
          rpe: Number(ex.rpe) || 7,
          notes: String(ex.notes || '').trim()
        }))
      : [],
    createdAt: workoutInput.createdAt || new Date().toISOString()
  };

  const insertedId = await withStore(STORES.WORKOUTS, 'readwrite', (store) => store.add(record));
  return { id: insertedId, ...record };
}

export async function getAllWorkouts() {
  const list = await withStore(STORES.WORKOUTS, 'readonly', (store) => store.getAll());
  return (list || []).sort((a, b) => {
    const cmp = String(b.date || '').localeCompare(String(a.date || ''));
    return cmp !== 0 ? cmp : (b.id || 0) - (a.id || 0);
  });
}

export async function deleteWorkout(id) {
  await withStore(STORES.WORKOUTS, 'readwrite', (store) => store.delete(Number(id)));
}

/* ==========================================================================
   3. BODYWORK LOGS STORE OPERATIONS
   Schema: { id (autoIncrement), timestamp, modality, notes }
   ========================================================================== */

export async function addBodyworkLog({ timestamp, modality, notes = '' }) {
  const parsedTime = timestamp ? new Date(timestamp) : new Date();
  const isoTimestamp = Number.isNaN(parsedTime.getTime())
    ? new Date().toISOString()
    : parsedTime.toISOString();

  const record = {
    timestamp: isoTimestamp,
    modality: String(modality || 'Sports Myofascial & Cervical Release').trim(),
    notes: String(notes || '').trim()
  };

  const insertedId = await withStore(STORES.BODYWORK, 'readwrite', (store) => store.add(record));
  return { id: insertedId, ...record };
}

export async function getAllBodyworkLogs() {
  const logs = await withStore(STORES.BODYWORK, 'readonly', (store) => store.getAll());
  return (logs || []).sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

export async function getLatestBodyworkLog() {
  const logs = await getAllBodyworkLogs();
  return logs.length > 0 ? logs[0] : null;
}

export async function deleteBodyworkLog(id) {
  await withStore(STORES.BODYWORK, 'readwrite', (store) => store.delete(Number(id)));
}

/* ==========================================================================
   4. SETTINGS KEY-VALUE STORE OPERATIONS
   ========================================================================== */

export async function getSetting(key, defaultValue = null) {
  const row = await withStore(STORES.SETTINGS, 'readonly', (store) => store.get(key));
  return row !== undefined && row !== null ? row.value : defaultValue;
}

export async function setSetting(key, value) {
  await withStore(STORES.SETTINGS, 'readwrite', (store) => store.put({ key, value }));
  return value;
}

export async function getAllSettings() {
  const rows = await withStore(STORES.SETTINGS, 'readonly', (store) => store.getAll());
  const map = {};
  for (const row of rows || []) {
    map[row.key] = row.value;
  }
  return map;
}

/* ==========================================================================
   5. BACKUP EXPORT / IMPORT & 7-DAY DEMO DATA SEEDER
   ========================================================================== */

export async function exportDatabaseJSON() {
  const db = await openDatabase();
  const payload = {
    app: 'Apex Autoreg PT PWA',
    schemaVersion: DB_VERSION,
    exportedAt: new Date().toISOString(),
    stores: {
      daily_checkins: [],
      workouts: [],
      bodywork_logs: [],
      settings: []
    }
  };

  const storeNames = [STORES.CHECKINS, STORES.WORKOUTS, STORES.BODYWORK, STORES.SETTINGS];
  for (const name of storeNames) {
    payload.stores[name] = await new Promise((resolve, reject) => {
      const tx = db.transaction(name, 'readonly');
      const req = tx.objectStore(name).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  return payload;
}

export async function importDatabaseJSON(rawObject) {
  if (!rawObject || typeof rawObject !== 'object' || !rawObject.stores) {
    throw new Error('Invalid backup file format: missing "stores" object.');
  }

  const { stores } = rawObject;
  const requiredArrays = [STORES.CHECKINS, STORES.WORKOUTS, STORES.BODYWORK, STORES.SETTINGS];
  for (const name of requiredArrays) {
    if (stores[name] !== undefined && !Array.isArray(stores[name])) {
      throw new Error(`Invalid backup store "${name}": expected an array.`);
    }
  }

  // Preserve existing API key if the imported backup intentionally omitted or blanked it
  const existingApiKey = await getSetting('geminiApiKey', '');

  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(requiredArrays, 'readwrite');

    for (const storeName of requiredArrays) {
      const os = tx.objectStore(storeName);
      os.clear();
      const items = stores[storeName] || [];
      for (const item of items) {
        if (item && typeof item === 'object') {
          os.put(item);
        }
      }
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Database import failed.'));
    tx.onabort = () => reject(tx.error || new Error('Database import aborted.'));
  });

  const importedApiKey = await getSetting('geminiApiKey', '');
  if (!importedApiKey && existingApiKey) {
    await setSetting('geminiApiKey', existingApiKey);
  }
}

/**
 * Populates 7 days of realistic clinical check-ins, autoregulated Cross Gates workouts,
 * multi-year baseline streaks (if unset), and an active post-massage window.
 */
export async function seedSevenDayDemoData() {
  const todayStr = getLocalDateString();
  const existingSettings = await getAllSettings();

  const demoDays = [
    {
      offset: -6,
      scalpPressure: 2,
      interscapularSoreness: 2,
      radicularActive: false,
      stepsCompleted: true,
      journalCompleted: true,
      anchorCompleted: true,
      notes: 'Baseline calm morning. Clean cuff centration warmup before rows.'
    },
    {
      offset: -5,
      scalpPressure: 2,
      interscapularSoreness: 3,
      radicularActive: false,
      stepsCompleted: true,
      journalCompleted: true,
      anchorCompleted: true,
      notes: 'Mild post-row mid-back awareness, zero scalp pressure. Hit turf sleds.'
    },
    {
      offset: -4,
      scalpPressure: 5,
      interscapularSoreness: 5,
      radicularActive: false,
      stepsCompleted: true,
      journalCompleted: true,
      anchorCompleted: true,
      notes: 'Long laptop work block—tight hat 5/10. Autoregulated press weights down 25%.'
    },
    {
      offset: -3,
      scalpPressure: 7,
      interscapularSoreness: 6,
      radicularActive: false,
      stepsCompleted: true,
      journalCompleted: true,
      anchorCompleted: true,
      notes: 'Occipital tightness spiked to 7/10 after poor sleep. Respected Red Light: Anchor + 11.5k decompression walk.'
    },
    {
      offset: -2,
      scalpPressure: 4,
      interscapularSoreness: 4,
      radicularActive: false,
      stepsCompleted: true,
      journalCompleted: true,
      anchorCompleted: true,
      notes: 'Stepped back down into Yellow Light after decompression day. Serratus & lower-trap focus.'
    },
    {
      offset: -1,
      scalpPressure: 3,
      interscapularSoreness: 2,
      radicularActive: false,
      stepsCompleted: true,
      journalCompleted: true,
      anchorCompleted: true,
      notes: 'Returned to Green Light! Strong Chest-Supported Row & Half-Kneeling Landmine session.'
    },
    {
      offset: 0,
      scalpPressure: 2,
      interscapularSoreness: 2,
      radicularActive: false,
      stepsCompleted: true,
      journalCompleted: true,
      anchorCompleted: true,
      notes: 'Post-myofascial release flush day—suboccipitals and levator feel supple and quiet.'
    }
  ];

  const demoCheckins = demoDays.map((d) => {
    const date = offsetDateString(todayStr, d.offset);
    const evalResult = evaluateTrafficLight(d);
    return {
      date,
      trafficLight: evalResult.status,
      scalpPressure: d.scalpPressure,
      interscapularSoreness: d.interscapularSoreness,
      radicularActive: d.radicularActive,
      stepsCompleted: d.stepsCompleted,
      journalCompleted: d.journalCompleted,
      anchorCompleted: d.anchorCompleted,
      notes: d.notes,
      updatedAt: new Date().toISOString()
    };
  });

  const demoWorkouts = [
    {
      date: offsetDateString(todayStr, -6),
      trafficLight: 'green',
      focus: 'Pulls & Cuff Centration (Cross Gates)',
      exercises: [
        { name: 'Cable ER Isometrics (Towel Roll Under Elbow)', sets: 3, reps: '5 x 8s', load: 12.5, rpe: 6, notes: 'Humeral head seated cleanly' },
        { name: 'Serratus Wall Slides', sets: 3, reps: '10', load: 0, rpe: 6, notes: 'Smooth upward rotation' },
        { name: 'Chest-Supported Machine Row', sets: 3, reps: '10', load: 80, rpe: 8, notes: 'Stopped elbows at torso plane' },
        { name: 'Dual-Cable High-to-Low Row', sets: 3, reps: '12', load: 50, rpe: 7.5, notes: 'Zero upper-trap shrug' }
      ],
      createdAt: new Date(Date.now() - 6 * 86400000).toISOString()
    },
    {
      date: offsetDateString(todayStr, -5),
      trafficLight: 'green',
      focus: 'Zero-Axial Legs & Conditioning',
      exercises: [
        { name: 'Sled Push / Backward Drag', sets: 4, reps: '40 yds', load: 145, rpe: 8, notes: 'Neutral C-spine, strong quad drive' },
        { name: 'DB Goblet Squat', sets: 3, reps: '12', load: 55, rpe: 7.5, notes: 'Anterior core + serratus brace' },
        { name: 'Recumbent Bike HIIT', sets: 6, reps: '30s / 60s', load: 13, rpe: 8, notes: 'Hands open and relaxed' }
      ],
      createdAt: new Date(Date.now() - 5 * 86400000).toISOString()
    },
    {
      date: offsetDateString(todayStr, -4),
      trafficLight: 'yellow',
      focus: 'Autoregulated Landmine & Cable Press (-25%)',
      exercises: [
        { name: 'Cable ER Isometrics (Towel Roll Under Elbow)', sets: 3, reps: '5 x 8s', load: 10, rpe: 5.5, notes: 'Calmed anterior shoulder' },
        { name: 'Incline Prone Y-Raises', sets: 3, reps: '12', load: 0, rpe: 6, notes: 'Bodyweight lower-trap focus' },
        { name: 'Half-Kneeling Landmine Press', sets: 3, reps: '10', load: 42.5, rpe: 6.5, notes: '-25% Yellow Light load adjustment' },
        { name: 'Dual-Cable Incline/Chest Press', sets: 3, reps: '12', load: 27.5, rpe: 6.5, notes: 'Scaption plane, stopped 2" shy of pad' }
      ],
      createdAt: new Date(Date.now() - 4 * 86400000).toISOString()
    },
    {
      date: offsetDateString(todayStr, -2),
      trafficLight: 'yellow',
      focus: 'Scapular Re-Education & Decompression Gait',
      exercises: [
        { name: 'Serratus Wall Slides', sets: 3, reps: '12', load: 0, rpe: 6, notes: 'Foam roller protraction cue' },
        { name: 'Dual-Cable High-to-Low Row', sets: 3, reps: '12', load: 35, rpe: 6.5, notes: 'Tempo 3-1-2, lower trap dominant' },
        { name: 'Incline Treadmill', sets: 1, reps: '25 min', load: 0, rpe: 6, notes: '7% grade, relaxed contralateral arm swing' }
      ],
      createdAt: new Date(Date.now() - 2 * 86400000).toISOString()
    },
    {
      date: offsetDateString(todayStr, -1),
      trafficLight: 'green',
      focus: 'Progressive Upper Hybrid + Turf Sled',
      exercises: [
        { name: 'Cable ER Isometrics (Towel Roll Under Elbow)', sets: 3, reps: '5 x 8s', load: 12.5, rpe: 6, notes: 'Mandatory cuff centration prep' },
        { name: 'Chest-Supported Machine Row', sets: 3, reps: '11', load: 85, rpe: 8, notes: 'Clean progression (+5 lb)' },
        { name: 'Half-Kneeling Landmine Press', sets: 3, reps: '10', load: 60, rpe: 8, notes: 'Crisp upward scapular rotation' },
        { name: 'Sled Push / Backward Drag', sets: 3, reps: '40 yds', load: 150, rpe: 8, notes: 'Strong leg finisher, zero neck tone' }
      ],
      createdAt: new Date(Date.now() - 1 * 86400000).toISOString()
    }
  ];

  // Active bodywork logged ~8.5 hours ago so Phase 1 countdown is live immediately on Dashboard
  const activeBodyworkTime = new Date(Date.now() - 8.5 * 60 * 60 * 1000).toISOString();
  const priorBodyworkTime = new Date(Date.now() - 6.5 * 24 * 60 * 60 * 1000).toISOString();

  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(
      [STORES.CHECKINS, STORES.WORKOUTS, STORES.BODYWORK, STORES.SETTINGS],
      'readwrite'
    );

    const checkinStore = tx.objectStore(STORES.CHECKINS);
    for (const c of demoCheckins) {
      checkinStore.put(c);
    }

    const workoutStore = tx.objectStore(STORES.WORKOUTS);
    workoutStore.clear();
    for (const w of demoWorkouts) {
      workoutStore.add(w);
    }

    const bodyworkStore = tx.objectStore(STORES.BODYWORK);
    bodyworkStore.clear();
    bodyworkStore.add({
      timestamp: priorBodyworkTime,
      modality: 'Manual Cervical & Scapular Physical Therapy',
      notes: 'C4-C5 & C7-T1 gentle mobilization + soft tissue release.'
    });
    bodyworkStore.add({
      timestamp: activeBodyworkTime,
      modality: 'Deep Myofascial & Suboccipital Release',
      notes: 'Released levator scapulae, rhomboids, and suboccipital fascia—scalp pressure dropped from 4 to 2.'
    });

    const settingsStore = tx.objectStore(STORES.SETTINGS);
    if (!existingSettings.baselineSteps) {
      settingsStore.put({ key: 'baselineSteps', value: 1095 });
    }
    if (!existingSettings.baselineJournal) {
      settingsStore.put({ key: 'baselineJournal', value: 1095 });
    }
    if (!existingSettings.baselineAnchor) {
      settingsStore.put({ key: 'baselineAnchor', value: 365 });
    }
    settingsStore.put({ key: 'baselineSetDate', value: offsetDateString(todayStr, -6) });

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed seeding demo data.'));
  });
}

function clampMetric(v) {
  const n = Math.round(Number(v));
  if (Number.isNaN(n)) return 0;
  return Math.min(10, Math.max(0, n));
}
