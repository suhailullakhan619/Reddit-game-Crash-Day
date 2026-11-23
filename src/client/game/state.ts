// Run state shared by the 3D scene (read/written in useFrame) and the React HUD
// (re-rendered through a tiny subscribe/emit store when something visible changes).

import { survival } from './survival';

export type ItemKind = 'wood' | 'stone' | 'berries' | 'water' | 'herb' | 'medkit' | 'flare' | 'meat';
export type StartItem = 'knife' | 'medkit' | 'flare' | 'water';
export type Phase = 'intro' | 'play' | 'dead' | 'rescued';
export type DeathCause = 'tiger' | 'snake' | 'venom' | 'boar' | 'gator' | 'thirst' | 'hunger' | 'cold' | 'injuries';

export const ITEM_LABEL: Record<ItemKind, string> = {
  wood: 'Wood',
  stone: 'Stone',
  berries: 'Berries',
  water: 'Water',
  herb: 'Herbs',
  medkit: 'Med kit',
  flare: 'Flare',
  meat: 'Boar meat',
};

export const DEATH_LABEL: Record<DeathCause, string> = {
  tiger: 'Mauled by the tiger',
  snake: 'Bitten by a viper',
  venom: 'Snake venom took hold',
  boar: 'Gored by a wild boar',
  gator: 'Dragged under by an alligator',
  thirst: 'Died of thirst',
  hunger: 'Starved',
  cold: 'Died of exposure',
  injuries: 'Succumbed to injuries',
};

export const RESCUE_DAY = 6; // survive days 1-5, rescue arrives at dawn of day 6

function freshInventory(): Record<ItemKind, number> {
  return { wood: 0, stone: 0, berries: 0, water: 0, herb: 0, medkit: 0, flare: 0, meat: 0 };
}

export const run = {
  phase: 'intro' as Phase,
  inv: freshInventory(),
  spear: false,
  knife: false,
  bow: false,
  arrows: 0,
  startItem: null as StartItem | null,
  campfires: [] as { x: number; y: number; z: number; age: number; out: boolean }[],
  shelters: [] as { x: number; y: number; z: number; rot: number }[],
  // parachute supply crates (days 2 and 4): fall from the sky, then wait to be opened
  drops: [] as { x: number; z: number; ground: number; y: number; landed: boolean; opened: boolean }[],
  dropDays: [] as number[],
  rescueDone: false, // rescue cinematic finished: the end card may show
  deathCause: null as DeathCause | null,
  lastHurt: 'injuries' as DeathCause,
  timeAlive: 0,
  day: 1,
  collected: 0,
  tigerHits: 0,
  tigerDown: false,
  hurtFlash: 0, // 0..1, drives the red screen pulse
  poisoned: false, // viper venom: health drains until a med kit / poultice is used
  kills: { snake: 0, boar: 0, gator: 0 } as Record<'snake' | 'boar' | 'gator', number>,
  danger: 0, // 0..1, tiger proximity (heartbeat + music)
  dodgeNow: false, // tiger is winding up: show the dodge prompt
  nearby: null as { label: string } | null, // current interact target
  toast: null as { text: string; id: number } | null,
};

// UI -> scene one-shot requests, consumed in Player's frame loop.
export const actions = { interact: false, attack: false, dodge: false, shoot: false };

// Rescue cinematic: Rescue.tsx drives it and owns the camera; Player follows x/y/z while active.
export const rescueFx = { active: false, t: 0, x: 0, y: 0, z: 0 };

let version = 0;
const listeners = new Set<() => void>();

export function emit() {
  version++;
  for (const l of listeners) l();
}

export function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function getVersion() {
  return version;
}

let toastId = 0;
export function toast(text: string) {
  run.toast = { text, id: ++toastId };
  emit();
}

export function addItem(kind: ItemKind, n = 1) {
  run.inv[kind] += n;
  run.collected += n;
  emit();
}

export function damage(amount: number, cause: DeathCause) {
  if (run.phase !== 'play') return;
  survival.health = Math.max(0, survival.health - amount);
  run.lastHurt = cause;
  run.hurtFlash = Math.min(1, run.hurtFlash + amount / 30);
  if (survival.health <= 0) die(cause);
}

export function die(cause: DeathCause) {
  if (run.phase !== 'play') return;
  run.phase = 'dead';
  run.deathCause = cause;
  emit();
}

export function rescue() {
  if (run.phase !== 'play') return;
  run.phase = 'rescued';
  emit();
}

export type Recipe = { id: 'spear' | 'bow' | 'arrows' | 'campfire' | 'shelter' | 'medkit'; label: string; cost: Partial<Record<ItemKind, number>>; hint: string };

export const RECIPES: Recipe[] = [
  { id: 'spear', label: 'Spear', cost: { wood: 2, stone: 1 }, hint: 'Fight back' },
  { id: 'bow', label: 'Bow + 4 arrows', cost: { wood: 3, herb: 2 }, hint: 'Shoot from range' },
  { id: 'arrows', label: '3 arrows', cost: { wood: 1, stone: 1 }, hint: 'Ammo for the bow' },
  { id: 'campfire', label: 'Campfire', cost: { wood: 4, stone: 3 }, hint: 'Warmth · keeps the tiger away' },
  { id: 'shelter', label: 'Lean-to shelter', cost: { wood: 5, herb: 2 }, hint: 'Stay warm · heal while resting' },
  { id: 'medkit', label: 'Herbal poultice', cost: { herb: 3 }, hint: '+35 health' },
];

export function canCraft(r: Recipe) {
  if (r.id === 'spear' && run.spear) return false;
  if (r.id === 'bow' && run.bow) return false;
  if (r.id === 'arrows' && !run.bow) return false;
  return Object.entries(r.cost).every(([k, n]) => run.inv[k as ItemKind] >= (n ?? 0));
}

export function resetRun() {
  run.phase = 'intro';
  run.inv = freshInventory();
  run.spear = false;
  run.knife = false;
  run.bow = false;
  run.arrows = 0;
  run.rescueDone = false;
  run.shelters = [];
  run.drops = [];
  run.dropDays = [];
  rescueFx.active = false;
  rescueFx.t = 0;
  run.startItem = null;
  run.campfires = [];
  run.deathCause = null;
  run.lastHurt = 'injuries';
  run.timeAlive = 0;
  run.day = 1;
  run.collected = 0;
  run.tigerHits = 0;
  run.tigerDown = false;
  run.hurtFlash = 0;
  run.poisoned = false;
  run.kills = { snake: 0, boar: 0, gator: 0 };
  run.danger = 0;
  run.dodgeNow = false;
  run.nearby = null;
  run.toast = null;
  actions.interact = actions.attack = actions.dodge = actions.shoot = false;
  survival.health = 100;
  survival.hunger = 85;
  survival.thirst = 70;
  survival.warmth = 90;
  survival.drinking = false;
  combat.invuln = 0;
  combat.knockX = 0;
  combat.knockZ = 0;
  tiger.mode = 'idle';
  tiger.hp = 3;
  tiger.pendingHit = 0;
  tiger.scare = 0;
  emit();
}

// Combat state shared by Player and Tiger.
export const combat = {
  invuln: 0, // seconds of dodge invulnerability left
  knockX: 0,
  knockZ: 0,
  facing: 0,
  camYaw: 0, // camera yaw, for the heading-up minimap
};

export type TigerMode = 'idle' | 'stalk' | 'windup' | 'charge' | 'recover' | 'flee' | 'gone';

export const tiger = {
  x: 0,
  z: 0,
  mode: 'idle' as TigerMode,
  hp: 3,
  // set by Player when it lands a hit; consumed by the Tiger AI next frame
  pendingHit: 0,
  // set when a flare is lit; Tiger flees
  scare: 0,
};

// Debug-only (?debug) teleport requests, consumed by Player / Tiger on their next frame.
export const debugReq = {
  player: null as null | { x: number; z: number },
  tiger: null as null | { x: number; z: number },
};

// Every hostile animal registers here so the player's attack, the danger meter and the
// dodge prompt work the same for all of them. Each creature updates its own entry per frame.
export type CreatureKind = 'tiger' | 'snake' | 'boar' | 'gator';

export type Creature = {
  kind: CreatureKind;
  x: number;
  z: number;
  alive: boolean;
  danger: number; // 0..1 contribution to the heartbeat / red edge
  windup: boolean; // telegraphing an attack: show the dodge prompt
  pendingHit: number; // damage dealt by the player, consumed by the creature
  vulnerable: number; // damage multiplier while recovering
};

export const creatures: Creature[] = [];

export function createCreature(kind: CreatureKind, x: number, z: number): Creature {
  return { kind, x, z, alive: true, danger: 0, windup: false, pendingHit: 0, vulnerable: 1 };
}

// Mount/unmount helper for components: registers in an effect so StrictMode remounts stay correct.
export function creatureSlot(c: Creature) {
  return () => {
    if (!creatures.includes(c)) creatures.push(c);
    return () => unregisterCreature(c);
  };
}

export function unregisterCreature(c: Creature) {
  const i = creatures.indexOf(c);
  if (i >= 0) creatures.splice(i, 1);
}
