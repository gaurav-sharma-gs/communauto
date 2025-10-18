WIP - This application has been vibe coded and is not as functional as I wanted it to be. Had a couple of hours to do the coding. WIll work on in later

# CommuneAuto Finder

A Next.js application for browsing Communauto vehicles on Google Maps, configuring geofenced alerts, and preparing multi-channel notifications (browser push + SMS).

## Tech Stack
- [Next.js 14](https://nextjs.org/) with the App Router (Vercel ready)
- Google Maps JavaScript API with Places Autocomplete
- Serverless API routes proxying the Communauto availability endpoint
- Service worker-powered browser notifications and optional SMS delivery via Twilio

## Getting Started

1. **Install dependencies**
   ```bash
   npm install
   ```
2. **Configure environment variables**
   Create a `.env.local` file with:
   ```ini
   NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your-google-maps-browser-key
   TWILIO_ACCOUNT_SID=your-twilio-account-sid          # optional (required for SMS)
   TWILIO_AUTH_TOKEN=your-twilio-auth-token            # optional
   TWILIO_FROM_NUMBER=+14165551234                     # optional, must be a Twilio verified/sender number
   NEXT_PUBLIC_GOOGLE_ADS_CLIENT=ca-pub-xxxxxxxxxxxxxxx           # optional, required for AdSense
   NEXT_PUBLIC_GOOGLE_ADS_SLOT_SIDEBAR=xxxxxxxxxx                  # optional, AdSense slot id for 300x250
   NEXT_PUBLIC_GOOGLE_ADS_SLOT_TALL=xxxxxxxxxx                     # optional, AdSense slot id for 300x600 or responsive
   ```
   Only `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is required for local testing. Twilio values enable the SMS API route, and the AdSense variables activate live ad slots.
3. **Run the dev server**
   ```bash
   npm run dev
   ```
4. Open [http://localhost:3000](http://localhost:3000) to explore the map UI.

## Features
- City-aware vehicle lookup (Toronto and Montreal by default; add more in `app/api/cars/route.js`).
- Interactive Google Map that supports search, click-to-set, drag-to-adjust, and geolocation-based origin.
- Real-time polling with configurable radius monitoring and push notifications when cars enter range.
- Progressive radius search (500 m, 1 km, 3 km, 5 km, etc.) that stops as soon as cars are found, then fits the map to that live radius.
- Reminder section that lets users trigger push alerts or browser fallbacks without leaving the tab.
- Browser notifications fire via the service worker once you enable them (SMS alerts remain “coming soon”).
- SMS and sponsored placements are hidden in this build; they’ll return once integrations are ready.
- Click any vehicle to confirm availability, focus the marker, and sync the list without additional Google Maps requests.
- Auto-refresh interval (default 1 minute) configurable from the controls for mobile and desktop users.

## Deploying to Vercel
1. Push this repository to GitHub (or your preferred Git provider).
2. Import the project in the [Vercel dashboard](https://vercel.com/new) and select the repo.
3. Set the environment variables under **Project Settings → Environment Variables**.
4. Trigger a deployment; Vercel automatically builds with `npm run build` and serves the App Router output.

## SMS Notes
The `/api/notify/sms` endpoint is intentionally light-weight. Provide Twilio credentials to enable outbound SMS. If those environment variables are missing, the endpoint returns HTTP 501 with guidance so the UI can surface a helpful message.

## Extending
- Enhance notification scheduling by persisting user preferences (e.g., Supabase or Vercel KV).
- Store subscription data and connect the service worker to a push provider (OneSignal, Firebase Cloud Messaging) for true push delivery.
- Integrate your analytics/ad pixels by editing `app/layout.js`.
- Expand the city list or make branch IDs configurable through a CMS or database.
