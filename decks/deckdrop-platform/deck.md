# DeckDrop Platform Overview

---

## Slide 1 — Title

**DeckDrop**
*Protected presentations, delivered instantly.*

Share confidential decks with the right people — no downloads, no forwarding, no access leaks.

---

## Slide 2 — Why HTML Slides?

**PowerPoint and Google Slides are great tools. But they're the wrong output format.**

- Tied to an app — requires download, upload, or a specific viewer
- No access control — "anyone with the link" or "download and forward"
- Static files — can't embed live code, interactions, or custom behavior
- Manual design — every slide hand-crafted, pixel by pixel

**HTML slides are code.** And code can be:
- **Generated** — Claude Code builds an entire deck from a prompt
- **Version controlled** — every change tracked in git
- **Deployed** — served as a web app with auth, not emailed as a file
- **Interactive** — animations, live demos, embedded components
- **Pixel-perfect** — full CSS control, no template constraints

The slide tool doesn't matter when AI writes the slides and infrastructure protects them.

---

## Slide 3 — The Problem

**Sharing decks today is broken.**

- Email a PDF → it gets forwarded to everyone
- Google Slides link → "anyone with the link" means anyone
- Internal tools → require VPN, IT setup, corporate accounts
- No visibility into who actually accessed it

You lose control the moment you hit send.

---

## Slide 4 — The Solution

**DeckDrop gives you a URL with a gatekeeper.**

Each deck gets its own URL. Only whitelisted users can view it — verified via Google sign-in.

- `online-decks-p30.onrender.com` → P3.0 leadership deck
- `online-decks-eng-leaders.onrender.com` → Engineering leaders deck
- `online-decks-wolf.onrender.com` → Project Wolf deck

No downloads. No forwarding risk. Full control.

---

## Slide 5 — How It Works (User Flow)

```
1. User visits deck URL
2. Redirected to Google sign-in
3. Email checked against whitelist
4. ✓ Allowed → sees the presentation
   ✗ Denied  → "You don't have access"
```

One click. No passwords. No accounts to create.

---

## Slide 6 — Admin Dashboard

**Manage all decks from one place.**

`online-decks-auth.onrender.com/admin`

- See all decks at a glance with user counts
- Add users one-by-one or bulk (paste a list)
- Remove users instantly
- View any deck with one click

Admins sign in with Google — only approved emails get access.

---

## Slide 7 — Deploy a New Deck

**From slides to live URL in one command.**

```bash
node manage.js deploy my-deck
```

That's it. The system:
1. Creates a Render web service
2. Sets up Google OAuth
3. Seeds the user whitelist
4. Deploys the deck

No manual infrastructure. No config files. No dashboards to click through.

---

## Slide 8 — Architecture Overview

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────┐
│  Deck        │────→│  Auth Proxy       │────→│  Google      │
│  Services    │     │  (centralized)    │     │  OAuth 2.0   │
│              │←────│                   │←────│              │
│  wolf        │     │  • OAuth flow     │     └─────────────┘
│  p30         │     │  • User storage   │
│  eng-leaders │     │  • Admin dashboard│
│  ...         │     │  • API            │
└─────────────┘     └──────────────────┘
   Stateless             1 GB disk
   No disk needed        All user data
```

---

## Slide 9 — Technical: Shared Auth Proxy

**One service handles auth for all decks.**

- Single Google OAuth callback URL — no per-deck redirect URIs
- HMAC-signed tokens passed between services
- User whitelists stored centrally on persistent disk
- Bearer token API for service-to-service calls
- Session-based auth for the admin dashboard

Adding a new deck requires zero Google Console changes.

---

## Slide 10 — Technical: Stateless Deck Services

**Deck services are fully stateless.**

Each deck service:
- Serves the HTML/CSS/JS presentation
- Delegates auth checks to the auth proxy via HTTP
- Has no disk, no database, no local state
- Can be destroyed and recreated without data loss

All user data lives on the auth proxy's single disk.

---

## Slide 11 — Technical: Security Model

| Layer | Mechanism |
|-------|-----------|
| User identity | Google OAuth 2.0 |
| Access control | Per-deck email whitelist |
| Token integrity | HMAC-SHA256 signed tokens |
| Token expiry | 5-minute TTL |
| Service-to-service | Shared secret (AUTH_SECRET) |
| Admin access | ADMIN_EMAILS env var |
| Redirect safety | Origin URL validation (.onrender.com only) |

No passwords stored. No session tokens in URLs. No public APIs.

---

## Slide 12 — Cost & Infrastructure

**Runs on Render. Minimal cost.**

| Component | Plan | Cost |
|-----------|------|------|
| Auth proxy | Starter + 1GB disk | ~$7/mo |
| Each deck service | Starter | ~$7/mo |
| Google OAuth | Free tier | $0 |
| Admin dashboard | Included in auth proxy | $0 |

5 decks + auth proxy = ~$42/mo total.
No database. No Redis. No CDN. No external services.

---

## Slide 13 — What's Next

- **Custom domains** — `decks.yourcompany.com/p30` instead of `.onrender.com`
- **Access analytics** — who viewed what, when
- **Deck versioning** — update slides without changing the URL
- **Expiring access** — auto-revoke after a date
- **Slack integration** — notify users when they get access

---

## Slide 14 — Summary

**DeckDrop in three lines:**

1. Upload a deck → get a protected URL
2. Whitelist users → they sign in with Google
3. Manage everything → from one admin dashboard

Simple. Secure. Zero overhead.
