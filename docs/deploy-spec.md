# DeckDrop — Deck Deployment Spec

## Overview

Deploying a new deck is a 7-step automated pipeline triggered from the local manager dashboard (`localhost:4000`). It creates a local deck structure, commits to git, provisions a Render web service, seeds users to the auth proxy, and saves the production URL.

## Prerequisites

| Requirement | Where |
|---|---|
| Google OAuth Client ID & Secret | `.manage.env` via Settings modal |
| Admin emails (CSV) | `.manage.env` via Settings modal |
| Render API Key | `.manage.env` via Settings modal |
| Auth Secret (auto-generated) | `.manage.env` via Settings modal |
| Git push access to `origin main` | Local git config / SSH key |

## Step 1: Create Deck (Local)

**Trigger:** "Create Deck" button in manager UI.

**Inputs:**

- `slug` — lowercase, numbers, hyphens, dots. No `..`. Used as folder name and Render service suffix.
- `name` — display name.
- `users` — seed email list (one per line).
- `file` — HTML file upload (the presentation).

**Result:** Local directory created:

```
decks/{slug}/
  ├── deck.json              {"name": "<name>"}
  ├── data/users.seed.json   {"users": ["<email>", ...]}
  └── public/index.html      <uploaded HTML>
```

**Endpoint:** `POST /api/decks`

## Step 2: Deploy (7-Step Pipeline)

**Trigger:** "Deploy" button in manager UI.

**Endpoint:** `POST /api/decks/:slug/deploy`

### 2.1 Ensure Auth Proxy

- Check if `online-decks-auth` service exists on Render (`GET /v1/services?name=online-decks-auth`).
- If not found: create via Render API with env vars (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `AUTH_SECRET`, `ADMIN_EMAILS`, `CALLBACK_URL`, `DATA_DIR=/var/data`, `NODE_ENV=production`).
- Generate `AUTH_SECRET` if missing in `.manage.env`.
- Skipped on subsequent deploys.

### 2.2 Git Add

```
git add decks/{slug}/
```

### 2.3 Git Commit

```
git commit -m "Deploy deck: {name}"
```

Skipped if no changes.

### 2.4 Git Push

```
git push origin main
```

Triggers Render auto-deploy for all existing services tied to the repo.

### 2.5 Create Render Service

- Call Render API: `POST /v1/services`
- Service name: `online-decks-{slug}`
- Runtime: Node
- Plan: Starter
- Region: Frankfurt
- Build command: `npm install`
- Start command: `node server.js`
- Env vars:
  - `DECK_NAME={slug}`
  - `AUTH_SERVICE_URL=https://online-decks-auth.onrender.com`
  - `AUTH_SECRET=<from .manage.env>`
  - `SESSION_SECRET=<generated>`
  - `ADMIN_EMAILS=<from .manage.env>`
  - `NODE_ENV=production`
- Skipped if service already exists (re-deploy).

### 2.6 Seed Users

- `PUT https://online-decks-auth.onrender.com/api/{slug}/seed`
- Body: `{"users": [<emails from users.seed.json>]}`
- Auth: `Bearer <AUTH_SECRET>`
- Only seeds if auth proxy has no existing users for this slug.
- Retries 3x with backoff (5s, 10s, 15s) to handle cold-start.

### 2.7 Save Render URL

- Write `renderUrl` to `decks/{slug}/deck.json`.
- `git add decks/{slug}/deck.json`
- `git commit -m "Save Render URL for {slug}"`
- `git push origin main`

## Result

Deck live at: `https://online-decks-{slug}.onrender.com`

## Post-Deploy: Update HTML

**Trigger:** "Update" button in manager UI.

**Endpoint:** `POST /api/decks/:slug/update`

1. Upload new HTML file.
2. Write to `decks/{slug}/public/index.html`.
3. `git add` / `git commit` / `git push`.
4. Render auto-deploys.

## Post-Deploy: User Management

| Action | Method |
|---|---|
| Add/remove users via deck admin panel | `POST/DELETE /api/users` on deck server, proxied to auth proxy |
| Add/remove users via auth proxy admin | `POST/DELETE /admin/api/decks/:slug` on auth proxy |
| Update seed list locally | `PUT /api/decks/:slug/users` on manager, writes `users.seed.json` |

Seed list is only used on first deploy. Live user changes happen on the auth proxy disk and are not written back to git.

## Auth Flow (Production)

1. User visits `https://online-decks-{slug}.onrender.com`.
2. No session — redirected to `/login`.
3. "Sign in with Google" redirects to auth proxy: `/auth/google?origin={deck-url}`.
4. Auth proxy runs Google OAuth via Passport.
5. On success, auth proxy signs a token: `HMAC-SHA256({email, name, photo, exp: now+5min}, AUTH_SECRET)`.
6. Redirect back to deck: `/auth/verify?token={base64url-encoded-token}`.
7. Deck verifies HMAC signature and expiry.
8. Deck calls auth proxy: `GET /api/{slug}/check/{email}`.
9. If whitelisted — session created, serve `index.html`.
10. If not — redirect to `/denied`.

## Architecture Reference

```
localhost:4000 (manager)
  │
  ├─ git push ──→ GitHub (itayshmool/deck-drop)
  │                  │
  │            auto-deploy
  │                  │
  │    ┌─────────────┼─────────────┐
  │    ▼             ▼             ▼
  │  Auth Proxy    Deck A       Deck B
  │  (shared)      (stateless)  (stateless)
  │  /var/data     ─────────────────────
  │  users.json      │  OAuth + whitelist
  │    ▲             │  checks via HTTP
  │    └─────────────┘
  │
  └─ Render API ──→ create/manage services
```
