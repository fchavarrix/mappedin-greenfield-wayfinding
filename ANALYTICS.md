# Analytics plan · Greenfield Mall wayfinding

What the app measures, why, and who acts on it. Everything here comes from the app itself on Mappedin: **no cameras, sensors or sales data are assumed**, because the brief doesn't say Greenfield has them. Those are listed at the end as what they would unlock.

## Principles
- **Anonymous by default.** No names, emails or precise positions. At most an anonymous device id, to count returning visitors.
- **Aggregated for the operator.** The operator view shows totals per store, wing and day, never individual journeys.
- **The customer owns the data.** Events go to Mappedin Analytics (`mapView.Analytics.capture`, which already supports `$query-search`, `$select-location`, `$select-category`) or to Greenfield's own pipeline, with an export they control.
- **In this demo nothing leaves the browser.** Events are kept in local storage so the operator view can show them live; no test data is sent anywhere.

## Events

| Event | Properties | Fired when | Answers |
|---|---|---|---|
| `qr_scan` | entrance | The app opens from a parking QR sign | Where visitors arrive; which signs work |
| `parking_selected` | entrance | The visitor picks a parking area by hand | Same, for people who didn't scan |
| `search` | term, results, zero | The visitor pauses typing (900 ms) | What people look for; **zero-result searches** = missing tenant or missing tag |
| `store_selected` | store, category, from | A store card opens | Demand per tenant |
| `route_started` | kind (single / category), stops, from | Turn-by-turn starts | Intent to visit |
| `stop_reached` | store, stop, of | A stop is reached inside a route by need | Visits guided to each store |
| `arrived` | store, stop, of | The last step is reached | Route completion (H1) |
| `route_abandoned` | step, of, store | The visitor leaves turn-by-turn before arriving | Where people get lost; data or signage to fix |
| `route_back` | from, to | The visitor asks for the way back to the car | End of visit; dwell between arrival and exit |
| `category_route_opened` | label, stops, matches | A route by need is proposed | Which needs drive multi-store visits |
| `category_route_started` | label, stops, customised | The visitor starts it | Uptake of routes by need (H4) |
| `route_reversed` | label | The visitor reverses the order | Preferred starting side |
| `stop_removed` | label, store, position, remaining | The visitor drops a store from their own route | **Drop rate per tenant**: an interest signal, not a location one (H3) |
| `stop_moved` | label, store, from, to | The visitor reorders | Which stores people want first |
| `route_reset_to_shortest` | label | Back to the shortest order | Whether the optimal order is what people want |
| `stop_added` | label, store, stops | The visitor adds another matching store to their route | **Pull per tenant**: stores people choose on their own, beyond the suggestion (H3, H4) |
| `route_reset_to_suggested` | label | Back to the suggested stores | Whether the suggestion was good enough |
| `category_route_reopened` | label, stops | The visitor reopens a route they had already edited (kept for the session) | Return to a planned visit |
| `step_free_toggled` | on, view, from | The visitor turns the step-free route on or off | **How many visitors need a route without stairs**, and from which parking area: elevator capacity, accessible parking, where to lend wheelchairs |

Route exposure (how often a storefront ends up on someone's route) is derived from `route_started` plus the route geometry, not logged per store.

## From metric to decision

| Team | Question | Signal | Action |
|---|---|---|---|
| Leasing | What is missing from the mix? | Zero-result searches | Leasing opportunity |
| Leasing | Is a tenant at risk because of location or interest? | Exposure vs demand and drop rate | Move traffic (location) or work on offer and marketing (interest) |
| Leasing | What does the mall do for this tenant? | Searches, exposure, guided visits per month | Monthly tenant report for renewals |
| Marketing | Which needs bring people in? | Searches and routes by need by category | Campaigns, themed trails |
| Operations | Where do people get lost? | `route_abandoned` by step and store | Fix map data or signage |
| Operations | Where do visitors arrive? | `qr_scan` by entrance | Signage and parking guidance |
| Management | Is it working? | Route completion, share of visits to non-anchor stores, return rate | Go / no-go for phase two |

## Hypotheses this release can test
1. **H1** Visitors can't find stores → completion rate, zero-result searches.
2. **H2** Traffic concentrates near the anchors → route exposure by store and wing.
3. **H3** At-risk tenants suffer from location, not interest → exposure vs demand, drop rate.
4. **H4** Guided visitors walk to more stores → routes by need started and stops reached.
5. **H5** Better wayfinding moves retention → returning app users vs the baseline.

## What would unlock more (recommendations, not assumptions)
- **People counting at entrances and storefronts** → total traffic (not only app users) and **capture rate**.
- **Guest Wi-Fi presence analytics**, if the network exists → density by zone to calibrate the model.
- **Sales by tenant** → **conversion** and productivity per sq ft: a full tenant health matrix.

## The operator view in this demo
`?view=operator` shows thirty days of **simulated** usage (labelled as such) next to the **real** events of the visitor app open in another tab. What is real: the venue, the stores and every route, computed by Mappedin. What is simulated: who comes, where they park and what they look for. The assumptions table in the view lists every number with a reference range; each one is a question for Greenfield.
