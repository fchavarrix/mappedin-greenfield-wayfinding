import type { Coordinate, MapData, MapView, Space } from '@mappedin/mappedin-js';
import carUrl from '@mappedin/3d-assets/binary/car?url';
import treeUrl from '@mappedin/3d-assets/binary/tree_pine_short?url';
import plantUrl from '@mappedin/3d-assets/binary/plant_2?url';
import { metres } from './guidance';
import type { Store, Venue } from './venue';

/**
 * Map decoration, built only from the SDK and the venue data. Every piece has a job:
 * - category tints make a "route by need" read as one group of colour,
 * - service icons (elevators first) make the step-free route visible on the map,
 * - parking stalls, cars and trees make "the experience starts in the parking lot" literal.
 * Everything here is optional: `?decor=0` turns it all off (low-end phones, a slow demo).
 * Models come from Mappedin's own 3D assets library (@mappedin/3d-assets, same licence as the SDK).
 */

/**
 * The outdoor basemap (OpenStreetMap) has a body of water that overlaps Parking Lot B in the demo venue.
 * The venue is placed on a real site; for Greenfield the lot is what matters, so the water layers are hidden.
 */
function hideOutdoorWater(mapView: MapView) {
  type StyleMap = { getStyle(): { layers: { id: string; 'source-layer'?: string }[] }; setLayoutProperty(id: string, k: string, v: string): void; on(e: string, f: () => void): void };
  const map = (mapView.Outdoor as unknown as { map?: StyleMap }).map;
  if (!map) return;
  const apply = () => {
    try {
      for (const l of map.getStyle().layers) {
        if (l['source-layer'] === 'water' || l['source-layer'] === 'water_name') map.setLayoutProperty(l.id, 'visibility', 'none');
      }
    } catch {
      // Style not loaded yet: the 'styledata' event below runs it again.
    }
  };
  apply();
  map.on('styledata', apply);
}

/** Soft tints, light enough that labels, the route and the selected-store colour stay readable on top. */
const CATEGORY_TINT: Record<string, string> = {
  "Women's Fashion": '#f6e3ec',
  "Men's Fashion": '#e3e9f6',
  "Children's Clothing": '#fdf0d9',
  Footwear: '#efe6f7',
  'Food & Drink': '#fde8d7',
  'Health & Beauty': '#f9e1e6',
  Electronics: '#dfeefa',
  Home: '#ece8df',
  'Jewellery & Watches': '#f5efd6',
  'Sports & Fitness': '#dff3e9',
  Finance: '#e6ecef',
  Specialty: '#eeeae3',
};

const ICON = {
  elevator: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#1a73e8"/><path d="M8 10l2-2 2 2M12 14l2 2 2-2" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 8v8M14 8v8" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  escalator: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#5f6b7a"/><path d="M5 17h3l7-9h4" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  restroom: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#0f7a55"/><circle cx="8.5" cy="7" r="1.6" fill="#fff"/><circle cx="15.5" cy="7" r="1.6" fill="#fff"/><path d="M7 10h3v8H7zM13.5 10h4l-1 5h-2z" fill="#fff"/></svg>`,
  info: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#4248ff"/><circle cx="12" cy="7.5" r="1.5" fill="#fff"/><path d="M12 11v6" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>`,
};

/** The library's car is modelled larger than a real one; this fits it inside a 2.6 m × 5.2 m stall. */
const CAR_SCALE = 0.5;

type Car = { model: ReturnType<MapView['Models']['add']>; at: Coordinate };

export type Decor = {
  /** Colour a store should go back to after it stops being selected. */
  baseColor(store: Store): string;
  /** Hide the cars that would sit on top of the route being shown; call with no route to bring them back. */
  clearRouteOf(path: Coordinate[] | undefined): void;
  /** Step-free on: elevators always visible and highlighted; escalators step back. */
  setStepFree(on: boolean): void;
};

/** Deterministic random numbers, so the parked cars are the same on every load and every rehearsal. */
function seeded(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Local metric frame around an origin, enough for a parking lot (no projection error worth caring about). */
function frame(origin: Coordinate) {
  const mLat = 111_320;
  const mLon = 111_320 * Math.cos((origin.latitude * Math.PI) / 180);
  return {
    toXY: (lon: number, lat: number) => [(lon - origin.longitude) * mLon, (lat - origin.latitude) * mLat] as [number, number],
    toLonLat: (x: number, y: number) => [origin.longitude + x / mLon, origin.latitude + y / mLat] as [number, number],
  };
}

const inside = (p: [number, number], ring: [number, number][]) => {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};

function outerRing(space: Space): [number, number][] | undefined {
  const g = (space as unknown as { geoJSON?: { geometry?: { type: string; coordinates: unknown } } }).geoJSON?.geometry;
  if (!g) return undefined;
  if (g.type === 'Polygon') return (g.coordinates as [number, number][][])[0];
  if (g.type === 'MultiPolygon') return (g.coordinates as [number, number][][][])[0][0];
  return undefined;
}

export function decorate(mapData: MapData, mapView: MapView, venue: Venue): Decor {
  // 1. Outdoor clean-up
  hideOutdoorWater(mapView);

  // 2. Category tints on the main level
  const tint = (s: Store) => (s.mainLevel && s.location.type === 'tenant' && !s.anchor ? CATEGORY_TINT[s.category] : undefined);
  for (const s of venue.stores) {
    const c = tint(s);
    if (c) mapView.updateState(s.space, { color: c });
  }

  // 3. Service icons: elevators, escalators, restrooms, information
  const main = venue.main.id;
  const elevatorLabels: ReturnType<MapView['Labels']['add']>[] = [];
  const escalatorLabels: ReturnType<MapView['Labels']['add']>[] = [];
  const placed: Coordinate[] = [];
  const near = (c: Coordinate, m: number) => placed.some((p) => metres(p, c) < m);
  for (const conn of mapData.getByType('connection')) {
    const kind = conn.type === 'elevator' ? 'elevator' : conn.type === 'escalator' ? 'escalator' : undefined;
    const at = conn.coordinates.find((c) => c.floorId === main);
    if (!kind || !at || near(at, 4)) continue;
    placed.push(at);
    const label = mapView.Labels.add(at, kind === 'elevator' ? 'Elevator' : 'Escalator', {
      rank: kind === 'elevator' ? 'high' : 'medium',
      appearance: { icon: ICON[kind], iconSize: 22, textSize: 11, color: kind === 'elevator' ? '#1a73e8' : '#5f6b7a' },
    });
    (kind === 'elevator' ? elevatorLabels : escalatorLabels).push(label);
  }
  for (const s of mapData.getByType('space')) {
    if (s.floor.id !== main || !s.name) continue;
    const kind = /restroom|washroom/i.test(s.name) ? 'restroom' : /information|guest services/i.test(s.name) ? 'info' : undefined;
    if (!kind || near(s.center, 6)) continue;
    placed.push(s.center);
    mapView.Labels.add(s.center, kind === 'restroom' ? 'Restrooms' : 'Info', {
      rank: 'medium',
      appearance: { icon: ICON[kind], iconSize: 20, textSize: 11, color: kind === 'restroom' ? '#0f7a55' : '#4248ff' },
    });
  }

  // 4. Parking lots: stall lines, parked cars, trees on the edge
  const rand = seeded(20261110);
  const cars: Car[] = [];
  for (const start of venue.starts) {
    const lot = start.target as unknown as Space;
    if ((lot as { __type?: string }).__type !== 'space') continue;
    const ring = outerRing(lot);
    if (!ring) continue;
    const f = frame(lot.center);
    const poly = ring.map(([lon, lat]) => f.toXY(lon, lat));

    // Stalls run along the lot's longest edge.
    let best = 0, angle = 0;
    for (let i = 0; i < poly.length - 1; i++) {
      const dx = poly[i + 1][0] - poly[i][0], dy = poly[i + 1][1] - poly[i][1];
      const len = Math.hypot(dx, dy);
      if (len > best) (best = len), (angle = Math.atan2(dy, dx));
    }
    const ux = [Math.cos(angle), Math.sin(angle)], vx = [-Math.sin(angle), Math.cos(angle)];
    const toWorld = (u: number, v: number) => [u * ux[0] + v * vx[0], u * ux[1] + v * vx[1]] as [number, number];
    const us = poly.map(([x, y]) => x * ux[0] + y * ux[1]), vs = poly.map(([x, y]) => x * vx[0] + y * vx[1]);
    const [u0, u1, v0, v1] = [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];

    const W = 2.6, D = 5.2, AISLE = 7, PERIOD = 2 * D + AISLE;
    const lines: [number, number][][] = [];
    for (let vb = v0 + 3; vb + 2 * D < v1 - 3; vb += PERIOD) {
      for (const [rowStart, facing] of [[vb, 1], [vb + D, -1]] as const) {
        for (let u = u0 + 3; u + W < u1 - 3; u += W) {
          const corners = [toWorld(u, rowStart), toWorld(u + W, rowStart), toWorld(u, rowStart + D), toWorld(u + W, rowStart + D)];
          if (!corners.every((c) => inside(c, poly))) continue;
          // Stall divider (one line per stall edge).
          lines.push([f.toLonLat(...toWorld(u, rowStart)), f.toLonLat(...toWorld(u, rowStart + D))]);
          if (rand() < 0.38) {
            const [x, y] = toWorld(u + W / 2, rowStart + D / 2);
            const [lon, lat] = f.toLonLat(x, y);
            const at = mapView.createCoordinate(lat, lon, venue.main);
            const heading = (90 - (angle * 180) / Math.PI + (facing > 0 ? 90 : -90) + 360) % 360;
            const model = mapView.Models.add(at, carUrl, { rotation: [0, 0, heading], scale: CAR_SCALE, interactive: false });
            cars.push({ model, at });
          }
        }
      }
    }
    if (lines.length) {
      mapView.Shapes.add(
        { type: 'FeatureCollection', features: lines.map((coords) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } })) },
        { color: '#ffffff', width: 0.14 },
        venue.main,
      );
    }

    // Trees along the lot edge, slightly inside it, every ~18 m.
    for (let i = 0; i < poly.length - 1; i++) {
      const [a, b] = [poly[i], poly[i + 1]];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let d = 6; d < len - 6; d += 18) {
        const t = d / len;
        const p: [number, number] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        const c: [number, number] = [poly.reduce((s, q) => s + q[0], 0) / poly.length, poly.reduce((s, q) => s + q[1], 0) / poly.length];
        const k = 1.6 / Math.hypot(c[0] - p[0], c[1] - p[1]);
        const q: [number, number] = [p[0] + (c[0] - p[0]) * k, p[1] + (c[1] - p[1]) * k];
        if (!inside(q, poly)) continue;
        const [lon, lat] = f.toLonLat(...q);
        mapView.Models.add(mapView.createCoordinate(lat, lon, venue.main), treeUrl, { scale: 0.9 + rand() * 0.4, rotation: [0, 0, rand() * 360], interactive: false });
      }
    }
  }

  // 5. A few plants by the information desks.
  for (const s of mapData.getByType('space')) {
    if (s.floor.id !== main || !/information|guest services/i.test(s.name ?? '')) continue;
    mapView.Models.add(s.center, plantUrl, { scale: 1, interactive: false });
  }

  let hidden: Car[] = [];
  return {
    baseColor: (s) => tint(s) ?? 'initial',
    clearRouteOf(path) {
      for (const c of hidden) mapView.updateState(c.model, { visible: true });
      hidden = [];
      if (!path?.length) return;
      // A parked car on top of the blue line hides where to walk.
      hidden = cars.filter((c) => path.some((p) => metres(p, c.at) < 3.5));
      for (const c of hidden) mapView.updateState(c.model, { visible: false });
    },
    setStepFree(on) {
      for (const l of elevatorLabels) mapView.updateState(l, { rank: on ? 'always-visible' : 'high' });
      for (const l of escalatorLabels) mapView.updateState(l, { rank: on ? 'initial' : 'medium', appearance: { color: on ? '#a5adb8' : '#5f6b7a' } });
    },
  };
}
