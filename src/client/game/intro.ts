import { emit, run, type StartItem } from './state';
import { track } from './net';
import { survival } from './survival';

// Crash cinematic timeline (seconds of real time).
export const T = {
  event: 5.5, // first emergency
  event2: 7.0, // it cascades into a second one
  grab: 8.6, // slow-mo item choice opens
  grabEnd: 12.1,
  brace: 14.6, // ideal brace tap
  impact: 15.0,
  wake: 18.0,
  end: 20.0,
};

export type IntroStage = 'cruise' | 'event' | 'event2' | 'grab' | 'dive' | 'black' | 'wake' | 'done';

export const intro = {
  t: 0,
  stage: 'cruise' as IntroStage,
  braced: null as null | 'perfect' | 'good' | 'late',
  skipped: false,
  // The Reddit app can run the page before it is on screen, so the cinematic waits for a tap.
  // That tap also unlocks audio. Retries start straight away.
  started: false,
  frames: 0, // frames rendered so far (loading screen hides until the scene is drawing)
};

export function takeOff() {
  if (intro.started) return;
  intro.started = true;
  emit();
}

export const START_ITEM_LABEL: Record<StartItem, string> = {
  knife: 'Knife',
  medkit: 'Med kit',
  flare: 'Flare',
  water: 'Water',
};

export function stageAt(t: number): IntroStage {
  if (t < T.event) return 'cruise';
  if (t < T.event2) return 'event';
  if (t < T.grab) return 'event2';
  if (t < T.grabEnd) return 'grab';
  if (t < T.impact) return 'dive';
  if (t < T.wake) return 'black';
  if (t < T.end) return 'wake';
  return 'done';
}

export function setStage(s: IntroStage) {
  if (intro.stage === s) return;
  intro.stage = s;
  emit();
}

export function chooseItem(item: StartItem) {
  if (run.startItem) return;
  run.startItem = item;
  track('item_grabbed', item);
  emit();
  // the choice ends the slow-mo early
  if (intro.t < T.grabEnd) intro.t = T.grabEnd;
}

export function brace() {
  if (intro.braced || intro.t < T.grabEnd) return;
  const off = Math.abs(intro.t - T.brace);
  intro.braced = off < 0.2 ? 'perfect' : off < 0.45 ? 'good' : 'late';
  track('brace', intro.braced);
  emit();
}

export function skipIntro() {
  intro.skipped = true;
  intro.started = true;
  if (!run.startItem && intro.t < T.grab) intro.t = T.grab;
  else intro.t = Math.max(intro.t, T.impact);
}

// Apply the outcome of the cinematic and hand control to the player.
export function finishIntro() {
  const b = intro.braced;
  survival.health = b === 'perfect' ? 100 : b === 'good' ? 85 : 65;
  switch (run.startItem) {
    case 'knife':
      run.knife = true;
      break;
    case 'medkit':
      run.inv.medkit += 1;
      break;
    case 'flare':
      run.inv.flare += 1;
      break;
    case 'water':
      run.inv.water += 2;
      break;
  }
  run.phase = 'play';
  try {
    localStorage.setItem('crashday.seenIntro', '1');
  } catch {
    // ignore
  }
  emit();
}

export function resetIntro() {
  intro.t = 0;
  intro.stage = 'cruise';
  intro.braced = null;
  intro.skipped = false;
  intro.frames = 0;
}

export function hasSeenIntro() {
  try {
    return localStorage.getItem('crashday.seenIntro') === '1';
  } catch {
    return false;
  }
}
