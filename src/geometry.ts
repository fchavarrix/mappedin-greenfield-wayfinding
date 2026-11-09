/**
 * Where to put a store's name on the map. The map data's own anchor (`space.center`) sits on or
 * outside the outline for some stores (Naturalizer, Holt Renfrew, Gap…), so the name reads as the
 * neighbour's. This picks a point from the polygon itself: its centroid when that lies well inside,
 * otherwise the point deepest inside the shape (an L-shaped store keeps its name in the middle of
 * the L, not on a corner).
 */
type LatLon = { latitude: number; longitude: number };
type XY = [number, number];

type Geo = { geoJSON?: { geometry?: { type: string; coordinates: unknown } } };

/** The polygon's rings (outer first, then holes) as lon/lat pairs, or undefined if there is none. */
export function rings(space: unknown): [number, number][][] | undefined {
  const g = (space as Geo).geoJSON?.geometry;
  if (g?.type === 'Polygon') return g.coordinates as [number, number][][];
  if (g?.type === 'MultiPolygon') {
    // The largest part carries the name.
    const parts = g.coordinates as [number, number][][][];
    return parts.reduce((a, b) => (Math.abs(area(b[0])) > Math.abs(area(a[0])) ? b : a));
  }
  return undefined;
}

function area(r: [number, number][]) {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return a / 2;
}

/** Signed distance from `p` to the outline: positive inside, negative outside (metres). */
function depth(p: XY, poly: XY[][]) {
  let inside = false;
  let d = Infinity;
  for (const r of poly) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const a = r[i], b = r[j];
      if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len = dx * dx + dy * dy;
      const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0;
      d = Math.min(d, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy));
    }
  }
  return inside ? d : -d;
}

function centroid(r: XY[]): XY {
  let a = 0, x = 0, y = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const f = r[j][0] * r[i][1] - r[i][0] * r[j][1];
    a += f;
    x += (r[j][0] + r[i][0]) * f;
    y += (r[j][1] + r[i][1]) * f;
  }
  return a ? [x / (3 * a), y / (3 * a)] : r[0];
}

/** The point deepest inside the polygon: a coarse grid, then two finer passes around the best cell. */
function deepest(poly: XY[][]): { p: XY; d: number } {
  const xs = poly[0].map((p) => p[0]), ys = poly[0].map((p) => p[1]);
  let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  let best = { p: centroid(poly[0]), d: depth(centroid(poly[0]), poly) };
  for (let pass = 0; pass < 3; pass++) {
    const step = Math.max(x1 - x0, y1 - y0) / 24 || 1;
    for (let x = x0; x <= x1 + 1e-9; x += step) {
      for (let y = y0; y <= y1 + 1e-9; y += step) {
        const d = depth([x, y], poly);
        if (d > best.d) best = { p: [x, y], d };
      }
    }
    // Zoom in around the best point found so far.
    [x0, x1, y0, y1] = [best.p[0] - step, best.p[0] + step, best.p[1] - step, best.p[1] + step];
  }
  return best;
}

/**
 * For the scripted QA: how deep a point sits in the store, as a share of the deepest point possible
 * (1 = the middle, 0 = on the wall, below 0 = outside), for the map data's anchor and for ours.
 */
export function nameCheck(space: { center: LatLon }): { anchor: number; ours: number } | undefined {
  const raw = rings(space);
  if (!raw?.length) return undefined;
  const ref = space.center;
  const k = Math.cos((ref.latitude * Math.PI) / 180);
  const toXY = (c: LatLon): XY => [(c.longitude - ref.longitude) * 111_320 * k, (c.latitude - ref.latitude) * 110_540];
  const poly = raw.map((r) => r.map(([longitude, latitude]) => toXY({ latitude, longitude })));
  const best = deepest(poly).d || 1;
  return { anchor: depth(toXY(space.center), poly) / best, ours: depth(toXY(labelPoint(space)), poly) / best };
}

/** How deep (as a share of the deepest possible) the centroid must sit to be used as is. */
const CENTROID_OK = 0.6;

const cache = new WeakMap<object, LatLon>();

/** The point to anchor a store's name (and its stop pin): inside the shape, away from its edges. */
export function labelPoint(space: { center: LatLon }): LatLon {
  const hit = cache.get(space);
  if (hit) return hit;
  const raw = rings(space);
  let out: LatLon = space.center;
  if (raw?.length) {
    const ref = space.center;
    const k = Math.cos((ref.latitude * Math.PI) / 180);
    const toXY = ([lon, lat]: [number, number]): XY => [(lon - ref.longitude) * 111_320 * k, (lat - ref.latitude) * 110_540];
    const back = ([x, y]: XY): LatLon => ({ latitude: ref.latitude + y / 110_540, longitude: ref.longitude + x / (111_320 * k) });
    const poly = raw.map((r) => r.map(toXY));
    const c = centroid(poly[0]);
    const best = deepest(poly);
    out = back(depth(c, poly) >= CENTROID_OK * best.d ? c : best.p);
  }
  cache.set(space, out);
  return out;
}
