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
| 16 | Editing a route | Reverse, remove a stop, move a stop up/down, back to shortest; each logged as an event (`route_reversed`, `stop_removed`, `stop_moved`, `route_reset_to_shortest`) | Untouched routes re-optimise after a removal; a route the visitor arranged keeps their order and shows "+N min vs shortest" |
| 17 | Search terms that build routes | 45 everyday terms run against Mappedin Search on the main level | Good groups: coffee (5), running (6), phone (6), jeans, gifts (6), hair (5), winter jackets (7), chocolate (3), lingerie (3), jewelry (3), tea, pizza, denim, yoga, sunglasses, makeup, frozen yogurt. Weak: "books", "toys", "bank", "dessert" return unrelated stores (fuzzy matches on descriptions). "perfume", "skincare", "glasses", "electronics" find stores only on the Upper Level, so they cannot build a main-level route. Across the whole venue, these find nothing: cinema, grocery, supermarket, bookstore, dentist, tailor, arcade, optician, eyeglasses (Lenscrafters exists, untagged), halal, stroller, wheelchair |
| 18 | Operator view | Loads 360 simulated visits routed on the real map (seeded: same numbers every load), heat map painted, tenant card and map focus on click, live feed receives events from the visitor app in another tab | Top 20% of stores get ~44% of route exposure; 49 of 136 stores flagged (26 location, 19 interest, 4 both); anchors excluded from the diagnosis |
| 19 | Honesty of the simulation | Checked whether "closeness to an anchor" explains exposure in this venue | It doesn't: the busiest storefronts are on the walks from the parking entrances. The view says which stores are busiest and leaves H2 as a hypothesis for real data, instead of claiming it |
| 20 | Searches with no result | Searched "cinema" (in the simulated list) and "karaoke" (not in it) in the visitor app with the operator view open in another tab | "cinema" gets a "+1 live" badge on top of its simulated month; "karaoke" appears as "New, to classify"; both show in red in the live feed. Each term is tagged with who acts: Leasing (not in the mall), Content (tag missing), Operations (service info) |
| 21 | Choosing the stores | "shoes" from Lot A: dropped Lululemon, added Nike Factory Store from "Add a “shoes” store" (15 other matches listed), went back to the results and reopened the route; then "↺ Suggested stores" | The edited route (6 stops) comes back as the visitor left it; with 6 stops every "+ Add" is disabled with "remove one first"; "Suggested stores" restores the original 6 in the shortest order. Logged as `stop_removed`, `stop_added`, `category_route_reopened`, `route_reset_to_suggested`. Edits are kept for the session only |
| 22 | Edit controls on a phone | 375 × 812: ↑ ↓ ✕ at 38 px with blue/red borders and a hint line above the list | The first tester missed the old 30 px grey buttons; the new ones read as buttons. **Still to check on a real phone** |
| 23 | Scripted QA, reproducible | Open `?view=qa` (code in `src/qa.ts`): routing coverage, search audit over the 76 terms named in the deck, content completeness. Runs on the venue data only, no rendered map | Nov 8, 2026: **405 / 408 routes**, unreachable from every start: **Urban Kids**; the same **12 terms find nothing**; **34 of 136 main-level stores miss a logo, today's hours or a description**. Automatic buckets (route 38, one place 18, upper only 8) differ from the deck's 26 / 15 / 5 because "misleading" (27 terms) is a human review of the top results, which the report lists |
| 14 | Build | `npm run build` (tsc strict + Vite) | Clean |

## Known gaps (shipping with them, on purpose)

- **No live position.** "You are here" is the parking entrance (from the QR) and then the start of the current step. Blue Dot needs positioning infrastructure on site; see "Raise with the customer".
- **Main Level only.** Upstairs stores route to the escalator and hand off with a sign-following instruction.
- **Walking time** uses 1.1 m/s (a first-time visitor reading a phone). Not calibrated on site.
- **Entrance names** come from the nearest anchor ("by Nordstrom"). The real door signage may differ.
- **No accessibility routing toggle** (elevators only). The SDK supports it (`accessible: true`); left out because the main-level slice has no level changes.
- **Route by need**: capped at 6 stops (exact order); edits are kept for the session only; text search relevance comes from Mappedin Search, so a store whose description mentions the term can appear (e.g. Lululemon for "shoes").
- **English only.**
- **Opening hours** use the visitor's device clock and time zone.

## Data issues found (for the customer's content team, not for code)

| Issue | Where | Effect | Workaround in this slice |
|---|---|---|---|
| Store has no door node | Urban Kids | Router cannot reach it | Fallback to the closest corridor point |
| Typo in tenant name | "Nordstorm" | Wrong name in search and labels | Display fix in `venue.ts` (`NAME_FIXES`) until the CMS is corrected |
| Anchor entered far from its own doors | Lot A → Nordstrom goes through the mall (245 m) | Longer walk than needed if Nordstrom has an exterior door | None; confirm exterior doors with the customer |
| Thin or missing search tags | e.g. "bank" does not find RBC RoyalBank; "eyeglasses" and "optician" find nothing although Lenscrafters exists | Category routes and searches miss stores; weak terms build odd routes | None in code: tag every tenant in the CMS (products, services, synonyms) |
| Some tenants have no logo | e.g. Starbucks | Initials instead of a logo | Initials fallback |

## Before handing it to the customer

1. **On-site walk test** with 5 first-time visitors per property, from each parking entrance, to 3 stores each (an anchor, a small tenant deep in a wing, a food court unit). Pass = arrives without asking anyone.
2. **Real devices**: low-end Android on mall Wi-Fi and on 4G inside the building (map load time, memory).
3. **Signage match**: every entrance name and landmark the app says must be visible from where the visitor stands.
4. **Content audit** of the venue in the CMS: doors on every tenant, names, logos, hours.
5. **Analytics events** (search term, destination, route started, arrived, abandoned) before launch, so the first week gives a baseline.
