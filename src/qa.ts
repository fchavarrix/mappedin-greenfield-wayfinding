import type { MapData } from '@mappedin/mappedin-js';
import { hoursToday, type Store, type Venue } from './venue';
import { nameCheck } from './geometry';

/**
 * Scripted QA over the live venue data, the same checks that produced QA.md. Open `?view=qa`.
 * Clicking 408 routes and 85 searches by hand is not realistic, and data gaps (a store with no door,
 * a missing tag) are invisible on the map: they only show up when every case is run.
 *
 * Five checks:
 * 1. Routing coverage: every parking area to every main-level store, through the SDK router.
 * 2. Search audit: everyday terms through Mappedin Search, sorted into buckets.
 * 3. Step-free routing: every parking area to every Upper Level store with `accessible: true`.
 * 4. Content completeness: what each tenant record is missing (logo, hours, description).
 * 5. Store names: whether each name lands inside its store (the map data's anchor vs. the app's point).
 *
 * The buckets in (2) are automatic. Whether a result is *misleading* ("bank" → a massage chair store)
 * is a human judgement: those terms keep the verdict of the Nov 6 review, and the report lists what each
 * term returns so a person can redo it. Any term whose automatic bucket differs from the deck is flagged.
 */

type Bucket = 'route' | 'one place' | 'upper only' | 'nothing';
type Expected = Bucket | 'misleading';

/** The 85 everyday searches behind the deck (slides 8–10), with the bucket each got on Nov 6, 2026. */
export const QA_TERMS: Record<Expected, string[]> = {
  route: [
    'coffee', 'tea', 'pizza', 'chocolate', 'frozen yogurt', 'shoes', 'sneakers', 'running', 'boots', 'jeans', 'denim', 'dress',
    'lingerie', 'maternity', 'winter jackets', 'yoga', 'watch', 'jewelry', 'sunglasses', 'makeup', 'hair', 'nails', 'phone',
    'phone repair', 'gifts', 'bags',
  ],
  'one place': [
    'burger', 'sushi', 'ice cream', 'suits', 'baby', 'outdoor', 'sportswear', 'barber', 'massage', 'kitchen', 'candles', 'pets',
    'vitamins', 'pharmacy', 'restroom',
  ],
  'upper only': ['perfume', 'skincare', 'glasses', 'luggage', 'video games'],
  nothing: [
    'cinema', 'grocery', 'supermarket', 'bookstore', 'dentist', 'tailor', 'arcade', 'eyeglasses', 'optician', 'halal', 'stroller',
    'wheelchair',
  ],
  // Human review: the results exist but don't match the need.
  misleading: [
    'bank', 'electronics', 'movies', 'dessert', 'gym', 'toy store', 'lost and found', 'shoe repair', 'atm', 'dollar store',
    'fast food', 'food court', 'bubble tea', 'vegan', 'plus size', 'kids', 'home', 'spa', 'currency exchange', 'books', 'toys',
    'lego', 'watch repair', 'wifi', 'charging', 'post office', 'key cutting',
  ],
};

type RouteRow = { from: string; store: string; ok: boolean };
type SearchRow = { term: string; expected: Expected; main: number; upper: number; bucket: Bucket; top: string[]; mainNames: string[] };

/**
 * Human corrections to the automatic bucket, kept only while the search still returns the same main-level stores.
 * If the results change, the override stops applying and the term shows up as changed.
 */
const REVIEWED: Record<string, { main: string; bucket: Bucket; why: string }> = {
  'video games': { main: 'Naturalizer', bucket: 'upper only', why: 'the only main-level match is a shoe store; EB Games and Nintendo are upstairs' },
};
type ContentRow = { store: string; missing: string[] };

export async function runQa(mapData: MapData, venue: Venue, onProgress: (text: string) => void) {
  const tenants = venue.stores.filter((s) => s.mainLevel && s.location.type === 'tenant');

  // 1. Routing coverage
  const routes: RouteRow[] = [];
  for (const start of venue.starts) {
    for (const store of tenants) {
      let ok = false;
      try {
        ok = !!(await mapData.getDirections(start.target, store.space));
      } catch {
        ok = false;
      }
      routes.push({ from: start.short, store: store.name, ok });
      if (routes.length % 20 === 0) onProgress(`Routing ${routes.length} / ${venue.starts.length * tenants.length}…`);
    }
  }
  const failed = routes.filter((r) => !r.ok);
  // A store that fails from every start has a data problem (usually no door), not a routing one.
  const unreachable = [...new Set(failed.map((r) => r.store))].filter((name) => failed.filter((r) => r.store === name).length === venue.starts.length);

  // 2. Search audit, across both levels
  const byId = new Map(venue.stores.map((s) => [s.location.id, s]));
  const searches: SearchRow[] = [];
  for (const [expected, terms] of Object.entries(QA_TERMS) as [Expected, string[]][]) {
    for (const term of terms) {
      const res = await mapData.Search.query(term);
      const found = (res.enterpriseLocations ?? []).map((r) => byId.get(r.item.id)).filter((s): s is Store => !!s);
      const main = found.filter((s) => s.mainLevel && s.location.type === 'tenant');
      // Amenities (restrooms) can't build a store route, but the nearest one is still a direct route.
      const amenity = found.some((s) => s.mainLevel && s.location.type !== 'tenant');
      const upper = found.filter((s) => !s.mainLevel);
      let bucket: Bucket = main.length >= 2 ? 'route' : main.length === 1 || amenity ? 'one place' : upper.length ? 'upper only' : 'nothing';
      if (REVIEWED[term] && main.map((s) => s.name).join() === REVIEWED[term].main) bucket = REVIEWED[term].bucket;
      searches.push({ term, expected, main: main.length, upper: upper.length, bucket, top: found.slice(0, 4).map((s) => s.name), mainNames: main.map((s) => s.name) });
    }
  }
  // A misleading term that now finds nothing is also a change worth a second look.
  const drift = searches.filter((s) => (s.expected === 'misleading' ? s.bucket === 'nothing' : s.bucket !== s.expected));
  onProgress('Search audit done');

  // 3. Step-free routing: every parking area to every Upper Level store with `accessible: true`.
  // The main level has no level changes, so this is where the toggle matters: the hand-off must be an elevator.
  const connections = (d: Awaited<ReturnType<MapData['getDirections']>>) =>
    (d?.instructions ?? []).map((i) => (i.action as { connection?: { type?: string } }).connection?.type).filter((t): t is string => !!t);
  const upperStores = venue.stores.filter((s) => !s.mainLevel && s.location.type === 'tenant');
  const stepFree = { routes: 0, reached: 0, elevatorOnly: 0, switched: 0, blocked: [] as string[] };
  for (const start of venue.starts) {
    for (const store of upperStores) {
      stepFree.routes++;
      const [normal, accessible] = await Promise.all([
        mapData.getDirections(start.target, store.space).catch(() => undefined),
        mapData.getDirections(start.target, store.space, { accessible: true }).catch(() => undefined),
      ]);
      if (!accessible) {
        stepFree.blocked.push(`${start.short} → ${store.name}`);
        continue;
      }
      stepFree.reached++;
      const types = connections(accessible);
      if (types.length && types.every((t) => t.toLowerCase() === 'elevator')) stepFree.elevatorOnly++;
      if (connections(normal).some((t) => t.toLowerCase() !== 'elevator')) stepFree.switched++;
    }
    onProgress(`Step-free routes from ${start.short} done`);
  }

  // 4. Content completeness
  const content: ContentRow[] = tenants
    .map((s) => ({
      store: s.name,
      missing: [!s.logo && 'logo', !hoursToday(s) && 'hours', !s.description && 'description', unreachable.includes(s.name) && 'door / route'].filter(
        (x): x is string => !!x,
      ),
    }))
    .filter((r) => r.missing.length);

  // 5. Where each store's name goes: the map data's anchor against the point the app computes.
  const names = { outside: [] as string[], onEdge: [] as string[], oursInside: 0, oursMin: 1, checked: 0 };
  for (const s of tenants) {
    const c = nameCheck(s.space);
    if (!c) continue;
    names.checked++;
    if (c.anchor < 0) names.outside.push(s.name);
    else if (c.anchor < 1 / 3) names.onEdge.push(s.name);
    if (c.ours > 0) names.oursInside++;
    names.oursMin = Math.min(names.oursMin, c.ours);
  }

  return { tenants: tenants.length, routes, failed, unreachable, searches, drift, stepFree, upper: upperStores.length, content, names };
}

export function renderQa(el: HTMLElement, r: Awaited<ReturnType<typeof runQa>>) {
  const count = (e: Expected) => r.searches.filter((s) => s.expected === e && !r.drift.includes(s)).length;
  const fails = r.searches.filter((s) => s.expected === 'nothing' || s.expected === 'misleading').length;
  const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  el.innerHTML = `
    <h2>Scripted QA · ${new Date().toISOString().slice(0, 10)}</h2>
    <p><b>Routing:</b> ${r.routes.length - r.failed.length} of ${r.routes.length} routes found (${r.tenants} main-level stores × every parking area).
    Unreachable from every start: <b>${r.unreachable.map(esc).join(', ') || 'none'}</b>.</p>
    <p><b>Step-free (accessible) routing:</b> ${r.stepFree.reached} of ${r.stepFree.routes} routes to the ${r.upper} Upper Level stores found
    (${r.upper} stores × every parking area); ${r.stepFree.elevatorOnly} use elevators only, and ${r.stepFree.switched} would otherwise take an escalator.
    No step-free route: <b>${r.stepFree.blocked.map(esc).join(', ') || 'none'}</b>.</p>
    <p><b>Store names on the map:</b> the map data's own anchor falls outside the store for ${r.names.outside.length}
    (${r.names.outside.map(esc).join(', ') || 'none'}) and against a wall for ${r.names.onEdge.length} of ${r.names.checked}.
    The app places each name from the outline instead: ${r.names.oursInside} of ${r.names.checked} inside, the shallowest at
    ${Math.round(r.names.oursMin * 100)}% of the store's depth.</p>
    <p><b>Search (${r.searches.length} terms, both levels):</b> route ${count('route')} · one place ${count('one place')} · upper level only ${count('upper only')} · nothing ${count('nothing')} · misleading ${count('misleading')} (human review, Nov 6).
    ${fails} of ${r.searches.length} (${Math.round((fails / r.searches.length) * 100)}%) find nothing or the wrong stores.</p>
    <p><b>Changed since the deck (Nov 6):</b> ${
      r.drift.length ? r.drift.map((s) => `${esc(s.term)} (${s.expected} → ${s.bucket})`).join(', ') : 'none, every term lands where the deck says'
    }.</p>
    <table><thead><tr><th>Term</th><th>Deck</th><th>Today</th><th>Main</th><th>Upper</th><th>Top results</th></tr></thead><tbody>
    ${r.searches
      .map(
        (s) =>
          `<tr${r.drift.includes(s) ? ' class="qa-drift"' : ''}><td>${esc(s.term)}</td><td>${s.expected}</td><td>${s.bucket}</td><td title="${esc(s.mainNames.join(', '))}">${s.main}</td><td>${s.upper}</td><td>${esc(s.top.join(', '))}</td></tr>`,
      )
      .join('')}
    </tbody></table>
    <p><b>Content gaps:</b> ${r.content.length} of ${r.tenants} stores miss something.</p>
    <table><thead><tr><th>Store</th><th>Missing</th></tr></thead><tbody>
    ${r.content.map((c) => `<tr><td>${esc(c.store)}</td><td>${c.missing.join(', ')}</td></tr>`).join('')}
    </tbody></table>`;
}
