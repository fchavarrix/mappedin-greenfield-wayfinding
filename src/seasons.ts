import type { EnterpriseLocation, MapData, MapView } from '@mappedin/mappedin-js';
import treeUrl from '@mappedin/3d-assets/binary/tree_pine?url';
import { metres } from './guidance';
import { labelPoint } from './geometry';
import type { CharacterKind } from './characters';
import type { Store, Venue } from './venue';

/**
 * Seasonal mode: operator configuration, not code. Each season is a date range plus what changes on
 * the map. Outside its dates nothing shows. A new season is one more entry in SEASONS.
 *
 * What a season does:
 * - a chip in the top bar ("Holidays at Greenfield · until Dec 31"),
 * - the mall entrances in the season's colour,
 * - a few flat decorations (pumpkins, gifts) by the entrances and the event, and trees for the holidays,
 * - the season's event as a destination: searchable, on the map, with a route and opening hours.
 *
 * `?season=halloween` or `?season=holidays` previews a season on any date; `?season=off` turns it off.
 */
export type Season = {
  id: string;
  name: string;
  /** Inclusive, month-day. */
  from: string;
  to: string;
  icon: string;
  /** White shape drawn inside the event's map pin (24 × 24). Plain SVG: map icons cannot carry emoji. */
  glyph: string;
  accent: string;
  entranceColor: string;
  /** Flat decoration placed by entrances and around the event (an SVG, drawn as a billboard). */
  decoration: string;
  /** Real 3D trees around the event (holidays). */
  trees: boolean;
  /** Characters that roam the coldest wings (characters.ts). */
  characters: CharacterKind[];
  event: {
    name: string;
    blurb: string;
    /** Searching any of these finds the event first. */
    keywords: string[];
    opens: string;
    closes: string;
  };
};

const svg = (body: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${body}</svg>`)}`;

const PUMPKIN = svg(
  `<ellipse cx="32" cy="38" rx="26" ry="20" fill="#f28c1b"/><ellipse cx="32" cy="38" rx="10" ry="20" fill="#e07a0c"/><rect x="29" y="12" width="6" height="10" rx="2" fill="#4f7d2a"/><path d="M20 34l5-6 5 6zM34 34l5-6 5 6z" fill="#3a2008"/><path d="M20 44q12 8 24 0l-4 4-4-3-4 3-4-3-4 3z" fill="#3a2008"/>`,
);
const GIFT = svg(
  `<rect x="10" y="26" width="44" height="30" rx="3" fill="#c8322f"/><rect x="8" y="18" width="48" height="10" rx="3" fill="#e0443f"/><rect x="29" y="18" width="6" height="38" fill="#f5d36b"/><path d="M32 18c-6-10-16-8-12-2 2 3 8 3 12 2zm0 0c6-10 16-8 12-2-2 3-8 3-12 2z" fill="#f5d36b"/>`,
);

export const SEASONS: Season[] = [
  {
    id: 'halloween',
    name: 'Halloween at Greenfield',
    from: '10-20',
    to: '10-31',
    icon: '🎃',
    glyph: '<ellipse cx="12" cy="14" rx="7" ry="5.5" fill="#fff"/><rect x="11" y="6" width="2" height="4" rx="1" fill="#fff"/>',
    accent: '#f28c1b',
    entranceColor: '#ffd9ad',
    decoration: PUMPKIN,
    trees: false,
    characters: ['ghost', 'pumpkin'],
    event: {
      name: 'Trick-or-Treat Central',
      blurb: 'Kids trick-or-treat at participating stores. Start here for the map and a bag.',
      keywords: ['halloween', 'trick', 'treat', 'candy', 'costume', 'pumpkin'],
      opens: '16:00',
      closes: '20:00',
    },
  },
  {
    id: 'holidays',
    name: 'Holidays at Greenfield',
    from: '11-15',
    to: '12-31',
    icon: '🎄',
    glyph: '<path d="M12 4l5 7h-3l4 5h-4l3 3H7l3-3H6l4-5H7z" fill="#fff"/>',
    accent: '#c8322f',
    entranceColor: '#d7ecdc',
    decoration: GIFT,
    trees: true,
    characters: ['santa', 'snowman'],
    event: {
      name: "Santa's Village",
      blurb: 'Photos with Santa, gift wrapping and the holiday gift guide.',
      keywords: ['santa', 'christmas', 'holiday', 'holidays', 'gift wrap', 'gift wrapping', 'xmas'],
      opens: '10:00',
      closes: '21:00',
    },
  },
];

/** Image3D draws raster images only: the SVG decorations are turned into PNGs once, in the browser. */
async function toPng(svgUrl: string, size = 256) {
  const img = new Image();
  img.src = svgUrl;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  canvas.getContext('2d')?.drawImage(img, 0, 0, size, size);
  return canvas.toDataURL('image/png');
}

/** Where the season's event happens in the demo venue: the west court, by the information desk. */
const EVENT_SPACE = 's_62042759e325474a30000090';

/** The active season: a `?season=` preview wins, otherwise today's date. */
export function activeSeason(now = new Date()): Season | undefined {
  const param = new URLSearchParams(location.search).get('season');
  if (param === 'off') return undefined;
  if (param) return SEASONS.find((s) => s.id === param);
  const md = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return SEASONS.find((s) => s.from <= md && md <= s.to);
}

const until = (s: Season) => new Date(`2000-${s.to}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/**
 * Applies a season to the visitor map and returns the event as a Store, so search, the store card,
 * routing and analytics treat it like any other destination.
 */
export function applySeason(season: Season, mapData: MapData, mapView: MapView, venue: Venue): Store | undefined {
  // Top-bar chip.
  const chip = document.getElementById('season');
  if (chip) {
    chip.innerHTML = `<span aria-hidden="true">${season.icon}</span><span><b>${season.name}</b><small>until ${until(season)}</small></span>`;
    chip.style.setProperty('--season', season.accent);
    chip.hidden = false;
  }

  const space = mapData.getById('space', EVENT_SPACE);

  // Entrances in the season's colour.
  for (const e of venue.entrances) mapView.updateState(e, { color: season.entranceColor });
  if (!space) return undefined;

  // The event: label, decorations around it, trees for the holidays.
  mapView.updateState(space, { color: season.entranceColor });
  const at = labelPoint(space);
  mapView.Labels.add(mapView.createCoordinate(at.latitude, at.longitude, venue.main), season.event.name, {
    rank: 'always-visible',
    appearance: { icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="${season.accent}"/>${season.glyph}</svg>`, iconSize: 26, textSize: 12, color: season.accent },
  });
  const ring = (r: number, n: number) =>
    Array.from({ length: n }, (_, i) => {
      const a = (i / n) * 2 * Math.PI;
      const lat = space.center.latitude + (r * Math.cos(a)) / 111_320;
      const lon = space.center.longitude + (r * Math.sin(a)) / (111_320 * Math.cos((space.center.latitude * Math.PI) / 180));
      return mapView.createCoordinate(lat, lon, venue.main);
    });
  // Decorations by each entrance and around the event (async: the SVG is rasterised first).
  void toPng(season.decoration).then((png) => {
    for (const e of venue.entrances) mapView.Image3D.add(e.center, png, { width: 4, height: 4, verticalOffset: 0.8, flipImageToFaceCamera: true });
    for (const at of ring(6, 4)) mapView.Image3D.add(at, png, { width: 3.2, height: 3.2, verticalOffset: 0.6, flipImageToFaceCamera: true });
  });
  if (season.trees) {
    // Trees only where they do not sit on a store.
    for (const at of ring(8, 3)) {
      if (venue.stores.some((s) => s.mainLevel && metres(s.space.center, at) < 4)) continue;
      mapView.Models.add(at, treeUrl, { scale: 0.9, interactive: false });
    }
  }

  // The event as a destination, with its own hours.
  const location = {
    id: `season-${season.id}`,
    name: season.event.name,
    type: 'tenant',
    description: season.event.blurb,
    operationHours: [
      {
        dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
        opens: season.event.opens,
        closes: season.event.closes,
      },
    ],
    spaces: [space],
    categories: [],
  } as unknown as EnterpriseLocation;
  const store: Store = {
    id: location.id,
    name: season.event.name,
    category: 'Seasonal event',
    description: season.event.blurb,
    space,
    floor: space.floor,
    mainLevel: true,
    location,
    anchor: false,
  };
  venue.stores.push(store);
  venue.bySpace.set(space.id, store);
  mapView.updateState(space, { interactive: true });
  return store;
}

/** True when a search should put the event first. */
export const matchesEvent = (season: Season, term: string) => {
  const t = term.toLowerCase();
  return t.length >= 2 && (season.event.name.toLowerCase().includes(t) || season.event.keywords.some((k) => k.startsWith(t) || t.includes(k)));
};
