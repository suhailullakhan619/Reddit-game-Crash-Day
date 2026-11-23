import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { CanvasTexture, SRGBColorSpace, type Group } from 'three';
import type { Grave } from '../../shared/api';
import { playerPos } from './shared';
import { DEATH_LABEL, run, toast } from './state';
import type { World } from './world';

// Ghosts of real players: wherever someone died today, a little grave with their username
// stands in everyone's jungle. Walk up to one to read how they died.

function nameTexture(text: string) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = 'rgba(14, 18, 16, 0.72)';
    g.beginPath();
    g.roundRect(4, 8, 248, 48, 24);
    g.fill();
    g.fillStyle = '#f2ead8';
    g.font = 'bold 26px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text.length > 18 ? `${text.slice(0, 17)}…` : text, 128, 33);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function GraveMarker({ grave, y }: { grave: Grave; y: number }) {
  const label = useMemo(() => nameTexture(`u/${grave.username}`), [grave.username]);
  useEffect(() => () => label.dispose(), [label]);
  return (
    <group position={[grave.x, y, grave.z]}>
      {/* mound + wooden cross */}
      <mesh position-y={0.05} scale={[0.55, 0.18, 0.9]}>
        <sphereGeometry args={[1, 10, 6]} />
        <meshLambertMaterial color="#5a4632" />
      </mesh>
      <mesh position={[0, 0.55, -0.55]}>
        <boxGeometry args={[0.09, 1.0, 0.07]} />
        <meshLambertMaterial color="#8a6a44" />
      </mesh>
      <mesh position={[0, 0.78, -0.55]}>
        <boxGeometry args={[0.5, 0.08, 0.07]} />
        <meshLambertMaterial color="#8a6a44" />
      </mesh>
      <sprite position={[0, 1.45, -0.55]} scale={[1.6, 0.4, 1]}>
        <spriteMaterial map={label} transparent depthWrite={false} fog={false} />
      </sprite>
    </group>
  );
}

export function Graves({ world, graves }: { world: World; graves: Grave[] }) {
  const root = useRef<Group>(null);
  const read = useRef(new Set<string>());
  const near = useRef(new Set<string>());

  useEffect(() => {
    read.current.clear();
  }, [graves]);

  useFrame(() => {
    if (run.phase !== 'play') return;
    // show only graves within 45 m (cheap culling), read the epitaph on approach
    const g = root.current;
    graves.forEach((gr, i) => {
      const d = Math.hypot(gr.x - playerPos.x, gr.z - playerPos.z);
      const child = g?.children[i];
      if (child) child.visible = d < 45;
      const inside = d < 2.6;
      if (inside && !near.current.has(gr.username)) {
        near.current.add(gr.username);
        if (!read.current.has(gr.username)) {
          read.current.add(gr.username);
          toast(`Here lies u/${gr.username}: ${DEATH_LABEL[gr.cause].toLowerCase()} on day ${gr.day}.`);
        }
      } else if (!inside) near.current.delete(gr.username);
    });
  });

  return (
    <group ref={root}>
      {graves.map((gr) => (
        <GraveMarker key={gr.username} grave={gr} y={world.heightAt(gr.x, gr.z)} />
      ))}
    </group>
  );
}
