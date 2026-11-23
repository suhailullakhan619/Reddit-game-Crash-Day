import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react';
import { isMuted, setMuted, sfxCraft, sfxDrink, sfxPickup, startHeartbeat, startJungle } from './audio';
import { track } from './net';
import { atmo } from './fx';
import { Vector3 } from 'three';
import { playerPos, view, type Quality } from './shared';

const projV = new Vector3();
import {
  actions,
  creatures,
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
import { CHALLENGE_INFO } from '../../shared/challenge';
import { challengeProgress, quest } from './quest';
import { dragScroll } from './dragScroll';
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

const BOW_ICON = 'M6 3c7 2 11 8 9 18M6 3l9 18M3 12h12M12 9l3 3-3 3';
const ARROW_ICON = 'M4 20L18 6M14 5h5v5M4 20l2-5M4 20l5-2M7 17l-2-2';

const RECIPE_ICON: Record<Recipe['id'], string> = {
  spear: 'M4 20L17 7M14 4h6v6M17 7l-3-3M17 7l3 3',
  bow: BOW_ICON,
  arrows: ARROW_ICON,
  shelter: 'M3 20L12 5l9 15M7 20l5-8 5 8M3 20h18',
  splint: 'M9 3v18M15 3v18M6 7h12M6 12h12M6 17h12',
  campfire: 'M5 21l14-4M5 17l14 4M12 3c1 3 4 4 4 8a4 4 0 0 1-8 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-4 0-7z',
  medkit: ITEM_ICON.medkit,
};

const CHECK_ICON = 'M5 12.5l4.5 4.5L19 7.5';

type CostLine = { kind: ItemKind; n: number };

// recipe cost in a stable item order, without casting Object.entries keys
function costOf(r: Recipe): CostLine[] {
  const out: CostLine[] = [];
  for (const kind of USABLE) {
    const n = r.cost[kind];
    if (n) out.push({ kind, n });
  }
  return out;
}

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
    case 'meat': {
      // cooking over a lit fire makes meat far more nourishing
      run.ateMeat = true;
      const atFire = run.campfires.some((f) => !f.out && Math.hypot(f.x - playerPos.x, f.z - playerPos.z) < 3.5);
      if (atFire) {
        survival.hunger = Math.min(100, survival.hunger + 60);
        survival.health = Math.min(100, survival.health + 10);
        run.cooked = true;
        sfxCraft();
        toast('Cooked over the fire. Hot, filling: +60 food, +10 health.');
      } else {
        survival.hunger = Math.min(100, survival.hunger + 30);
        sfxPickup();
        toast('Raw and gamey. Cook it at a campfire for double.');
      }
      break;
    }
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
    run.campfires.push({ x, y, z, age: 0, out: false });
    run.firesBuilt++;
  }
  if (r.id === 'shelter') {
    const x = playerPos.x + Math.sin(combat.facing) * 2.2;
    const z = playerPos.z + Math.cos(combat.facing) * 2.2;
    const y = world.heightAt(x, z);
    if (y < WATER_LEVEL + 0.1) {
      toast('Too wet here for a shelter.');
      return;
    }
    run.shelters.push({ x, y, z, rot: combat.facing });
  }
  for (const c of costOf(r)) run.inv[c.kind] -= c.n;
  if (r.id === 'spear') run.spear = true;
  if (r.id === 'spear' || r.id === 'bow') run.craftedWeapon = true;
  if (r.id === 'splint') run.legBroken = false;
  if (r.id === 'bow') {
    run.bow = true;
    run.arrows += 4;
  }
  if (r.id === 'arrows') run.arrows += 3;
  if (r.id === 'medkit') run.inv.medkit++;
  track('craft', r.id);
  sfxCraft();
  toast(
    r.id === 'campfire'
      ? 'Fire lit. Warmth — and safety.'
      : r.id === 'shelter'
        ? 'Shelter built. Rest inside to stay warm and heal.'
        : r.id === 'splint'
          ? 'Leg splinted. You can run again.'
        : `Crafted ${r.label}.`
  );
  emit();
}

export function Hud({ world }: { world: World }) {
  useSyncExternalStore(subscribe, getVersion);
  const [craftOpen, setCraftOpen] = useState(false);
  const craftPanel = useRef<HTMLDivElement>(null);
  const flash = useRef<HTMLDivElement>(null);
  const dodgeBtn = useRef<HTMLButtonElement>(null);
  const danger = useRef<HTMLDivElement>(null);
  const threat = useRef<HTMLDivElement>(null);
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
      const arrow = threat.current;
      if (arrow) {
        let target: (typeof creatures)[number] | null = null;
        for (const c of creatures) if (c.alive && c.danger > 0.3 && (!target || c.danger > target.danger)) target = c;
        const cam = view.camera;
        let shown = false;
        if (target && cam && run.phase === 'play') {
          projV.set(target.x, playerPos.y + 1, target.z).project(cam);
          const behind = projV.z > 1;
          let px = behind ? -projV.x : projV.x;
          let py = behind ? -projV.y : projV.y;
          const offscreen = behind || Math.abs(px) > 0.9 || Math.abs(py) > 0.9;
          if (offscreen) {
            // clamp the direction onto a rectangle inset from the screen edge
            const k = 0.86 / Math.max(Math.abs(px), Math.abs(py), 1e-3);
            px *= k;
            py *= k;
            const w = window.innerWidth;
            const h = window.innerHeight;
            const sx = (px * 0.5 + 0.5) * w;
            const sy = (-py * 0.5 + 0.5) * h;
            const ang = Math.atan2(-py, px);
            arrow.style.transform = `translate(${sx - 22}px, ${sy - 22}px) rotate(${ang}rad)`;
            arrow.classList.toggle('urgent', target.windup);
            shown = true;
          }
        }
        arrow.style.opacity = shown ? '1' : '0';
      }
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
      else if (e.code === 'KeyR') actions.shoot = true;
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

  // tapping the scene (anything outside the panel or its button) closes the craft panel
  useEffect(() => {
    if (!craftOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (craftPanel.current?.contains(t) || t.closest('.act-craft')) return;
      setCraftOpen(false);
    };
    // capture phase: runs before anything else can swallow the tap
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [craftOpen]);

  // toast lifetime
  const toastId = run.toast?.id ?? null;
  useEffect(() => {
    if (toastId === null) return;
    setToastVisible(toastId);
    const id = window.setTimeout(() => setToastVisible(null), 2600);
    return () => window.clearTimeout(id);
  }, [toastId]);

  // "ready to craft" hint: when a recipe becomes craftable for the first time, name it on
  // screen next to the Craft button so players know what the button will offer
  const ready = RECIPES.filter((r) => canCraft(r) && r.id !== 'arrows');
  const readyKey = ready.map((r) => r.id).join(',');
  const seenReady = useRef(new Set<string>());
  const [craftHint, setCraftHint] = useState<string | null>(null);
  useEffect(() => {
    if (run.phase !== 'play') return;
    const fresh = ready.find((r) => !seenReady.current.has(r.id));
    for (const r of ready) seenReady.current.add(r.id);
    if (!fresh) return;
    setCraftHint(fresh.label);
    const id = window.setTimeout(() => setCraftHint(null), 6000);
    return () => window.clearTimeout(id);
    // readyKey captures the list; ready itself is recomputed every render
  }, [readyKey]);
  useEffect(() => {
    if (run.phase === 'intro') seenReady.current.clear();
  });

  if (run.phase === 'intro') return null;
  const playing = run.phase === 'play';
  const items = USABLE.filter((k) => run.inv[k] > 0);
  const tap = (fn: () => void) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    // preventDefault suppresses :active in some mobile webviews, so drive the pressed look directly
    const el = e.currentTarget;
    el.classList.add('pressed');
    window.setTimeout(() => el.classList.remove('pressed'), 140);
    fn();
  };
  const attackLabel = run.spear ? 'Spear' : run.knife ? 'Stab' : 'Punch';

  return (
    <>
      <div className="danger-edge" ref={danger} />
      <div className="threat-arrow" ref={threat} aria-hidden="true">
        <svg viewBox="0 0 44 44">
          <path d="M14 10 L34 22 L14 34 L19 22 Z" />
        </svg>
      </div>
      <div className="hurt-flash" ref={flash} />

      {/* left column under the stat rings: status, inventory, craft panel, toast — stacked so they never overlap */}
      <div className="hud-stack">
        <div className="poison" ref={poison}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3s-6 7-6 11a6 6 0 0 0 12 0c0-4-6-11-6-11zM10 12l4 4M14 12l-4 4" />
          </svg>
          <span className="poison-label">Poisoned</span>
          <span className="poison-tip">use a med kit</span>
        </div>

        {playing && run.legBroken && (
          <div className="poison injury on">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 3l2 7-3 4 2 7M15 3l-2 7 3 4-2 7" />
            </svg>
            <span className="poison-label">Broken leg</span>
            <span className="poison-tip">craft a splint</span>
          </div>
        )}

        {playing && (
          <div className={`quest-pill${run.challengeDone ? ' done' : ''}`} title={CHALLENGE_INFO[quest.id].goal}>
            <span className="quest-star" aria-hidden="true">★</span>
            <span className="quest-title">{CHALLENGE_INFO[quest.id].title}</span>
            <span className="quest-prog">{challengeProgress()}</span>
          </div>
        )}

        {playing && items.length > 0 && (
          <div className="inventory">
            {items.map((k) => (
              <button
                key={k}
                className={`slot slot-${k}`}
                onPointerDown={tap(() => consumeItem(k))}
                title={ITEM_LABEL[k]}
                aria-label={`${ITEM_LABEL[k]}, ${run.inv[k]}`}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d={ITEM_ICON[k]} />
                </svg>
                <span className="slot-n">{run.inv[k]}</span>
              </button>
            ))}
          </div>
        )}

        {playing && craftOpen && (
          <div className="craft" ref={craftPanel} onPointerDown={(e) => e.stopPropagation()}>
            <div className="craft-head">
              <span className="craft-title">Craft</span>
              <button type="button" className="craft-close" onClick={() => setCraftOpen(false)} aria-label="Close craft panel">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M7 7l10 10M17 7L7 17" />
                </svg>
              </button>
            </div>
            <div className="recipes" ref={dragScroll}>
              {RECIPES.map((r) => {
                const ok = canCraft(r);
                const owned = (r.id === 'spear' && run.spear) || (r.id === 'bow' && run.bow);
                const cost = costOf(r);
                return (
                  <button
                    key={r.id}
                    type="button"
                    className={`recipe recipe-${r.id}${ok ? ' ok' : ''}${owned ? ' owned' : ''}`}
                    disabled={!ok}
                    aria-label={`${r.label}: ${owned ? 'owned' : cost.map((c) => `${c.n} ${ITEM_LABEL[c.kind]}`).join(', ')}`}
                    onClick={() => {
                      craft(r, world);
                      if (r.id === 'campfire' || r.id === 'shelter') setCraftOpen(false);
                    }}
                  >
                    <span className="recipe-top">
                      <span className="recipe-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24">
                          <path d={RECIPE_ICON[r.id]} />
                        </svg>
                      </span>
                      <span className="recipe-name">{r.label}</span>
                    </span>
                    {owned ? (
                      <span className="recipe-owned">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d={CHECK_ICON} />
                        </svg>
                        Owned
                      </span>
                    ) : (
                      <span className="recipe-cost">
                        {cost.map((c) => {
                          const have = run.inv[c.kind];
                          const enough = have >= c.n;
                          return (
                            <span key={c.kind} className={`cost cost-${c.kind}${enough ? ' have' : ' need'}`}>
                              <svg className="cost-icon" viewBox="0 0 24 24" aria-hidden="true">
                                <path d={ITEM_ICON[c.kind]} />
                              </svg>
                              <span className="cost-label">{ITEM_LABEL[c.kind]}</span>
                              <span className="cost-n">{enough ? c.n : `${have}/${c.n}`}</span>
                              {enough && (
                                <svg className="cost-check" viewBox="0 0 24 24" aria-hidden="true">
                                  <path d={CHECK_ICON} />
                                </svg>
                              )}
                            </span>
                          );
                        })}
                      </span>
                    )}
                    <span className="recipe-hint">{r.hint}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {run.toast && toastVisible === run.toast.id && (
          <div className="toast" key={run.toast.id} role="status">
            <span className="toast-dot" aria-hidden="true" />
            <span className="toast-text">{run.toast.text}</span>
          </div>
        )}
      </div>

      {playing && (
        <div className="actions">
          {run.nearby && <div className="act-context">{run.nearby.label}</div>}
          <button type="button" className="act act-dodge" ref={dodgeBtn} onPointerDown={tap(() => (actions.dodge = true))} aria-label="Dodge">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 14c3-6 9-8 16-6M16 4l4 4-4 4" />
            </svg>
            <span>Dodge</span>
          </button>
          <button type="button" className="act act-attack" onPointerDown={tap(() => (actions.attack = true))} aria-label={attackLabel}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d={run.spear ? 'M4 20L18 6M15 4l5 0 0 5' : run.knife ? 'M5 19l9-9m0 0l4-6 1 1-6 4' : 'M8 13V7a2 2 0 0 1 4 0v5M12 9a2 2 0 0 1 4 0v4M8 13l-2-2a2 2 0 0 0-2 3l4 5h9l1-6'} />
            </svg>
            <span>{attackLabel}</span>
          </button>
          {run.bow && (
            <button
              type="button"
              className={`act act-shoot${run.arrows > 0 ? '' : ' empty'}`}
              onPointerDown={tap(() => (actions.shoot = true))}
              aria-label={`Shoot, ${run.arrows} arrows left`}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d={BOW_ICON} />
              </svg>
              <span>Shoot</span>
              <b className="act-badge">{run.arrows}</b>
            </button>
          )}
          <button
            className={`act act-main${run.nearby ? ' ready' : ''}`}
            onPointerDown={tap(() => (actions.interact = true))}
            disabled={!run.nearby}
            aria-label={run.nearby ? run.nearby.label : 'Grab'}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 11V6a1.5 1.5 0 0 1 3 0v5M10 10V4.5a1.5 1.5 0 0 1 3 0V10M13 10V5.5a1.5 1.5 0 0 1 3 0V12M16 9a1.5 1.5 0 0 1 3 0v5a7 7 0 0 1-7 7h-1a6 6 0 0 1-5-3l-2.5-4.5a1.5 1.5 0 0 1 2.5-1.5L7 14" />
            </svg>
            <span>Grab</span>
          </button>
          <button
            className={`act act-craft${craftOpen ? ' open' : ''}`}
            onPointerDown={tap(() => setCraftOpen((v) => !v))}
            aria-label="Craft"
            aria-expanded={craftOpen}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M14 6l4 4-9 9H5v-4zM12 8l4 4" />
            </svg>
            <span>Craft</span>
            {ready.length > 0 && !craftOpen && <b className="act-badge craft-badge">{ready.length}</b>}
          </button>
          {craftHint && !craftOpen && (
            <button
              type="button"
              className="craft-hint"
              onPointerDown={tap(() => {
                setCraftHint(null);
                setCraftOpen(true);
              })}
            >
              <b>{craftHint}</b> ready · tap to craft
            </button>
          )}
        </div>
      )}
    </>
  );
}

const QUALITY_OPTIONS: { id: Quality; label: string }[] = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Med' },
  { id: 'high', label: 'High' },
];

type SettingsProps = {
  quality: Quality;
  onQuality: (q: Quality) => void;
  showStats: boolean;
  onToggleStats: () => void;
};

// One gear button beside the minimap; sound, graphics and the fps readout live in its popover.
export function SettingsMenu({ quality, onQuality, showStats, onToggleStats }: SettingsProps) {
  const [open, setOpen] = useState(false);
  const [muted, setMutedState] = useState(isMuted());
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target;
      if (t instanceof Node && root.current?.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

  return (
    <div className="settings" ref={root}>
      <button
        className={`gear${open ? ' open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-label="Settings"
        aria-expanded={open}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z" />
          <path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5A7.5 7.5 0 0 0 7 6.5l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 3l-2 1.6 2 3.4 2.4-1A7.5 7.5 0 0 0 9.6 19l.4 2.5h4l.4-2.5a7.5 7.5 0 0 0 2.6-1.5l2.4 1 2-3.4z" />
        </svg>
      </button>
      {open && (
        <div className="settings-pop" role="dialog" aria-label="Settings">
          <div className="set-row">
            <span>Sound</span>
            <button
              className={`toggle${muted ? '' : ' on'}`}
              role="switch"
              aria-checked={!muted}
              onClick={() => {
                setMuted(!muted);
                setMutedState(!muted);
              }}
            >
              <i />
            </button>
          </div>
          <div className="set-row set-col">
            <span>Graphics</span>
            <div className="seg">
              {QUALITY_OPTIONS.map((o) => (
                <button key={o.id} className={quality === o.id ? 'on' : ''} aria-pressed={quality === o.id} onClick={() => onQuality(o.id)}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <div className="set-row">
            <span>Show FPS</span>
            <button className={`toggle${showStats ? ' on' : ''}`} role="switch" aria-checked={showStats} onClick={onToggleStats}>
              <i />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
