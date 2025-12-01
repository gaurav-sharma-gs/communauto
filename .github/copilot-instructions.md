## Purpose
Short, actionable guidance for AI coding agents working on this repository so they can be productive quickly.

## Big-picture architecture (what to know first)
- This is a Next.js 14 application using the App Router. The UI is primarily in `app/page.js` (client-side heavy, marked with `"use client"`).
- Server logic lives in App Router API routes under `app/api/*` and run server-side (examples: `app/api/cars/route.js`, `app/api/notify/ntfy/route.js`). These routes act as thin proxies / adapters to upstream services.
- Google Maps JS is used on the client (browser) for the interactive map. Browser API key is required via `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`.
- Deploys as a serverless Next.js app (Vercel-ready). `package.json` scripts: `npm run dev`, `npm run build`, `npm start`.

## Key files to inspect for patterns and examples
- `app/page.js` — main client UI and polling/alert logic (search center, progressive radius search, localStorage ntfy settings). Look here for map interaction patterns, `radiusSequence`, `carKey()` and how cars are rendered/filtered.
- `app/api/cars/route.js` — server route that fetches Communauto vehicles, contains `branchIds`, `getCars()` and `retry()` helper. Shows how upstream data is normalized to { brand, model, plate, color, lat, lng, distance }.
- `app/api/notify/ntfy/route.js` — server route that POSTs to an ntfy server. Accepts { server, topic, message, title, priority, token } in JSON and forwards headers accordingly.
- `app/layout.js` — global layout; conditionally injects Google AdSense Script if `NEXT_PUBLIC_GOOGLE_ADS_CLIENT` is set. Useful for where global scripts are added.
- `README.md` — contains environment variable guidance and high-level features (useful to copy in PRs or developer docs).

## Data contracts and examples (very important)
- /api/cars GET query params: city (string), lat (float), lng (float), radius (meters, int), optional plate (string). Response JSON: { cars: [ { brand, model, plate, color, lat, lng, distance } ] }.
  - Example request: `/api/cars?city=toronto&lat=43.6532&lng=-79.3832&radius=1000`
- /api/notify/ntfy POST body (JSON): { server, topic, message, title?, priority?, token? }.
  - Example body: { "server": "https://ntfy.sh", "topic": "my-topic", "message": "Car arrived" }

## Project-specific conventions and patterns
- Progressive radius search: `app/page.js` uses `radiusSequence = [500,1000,3000,5000,...]` and will try increasing radii until cars are found. When modifying search logic, preserve this progressive behavior unless intentionally changing UX.
- Car identity uses `carKey(car)` -> `${plate}-${lat.toFixed(5)}-${lng.toFixed(5)}`. Avoid changing coordinates formatting without updating comparisons across client code.
- Local storage key for ntfy settings: `communeauto-ntfy-settings` (see `NTFY_SETTINGS_KEY` in `app/page.js`). Read/write happens in plain JSON.
- Server routes set `export const dynamic = 'force-dynamic'` and `export const revalidate = 0` — routes are intentionally non-cached. Preserve these exports for any server-side data adapters.
- City/branch mapping is hard-coded in `app/api/cars/route.js` as `branchIds`. To add a city, update that map and ensure the BranchID matches the external API.

## Developer workflows & commands
- Install: `npm install` (uses package.json with Next 14). Run dev server: `npm run dev` (localhost:3000).
- Build for production (Vercel does this automatically): `npm run build` then `npm start` to run the built app locally.
- Environment variables: must set `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`. Optional: `NEXT_PUBLIC_GOOGLE_ADS_CLIENT`, `NEXT_PUBLIC_GOOGLE_ADS_SLOT_SIDEBAR`, `NEXT_PUBLIC_GOOGLE_ADS_SLOT_TALL`.

## Debugging notes
- Server route errors are surfaced with console.error in the route handlers (check terminal running `next dev` or Vercel logs after deploy).
- When testing the client map UI, ensure the Google Maps API key is valid and available in `process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`.
- Upstream fetches to Communauto are proxied in `app/api/cars/route.js`. Use the `retry()` helper there if you change upstream interaction.

## Small, concrete examples of edits you may be asked to do
- Add a city: update `branchIds` in `app/api/cars/route.js`, and add UI label in `app/page.js` if necessary.
- Change search behavior: edit `radiusSequence` or the `filterByViewport`/`getVisibleRadiusMeters()` usage in `app/page.js` — preserve existing logic for progressive search unless user requests a UX change.
- Add telemetry: add console.debug or structured logs inside API routes — logs appear in the Next dev terminal or Vercel function logs.

## What this file DOES NOT cover
- No test harnesses or linters are present in the repo; don’t fabricate a test framework. If tests are requested, propose adding a light test runner (Jest or Vitest) in a follow-up.

If anything above is unclear or you want me to expand a specific area (example requests, add a new city, or wire a simple test), tell me which part to expand and I’ll iterate.
