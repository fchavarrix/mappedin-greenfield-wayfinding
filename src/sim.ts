import type { Coordinate, Directions, MapData } from '@mappedin/mappedin-js';
import type { Start, Store, Venue } from './venue';

/**
 * Thirty days of SIMULATED app usage for the operator view. What is real: the venue, its stores and
 * every route, computed by Mappedin on this map. What is simulated: who comes, where they park and
 * what they look for. Every number below is an assumption with a reference range, to be replaced by
 * Greenfield's own data (that is the point of the questions in the presentation).
 *
 * Only events the app itself would log are simulated: no cameras, no sensors, no sales.
 */
export type Assumption = { key: string; label: string; value: string; range: string; source: string };

export const ASSUMPTIONS: Assumption[] = [
  { key: 'visits', label: 'Visits per day (one property)', value: '22,000 avg (18k weekday, 30k weekend)', range: '15k–35k', source: 'Regional mall of ~830k sq ft; replace with door counts or parking data' },
  { key: 'adoption', label: 'Visitors who use the app', value: '4%', range: '2–8% in the first months', source: 'Depends on QR signage and promotion; measured from qr_scan + sessions' },
  { key: 'parking', label: 'Arrivals by parking area', value: 'Lot A 45% · Lot B 35% · Garage 20%', range: 'per property', source: 'Replace with QR scans per entrance after launch' },
  { key: 'routes', label: 'App sessions that start a route', value: '70%', range: '50–85%', source: 'The rest only browse or search; measured by route_started' },
  { key: 'mix', label: 'Routes by type', value: '70% one store · 20% two stores · 10% route by need', range: 'unknown before launch', source: 'Measured by route_started (single / category)' },
  { key: 'pull', label: 'Pull of an anchor vs a regular store', value: '6×', range: '3–10×', source: 'Gravity model; calibrate with store_selected per tenant' },
  { key: 'decay', label: 'Distance decay', value: 'half the pull every ~170 m', range: '100–300 m', source: 'Gravity model; calibrate with route lengths' },
  { key: 'arrival', label: 'Routes completed', value: '~88%', range: '80–95%', source: 'Measured by arrived vs route_abandoned' },
  { key: 'drop', label: 'Stops dropped from a route by need', value: '8% base · 35% for low-interest stores', range: 'unknown before launch', source: 'Measured by stop_removed' },
  { key: 'return', label: 'App users who come back within 30 days', value: '~24%', range: '15–35%', source: 'Anonymous device id; baseline for "visitor retention"' },
];

const DAYS = 30;
const VISITS_PER_DAY = 22_000;
const ADOPTION = 0.04;
const SAMPLE = 360; // sessions actually routed on the map, then scaled to the 30-day volume
const ROUTE_SHARE = 0.7; // share of app sessions that start a route (the rest only browse or search)
const PARKING_SHARE: Record<string, number> = { 'lot-a': 0.45, 'lot-b': 0.35, garage: 0.2 };

/** Seeded random numbers: the same "30 days" on every load and in every rehearsal. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Why a search found nothing, and which team acts on it. */
export type MissReason = 'tenant' | 'tag' | 'service';
export type MissedSearch = { term: string; count: number; reason: MissReason; note: string };

/**
 * Terms checked against Mappedin Search on this venue (all levels) that return no store at all.
 * The terms and the reasons are real; the volumes are simulated.
 */
const MISSED: { term: string; share: number; reason: MissReason; note: string }[] = [
  { term: 'cinema', share: 0.014, reason: 'tenant', note: 'No cinema in the mall' },
  { term: 'grocery', share: 0.009, reason: 'tenant', note: 'No grocery store' },
  { term: 'eyeglasses', share: 0.008, reason: 'tag', note: 'Lenscrafters exists but is not tagged for it' },
  { term: 'stroller', share: 0.006, reason: 'service', note: 'Stroller rental or parking: Guest Services info' },
  { term: 'tailor', share: 0.005, reason: 'tenant', note: 'No alterations service' },
  { term: 'bookstore', share: 0.005, reason: 'tenant', note: 'No bookstore' },
  { term: 'halal', share: 0.004, reason: 'tag', note: 'Restaurants do not say whether they serve it' },
  { term: 'optician', share: 0.004, reason: 'tag', note: 'Lenscrafters exists but is not tagged for it' },
  { term: 'wheelchair', share: 0.004, reason: 'service', note: 'Accessibility services not in the directory' },
  { term: 'dentist', share: 0.003, reason: 'tenant', note: 'No dental clinic' },
  { term: 'arcade', share: 0.003, reason: 'tenant', note: 'No arcade or play area' },
  { term: 'supermarket', share: 0.003, reason: 'tenant', note: 'No supermarket' },
];

export type TenantStats = {
  store: Store;
  exposure: number; // times on someone's route (30 days, scaled)
  searches: number; // searches + selections that pointed at this store (demand)
  visits: number; // routes that ended at this store
  categoryVisits: number; // visits that came from a route by need
  offered: number; // times offered inside a route by need
  dropped: number; // times the visitor removed it from that route
  zone: 'hot' | 'warm' | 'cold';
  diagnosis: 'healthy' | 'location' | 'interest' | 'both';
};

export type SimResult = {
  sessions: number;
  routes: number;
  categoryRoutes: number;
  arrivalRate: number;
  returnRate: number;
  byEntrance: { id: string; name: string; sessions: number }[];
  zeroSearches: MissedSearch[];
  tenants: TenantStats[];
  pareto: { topShare: number; topCount: number; exposureShare: number };
  hottest: string[];
};

type XY = [number, number];

export async function simulate(mapData: MapData, venue: Venue, onProgress?: (done: number, total: number) => void): Promise<SimResult> {
  const rand = rng(20261110);
  const tenants = venue.stores.filter((s) => s.mainLevel && s.location.type === 'tenant');
  const ref = tenants[0].space.center;
  const xy = (c: { latitude: number; longitude: number }): XY => [
    (c.longitude - ref.longitude) * 111_320 * Math.cos((ref.latitude * Math.PI) / 180),
    (c.latitude - ref.latitude) * 110_540,
  ];
  const centre = new Map(tenants.map((s) => [s.id, xy(s.space.center)]));

  // Each store gets a hidden "popularity" and some are low-interest (people drop them from routes).
  const popularity = new Map(tenants.map((s) => [s.id, Math.exp((rand() - 0.5) * 1.2) * (s.anchor ? 6 : s.category === 'Food & Drink' ? 1.6 : 1)]));
  const lowInterest = new Set(tenants.filter((s) => !s.anchor && rand() < 0.12).map((s) => s.id));

  const pickStart = () => {
    let r = rand();
    for (const s of venue.starts) {
      r -= PARKING_SHARE[s.id] ?? 1 / venue.starts.length;
      if (r <= 0) return s;
    }
    return venue.starts[0];
  };
  // Gravity: pull of a store = popularity × decay with distance from where the visitor is.
  const pick = (from: XY, exclude: Set<string>, pool = tenants) => {
    const weights = pool.map((s) => {
      if (exclude.has(s.id)) return 0;
      const c = centre.get(s.id)!;
      const d = Math.hypot(c[0] - from[0], c[1] - from[1]);
      return popularity.get(s.id)! * Math.pow(0.5, d / 170);
    });
    const total = weights.reduce((a, b) => a + b, 0);
    let r = rand() * total;
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i];
      if (r <= 0) return pool[i];
    }
    return pool[pool.length - 1];
  };

  const stat = new Map<string, Omit<TenantStats, 'zone' | 'diagnosis'>>(
    tenants.map((s) => [s.id, { store: s, exposure: 0, searches: 0, visits: 0, categoryVisits: 0, offered: 0, dropped: 0 }]),
  );
  const entranceCount = new Map<string, number>();
  const categories = [...new Set(tenants.map((t) => t.category))];
  let routed = 0, completed = 0, categoryRoutes = 0;

  const expose = (path: Coordinate[], skip: Set<string>) => {
    const pts = path.map(xy);
    for (const s of tenants) {
      if (skip.has(s.id)) continue;
      const q = centre.get(s.id)!;
      for (let k = 1; k < pts.length; k += 1) {
        const a = pts[k - 1], b = pts[k];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const len = dx * dx + dy * dy;
        const t = len ? Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / len)) : 0;
        if (Math.hypot(q[0] - a[0] - t * dx, q[1] - a[1] - t * dy) < 15) {
          stat.get(s.id)!.exposure++;
          break;
        }
      }
    }
  };

  for (let i = 0; i < SAMPLE; i++) {
    const start: Start = pickStart();
    entranceCount.set(start.id, (entranceCount.get(start.id) ?? 0) + 1);
    const startXY = xy('center' in start.target ? start.target.center : start.target);
    const r = rand();
    let dests: Store[];
    let category = false;
    if (r < 0.7) dests = [pick(startXY, new Set())];
    else if (r < 0.9) {
      const a = pick(startXY, new Set());
      dests = [a, pick(centre.get(a.id)!, new Set([a.id]))];
    } else {
      // Route by need: a category, up to 5 of its stores; low-interest ones are often dropped.
      category = true;
      categoryRoutes++;
      const cat = categories[Math.floor(rand() * categories.length)];
      const pool = tenants.filter((t) => t.category === cat);
      const offered = [...pool].sort(() => rand() - 0.5).slice(0, Math.min(5, pool.length));
      dests = offered.filter((s) => {
        const st = stat.get(s.id)!;
        st.offered++;
        const drop = rand() < (lowInterest.has(s.id) ? 0.35 : 0.08);
        if (drop) st.dropped++;
        return !drop;
      });
      if (dests.length === 0) continue;
    }
    for (const d of dests) stat.get(d.id)!.searches++;

    let legs: Directions[] | undefined;
    try {
      legs = await mapData.getDirectionsMultiDestination(start.target, dests.map((d) => d.space));
    } catch {
      legs = undefined;
    }
    if (!legs) continue;
    routed++;
    const done = rand() < (dests.length > 2 ? 0.82 : 0.9);
    if (done) completed++;
    const skip = new Set(dests.map((d) => d.id));
    legs.forEach((leg, li) => {
      expose(leg.coordinates, skip);
      if (done || li < legs!.length - 1) {
        const st = stat.get(dests[li].id)!;
        st.visits++;
        if (category) st.categoryVisits++;
      }
    });
    if (i % 30 === 0) {
      onProgress?.(i, SAMPLE);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  onProgress?.(SAMPLE, SAMPLE);

  // Scale the routed sample to 30 days of app sessions.
  const sessions = Math.round(VISITS_PER_DAY * ADOPTION * DAYS);
  const k = (sessions * ROUTE_SHARE) / SAMPLE;
  // Searches also include people who looked a store up without walking to it.
  const list = [...stat.values()].map((t) => ({
    ...t,
    exposure: Math.round(t.exposure * k),
    searches: Math.round((t.searches * 1.6 + popularity.get(t.store.id)! * 2) * k),
    visits: Math.round(t.visits * k),
    categoryVisits: Math.round(t.categoryVisits * k),
    offered: Math.round(t.offered * k),
    dropped: Math.round(t.dropped * k),
  }));

  // Zones by exposure; diagnosis by exposure vs demand (and drops from routes by need).
  const byExposure = [...list].sort((a, b) => b.exposure - a.exposure);
  const q = (arr: number[], p: number) => [...arr].sort((a, b) => a - b)[Math.floor(p * (arr.length - 1))];
  const exp25 = q(list.map((t) => t.exposure), 0.25);
  const exp66 = q(list.map((t) => t.exposure), 0.66);
  const dem15 = q(list.map((t) => t.searches), 0.15);
  const tenantsOut: TenantStats[] = list.map((t) => {
    const zone = t.exposure >= exp66 ? 'hot' : t.exposure > exp25 ? 'warm' : 'cold';
    // Anchors draw traffic by definition; the diagnosis is about the stores that depend on it.
    // A drop rate only counts with enough routes by need behind it (at least ~4 offers in the sample).
    const dropRate = t.offered >= 4 * k ? t.dropped / t.offered : 0;
    const lowExposure = zone === 'cold' && !t.store.anchor;
    const lowDemand = !t.store.anchor && (t.searches <= dem15 || dropRate > 0.3);
    const diagnosis = lowExposure && lowDemand ? 'both' : lowExposure ? 'location' : lowDemand ? 'interest' : 'healthy';
    return { ...t, zone, diagnosis };
  });

  const totalExposure = list.reduce((a, t) => a + t.exposure, 0) || 1;
  const topCount = Math.max(1, Math.round(list.length * 0.2));
  const topExposure = byExposure.slice(0, topCount).reduce((a, t) => a + t.exposure, 0);
  return {
    sessions,
    routes: Math.round(routed * k),
    categoryRoutes: Math.round(categoryRoutes * k),
    arrivalRate: routed ? completed / routed : 0,
    returnRate: 0.24,
    byEntrance: venue.starts.map((s) => ({ id: s.id, name: s.name, sessions: Math.round((entranceCount.get(s.id) ?? 0) * k) })),
    zeroSearches: MISSED.map((m) => ({ term: m.term, count: Math.round(sessions * m.share), reason: m.reason, note: m.note })),
    tenants: tenantsOut,
    pareto: { topShare: 0.2, topCount, exposureShare: topExposure / totalExposure },
    hottest: byExposure.slice(0, 3).map((t) => t.store.name),
  };
}
