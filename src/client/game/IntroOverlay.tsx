import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { CAUSE_LABEL, type CrashCause } from '../../shared/daily';
import { startHeartbeat, unlockAudio } from './audio';
import { brace, chooseItem, hasSeenIntro, intro, skipIntro, START_ITEM_LABEL, T, takeOff } from './intro';
import { getVersion, run, subscribe, type StartItem } from './state';

const ITEMS: { id: StartItem; icon: string; hint: string }[] = [
  { id: 'knife', icon: 'M5 19l9-9m0 0l4-6 1 1-6 4m1 1l-2-2', hint: 'Fight back' },
  { id: 'medkit', icon: 'M4 8h16v11H4zM9 8V5h6v3M12 11v5M9.5 13.5h5', hint: '+40 health' },
  { id: 'flare', icon: 'M8 20l8-8M14 6l4 4M15 3l1 2M20 8l1 1M19 4l-1 1', hint: 'Scares tiger' },
  { id: 'water', icon: 'M12 3s-6 7-6 11a6 6 0 0 0 12 0c0-4-6-11-6-11z', hint: '2 bottles' },
];

const EVENT_TEXT: Record<CrashCause, string> = {
  bird: 'Bird strike! The windshield cracks.',
  engine: 'The engine coughs… and dies.',
  storm: 'Lightning hits the wing.',
  fuel: 'Fuel is pouring out of the tank.',
  fire: 'Flames burst out of the cowling.',
  shear: 'A downdraft slams the plane toward the trees.',
};

// same side-view bush plane silhouette as the splash hero (filled, nose right)
function PlaneMark({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="-40 -18 76 32" aria-hidden="true">
      <path className="pm-body" d="M-30 0 C-22 -7 10 -8 22 -5 L29 0 L22 5 C10 7 -22 5 -30 2 Z" />
      <path className="pm-body" d="M-29 1 L-36 -13 L-29 -13 L-21 -3 Z" />
      <path className="pm-wing" d="M-8 -9 L18 -9 L16 -6 L-8 -6 Z" />
      <path className="pm-window" d="M6 -3 h9 l3 3 h-12 z" />
      <path className="pm-prop" d="M31 -9 V9" />
    </svg>
  );
}

function WarnIcon() {
  return (
    <svg className="cine-warn" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.5l9.5 16.5h-19z" />
      <path d="M12 10v4.5M12 17.2v.3" />
    </svg>
  );
}

// Hold the cinematic captions until the scene has rendered a few frames:
// first-load shader compile can freeze the canvas for seconds on phones.
// once shaders are warm (any earlier run this session) retries skip the loading state
let warmed = false;

function useFirstFrames() {
  const [ready, setReady] = useState(() => warmed || intro.frames > 3);
  useEffect(() => {
    if (ready) {
      warmed = true;
      return;
    }
    let raf = 0;
    const started = performance.now();
    const loop = () => {
      // failsafe: never hold the overlay longer than 12 s
      if (intro.frames > 3 || performance.now() - started > 12000) {
        setReady(true);
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [ready]);
  return ready;
}

function Dots() {
  return (
    <span className="dots" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

export function IntroOverlay({ causes }: { causes: [CrashCause, CrashCause] }) {
  const [cause, second] = causes;
  const has = (c: CrashCause) => cause === c || second === c;
  useSyncExternalStore(subscribe, getVersion);
  const stage = intro.stage;
  const seen = useRef(hasSeenIntro()).current;
  const ready = useFirstFrames();

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
  const emergency = stage === 'event' || stage === 'event2' || stage === 'grab' || stage === 'dive';

  return (
    <div className={`intro stage-${stage} cause-${cause}`}>
      {emergency && <div className="alarm-pulse" />}
      {has('bird') && emergency && (stage !== 'event' || cause === 'bird') && (
        <svg className="crack" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path d="M62 28 L55 10 M62 28 L80 18 M62 28 L88 34 M62 28 L70 50 L66 70 M62 28 L44 40 L30 38 M70 50 L86 58" />
        </svg>
      )}

      {stage === 'cruise' && ready && !intro.started && (
        <button
          type="button"
          className="takeoff"
          onPointerDown={() => {
            unlockAudio();
            takeOff();
          }}
        >
          <span className="takeoff-kicker">Today&rsquo;s flight</span>
          <span className="takeoff-title">Over the jungle</span>
          <span className="takeoff-btn">
            Tap to take off
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12h13M13 6l6 6-6 6" />
            </svg>
          </span>
          <span className="takeoff-hint">Something will go wrong. Be ready to grab an item and brace.</span>
        </button>
      )}

      {stage === 'cruise' && ready && intro.started && (
        <div className="cine-caption">
          <div className="cine-kicker">Today&rsquo;s flight</div>
          <div className="cine-title">Over the jungle</div>
          <div className="cine-sub">&ldquo;Smooth air today. Twenty minutes to the river strip.&rdquo;</div>
        </div>
      )}

      {stage === 'event' && (
        <div className="cine-alert" key="e1">
          <div className="cine-then">Mayday</div>
          <div className="cine-alert-title">
            <WarnIcon />
            {CAUSE_LABEL[cause]}
          </div>
          <div className="cine-sub">{EVENT_TEXT[cause]}</div>
        </div>
      )}
      {stage === 'event2' && (
        <div className="cine-alert" key="e2">
          <div className="cine-then">then&hellip;</div>
          <div className="cine-alert-title">
            <WarnIcon />
            {CAUSE_LABEL[second]}
          </div>
          <div className="cine-sub">{EVENT_TEXT[second]}</div>
        </div>
      )}

      {stage === 'grab' && (
        <div className="grab">
          <div className="grab-title">{run.startItem ? `Grabbed: ${START_ITEM_LABEL[run.startItem]}` : 'Grab ONE thing!'}</div>
          {!run.startItem && <div className="grab-sub">The cabin is coming apart. Choose fast.</div>}
          <div className="grab-track">
            {!run.startItem && <div className="grab-timer" style={{ animationDuration: `${(T.grabEnd - T.grab).toFixed(1)}s` }} />}
          </div>
          <div className="grab-row">
            {ITEMS.map((it, i) => (
              <button
                key={it.id}
                type="button"
                className={`grab-item${run.startItem === it.id ? ' picked' : ''}`}
                disabled={!!run.startItem}
                aria-label={`Grab ${START_ITEM_LABEL[it.id]}: ${it.hint}`}
                aria-pressed={run.startItem === it.id}
                // pointerdown registers the tap even if the card re-renders before release
                onPointerDown={(e) => {
                  if (e.button === 0) chooseItem(it.id);
                }}
                onClick={() => chooseItem(it.id)}
              >
                <span className="grab-icon">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d={it.icon} />
                  </svg>
                </span>
                <span className="grab-text">
                  <span className="grab-name">{START_ITEM_LABEL[it.id]}</span>
                  <span className="grab-hint">{it.hint}</span>
                </span>
                <span className="grab-key" aria-hidden="true">
                  {i + 1}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {stage === 'dive' && (
        <button type="button" className="brace" onPointerDown={() => brace()} aria-label="Brace for impact">
          {!intro.braced && (
            <>
              <span className="brace-ring" style={{ animationDuration: `${(T.brace - T.grabEnd).toFixed(2)}s` }} />
              <span className="brace-target" />
            </>
          )}
          <span className={`brace-label${intro.braced ? ` braced-${intro.braced}` : ''}`}>
            {intro.braced === 'perfect' ? (
              'Perfect brace!'
            ) : intro.braced === 'good' ? (
              'Braced'
            ) : intro.braced === 'late' ? (
              'Too late…'
            ) : (
              <>
                <b>Brace!</b> Tap when the ring closes
              </>
            )}
          </span>
        </button>
      )}

      {stage === 'black' && (
        <div className="blackout">
          <Dots />
        </div>
      )}
      {stage === 'wake' && <div className="wakeup" />}

      {!ready && stage === 'cruise' && (
        <div className="preparing" role="status">
          <PlaneMark className="preparing-plane" />
          <div className="preparing-title">
            Crash <span>Day</span>
          </div>
          <div className="preparing-text">Preparing flight</div>
          <Dots />
        </div>
      )}

      {seen && ready && intro.started && (stage === 'cruise' || stage === 'event' || stage === 'event2' || stage === 'dive') && (
        <button type="button" className="chip skip" onClick={skipIntro}>
          Skip
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      )}
    </div>
  );
}
