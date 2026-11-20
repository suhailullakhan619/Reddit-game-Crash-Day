import { useEffect, useRef } from 'react';
import { survival } from './survival';

type Ring = { key: 'health' | 'hunger' | 'thirst' | 'warmth'; label: string; color: string; icon: string };

const RINGS: Ring[] = [
  { key: 'health', label: 'Health', color: '#e5584f', icon: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z' },
  { key: 'hunger', label: 'Hunger', color: '#e8a23c', icon: 'M8 4v7a2 2 0 0 0 2 2v7M8 4v5M11 4v5M16 4c-1.5 1.5-2 4-2 6h2v10' },
  { key: 'thirst', label: 'Thirst', color: '#4fa8d8', icon: 'M12 3s-6 7-6 11a6 6 0 0 0 12 0c0-4-6-11-6-11z' },
  { key: 'warmth', label: 'Warmth', color: '#f07a3c', icon: 'M12 3c1 3 4 5 4 9a4 4 0 0 1-8 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 0-8z' },
];

const R = 19;
const C = 2 * Math.PI * R;

export function StatRings() {
  const arcs = useRef<(SVGCircleElement | null)[]>([]);
  const wraps = useRef<(HTMLDivElement | null)[]>([]);
  const drink = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = window.setInterval(() => {
      RINGS.forEach((r, i) => {
        const v = survival[r.key];
        const arc = arcs.current[i];
        if (arc) arc.style.strokeDashoffset = String(C * (1 - v / 100));
        const w = wraps.current[i];
        if (w) w.classList.toggle('low', v < 25);
      });
      drink.current?.classList.toggle('on', survival.drinking);
    }, 150);
    return () => window.clearInterval(id);
  }, []);

  return (
    <>
    <div ref={drink} className="drink">Drinking…</div>
    <div className="rings">
      {RINGS.map((r, i) => (
        <div className="ring" key={r.key} ref={(el) => void (wraps.current[i] = el)} title={r.label}>
          <svg viewBox="0 0 48 48" aria-label={r.label}>
            <circle cx="24" cy="24" r={R} className="ring-track" />
            <circle
              ref={(el) => void (arcs.current[i] = el)}
              cx="24"
              cy="24"
              r={R}
              className="ring-arc"
              stroke={r.color}
              strokeDasharray={C}
              strokeDashoffset={0}
              transform="rotate(-90 24 24)"
            />
            <g transform="translate(12 12)">
              <path d={r.icon} fill="none" stroke="#f2ead8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </g>
          </svg>
        </div>
      ))}
    </div>
    </>
  );
}
