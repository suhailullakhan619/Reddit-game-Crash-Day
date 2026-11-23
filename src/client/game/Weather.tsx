import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { hashString } from '../../shared/daily';
import { sfxThunder } from './audio';
import { gameClock } from './shared';
import { emit, run, toast } from './state';

// Storms: from day 2, one storm sweeps over the jungle each day (same time for everyone,
// seeded by the daily seed). Rain puts out campfires that are not under a shelter, soaks
// the player (warmth drops fast) but also lets them catch drinking water.

export const weather = { rain: 0, flash: 0, seed: 0, forced: 0 /* test builds: seconds of forced storm */ };

const LENGTH = 0.32; // fraction of a day

function stormStart(day: number) {
  const h = hashString(`storm:${weather.seed}:${day}`);
  return 0.12 + (h % 1000) / 1000 * 0.45;
}

export function Weather() {
  const st = useRef({ day: 0, warned: false, doused: false, nextFlash: 3 });

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const s = st.current;
    weather.flash = Math.max(0, weather.flash - dt * 3);
    if (run.phase !== 'play') {
      weather.rain = Math.max(0, weather.rain - dt * 0.5);
      return;
    }
    const t = gameClock.startPhase + gameClock.elapsed / gameClock.dayLength;
    const day = 1 + Math.floor(t);
    const phase = t - Math.floor(t);
    if (day !== s.day) {
      s.day = day;
      s.warned = false;
      s.doused = false;
    }
    const start = stormStart(day);
    weather.forced = Math.max(0, weather.forced - dt);
    const stormy = weather.forced > 0 || (day >= 2 && phase > start && phase < start + LENGTH);
    weather.rain += ((stormy ? 1 : 0) - weather.rain) * Math.min(1, dt * 0.45);

    if (stormy && !s.warned && weather.rain > 0.35) {
      s.warned = true;
      sfxThunder();
      toast('A storm rolls in! Rain puts out any fire without a shelter.');
    }
    // heavy rain drowns campfires that are out in the open
    if (weather.rain > 0.75 && !s.doused) {
      s.doused = true;
      let lost = 0;
      for (const f of run.campfires) {
        if (f.out) continue;
        const covered = run.shelters.some((h) => Math.hypot(h.x - f.x, h.z - f.z) < 3.2);
        if (!covered) {
          f.out = true;
          lost++;
        }
      }
      if (lost) {
        toast(lost === 1 ? 'The storm put out your campfire.' : `The storm put out ${lost} campfires.`);
        emit();
      }
    }
    // lightning
    if (weather.rain > 0.6) {
      s.nextFlash -= dt;
      if (s.nextFlash <= 0) {
        weather.flash = 1;
        s.nextFlash = 4 + Math.random() * 6;
        window.setTimeout(sfxThunder, 300 + Math.random() * 900);
      }
    }
  });
  return null;
}

// DOM layer: grey veil, rain streaks and lightning flashes, driven without React re-renders.
export function WeatherOverlay() {
  const veil = useRef<HTMLDivElement>(null);
  const rain = useRef<HTMLDivElement>(null);
  const flash = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const r = weather.rain;
      if (veil.current) veil.current.style.opacity = String(r * 0.45);
      if (rain.current) rain.current.style.opacity = String(r * 0.55);
      if (flash.current) flash.current.style.opacity = String(weather.flash * 0.7);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <>
      <div className="storm-veil" ref={veil} />
      <div className="rain storm-rain" ref={rain} />
      <div className="storm-flash" ref={flash} />
    </>
  );
}
