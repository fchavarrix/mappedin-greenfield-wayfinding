import type { MapData } from '@mappedin/mappedin-js';
import type { Start, Store } from './venue';

/** More stops than this stops being a shopping trip and starts being a tour. */
export const MAX_STOPS = 6;

/**
 * A multi-stop route built from what the visitor searched for ("shoes" → every shoe store).
 * The order is the shortest walk from where they are, found by trying every order: with six stops
 * that is 720 orders over walking distances from the map graph, so it is exact, not a heuristic.
 */
export type TripPlan = { label: string; stops: Store[]; metres: number; total: number; skipped: Store[]; ranked: boolean };

type Target = Start['target'] | Store['space'];

/**
 * `ranked`: candidates come from a text search, already in relevance order, so the best matches are
 * kept. Otherwise (a category) every candidate is equally relevant and the closest ones are kept.
 */
export function planTrip(mapData: MapData, from: Start, label: string, candidates: Store[], ranked: boolean): TripPlan | undefined {
  // Only storefronts this release can route end to end: main level, reachable from the start.
  const dist = (a: Target, b: Target) => {
    try {
      const d = mapData.getDistance(a, b);
      return Number.isFinite(d) && d > 0 ? d : Infinity;
    } catch {
      return Infinity;
    }
  };
  const main = candidates.filter((s) => s.mainLevel && s.location.type === 'tenant');
  const reachable = main.filter((s) => dist(from.target, s.space) < Infinity);
  const skipped = main.filter((s) => !reachable.includes(s));
  if (reachable.length < 2) return undefined;

  // Too many matches: keep the best (or closest) ones and say so, instead of a 40-minute walk.
  const pool = ranked ? reachable : [...reachable].sort((a, b) => dist(from.target, a.space) - dist(from.target, b.space));
  const picked = pool.slice(0, MAX_STOPS);

  const n = picked.length;
  const fromStart = picked.map((s) => dist(from.target, s.space));
  const between = picked.map((a) => picked.map((b) => (a === b ? 0 : dist(a.space, b.space))));

  let best: number[] = [], bestCost = Infinity;
  const order: number[] = [];
  const used = new Array<boolean>(n).fill(false);
  const search = (cost: number) => {
    if (cost >= bestCost) return; // prune: already longer than the best complete order
    if (order.length === n) {
      best = [...order];
      bestCost = cost;
      return;
    }
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      const step = order.length ? between[order[order.length - 1]][i] : fromStart[i];
      used[i] = true;
      order.push(i);
      search(cost + step);
      order.pop();
      used[i] = false;
    }
  };
  search(0);
  if (!best.length) return undefined;

  return { label, stops: best.map((i) => picked[i]), metres: bestCost, total: reachable.length, skipped, ranked };
}
