/**
 * Apex Autoreg PT — Native Web Audio API Sound Generator
 * Zero external MP3 files needed; 100% offline audio synthesis.
 * Provides harmonic upward/downward breathing tones, meditation transition bells,
 * and volume/mute controls with mobile audio unlocking.
 */

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.soundEnabled = true;
    this.volume = 0.7; // 0.0 to 1.0
    this.activeNodes = [];
    this.isUnlocked = false;
  }

  /**
   * Initializes AudioContext on first user interaction to comply with iOS/Safari policies.
   */
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return;
    }

    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;

      this.ctx = new AudioContextClass();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.soundEnabled ? this.volume : 0, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);
      this.isUnlocked = true;
    } catch (e) {
      console.warn('Web Audio initialization error:', e);
    }
  }

  setSoundEnabled(enabled) {
    this.soundEnabled = Boolean(enabled);
    if (!this.masterGain || !this.ctx) return;
    const now = this.ctx.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setValueAtTime(this.soundEnabled ? this.volume : 0, now);
    if (!this.soundEnabled) {
      this.stopActiveTones();
    }
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(1, Number(vol) || 0.7));
    if (!this.masterGain || !this.ctx) return;
    const now = this.ctx.currentTime;
    if (this.soundEnabled) {
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setValueAtTime(this.volume, now);
    }
  }

  stopActiveTones() {
    this.activeNodes.forEach(({ osc, gain, stopTime }) => {
      try {
        if (this.ctx && gain) {
          gain.gain.cancelScheduledValues(this.ctx.currentTime);
          gain.gain.setValueAtTime(gain.gain.value, this.ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.05);
        }
        setTimeout(() => {
          try { osc.stop(); } catch {}
        }, 60);
      } catch {}
    });
    this.activeNodes = [];
  }

  /**
   * INHALE TONE:
   * Soft, upward-sweeping harmonic frequency ramping from 220 Hz (A3) to 330 Hz (E4)
   * over the inhale duration (4.0s) with smooth sinusoidal envelope.
   */
  playInhaleTone(durationSec = 4.0) {
    if (!this.soundEnabled) return;
    this.init();
    if (!this.ctx) return;

    this.stopActiveTones();
    const now = this.ctx.currentTime;

    // Primary gentle sine wave
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    // Warm harmonic overtone (octave higher at soft volume)
    const overtone = this.ctx.createOscillator();
    const overGain = this.ctx.createGain();

    osc.type = 'sine';
    overtone.type = 'sine';

    // Upward sweep from 220Hz (A3) to 330Hz (E4)
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(330, now + durationSec);

    overtone.frequency.setValueAtTime(440, now);
    overtone.frequency.exponentialRampToValueAtTime(660, now + durationSec);

    // Smooth envelope: 0.4s fade-in, steady flow, 0.4s gentle fade-out at top
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.22, now + 0.45);
    gain.gain.setValueAtTime(0.22, now + durationSec - 0.4);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);

    overGain.gain.setValueAtTime(0.0001, now);
    overGain.gain.exponentialRampToValueAtTime(0.05, now + 0.45);
    overGain.gain.setValueAtTime(0.05, now + durationSec - 0.4);
    overGain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);

    osc.connect(gain);
    overtone.connect(overGain);

    gain.connect(this.masterGain);
    overGain.connect(this.masterGain);

    osc.start(now);
    overtone.start(now);

    osc.stop(now + durationSec + 0.05);
    overtone.stop(now + durationSec + 0.05);

    const record = { osc, gain, stopTime: now + durationSec };
    this.activeNodes.push(record);
    setTimeout(() => {
      const idx = this.activeNodes.indexOf(record);
      if (idx !== -1) this.activeNodes.splice(idx, 1);
    }, (durationSec + 0.1) * 1000);
  }

  /**
   * HOLD TONE:
   * Warm, subtle sustained hum (261.63 Hz — Middle C) for top-of-breath stillness.
   */
  playHoldTone(durationSec = 0.5) {
    if (!this.soundEnabled) return;
    this.init();
    if (!this.ctx) return;

    this.stopActiveTones();
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(261.63, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.08);
    gain.gain.setValueAtTime(0.12, now + durationSec - 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + durationSec + 0.05);

    const record = { osc, gain, stopTime: now + durationSec };
    this.activeNodes.push(record);
    setTimeout(() => {
      const idx = this.activeNodes.indexOf(record);
      if (idx !== -1) this.activeNodes.splice(idx, 1);
    }, (durationSec + 0.1) * 1000);
  }

  /**
   * EXHALE TONE:
   * Relaxing, downward-sweeping frequency sliding from 330 Hz down to 196 Hz (G3)
   * with warm low-pass filtering, signaling complete neck and shoulder decompression.
   */
  playExhaleTone(durationSec = 6.0) {
    if (!this.soundEnabled) return;
    this.init();
    if (!this.ctx) return;

    this.stopActiveTones();
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    // Downward slide from 330Hz down to 196Hz
    osc.frequency.setValueAtTime(330, now);
    osc.frequency.exponentialRampToValueAtTime(196, now + durationSec);

    // Warm acoustic low-pass filter
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(650, now);
    filter.frequency.exponentialRampToValueAtTime(380, now + durationSec);

    // Envelope: slow soothing decay
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.24, now + 0.6);
    gain.gain.setValueAtTime(0.24, now + durationSec - 1.0);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + durationSec + 0.05);

    const record = { osc, gain, stopTime: now + durationSec };
    this.activeNodes.push(record);
    setTimeout(() => {
      const idx = this.activeNodes.indexOf(record);
      if (idx !== -1) this.activeNodes.splice(idx, 1);
    }, (durationSec + 0.1) * 1000);
  }

  /**
   * ROUND TRANSITION BELL:
   * Clear, resonant meditation bell (harmonic blend of 528 Hz and 1056 Hz with
   * natural acoustic exponential decay over 2.5 seconds) for exercise/stage switches.
   */
  playRoundBell() {
    if (!this.soundEnabled) return;
    this.init();
    if (!this.ctx) return;

    this.stopActiveTones();
    const now = this.ctx.currentTime;
    const decayDuration = 2.5;

    // Harmonic partials (Solfeggio 528 Hz fundamental + 1056 Hz octave + 1584 Hz shimmer)
    const frequencies = [
      { freq: 528, gainRatio: 0.35 },
      { freq: 1056, gainRatio: 0.16 },
      { freq: 1584, gainRatio: 0.06 }
    ];

    frequencies.forEach(({ freq, gainRatio }) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(gainRatio, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + decayDuration);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(now);
      osc.stop(now + decayDuration + 0.05);
    });
  }

  /**
   * Routine Completion Fanfare:
   * Gentle, uplifting major triad meditation chord (C5 - E5 - G5 - C6).
   */
  playRoutineCompleteChime() {
    if (!this.soundEnabled) return;
    this.init();
    if (!this.ctx) return;

    this.stopActiveTones();
    const now = this.ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6

    notes.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const startAt = now + idx * 0.18;
      const decayDuration = 2.8;

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startAt);

      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.22, startAt + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + decayDuration);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(startAt);
      osc.stop(startAt + decayDuration + 0.05);
    });
  }
}

export const audioEngine = new AudioEngine();
