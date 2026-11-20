import { useEffect, useRef, useSyncExternalStore } from 'react';
import { CAUSE_LABEL, type CrashCause } from '../../shared/daily';
import { startHeartbeat } from './audio';
import { brace, chooseItem, hasSeenIntro, intro, skipIntro, START_ITEM_LABEL, T } from './intro';
import { getVersion, run, subscribe, type StartItem } from './state';

const ITEMS: { id: StartItem; icon: string; hint: string }[] = [
  { id: 'knife', icon: 'M5 19l9-9m0 0l4-6 1 1-6 4m1 1l-2-2', hint: 'Fight back' },
  { id: 'medkit', icon: 'M4 8h16v11H4zM9 8V5h6v3M12 11v5M9.5 13.5h5', hint: '+40 health' },
  { id: 'flare', icon: 'M8 20l8-8M14 6l4 4M15 3l1 2M20 8l1 1M19 4l-1 1', hint: 'Scares the tiger' },
  { id: 'water', icon: 'M12 3s-6 7-6 11a6 6 0 0 0 12 0c0-4-6-11-6-11z', hint: '2 bottles' },
];

const EVENT_TEXT: Record<CrashCause, string> = {
  bird: 'Bird strike! The windshield cracks.',
  engine: 'The engine coughs… and dies.',
  storm: 'Lightning hits the wing.',
  fuel: 'Fuel is pouring out of the tank.',
};

export function IntroOverlay({ cause }: { cause: CrashCause }) {
  useSyncExternalStore(subscribe, getVersion);
  const stage = intro.stage;
  const seen = useRef(hasSeenIntro()).current;

  // heartbeat in the dark
  useEffect(() => {
    if (stage !== 'black') return;
    const hb = startHeartbeat(() => 0.55);
    return () => hb?.stop();
  }, [stage]);

  // keyboard: 1-4 to grab, space to brace
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (intro.stage === 'grab') {
        const i = Number(e.key) - 1;
        const item = ITEMS[i];
        if (item) chooseItem(item.id);
      }
      if (intro.stage === 'dive' && (e.code === 'Space' || e.code === 'Enter')) brace();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (stage === 'done') return null;
  const emergency = stage === 'event' || stage === 'grab' || stage === 'dive';

  return (
    <div className={`intro stage-${stage} cause-${cause}`}>
      {emergency && <div className="alarm-pulse" />}
      {cause === 'bird' && emergency && (
        <svg className="crack" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path d="M62 28 L55 10 M62 28 L80 18 M62 28 L88 34 M62 28 L70 50 L66 70 M62 28 L44 40 L30 38 M70 50 L86 58" />
        </svg>
      )}

      {stage === 'cruise' && (
        <div className="cine-caption">
          <div className="cine-kicker">Today's flight</div>
          <div className="cine-title">Over the jungle</div>
          <div className="cine-sub">“Smooth air today. Twenty minutes to the river strip.”</div>
        </div>
      )}

      {stage === 'event' && (
        <div className="cine-alert">
          <div className="cine-alert-title">{CAUSE_LABEL[cause].toUpperCase()}</div>
          <div className="cine-sub">{EVENT_TEXT[cause]}</div>
        </div>
      )}

      {stage === 'grab' && (
        <div className="grab">
          <div className="grab-title">{run.startItem ? `Grabbed: ${START_ITEM_LABEL[run.startItem]}` : 'Grab ONE thing!'}</div>
          {!run.startItem && <div className="grab-timer" style={{ animationDuration: `${(T.grabEnd - T.grab).toFixed(1)}s` }} />}
          <div className="grab-row">
            {ITEMS.map((it, i) => (
              <button
                key={it.id}
                className={`grab-item${run.startItem === it.id ? ' picked' : ''}`}
                disabled={!!run.startItem}
                onClick={() => chooseItem(it.id)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d={it.icon} />
                </svg>
                <span className="grab-name">{START_ITEM_LABEL[it.id]}</span>
                <span className="grab-hint">{it.hint}</span>
                <span className="grab-key">{i + 1}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {stage === 'dive' && (
        <button className="brace" onPointerDown={() => brace()}>
          {!intro.braced && (
            <>
              <span className="brace-ring" style={{ animationDuration: `${(T.brace - T.grabEnd).toFixed(2)}s` }} />
              <span className="brace-target" />
            </>
          )}
          <span className="brace-label">
            {intro.braced === 'perfect'
              ? 'Perfect brace!'
              : intro.braced === 'good'
                ? 'Braced'
                : intro.braced === 'late'
                  ? 'Too late…'
                  : 'BRACE! Tap when the ring closes'}
          </span>
        </button>
      )}

      {stage === 'black' && (
        <div className="blackout">
          <span>…</span>
        </div>
      )}
      {stage === 'wake' && <div className="wakeup" />}

      {seen && (stage === 'cruise' || stage === 'event' || stage === 'dive') && (
        <button className="chip skip" onClick={skipIntro}>
          Skip ›
        </button>
      )}
    </div>
  );
}
