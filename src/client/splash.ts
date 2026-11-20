import { requestExpandedMode } from '@devvit/web/client';
import { CAUSE_LABEL, dailyFor } from '../shared/daily';

const startButton = document.getElementById('start-button') as HTMLButtonElement;
const causeEl = document.getElementById('cause') as HTMLParagraphElement;
const dayLabel = document.getElementById('day-label') as HTMLParagraphElement;

startButton.addEventListener('click', (e) => {
  requestExpandedMode(e, 'game');
});

const daily = dailyFor(new Date());
dayLabel.textContent = `Today's crash · ${daily.dayKey}`;
causeEl.textContent = `${CAUSE_LABEL[daily.cause]} over the Jungle`;
