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

/** `in`: parking → store (the brief). `out`: store → parking (the trip back to the car). */
export type Trip = { from: string; to: string; direction: 'in' | 'out' };

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
  const inbound = trip.direction === 'in';

  // Stores that can serve as landmarks: on the main level, named, not the destination.
  const landmarks = venue.stores.filter((s) => s.mainLevel && s.location.type === 'tenant' && s.id !== destination.id);
  const centre = new Map(landmarks.map((s) => [s.id, xy(s.space.center)]));

  const nearestStore = (c: Coordinate, max: number, exclude: Set<string>) => {
    let best: Store | undefined, bestD = max;
    const p = xy(c);
    for (const s of landmarks) {
      if (exclude.has(s.id)) continue;
      const q = centre.get(s.id)!;
      const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (d < bestD) (bestD = d), (best = s);
    }
    return best;
  };

  // Where the route crosses the building's edge, named after the closest anchor so it matches the
  // signage. Inbound that is the first entrance on the path; outbound, the last one.
  let entrance: { index: number; label: string } | undefined;
  for (const e of venue.entrances) {
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

  const steps: Step[] = [];
  const used = new Set<string>();
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
    const landmark = type === 'Turn' ? nearestStore(coordinate, 22, used) : undefined;
    if (landmark) used.add(landmark.id);
    const passed = outside || distance < 15 ? [] : passingStores(segment);
    passed.forEach((s) => used.add(s.id));
    const passText = passed.length ? `You'll pass ${listNames(passed.slice(0, 3))}.` : '';

    let text: string, detail: string;
    if (type === 'Departure' && inbound && entrance) {
      text = `Walk to the mall entrance ${entrance.label}`;
      detail = `About ${fmtDistance(distance)} from ${trip.from}. Look for the ${sign} sign.`;
    } else if (type === 'Departure') {
      text = inbound ? `Leave ${trip.from} and head into the mall` : `Leave ${trip.from} and head back to ${trip.to}`;
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
    steps.push({ kind: 'arrive', text: `${destination.name} is ${side}`, detail: 'You have arrived.', path: [], distance: 0, floorId: destination.floor.id, passing: [] });
  } else {
    steps.push({ kind: 'arrive', text: `You're back at ${trip.to}`, detail: 'Thanks for visiting Greenfield Mall.', path: [], distance: 0, floorId: venue.main.id, passing: [] });
  }
  return finish(steps, path, entrance?.label);

  /** Stores the visitor walks past on a stretch, in the order they appear. */
  function passingStores(segment: Coordinate[]) {
    if (segment.length < 2) return [];
    const pts = segment.map(xy);
    const hits: { s: Store; t: number }[] = [];
    for (const s of landmarks) {
      if (used.has(s.id)) continue;
      const q = centre.get(s.id)!;
      for (let k = 1; k < pts.length; k++) {
        const { d, t } = distToSegment(q, pts[k - 1], pts[k]);
        if (d < 13) {
          hits.push({ s, t: k + t });
          break;
        }
      }
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
