// Daily seed shared by client and server. Every player gets the same crash per UTC day.

export type CrashCause = 'bird' | 'engine' | 'storm' | 'fuel';

export type Daily = {
  dayKey: string; // YYYY-MM-DD (UTC)
  seed: number;
  cause: CrashCause;
};

export const CAUSE_LABEL: Record<CrashCause, string> = {
  bird: 'Bird strike',
  engine: 'Engine failure',
  storm: 'Lightning storm',
  fuel: 'Fuel leak',
};

const CAUSES: CrashCause[] = ['bird', 'engine', 'storm', 'fuel'];

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
  return { dayKey, seed, cause };
}
