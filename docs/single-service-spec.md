# DeckDrop v2 — Single-Service Architecture Spec

## Problem

Current architecture creates a new Render web service per deck. Each runs identical `server.js` code — the only difference is the `DECK_NAME` env var. This means:

- Deploying a new deck takes minutes (Render API call + build)
- Each deck costs a Render service slot (starter plan)
- More services = more ops overhead, env var drift risk
- Auth proxy is a separate service with a persistent disk (single point of failure)

## Proposed Architecture

Consolidate everything into **one Render service** that serves all decks via path-based routing. Merge the auth proxy into the same service to eliminate the second service entirely.

### URL Scheme

```
https://deckdrop.onrender.com/{slug}          → deck HTML
https://deckdrop.onrender.com/{slug}/login    → deck login
https://deckdrop.onrender.com/{slug}/admin    → deck user management
https://deckdrop.onrender.com/admin           → global admin dashboard
https://deckdrop.onrender.com/auth/google     → shared OAuth entry
```

### Before vs After

| | Current (v1) | Proposed (v2) |
|---|---|---|
| Render services | 1 auth proxy + N deck services | 1 service |
| Deploy new deck | Render API + build (~2 min) | `git push` (~30s auto-deploy) |
| Cost | Scales with deck count | Fixed (1 service) |
| Disk | 1GB on auth proxy | 1GB on single service |
| User isolation | Auth proxy per-slug files | Same (per-slug files, same disk) |
| Auth flow | Deck → proxy → Google → proxy → deck | Single service, no cross-service redirect |
| Failure blast radius | 1 deck | All decks |

## Server Design

### Routing

Single Express app. The slug is extracted from the URL path.

```
GET  /:slug                → serve deck HTML (requireAuth)
GET  /:slug/login          → deck login page
GET  /:slug/auth/google    → start OAuth (store slug in session)
GET  /auth/google/callback → Google callback (shared, single callback URL)
GET  /:slug/auth/verify    → (removed — no cross-service token needed)
GET  /:slug/logout         → destroy session
GET  /:slug/denied         → access denied page
GET  /:slug/admin          → per-deck user management (requireAdmin)
GET  /:slug/api/users      → list deck users (requireAdmin)
POST /:slug/api/users      → add users (requireAdmin)
DELETE /:slug/api/users/:email → remove user (requireAdmin)
GET  /:slug/api/me         → current user info

GET  /admin                → global dashboard (requireGlobalAdmin)
GET  /admin/api/decks      → list all decks with user counts
POST /admin/api/decks/:slug → add users to deck
DELETE /admin/api/decks/:slug/:email → remove user from deck

GET  /health               → health check

Static: /:slug/*           → decks/{slug}/public/* (images, assets)
```

### Slug Resolution

Middleware extracts slug from the first path segment and validates:

```
1. Parse first path segment from URL
2. Check: does decks/{slug}/deck.json exist?
3. If yes: attach slug + deck metadata to req
4. If no: 404
```

No `DECK_NAME` env var. No per-service configuration. The slug **is** the URL.

### Auth Flow (Simplified)

Since auth and deck server are the same process, no signed tokens or cross-service redirects are needed.

```
1. User visits /{slug}
2. No session → redirect to /{slug}/login
3. Click "Sign in with Google"
4. GET /{slug}/auth/google
   → Store slug in session
   → Redirect to Google OAuth (single callback URL)
5. Google redirects to /auth/google/callback
   → Passport extracts email/name/photo
   → Read slug from session
   → Check whitelist for that slug
   → If allowed: create session, redirect to /{slug}
   → If not: redirect to /{slug}/denied
```

One Google OAuth callback URL to register: `https://deckdrop.onrender.com/auth/google/callback`

No HMAC tokens. No AUTH_SECRET for cross-service auth. Sessions handle everything.

### User Storage

Same as current auth proxy — JSON files on disk:

```
/var/data/{slug}/users.json    → {"users": ["email@example.com", ...]}
/var/data/{slug}/meta.json     → {"name": "Display Name"}
```

Persistent disk mounted at `/var/data` (1GB, same as current auth proxy).

### Deck Content Storage

Deck HTML and assets are served from the git repo:

```
decks/{slug}/
  ├── deck.json              → metadata (name only, no renderUrl needed)
  ├── data/users.seed.json   → seed users for first deploy
  └── public/
      ├── index.html          → the presentation
      └── images/             → static assets
```

## Deploy Pipeline (Simplified)

### New Deck Deploy

What the manager (`manage.js`) does:

| Step | Action |
|---|---|
| 1 | Create `decks/{slug}/` structure locally (same as today) |
| 2 | `git add decks/{slug}/` |
| 3 | `git commit -m "Add deck: {name}"` |
| 4 | `git push origin main` |
| 5 | Seed users: `PUT /api/{slug}/seed` on the running service |

That's it. No Render API call. No new service creation. Auto-deploy picks up the new deck folder.

**Steps removed vs v1:**
- ~~Ensure auth proxy~~ (merged)
- ~~Create Render service~~ (single service)
- ~~Save renderUrl~~ (URL is deterministic: `/{slug}`)
- ~~Render API calls~~ (only needed for initial one-time setup)

### Update Existing Deck

| Step | Action |
|---|---|
| 1 | Write new HTML to `decks/{slug}/public/index.html` |
| 2 | `git add` / `git commit` / `git push` |

Same as today. Auto-deploy handles the rest.

### First-Time Setup (One Time)

The single Render service must be created once, either manually via Render dashboard or via the manager's deploy button on first use:

- Service name: `deckdrop` (or `deck-drop`)
- Repo: `itayshmool/deck-drop`
- Branch: `main`
- Build command: `npm install`
- Start command: `node server.js`
- Disk: `/var/data`, 1GB
- Env vars:
  - `GOOGLE_CLIENT_ID`
  - `GOOGLE_CLIENT_SECRET`
  - `SESSION_SECRET`
  - `ADMIN_EMAILS`
  - `DATA_DIR=/var/data`
  - `NODE_ENV=production`

After this, all subsequent deck deploys are just `git push`.

## Manager Changes (`manage.js`)

### Removed

- `ensureAuthProxy()` — no separate auth proxy
- `renderApi()` calls for service creation — no per-deck services
- `toServiceName()` — no service naming
- `AUTH_SERVICE_URL`, `AUTH_SECRET` config — no cross-service auth
- `RENDER_API_KEY` config — not needed for day-to-day deploys
- `httpRequest()` for seeding — seed directly via HTTP to the single service
- `renderUrl` in `deck.json` — URL is `/{slug}`, deterministic

### Changed

- Deploy pipeline: git push only (+ seed users to running service)
- Config: only needs `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ADMIN_EMAILS`
- Settings modal: fewer fields

### Added

- `BASE_URL` config — the single service URL (e.g. `https://deckdrop.onrender.com`)
- Seed endpoint calls to `BASE_URL/api/{slug}/seed` instead of auth proxy

## Files Changed

| File | Change |
|---|---|
| `server.js` | Rewrite: multi-deck routing, merged auth, slug-from-URL |
| `auth-proxy.js` | Delete (merged into server.js) |
| `manage.js` | Simplify: remove Render API, remove auth proxy logic |
| `middleware/auth.js` | Simplify: remove remote mode, single local-disk mode |
| `views/login.html` | Update: links use `/{slug}/auth/google` |
| `views/admin.html` | Update: API paths include slug prefix |
| `views/manage.html` | Simplify: fewer deploy steps, no Render API key needed |
| `views/dashboard.html` | Update: runs on same service at `/admin` |
| `deck.json` (all decks) | Remove `renderUrl` field |
| `package.json` | No dependency changes needed |

## Migration

### Existing Decks

1. User data lives on the auth proxy disk (`/var/data/{slug}/users.json`).
2. Before decommissioning auth proxy: copy `/var/data/*` to the new single service's disk.
3. Or: re-seed from `users.seed.json` (loses users added via admin panel post-deploy).

### Existing URLs

Old URLs (`https://online-decks-{slug}.onrender.com`) will break. Options:

- **Accept the break** — update links, inform users.
- **Redirect service** — keep old services alive with a redirect to `https://deckdrop.onrender.com/{slug}`. Decommission after transition period.

### Google OAuth

- Remove all per-deck callback URLs from Google Cloud Console.
- Add single callback: `https://deckdrop.onrender.com/auth/google/callback`.

## What Stays the Same

- Deck folder structure (`decks/{slug}/`)
- User seed files (`users.seed.json`)
- Per-deck user isolation (separate JSON files)
- Google OAuth provider
- Express + Passport stack
- Admin panel functionality
- Local manager dashboard on port 4000
- Git-driven deployment model
