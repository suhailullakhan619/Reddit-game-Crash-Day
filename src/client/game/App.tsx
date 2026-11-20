import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Canvas } from '@react-three/fiber';
import { CAUSE_LABEL, dailyFor, type Daily } from '../../shared/daily';
import type { InitResponse } from '../../shared/api';
import { Ambient } from './Ambient';
import { Atmosphere } from './Atmosphere';
import { Boars } from './Boars';
import { unlockAudio } from './audio';
import { Campfires } from './Campfires';
import { Controls } from './Controls';
import { CrashIntro } from './CrashIntro';
import { EndCard } from './EndCard';
import { Gators } from './Gators';
import { Hud } from './Hud';
import { attachKeyboard, input } from './input';
import { resetIntro } from './intro';
import { IntroOverlay } from './IntroOverlay';
import { Minimap } from './Minimap';
import { PerfProbe } from './Perf';
import { createPickups } from './loot';
import { Pickups } from './Pickups';
import { Player } from './Player';
import { QUALITY, gameClock, playerPos, type Quality } from './shared';
import { getVersion, resetRun, run, subscribe, toast } from './state';
import { Snakes } from './Snakes';
import { StatRings } from './StatRings';
import { Terrain } from './Terrain';
import { Tiger } from './Tiger';
import { Vegetation } from './Vegetation';
import { createWorld } from './world';
import { Wreck } from './Wreck';

const QUALITY_KEY = 'crashday.quality';

function initialQuality(): Quality {
  try {
    const saved = localStorage.getItem(QUALITY_KEY);
    if (saved === 'low' || saved === 'medium' || saved === 'high') return saved;
  } catch {
    // storage unavailable: fall through to default
  }
  return 'medium';
}

// Debug: ?t=0.7 starts the day at that phase (0 dawn .. 0.6 dusk .. 0.8 night)
function debugStartPhase(): number | null {
  try {
    const t = Number(new URLSearchParams(window.location.search).get('t'));
    return t > 0 && t < 1 ? t : null;
  } catch {
    return null;
  }
}

let debugPickups: unknown = null;

// Debug hook for local testing only: ?debug exposes run/intro state on window.
try {
  if (new URLSearchParams(window.location.search).has('debug')) {
    void Promise.all([import('./state'), import('./intro'), import('./survival')]).then(([s, i, v]) => {
      Object.assign(window, { __cd: { run: s.run, tiger: s.tiger, intro: i.intro, survival: v.survival, actions: s.actions, debugReq: s.debugReq, creatures: s.creatures, combat: s.combat, pickups: () => debugPickups } });
    });
  }
} catch {
  // ignore
}

export function App() {
  const [daily, setDaily] = useState<Daily>(() => dailyFor(new Date()));
  const [server, setServer] = useState<'pending' | 'ok' | 'offline'>('pending');
  const [quality, setQuality] = useState<Quality>(initialQuality);
  const [showStats, setShowStats] = useState(false);
  const [statsEl, setStatsEl] = useState<HTMLDivElement | null>(null);
  const [clockEl, setClockEl] = useState<HTMLDivElement | null>(null);
  const [runId, setRunId] = useState(0);
  const version = useSyncExternalStore(subscribe, getVersion);

  const world = useMemo(() => {
    const w = createWorld(daily.seed);
    // seed shared position before the first frame so hint checks never read the origin
    playerPos.set(w.spawn.x, w.heightAt(w.spawn.x, w.spawn.z), w.spawn.z);
    return w;
  }, [daily.seed]);

  // fresh loot + clock every run (same seeded layout)
  const pickups = useMemo(() => {
    void runId;
    gameClock.elapsed = 0;
    gameClock.startPhase = debugStartPhase() ?? (daily.cause === 'storm' ? 0.6 : 0.22);
    const list = createPickups(world, daily.cause);
    debugPickups = list;
    return list;
  }, [world, daily.cause, runId]);

  const q = QUALITY[quality];

  useEffect(() => attachKeyboard(), []);

  // audio needs a user gesture; the tap that opened the game may not count inside the iframe
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    unlockAudio();
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/init')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: InitResponse) => {
        if (cancelled) return;
        setServer('ok');
        if (data.daily.seed !== daily.seed) setDaily(data.daily);
      })
      .catch(() => !cancelled && setServer('offline'));
    return () => {
      cancelled = true;
    };
    // run once; daily only changes from this response
  }, []);

  // first-run contextual hints after waking up
  const playing = run.phase === 'play';
  useEffect(() => {
    if (!playing) return;
    const timers = [
      window.setTimeout(() => !input.touchedOnce && toastHint(), 1500),
      window.setTimeout(() => run.phase === 'play' && hint('Find water. Your thirst ring is draining.'), 5000),
      window.setTimeout(() => run.phase === 'play' && hint('Collect wood and stones to craft a spear and a fire.'), 22000),
    ];
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [playing, runId]);

  const cycleQuality = () => {
    const next: Quality = quality === 'low' ? 'medium' : quality === 'medium' ? 'high' : 'low';
    setQuality(next);
    try {
      localStorage.setItem(QUALITY_KEY, next);
    } catch {
      // ignore
    }
  };

  const retry = () => {
    resetRun();
    resetIntro();
    setRunId((n) => n + 1);
  };

  void version;
  const inIntro = run.phase === 'intro';

  return (
    <div className="game">
      <Canvas
        key={quality}
        className="scene"
        shadows={q.shadows ? 'percentage' : false}
        dpr={[1, Math.min(q.dpr, window.devicePixelRatio || 1)]}
        gl={{ antialias: q.aa, powerPreference: 'high-performance', stencil: false }}
        onCreated={({ gl }) => {
          gl.toneMappingExposure = 1.08;
        }}
        camera={{ fov: 60, near: 0.3, far: 270 }}
      >
        <Atmosphere shadows={q.shadows} shadowMap={q.shadowMap} />
        <Terrain world={world} />
        <Vegetation world={world} shadows={q.shadows} density={q.density} />
        <Ambient heightAt={world.heightAt} />
        <group key={runId}>
          {inIntro ? <CrashIntro world={world} cause={daily.cause} /> : <Wreck world={world} shadows={q.shadows} />}
          <Pickups pickups={pickups} version={version} />
          <Campfires version={version} />
          <Player world={world} shadows={q.shadows} pickups={pickups} />
          <Tiger world={world} shadows={q.shadows} />
          <Snakes world={world} />
          <Boars world={world} />
          <Gators world={world} />
        </group>
        <PerfProbe statsEl={statsEl} clockEl={clockEl} />
      </Canvas>

      <div className="vignette" />
      {daily.cause === 'storm' && <div className="rain" />}
      <Controls />

      {!inIntro && (
        <>
          <StatRings />
          <div className="hud-top">
            <div className="hud-left">
              <div className="crash-tag">{CAUSE_LABEL[daily.cause]} · Jungle</div>
              <div className="clock" ref={setClockEl} />
            </div>
            <div className="hud-right">
              <button className="chip" onClick={() => setShowStats((v) => !v)}>
                fps
              </button>
              <button className="chip" onClick={cycleQuality}>
                {quality}
              </button>
            </div>
          </div>
        </>
      )}

      <div className={showStats ? 'debug' : 'debug hidden'}>
        <div className="stats" ref={setStatsEl} />
        <div className="server">server: {server}</div>
      </div>

      <Hud world={world} />
      <Minimap world={world} pickups={pickups} />
      {inIntro && <IntroOverlay key={runId} cause={daily.cause} />}
      <EndCard daily={daily} onRetry={retry} />
    </div>
  );
}

// hints reuse the toast line so the screen never has two banners
function hint(text: string) {
  toast(text);
}

function toastHint() {
  const touch = 'ontouchstart' in window;
  hint(touch ? 'Drag left side to move · drag right side to look' : 'WASD move · mouse look · E grab · F attack · Space dodge · C craft');
}
