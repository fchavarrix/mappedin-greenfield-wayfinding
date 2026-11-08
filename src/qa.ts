import type { MapData } from '@mappedin/mappedin-js';
import { hoursToday, type Store, type Venue } from './venue';

/**
 * Scripted QA over the live venue data, the same checks that produced QA.md. Open `?view=qa`.
 * Clicking 408 routes and 85 searches by hand is not realistic, and data gaps (a store with no door,
 * a missing tag) are invisible on the map: they only show up when every case is run.
 *
 * Three checks:
 * 1. Routing coverage: every parking area to every main-level store, through the SDK router.
 * 2. Search audit: everyday terms through Mappedin Search, sorted into buckets.
 * 3. Content completeness: what each tenant record is missing (logo, hours, description).
 *
 * The buckets in (2) are automatic. Whether a result is *misleading* ("bank" → a massage chair store)
 * is a human judgement, so the report lists what each term returns for a person to review.
 */

/** Everyday searches tested for the presentation (Nov 6, 2026). */
export const QA_TERMS = [
  // build a route on the main level
  'coffee', 'tea', 'pizza', 'chocolate', 'frozen yogurt', 'shoes', 'sneakers', 'running', 'boots', 'jeans', 'denim', 'dress',
  'lingerie', 'maternity', 'winter jackets', 'yoga', 'watch', 'jewelry', 'sunglasses', 'makeup', 'hair', 'nails', 'phone',
  'phone repair', 'gifts', 'bags',
  // one place
  'burger', 'sushi', 'ice cream', 'suits', 'baby', 'outdoor', 'sportswear', 'barber', 'massage', 'kitchen', 'candles', 'pets',
  'vitamins', 'pharmacy', 'restroom',
  // upper level only
  'perfume', 'skincare', 'glasses', 'luggage', 'video games',
  // nothing at all
  'cinema', 'grocery', 'supermarket', 'bookstore', 'dentist', 'tailor', 'arcade', 'eyeglasses', 'optician', 'halal', 'stroller',
  'wheelchair',
  // reviewed as misleading (named in the deck)
  'bank', 'electronics', 'movies', 'dessert', 'gym', 'toy store', 'lost and found', 'dollar store', 'fast food', 'food court',
  'bubble tea', 'vegan', 'kids', 'home', 'spa', 'books', 'toys', 'wifi',
];

type RouteRow = { from: string; store: string; ok: boolean };
type SearchRow = { term: string; main: number; upper: number; bucket: 'route' | 'one place' | 'upper only' | 'nothing'; top: string[] };
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
  for (const term of QA_TERMS) {
    const res = await mapData.Search.query(term);
    const found = (res.enterpriseLocations ?? []).map((r) => byId.get(r.item.id)).filter((s): s is Store => !!s);
    const main = found.filter((s) => s.mainLevel && s.location.type === 'tenant');
    const upper = found.filter((s) => !s.mainLevel);
    const bucket = main.length >= 2 ? 'route' : main.length === 1 ? 'one place' : upper.length ? 'upper only' : 'nothing';
    searches.push({ term, main: main.length, upper: upper.length, bucket, top: found.slice(0, 4).map((s) => s.name) });
  }
  onProgress('Search audit done');

  // 3. Content completeness
  const content: ContentRow[] = tenants
    .map((s) => ({
      store: s.name,
      missing: [!s.logo && 'logo', !hoursToday(s) && 'hours', !s.description && 'description', unreachable.includes(s.name) && 'door / route'].filter(
        (x): x is string => !!x,
      ),
    }))
    .filter((r) => r.missing.length);

  return { tenants: tenants.length, routes, failed, unreachable, searches, content };
}

export function renderQa(el: HTMLElement, r: Awaited<ReturnType<typeof runQa>>) {
  const count = (b: SearchRow['bucket']) => r.searches.filter((s) => s.bucket === b).length;
  const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  el.innerHTML = `
    <h2>Scripted QA · ${new Date().toISOString().slice(0, 10)}</h2>
    <p><b>Routing:</b> ${r.routes.length - r.failed.length} of ${r.routes.length} routes found (${r.tenants} main-level stores × every parking area).
    Unreachable from every start: <b>${r.unreachable.map(esc).join(', ') || 'none'}</b>.</p>
    <p><b>Search (${r.searches.length} terms, both levels):</b> route ${count('route')} · one place ${count('one place')} · upper level only ${count('upper only')} · nothing ${count('nothing')}.
    Relevance ("misleading") is a human review: check the top results below.</p>
    <table><thead><tr><th>Term</th><th>Bucket</th><th>Main</th><th>Upper</th><th>Top results</th></tr></thead><tbody>
    ${r.searches.map((s) => `<tr><td>${esc(s.term)}</td><td>${s.bucket}</td><td>${s.main}</td><td>${s.upper}</td><td>${esc(s.top.join(', '))}</td></tr>`).join('')}
    </tbody></table>
    <p><b>Content gaps:</b> ${r.content.length} of ${r.tenants} stores miss something.</p>
    <table><thead><tr><th>Store</th><th>Missing</th></tr></thead><tbody>
    ${r.content.map((c) => `<tr><td>${esc(c.store)}</td><td>${c.missing.join(', ')}</td></tr>`).join('')}
    </tbody></table>`;
}
