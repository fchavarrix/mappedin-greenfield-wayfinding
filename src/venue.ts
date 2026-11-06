import type { Coordinate, EnterpriseLocation, Floor, MapData, Space } from '@mappedin/mappedin-js';

/** Where a visitor can start: one per parking area. The QR sign at each one opens `?from=<id>`. */
export type Start = { id: string; name: string; short: string; target: Space | Coordinate };

export type Store = {
  id: string;
  name: string;
  category: string;
  logo?: string;
  description?: string;
  space: Space;
  floor: Floor;
  mainLevel: boolean;
  location: EnterpriseLocation;
  anchor: boolean;
};

/**
 * Data fixes found while building on the demo venue. In a real deployment these go back to the
 * customer's content team in the CMS, not into code; they live here so the demo reads right.
 */
const NAME_FIXES: Record<string, string> = { Nordstorm: 'Nordstrom' };

/** Anchors, used to name mall entrances ("the entrance by Nordstrom") and to explain traffic flow. */
const ANCHORS = new Set(['Nordstrom', 'Bloomingdales', 'Holt Renfrew', 'H&M', 'Uniqlo']);

export type Venue = {
  main: Floor;
  starts: Start[];
  stores: Store[];
  bySpace: Map<string, Store>;
  entrances: Space[];
  categories: string[];
};

export function loadVenue(mapData: MapData): Venue {
  const floors = mapData.getByType('floor');
  const main = floors.find((f) => f.elevation === 0) ?? floors[0];
  const spaces = mapData.getByType('space');

  const stores: Store[] = [];
  const bySpace = new Map<string, Store>();
  for (const location of mapData.getByType('enterprise-location')) {
    if (location.type !== 'tenant' && location.type !== 'amenities') continue;
    if (location.hidden) continue;
    const space = location.spaces.find((s) => s.floor.id === main.id) ?? location.spaces[0];
    if (!space) continue;
    const category = location.categories.find((c) => !['Parking', 'Transportation'].includes(c.name))?.name;
    if (!category) continue;
    const name = NAME_FIXES[location.name] ?? location.name;
    const store: Store = {
      id: location.id,
      name,
      category,
      logo: location.logo || undefined,
      description: location.description || undefined,
      space,
      floor: space.floor,
      mainLevel: space.floor.id === main.id,
      location,
      anchor: ANCHORS.has(name),
    };
    stores.push(store);
    for (const s of location.spaces) if (!bySpace.has(s.id)) bySpace.set(s.id, store);
  }
  stores.sort((a, b) => a.name.localeCompare(b.name));

  const lot = (name: string) => spaces.find((s) => s.name === name);
  const garage = mapData.getByType('point-of-interest').find((p) => p.name === 'Parking Garage I');
  const starts: Start[] = [];
  const lotA = lot('Parking Lot A');
  const lotB = lot('Parking Lot B');
  if (lotA) starts.push({ id: 'lot-a', name: 'Parking Lot A', short: 'Lot A', target: lotA });
  if (lotB) starts.push({ id: 'lot-b', name: 'Parking Lot B', short: 'Lot B', target: lotB });
  if (garage) starts.push({ id: 'garage', name: 'Parking Garage', short: 'Garage', target: garage.coordinate });

  const entrances = spaces.filter((s) => s.name === 'Entrance' && s.floor.id === main.id);
  const categories = [...new Set(stores.filter((s) => s.mainLevel && s.location.type === 'tenant').map((s) => s.category))].sort();

  return { main, starts, stores, bySpace, entrances, categories };
}

/** Today's hours from the schema.org OpeningHoursSpecification the venue CMS provides. */
export function hoursToday(store: Store, now = new Date()) {
  const day = now.toLocaleDateString('en-US', { weekday: 'long' });
  const specs = (store.location.operationHours ?? []) as { dayOfWeek?: string[] | string; opens?: string; closes?: string }[];
  const spec = specs.find((s) => (Array.isArray(s.dayOfWeek) ? s.dayOfWeek : [s.dayOfWeek]).includes(day));
  if (!spec?.opens || !spec.closes) return undefined;
  const minutes = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + (m || 0);
  };
  const open = minutes(spec.opens);
  let close = minutes(spec.closes);
  if (open === 0 && close === 0) return { open: false, label: 'Closed today' };
  if (close <= open) close += 24 * 60;
  const t = now.getHours() * 60 + now.getMinutes();
  const fmt = (m: number) => {
    const d = new Date(2000, 0, 1, Math.floor(m / 60) % 24, m % 60);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: m % 60 ? '2-digit' : undefined });
  };
  if (t < open) return { open: false, label: `Opens ${fmt(open)}` };
  if (t >= close) return { open: false, label: 'Closed now' };
  const soon = close - t <= 30;
  return { open: true, soon, label: soon ? `Closes soon · ${fmt(close)}` : `Open · until ${fmt(close)}` };
}
