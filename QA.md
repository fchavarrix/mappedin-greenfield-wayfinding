# QA checklist · Greenfield Mall wayfinding (first slice)

Tested on 5–6 Nov 2026 against Mappedin's public demo venue (`mappedin-demo-mall`, Main Level = "Lower Level", 136 tenants), Mappedin JS 6.31.

## What I tested

| # | Area | Check | Result |
|---|------|-------|--------|
| 1 | Routing coverage | Scripted run of every start (Lot A, Lot B, Garage) × every main-level tenant = **408 routes** | **405 / 408 routed directly.** The 3 failures are all *Urban Kids* (no door in the map data), now handled by the fallback in #9 |
| 2 | Instructions | Read the full step list for 24 sampled routes (3 starts × 8 stores, incl. anchors, food court, a store upstairs) | Every turn names a visible storefront when one is within ~20 m; outdoor zig-zags across the lot collapse into one "walk to the entrance by …" step |
| 3 | Arrival | Side of the storefront ("on your left / right / straight ahead") checked on screen for Apple, Starbucks, Lululemon | Matches the map. Distribution over 405 routes: 124 left · 135 right · 146 straight ahead |
| 4 | Step count | Longest route from Lot A | 8 steps (H&M, Bloomingdales, Alo Yoga). Merging of turn pairs < 8 m apart keeps it readable |
| 5 | Search | "apple", "coffee" (→ Second Cup, Starbucks, Take Five Cafe…), "phone" (→ Fonelab, Telus, Apple), "shoes" (→ DSW, Browns…), typo "starbuks" (→ Starbucks), no-match "zzzz" | Uses Mappedin Search (names, tags, descriptions). No-match shows a hint instead of an empty list |
| 6 | Directory | Category chips, A–Z list, logos (with initials fallback when a logo URL fails), hours today | OK. "Closes soon" and "Closed now" come from the venue's opening hours |
| 7 | Deep links | `?from=lot-a&to=apple`, `?from=garage&to=urban-kids`, `?from=lot-b&to=starbucks`, `?from=nowhere&to=not-a-store` | QR flow skips the parking question; unknown values fall back to asking where you parked |
| 8 | Return trip | "Back to Lot A" after arrival, then "Done" | Reverse route with exit wording ("Exit the mall by Nordstrom") |
| 9 | Store with no door | Urban Kids | Routes to the closest corridor point of a neighbour's route; arrival says "Urban Kids is straight ahead" |
| 10 | Upstairs store | Nespresso (Upper Level) from each start | Step list ends "Take the escalator up to the Upper Level" (checked in the scripted run; not yet walked through on screen) |
| 11 | Phone layout | 375 × 812 in a desktop browser with mobile emulation | Bottom sheet, camera keeps the route clear of the sheet, heading-up map in step mode. **Not yet tested on a physical phone** |
| 12 | Desktop layout | 1280 × 800 | Side panel on the left, map on the right. Long routes can sit close to the right edge |
| 13 | Storage blocked | Code review: every localStorage access is wrapped in try/catch | Should only forget the parking choice. **Not tested in a real private window** |
| 15 | Route by need | "shoes" from Lot A (top 6 of 20 matches by relevance), Footwear chip from Lot B (6 closest of 7), arrival text per stop, "Next stop", back to the car from the last stop | Shortest order over map walking distances; 13 min / ~850 m for 6 stops; stores with no walking route are listed as not included |
| 14 | Build | `npm run build` (tsc strict + Vite) | Clean |

## Known gaps (shipping with them, on purpose)

- **No live position.** "You are here" is the parking entrance (from the QR) and then the start of the current step. Blue Dot needs positioning infrastructure on site; see "Raise with the customer".
- **Main Level only.** Upstairs stores route to the escalator and hand off with a sign-following instruction.
- **Walking time** uses 1.1 m/s (a first-time visitor reading a phone). Not calibrated on site.
- **Entrance names** come from the nearest anchor ("by Nordstrom"). The real door signage may differ.
- **No accessibility routing toggle** (elevators only). The SDK supports it (`accessible: true`); left out because the main-level slice has no level changes.
- **Route by need**: stops cannot be reordered or added by hand yet (planned); text search relevance comes from Mappedin Search, so a store whose description mentions the term can appear (e.g. Lululemon for "shoes").
- **English only.**
- **Opening hours** use the visitor's device clock and time zone.

## Data issues found (for the customer's content team, not for code)

| Issue | Where | Effect | Workaround in this slice |
|---|---|---|---|
| Store has no door node | Urban Kids | Router cannot reach it | Fallback to the closest corridor point |
| Typo in tenant name | "Nordstorm" | Wrong name in search and labels | Display fix in `venue.ts` (`NAME_FIXES`) until the CMS is corrected |
| Anchor entered far from its own doors | Lot A → Nordstrom goes through the mall (245 m) | Longer walk than needed if Nordstrom has an exterior door | None; confirm exterior doors with the customer |
| Some tenants have no logo | e.g. Starbucks | Initials instead of a logo | Initials fallback |

## Before handing it to the customer

1. **On-site walk test** with 5 first-time visitors per property, from each parking entrance, to 3 stores each (an anchor, a small tenant deep in a wing, a food court unit). Pass = arrives without asking anyone.
2. **Real devices**: low-end Android on mall Wi-Fi and on 4G inside the building (map load time, memory).
3. **Signage match**: every entrance name and landmark the app says must be visible from where the visitor stands.
4. **Content audit** of the venue in the CMS: doors on every tenant, names, logos, hours.
5. **Analytics events** (search term, destination, route started, arrived, abandoned) before launch, so the first week gives a baseline.
