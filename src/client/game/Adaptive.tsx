import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { Camera, Object3D, Scene, WebGLRenderer } from 'three';
import { intro } from './intro';
import { run } from './state';

// Keeps the frame rate smooth on weak phones:
// - shadows update every frame (only nearby chunks cast, so the pass is small); updating
//   every other frame made frame times alternate light/heavy, which reads as micro-stutter
// - watches the frame time and lowers the render resolution when the game drops below
//   ~45 fps, raising it again when there is headroom.
// - while the intro blackout covers the screen nothing is drawn, and that dark window is
//   used once to compile every shader the gameplay will need (creatures, water, pickups are
//   hidden during the cinematic, so their first appearance used to hitch for 40-160 ms).

export const perf = { scale: 1 }; // 1 = full quality resolution, read by the fps readout

// Compile the programs of every mesh in the scene, including ones that are hidden right now.
// three.js only compiles visible objects, so hidden ones are shown for the call and restored.
function warmShaders(gl: WebGLRenderer, scene: Scene, camera: Camera) {
  const forced: Object3D[] = [];
  scene.traverse((o) => {
    if (!o.visible) {
      o.visible = true;
      forced.push(o);
    }
  });
  // the driver (ANGLE on most phones/PCs) finishes shader and texture setup only on the
  // first real draw, so compile alone still left 70-110 ms hitches: draw everything once,
  // with culling off, while the opaque blackout hides the canvas.
  const culled: Object3D[] = [];
  scene.traverse((o) => {
    if (o.frustumCulled) {
      o.frustumCulled = false;
      culled.push(o);
    }
  });
  try {
    gl.compile(scene, camera);
    gl.render(scene, camera);
  } catch {
    // a failed warm-up only means the old first-use hitch
  }
  for (const o of culled) o.frustumCulled = true;
  for (const o of forced) o.visible = false;
}

export function Adaptive({ maxDpr, shadows }: { maxDpr: number; shadows: boolean }) {
  const gl = useThree((s) => s.gl);
  const setDpr = useThree((s) => s.setDpr);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    // local debugging only (?debug)
    if (window.location.search.includes('debug')) Object.assign(window, { __scene: scene });
  }, [scene]);
  const acc = useRef({ frames: 0, time: 0, dpr: maxDpr, cooldown: 2 });
  const warmed = useRef(false);

  useEffect(() => {
    gl.shadowMap.autoUpdate = shadows;
    gl.shadowMap.needsUpdate = true;
    return () => {
      gl.shadowMap.autoUpdate = true;
    };
  }, [gl, shadows]);

  useEffect(
    () => () => {
      scene.visible = true;
    },
    [scene],
  );

  useFrame(({ camera }, dt) => {
    const a = acc.current;
    // the blackout overlay is opaque: skip the whole scene (and its shadow pass)
    const black = run.phase === 'intro' && intro.stage === 'black';
    scene.visible = !black;
    if (black) {
      if (!warmed.current) {
        warmed.current = true;
        scene.visible = true;
        warmShaders(gl, scene, camera);
        scene.visible = false;
      }
      // empty frames are not a fair sample for the resolution controller
      a.frames = 0;
      a.time = 0;
      return;
    }
    // a hidden tab / backgrounded webview gives huge dt; do not judge on those frames
    if (dt > 0.25) return;
    a.frames++;
    a.time += dt;
    a.cooldown -= dt;
    if (a.time < 1.5) return;
    const fps = a.frames / a.time;
    a.frames = 0;
    a.time = 0;
    if (a.cooldown > 0) return;
    const minDpr = Math.min(0.6, maxDpr);
    let next = a.dpr;
    if (fps < 45) next = Math.max(minDpr, a.dpr - 0.15);
    else if (fps > 57) next = Math.min(maxDpr, a.dpr + 0.1);
    if (Math.abs(next - a.dpr) > 0.01) {
      a.dpr = next;
      setDpr(next);
      perf.scale = next / maxDpr;
      a.cooldown = 2; // give the GPU time to settle before judging again
    }
  });

  return null;
}
