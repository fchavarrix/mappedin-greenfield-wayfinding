/**
 * The app's own event log: what visitors search, pick, change and complete. In this demo the events
 * stay in the browser (no test data is sent to anyone's backend); in production each one is
 * forwarded to Mappedin Analytics (`mapView.Analytics.capture`) or to the customer's own pipeline.
 * No personal data: an anonymous device id at most, never names, emails or precise positions.
 * The full event plan is in ANALYTICS.md.
 */
export type AppEvent = { name: string; at: number; props: Record<string, string | number | boolean | string[]> };

const STORAGE_KEY = 'greenfield.events';
const KEEP = 300;
const listeners = new Set<(e: AppEvent) => void>();

function load(): AppEvent[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as AppEvent[];
  } catch {
    return [];
  }
}

const log: AppEvent[] = load();

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(log.slice(-KEEP)));
  } catch {}
}

export function track(name: string, props: AppEvent['props'] = {}) {
  const event: AppEvent = { name, at: Date.now(), props };
  log.push(event);
  save();
  listeners.forEach((fn) => fn(event));
  if (import.meta.env.DEV) console.debug('[track]', name, props);
}

export const recentEvents = () => [...log];

/**
 * Listen to new events, including the ones from the visitor app open in another tab (the operator
 * view shows them live during the demo).
 */
export function onEvent(fn: (e: AppEvent) => void) {
  listeners.add(fn);
  const fromOtherTab = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY || !e.newValue) return;
    try {
      const all = JSON.parse(e.newValue) as AppEvent[];
      const last = log[log.length - 1]?.at ?? 0;
      for (const ev of all.filter((x) => x.at > last)) {
        log.push(ev);
        fn(ev);
      }
    } catch {}
  };
  addEventListener('storage', fromOtherTab);
  return () => {
    listeners.delete(fn);
    removeEventListener('storage', fromOtherTab);
  };
}
