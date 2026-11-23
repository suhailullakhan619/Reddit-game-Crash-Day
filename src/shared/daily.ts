// Daily seed shared by client and server. Every player gets the same crash per UTC day.
// Each day chains two emergencies (e.g. a bird strike that then sets the engine on fire).

export type CrashCause = 'bird' | 'engine' | 'storm' | 'fuel' | 'fire' | 'shear';

export type Daily = {
  dayKey: string; // YYYY-MM-DD (UTC)
  seed: number;
  cause: CrashCause; // first emergency
  second: CrashCause; // what it leads to
};

export const CAUSE_LABEL: Record<CrashCause, string> = {
  bird: 'Bird strike',
  engine: 'Engine failure',
  storm: 'Lightning storm',
  fuel: 'Fuel leak',
  fire: 'Engine fire',
  shear: 'Wind shear',
};

const CAUSES: CrashCause[] = ['bird', 'engine', 'storm', 'fuel', 'fire', 'shear'];

// Which follow-up emergencies make sense after each first one.
const FOLLOW_UPS: Record<CrashCause, CrashCause[]> = {
  bird: ['engine', 'fire', 'fuel'],
  engine: ['fire', 'shear', 'fuel'],
  storm: ['shear', 'engine', 'fire'],
  fuel: ['engine', 'fire'],
  fire: ['fuel', 'engine'],
  shear: ['engine', 'storm', 'fuel'],
};

export function causePair(d: Pick<Daily, 'cause' | 'second'>) {
  return `${CAUSE_LABEL[d.cause]} + ${CAUSE_LABEL[d.second].toLowerCase()}`;
}

export function hasCause(d: Pick<Daily, 'cause' | 'second'>, c: CrashCause) {
  return d.cause === c || d.second === c;
}

export function dayKeyFor(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// FNV-1a 32-bit
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function dailyFor(date: Date): Daily {
  const dayKey = dayKeyFor(date);
  const seed = hashString(`crash-day:${dayKey}`);
  const cause = CAUSES[seed % CAUSES.length] ?? 'bird';
  const options = FOLLOW_UPS[cause];
  const second = options[(seed >>> 8) % options.length] ?? 'engine';
  return { dayKey, seed, cause, second };
}
