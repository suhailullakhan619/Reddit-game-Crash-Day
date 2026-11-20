import { emit, run, type StartItem } from './state';
import { survival } from './survival';

// Crash cinematic timeline (seconds of real time).
export const T = {
  event: 5.5, // emergency starts
  grab: 7.2, // slow-mo item choice opens
  grabEnd: 10.7,
  brace: 13.2, // ideal brace tap
  impact: 13.6,
  wake: 16.6,
  end: 18.6,
};

export type IntroStage = 'cruise' | 'event' | 'grab' | 'dive' | 'black' | 'wake' | 'done';

export const intro = {
  t: 0,
  stage: 'cruise' as IntroStage,
  braced: null as null | 'perfect' | 'good' | 'late',
  skipped: false,
};

export const START_ITEM_LABEL: Record<StartItem, string> = {
  knife: 'Knife',
  medkit: 'Med kit',
  flare: 'Flare',
  water: 'Water',
};

export function stageAt(t: number): IntroStage {
  if (t < T.event) return 'cruise';
  if (t < T.grab) return 'event';
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
  emit();
  // the choice ends the slow-mo early
  if (intro.t < T.grabEnd) intro.t = T.grabEnd;
}

export function brace() {
  if (intro.braced || intro.t < T.grabEnd) return;
  const off = Math.abs(intro.t - T.brace);
  intro.braced = off < 0.2 ? 'perfect' : off < 0.45 ? 'good' : 'late';
  emit();
}

export function skipIntro() {
  intro.skipped = true;
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
}

export function hasSeenIntro() {
  try {
    return localStorage.getItem('crashday.seenIntro') === '1';
  } catch {
    return false;
  }
}
