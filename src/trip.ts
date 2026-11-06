import type { MapData } from '@mappedin/mappedin-js';
import type { Start, Store } from './venue';

/** More stops than this stops being a shopping trip and starts being a tour. */
export const MAX_STOPS = 6;

/**
 * A multi-stop route built from what the visitor searched for ("shoes" → every shoe store).
 * The order is the shortest walk from where they are, found by trying every order: with six stops
 * that is 720 orders over walking distances from the map graph, so it is exact, not a heuristic.
 * The visitor can then reverse it, drop stops or move them; those choices are signals too.
 */
export type TripPlan = { label: string; stops: Store[]; metres: number; total: number; skipped: Store[]; ranked: boolean };

type Target = Start['target'] | Store['space'];

/** Walking distance over the map graph, in metres; Infinity when there is no walkable path. */
export function walkDistance(mapData: MapData, a: Target, b: Target) {
  try {
    const d = mapData.getDistance(a, b);
    return Number.isFinite(d) && d > 0 ? d : Infinity;
  } catch {
    return Infinity;
  }
}

/** Metres to walk the stops in the given order, starting from the visitor's parking area. */
export function orderCost(mapData: MapData, from: Start, stops: Store[]) {
  let total = 0;
  let prev: Target = from.target;
  for (const s of stops) {
    total += walkDistance(mapData, prev, s.space);
    prev = s.space;
  }
  return total;
}

/** The exact shortest order (open path from the start) for up to MAX_STOPS stops. */
export function shortestOrder(mapData: MapData, from: Start, stops: Store[]): { stops: Store[]; metres: number } {
  const n = stops.length;
  const fromStart = stops.map((s) => walkDistance(mapData, from.target, s.space));
  const between = stops.map((a) => stops.map((b) => (a === b ? 0 : walkDistance(mapData, a.space, b.space))));

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
  return best.length ? { stops: best.map((i) => stops[i]), metres: bestCost } : { stops, metres: orderCost(mapData, from, stops) };
}

/**
 * `ranked`: candidates come from a text search, already in relevance order, so the best matches are
 * kept. Otherwise (a category) every candidate is equally relevant and the closest ones are kept.
 */
export function planTrip(mapData: MapData, from: Start, label: string, candidates: Store[], ranked: boolean): TripPlan | undefined {
  // Only storefronts this release can route end to end: main level, reachable from the start.
  const dist = (s: Store) => walkDistance(mapData, from.target, s.space);
  const main = candidates.filter((s) => s.mainLevel && s.location.type === 'tenant');
  const reachable = main.filter((s) => dist(s) < Infinity);
  const skipped = main.filter((s) => !reachable.includes(s));
  if (reachable.length < 2) return undefined;

  // Too many matches: keep the best (or closest) ones and say so, instead of a 40-minute walk.
  const pool = ranked ? reachable : [...reachable].sort((a, b) => dist(a) - dist(b));
  const best = shortestOrder(mapData, from, pool.slice(0, MAX_STOPS));
  if (!Number.isFinite(best.metres)) return undefined;
  return { label, stops: best.stops, metres: best.metres, total: reachable.length, skipped, ranked };
}
