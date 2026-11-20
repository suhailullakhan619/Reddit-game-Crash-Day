import { Vector3 } from 'three';

// Live game state shared across components without React re-renders.
export const playerPos = new Vector3();
export const gameClock = { elapsed: 0, dayLength: 90, startPhase: 0.22 };

// Color palette. One unified set used everywhere.
export const PALETTE = {
  grassDark: '#355f33',
  grass: '#4f7f3a',
  grassLight: '#78964a',
  mud: '#8f7a52',
  sand: '#b8a274',
  rock: '#6f6b60',
  cliff: '#837f6c',
  water: '#2c6c6a',
  trunk: '#5b4330',
  leafA: '#2e5b33',
  leafB: '#3f7a3a',
  leafC: '#5f8f3c',
  palm: '#6f9a40',
  bush: '#3a6b35',
  shirt: '#e07a3c',
  pants: '#34465a',
  skin: '#c99a72',
  pack: '#6d5a3a',
  hull: '#d8d2c3',
  stripe: '#b5432f',
  metal: '#8b8f93',
};

export type Quality = 'low' | 'medium' | 'high';

export const QUALITY: Record<Quality, { dpr: number; shadows: boolean; shadowMap: number; aa: boolean; density: number }> = {
  low: { dpr: 1, shadows: false, shadowMap: 512, aa: false, density: 0.45 },
  medium: { dpr: 1.5, shadows: true, shadowMap: 1024, aa: false, density: 0.8 },
  high: { dpr: 2, shadows: true, shadowMap: 2048, aa: true, density: 1.2 },
};
