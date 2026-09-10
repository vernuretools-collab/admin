# CRM Admin

Windows desktop app for the Business OS **admin** portal, plus a **Work screenshots** gallery for captures taken by the employee desktop app.

This folder is separate from the employee and client desktop apps.

## Setup

1. Copy `.env.example` to `.env` and set `SUPABASE_URL` / `SUPABASE_ANON_KEY` to the same values as the Vite portals.
2. Ensure `work_screenshots` SQL from `crm-employee-desktop/sql/work_screenshots.sql` has been applied once.
3. Install and bundle the admin portal:

```
npm install
npm run portals
```

4. Start:

```
npm run dev
```

Tray menu: Open Admin, Work screenshots, Quit.

## Windows installer

```
npm run dist
```

Output is `release/CRM Admin-Setup-1.0.0.exe`. Copy `.env` next to the installed exe or into `%APPDATA%\CRM Admin\.env` so the gallery can load signed URLs.
