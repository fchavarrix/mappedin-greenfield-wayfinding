import type { Coordinate, MapView } from '@mappedin/mappedin-js';
import type { Venue } from './venue';

/**
 * A 3D airship that circles slowly over the mall, towing a banner. Pure delight, like the seasonal
 * characters, with one job worth pitching: the banner is a slot the mall can sell or use for its own
 * campaign (the season's event, a sponsor, an opening), seen by every visitor who opens the map.
 *
 * The model (public/models/zeppelin.glb) is built by scripts/make-zeppelin.mjs from three.js primitives.
 * It flies an ellipse around the main level at ~45 m, bobbing gently, nose along its path; one lap
 * takes about 90 s. The banner is an HTML layer over the map, projected from the airship's real altitude
 * every frame (map Markers sit on the floor, so one would lag far below the ship). Off with `?decor=0` or `?zeppelin=0`, and when the device asks for reduced motion.
 */
const LAP_MS = 90_000;
const ALTITUDE = 45;
const BOB = 1.6;

export function startZeppelin(mapView: MapView, venue: Venue, host: HTMLElement, banner: string): () => void {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {};

  // The main level's footprint, from its spaces: the orbit hugs it with a little margin.
  const centres = venue.stores.filter((s) => s.mainLevel).map((s) => s.space.center);
  if (centres.length < 2) return () => {};
  const lat0 = centres.reduce((a, c) => a + c.latitude, 0) / centres.length;
  const lon0 = centres.reduce((a, c) => a + c.longitude, 0) / centres.length;
  const mLat = 111_320;
  const mLon = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const xs = centres.map((c) => (c.longitude - lon0) * mLon);
  const ys = centres.map((c) => (c.latitude - lat0) * mLat);
  const rx = Math.max(60, (Math.max(...xs) - Math.min(...xs)) * 0.5);
  const ry = Math.max(60, (Math.max(...ys) - Math.min(...ys)) * 0.5);
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
  const cy = (Math.max(...ys) + Math.min(...ys)) / 2;

  /** A point on the orbit at angle `a`, `up` metres high, `back` metres behind along the path. */
  const at = (a: number, up: number, back = 0): { coord: Coordinate; heading: number } => {
    // Counter-clockwise ellipse; the tangent gives the heading (degrees, 0 = east, counter-clockwise).
    const dx = -rx * Math.sin(a), dy = ry * Math.cos(a);
    const len = Math.hypot(dx, dy) || 1;
    const x = cx + rx * Math.cos(a) - (dx / len) * back;
    const y = cy + ry * Math.sin(a) - (dy / len) * back;
    return {
      coord: mapView.createCoordinate({ latitude: lat0 + y / mLat, longitude: lon0 + x / mLon, floorId: venue.main.id, verticalOffset: up }),
      heading: (Math.atan2(dy, dx) * 180) / Math.PI,
    };
  };

  // The model's coordinate stays on the floor; its height is the state's verticalOffset (setting both adds them).
  const start = at(0, 0);
  const model = mapView.Models.add(start.coord, `${import.meta.env.BASE_URL}models/zeppelin.glb`, {
    interactive: false,
    verticalOffset: ALTITUDE,
    rotation: [0, 0, start.heading],
  });

  // Banner layer: a rope from the tail and the banner it tows, both placed in screen pixels.
  const layer = document.createElement('div');
  layer.className = 'zep-layer';
  layer.innerHTML = `<svg><line/></svg><div class="zep-banner"></div>`;
  layer.querySelector('.zep-banner')!.textContent = banner;
  host.appendChild(layer);
  const rope = layer.querySelector('line')!;
  const flag = layer.querySelector<HTMLElement>('.zep-banner')!;

  if (import.meta.env.DEV) Object.assign(window, { zeppelin: { model, layer } });

  let stopped = false;
  const t0 = performance.now();
  let last = 0;
  const tick = (now: number) => {
    if (stopped) return;
    // ~30 fps is plenty for something this slow, and halves the work on a phone.
    if (now - last > 33) {
      last = now;
      const t = now - t0;
      const a = ((t % LAP_MS) / LAP_MS) * Math.PI * 2;
      const up = ALTITUDE + Math.sin(t / 2600) * BOB;
      const roll = Math.sin(t / 3700) * 2.5; // a faint sway, so it reads as floating
      const p = at(a, 0);
      mapView.updateState(model, { position: p.coord, verticalOffset: up, rotation: [roll, 0, p.heading] });
      // The tail is 17 m behind the centre; the banner trails 16 m further back and a little lower.
      const tail = mapView.getScreenCoordinateFromCoordinate(at(a, up, 17).coord);
      const end = mapView.getScreenCoordinateFromCoordinate(at(a, up - 3 + Math.sin(t / 900) * 0.6, 33).coord);
      const ok = [tail, end].every((q) => q && Number.isFinite(q.x) && Number.isFinite(q.y));
      layer.hidden = !ok;
      if (ok) {
        rope.setAttribute('x1', String(tail.x));
        rope.setAttribute('y1', String(tail.y));
        rope.setAttribute('x2', String(end.x));
        rope.setAttribute('y2', String(end.y));
        // Rope end is the banner's leading edge: sit the banner on the far side of it.
        const left = end.x < tail.x;
        flag.style.transform = `translate(${end.x}px, ${end.y}px) translate(${left ? '-100%' : '0'}, -50%)`;
        flag.classList.toggle('left', left);
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  return () => {
    stopped = true;
    mapView.Models.remove(model);
    layer.remove();
  };
}
