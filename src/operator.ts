import type { MapData, MapView } from '@mappedin/mappedin-js';
import type { Store, Venue } from './venue';
import { ASSUMPTIONS, simulate, type SimResult, type TenantStats } from './sim';
import { onEvent, recentEvents, type AppEvent } from './events';

/**
 * The operator's view (?view=operator): what the app already measures, with no new hardware.
 * Thirty days are simulated (and labelled as such); the live feed shows the real events of the
 * visitor app open in another tab.
 */
const ZONE_COLOR = { hot: '#e4572e', warm: '#f2b134', cold: '#c9d1d9' } as const;
const DIAGNOSIS = {
  healthy: { label: 'Healthy', tone: 'good', text: 'Enough people see it and look for it.' },
  location: { label: 'Location', tone: 'warn', text: 'People look for it, but few routes pass by. The mall can move traffic here: routes by need, signage, events in this wing.' },
  interest: { label: 'Interest', tone: 'warn', text: 'Routes pass by, but few people look for it, or they drop it from their routes. That is a mix, offer or marketing question, not a location one.' },
  both: { label: 'Location + interest', tone: 'bad', text: 'Few routes pass by and few people look for it. First candidate for the leasing conversation.' },
} as const;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (n: number) => n.toLocaleString('en-US');
const pct = (x: number) => `${Math.round(x * 100)}%`;
const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

let result: SimResult | undefined;
let selected: TenantStats | undefined;

export async function startOperator(mapData: MapData, mapView: MapView, venue: Venue) {
  document.body.classList.add('operator');
  const panel = $('ops');
  panel.hidden = false;
  bindTabs();
  renderFeed();
  onEvent(() => renderFeed());

  $('ops-overview').innerHTML = '<p class="ops-loading">Routing 360 simulated visits on the real map…</p>';
  result = await simulate(mapData, venue, (done, total) => {
    const el = panel.querySelector('.ops-loading');
    if (el) el.textContent = `Routing simulated visits on the real map… ${Math.round((done / total) * 100)}%`;
  });
  paintMap(mapView);
  if (import.meta.env.DEV) Object.assign(window, { opsResult: result });
  renderOverview();
  renderTenants();
  renderLearning();
  renderAssumptions();
  void mapView.Camera.focusOn(venue.main, { duration: 0 });

  mapView.on('click', (e) => {
    const space = e.spaces?.[0];
    const t = space && result?.tenants.find((x) => x.store.space.id === space.id);
    if (t) openTenant(t, mapView);
  });
  panel.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-tenant]');
    const t = b && result?.tenants.find((x) => x.store.id === b.dataset.tenant);
    if (t) openTenant(t, mapView);
  });
}

function bindTabs() {
  document.querySelectorAll<HTMLButtonElement>('[data-ops-tab]').forEach((b) =>
    b.addEventListener('click', () => {
      document.querySelectorAll<HTMLButtonElement>('[data-ops-tab]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      document.querySelectorAll<HTMLElement>('.ops-tab').forEach((t) => (t.hidden = t.id !== `ops-${b.dataset.opsTab}`));
    }),
  );
}

/** Heat map: every storefront coloured by how often it ends up on someone's route. */
function paintMap(mapView: MapView) {
  for (const t of result!.tenants) mapView.updateState(t.store.space, { color: ZONE_COLOR[t.zone] });
}

function renderOverview() {
  const r = result!;
  const tiles = [
    ['App sessions', fmt(r.sessions), '4% of ~660k visits'],
    ['Routes started', fmt(r.routes), `${pct(r.categoryRoutes / r.routes)} by need`],
    ['Routes completed', pct(r.arrivalRate), 'arrived vs abandoned'],
    ['Came back in 30 days', pct(r.returnRate), 'retention baseline'],
  ];
  const maxEntrance = Math.max(...r.byEntrance.map((e) => e.sessions));
  const sorted = [...r.tenants].sort((a, b) => b.exposure - a.exposure);
  const max = sorted[0].exposure || 1;
  const total = sorted.reduce((a, t) => a + t.exposure, 0) || 1;
  let cum = 0;
  const w = 320, h = 110, bw = w / sorted.length;
  const bars = sorted.map((t, i) => `<rect x="${(i * bw).toFixed(2)}" y="${(h - (t.exposure / max) * h).toFixed(1)}" width="${Math.max(bw - 0.4, 0.6).toFixed(2)}" height="${((t.exposure / max) * h).toFixed(1)}" fill="${ZONE_COLOR[t.zone]}"/>`).join('');
  const line = sorted
    .map((t, i) => {
      cum += t.exposure;
      return `${i ? 'L' : 'M'}${((i + 1) * bw).toFixed(1)},${(h - (cum / total) * h).toFixed(1)}`;
    })
    .join(' ');
  const cut = r.pareto.topCount * bw;

  $('ops-overview').innerHTML = `
    <div class="tiles">${tiles.map(([l, v, n]) => `<div class="tile"><small>${l}</small><b>${v}</b><span>${n}</span></div>`).join('')}</div>

    <h3>Where the traffic goes</h3>
    <p class="lead-in"><b>The top ${pct(r.pareto.topShare)} of stores get ${pct(r.pareto.exposureShare)} of all route exposure</b>. Busiest storefronts: ${r.hottest.map(esc).join(", ")}.</p>
    <svg class="pareto" viewBox="0 0 ${w} ${h + 16}" role="img" aria-label="Route exposure by store, sorted, with cumulative share">
      ${bars}
      <path d="${line}" fill="none" stroke="#12211b" stroke-width="1.4"/>
      <line x1="${cut}" x2="${cut}" y1="0" y2="${h}" stroke="#12211b" stroke-dasharray="3 3" stroke-width="1"/>
      <text x="${cut + 4}" y="12" font-size="9" fill="#12211b">top 20%</text>
      <text x="0" y="${h + 12}" font-size="9" fill="#5d6e66">${r.tenants.length} stores, most exposed first · line = cumulative share</text>
    </svg>
    <div class="legend">
      <span><i style="background:${ZONE_COLOR.hot}"></i>Hot</span><span><i style="background:${ZONE_COLOR.warm}"></i>Warm</span><span><i style="background:${ZONE_COLOR.cold}"></i>Cold wing</span>
      <small>Map colours = exposure on routes</small>
    </div>

    <h3>Where visitors arrive</h3>
    ${r.byEntrance.map((e) => `<div class="hbar"><span>${esc(e.name)}</span><i style="width:${(e.sessions / maxEntrance) * 100}%"></i><b>${fmt(e.sessions)}</b></div>`).join('')}
    <p class="hint">From QR scans at each parking entrance: tells you where to reinforce signage.</p>

    <h3>Searches with no result</h3>
    ${r.zeroSearches.map((z) => `<div class="hbar"><span>“${esc(z.term)}”</span><i class="miss" style="width:${(z.count / r.zeroSearches[0].count) * 100}%"></i><b>${fmt(z.count)}</b></div>`).join('')}
    <p class="hint">Real gaps found in this venue's search tags. Either a missing tenant (a leasing opportunity) or a missing tag (a content fix).</p>`;
}

function renderTenants() {
  const order = { both: 0, location: 1, interest: 2, healthy: 3 } as const;
  const list = [...result!.tenants].sort((a, b) => order[a.diagnosis] - order[b.diagnosis] || a.exposure - b.exposure);
  const atRisk = list.filter((t) => t.diagnosis !== 'healthy').length;
  $('ops-tenants').innerHTML = `
    <div id="tenant-card" class="tenant-card" hidden></div>
    <p class="lead-in"><b>${atRisk} of ${list.length} stores</b> show a weak signal. The app separates <b>location</b> (few routes pass by) from <b>interest</b> (few people look for it, or drop it from their routes).</p>
    <ul class="tenant-list">${list
      .map((t) => {
        const d = DIAGNOSIS[t.diagnosis];
        return `<li><button type="button" data-tenant="${t.store.id}"><i style="background:${ZONE_COLOR[t.zone]}"></i><span>${esc(t.store.name)}<small>${esc(t.store.category)}</small></span><em class="tone-${d.tone}">${d.label}</em></button></li>`;
      })
      .join('')}</ul>`;
}

function openTenant(t: TenantStats, mapView: MapView) {
  selected = t;
  document.querySelector<HTMLButtonElement>('[data-ops-tab="tenants"]')?.click();
  const d = DIAGNOSIS[t.diagnosis];
  const card = $('tenant-card');
  card.hidden = false;
  card.innerHTML = `
    <div class="tc-head"><b>${esc(t.store.name)}</b><em class="tone-${d.tone}">${d.label}</em></div>
    <small class="tc-sub">Monthly report · ${esc(t.store.category)} · simulated</small>
    <dl>
      <div><dt>Searched or picked</dt><dd>${fmt(t.searches)}</dd></div>
      <div><dt>On visitors' routes</dt><dd>${fmt(t.exposure)}</dd></div>
      <div><dt>Visits guided here</dt><dd>${fmt(t.visits)}</dd></div>
      <div><dt>…from routes by need</dt><dd>${fmt(t.categoryVisits)}</dd></div>
      <div><dt>Dropped from routes by need</dt><dd>${t.offered ? `${fmt(t.dropped)} of ${fmt(t.offered)}` : '—'}</dd></div>
    </dl>
    <p>${d.text}</p>
    <p class="hint">This is the page Greenfield's leasing team could bring to a renewal. With sales by tenant it would add productivity per sq ft; with door counts, capture rate.</p>`;
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  void mapView.Camera.focusOn(t.store.space, { duration: 600, maxZoomLevel: 19 });
  highlight(mapView, t.store);
}

let highlighted: Store | undefined;
function highlight(mapView: MapView, store: Store) {
  if (highlighted) {
    const prev = result!.tenants.find((x) => x.store.id === highlighted!.id);
    if (prev) mapView.updateState(prev.store.space, { color: ZONE_COLOR[prev.zone] });
  }
  highlighted = store;
  mapView.updateState(store.space, { color: '#1a73e8' });
}

function renderLearning() {
  const r = result!;
  const loc = r.tenants.filter((t) => t.diagnosis === 'location' || t.diagnosis === 'both').length;
  const int = r.tenants.filter((t) => t.diagnosis === 'interest' || t.diagnosis === 'both').length;
  const viaNeed = r.tenants.reduce((a, t) => a + t.categoryVisits, 0);
  const hyps = [
    ['H1', 'Visitors can’t find stores', `${pct(r.arrivalRate)} of routes completed; ${fmt(r.zeroSearches.reduce((a, z) => a + z.count, 0))} searches found nothing`, 'Fix map data and search tags; spot gaps in the mix'],
    ['H2', 'Traffic concentrates near the anchors', `Top 20% of stores get ${pct(r.pareto.exposureShare)} of route exposure; busiest: ${r.hottest.join(', ')}. Whether that is the anchors or the parking entrances is what real data must settle`, 'Know which wings are cold, and why'],
    ['H3', 'At-risk tenants suffer from location, not interest', `${loc} stores look like location, ${int} like interest`, 'Move traffic (location) vs work on mix and marketing (interest)'],
    ['H4', 'Guided visitors walk to more stores', `${fmt(viaNeed)} visits came from routes by need`, 'Scale routes by need into themed trails and campaigns'],
    ['H5', 'Better wayfinding moves retention', `${pct(r.returnRate)} of app users came back in 30 days (baseline)`, 'Justify phase two, or stop'],
  ];
  $('ops-learning').innerHTML = `
    <p class="lead-in">This first release is also an instrument: each hypothesis has the event that answers it and the decision it enables.</p>
    ${hyps.map(([id, h, signal, decision]) => `<div class="hyp"><b>${id}</b><div><strong>${h}</strong><span>Signal: ${signal}</span><span>Decision: ${decision}</span></div></div>`).join('')}
    <h3>Unlock with sensors and sales</h3>
    <div class="unlock">
      <p>The app only sees people who use it. If Greenfield has, or adds:</p>
      <ul>
        <li><b>People counting at entrances and storefronts</b> → total traffic and <b>capture rate</b> (walk past → walk in).</li>
        <li><b>Guest Wi-Fi presence analytics</b>, if the network exists → density by zone to calibrate the simulation.</li>
        <li><b>Sales by tenant</b> → <b>conversion</b> and productivity per sq ft: a full tenant health matrix.</li>
      </ul>
      <p class="hint">A recommendation for phase two, not an assumption: the brief doesn't say any of these exist.</p>
    </div>`;
}

function renderAssumptions() {
  $('ops-assumptions').innerHTML = `
    <p class="lead-in">Every simulated number, with a reference range. Each one is a question for Greenfield.</p>
    <table class="assume"><thead><tr><th>Assumption</th><th>Value</th><th>Range</th></tr></thead><tbody>
    ${ASSUMPTIONS.map((a) => `<tr><td>${esc(a.label)}<small>${esc(a.source)}</small></td><td>${esc(a.value)}</td><td>${esc(a.range)}</td></tr>`).join('')}
    </tbody></table>
    <p class="hint">Real: the venue, its stores and every route (computed by Mappedin on this map). Simulated: who comes, where they park, what they look for.</p>`;
}

const LABELS: Record<string, string> = {
  qr_scan: 'Scanned the QR at',
  parking_selected: 'Picked parking',
  search: 'Searched',
  store_selected: 'Opened',
  route_started: 'Started a route',
  stop_reached: 'Reached stop',
  arrived: 'Arrived at',
  route_abandoned: 'Left the route at step',
  route_back: 'Headed back to the car from',
  category_route_opened: 'Opened a route by need:',
  category_route_started: 'Started route by need:',
  route_reversed: 'Reversed the route',
  stop_removed: 'Dropped',
  stop_moved: 'Moved',
  route_reset_to_shortest: 'Back to shortest order',
};

function describe(e: AppEvent) {
  const p = e.props;
  const detail =
    p.store ?? (p.term ? `“${p.term}” (${p.results} found)` : undefined) ?? p.entrance ?? (p.label ? `“${p.label}”` : undefined) ?? (p.kind ? `${p.kind}, ${p.stops} stop(s)` : '');
  const extra =
    e.name === 'route_abandoned'
      ? `${p.step} of ${p.of}`
      : e.name === 'route_started'
        ? p.kind === 'category'
          ? `by need, ${p.stops} stops`
          : 'to one store'
        : '';
  return `${LABELS[e.name] ?? e.name} ${esc(String(extra || detail || ''))}`;
}

function renderFeed() {
  const el = $('ops-feed');
  const list = recentEvents().slice(-8).reverse();
  el.innerHTML = list.length
    ? list.map((e) => `<li><time>${new Date(e.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</time>${describe(e)}</li>`).join('')
    : '<li class="empty">Open the visitor app in another tab and use it: events appear here.</li>';
}

export const currentTenant = () => selected;
