import { towers, clamp } from './model.js';

export const G = 9.81;
export const hash = n => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
export const collapseSeconds = t => Math.max(0, t - 100) * 1.7;

// Reduced, one-dimensional post-initiation model, with assumed equal floor masses.
// A prescribed loss of support starts the descent. This does NOT solve initiation.
// Gravity advances the upper mass. Engulfed floor mass is captured inelastically
// with conservation of vertical momentum. An assumed constant crushing resistance
// dissipates work. No parameter is fitted to the historical collapse duration.
export function solveDescent(index, resistanceRatio = .2, dt = 1 / 240) {
  const d = towers[index], floorH = d.height / 110, start = d.pivot * floorH;
  const initialMass = 110 - d.pivot, resistance = resistanceRatio * initialMass * G;
  const frames = [], release = Array(110).fill(Infinity);
  let y = start, v = 0, mass = initialMass, next = d.pivot - 1;
  for (let f = d.pivot; f < 110; f++) release[f] = 0;
  for (let step = 0; step <= Math.ceil(34 / dt); step++) {
    const time = step * dt;
    frames.push({ time, y, v, mass });
    if (y <= 0) continue;
    const acceleration = Math.max(0, G - resistance / mass);
    const proposed = y - v * dt - .5 * acceleration * dt * dt;
    v += acceleration * dt;
    while (next >= 0 && proposed < next * floorH) {
      release[next] = time + dt;
      v *= mass / (mass + 1);
      mass++;
      next--;
    }
    y = Math.max(0, proposed);
    if (!y) v = 0;
  }
  return { frames, release, dt, start, floorH, initialMass, resistanceRatio };
}

export function descentAt(solution, seconds) {
  const position = clamp(seconds / solution.dt, 0, solution.frames.length - 1);
  const a = solution.frames[Math.floor(position)], b = solution.frames[Math.min(Math.floor(position) + 1, solution.frames.length - 1)];
  const p = position % 1;
  return { y: a.y + (b.y - a.y) * p, v: a.v + (b.v - a.v) * p, mass: a.mass };
}

export function timelineForOther(t, selected) {
  const d = towers[selected], startOffset = selected ? 17 : 0;
  const elapsed = t < 8 ? -.01 : t <= 100 ? clamp((t - 10) / 90) * d.minutes : d.minutes + collapseSeconds(t) / 60;
  const other = 1 - selected, local = startOffset + elapsed - (other ? 17 : 0);
  if (local < 0) return 0;
  if (local < towers[other].minutes) return 10 + local / towers[other].minutes * 90;
  return Math.min(120, 100 + (local - towers[other].minutes) * 60 / 1.7);
}

// Deterministic visual damage envelope. It follows fuselage + banked wing geometry;
// it is not a digitized photograph or a fracture/penetration computation.
export function impactDamage(index, face, lateral, height, floorH) {
  const d = towers[index], entry = index ? 2 : 0, exit = index ? 0 : 2;
  const center = (d.low + d.high) / 2 * floorH, offset = index ? 7 : 0;
  const x = lateral - offset, dy = height - center;
  const bank = index ? -.48 : .15;
  const alongWing = dy - Math.tan(bank) * x;
  const fuzz = (hash(lateral * 51 + Math.floor(height / floorH) * 7) - .5) * 1.5;
  if (face === entry) {
    const fuselage = Math.abs(x) < 4 + fuzz && Math.abs(dy) < 4.5;
    const wing = Math.abs(x) < 24 && Math.abs(alongWing) < 1.7 + fuzz;
    const engine = Math.min(Math.abs(x - 10), Math.abs(x + 10)) < 2.6 && Math.abs(alongWing + 2) < 3;
    return fuselage || wing || engine;
  }
  return face === exit && Math.abs(x - (index ? 12 : -3)) < 8 && Math.abs(dy + 2) < 4;
}
