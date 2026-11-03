/**
 * Apex Autoreg PT — Native Web Audio API Sound Generator
 * Zero external MP3 files needed; 100% offline audio synthesis.
 * Provides harmonic upward/downward breathing tones, meditation transition bells,
 * volume feedback blips, and resilient mobile/iOS Safari audio unlocking.
 */

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.soundEnabled = true;
    this.volume = 0.5; // Audible baseline (0.3 - 0.5)
    this.activeNodes = [];
    this.isUnlocked = false;
    this._visibilityListenerBound = false;
  }

  /**
   * Robust lazy initialization & resumption helper for iOS Safari and mobile PWAs.
   * iOS Safari starts AudioContext in a suspended/interrupted state and requires
   * an explicit resume() call directly within a user touch/click gesture.
   */
  async initOrResumeAudio() {
    if (!this.ctx) {
      const AudioContextClass =
        (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) || null;
      if (!AudioContextClass) return null;

      try {
        this.ctx = new AudioContextClass();
        this.masterGain = this.ctx.createGain();
        const initialVol = this.soundEnabled ? this.volume : 0;
        this.masterGain.gain.setValueAtTime(initialVol, this.ctx.currentTime);
        this.masterGain.connect(this.ctx.destination);

        // Handle interruptions when switching tabs, minimizing, or locking screen
        if (typeof document !== 'undefined' && !this._visibilityListenerBound) {
          this._visibilityListenerBound = true;
          document.addEventListener('visibilitychange', async () => {
            if (!document.hidden && this.ctx) {
              if (this.ctx.state === 'suspended' || this.ctx.state === 'interrupted') {
                try {
                  await this.ctx.resume();
                } catch (e) {
                  console.warn('AudioContext resume after visibilitychange failed:', e);
                }
              }
            }
          });
        }
      } catch (e) {
        console.warn('Web Audio instantiation error:', e);
        return null;
      }
    }

    // Explicit resume for suspended or interrupted states (with 500ms fallback so headless environments never hang)
    if (this.ctx.state === 'suspended' || this.ctx.state === 'interrupted') {
      try {
        await Promise.race([
          this.ctx.resume(),
          new Promise((resolve) => setTimeout(resolve, 500))
        ]);
      } catch (e) {
        console.warn('AudioContext resume error:', e);
      }
    }

    // Play a brief silent buffer on initial user interaction to satisfy iOS WebKit's autoplay gate
    if (!this.isUnlocked && this.ctx) {
      try {
        const buffer = this.ctx.createBuffer(1, 1, 22050);
        const source = this.ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(this.ctx.destination);
        source.start(0);
        this.isUnlocked = true;
      } catch (e) {
        console.warn('Audio unlock buffer playback error:', e);
      }
    }

    return this.ctx;
  }

  /**
   * Backwards-compatible init alias
   */
  async init() {
    return await this.initOrResumeAudio();
  }

  setSoundEnabled(enabled) {
    this.soundEnabled = Boolean(enabled);
    if (!this.masterGain || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setValueAtTime(this.soundEnabled ? this.volume : 0, now);
      if (!this.soundEnabled) {
        this.stopActiveTones();
      }
    } catch {}
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(1, Number(vol) ?? 0.5));
    if (!this.masterGain || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      if (this.soundEnabled) {
        this.masterGain.gain.cancelScheduledValues(now);
        this.masterGain.gain.setValueAtTime(this.volume, now);
      }
    } catch {}
  }

  stopActiveTones() {
    this.activeNodes.forEach(({ osc, gain }) => {
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
   * Tactile Volume Feedback Blip (440 Hz test tone):
   * Confirms sound output when dragging the volume slider.
   */
  async playFeedbackBlip(freq = 440, durationSec = 0.06) {
    if (!this.soundEnabled) return;
    await this.initOrResumeAudio();
    if (!this.ctx || !this.masterGain) return;

    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.2, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(now);
      osc.stop(now + durationSec + 0.02);
    } catch (e) {
      console.warn('Feedback blip error:', e);
    }
  }

  /**
   * INHALE TONE:
   * Soft, upward-sweeping harmonic frequency ramping from 220 Hz (A3) to 330 Hz (E4)
   * over the inhale duration (4.0s) with smooth sinusoidal envelope.
   */
  async playInhaleTone(durationSec = 4.0) {
    if (!this.soundEnabled) return;
    await this.initOrResumeAudio();
    if (!this.ctx || !this.masterGain) return;

    this.stopActiveTones();
    const now = this.ctx.currentTime;

    try {
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
      gain.gain.exponentialRampToValueAtTime(0.25, now + 0.45);
      gain.gain.setValueAtTime(0.25, now + durationSec - 0.4);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);

      overGain.gain.setValueAtTime(0.0001, now);
      overGain.gain.exponentialRampToValueAtTime(0.06, now + 0.45);
      overGain.gain.setValueAtTime(0.06, now + durationSec - 0.4);
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
    } catch (e) {
      console.warn('Inhale tone error:', e);
    }
  }

  /**
   * HOLD TONE:
   * Warm, subtle sustained hum (261.63 Hz — Middle C) for top-of-breath stillness.
   */
  async playHoldTone(durationSec = 0.5) {
    if (!this.soundEnabled) return;
    await this.initOrResumeAudio();
    if (!this.ctx || !this.masterGain) return;

    this.stopActiveTones();
    const now = this.ctx.currentTime;

    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(261.63, now);

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.15, now + 0.08);
      gain.gain.setValueAtTime(0.15, now + durationSec - 0.08);
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
    } catch (e) {
      console.warn('Hold tone error:', e);
    }
  }

  /**
   * EXHALE TONE:
   * Relaxing, downward-sweeping frequency sliding from 330 Hz down to 196 Hz (G3)
   * with warm low-pass filtering, signaling complete neck and shoulder decompression.
   */
  async playExhaleTone(durationSec = 6.0) {
    if (!this.soundEnabled) return;
    await this.initOrResumeAudio();
    if (!this.ctx || !this.masterGain) return;

    this.stopActiveTones();
    const now = this.ctx.currentTime;

    try {
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
      gain.gain.exponentialRampToValueAtTime(0.26, now + 0.6);
      gain.gain.setValueAtTime(0.26, now + durationSec - 1.0);
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
    } catch (e) {
      console.warn('Exhale tone error:', e);
    }
  }

  /**
   * ROUND TRANSITION BELL:
   * Clear, resonant meditation bell (harmonic blend of 528 Hz and 1056 Hz with
   * natural acoustic exponential decay over 2.5 seconds) for exercise/stage switches.
   */
  async playRoundBell() {
    if (!this.soundEnabled) return;
    await this.initOrResumeAudio();
    if (!this.ctx || !this.masterGain) return;

    this.stopActiveTones();
    const now = this.ctx.currentTime;
    const decayDuration = 2.5;

    // Harmonic partials (Solfeggio 528 Hz fundamental + 1056 Hz octave + 1584 Hz shimmer)
    const frequencies = [
      { freq: 528, gainRatio: 0.38 },
      { freq: 1056, gainRatio: 0.18 },
      { freq: 1584, gainRatio: 0.07 }
    ];

    try {
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
    } catch (e) {
      console.warn('Round bell error:', e);
    }
  }

  /**
   * Routine Completion Fanfare:
   * Gentle, uplifting major triad meditation chord (C5 - E5 - G5 - C6).
   */
  async playRoutineCompleteChime() {
    if (!this.soundEnabled) return;
    await this.initOrResumeAudio();
    if (!this.ctx || !this.masterGain) return;

    this.stopActiveTones();
    const now = this.ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6

    try {
      notes.forEach((freq, idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const startAt = now + idx * 0.18;
        const decayDuration = 2.8;

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, startAt);

        gain.gain.setValueAtTime(0.0001, startAt);
        gain.gain.exponentialRampToValueAtTime(0.24, startAt + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + decayDuration);

        osc.connect(gain);
        gain.connect(this.masterGain);

        osc.start(startAt);
        osc.stop(startAt + decayDuration + 0.05);
      });
    } catch (e) {
      console.warn('Routine complete chime error:', e);
    }
  }
}

export const audioEngine = new AudioEngine();

export async function initOrResumeAudio() {
  return await audioEngine.initOrResumeAudio();
}
