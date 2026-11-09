# Greenfield Mall · Find your way

A first working slice of a customer-facing wayfinding web app on **Mappedin JS v6**: a first-time visitor opens it at the parking entrance, finds a store and walks there with steps they can actually follow.

- **Live:** https://greenfield-wayfinding-demo.atlas-lac.com/?from=lot-a (as if you scanned the QR at Parking Lot A). Best on a phone.

Built for the Mappedin FDE build exercise (customer brief: *Greenfield Mall Group*, 3 properties, ~2.5M sq ft). Runs on Mappedin's public demo venue.

## The brief, in my words

Greenfield just signed the platform and needs its first production app. Two pains: **shoppers can't find stores**, and **tenants churn because traffic piles up near the anchors**. The scope is parking → storefront on the main level, a directory, step-by-step guidance and a QA list.

The real problem is not drawing a line on a map. It is that a first-time visitor in a car park has **no idea where they are, which door to use, or what "turn left" means** in a building they have never seen. So the app is built around three ideas:

1. **"You are here" without hardware.** A QR sign at each parking entrance opens the app with `?from=lot-a`. The start point is exact on day one, with no positioning infrastructure. Without the QR, the first screen asks one question: *Where did you park?*
2. **Instructions anchored to storefronts.** "Turn right at Holt Renfrew", "You'll pass Lindt and Pandora", "Apple is on your left". These are things a visitor can see. The SDK gives "Turn Right, 51 m"; `src/guidance.ts` turns that into landmarks.
3. **The stores you pass are the tenant story.** Every route names the smaller tenants along the way and shows their labels on the map, the cheapest honest way to move attention off the anchors without faking promotions.

## What shipped

- **Parking → store routing** from Lot A, Lot B and the Parking Garage to any main-level storefront (405 of 408 routes direct; the last 3 via a fallback, see QA).
- **Search and directory** on Mappedin Search: names, tags and descriptions ("phone" finds Apple and Telus), category chips, logos, today's hours ("Closes soon · 8 PM").
- **Turn-by-turn**: one step at a time with Back / Next, the map rotated heading-up for each step, the current stretch highlighted, and the stores named in the instruction forced visible on the map.
- **Outdoor steps collapsed**: across a parking lot people walk to the door they can see, so the SDK's zig-zags become "Walk to the mall entrance by Nordstrom. Look for the Nordstrom sign."
- **Arrival side**: "on your left / on your right / straight ahead", from the last stretch's heading.
- **Route by need (the second pain, from the visitor's side)**: search "shoes" (or tap a category) and the app offers **"Visit the top 6 shoes stores"** as one route, in the shortest order from where you are (every order of up to 6 stops is tried over walking distances from the map graph, so it is exact). Step-by-step per leg ("Stop 2 of 6"), then back to the car. The visitor compares without getting lost; smaller tenants get visits that used to stop at the anchor. The visitor can reverse the route, drop a stop or move one, and every change is an event: a store that people drop from their own route has an interest problem, not a location problem. Going to one store stays the default.
- **Operator view (`?view=operator`)**: what the app measures with no new hardware. A live feed of the real events from the visitor app (open in another tab), and thirty days of **simulated** usage labelled as such: route exposure heat map, Pareto, arrivals by parking entrance, **what visitors look for and don't find** (real terms checked against this venue, simulated volumes, real searches added live, each routed to leasing, content or operations), a diagnosis per tenant (location vs interest) with a monthly report, the five hypotheses this release tests, what sensors and sales data would unlock, and the table of assumptions. Plan of events: **[ANALYTICS.md](ANALYTICS.md)**.
- **Back to my car**: after arrival, one tap routes back to the parking area the visitor came from, with exit wording.
- **Deep links**: `?from=<lot-a|lot-b|garage>` for the QR signs and `?to=<store>` for tenants to link to their storefront.
- **Step-free route (♿ in the top bar)**: one tap keeps every route off stairs and escalators (the SDK's `accessible` option), remembered on the device. On the main level nothing changes; at the hand-off to the Upper Level the route goes to the elevator ("Take the elevator up…"). Checked over all 333 parking → Upper Level routes in the scripted QA.
- **Graceful data gaps**: a store with no door in the map data still gets a route to the corridor in front of it. An upstairs store routes to the escalator (or the elevator, step-free) and hands off.
- **A map that helps you read it** (`src/decor.ts`): soft tints by category, so a route by need reads as one group of colour; icons for elevators, escalators, restrooms and information, with elevators highlighted when the step-free route is on; parking lots with stall lines, parked cars (hidden where they would cover the route) and trees, using Mappedin's own 3D assets library. `?decor=0` turns it all off for low-end devices.
- **Seasonal mode, as operator configuration** (`src/seasons.ts`): a date range per season (Halloween, Holidays) that brings a top-bar chip, seasonal colours on the entrances, a few decorations and the season's event as a real destination (searchable, with hours and a route). A new season is one more entry, not new code. Preview with `?season=holidays` or `?season=halloween`. Each season can bring characters (`src/characters.ts`): a ghost and a pumpkin-head walking the corridors at Halloween; Santa's sleigh flying across and a snowman waddling the corridors for the holidays. The visitor's route comes first: with a route on screen they cross a stretch of it (in step-by-step, the stretch just ahead, never on top of the blue dot), preferring the stretch that runs past the coldest storefronts; with no route they roam the wings with the least foot traffic (from the same simulation as the operator view). Not at all with reduced motion.
- Phone-first layout (bottom sheet) and a desktop layout (side panel). On a phone the sheet opens at under half the screen and can be dragged by its grabber to just the title (the map is free to pan) or to the full list; a tap on the grabber toggles map and list. The main action ("Start route") sits above the list, so it's always visible.

## What I left out, and why

| Left out | Why |
|---|---|
| Blue Dot / live position | Needs on-site infrastructure (Wi-Fi RTT, BLE, VPS) and a calibration pass. The QR start gets most of the value on day one. In an earlier Blue Dot pilot I ran in a mall, floor changes and accuracy near entrances were the issues; that is a project, not a 2-day slice. |
| Multi-level routing | Out of scope (main level). The route stops at the escalator with a clear instruction instead of a dead end. |
| Sending analytics to a backend | Events are designed and logged (see ANALYTICS.md), but where they go is Greenfield's decision and privacy policy; in the demo they stay in the browser. |
| Promotions on the route | Easy to build, but it would be fake data in a demo and the tenant program has to be designed with the customer's leasing team. |
| i18n, kiosk mode, screen-reader pass | Not needed for the first slice; the SDK supports the first two. Step-free routing did ship (see above). |

## QA

See **[QA.md](QA.md)**: what was tested (including a scripted run of all 408 start × store routes), known gaps, the data issues found in the venue, and the checks before handing it to the customer.

## What I'd push on the customer during the build

1. **Where do visitors actually start?** Number and location of parking entrances per property, and who prints and maintains the QR signs. The app is only as good as its start point.
2. **Is the venue data production-ready?** Doors on every tenant, correct names, logos and hours. The demo venue already has a store with no door and an anchor with a typo. That is a content workflow, not a code fix.
3. **How do we measure success?** Agree on the metric before launch: share of routes to non-anchor tenants, arrivals vs. abandons, top searches with no result.

## How I used AI

Built with Claude Code as a pair, from the PDF brief to a running app:

- **Brief → plan**: restated the brief, split the two pains, chose the QR start and the landmark idea, and cut scope before writing code.
- **SDK discovery**: had the agent open the demo venue in a browser and query `mapData` live (floors, entrances, parking spaces, enterprise locations, search results) instead of guessing from docs.
- **Build**: the agent wrote the code; I made the product calls (what a step should say, what to collapse, what to leave out).
- **QA as code**: a scripted run of all 408 routes found the doorless store and the arrival-side distribution, which went straight into the fallback and the QA list.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # tsc strict + vite build
```

Demo deep links: `/?from=lot-a&to=apple`, `/?from=lot-b&to=starbucks`, `/?from=garage&to=urban-kids`, and the operator view `/?view=operator` (open it next to the visitor app to see events arrive live).

Uses Mappedin's public demo key from the [developer docs](https://developer.mappedin.com/docs/demo-keys-and-maps). For a real venue set `VITE_MAPPEDIN_KEY`, `VITE_MAPPEDIN_SECRET` and `VITE_MAPPEDIN_MAP_ID` in `.env` (ignored by git). Parking start points and anchor names live in `src/venue.ts`.

### Code map

- `src/venue.ts`: loads the venue: main level, parking starts, stores, entrances, categories, opening hours, data fixes.
- `src/guidance.ts`: turns SDK directions into landmark-based steps (entrances, merged turns, stores passed, arrival side, trip back).
- `src/main.ts`: map, views (park → search → store → steps), camera, deep links.

*Greenfield Mall Group is the fictional customer from the exercise brief. Store names and logos come from Mappedin's demo venue.*
