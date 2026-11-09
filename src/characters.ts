import type { Coordinate, MapData, MapView } from '@mappedin/mappedin-js';
import { metres } from './guidance';
import type { Store, Venue } from './venue';

/**
 * Seasonal characters: a ghost and a pumpkin-head wandering the corridors at Halloween, Santa's sleigh
 * flying across the mall for the holidays. Decorative for now (catching them for a coupon is the
 * "what's next", like the "Catch me if you can" demo).
 *
 * They are not random: they roam the coldest wings, the ones the operator view flags as getting the
 * least foot traffic, so the visitor's eye goes where the tenants need it most.
 *
 * Rules: one character of each kind at a time, a new appearance every 20–40 s, about 15 s to cross;
 * nothing while a route is on screen; nothing at all if the device asks for reduced motion.
 */
export type CharacterKind = 'ghost' | 'pumpkin' | 'santa';

const ART: Record<CharacterKind, string> = {
  ghost: `<svg viewBox="0 0 64 72" width="46" height="52" aria-hidden="true">
    <ellipse cx="32" cy="68" rx="14" ry="3" fill="#000" opacity=".12"/>
    <path d="M10 34C10 18 20 6 32 6s22 12 22 28v24l-6-5-5 6-5-6-6 6-6-6-5 6-5-6-4 4z" fill="#fff" stroke="#c9cbe0" stroke-width="2"/>
    <ellipse cx="25" cy="30" rx="3.5" ry="5" fill="#2b2b3a"/><ellipse cx="39" cy="30" rx="3.5" ry="5" fill="#2b2b3a"/>
    <ellipse cx="32" cy="42" rx="4" ry="3" fill="#2b2b3a"/></svg>`,
  pumpkin: `<svg viewBox="0 0 64 84" width="44" height="58" aria-hidden="true">
    <ellipse cx="32" cy="80" rx="14" ry="3" fill="#000" opacity=".12"/>
    <rect x="22" y="40" width="20" height="24" rx="5" fill="#3b2a4a"/>
    <rect x="23" y="62" width="6" height="16" rx="3" fill="#2a1e36"/><rect x="35" y="62" width="6" height="16" rx="3" fill="#2a1e36"/>
    <rect x="14" y="42" width="8" height="5" rx="2.5" fill="#3b2a4a"/><rect x="42" y="42" width="8" height="5" rx="2.5" fill="#3b2a4a"/>
    <ellipse cx="32" cy="26" rx="18" ry="15" fill="#f28c1b"/><ellipse cx="32" cy="26" rx="7" ry="15" fill="#e07a0c"/>
    <rect x="30" y="6" width="4" height="7" rx="1.5" fill="#4f7d2a"/>
    <path d="M22 22l4-5 4 5zM34 22l4-5 4 5z" fill="#3a2008"/><path d="M22 30q10 7 20 0l-3 3-3-2-4 2-3-2-4 2z" fill="#3a2008"/></svg>`,
  santa: `<svg viewBox="0 0 150 64" width="120" height="51" aria-hidden="true">
    <ellipse cx="80" cy="60" rx="52" ry="3" fill="#000" opacity=".10"/>
    <g fill="#8a5a33"><ellipse cx="128" cy="30" rx="12" ry="6"/><ellipse cx="102" cy="32" rx="12" ry="6"/>
      <rect x="120" y="34" width="3" height="10"/><rect x="132" y="34" width="3" height="10"/><rect x="94" y="36" width="3" height="10"/><rect x="106" y="36" width="3" height="10"/>
      <circle cx="140" cy="24" r="5"/><circle cx="114" cy="26" r="5"/></g>
    <path d="M139 18l-3-7m6 6l3-7M113 20l-3-7m6 6l3-7" stroke="#5a3a1e" stroke-width="2" stroke-linecap="round"/>
    <circle cx="144" cy="24" r="2.2" fill="#e0443f"/>
    <path d="M90 32H70" stroke="#c9a14a" stroke-width="1.5"/><path d="M116 30H90" stroke="#c9a14a" stroke-width="1.5"/>
    <path d="M14 30h56l-6 18H22q-8 0-10-8z" fill="#c8322f"/><path d="M8 52h62" stroke="#c9a14a" stroke-width="3" stroke-linecap="round"/>
    <circle cx="42" cy="22" r="8" fill="#f2c9a5"/><path d="M34 22q8 14 16 0" fill="#fff"/>
    <path d="M33 18q9-14 18 0z" fill="#c8322f"/><circle cx="52" cy="10" r="3" fill="#fff"/><rect x="32" y="17" width="20" height="4" rx="2" fill="#fff"/>
    <rect x="18" y="20" width="12" height="12" rx="2" fill="#2f8f4e"/><rect x="23" y="20" width="2" height="12" fill="#f5d36b"/></svg>`,
};

/** How long a crossing takes, how often a character comes back. */
const CROSS_MS = 15_000;
const GAP_MS: [number, number] = [20_000, 40_000];
const FIRST_MS: [number, number] = [4_000, 9_000];

const between = ([a, b]: [number, number]) => a + Math.random() * (b - a);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function startCharacters(
  kinds: CharacterKind[],
  mapData: MapData,
  mapView: MapView,
  venue: Venue,
  busy: () => boolean,
): () => void {
  if (!kinds.length || matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {};
  let stopped = false;

  // The coldest wings, from the same seeded simulation as the operator view (about 0.4 s, in the background).
  const tenants = venue.stores.filter((s) => s.mainLevel && s.location.type === 'tenant' && !s.anchor);
  let cold: Store[] = tenants;
  void import('./sim').then(async ({ simulate }) => {
    const res = await simulate(mapData, venue);
    const ids = new Set(res.tenants.filter((t) => t.zone === 'cold' && !t.store.anchor).map((t) => t.store.id));
    const found = tenants.filter((s) => ids.has(s.id));
    if (found.length >= 4) cold = found;
  });

  /** A corridor stretch between two cold storefronts 30–90 m apart. */
  async function pickPath(fly: boolean): Promise<Coordinate[] | undefined> {
    for (let tries = 0; tries < 8; tries++) {
      const a = cold[Math.floor(Math.random() * cold.length)];
      const options = cold.filter((b) => b !== a && metres(a.space.center, b.space.center) > (fly ? 60 : 30) && metres(a.space.center, b.space.center) < (fly ? 160 : 90));
      const b = options[Math.floor(Math.random() * options.length)];
      if (!b) continue;
      if (fly) return [a.space.center, b.space.center];
      const d = await mapData.getDirections(a.space, b.space).catch(() => undefined);
      const pts = d?.coordinates.filter((c) => c.floorId === venue.main.id);
      if (pts && pts.length >= 2) return pts;
    }
    return undefined;
  }

  /** Faces the way it moves on screen, whatever the camera bearing. */
  function facesLeft(a: Coordinate, b: Coordinate) {
    const bearing = ((mapView.Camera.bearing ?? 0) * Math.PI) / 180;
    const east = (b.longitude - a.longitude) * Math.cos((a.latitude * Math.PI) / 180);
    const north = b.latitude - a.latitude;
    return east * Math.cos(bearing) - north * Math.sin(bearing) < 0;
  }

  async function run(kind: CharacterKind) {
    await wait(between(FIRST_MS));
    while (!stopped) {
      if (!busy()) await appear(kind);
      await wait(between(GAP_MS));
    }
  }

  async function appear(kind: CharacterKind) {
    const fly = kind === 'santa';
    const path = await pickPath(fly);
    if (!path || stopped || busy()) return;
    const marker = mapView.Markers.add(path[0], `<div class="char char-${kind}${facesLeft(path[0], path[path.length - 1]) ? ' left' : ''}">${ART[kind]}</div>`, {
      rank: 'always-visible',
      interactive: false,
      placement: 'center',
      occlude: false,
      dynamicResize: false,
      zIndex: 5,
    });
    const el = () => marker.contentEl.querySelector<HTMLElement>('.char');
    requestAnimationFrame(() => el()?.classList.add('on'));
    // Walk the path at an even speed so the whole crossing takes about CROSS_MS.
    const legs = path.slice(1).map((p, i) => metres(path[i], p));
    const total = legs.reduce((a, b) => a + b, 0) || 1;
    for (let i = 1; i < path.length && !stopped && !busy(); i++) {
      el()?.classList.toggle('left', facesLeft(path[i - 1], path[i]));
      await mapView.Markers.animateTo(marker, path[i], { duration: Math.max(120, (legs[i - 1] / total) * CROSS_MS) }).catch(() => undefined);
    }
    el()?.classList.remove('on');
    await wait(600);
    mapView.Markers.remove(marker);
  }

  kinds.forEach((k) => void run(k));
  return () => {
    stopped = true;
  };
}
