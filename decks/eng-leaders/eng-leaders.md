# Building AI-Native Companies

**Engineering Leaders Forum** | Itay Shmool | 2026

*How we restructured engineering teams for the AI era — new leadership models, xEngineers, and a shared AI platform that makes lean autonomous teams possible.*

---

## Slide 1 — Building AI-Native Companies

> **Engineering Leaders Forum**
>
> Building AI-Native Companies
>
> How we restructured for the AI era

---

## Slide 2 — Why Now

**Label:** The Mandate

- The market is moving faster than traditional team structures can respond to
- AI has fundamentally changed what a **small, focused team** can ship
- The gap between AI-native teams and traditional teams is **widening every month**
- Engineering leadership must evolve — or become a bottleneck
- We either restructure to capture the opportunity, or we lose it

---

## Part 1: People & Leadership

---

## Slide 4 — New Leadership Model

**Label:** Leadership
**Subtitle:** Lead by example

| Before | After |
|--------|-------|
| Managers manage | Managers build (50%+ IC time) |
| AI is a tool we use | AI mastery is a job requirement |
| Layers of approval | Flat, autonomous decision-making |
| Separate management tracks | Every manager is hands-on |
| Middle management layers | No middle management — leads and ICs only |

> **If you can't build with AI, you can't lead here.**

---

## Slide 4b — Killing Middle Management

**Label:** Structure
**Subtitle:** From hierarchy to a flat, high-trust organization

### The Problem with Middle Management

Middle management was designed for an era of **information scarcity** — managers existed to relay context up, translate strategy down, and coordinate across silos. In an AI-native organization, this layer becomes:

- **A bottleneck** — decisions stall waiting for approval chains
- **An information distorter** — context degrades with every layer it passes through
- **A speed tax** — every additional layer adds latency to every decision
- **An accountability gap** — when everyone manages, nobody builds

### The Old Structure

```
VP
 └── Director
      └── Senior Manager
           └── Team Lead
                └── Engineers (3-5)
```

4 layers between strategy and execution. Each layer filters, delays, and dilutes.

### The New Flat Structure

```
Head of Company
 ├── Team Lead A  ──→  7-10 xEngineers + AI agents
 ├── Team Lead B  ──→  7-10 xEngineers + AI agents
 ├── Team Lead C  ──→  7-10 xEngineers + AI agents
 ├── Guild Master (UX)
 ├── Guild Master (Data)
 └── Guild Master (QA)
```

**1 layer** between strategy and execution. TLs are hands-on builders, not coordinators.

### What Replaces Middle Management

| Middle Manager Function | What Replaces It |
|------------------------|------------------|
| Status reporting | AI agents — automated dashboards, anomaly detection |
| Cross-team coordination | Contribution model — teams contribute directly to each other's code |
| People management | TLs with larger teams — direct, unfiltered relationship with each engineer |
| Context translation | Transparent strategy docs + AI-summarized context — no telephone game |
| Prioritization decisions | Head of Company + TLs decide directly — no intermediary filters |
| Process enforcement | Automated via PR Reviewer, The Shield, CI/CD pipelines |

### Key Principles

- **Every leader builds.** If your calendar is 100% meetings, your role doesn't exist here.
- **Span of control increases.** TLs manage 7-10+ people (not 3-5). AI handles the coordination overhead that used to justify smaller teams.
- **Guild Masters replace functional managers.** Expert roles set standards across teams without owning headcount or creating reporting lines.
- **Information flows directly.** Engineers hear strategy from the source. No layers of reinterpretation.
- **Trust over control.** Hire senior people, give them autonomy, measure outcomes — not activity.

### The Math

| Metric | Before (4 layers) | After (1 layer) |
|--------|-------------------|-----------------|
| Decision latency | Days to weeks | Hours |
| Information fidelity | ~60% (degrades per layer) | ~95% (direct) |
| Builder-to-manager ratio | 3:1 | 8:1+ |
| Meeting overhead per engineer | ~30% of week | ~10% of week |
| Time from strategy to execution | Weeks | Days |

> **The best organizational structure is the one with the fewest layers between the people making decisions and the people building the product.**

---

## Slide 5 — The xEngineer

**Label:** The New Developer

- **xEngineer:** Capable of developing full features end-to-end, not just components
- **From dev to TL:** Each developer holds an agentic team 24/7 — AI agents extend their capacity
- **Buddy Teams:** Developer + UX designer pair up dynamically to own a feature E2E
- **Bigger teams, fewer teams:** TLs manage 7+ xEngineers — the opposite of Amazon's pizza box

> One xEngineer + agents can do what required a full squad before.

---

## Slide 6 — Everyone is a Creator

**Label:** Culture
**Subtitle:** On top of your core profession ("black belt"), every person adopts a creator mindset.

| Role | Old Mindset | Creator Mindset |
|------|-------------|-----------------|
| Data | Not just dashboards | Creates insights, growth experiments & tools |
| QA | Not just test cases | Creates quality systems |
| Ops | Not just runbooks | Creates automated workflows → Agentic management |

**Creators (expanded):**

| Role | Old Mindset | Creator Mindset |
|------|-------------|-----------------|
| UX | Not just mockups | Creates full experiences |
| Product | Not just specs | Creates solutions |
| Writers | Not just copy | Creates content strategies |

---

## Slide 7 — The Contribution Model

**Label:** Dependencies

**Before:**
Team A needs feature → Files request to Team B → Waits in backlog → Months pass

**AI-Native Model:**
Team A needs feature → **Team A contributes it directly** → **Done**

- AI tools like [Octocode](https://octocode.ai/) make understanding another team's codebase fast
- xEngineers are capable of working across boundaries
- Contribution is a **first-class workflow**, not an exception

---

## Part 2: AI-Native Infrastructure

---

## Slide 9 — Built on AI, not just using AI

**Label:** Foundation

A shared AI platform powers all teams equally. This is what makes lean, autonomous teams possible.

```
┌──────────┐  ┌──────────┐  ┌──────────┐
│  Team A  │  │  Team B  │  │  Team C  │
└────┬─────┘  └────┬─────┘  └────┬─────┘
     │             │             │
     └─────────────┼─────────────┘
                   │
  ╔════════════════════════════════════╗
  ║    Shared AI Infrastructure        ║
  ║    The foundation that makes       ║
  ║    the entire model work           ║
  ╚════════════════════════════════════╝
```

---

## Slide 10 — The 5 Pillars

**Label:** AI Platform Stack

| # | Pillar | Description |
|---|--------|-------------|
| 01 | **The Shield** | Self-healing platform. Detects and resolves bugs automatically. Quality at scale. |
| 02 | **LaunchPad** | AI-driven ideation and feature optimization. From idea to production, fast. |
| 03 | **AB Tester** | Unified experimentation. Single source of truth. Closed feedback loop with LaunchPad. |
| 04 | **PR Reviewer** | Automated code review at scale. Consistent quality bar. Every PR, every time. |
| 05 | **AI Agents** | Day-to-day management by agents. Status, monitoring, reporting — handled automatically. |

**Feedback Loop:**
LaunchPad → Ideas → AB Tester → Results → LaunchPad

---

## Slide 11 — Guild Masters — Professional Standards

**Label:** Quality
**Subtitle:** Cross-team expert roles maintain excellence — without traditional hierarchy.

| Discipline | Role | Scope |
|-----------|------|-------|
| UX Design | Guild Master | Standards, research, design principles across all teams |
| Product | Guild Master | Strategic alignment, prioritization frameworks |
| QA | Guild Master | Shared test suite, quality bar enforcement |
| Data | Guild Master | Experimentation loop, anomaly tracking |

> **Key principle:** Expert positions, not managerial ones. Each expert also holds a role within a team — it's not a standalone job.

---

## Slide 12 — Closing

> The AI era demands a new **leadership model**, new **team structures**, and new **ways of building**.
>
> The question isn't whether to change — it's how fast you can.
