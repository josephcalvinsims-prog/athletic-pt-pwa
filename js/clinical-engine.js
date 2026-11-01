/**
 * js/clinical-engine.js
 * Clinical & Biomechanical Domain Engine
 * Encodes surgical guardrails, compensatory muscle guarding cascades,
 * Traffic Light autoregulation, 48h post-massage windows, Daily Anchor protocol,
 * Cross Gates Athletic Club exercise taxonomy, and multi-year streak calculation.
 */

export const CLINICAL_PROFILE = Object.freeze({
  surgicalHistory: 'C5-C7 Anterior Cervical Discectomy and Fusion (ACDF)',
  neurologicalHistory: [
    'Cervical radiculopathy (C5-C7 root distribution history)',
    'Cervico-occipital neuralgia ("tight hat" / cranial-scalp pressure sensation)'
  ],
  glenohumeralPathology: 'Unrepaired bilateral partial-thickness rotator cuff tears and bilateral labral tears',
  adjacentSegmentsAtRisk: ['C4-C5 (cranial adjacent segment)', 'C7-T1 (cervicothoracic junction)'],
  compensatoryPattern: {
    summary:
      'Compensatory isometric guarding of rhomboids, levator scapulae, and upper/middle trapezius secondary to glenohumeral micro-instability and cervical fusion stiffness.',
    cranialCascade:
      'Sustained levator scapulae, splenius, and upper trapezius co-contraction tractions the nuchal fascia and galea aponeurotica while mechanically compressing the greater and lesser occipital nerves—manifesting as "tight hat" scalp pressure.',
    scapularCascade:
      'Rhomboid and levator dominance biases the scapula into downward rotation and anterior tilt, narrowing the subacromial space and increasing shear across partial rotator cuff and labral lesions unless counterbalanced by serratus anterior, lower trapezius, and humeral head centration.'
  }
});

/**
 * Evaluates daily symptom telemetry into Green / Yellow / Red clinical readiness.
 * @param {Object} metrics
 * @param {number} metrics.scalpPressure - 0 to 10 ("Tight Hat" occipital neuralgia index)
 * @param {number} metrics.interscapularSoreness - 0 to 10 (Rhomboid/levator/mid-trap guarding)
 * @param {boolean} metrics.radicularActive - Presence of cervical radicular symptoms
 */
export function evaluateTrafficLight({
  scalpPressure = 0,
  interscapularSoreness = 0,
  radicularActive = false
} = {}) {
  const scalp = clampNumber(scalpPressure, 0, 10);
  const interscap = clampNumber(interscapularSoreness, 0, 10);
  const radicular = Boolean(radicularActive);

  // RED LIGHT: Scalp >= 7 OR Interscapular >= 7 OR Radicular Active
  if (scalp >= 7 || interscap >= 7 || radicular) {
    const triggers = [];
    if (radicular) triggers.push('active radicular symptoms');
    if (scalp >= 7) triggers.push(`elevated scalp pressure (${scalp}/10)`);
    if (interscap >= 7) triggers.push(`high interscapular guarding (${interscap}/10)`);

    return {
      status: 'red',
      code: 'RED',
      title: 'Red Light — Neuro-Decompression Only',
      badgeText: 'RESTRICT HEAVY RESISTANCE',
      loadDirective: 'Suspend external resistance training today',
      loadMultiplier: 0,
      rpeCap: 4,
      triggerSummary: `Triggered by ${triggers.join(', ')}.`,
      biomechanicalRationale:
        'High occipital/interscapular tone or radicular irritation signals protective neural guarding across C4-T1 and cranial fascia. Heavy pulling or pressing today will amplify levator/upper-trap traction on occipital nerves and shear the glenohumeral labrum.',
      actions: [
        'Complete the 6-minute Tier 1 Daily Anchor routine (focus on diaphragmatic rib expansion & gentle suboccipital nods).',
        'Perform low-impact, relaxed contralateral arm-swing walking (towards 10,000+ daily steps) to promote gentle thoracic-cervical pumping.',
        'Avoid heavy resistance, axial loading, sustained isometric grip tension, and end-range shoulder elevation.',
        'Apply gentle local thermal warmth to interscapular/paraspinal musculature and prioritize hydration.'
      ],
      recommendedTab: 'anchor',
      recommendedTabLabel: 'Launch Tier 1 Daily Anchor'
    };
  }

  // YELLOW LIGHT: Scalp 4-6 OR Interscapular 4-6, No acute radicular flare
  if (scalp >= 4 || interscap >= 4) {
    const triggers = [];
    if (scalp >= 4) triggers.push(`moderate scalp pressure (${scalp}/10)`);
    if (interscap >= 4) triggers.push(`moderate interscapular soreness (${interscap}/10)`);

    return {
      status: 'yellow',
      code: 'YELLOW',
      title: 'Yellow Light — Autoregulated Precision',
      badgeText: 'REDUCE LOAD 20-30%',
      loadDirective: 'Reduce external resistance 20-30% • Cap RPE ≤ 7',
      loadMultiplier: 0.75,
      rpeCap: 7,
      triggerSummary: `Triggered by ${triggers.join(' & ')} without radicular flare.`,
      biomechanicalRationale:
        'Sub-acute rhomboid/levator/trapezius guarding is tugging on cranial fascia. Autoregulating load down 20-30% and bracing the torso prevents compensatory neck straining while restoring serratus anterior and lower-trapezius upward rotation.',
      actions: [
        'Reduce planned working weights by 20-30% and leave 3-4 reps in reserve (RPE 6-7 max).',
        'Eliminate all end-range shoulder shear (keep elbows at or slightly in front of the torso plane on presses and rows).',
        'Prioritize Chest-Supported Machine Rows, Dual-Adjustable Cable Columns, Half-Kneeling Landmine Arcs, and zero-axial leg work.',
        'Lead session with Serratus Wall Slides, Cable ER Isometrics (towel roll), and Incline Prone Y-Raises.'
      ],
      recommendedTab: 'workout',
      recommendedTabLabel: 'Open Autoregulated Workout Builder'
    };
  }

  // GREEN LIGHT: Scalp <= 3, Interscapular <= 3, No radicular symptoms
  return {
    status: 'green',
    code: 'GREEN',
    title: 'Green Light — Progressive Readiness',
    badgeText: 'PROGRESSIVE OVERLOAD + CUFF PREP',
    loadDirective: '100% target load • Mandatory Cuff Centration Prep',
    loadMultiplier: 1.0,
    rpeCap: 8.5,
    triggerSummary: `Baseline calm (Scalp ${scalp}/10, Interscapular ${interscap}/10, No radicular symptoms).`,
    biomechanicalRationale:
      'Occipital fascia tension and interscapular guarding are baseline calm. Cleared for progressive overload within C5-C7 fusion and labral-safe movement arcs, contingent on completing rotator cuff centration prep before working sets.',
    actions: [
      'Mandatory Prep: Perform Cable ER Isometrics (with towel roll) + Serratus/Lower-Trap activation prior to primary lifts.',
      'Execute standard progressive overload (RPE 7-8.5) with crisp cervical neutral (chin softly tucked, zero head jutting).',
      'Respect permanent structural guardrails: zero axial barbell spinal loading and zero end-range overhead impingement.',
      'Finish with relaxed nasal breathing to clear residual sympathetic upper-trapezius tone.'
    ],
    recommendedTab: 'workout',
    recommendedTabLabel: 'Build Progressive Session'
  };
}

/**
 * Evaluates the 48-Hour Post-Massage / Bodywork Autoregulation Window.
 * @param {Object|null} latestLog - { id, timestamp, modality, notes }
 * @param {number} nowMs - Current epoch milliseconds
 */
export function evaluateBodyworkWindow(latestLog, nowMs = Date.now()) {
  if (!latestLog || !latestLog.timestamp) {
    return {
      active: false,
      phase: 0,
      phaseLabel: 'No Active Post-Bodywork Window',
      modality: null,
      elapsedHours: null,
      remainingMs: 0,
      phaseRemainingMs: 0,
      progressPercent: 0,
      lastSessionSummary: 'Log massage or manual therapy to activate the 48-hour recovery & neuroplasticity tracker.'
    };
  }

  const startMs = typeof latestLog.timestamp === 'number'
    ? latestLog.timestamp
    : new Date(latestLog.timestamp).getTime();

  if (Number.isNaN(startMs)) {
    return {
      active: false,
      phase: 0,
      phaseLabel: 'No Active Post-Bodywork Window',
      modality: null,
      elapsedHours: null,
      remainingMs: 0,
      phaseRemainingMs: 0,
      progressPercent: 0,
      lastSessionSummary: 'Invalid timestamp in bodywork log.'
    };
  }

  const elapsedMs = Math.max(0, nowMs - startMs);
  const elapsedHours = elapsedMs / (1000 * 60 * 60);
  const window48Ms = 48 * 60 * 60 * 1000;
  const phase1Ms = 24 * 60 * 60 * 1000;

  // Hours 0 - 24: Phase 1 (Flush & Reset)
  if (elapsedMs < phase1Ms) {
    const phaseRemainingMs = phase1Ms - elapsedMs;
    const totalRemainingMs = window48Ms - elapsedMs;
    return {
      active: true,
      phase: 1,
      phaseCode: 'PHASE 1 • HOURS 0–24',
      phaseTitle: 'Flush & Parasympathetic Reset',
      accentColor: 'amber',
      modality: latestLog.modality || 'Manual Bodywork',
      notes: latestLog.notes || '',
      timestamp: startMs,
      elapsedHours,
      phaseRemainingMs,
      remainingMs: totalRemainingMs,
      progressPercent: Math.min(100, Math.round((elapsedMs / window48Ms) * 100)),
      phaseProgressPercent: Math.min(100, Math.round((elapsedMs / phase1Ms) * 100)),
      headline: 'Tissue tone manually downregulated — protect against rebound guarding.',
      guidelines: [
        'Hydration & Electrolytes: Replenish fluids liberally to support myofascial tissue perfusion and metabolic clearance.',
        'Gentle Thermal Heat: Use warm shower or moist heat over cervical-thoracic paraspinals to prevent chill-induced tone rebound.',
        'Rhythmic Arm-Swing Walking: Easy 10k-step cadence with relaxed shoulders encourages reciprocal thoracic rotation.',
        'Training Guardrail: Avoid heavy interscapular loading, aggressive rows, or high-tension gripping for the next ' +
          formatDurationShort(phaseRemainingMs) + '.'
      ]
    };
  }

  // Hours 24 - 48: Phase 2 (Neuroplastic Window)
  if (elapsedMs < window48Ms) {
    const phaseRemainingMs = window48Ms - elapsedMs;
    return {
      active: true,
      phase: 2,
      phaseCode: 'PHASE 2 • HOURS 24–48',
      phaseTitle: 'Neuroplastic Motor Re-Education Window',
      accentColor: 'emerald',
      modality: latestLog.modality || 'Manual Bodywork',
      notes: latestLog.notes || '',
      timestamp: startMs,
      elapsedHours,
      phaseRemainingMs,
      remainingMs: phaseRemainingMs,
      progressPercent: Math.min(100, Math.round((elapsedMs / window48Ms) * 100)),
      phaseProgressPercent: Math.min(100, Math.round(((elapsedMs - phase1Ms) / phase1Ms) * 100)),
      headline: 'Protective rhomboid & levator guarding is subdued — prime window to encode clean motor patterns.',
      guidelines: [
        'Serratus Anterior Upward Rotation: Perform low-load Serratus Wall Slides focusing on smooth ribcage protraction glide.',
        'Lower Trapezius Recruitment: Execute light Incline Prone Y-Raises or Dual-Cable High-to-Low scapular setting without upper-trap shrug.',
        'Glenohumeral Cuff Centration: Run Towel-Roll Cable ER Isometrics (5x10s at 30-40% effort) to seat the humeral head cleanly.',
        'Postural Carryover: Lock in deep neck flexor awareness while occipital nerve tension remains low.'
      ]
    };
  }

  const daysAgo = Math.floor(elapsedHours / 24);
  const timeLabel = daysAgo <= 2 ? `${Math.round(elapsedHours)}h ago` : `${daysAgo} days ago`;

  return {
    active: false,
    phase: 0,
    phaseLabel: '48h Post-Bodywork Window Complete',
    modality: latestLog.modality || 'Manual Bodywork',
    timestamp: startMs,
    elapsedHours,
    remainingMs: 0,
    phaseRemainingMs: 0,
    progressPercent: 100,
    lastSessionSummary: `Last logged: ${latestLog.modality || 'Bodywork'} (${timeLabel}). Log next session anytime to trigger the 48h protocol.`
  };
}

/**
 * Tier 1 Daily Anchor — 4-Stage Guided Neuro-Decompression Routine (4 x 90s = 6:00)
 */
export const ANCHOR_STAGES = Object.freeze([
  {
    id: 'diaphragmatic-rib',
    step: 1,
    name: 'Diaphragmatic Rib Expansion',
    durationSeconds: 90,
    targetFocus: 'Inhibit Accessory Scalene & SCM Breathing',
    summary: '360° lateral lower-rib expansion to silence apical chest breathing and unload C5-C7 anterior fascia.',
    cues: [
      'Lie supine with knees bent (or sit tall with occiput lightly supported) and place hands around lower lateral ribs.',
      'Inhale quietly through the nose for 4 seconds—drive lower ribs wide laterally and into the floor without lifting the collarbone.',
      'Exhale slowly through pursed lips for 6 seconds, letting the sternum soften and upper trapezius melt away from the ears.',
      'Pause 1-2 seconds at end-exhale; verify scalenes and jaw remain completely slack.'
    ],
    faultWarning: 'Avoid deep vertical chest heaving—apical breathing recruits scalenes & SCM, increasing C4-C7 shear.',
    cadenceLabel: '4s Nasal Inhale • 6s Slow Exhale'
  },
  {
    id: 'suboccipital-nod',
    step: 2,
    name: 'Suboccipital Nod & Deep Neck Flexor Activation',
    durationSeconds: 90,
    targetFocus: 'Gentle Chin Nods Without SCM Dominance',
    summary: 'Decompress the suboccipital triangle (greater/lesser occipital nerves) and awaken longus capitis/colli.',
    cues: [
      'Rest the back of your head on a folded towel; gaze softly downward a few degrees as if reading a book on your lap.',
      'Perform a micro "yes" nod at the C0-C1 atlanto-occipital joint (15-20% effort)—sliding the back of the skull gently long.',
      'Place two fingers lightly over superficial SCM muscles on the front-sides of the neck to confirm they stay soft and quiet.',
      'Hold each gentle nod for 8 seconds, release fully for 4 seconds, and repeat smoothly.'
    ],
    faultWarning: 'Never jam the chin aggressively into the throat or lift the head off the surface—that triggers superficial SCM spasm.',
    cadenceLabel: '8s Micro-Nod Hold • 4s Complete Release'
  },
  {
    id: 'thoracic-extension-rotation',
    step: 3,
    name: 'Thoracic Extension & Rotation',
    durationSeconds: 90,
    targetFocus: 'Offload Adjacent C4-C5 & C7-T1 Segments',
    summary: 'Restore mid-thoracic (T2-T8) extension and axial rotation so adjacent cervical fusion segments do not hyper-compensate.',
    cues: [
      'From quadruped (hands & knees) or side-lying open-book position, keep the cervical spine aligned effortlessly with the sternum.',
      'Exhale as you rotate the mid-back ribcage open, leading with the thoracic spine rather than cranking the shoulder behind your body.',
      'Switch sides at the 45-second mark, adding 3-4 gentle mid-thoracic extensions over a chair back or foam roller if comfortable.',
      'Keep the top hand on your ribcage or forehead (elbow forward of shoulder line) to protect the anterior labrum.'
    ],
    faultWarning: 'Do not fling the outstretched arm behind torso plane—rotate from the ribs to spare the anterior glenohumeral labrum.',
    cadenceLabel: '45s Left Thoracic Arc • 45s Right Thoracic Arc'
  },
  {
    id: 'cuff-centration-wall-slide',
    step: 4,
    name: 'Rotator Cuff Co-Contraction & Serratus Wall Slide',
    durationSeconds: 90,
    targetFocus: 'Glenohumeral Centration & Upward Scapular Rotation',
    summary: 'Seat the humeral head dynamically while recruiting serratus anterior and lower trapezius to silence rhomboid/levator guarding.',
    cues: [
      'Stand facing a wall with forearms parallel on the wall (optionally light mini-band around wrists or foam roller under forearms).',
      'Gently press forearms into the wall ("protract / wrap shoulder blades forward around the ribs") without rounding the neck.',
      'Slide forearms smoothly upward 20-35° within a 100% pain-free scaption arc, feeling the bottom tip of the scapula glide forward-upward.',
      'Pause 2 seconds at the top with soft upper traps, then control the return slowly.'
    ],
    faultWarning: 'Stop height immediately if shoulders shrug toward ears or if anterior/superior cuff pinching appears.',
    cadenceLabel: '3s Upward Glide • 2s Hold • 3s Controlled Lower'
  }
]);

/**
 * Cross Gates Athletic Club — Curated Clinical Exercise Library
 */
export const CROSS_GATES_LIBRARY = Object.freeze([
  // PREP
  {
    id: 'cable-er-iso',
    name: 'Cable ER Isometrics (Towel Roll Under Elbow)',
    category: 'prep',
    categoryLabel: 'Prep • Cuff Centration',
    equipment: 'Cross Gates Dual-Adjustable Cable Column + Rolled Gym Towel',
    defaultSets: 3,
    defaultReps: '5 x 8s iso',
    defaultLoad: 10,
    defaultRpe: 6,
    yellowPriority: true,
    isPrep: true,
    clinicalCue:
      'Tuck a rolled towel between elbow and ribs (~20° abduction) to preserve supraspinatus vascularity and centrate the humeral head without labral shear.',
    yellowNote: 'Hold submaximal 30-40% isometric tension; zero shoulder elevation.'
  },
  {
    id: 'serratus-wall-slides',
    name: 'Serratus Wall Slides',
    category: 'prep',
    categoryLabel: 'Prep • Scapular Upward Rotation',
    equipment: 'Turf Wall + Foam Roller / Mini-Band',
    defaultSets: 3,
    defaultReps: '10',
    defaultLoad: 0,
    defaultRpe: 6,
    yellowPriority: true,
    isPrep: true,
    clinicalCue:
      'Maintain gentle forearm protraction into roller while gliding upward in scaption; reciprocally inhibits rhomboid and levator downward-rotation guarding.',
    yellowNote: 'Shorten overhead excursion by 20% and emphasize slow protraction control.'
  },
  {
    id: 'incline-prone-y',
    name: 'Incline Prone Y-Raises',
    category: 'prep',
    categoryLabel: 'Prep • Lower Trapezius',
    equipment: '45–60° Incline Bench (Bodyweight or 2.5–5 lb DBs)',
    defaultSets: 3,
    defaultReps: '12',
    defaultLoad: 3,
    defaultRpe: 6.5,
    yellowPriority: true,
    isPrep: true,
    clinicalCue:
      'Chest supported on high incline bench, forehead neutral, thumbs angled up at 130° scaption—initiates with scapular depression/posterior tilt via lower trap.',
    yellowNote: 'Use bodyweight arms-only (0 lb) with 3-second isometric holds.'
  },

  // PULLS (SCAPULAR CONTROL)
  {
    id: 'chest-supported-row',
    name: 'Chest-Supported Machine Row',
    category: 'pulls',
    categoryLabel: 'Pulls • Scapular Control',
    equipment: 'Cross Gates Plate-Loaded / Selectorized Chest-Supported Row',
    defaultSets: 3,
    defaultReps: '10-12',
    defaultLoad: 70,
    defaultRpe: 7.5,
    yellowPriority: true,
    isPrep: false,
    clinicalCue:
      'Sternum stays glued to pad (eliminating axial/cervical stabilization demand). Stop elbows right at the torso plane—never pull past ribs to protect anterior labrum.',
    yellowNote: 'Reduce load 25%, use neutral grip, and pause 1s at torso line without pinching upper traps.'
  },
  {
    id: 'dual-cable-high-low-row',
    name: 'Dual-Cable High-to-Low Row',
    category: 'pulls',
    categoryLabel: 'Pulls • Lower-Trap / Lat Bias',
    equipment: 'Dual-Adjustable Cable Column (High Pulleys, Independent Handles)',
    defaultSets: 3,
    defaultReps: '12',
    defaultLoad: 45,
    defaultRpe: 7.5,
    yellowPriority: true,
    isPrep: false,
    clinicalCue:
      'Set pulleys ~35-45° above shoulder line, half-kneeling or tall-seated. Drive elbows down toward front pockets—aligns pull line with lower trapezius & lats instead of levator scapulae.',
    yellowNote: 'Reduce load 20-30% and exhale fully on each concentric pull to keep scalenes relaxed.'
  },

  // PRESSES (LABRUM & NECK SAFE)
  {
    id: 'half-kneeling-landmine-press',
    name: 'Half-Kneeling Landmine Press',
    category: 'presses',
    categoryLabel: 'Presses • Labrum & Neck Safe',
    equipment: 'Landmine Pivot + Olympic Bar',
    defaultSets: 3,
    defaultReps: '10 / side',
    defaultLoad: 55,
    defaultRpe: 7.5,
    yellowPriority: true,
    isPrep: false,
    clinicalCue:
      'Angled ~55-65° upward arc allows upward scapular rotation and serratus protraction finish at lockout without true 180° subacromial impingement or C4-C7 extension.',
    yellowNote: 'Reduce added plate load 25% and control eccentric lowering stopping elbow slightly in front of ribs.'
  },
  {
    id: 'dual-cable-incline-press',
    name: 'Dual-Cable Incline/Chest Press',
    category: 'presses',
    categoryLabel: 'Presses • Converging Scaption Arc',
    equipment: 'Dual-Adjustable Cable Column + 30° Incline Bench',
    defaultSets: 3,
    defaultReps: '10-12',
    defaultLoad: 35,
    defaultRpe: 7.5,
    yellowPriority: true,
    isPrep: false,
    clinicalCue:
      'Independent cables let shoulders move in natural ~35-45° scaption. Hard ROM stop: keep elbows 1-2 inches in front of bench pad at bottom to eliminate anterior labral shear.',
    yellowNote: 'Reduce stack weight 20-30% and use smooth 3-1-2 tempo with head resting softly on pad.'
  },

  // LEGS & CONDITIONING (ZERO AXIAL LOAD)
  {
    id: 'sled-push-backward-drag',
    name: 'Sled Push / Backward Drag',
    category: 'legs',
    categoryLabel: 'Legs & Conditioning • Zero Axial Load',
    equipment: 'Cross Gates Indoor Turf Sled + Strap',
    defaultSets: 4,
    defaultReps: '40 yds',
    defaultLoad: 135,
    defaultRpe: 8,
    yellowPriority: true,
    isPrep: false,
    clinicalCue:
      'Concentric-dominant quad & glute drive with zero compressive load across C5-C7 fusion and zero eccentric labral shear. Keep neck aligned with torso on pushes and arms relaxed on backward strap drags.',
    yellowNote: 'Prioritize smooth backward sled drags with strap at waist or relaxed straight arms (zero upper-trap shrug).'
  },
  {
    id: 'db-goblet-squat',
    name: 'DB Goblet Squat',
    category: 'legs',
    categoryLabel: 'Legs & Conditioning • Zero Axial Load',
    equipment: 'Single Dumbbell + Optional Heel Wedge',
    defaultSets: 3,
    defaultReps: '10-12',
    defaultLoad: 50,
    defaultRpe: 7.5,
    yellowPriority: false,
    isPrep: false,
    clinicalCue:
      'Anterior goblet hold recruits serratus anterior & anterior core reflexively while completely avoiding C7/upper-trapezius barbell compression.',
    yellowNote: 'Reduce DB weight 25% so upper trapezius and biceps/anterior labrum do not fatigue holding the bell.'
  },
  {
    id: 'recumbent-bike-hiit',
    name: 'Recumbent Bike HIIT',
    category: 'legs',
    categoryLabel: 'Conditioning • Spine Supported',
    equipment: 'Cross Gates Recumbent Cycle',
    defaultSets: 6,
    defaultReps: '30s on / 60s easy',
    defaultLoad: 12,
    defaultRpe: 8,
    yellowPriority: true,
    isPrep: false,
    clinicalCue:
      'Backrest unloads cervical-thoracic musculature during high cardiovascular output. Rest hands open on side grips—never white-knuckle pull during sprints.',
    yellowNote: 'Convert HIIT sprints to steady Zone 2 aerobic cadence (RPE 5-6) with nasal-dominant breathing.'
  },
  {
    id: 'incline-treadmill',
    name: 'Incline Treadmill',
    category: 'legs',
    categoryLabel: 'Conditioning • Decompression Gait',
    equipment: 'Cross Gates Incline Treadmill (6–10% Grade)',
    defaultSets: 1,
    defaultReps: '20-30 min',
    defaultLoad: 0,
    defaultRpe: 6,
    yellowPriority: true,
    isPrep: false,
    clinicalCue:
      'Hands completely off handrails! Natural contralateral arm swing gently mobilizes thoracic segments and pumps cervical fascia while building daily step volume.',
    yellowNote: 'Set 4-6% moderate incline at 3.0-3.4 mph; keep gaze level on horizon (not down at phone).'
  }
]);

/**
 * Blacklist Guardrail — Contraindicated High-Risk Movements
 */
export const BLACKLIST_MOVEMENTS = Object.freeze([
  {
    id: 'barbell-back-squat',
    name: 'Barbell Back Squat',
    matchKeywords: ['back squat', 'barbell squat', 'high bar squat', 'low bar squat'],
    riskTag: 'C7 COMPRESSION + LABRAL PEEL-BACK',
    clinicalWarning:
      'Direct axial load over C7/T1 adjacent to the C5-C7 fusion combined with forced shoulder abduction + external rotation (the exact peel-back mechanism for superior/anterior labral tears) triggers severe upper-trapezius and occipital neuralgia flares.',
    safeSwapId: 'sled-push-backward-drag',
    safeSwapName: 'Sled Push / Backward Drag (or DB Goblet Squat)'
  },
  {
    id: 'overhead-press',
    name: 'Overhead Press',
    matchKeywords: [
      'overhead press',
      'military press',
      'shoulder press',
      'strict press',
      'push press',
      'arnold press',
      'behind the neck'
    ],
    riskTag: 'SUBACROMIAL IMPINGEMENT + C4-C5 EXTENSION SHEAR',
    clinicalWarning:
      'Vertical 180° overhead loading compresses partial rotator cuff tears in the subacromial space, stresses unrepaired labral tissue, and induces compensatory C4-C5 cervical extension.',
    safeSwapId: 'half-kneeling-landmine-press',
    safeSwapName: 'Half-Kneeling Landmine Press'
  },
  {
    id: 'upright-rows',
    name: 'Upright Rows',
    matchKeywords: ['upright row', 'barbell upright', 'cable upright', 'db upright'],
    riskTag: 'INTERNAL ROTATION IMPINGEMENT + LEVATOR HYPER-TONE',
    clinicalWarning:
      'Elevating the humerus under loaded internal rotation mechanically impinges the supraspinatus tendon while aggressively recruiting levator scapulae and upper trapezius—directly provoking "tight hat" scalp pressure.',
    safeSwapId: 'incline-prone-y',
    safeSwapName: 'Incline Prone Y-Raises'
  },
  {
    id: 'heavy-shrugs',
    name: 'Heavy Shrugs',
    matchKeywords: ['shrug', 'heavy shrug', 'barbell shrug', 'dumbbell shrug', 'trap bar shrug'],
    riskTag: 'OCCIPITAL NERVE TRACTION HAZARD',
    clinicalWarning:
      'Supramaximal upper-trapezius and levator scapulae loading directly tractions C1-C4 transverse processes and cranial fascia, compressing occipital nerves and worsening scapular downward-rotation guarding.',
    safeSwapId: 'dual-cable-high-low-row',
    safeSwapName: 'Dual-Cable High-to-Low Row'
  }
]);

/**
 * Checks whether a user-entered or selected exercise name hits a Blacklist Guardrail.
 * @param {string} rawName
 * @returns {Object|null}
 */
export function detectBlacklistedMovement(rawName = '') {
  const normalized = String(rawName).trim().toLowerCase();
  if (!normalized) return null;

  for (const item of BLACKLIST_MOVEMENTS) {
    if (normalized === item.name.toLowerCase()) {
      return item;
    }
    if (item.matchKeywords.some((kw) => normalized.includes(kw))) {
      return item;
    }
  }
  return null;
}

/**
 * Looks up a Cross Gates library exercise by ID.
 * @param {string} id
 */
export function getExerciseById(id) {
  return CROSS_GATES_LIBRARY.find((ex) => ex.id === id) || null;
}

/**
 * Computes consecutive streaks for Steps, Journaling, and Tier 1 Daily Anchor,
 * seamlessly combining multi-year baseline counts from Settings with IndexedDB history.
 *
 * Baseline Connection Rule:
 * - Walks backward from `todayStr` (if completed today) or `yesterdayStr` (if pending today)
 *   to count consecutive logged days (`appStreak`).
 * - Connects the user's pre-app `baseline` when either:
 *   a) No days have been logged yet for that habit (Day 1 onboarding -> displays `baseline`, pending today), OR
 *   b) The consecutive chain reaches uninterrupted back to the user's earliest completed check-in date
 *      (or `baselineSetDate`), meaning no logged day was missed since starting in-app tracking.
 *
 * @param {Array<Object>} checkins - Array of daily_checkins records
 * @param {Object} baselines - { steps: number, journal: number, anchor: number, baselineSetDate?: string }
 * @param {string} todayStr - Local YYYY-MM-DD
 */
export function computeHabitStreaks(checkins = [], baselines = {}, todayStr) {
  const mapByDate = new Map();
  for (const rec of checkins) {
    if (rec && rec.date) {
      mapByDate.set(rec.date, rec);
    }
  }

  const sortedDates = Array.from(mapByDate.keys()).sort();

  const evaluateSingleHabit = (fieldKey, baselineCount = 0) => {
    const cleanBaseline = Math.max(0, Math.floor(Number(baselineCount) || 0));
    const todayRec = mapByDate.get(todayStr);
    const completedToday = Boolean(todayRec && todayRec[fieldKey]);

    const completedDates = sortedDates.filter((d) => d <= todayStr && Boolean(mapByDate.get(d)?.[fieldKey]));
    const earliestCompletedDate = completedDates.length > 0 ? completedDates[0] : null;

    const yesterdayStr = shiftDateString(todayStr, -1);
    const completedYesterday = Boolean(mapByDate.get(yesterdayStr)?.[fieldKey]);

    // Walk backward counting uninterrupted days
    let appStreak = 0;
    let cursor = completedToday ? todayStr : yesterdayStr;

    if (completedToday || completedYesterday) {
      while (Boolean(mapByDate.get(cursor)?.[fieldKey])) {
        appStreak += 1;
        cursor = shiftDateString(cursor, -1);
      }
    }

    const chainStartDate = appStreak > 0 ? shiftDateString(cursor, 1) : null;

    // Determine whether pre-app baseline connects seamlessly
    let includeBaseline = false;
    if (!earliestCompletedDate) {
      // Fresh app install / Day 1 before first check-off: show configured multi-year baseline
      includeBaseline = true;
    } else if (appStreak > 0 && chainStartDate === earliestCompletedDate) {
      // Unbroken streak since first tracked day in the app
      includeBaseline = true;
    } else if (
      baselines.baselineSetDate &&
      appStreak > 0 &&
      chainStartDate <= baselines.baselineSetDate
    ) {
      includeBaseline = true;
    }

    const totalStreak = (includeBaseline ? cleanBaseline : 0) + appStreak;

    return {
      totalStreak,
      appStreak,
      baseline: cleanBaseline,
      baselineConnected: includeBaseline,
      completedToday,
      pendingToday: !completedToday && (totalStreak > 0 || cleanBaseline > 0),
      milestoneBadge: getStreakMilestoneBadge(totalStreak)
    };
  };

  return {
    steps: evaluateSingleHabit('stepsCompleted', baselines.steps),
    journal: evaluateSingleHabit('journalCompleted', baselines.journal),
    anchor: evaluateSingleHabit('anchorCompleted', baselines.anchor)
  };
}

function getStreakMilestoneBadge(days) {
  if (days >= 1095) return `${(days / 365).toFixed(1)} YR IRON STREAK`;
  if (days >= 365) return '1+ YR STREAK';
  if (days >= 90) return '90+ DAY STREAK';
  if (days >= 30) return '30+ DAY STREAK';
  if (days >= 7) return '7+ DAY STREAK';
  if (days >= 1) return 'ACTIVE STREAK';
  return 'START TODAY';
}

export function formatDurationCountdown(ms) {
  const clamped = Math.max(0, Math.floor(ms / 1000));
  const hrs = Math.floor(clamped / 3600);
  const mins = Math.floor((clamped % 3600) / 60);
  const secs = clamped % 60;
  return [hrs, mins, secs].map((v) => String(v).padStart(2, '0')).join(':');
}

export function formatDurationShort(ms) {
  const totalMins = Math.max(1, Math.round(ms / 60000));
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hrs === 0) return `${mins}m`;
  return mins === 0 ? `${hrs}h` : `${hrs}h ${mins}m`;
}

function shiftDateString(dateStr, deltaDays) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + deltaDays);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function clampNumber(val, min, max) {
  const num = Number(val);
  if (Number.isNaN(num)) return min;
  return Math.min(max, Math.max(min, num));
}
