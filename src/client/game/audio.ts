// Procedural sound: no audio files to download. Everything is synthesized with WebAudio.
// The context starts suspended until the first user gesture (browser autoplay rules).

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let muted = false;

function ac() {
  if (!ctx) {
    try {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.8;
      master.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch {
      ctx = null;
    }
  }
  return ctx;
}

export function unlockAudio() {
  const c = ac();
  if (c && c.state === 'suspended') void c.resume();
}

export function setMuted(m: boolean) {
  muted = m;
  if (master && ctx) master.gain.setTargetAtTime(m ? 0 : 0.8, ctx.currentTime, 0.05);
}

export function isMuted() {
  return muted;
}

function out() {
  return master!;
}

function noise(dur: number, filterType: BiquadFilterType, freq: number, q = 1) {
  const c = ac();
  if (!c || !noiseBuf) return null;
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = dur > 2;
  const f = c.createBiquadFilter();
  f.type = filterType;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  src.connect(f).connect(g).connect(out());
  return { src, f, g, c };
}

function env(g: GainNode, c: AudioContext, peak: number, attack: number, release: number, at = c.currentTime) {
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + attack + release);
}

function tone(type: OscillatorType, freq: number, peak: number, attack: number, release: number, at?: number) {
  const c = ac();
  if (!c) return null;
  const o = c.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  const g = c.createGain();
  o.connect(g).connect(out());
  const t = at ?? c.currentTime;
  env(g, c, peak, attack, release, t);
  o.start(t);
  o.stop(t + attack + release + 0.05);
  return { o, g, c };
}

export function sfxPickup() {
  const t = tone('triangle', 660, 0.18, 0.01, 0.12);
  if (t) t.o.frequency.exponentialRampToValueAtTime(990, t.c.currentTime + 0.1);
}

export function sfxCraft() {
  const c = ac();
  if (!c) return;
  [520, 660, 880].forEach((f, i) => tone('triangle', f, 0.15, 0.01, 0.15, c.currentTime + i * 0.07));
}

export function sfxDrink() {
  const n = noise(0.4, 'bandpass', 900, 4);
  if (!n) return;
  env(n.g, n.c, 0.25, 0.02, 0.3);
  n.f.frequency.exponentialRampToValueAtTime(400, n.c.currentTime + 0.3);
  n.src.start();
  n.src.stop(n.c.currentTime + 0.4);
}

export function sfxSwing() {
  const n = noise(0.25, 'bandpass', 1800, 2);
  if (!n) return;
  env(n.g, n.c, 0.3, 0.02, 0.18);
  n.f.frequency.exponentialRampToValueAtTime(500, n.c.currentTime + 0.2);
  n.src.start();
  n.src.stop(n.c.currentTime + 0.25);
}

export function sfxHit() {
  const t = tone('sine', 140, 0.6, 0.005, 0.25);
  if (t) t.o.frequency.exponentialRampToValueAtTime(50, t.c.currentTime + 0.2);
  const n = noise(0.2, 'lowpass', 1200);
  if (n) {
    env(n.g, n.c, 0.4, 0.005, 0.15);
    n.src.start();
    n.src.stop(n.c.currentTime + 0.2);
  }
}

export function sfxHurt() {
  sfxHit();
  const t = tone('sawtooth', 220, 0.12, 0.01, 0.3);
  if (t) t.o.frequency.exponentialRampToValueAtTime(110, t.c.currentTime + 0.3);
}

export function sfxGrowl(intensity = 1) {
  const c = ac();
  if (!c) return;
  const o = c.createOscillator();
  o.type = 'sawtooth';
  o.frequency.value = 62;
  const lfo = c.createOscillator();
  lfo.frequency.value = 18;
  const lfoG = c.createGain();
  lfoG.gain.value = 14;
  lfo.connect(lfoG).connect(o.frequency);
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 380;
  const g = c.createGain();
  o.connect(f).connect(g).connect(out());
  const dur = 1.1 + Math.random() * 0.5;
  env(g, c, 0.22 * intensity, 0.25, dur);
  o.start();
  lfo.start();
  o.stop(c.currentTime + dur + 0.4);
  lfo.stop(c.currentTime + dur + 0.4);
}

export function sfxRoar() {
  const c = ac();
  if (!c) return;
  const o = c.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(110, c.currentTime);
  o.frequency.linearRampToValueAtTime(170, c.currentTime + 0.3);
  o.frequency.exponentialRampToValueAtTime(70, c.currentTime + 1.1);
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 900;
  const g = c.createGain();
  o.connect(f).connect(g).connect(out());
  env(g, c, 0.4, 0.06, 1.0);
  o.start();
  o.stop(c.currentTime + 1.2);
  const n = noise(1.2, 'bandpass', 600, 0.7);
  if (n) {
    env(n.g, n.c, 0.35, 0.05, 1.0);
    n.src.start();
    n.src.stop(n.c.currentTime + 1.2);
  }
}

export function sfxImpact() {
  const t = tone('sine', 90, 0.9, 0.005, 1.4);
  if (t) t.o.frequency.exponentialRampToValueAtTime(30, t.c.currentTime + 1.2);
  const n = noise(2, 'lowpass', 2500);
  if (n) {
    env(n.g, n.c, 0.8, 0.005, 1.6);
    n.f.frequency.exponentialRampToValueAtTime(200, n.c.currentTime + 1.5);
    n.src.start();
    n.src.stop(n.c.currentTime + 1.8);
  }
}

export function sfxThud() {
  const t = tone('sine', 180, 0.5, 0.005, 0.2);
  if (t) t.o.frequency.exponentialRampToValueAtTime(60, t.c.currentTime + 0.18);
}

export function sfxThunder() {
  const n = noise(3, 'lowpass', 700);
  if (!n) return;
  env(n.g, n.c, 0.7, 0.03, 2.6);
  n.f.frequency.exponentialRampToValueAtTime(120, n.c.currentTime + 2.4);
  n.src.start();
  n.src.stop(n.c.currentTime + 3);
}

export function sfxRinging() {
  const t = tone('sine', 3400, 0.05, 0.3, 3.5);
  void t;
}

export function sfxWin() {
  const c = ac();
  if (!c) return;
  [392, 494, 587, 784].forEach((f, i) => tone('triangle', f, 0.18, 0.02, 0.5, c.currentTime + i * 0.14));
}

// --- looping layers -------------------------------------------------------

type Loop = { stop: () => void; set?: (v: number) => void };

export function startEngine(): Loop | null {
  const c = ac();
  if (!c) return null;
  const o = c.createOscillator();
  o.type = 'sawtooth';
  o.frequency.value = 58;
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 260;
  const g = c.createGain();
  g.gain.value = 0.0001;
  g.gain.exponentialRampToValueAtTime(0.16, c.currentTime + 0.8);
  o.connect(f).connect(g).connect(out());
  o.start();
  return {
    set: (v) => {
      // v: 1 healthy .. 0 dead engine
      o.frequency.setTargetAtTime(30 + v * 28 + (v < 1 ? Math.random() * 12 : 0), c.currentTime, 0.08);
      g.gain.setTargetAtTime(0.02 + v * 0.14, c.currentTime, 0.1);
    },
    stop: () => {
      g.gain.setTargetAtTime(0.0001, c.currentTime, 0.1);
      o.stop(c.currentTime + 0.5);
    },
  };
}

export function startWind(): Loop | null {
  const n = noise(10, 'bandpass', 500, 0.6);
  if (!n) return null;
  n.g.gain.value = 0.0001;
  n.g.gain.exponentialRampToValueAtTime(0.18, n.c.currentTime + 1);
  n.src.start();
  return {
    set: (v) => {
      n.g.gain.setTargetAtTime(0.05 + v * 0.3, n.c.currentTime, 0.2);
      n.f.frequency.setTargetAtTime(300 + v * 900, n.c.currentTime, 0.2);
    },
    stop: () => {
      n.g.gain.setTargetAtTime(0.0001, n.c.currentTime, 0.2);
      n.src.stop(n.c.currentTime + 1);
    },
  };
}

export function startAlarm(): Loop | null {
  const c = ac();
  if (!c) return null;
  let on = true;
  let i = 0;
  const beep = () => {
    if (!on) return;
    tone('square', i++ % 2 ? 880 : 660, 0.06, 0.01, 0.2);
    window.setTimeout(beep, 260);
  };
  beep();
  return { stop: () => (on = false) };
}

// Jungle bed: soft wind noise plus random insect/bird calls. Quieter at night, more crickets.
export function startJungle(nightLevel: () => number): Loop | null {
  const c = ac();
  if (!c) return null;
  const bed = noise(10, 'lowpass', 600, 0.5);
  if (bed) {
    bed.g.gain.value = 0.05;
    bed.src.start();
  }
  let on = true;
  const call = () => {
    if (!on) return;
    const night = nightLevel();
    if (!muted) {
      if (night > 0.5) {
        // cricket chirps
        const base = c.currentTime;
        for (let k = 0; k < 3; k++) tone('sine', 4200 + Math.random() * 300, 0.025, 0.005, 0.04, base + k * 0.06);
      } else {
        // bird: quick pitch sweep
        const t = tone('sine', 1800 + Math.random() * 1400, 0.04, 0.01, 0.12);
        if (t) t.o.frequency.exponentialRampToValueAtTime(1200 + Math.random() * 2600, t.c.currentTime + 0.12);
      }
    }
    window.setTimeout(call, 400 + Math.random() * (night > 0.5 ? 700 : 1800));
  };
  call();
  return {
    stop: () => {
      on = false;
      if (bed) {
        bed.g.gain.setTargetAtTime(0.0001, c.currentTime, 0.2);
        bed.src.stop(c.currentTime + 1);
      }
    },
  };
}

// Heartbeat that speeds up and gets louder with danger (0..1).
export function startHeartbeat(level: () => number): Loop | null {
  const c = ac();
  if (!c) return null;
  let on = true;
  const beat = () => {
    if (!on) return;
    const v = level();
    if (v > 0.05 && !muted) {
      tone('sine', 55, 0.25 + v * 0.45, 0.01, 0.12);
      tone('sine', 48, 0.18 + v * 0.35, 0.01, 0.14, c.currentTime + 0.16);
    }
    window.setTimeout(beat, 1050 - v * 550);
  };
  beat();
  return { stop: () => (on = false) };
}

export function sfxHiss() {
  const n = noise(0.9, 'highpass', 3800, 0.7);
  if (!n) return;
  env(n.g, n.c, 0.22, 0.05, 0.75);
  n.src.start();
  n.src.stop(n.c.currentTime + 0.9);
}

export function sfxSnort() {
  const n = noise(0.35, 'bandpass', 420, 3);
  if (n) {
    env(n.g, n.c, 0.4, 0.01, 0.25);
    n.src.start();
    n.src.stop(n.c.currentTime + 0.35);
  }
  const t = tone('square', 95, 0.08, 0.01, 0.18);
  if (t) t.o.frequency.exponentialRampToValueAtTime(70, t.c.currentTime + 0.15);
}

export function sfxSplash() {
  const n = noise(0.8, 'lowpass', 1600, 0.8);
  if (!n) return;
  env(n.g, n.c, 0.45, 0.01, 0.6);
  n.f.frequency.exponentialRampToValueAtTime(300, n.c.currentTime + 0.6);
  n.src.start();
  n.src.stop(n.c.currentTime + 0.8);
}

export function sfxSnap() {
  const t = tone('square', 320, 0.3, 0.002, 0.08);
  if (t) t.o.frequency.exponentialRampToValueAtTime(90, t.c.currentTime + 0.07);
  sfxThud();
}

// bow release: a plucked low string plus a short whoosh
export function sfxBow() {
  const t = tone('triangle', 196, 0.32, 0.004, 0.22);
  if (t) t.o.frequency.exponentialRampToValueAtTime(110, t.c.currentTime + 0.18);
  sfxSwing();
}

// flare launch: hissing rocket
export function sfxFlare() {
  const n = noise(1.4, 'highpass', 2400, 0.7);
  if (!n) return;
  env(n.g, n.c, 0.28, 0.03, 1.3);
  n.f.frequency.exponentialRampToValueAtTime(900, n.c.currentTime + 1.3);
  n.src.start();
  n.src.stop(n.c.currentTime + 1.45);
}

// helicopter: low noise chopped by a ~12 Hz rotor LFO; set(v) is proximity 0..1
export function startRotor(): Loop | null {
  const n = noise(30, 'lowpass', 420, 0.8);
  if (!n) return null;
  const c = n.c;
  n.g.gain.value = 0.0001;
  const lfo = c.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 12;
  const depth = c.createGain();
  depth.gain.value = 0;
  lfo.connect(depth).connect(n.g.gain);
  n.src.start();
  lfo.start();
  return {
    set: (v) => {
      n.g.gain.setTargetAtTime(0.02 + v * 0.24, c.currentTime, 0.3);
      depth.gain.setTargetAtTime(v * 0.2, c.currentTime, 0.3);
      n.f.frequency.setTargetAtTime(260 + v * 380, c.currentTime, 0.3);
    },
    stop: () => {
      n.g.gain.setTargetAtTime(0.0001, c.currentTime, 0.4);
      depth.gain.setTargetAtTime(0, c.currentTime, 0.4);
      n.src.stop(c.currentTime + 2);
      lfo.stop(c.currentTime + 2);
    },
  };
}

// distant wolf howl: a rising then falling sine with a slow vibrato
export function sfxHowl(delay = 0) {
  const c = ac();
  if (!c) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(280, t);
  o.frequency.exponentialRampToValueAtTime(540, t + 0.7);
  o.frequency.exponentialRampToValueAtTime(470, t + 1.6);
  o.frequency.exponentialRampToValueAtTime(330, t + 2.3);
  const vib = c.createOscillator();
  vib.frequency.value = 5.5;
  const vibGain = c.createGain();
  vibGain.gain.value = 9;
  vib.connect(vibGain).connect(o.frequency);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.12, t + 0.4);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
  o.connect(g).connect(out());
  o.start(t);
  vib.start(t);
  o.stop(t + 2.5);
  vib.stop(t + 2.5);
}
