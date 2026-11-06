/**
 * The app's own event log: what visitors search, pick, change and complete. In this demo the events
 * stay in the browser (no test data is sent to anyone's backend); in production each one is
 * forwarded to Mappedin Analytics (`mapView.Analytics.capture`) or to the customer's own pipeline.
 * No personal data: an anonymous device id at most, never names, emails or precise positions.
 */
export type AppEvent = { name: string; at: number; props: Record<string, string | number | boolean | string[]> };

const log: AppEvent[] = [];
const listeners = new Set<(e: AppEvent) => void>();

export function track(name: string, props: AppEvent['props'] = {}) {
  const event: AppEvent = { name, at: Date.now(), props };
  log.push(event);
  listeners.forEach((fn) => fn(event));
  if (import.meta.env.DEV) console.debug('[track]', name, props);
}

export const recentEvents = () => [...log];

export function onEvent(fn: (e: AppEvent) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
