# Operator view: what's real and what's simulated

*Greenfield assessment · deep dive on slide 8 · Felipe Chavarri · November 2026*

Event plan: [ANALYTICS.md](ANALYTICS.md)

Live view: https://greenfield-wayfinding-demo.atlas-lac.com/?view=operator
Code: [`src/sim.ts`](src/sim.ts) (simulation) and [`src/operator.ts`](src/operator.ts) (dashboard)

**Map:** no venue was provided with the brief, so the app runs on Mappedin's public demo venue, treated as Greenfield's main property.
**Units:** feet, like the brief. The code works in metres internally; metric equivalents are in brackets.

---

## 1. In one paragraph

The operator view is **a real model with simulated people**. The map, the 136 main-level stores and every route are real: Mappedin's routing engine computes them. The live events are real: whatever someone does in the visitor app shows up in the feed. The people are simulated: 30 days of visitors who park, pick a store and walk the real route. So **anything counted about people is simulated**: the heat map, the 44% Pareto figure, and the 49 weak tenants. The point is not to claim anything about Greenfield. It is to show the decisions the operator could make once real events arrive, using the same dashboard.

---

## 2. What each element on the slide is

| Element | What it shows | Real or simulated |
|---|---|---|
| Dashboard screenshot (left) | Tiles, Pareto, tenant list | Mixed: the live feed is real; the 30-day figures are simulated |
| Heat map (red, orange, grey) | Storefronts with many passers-by (red) and almost none (grey) | **Simulated**: painted by simulated visitors on real routes |
| "Real" box | The map, every SDK route, live app events | Real |
| "Simulated, labelled" box | 30 days of visitors, every assumption in a table | Simulated |
| "Simulated: top 20% of stores get 44% of exposure" | How concentrated traffic is | **Simulated** |

**Exposure** = how many times people walk past a storefront. A storefront scores 1 each time a route passes within **50 ft** (15 m) of it. It's what a mall sells a tenant: traffic in front of the window.

**The 44%:** rank the 136 stores by exposure. The top 20% (about 27 stores) get 44% of all passes. With an even spread they would get 20%. Traffic piles up in a few storefronts and leaves cold wings, which is the shape of the brief's second pain. It is a simulated result on a real map, **not a measurement of Greenfield**.

---

## 3. How the simulation works: one visitor, step by step

**Simulated visitor #17:**

1. **Parking area:** drawn from Lot A 45%, Lot B 35%, Garage 20%. → Lot A.
2. **Visit type:** 70% one store, 20% two stores, 10% route by need. → one store.
3. **Which store, by a gravity model** (Huff-style: people favour popular, nearby stores):
   pull = popularity × 0.5^(distance / 560 ft), so the pull halves every **560 ft** (170 m).
   - Apple, a regular store (popularity 1), 390 ft away: 1 × 0.5^(390/560) ≈ **0.62**
   - Nordstrom, an anchor (popularity 6), 820 ft away: 6 × 0.5^(820/560) ≈ **2.17**
   - Nordstrom is three times as likely, though the draw is random, so sometimes Apple wins. Food weighs 1.6×.
4. **The walk:** Mappedin computes the real route from Lot A to the chosen store. **This part is real.**
5. **Exposure:** every storefront within 50 ft of that route scores +1.
6. **Completion:** about 88% of routes are completed; routes with more stops are completed less often.

**Repeat and scale:**
- **360 visits** are actually routed on the map.
- Scaled to 30 days: 22,000 visits a day × 4% app adoption × 30 days = **26,400 sessions**; 70% start a route, so each simulated visit stands for about 51 people.
- **Fixed seed:** the "30 days" are identical on every load, so the numbers can be checked and discussed.
- **Low-interest stores:** about 12% of non-anchor stores are flagged low-interest. Visitors drop them from a route by need 35% of the time (8% for other stores).

---

## 4. Where the counts come from

**Nobody counted anything.** The 22,000 daily visits, the 4% adoption and the parking split are assumptions for a regional mall of about 830,000 sq ft. Each one is listed in the **Assumptions** tab with a range and its future source. The brief mentions no cameras or sensors, so I didn't assume Greenfield has any.

In production, each number has a source:

| Assumption today | Real source | Without hardware |
|---|---|---|
| 22,000 visits a day | Door counters at the entrances, if Greenfield has them | A one-week manual count at each entrance, sampled by hour; or cars in × occupants per car |
| 4% use the app | App sessions ÷ daily visits | The same, with the manual count as the denominator |
| Lot A 45% · Lot B 35% · Garage 20% | Parking gates or licence-plate readers | QR scans per parking area (the app measures this from day one) |
| Each store's popularity | `store_selected` and search events | The same: the app measures it |
| Exposure in front of each storefront | Corridor cameras or guest Wi-Fi (counts everyone) | App routes (counts app users only) |

**The rule:** anything about app users, the app measures from day one. Anything about **all** visitors needs people counting: door counters if they exist, or a manual count to set the baseline. That's why people counting is my phase-two recommendation, not an assumption.

---

## 5. What comes out (all simulated)

- **Heat map:** top third of storefronts by exposure in red; bottom quartile in grey ("cold wing").
- **Pareto:** the top 20% of stores get 44% of exposure.
- **Busiest storefronts:** RBC, American Eagle and Shoppers Drug Mart, on the walks from the parking entrances.
- **An honest note:** I expected the busiest storefronts to sit next to the anchors, as the brief suggests. In the simulation they don't: the parking entrances pull more. So I don't claim the brief's hypothesis from simulated data. Greenfield's real data decides it.
- **Tenants tab:** two measures per store.
  - **Demand:** how often it is searched for or picked.
  - **Exposure:** how often people walk past it.
  - Low exposure despite demand → a **location** problem: the mall can move traffic.
  - Low demand → an **interest** problem: mix, marketing or leasing.
  - Result: **49 of 136 stores show a weak signal: 26 location, 19 interest, 4 both.** Anchors are excluded, since they draw traffic by definition.
- **30-day return, 24%:** a fixed assumption, not a result. It is the baseline to measure.

**What is real inside the dashboard:**
- The **live feed**: events from the visitor app.
- The **search terms that find nothing** (cinema, eyeglasses…): tested against Mappedin Search on this venue. Only how often each one is searched is simulated.
- The **"+1 live"** counter when someone searches one of those terms in the visitor app.

---

## 6. Why simulate at all

1. **To show the decisions** the operator could make before there is data: which wing is cold, which tenant has a location problem and which has an interest problem, what the mall is missing.
2. **To build the instrument now:** the events already exist (`qr_scan`, `route_started`, `stop_removed`…). When real visitors arrive, the simulated visits are replaced by real ones and the dashboard stays the same.
3. **To make every assumption explicit:** each simulated number has a range and a future source. Each row is a question for Greenfield.

**What it doesn't do:** it proves nothing about Greenfield, and it doesn't say churn is caused by foot traffic. It is the tool to find out.

---

## 7. Moving to real data

1. Send the events to Mappedin Analytics or Greenfield's own pipeline. In the demo they stay in the browser, so no test data reaches anyone's backend.
2. Replace each assumption with its measurement, starting with the ones the app measures itself: parking split, route mix, completion, drops.
3. Calibrate the gravity model (anchor weight, distance decay) against real `store_selected` events and route lengths.
4. Add people counting for the total-traffic numbers, and tenant sales for conversion: walk past, walk in, buy.
