import {
  getMapData,
  show3dMap,
  type Coordinate,
  type Directions,
  type MapData,
  type MapView,
  type TCameraTarget,
  type TFocusOnOptions,
} from '@mappedin/mappedin-js';
import '@mappedin/mappedin-js/lib/index.css';
import './style.css';
import { hoursToday, loadVenue, type Start, type Store, type Venue } from './venue';
import { buildGuidance, fmtDistance, metres, walkMinutes, type Guidance, type Step, type StepKind } from './guidance';
import { MAX_STOPS, planTrip, type TripPlan } from './trip';

// Mappedin's public demo venue and key (from the developer docs). A customer deployment swaps these
// for the venue's own key through env vars; nothing else in the app is venue-specific.
const MAP_OPTIONS = {
  key: import.meta.env.VITE_MAPPEDIN_KEY ?? '5eab30aa91b055001a68e996',
  secret: import.meta.env.VITE_MAPPEDIN_SECRET ?? 'RJyRXKcryCMy4erZqqCbuB1NbR66QTGNXVE0x3Pg6oCIlUR1',
  mapId: import.meta.env.VITE_MAPPEDIN_MAP_ID ?? 'mappedin-demo-mall',
};

const COLORS = { route: '#1a73e8', active: '#0b4fbf', selected: '#ffd166' };
const STORAGE_KEY = 'greenfield.start';

type View = 'park' | 'search' | 'trip' | 'store' | 'steps';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let mapData: MapData;
let mapView: MapView;
let venue: Venue;
let start: Start | undefined;
/** The stops of the current route: one store, or several from a search. */
let stops: Store[] = [];
/** One leg per stop: start → stop 1 → stop 2 … */
let legs: Directions[] = [];
let guidance: Guidance | undefined;
/** For each step of the flattened guidance, which leg it belongs to. */
let stepLeg: number[] = [];
let stepIndex = 0;
let returning = false;
let category: string | undefined;
let tripCandidates: { label: string; stores: Store[]; ranked: boolean } | undefined;
let plan: TripPlan | undefined;
let view: View = 'park';
let token = 0;
let hereMarker: ReturnType<MapView['Markers']['add']> | undefined;
let stopMarkers: ReturnType<MapView['Markers']['add']>[] = [];
const labels = new Map<string, ReturnType<MapView['Labels']['add']>>();
let emphasised: Store[] = [];

const multi = () => stops.length > 1;
const lastStop = () => stops[stops.length - 1];

// ---------- storage (best effort: private mode or blocked storage must not break the app) ----------
const remember = (id: string) => {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {}
};
const recall = () => {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
};

// ---------- views ----------
function show(next: View) {
  view = next;
  document.querySelectorAll<HTMLElement>('.view').forEach((el) => (el.hidden = el.dataset.view !== next));
  $('sheet').dataset.view = next;
  $('here').hidden = !start || next === 'park';
  requestAnimationFrame(updateOffsets);
}

function offsets() {
  const sheet = $('sheet').getBoundingClientRect();
  const wide = innerWidth >= 900;
  return {
    top: 84,
    left: wide ? sheet.right + 24 : 24,
    right: 24,
    bottom: wide ? 24 : Math.max(24, innerHeight - sheet.top + 24),
  };
}

function updateOffsets() {
  if (mapView) mapView.Camera.setScreenOffsets(offsets());
}

/** Every camera move keeps its target clear of the top bar and the bottom sheet. */
function focus(target: Parameters<MapView['Camera']['focusOn']>[0], options: TFocusOnOptions = {}) {
  return mapView.Camera.focusOn(target, { screenOffsets: offsets(), ...options });
}

function resetCamera() {
  const flat: TCameraTarget = { bearing: 0, pitch: 0 };
  mapView.Camera.set(flat);
}

// ---------- start (you are here) ----------
function setStart(next: Start, { frame = true } = {}) {
  start = next;
  remember(next.id);
  $('here-name').textContent = next.short;
  placeHere(startCoordinate(next));
  if (stops.length === 1) void selectStore(stops[0]);
  else {
    show('search');
    void renderResults();
    if (frame) void focus(next.target, { duration: 600, maxZoomLevel: 18 });
  }
}

const startCoordinate = (s: Start): Coordinate => ('center' in s.target ? s.target.center : s.target);

function placeHere(c: Coordinate) {
  if (hereMarker) mapView.Markers.remove(hereMarker);
  hereMarker = mapView.Markers.add(c, '<div class="you"><span></span><b>You are here</b></div>', { rank: 'always-visible' });
}

function renderStarts() {
  $('starts').innerHTML = venue.starts
    .map((s) => `<button type="button" data-start="${s.id}" aria-pressed="${s.id === start?.id}"><span class="p">P</span><span>${escapeHtml(s.name)}</span></button>`)
    .join('');
}

// ---------- directory & search ----------
function renderChips() {
  const all = ['All', ...venue.categories];
  $('chips').innerHTML = all
    .map((c) => `<button type="button" data-cat="${escapeHtml(c)}" aria-pressed="${(c === 'All' && !category) || c === category}">${escapeHtml(c)}</button>`)
    .join('');
}

let searchSeq = 0;
async function renderResults() {
  const seq = ++searchSeq;
  const term = $<HTMLInputElement>('q').value.trim();
  let list: Store[];
  if (term.length >= 2) {
    // Mappedin's search ranks by name, tags and descriptions ("phone" finds Apple and Telus).
    const res = await mapData.Search.query(term);
    if (seq !== searchSeq) return;
    const byId = new Map(venue.stores.map((s) => [s.location.id, s]));
    list = (res.enterpriseLocations ?? []).map((r) => byId.get(r.item.id)).filter((s): s is Store => !!s);
    // A store typed by its exact name goes first even if the score disagrees.
    const exact = venue.stores.find((s) => s.name.toLowerCase() === term.toLowerCase());
    if (exact) list = [exact, ...list.filter((s) => s !== exact)];
  } else {
    list = venue.stores.filter((s) => s.location.type === 'tenant' && (!category || s.category === category));
  }
  // Main level first: that is what this release routes end to end.
  list = [...list.filter((s) => s.mainLevel), ...list.filter((s) => !s.mainLevel)];
  renderTripBar(term.length >= 2 ? term : category, list);

  const items = list.slice(0, 80).map((s) => {
    const h = hoursToday(s);
    const tags = [s.category, !s.mainLevel ? 'Upper Level' : '', h && !h.open ? h.label : ''].filter(Boolean);
    return `<li><button type="button" data-store="${s.id}">
      ${logo(s)}
      <span class="r-main"><b>${escapeHtml(s.name)}</b><small>${escapeHtml(tags.join(' · '))}</small></span>
      <span class="r-go" aria-hidden="true">›</span>
    </button></li>`;
  });
  $('results').innerHTML = items.length
    ? items.join('')
    : `<li class="empty">No stores match “${escapeHtml(term)}”. Try a brand, or what you need, like “shoes”.</li>`;
}

/**
 * "Visit all the shoe stores": offered when a search or a category returns several storefronts on
 * this level and the visitor is not after one brand by name. Going to one store stays the default.
 */
function renderTripBar(label: string | undefined, list: Store[]) {
  const bar = $<HTMLButtonElement>('trip-bar');
  const term = $<HTMLInputElement>('q').value.trim().toLowerCase();
  const routable = list.filter((s) => s.mainLevel && s.location.type === 'tenant');
  const brandSearch = routable.length > 0 && routable[0].name.toLowerCase() === term;
  if (!label || routable.length < 2 || brandSearch) {
    bar.hidden = true;
    tripCandidates = undefined;
    return;
  }
  const ranked = term.length >= 2;
  tripCandidates = { label, stores: routable, ranked };
  const n = Math.min(routable.length, MAX_STOPS);
  const what = routable.length <= MAX_STOPS ? `all ${n} “${label}” stores` : ranked ? `the top ${n} “${label}” stores` : `the ${n} closest “${label}” stores`;
  bar.innerHTML = `<span class="ico" aria-hidden="true">${n}</span><span><b>Visit ${escapeHtml(what)}</b><small>One route, in the shortest order from where you are</small></span>`;
  bar.hidden = false;
}

function logo(s: Store, id = '') {
  const initials = s.name.replace(/[^A-Za-z0-9 ]/g, '').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('');
  const attr = id ? ` id="${id}"` : '';
  return s.logo
    ? `<span class="logo"${attr}><img src="${escapeHtml(s.logo)}" alt="" loading="lazy" onerror="this.parentElement.textContent='${initials}'" /></span>`
    : `<span class="logo"${attr}>${initials}</span>`;
}

const escapeHtml = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// ---------- one store ----------
async function selectStore(next: Store) {
  const my = ++token;
  clearRoute();
  stops = [next];
  returning = false;
  $('store-logo').outerHTML = logo(next, 'store-logo');
  $('store-name').textContent = next.name;
  $('store-meta').textContent = [next.category, next.mainLevel ? 'Main Level' : next.floor.name].join(' · ');
  const h = hoursToday(next);
  $('store-hours').textContent = h?.label ?? '';
  $('store-hours').className = `hours ${h ? (h.open ? (h.soon ? 'soon' : 'open') : 'closed') : ''}`;
  $('store-trip').textContent = 'Finding the best route…';
  $<HTMLButtonElement>('go').disabled = true;
  markStops();

  if (!start) {
    // Picked a store before telling us where they parked (e.g. a ?to= link): ask, then route.
    show('park');
    void focus(next.space, { duration: 600, maxZoomLevel: 18.5 });
    return;
  }
  show('store');
  const result = await safely(() => routeTo(start!.target, next));
  if (my !== token) return;
  if (!result) {
    $('store-trip').textContent = "We couldn't find a walking route to this store. Guest Services can help.";
    void focus(next.space, { duration: 600 });
    return;
  }
  legs = [result];
  guidance = buildGuidance(result, venue, next, { from: start.name, to: next.name, direction: 'in' });
  stepLeg = guidance.steps.map(() => 0);
  const via = guidance.entrance ? ` · enter ${guidance.entrance}` : '';
  const upstairs = next.mainLevel ? '' : ` · then up to the ${next.floor.name}`;
  $('store-trip').innerHTML = `<b>${guidance.minutes} min walk</b> · ${fmtDistance(guidance.distance)}${escapeHtml(via + upstairs)}`;
  $<HTMLButtonElement>('go').disabled = false;
  drawRoute();
  void focus(mainLevelPath(), { duration: 700 });
}

/** Routing never leaves the visitor on a spinner: an SDK error is treated like "no route". */
async function safely<T>(fn: () => Promise<T | undefined>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (error) {
    console.error('Routing failed', error);
    return undefined;
  }
}

/**
 * Some storefronts have no door in the map data (Urban Kids in the demo venue), so the router cannot
 * reach them. Rather than a dead end, route to a nearby store, take the point of that route that is
 * closest to the storefront, and route there instead. The data gap goes on the QA list for the
 * customer's content team.
 */
async function routeTo(from: Start['target'] | Coordinate | Store['space'], to: Store): Promise<Directions | undefined> {
  const direct = await mapData.getDirections(from, to.space);
  if (direct) return direct;
  const near = venue.stores
    .filter((s) => s !== to && s.mainLevel && s.location.type === 'tenant')
    .sort((a, b) => metres(a.space.center, to.space.center) - metres(b.space.center, to.space.center))
    .slice(0, 4);
  for (const n of near) {
    const viaNeighbour = await mapData.getDirections(from, n.space);
    if (!viaNeighbour) continue;
    const closest = viaNeighbour.coordinates.reduce((best, c) =>
      metres(c, to.space.center) < metres(best, to.space.center) ? c : best,
    );
    return (await mapData.getDirections(from, closest)) ?? viaNeighbour;
  }
  return undefined;
}

// ---------- several stores: the route built from a search ----------
async function openTrip() {
  if (!start || !tripCandidates) return;
  const my = ++token;
  clearRoute();
  returning = false;
  show('trip');
  $('trip-title').textContent = `“${tripCandidates.label}” route`;
  $('trip-summary').textContent = 'Finding the shortest order…';
  $('trip-stops').innerHTML = '';
  $('trip-note').textContent = '';
  $<HTMLButtonElement>('trip-go').disabled = true;

  plan = planTrip(mapData, start, tripCandidates.label, tripCandidates.stores, tripCandidates.ranked);
  if (!plan) {
    $('trip-summary').textContent = 'These stores cannot be combined into one route on this level.';
    return;
  }
  stops = plan.stops;
  markStops();

  // One request for all the legs, in the chosen order. If the SDK cannot chain them, build each leg.
  let result = await safely(() => mapData.getDirectionsMultiDestination(start!.target, stops.map((s) => s.space)));
  if (!result || result.length !== stops.length) {
    const built: Directions[] = [];
    let from: Start['target'] | Store['space'] = start.target;
    for (const s of stops) {
      const leg = await safely(() => routeTo(from, s));
      if (!leg) break;
      built.push(leg);
      from = s.space;
    }
    result = built.length === stops.length ? built : undefined;
  }
  if (my !== token) return;
  if (!result) {
    $('trip-summary').textContent = "We couldn't build a walking route through these stores. Try one store at a time.";
    return;
  }
  legs = result;

  // One guidance per leg, flattened into a single list of steps.
  const all: Step[] = [];
  stepLeg = [];
  let distance = 0;
  legs.forEach((leg, i) => {
    const from = i === 0 ? start!.name : stops[i - 1].name;
    const g = buildGuidance(leg, venue, stops[i], {
      from,
      to: stops[i].name,
      direction: i === 0 ? 'in' : 'next',
      avoid: stops.map((s) => s.id),
    });
    const arrive = g.steps[g.steps.length - 1];
    const next = stops[i + 1];
    arrive.text = `Stop ${i + 1} of ${stops.length}: ${arrive.text}`;
    arrive.detail = next ? `Next: ${next.name}.` : 'Last stop.';
    all.push(...g.steps);
    g.steps.forEach(() => stepLeg.push(i));
    distance += g.distance;
  });
  guidance = { steps: all, distance, minutes: walkMinutes(distance), passing: [] };

  const legMinutes = legs.map((l) => walkMinutes(l.distance));
  $('trip-summary').innerHTML = `<b>${guidance.minutes} min walk</b> · ${fmtDistance(distance)} · ${stops.length} stops, shortest order from ${escapeHtml(start.short)}`;
  $('trip-stops').innerHTML = stops
    .map((s, i) => `<li>${logo(s)}<span class="r-main"><b>${escapeHtml(s.name)}</b><small>${escapeHtml(s.category)}</small></span><span class="leg">${legMinutes[i]} min</span></li>`)
    .join('');
  const notes: string[] = [];
  if (plan.total > stops.length) notes.push(`Showing the ${stops.length} ${plan.ranked ? 'best matches' : 'closest'} of ${plan.total} stores.`);
  if (plan.skipped.length) notes.push(`Not included (no walking route in the map data): ${plan.skipped.map((s) => s.name).join(', ')}.`);
  $('trip-note').textContent = notes.join(' ');
  $<HTMLButtonElement>('trip-go').disabled = false;
  drawRoute();
  void focus(mainLevelPath(), { duration: 700 });
}

// ---------- map drawing ----------
/** Main level only in this release: if a store is upstairs, the route is shown up to the escalator. */
function mainLevelPath() {
  return legs.flatMap((l) => l.coordinates).filter((c) => c.floorId === venue.main.id);
}

function drawRoute() {
  if (!legs.length) return;
  mapView.Navigation.clear();
  void mapView.Navigation.draw(legs.length === 1 ? legs[0] : legs, {
    pathOptions: { color: COLORS.route, width: 1.1, displayArrowsOnPath: true },
    inactivePathOptions: { color: '#8fb3ef', width: 0.8 },
    createMarkers: { departure: false, destination: false, connection: true },
    setMapToDeparture: false,
  });
}

function markStops() {
  stops.forEach((s, i) => {
    mapView.updateState(s.space, { color: COLORS.selected });
    const num = multi() ? `<span class="num">${i + 1}</span>` : '';
    stopMarkers.push(mapView.Markers.add(s.space.center, `<div class="pin">${logo(s)}${num}</div>`, { rank: 'always-visible' }));
  });
}

function clearRoute() {
  emphasise([]);
  mapView.Navigation.clear();
  stopMarkers.forEach((m) => mapView.Markers.remove(m));
  stopMarkers = [];
  stops.forEach((s) => mapView.updateState(s.space, { color: 'initial' }));
  stops = [];
  legs = [];
  guidance = undefined;
  stepLeg = [];
}

// ---------- turn by turn ----------
function startSteps() {
  if (!guidance) return;
  stepIndex = 0;
  $('summary').textContent = `${guidance.minutes} min · ${fmtDistance(guidance.distance)}`;
  $('steps').innerHTML = guidance.steps
    .map(
      (s, i) =>
        `<li><button type="button" data-step="${i}"><span class="mini" data-kind="${s.kind}">${ARROWS[s.kind]}</span><span><b>${escapeHtml(s.text)}</b>${
          s.detail ? `<small>${escapeHtml(s.detail)}</small>` : ''
        }</span></button></li>`,
    )
    .join('');
  show('steps');
  renderStep();
}

function renderStep() {
  if (!guidance || !stops.length || !start) return;
  const steps = guidance.steps;
  const step = steps[stepIndex];
  const last = stepIndex === steps.length - 1;
  const leg = stepLeg[stepIndex] ?? 0;
  $('arrow').innerHTML = ARROWS[step.kind];
  $('arrow').dataset.kind = step.kind;
  $('step-text').textContent = step.text;
  $('step-detail').textContent = step.detail ?? '';
  $('progress').textContent = multi() && !returning ? `Stop ${leg + 1} of ${stops.length} · step ${stepIndex + 1} of ${steps.length}` : `Step ${stepIndex + 1} of ${steps.length}`;
  $<HTMLButtonElement>('prev').disabled = stepIndex === 0;
  const atStop = step.kind === 'arrive' && multi() && !returning;
  $('next').textContent = !last ? (atStop ? 'Next stop' : 'Next') : returning ? 'Done' : `Back to ${start.short}`;
  const back = document.querySelector<HTMLElement>('[data-view="steps"] [data-back]');
  if (back) back.textContent = returning ? '← End' : multi() ? '← Change route' : '← Change store';
  document.querySelectorAll<HTMLElement>('#steps li').forEach((li, i) => li.classList.toggle('active', i === stepIndex));

  if (legs.length > 1) mapView.Navigation.setActivePathByIndex(leg);
  emphasise(step.landmark ? [step.landmark, ...step.passing] : step.passing);
  if (step.path.length > 1) {
    mapView.Navigation.highlightPathSection(step.path[0], step.path[step.path.length - 1], { color: COLORS.active, widthMultiplier: 1.5 });
    placeHere(step.path[0]);
    // Heading-up: rotate the map so a "left" on screen is a left for the visitor.
    void focus(step.path, { duration: 700, bearing: heading(step.path), pitch: 35, maxZoomLevel: 19.5 });
  } else {
    const target = returning ? startCoordinate(start) : stops[leg].space;
    void focus(target, { duration: 700, maxZoomLevel: 19.5 });
  }
}

/** The stores named in the current instruction must be readable on the map, whatever else collides. */
function emphasise(list: Store[]) {
  for (const s of emphasised) {
    const l = labels.get(s.id);
    if (l) mapView.updateState(l, { rank: s.anchor ? 'high' : 'medium' });
  }
  emphasised = list;
  for (const s of list) {
    const l = labels.get(s.id);
    if (l) mapView.updateState(l, { rank: 'always-visible' });
  }
}

function heading(path: Coordinate[]) {
  const a = path[0], b = path[path.length - 1];
  const dx = (b.longitude - a.longitude) * Math.cos((a.latitude * Math.PI) / 180);
  const dy = b.latitude - a.latitude;
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}

/** The trip back: same engine, reversed, from the last stop. A visitor can always find their car. */
async function routeBack() {
  if (!start || !stops.length) return;
  const from = lastStop();
  // Start the way back where the way in ended (the storefront may have no door in the data).
  const lastLeg = legs[legs.length - 1];
  const end = lastLeg?.coordinates[lastLeg.coordinates.length - 1];
  const result =
    (await safely(() => mapData.getDirections(from.space, start!.target))) ??
    (end ? await safely(() => mapData.getDirections(end, start!.target)) : undefined);
  if (!result) return finishTrip();
  mapView.Navigation.clear();
  legs = [result];
  guidance = buildGuidance(result, venue, from, { from: from.name, to: start.name, direction: 'out' });
  stepLeg = guidance.steps.map(() => 0);
  returning = true;
  drawRoute();
  startSteps();
}

function finishTrip() {
  clearRoute();
  returning = false;
  resetCamera();
  if (start) placeHere(startCoordinate(start));
  show('search');
  void renderResults();
  if (start) void focus(start.target, { duration: 600, maxZoomLevel: 18 });
}

const svg = (d: string) =>
  `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ARROWS: Record<StepKind, string> = {
  start: svg('<circle cx="12" cy="12" r="3.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
  straight: svg('<path d="M12 20V4M6 10l6-6 6 6"/>'),
  left: svg('<path d="M18 20v-7a3 3 0 0 0-3-3H5M10 5l-5 5 5 5"/>'),
  right: svg('<path d="M6 20v-7a3 3 0 0 1 3-3h10M14 5l5 5-5 5"/>'),
  'slight-left': svg('<path d="M15 20v-6L8 7M8 13V7h6"/>'),
  'slight-right': svg('<path d="M9 20v-6l7-7M16 13V7h-6"/>'),
  back: svg('<path d="M9 20V9a4 4 0 0 1 8 0v4M6 16l3 4 3-4"/>'),
  up: svg('<path d="M4 20h5l7-12h4M14 8h6v6"/>'),
  down: svg('<path d="M4 8h5l7 12h4M20 14v6h-6"/>'),
  arrive: svg('<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>'),
};

// ---------- wiring ----------
function goBack() {
  if (view === 'steps' && !returning && multi()) {
    resetCamera();
    void openTrip();
  } else if (view === 'steps' && !returning && stops.length === 1) {
    resetCamera();
    void selectStore(stops[0]);
  } else finishTrip();
}

function bind() {
  document.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!t) return;
    if (t.dataset.start) {
      const s = venue.starts.find((x) => x.id === t.dataset.start);
      if (s) setStart(s);
    } else if (t.dataset.cat) {
      category = t.dataset.cat === 'All' ? undefined : t.dataset.cat;
      renderChips();
      void renderResults();
    } else if (t.dataset.store) {
      const s = venue.stores.find((x) => x.id === t.dataset.store);
      if (s) void selectStore(s);
    } else if (t.dataset.step) {
      stepIndex = Number(t.dataset.step);
      renderStep();
    } else if (t.dataset.back !== undefined) {
      goBack();
    }
  });
  $('here').addEventListener('click', () => {
    renderStarts();
    show('park');
  });
  $('trip-bar').addEventListener('click', () => void openTrip());
  $('trip-go').addEventListener('click', startSteps);
  $('go').addEventListener('click', startSteps);
  $('prev').addEventListener('click', () => {
    stepIndex = Math.max(0, stepIndex - 1);
    renderStep();
  });
  $('next').addEventListener('click', () => {
    if (!guidance) return;
    if (stepIndex < guidance.steps.length - 1) {
      stepIndex++;
      renderStep();
    } else if (returning) finishTrip();
    else void routeBack();
  });
  $('q').addEventListener('input', () => void renderResults());
  addEventListener('resize', updateOffsets);
  new ResizeObserver(updateOffsets).observe($('sheet'));

  // Tap a storefront on the map to pick it.
  mapView.on('click', (e) => {
    const space = e.spaces?.[0];
    const s = space && venue.bySpace.get(space.id);
    if (s && view !== 'steps') void selectStore(s);
  });
}

async function init() {
  mapData = await getMapData({ ...MAP_OPTIONS, search: { enabled: true } });
  venue = loadVenue(mapData);
  mapView = await show3dMap($('map'), mapData, { initialFloor: venue.main });
  for (const s of venue.stores) {
    if (!s.mainLevel) continue;
    mapView.updateState(s.space, { interactive: true });
    // Storefront names on the map: the instructions say "turn right at Holt Renfrew", so the visitor
    // has to be able to find Holt Renfrew on screen too.
    if (s.location.type === 'tenant') {
      const label = mapView.Labels.add(s.space, s.name, {
        rank: s.anchor ? 'high' : 'medium',
        interactive: true,
        appearance: { icon: s.logo, iconVisible: s.anchor && !!s.logo, textSize: 11, pinColor: '#0f7a55' },
      });
      labels.set(s.id, label);
    }
  }
  if (import.meta.env.DEV) Object.assign(window, { mapData, mapView, venue, buildGuidance, planTrip });

  renderStarts();
  renderChips();
  void renderResults();
  bind();
  $('loading').remove();

  // Deep links: ?from=lot-a is what the QR sign at each parking entrance encodes; ?to=<store> lets a
  // tenant link straight to their storefront (newsletter, Google Business Profile).
  const params = new URLSearchParams(location.search);
  const from = venue.starts.find((s) => s.id === (params.get('from') ?? recall()));
  const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const to = params.get('to');
  const target = to ? venue.stores.find((s) => slug(s.name) === slug(to)) : undefined;
  if (target) stops = [target];
  if (from) setStart(from, { frame: !target });
  else if (target) void selectStore(target);
  else show('park');
  if (!from && !target) requestAnimationFrame(() => void focus(venue.main, { duration: 0 }));
}

void init();
