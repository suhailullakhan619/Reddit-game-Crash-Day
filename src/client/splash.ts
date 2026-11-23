import { requestExpandedMode } from '@devvit/web/client';
import { CAUSE_LABEL, dailyFor } from '../shared/daily';

// '2026-11-20' -> 'Nov 20' (dayKey is a UTC date)
function shortDate(dayKey: string) {
  const d = new Date(`${dayKey}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dayKey;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

const daily = dailyFor(new Date());

const startButton = document.getElementById('start-button');
if (startButton instanceof HTMLButtonElement) {
  startButton.addEventListener('click', (e) => {
    requestExpandedMode(e, 'game');
  });
}

const dayLabel = document.getElementById('day-label');
if (dayLabel) dayLabel.textContent = `Today's crash · ${shortDate(daily.dayKey)}`;

const first = document.getElementById('cause-first');
if (first) first.textContent = CAUSE_LABEL[daily.cause];

const second = document.getElementById('cause-second');
if (second) second.textContent = CAUSE_LABEL[daily.second].toLowerCase();

// Community line + personal streak from the server (silently skipped offline).
type SplashInit = {
  stats?: { crashed: number; survived: number };
  streak?: { count: number };
  bestToday?: number | null;
};

void fetch('/api/init')
  .then((r) => (r.ok ? (r.json() as Promise<SplashInit>) : null))
  .then((data) => {
    if (!data?.stats) return;
    const sub = document.querySelector('.sub');
    const line = document.createElement('p');
    line.className = 'community';
    const { crashed, survived } = data.stats;
    line.textContent =
      crashed > 0 ? `${survived.toLocaleString()} survived · ${crashed.toLocaleString()} crashed today` : 'Be the first to fly today';
    sub?.parentElement?.insertBefore(line, sub);
    const streak = data.streak?.count ?? 0;
    if (streak > 0) {
      const chip = document.createElement('p');
      chip.className = 'streak';
      chip.textContent = data.bestToday !== null && data.bestToday !== undefined ? `${streak}-day streak · played today` : `${streak}-day streak · keep it alive`;
      sub?.parentElement?.insertBefore(chip, line);
    }
  })
  .catch(() => undefined);
