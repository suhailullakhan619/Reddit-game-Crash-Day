import { useEffect, useSyncExternalStore } from 'react';
import { CAUSE_LABEL, type Daily } from '../../shared/daily';
import { sfxWin } from './audio';
import { DEATH_LABEL, getVersion, run, subscribe } from './state';

function mmss(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function EndCard({ daily, onRetry }: { daily: Daily; onRetry: () => void }) {
  useSyncExternalStore(subscribe, getVersion);
  const rescued = run.phase === 'rescued';
  const over = run.phase === 'dead' || rescued;

  useEffect(() => {
    if (rescued) sfxWin();
  }, [rescued]);

  if (!over) return null;
  return (
    <div className={`endcard ${rescued ? 'won' : 'lost'}`}>
      <div className="end-inner">
        <div className="end-kicker">
          {daily.dayKey} · {CAUSE_LABEL[daily.cause]}
        </div>
        <div className="end-title">{rescued ? 'Rescued' : 'You didn’t make it'}</div>
        <div className="end-cause">
          {rescued ? 'A search plane spotted the wreck at dawn.' : DEATH_LABEL[run.deathCause ?? 'injuries']}
        </div>
        <div className="end-stats">
          <div>
            <b>{mmss(run.timeAlive)}</b>
            <span>survived</span>
          </div>
          <div>
            <b>Day {Math.min(run.day, 5)}</b>
            <span>reached</span>
          </div>
          <div>
            <b>{run.collected}</b>
            <span>items found</span>
          </div>
          <div>
            <b>{run.tigerDown ? 'Drove off' : run.tigerHits}</b>
            <span>{run.tigerDown ? 'the tiger' : 'tiger hits'}</span>
          </div>
        </div>
        {run.kills.snake + run.kills.boar + run.kills.gator > 0 && (
          <div className="end-kills">
            {run.kills.snake > 0 && <span>{run.kills.snake} viper{run.kills.snake > 1 ? 's' : ''}</span>}
            {run.kills.boar > 0 && <span>{run.kills.boar} boar{run.kills.boar > 1 ? 's' : ''}</span>}
            {run.kills.gator > 0 && <span>{run.kills.gator} alligator{run.kills.gator > 1 ? 's' : ''}</span>}
          </div>
        )}
        <button className="end-retry" onClick={onRetry}>
          {rescued ? 'Play again' : 'Try again'}
        </button>
        <div className="end-foot">Same crash for everyone today. New crash tomorrow.</div>
      </div>
    </div>
  );
}
