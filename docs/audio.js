'use strict';
(function (root) {
  const AR = root.AR = root.AR || {};
  const MAX_VOICES = 28;
  const ENGINE_VOLUME = 0.038;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  class Audio {
    constructor() {
      this.context = null;
      this.master = null;
      this.engine = null;
      this.engineGain = null;
      this.muted = false;
      this.unlocked = false;
      this.voices = new Set();
      this.heartbeatTime = 0;
      this.bubbleTime = 0;
      this.noiseBuffer = null;
    }

    unlock() {
      // Only called from the game's pointer/keyboard gesture handlers.
      const Context = root.AudioContext || root.webkitAudioContext;
      if (!Context) return;
      try {
        if (!this.context) {
          this.context = new Context();
          this.master = this.context.createGain();
          this.master.gain.value = this.muted ? 0 : 0.48;
          this.master.connect(this.context.destination);
          this.engineGain = this.context.createGain();
          this.engineGain.gain.value = 0;
          const lowpass = this.context.createBiquadFilter();
          lowpass.type = 'lowpass';
          lowpass.frequency.value = 300;
          this.engine = this.context.createOscillator();
          this.engine.type = 'sawtooth';
          this.engine.frequency.value = 43;
          this.engine.connect(lowpass);
          lowpass.connect(this.engineGain);
          this.engineGain.connect(this.master);
          this.engine.start();
          const length = this.context.sampleRate * 0.3;
          this.noiseBuffer = this.context.createBuffer(1, length, this.context.sampleRate);
          const noise = this.noiseBuffer.getChannelData(0);
          for (let i = 0; i < noise.length; i++) noise[i] = (Math.random() * 2 - 1) * (1 - i / noise.length);
        }
        this.unlocked = true;
        // Safari may report an interrupted context after backgrounding or an audio interruption.
        if (this.context.state !== 'running' && this.context.state !== 'closed') {
          const resume = this.context.resume();
          if (resume && resume.catch) resume.catch(() => {});
        }
      } catch (_) { this.unlocked = false; }
    }

    setMuted(muted) {
      this.muted = Boolean(muted);
      if (this.master && this.context) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.48, this.context.currentTime, 0.025);
    }

    tone(frequency, duration, volume, type = 'sine', delay = 0, endFrequency = frequency) {
      if (!this.unlocked || this.muted || !this.context || this.context.state !== 'running' || this.voices.size >= MAX_VOICES) return;
      const start = this.context.currentTime + delay;
      const oscillator = this.context.createOscillator();
      const envelope = this.context.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(Math.max(15, frequency), start);
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(15, endFrequency), start + duration);
      envelope.gain.setValueAtTime(0.0001, start);
      envelope.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), start + Math.min(0.012, duration * 0.2));
      envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(envelope);
      envelope.connect(this.master);
      this.voices.add(oscillator);
      oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); this.voices.delete(oscillator); };
      oscillator.start(start);
      oscillator.stop(start + duration + 0.015);
    }

    noise(duration, volume, cutoff) {
      if (!this.unlocked || this.muted || !this.context || this.context.state !== 'running' || this.voices.size >= MAX_VOICES) return;
      const source = this.context.createBufferSource();
      const filter = this.context.createBiquadFilter();
      const envelope = this.context.createGain();
      const now = this.context.currentTime;
      source.buffer = this.noiseBuffer;
      filter.type = 'lowpass';
      filter.frequency.value = cutoff;
      envelope.gain.setValueAtTime(volume, now);
      envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      source.connect(filter);
      filter.connect(envelope);
      envelope.connect(this.master);
      this.voices.add(source);
      source.onended = () => { source.disconnect(); filter.disconnect(); envelope.disconnect(); this.voices.delete(source); };
      source.start(now);
      source.stop(now + duration);
    }

    play(name) {
      if (!this.unlocked || this.muted) return;
      switch (name) {
        case 'click': this.tone(620, 0.055, 0.07, 'sine', 0, 380); break;
        case 'pickup': this.tone(980, 0.12, 0.08, 'sine', 0, 1450); break;
        case 'gold':
          [660, 880, 1320, 1760].forEach((frequency, i) => this.tone(frequency, 0.23, 0.08, 'sine', i * 0.06));
          break;
        case 'oxygen':
          this.tone(270, 0.22, 0.11, 'sine', 0, 810);
          this.tone(810, 0.2, 0.07, 'sine', 0.12, 1080);
          break;
        case 'chest':
          this.noise(0.09, 0.12, 700);
          [523, 659, 784, 1046].forEach((frequency, i) => this.tone(frequency, 0.27, 0.09, 'triangle', i * 0.08));
          break;
        case 'burst': this.noise(0.28, 0.25, 900); this.tone(75, 0.3, 0.14, 'sine', 0, 230); break;
        case 'crash': this.noise(0.3, 0.38, 340); this.tone(100, 0.36, 0.25, 'sine', 0, 26); break;
        case 'trick': [392, 523, 784].forEach((frequency, i) => this.tone(frequency, 0.2, 0.085, 'triangle', i * 0.065)); break;
        case 'level': [523, 659, 784, 1046, 1318].forEach((frequency, i) => this.tone(frequency, 0.3, 0.09, 'triangle', i * 0.09)); break;
        case 'bubble': this.tone(220 + Math.random() * 160, 0.085, 0.028, 'sine', 0, 680 + Math.random() * 260); break;
        case 'heartbeat': this.tone(64, 0.12, 0.14); this.tone(51, 0.15, 0.1, 'sine', 0.19); break;
        default: break;
      }
    }

    update(state, dt) {
      if (!this.context || !this.engine || !this.unlocked) return;
      const running = Boolean(state && state.running);
      const throttle = Boolean(state && state.throttle);
      const speed = clamp(Math.abs(Number.isFinite(state && state.speed) ? state.speed : 0), 0, 2000);
      const now = this.context.currentTime;
      this.engine.frequency.setTargetAtTime(39 + Math.min(180, speed * 0.28) + (throttle ? 24 : 0), now, 0.1);
      this.engineGain.gain.setTargetAtTime(running ? ENGINE_VOLUME * (throttle ? 1 : 0.35) : 0, now, 0.06);
      if (!running || this.muted) { this.heartbeatTime = 0; this.bubbleTime = 0; return; }
      const delta = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
      this.bubbleTime -= delta;
      if (throttle && this.bubbleTime <= 0) { this.play('bubble'); this.bubbleTime = 0.19 + Math.random() * 0.2; }
      this.heartbeatTime -= delta;
      const oxygen = Number.isFinite(state.oxygenFraction) ? state.oxygenFraction : 1;
      if (oxygen < 0.25 && this.heartbeatTime <= 0) {
        this.play('heartbeat');
        this.heartbeatTime = 0.57 + Math.max(0, oxygen) * 1.5;
      }
    }

    suspend() {
      if (!this.context) return;
      if (this.engineGain) {
        this.engineGain.gain.cancelScheduledValues(this.context.currentTime);
        this.engineGain.gain.setTargetAtTime(0, this.context.currentTime, 0.02);
      }
      for (const source of this.voices) {
        try { source.stop(); } catch (_) { /* An ended voice is already disconnected. */ }
      }
      this.heartbeatTime = 0;
      this.bubbleTime = 0;
    }
  }

  AR.Audio = Audio;
})(typeof globalThis !== 'undefined' ? globalThis : this);
