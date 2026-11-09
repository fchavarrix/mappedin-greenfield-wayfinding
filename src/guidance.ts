import type { Coordinate, Directions, Space } from '@mappedin/mappedin-js';
import type { Store, Venue } from './venue';

/**
 * Turns the SDK's raw instructions ("Turn Right, 51 m") into steps a first-time visitor can follow:
 * every turn is tied to a storefront they can see, every walk lists the stores they pass, and the
 * last step says which side the store is on. Naming the stores along the way is also what puts
 * smaller tenants in front of shoppers, not just the anchors.
 */

export type StepKind = 'start' | 'left' | 'right' | 'slight-left' | 'slight-right' | 'straight' | 'back' | 'up' | 'down' | 'arrive';

export type Step = {
  kind: StepKind;
  text: string;
  detail?: string;
  /** Path coordinates this step covers (the walk after the action). Empty on arrival. */
  path: Coordinate[];
  distance: number;
  floorId: string;
  /** The storefront the instruction is anchored to ("turn right at …"). */
  landmark?: Store;
  passing: Store[];
};

export type Guidance = { steps: Step[]; distance: number; minutes: number; passing: Store[]; entrance?: string };

/**
 * `in`: parking → store (the brief). `next`: store → store inside a multi-stop route. `out`: store →
 * parking (the trip back to the car). `avoid`: stores that are stops of the same route, so they are
 * not used as landmarks or as "you'll pass".
 */
export type Trip = { from: string; to: string; direction: 'in' | 'next' | 'out'; avoid?: string[] };

// Local equirectangular projection: plenty for a few hundred metres.
type XY = [number, number];
const toXY = (c: { latitude: number; longitude: number }, ref: { latitude: number; longitude: number }): XY => [
  (c.longitude - ref.longitude) * 111_320 * Math.cos((ref.latitude * Math.PI) / 180),
  (c.latitude - ref.latitude) * 110_540,
];
export const metres = (a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) => Math.hypot(...toXY(a, b));

function distToSegment(p: XY, a: XY, b: XY) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0;
  return { d: Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy), t };
}

function pathLength(path: Coordinate[]) {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += metres(path[i - 1], path[i]);
  return total;
}

/** Index of the path vertex closest to a coordinate, searching forward from `from`. */
function indexOn(path: Coordinate[], c: Coordinate, from: number) {
  let best = from, bestD = Infinity;
  for (let i = from; i < path.length; i++) {
    const d = metres(path[i], c);
    if (d < bestD) (bestD = d), (best = i);
  }
  return best;
}

/** Smallest gap between two outlines (0 when they share a wall), from each one's corners to the other's edges. */
function ringGap(a: XY[], b: XY[]) {
  const toRing = (p: XY, r: XY[]) => {
    let d = Infinity;
    for (let k = 1; k < r.length; k++) d = Math.min(d, distToSegment(p, r[k - 1], r[k]).d);
    return d;
  };
  if (a.length < 2 || b.length < 2) return Infinity;
  return Math.min(...a.map((p) => toRing(p, b)), ...b.map((p) => toRing(p, a)));
}

/** The polyline without its first `m` metres (unchanged if it is shorter than that). */
function trimStart(pts: XY[], m: number): XY[] {
  let left = m;
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1], b = pts[k];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len >= left) {
      const t = len ? left / len : 0;
      return [[a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])], ...pts.slice(k)];
    }
    left -= len;
  }
  return pts;
}

/** How close a storefront must be to a turn to name it, and to the walk to say "you'll pass" it. */
const TURN_RADIUS = 12;
const PASS_RADIUS = 7;

/** The store's footprint as lat/lon points (closed ring); its centre if the map has no polygon. */
function storeOutline(s: Store): { latitude: number; longitude: number }[] {
  const g = (s.space as unknown as { geoJSON?: { geometry?: { type: string; coordinates: unknown } } }).geoJSON?.geometry;
  const ring =
    g?.type === 'Polygon'
      ? (g.coordinates as [number, number][][])[0]
      : g?.type === 'MultiPolygon'
        ? (g.coordinates as [number, number][][][])[0][0]
        : undefined;
  return ring?.length ? ring.map(([longitude, latitude]) => ({ latitude, longitude })) : [s.space.center];
}

const listNames = (stores: Store[]) => {
  const names = stores.map((s) => s.name);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
};

const roundM = (m: number) => (m < 20 ? Math.max(5, Math.round(m / 5) * 5) : Math.round(m / 10) * 10);
export const fmtDistance = (m: number) => `${roundM(m)} m`;
/** Average indoor walking pace for a first-time visitor who is also reading a phone. */
export const walkMinutes = (m: number) => Math.max(1, Math.round(m / 1.1 / 60));

type Point = { type: string; at: number; bearing?: string; coordinate: Coordinate; connection?: string };

export function buildGuidance(directions: Directions, venue: Venue, destination: Store, trip: Trip): Guidance {
  const path = directions.coordinates;
  const ref = path[0];
  const xy = (c: { latitude: number; longitude: number }) => toXY(c, ref);
  const inbound = trip.direction !== 'out';

  // Stores that can serve as landmarks: on the main level, named, not the destination.
  const avoid = new Set([destination.id, ...(trip.avoid ?? [])]);
  // Two tenants can share one space in the map data (Take Five Cafe and Excel Jewellers): the one
  // sharing the destination's (or a stop's) unit is the same storefront, not a landmark or a neighbour.
  const avoidSpaces = new Set(venue.stores.filter((s) => avoid.has(s.id)).map((s) => s.space.id));
  const landmarks = venue.stores.filter((s) => s.mainLevel && s.location.type === 'tenant' && !avoid.has(s.id) && !avoidSpaces.has(s.space.id));
  // Distances are measured to the store's outline, not its centre: a visitor sees the storefront.
  // By centre, a small store set back from a corner beats the big one whose front is on it.
  const outline = new Map(landmarks.map((s) => [s.id, storeOutline(s).map(xy)]));
  /** Closest point of the store's outline to `p`, and how far it is. */
  const closest = (s: Store, p: XY): { d: number; q: XY } => {
    const ring = outline.get(s.id)!;
    if (ring.length === 1) return { d: Math.hypot(p[0] - ring[0][0], p[1] - ring[0][1]), q: ring[0] };
    let best = { d: Infinity, q: ring[0] };
    for (let k = 1; k < ring.length; k++) {
      const a = ring[k - 1], b = ring[k];
      const { d, t } = distToSegment(p, a, b);
      if (d < best.d) best = { d, q: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])] };
    }
    return best;
  };
  const toStore = (s: Store, p: XY) => closest(s, p).d;

  /** Signed offset of `q` from the line through `p` along `dir`: + left, − right (metres). */
  const side = (p: XY, dir: XY, q: XY) => (dir[0] * (q[1] - p[1]) - dir[1] * (q[0] - p[0])) / (Math.hypot(...dir) || 1);

  /**
   * The landmark of a turn: the storefront on the inside corner, the one on the turning side both
   * before and after the corner (the store you walk around). Falls back to the closest storefront.
   * A store across the corridor you came along can be closer, but it isn't the corner you turn at.
   */
  const turnStore = (at: number, kind: StepKind, max: number, exclude: Set<string>) => {
    const p = xy(path[at]);
    const back = xy(path[walkFrom(at, -1)]), ahead = xy(path[walkFrom(at, 1)]);
    const inDir: XY = [p[0] - back[0], p[1] - back[1]], outDir: XY = [ahead[0] - p[0], ahead[1] - p[1]];
    const sign = kind === 'left' || kind === 'slight-left' ? 1 : kind === 'right' || kind === 'slight-right' ? -1 : 0;
    let inside: Store | undefined, insideD = max, any: Store | undefined, anyD = max;
    for (const s of landmarks) {
      if (exclude.has(s.id)) continue;
      const { d, q } = closest(s, p);
      if (d >= max) continue;
      if (d < anyD) (anyD = d), (any = s);
      const onSide = (dir: XY) => sign * side(p, dir, q) > -1.5; // a metre and a half of slack at the corner
      if (sign && onSide(inDir) && onSide(outDir) && d < insideD) (insideD = d), (inside = s);
    }
    return inside ?? any;
  };

  /** Path index about 8 m before (-1) or after (+1) `at`, for the walking direction at a corner. */
  function walkFrom(at: number, step: -1 | 1) {
    let i = at, walked = 0;
    while (i + step >= 0 && i + step < path.length && walked < 8) {
      walked += metres(path[i], path[i + step]);
      i += step;
    }
    return i === at ? Math.max(0, Math.min(path.length - 1, at + step)) : i;
  }

  // Where the route crosses the building's edge, named after the closest anchor so it matches the
  // signage. Inbound that is the first entrance on the path; outbound, the last one.
  let entrance: { index: number; label: string } | undefined;
  // Store to store inside the mall: no building edge to cross.
  for (const e of trip.direction === 'next' ? [] : venue.entrances) {
    const ec = xy(e.center);
    const near = (c: Coordinate) => {
      const p = xy(c);
      return Math.hypot(p[0] - ec[0], p[1] - ec[1]) < 14;
    };
    const index = inbound ? path.findIndex(near) : path.length - 1 - [...path].reverse().findIndex(near);
    if (index < 0 || index >= path.length) continue;
    if (entrance && (inbound ? entrance.index <= index : entrance.index >= index)) continue;
    entrance = { index, label: entranceLabel(e, venue, xy) };
  }

  // Action points along the path. Outside, across a parking lot, people walk straight to the door
  // (or the car) they can see, so the SDK's outdoor turns collapse into one step, and crossing the
  // entrance becomes a step of its own: it is the moment the visitor needs to re-orient.
  const raw: Point[] = [];
  let cursor = 0;
  for (const ins of directions.instructions) {
    const at = indexOn(path, ins.coordinate, cursor);
    cursor = at;
    raw.push({
      type: ins.action.type as string,
      at,
      bearing: ins.action.bearing as string | undefined,
      coordinate: ins.coordinate,
      connection: (ins.action as { connection?: { type?: string } }).connection?.type,
    });
  }
  const outdoors = (at: number) => !!entrance && (inbound ? at <= entrance.index + 1 : at >= entrance.index - 1);
  const points: Point[] = [];
  for (const p of raw) {
    if (p.type === 'Turn') {
      if (outdoors(p.at)) continue;
      const prev = points[points.length - 1];
      if (prev && pathLength(path.slice(prev.at, p.at + 1)) < 4) continue; // initial heading, not a turn
    }
    if (entrance && p.type !== 'Departure' && !points.some((q) => q.type === 'Entrance') && p.at > entrance.index) {
      points.push({ type: 'Entrance', at: entrance.index, coordinate: path[entrance.index] });
    }
    points.push(p);
  }

  // Each turn gets the storefront closest to the corner first. Only an earlier turn's landmark is
  // excluded: a store mentioned as "you'll pass" on the way can still be the corner you turn at.
  const turnLandmark = new Map<number, Store>();
  const landmarkIds = new Set<string>();
  points.forEach((p, i) => {
    if (p.type !== 'Turn') return;
    const s = turnStore(p.at, bearingKind(p.bearing), TURN_RADIUS, landmarkIds);
    if (s) turnLandmark.set(i, s), landmarkIds.add(s.id);
  });

  // The destination's next-door store, to finish with "Second Cup is on your right, next to
  // Naturalizer": a small storefront is easy to miss, the neighbour is the one the visitor just
  // turned at. Among the stores sharing a wall with the destination, the last turn's landmark wins,
  // then the one closest to the door.
  const destRing = storeOutline(destination).map(xy);
  const door = xy(path[path.length - 1]);
  const lastTurnStore = [...turnLandmark.entries()].sort((a, b) => b[0] - a[0])[0]?.[1];
  const nextDoor = (() => {
    if (!inbound || destRing.length < 2) return undefined;
    const touching = landmarks.filter((s) => ringGap(outline.get(s.id)!, destRing) < 1.5);
    if (lastTurnStore && touching.includes(lastTurnStore)) return lastTurnStore;
    return touching.sort((a, b) => toStore(a, door) - toStore(b, door))[0];
  })();

  const steps: Step[] = [];
  // Stores already named, so "you'll pass" never repeats them or names an upcoming corner.
  const used = new Set<string>(landmarkIds);
  const sign = entrance?.label.replace(/^(by|next to) /, '');
  for (let i = 0; i < points.length; i++) {
    const { type, at, coordinate } = points[i];
    if (type === 'Arrival') break;

    if (type === 'TakeConnection') {
      // Main level only in this release: hand off at the escalator / elevator.
      const connection = (points[i].connection ?? 'escalator').toLowerCase();
      const up = destination.floor.elevation > venue.main.elevation;
      steps.push({
        kind: up ? 'up' : 'down',
        text: `Take the ${connection} ${up ? 'up' : 'down'} to the ${destination.floor.name}`,
        detail: `${destination.name} is on the ${destination.floor.name}. Follow the signs when you step off.`,
        path: [],
        distance: 0,
        floorId: coordinate.floorId ?? venue.main.id,
        passing: [],
      });
      return finish(steps, path.slice(0, at + 1), entrance?.label);
    }

    const end = points[i + 1]?.at ?? path.length - 1;
    const segment = path.slice(at, end + 1);
    const distance = pathLength(segment);
    const outside = (inbound && type === 'Departure' && !!entrance) || (!inbound && type === 'Entrance');

    // The storefront at a turn is the landmark; the ones along an indoor walk are "you'll pass".
    const kind: StepKind = type === 'Departure' ? 'start' : type === 'Entrance' ? 'straight' : bearingKind(points[i].bearing);
    const landmark = turnLandmark.get(i);
    const passed = outside || distance < 15 ? [] : passingStores(segment);
    passed.forEach((s) => used.add(s.id));
    const passText = passed.length ? `You'll pass ${listNames(passed.slice(0, 3))}.` : '';

    let text: string, detail: string;
    if (type === 'Departure' && inbound && entrance) {
      text = `Walk to the mall entrance ${entrance.label}`;
      detail = `About ${fmtDistance(distance)} from ${trip.from}. Look for the ${sign} sign.`;
    } else if (type === 'Departure') {
      text =
        trip.direction === 'in'
          ? `Leave ${trip.from} and head into the mall`
          : trip.direction === 'next'
            ? `Leave ${trip.from} and head to ${trip.to}`
            : `Leave ${trip.from} and head back to ${trip.to}`;
      detail = `Walk ${fmtDistance(distance)}. ${passText}`;
    } else if (type === 'Entrance' && inbound) {
      text = 'Go inside and walk straight ahead';
      detail = `Walk ${fmtDistance(distance)}. ${passText}`;
    } else if (type === 'Entrance') {
      text = `Exit the mall ${entrance!.label}`;
      detail = `${trip.to} is about ${fmtDistance(distance)} from the doors.`;
    } else {
      text = landmark ? `${VERB[kind]} at ${landmark.name}` : VERB[kind];
      detail = `Then walk ${fmtDistance(distance)}. ${passText}`;
    }
    steps.push({ kind, text, detail: detail.trim(), path: segment, distance, floorId: venue.main.id, landmark, passing: passed });
  }

  // Two turns a few steps apart read as one move: "Turn left at Purdy's, then right at Subway".
  const TURNS: StepKind[] = ['left', 'right', 'slight-left', 'slight-right'];
  for (let i = 0; i < steps.length - 1; i++) {
    const a = steps[i], b = steps[i + 1];
    if (a.distance >= 8 || !TURNS.includes(b.kind) || !(TURNS.includes(a.kind) || a.kind === 'straight')) continue;
    steps.splice(i, 2, {
      ...b,
      kind: a.kind === 'straight' ? b.kind : a.kind,
      text: `${a.text}, then ${b.text.replace(/^Turn /, '').replace(/^Bear /, 'bear ')}`,
      path: [...a.path, ...b.path.slice(1)],
      distance: a.distance + b.distance,
      landmark: a.landmark ?? b.landmark,
      passing: [...a.passing, ...b.passing],
    });
    i--;
  }

  // Arrival: which side the storefront is on, from the direction of the last stretch.
  if (inbound) {
    const last = path[path.length - 1];
    const prev = path[Math.max(0, path.length - 4)];
    const [ax, ay] = xy(prev), [bx, by] = xy(last), [sx, sy] = xy(destination.space.center);
    const cross = (bx - ax) * (sy - by) - (by - ay) * (sx - bx);
    const dot = (bx - ax) * (sx - bx) + (by - ay) * (sy - by);
    const angle = (Math.atan2(cross, dot) * 180) / Math.PI; // + is left of the walking direction
    const side = Math.abs(angle) < 40 ? 'straight ahead' : angle > 0 ? 'on your left' : 'on your right';
    const beside = nextDoor ? `, next to ${nextDoor.name}` : '';
    // The step that turns at the neighbour already says where the destination is.
    const lastWalk = steps[steps.length - 1];
    if (nextDoor && lastWalk?.landmark === nextDoor) lastWalk.detail = `${lastWalk.detail} ${destination.name} is right next to ${nextDoor.name}.`.trim();
    // The turn into the destination itself is just "Turn left" / "Turn right": by then the visitor is
    // at the door, and a store name there reads as if that store were the destination. The landmark
    // stays on the step so its name is still highlighted on the map.
    if (lastWalk && TURNS.includes(lastWalk.kind) && lastWalk.distance < 25 && lastWalk.landmark && lastWalk.text === `${VERB[lastWalk.kind]} at ${lastWalk.landmark.name}`) {
      lastWalk.text = VERB[lastWalk.kind];
    }
    steps.push({ kind: 'arrive', text: `${destination.name} is ${side}${beside}`, detail: 'You have arrived.', path: [], distance: 0, floorId: destination.floor.id, passing: [] });
  } else {
    steps.push({ kind: 'arrive', text: `You're back at ${trip.to}`, detail: 'Thanks for visiting Greenfield Mall.', path: [], distance: 0, floorId: venue.main.id, passing: [] });
  }
  return finish(steps, path, entrance?.label);

  /** Stores the visitor walks past on a stretch, in the order they appear. */
  function passingStores(segment: Coordinate[]) {
    if (segment.length < 2) return [];
    // Skip the first few metres: the stores there are the corner just turned, not ones you walk past.
    const pts = trimStart(segment.map(xy), 6);
    const hits: { s: Store; t: number }[] = [];
    for (const s of landmarks) {
      // Anchors can name a corner (they match the signage), but "you'll pass" is the smaller tenants.
      if (used.has(s.id) || s.anchor) continue;
      // Closest approach between the walk and the storefront: outline corners to the walk, and the
      // walk's points to the outline (a long front between two corners).
      let best = { d: Infinity, t: 0 };
      for (const q of outline.get(s.id)!) {
        for (let k = 1; k < pts.length; k++) {
          const { d, t } = distToSegment(q, pts[k - 1], pts[k]);
          if (d < best.d) best = { d, t: k + t };
        }
      }
      pts.forEach((p, k) => {
        const d = toStore(s, p);
        if (d < best.d) best = { d, t: k };
      });
      if (best.d < PASS_RADIUS) hits.push({ s, t: best.t });
    }
    return hits.sort((a, b) => a.t - b.t).map((h) => h.s).slice(0, 4);
  }
}

function finish(steps: Step[], path: Coordinate[], entrance?: string): Guidance {
  const distance = pathLength(path);
  const seen = new Set<string>();
  const passing = steps.flatMap((s) => s.passing).filter((s) => !seen.has(s.id) && seen.add(s.id));
  return { steps, distance, minutes: walkMinutes(distance), passing, entrance };
}

const VERB: Record<StepKind, string> = {
  start: 'Start',
  left: 'Turn left',
  right: 'Turn right',
  'slight-left': 'Bear left',
  'slight-right': 'Bear right',
  straight: 'Continue straight',
  back: 'Turn around',
  up: 'Go up',
  down: 'Go down',
  arrive: 'Arrive',
};

function bearingKind(bearing?: string): StepKind {
  switch (bearing) {
    case 'Left':
      return 'left';
    case 'Right':
      return 'right';
    case 'SlightLeft':
      return 'slight-left';
    case 'SlightRight':
      return 'slight-right';
    case 'Back':
      return 'back';
    default:
      return 'straight';
  }
}

function entranceLabel(entrance: Space, venue: Venue, xy: (c: Coordinate) => XY) {
  const e = xy(entrance.center);
  const rank = (stores: Store[]) =>
    stores
      .map((s) => {
        const p = xy(s.space.center);
        return { s, d: Math.hypot(p[0] - e[0], p[1] - e[1]) };
      })
      .sort((a, b) => a.d - b.d)[0];
  const main = venue.stores.filter((s) => s.mainLevel && s.location.type === 'tenant');
  const anchor = rank(main.filter((s) => s.anchor));
  if (anchor && anchor.d < 90) return `by ${anchor.s.name}`;
  const any = rank(main);
  return any ? `next to ${any.s.name}` : '';
}
