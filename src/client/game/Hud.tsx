import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react';
import { isMuted, setMuted, sfxCraft, sfxDrink, sfxPickup, startHeartbeat, startJungle } from './audio';
import { atmo } from './fx';
import { playerPos } from './shared';
import {
  actions,
  canCraft,
  combat,
  emit,
  getVersion,
  ITEM_LABEL,
  RECIPES,
  run,
  subscribe,
  tiger,
  toast,
  type ItemKind,
  type Recipe,
} from './state';
import { survival } from './survival';
import { WATER_LEVEL, type World } from './world';

const USABLE: ItemKind[] = ['water', 'berries', 'meat', 'medkit', 'flare', 'wood', 'stone', 'herb'];

const ITEM_ICON: Record<ItemKind, string> = {
  wood: 'M4 17l14-8M6 20l14-8M5 13l9-5',
  stone: 'M5 16l3-7 7-2 4 6-3 5H8z',
  berries: 'M9 14a3 3 0 1 0 .01 0M15 15a3 3 0 1 0 .01 0M12 9a3 3 0 1 0 .01 0M12 6l2-3',
  water: 'M10 3h4v3l2 3v12H8V9l2-3z',
  herb: 'M12 21V9M12 13c-4 0-6-3-6-6 4 0 6 3 6 6zM12 11c3 0 5-2 5-5-3 0-5 2-5 5z',
  medkit: 'M4 8h16v11H4zM9 8V5h6v3M12 11v5M9.5 13.5h5',
  flare: 'M8 20l8-8M14 6l4 4M15 3l1 2M20 8l1 1',
  meat: 'M15 5a5 5 0 0 1 3 8l-6 6a4 4 0 0 1-6-6l6-6a5 5 0 0 1 3-2zM6 18l-2 2',
};

function consumeItem(kind: ItemKind) {
  if (run.inv[kind] <= 0 || run.phase !== 'play') return;
  switch (kind) {
    case 'water':
      survival.thirst = Math.min(100, survival.thirst + 32);
      sfxDrink();
      toast('You drink deeply.');
      break;
    case 'berries':
      survival.hunger = Math.min(100, survival.hunger + 18);
      survival.thirst = Math.min(100, survival.thirst + 3);
      sfxPickup();
      toast('Sweet and sour. Hunger eased.');
      break;
    case 'medkit':
      survival.health = Math.min(100, survival.health + 40);
      sfxPickup();
      toast(run.poisoned ? 'Venom drawn out. Wounds bandaged.' : 'Wounds bandaged. +40 health');
      run.poisoned = false;
      break;
    case 'meat':
      survival.hunger = Math.min(100, survival.hunger + 35);
      sfxPickup();
      toast('Tough and gamey, but filling.');
      break;
    case 'flare':
      tiger.scare = 1;
      sfxCraft();
      toast('You light a flare. Red light floods the trees.');
      break;
    default:
      toast(`${ITEM_LABEL[kind]} is for crafting.`);
      return;
  }
  run.inv[kind]--;
  emit();
}

function craft(r: Recipe, world: World) {
  if (!canCraft(r)) return;
  if (r.id === 'campfire') {
    const x = playerPos.x + Math.sin(combat.facing) * 1.6;
    const z = playerPos.z + Math.cos(combat.facing) * 1.6;
    const y = world.heightAt(x, z);
    if (y < WATER_LEVEL + 0.1) {
      toast('Too wet here for a fire.');
      return;
    }
    run.campfires.push({ x, y, z, age: 0 });
  }
  for (const [k, n] of Object.entries(r.cost)) run.inv[k as ItemKind] -= n ?? 0;
  if (r.id === 'spear') run.spear = true;
  if (r.id === 'medkit') run.inv.medkit++;
  sfxCraft();
  toast(r.id === 'campfire' ? 'Fire lit. Warmth — and safety.' : `Crafted ${r.label}.`);
  emit();
}

export function Hud({ world }: { world: World }) {
  useSyncExternalStore(subscribe, getVersion);
  const [craftOpen, setCraftOpen] = useState(false);
  const [muted, setMutedState] = useState(isMuted());
  const flash = useRef<HTMLDivElement>(null);
  const dodgeBtn = useRef<HTMLButtonElement>(null);
  const danger = useRef<HTMLDivElement>(null);
  const poison = useRef<HTMLDivElement>(null);
  const [toastVisible, setToastVisible] = useState<number | null>(null);

  // ambience + heartbeat while playing
  useEffect(() => {
    if (run.phase !== 'play') return;
    const jungle = startJungle(() => atmo.night);
    const hb = startHeartbeat(() => run.danger);
    return () => {
      jungle?.stop();
      hb?.stop();
    };
  }, [run.phase]);

  // per-frame DOM effects (no React re-render)
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      if (flash.current) flash.current.style.opacity = String(Math.min(0.75, run.hurtFlash));
      if (danger.current) danger.current.style.opacity = String(Math.max(0, run.danger - 0.15) * 0.9);
      dodgeBtn.current?.classList.toggle('urgent', run.dodgeNow);
      poison.current?.classList.toggle('on', run.poisoned && run.phase === 'play');
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (run.phase !== 'play' || e.repeat) return;
      if (e.code === 'KeyE') actions.interact = true;
      else if (e.code === 'KeyF') actions.attack = true;
      else if (e.code === 'Space') {
        actions.dodge = true;
        e.preventDefault();
      } else if (e.code === 'KeyC') setCraftOpen((v) => !v);
      else if (e.code === 'Digit1') consumeItem('water');
      else if (e.code === 'Digit2') consumeItem('berries');
      else if (e.code === 'Digit3') consumeItem('medkit');
      else if (e.code === 'Digit4') consumeItem('flare');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // toast lifetime
  const toastId = run.toast?.id ?? null;
  useEffect(() => {
    if (toastId === null) return;
    setToastVisible(toastId);
    const id = window.setTimeout(() => setToastVisible(null), 2600);
    return () => window.clearTimeout(id);
  }, [toastId]);

  if (run.phase === 'intro') return null;
  const playing = run.phase === 'play';
  const items = USABLE.filter((k) => run.inv[k] > 0);
  const tap = (fn: () => void) => (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    fn();
  };

  return (
    <>
      <div className="danger-edge" ref={danger} />
      <div className="hurt-flash" ref={flash} />
      <div className="poison" ref={poison}>
        <span>Poisoned</span> use a med kit
      </div>

      {run.toast && toastVisible === run.toast.id && (
        <div className="toast" key={run.toast.id}>
          {run.toast.text}
        </div>
      )}

      {playing && (
        <>
          <div className="actions">
            <button className="act act-dodge" ref={dodgeBtn} onPointerDown={tap(() => (actions.dodge = true))}>
              <svg viewBox="0 0 24 24">
                <path d="M4 14c3-6 9-8 16-6M16 4l4 4-4 4" />
              </svg>
              <span>Dodge</span>
            </button>
            <button className="act act-attack" onPointerDown={tap(() => (actions.attack = true))}>
              <svg viewBox="0 0 24 24">
                <path d={run.spear ? 'M4 20L18 6M15 4l5 0 0 5' : run.knife ? 'M5 19l9-9m0 0l4-6 1 1-6 4' : 'M8 13V7a2 2 0 0 1 4 0v5M12 9a2 2 0 0 1 4 0v4M8 13l-2-2a2 2 0 0 0-2 3l4 5h9l1-6'} />
              </svg>
              <span>{run.spear ? 'Spear' : run.knife ? 'Stab' : 'Punch'}</span>
            </button>
            <button
              className={`act act-main${run.nearby ? ' ready' : ''}`}
              onPointerDown={tap(() => (actions.interact = true))}
              disabled={!run.nearby}
            >
              <svg viewBox="0 0 24 24">
                <path d="M7 11V6a1.5 1.5 0 0 1 3 0v5M10 10V4.5a1.5 1.5 0 0 1 3 0V10M13 10V5.5a1.5 1.5 0 0 1 3 0V12M16 9a1.5 1.5 0 0 1 3 0v5a7 7 0 0 1-7 7h-1a6 6 0 0 1-5-3l-2.5-4.5a1.5 1.5 0 0 1 2.5-1.5L7 14" />
              </svg>
              <span>{run.nearby ? run.nearby.label : 'Grab'}</span>
            </button>
            <button className={`act act-craft${craftOpen ? ' open' : ''}`} onPointerDown={tap(() => setCraftOpen((v) => !v))}>
              <svg viewBox="0 0 24 24">
                <path d="M14 6l4 4-9 9H5v-4zM12 8l4 4" />
              </svg>
              <span>Craft</span>
            </button>
          </div>

          {craftOpen && (
            <div className="craft" onPointerDown={(e) => e.stopPropagation()}>
              <div className="craft-title">Craft</div>
              {RECIPES.map((r) => {
                const ok = canCraft(r);
                const owned = r.id === 'spear' && run.spear;
                return (
                  <button
                    key={r.id}
                    className={`recipe${ok ? ' ok' : ''}`}
                    disabled={!ok}
                    onClick={() => {
                      craft(r, world);
                      if (r.id === 'campfire') setCraftOpen(false);
                    }}
                  >
                    <span className="recipe-name">{owned ? `${r.label} ✓` : r.label}</span>
                    <span className="recipe-cost">
                      {Object.entries(r.cost).map(([k, n]) => (
                        <span key={k} className={run.inv[k as ItemKind] >= (n ?? 0) ? 'have' : 'need'}>
                          {run.inv[k as ItemKind]}/{n} {ITEM_LABEL[k as ItemKind]}
                        </span>
                      ))}
                    </span>
                    <span className="recipe-hint">{r.hint}</span>
                  </button>
                );
              })}
            </div>
          )}

          {items.length > 0 && (
            <div className="inventory">
              {items.map((k) => (
                <button key={k} className={`slot slot-${k}`} onPointerDown={tap(() => consumeItem(k))} title={ITEM_LABEL[k]}>
                  <svg viewBox="0 0 24 24">
                    <path d={ITEM_ICON[k]} />
                  </svg>
                  <span className="slot-n">{run.inv[k]}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      <button
        className="chip mute"
        onClick={() => {
          setMuted(!muted);
          setMutedState(!muted);
        }}
      >
        {muted ? 'sound off' : 'sound on'}
      </button>
    </>
  );
}
