# Project Documentation — Fargo Ledger

This directory contains the living documentation for the Finance Dashboard project. It is structured as three pillars, each serving a distinct purpose for both the human developer and the LLM coding agents working on this codebase.

---

## The Three Pillars

### 1. [R&D](./rnd/) — Where are we going?

Future-facing. This is the planning and exploration arm of the project.

| Document | Purpose |
|----------|---------|
| [VISION.md](./rnd/VISION.md) | The north star — what this project is, what it's trying to become, the principles that guide decisions |
| [RESEARCH.md](./rnd/RESEARCH.md) | Findings from exploring other tools, libraries, approaches. What's out there, what we can learn from it |
| [ROADMAP.md](./rnd/ROADMAP.md) | Development plan in three temporal layers: **long-term** direction, **mid-term** milestones, **immediate** next actions |
| [archive/](./rnd/archive/) | Completed research notes and resolved planning items |

### 2. [Testing & Debugging](./testing/) — What's working? What's broken?

Present-facing. This is the diagnostic and quality assurance arm.

| Document | Purpose |
|----------|---------|
| [STRATEGY.md](./testing/STRATEGY.md) | What we test, why we test it, how tests are structured, what coverage looks like |
| [DEBUG-LOG.md](./testing/DEBUG-LOG.md) | Running journal of issues found, how they were diagnosed, what we learned |

### 3. [Architecture](./architecture/) — How does it work?

Structural. This is the map of the system as it exists today.

| Document | Purpose |
|----------|---------|
| [SYSTEM.md](./architecture/SYSTEM.md) | Module breakdown, data flow, API surface, database schema, key algorithms — a living blueprint |

---

## How These Documents Interact

```
        VISION (why)
           |
     RESEARCH (what's possible)
           |
       ROADMAP (what's next)
      /        \
ARCHITECTURE    TESTING
(how it works)  (is it working?)
      \        /
     THE CODE
```

- **Vision** informs the **Roadmap** — we only plan features that serve the project's purpose
- **Research** feeds the **Roadmap** — we learn what's possible before committing to build it
- **Roadmap** drives work on the **Code** — immediate tasks become implementation sessions
- **Architecture** documents the **Code** — after changes land, the map updates
- **Testing** validates the **Code** — confirms what works, surfaces what doesn't
- **Debug Log** feeds back into the **Roadmap** — bugs become tasks

---

## For LLM Agents

When starting a coding session on this project:

1. **Read [VISION.md](./rnd/VISION.md)** first — understand *what* this project is
2. **Read [SYSTEM.md](./architecture/SYSTEM.md)** — understand *how* it works
3. **Check the Immediate section of [ROADMAP.md](./rnd/ROADMAP.md)** — understand *what to do next*
4. **Check [DEBUG-LOG.md](./testing/DEBUG-LOG.md)** — know what's currently broken or fragile
5. **After making changes** — update the relevant docs to keep them current
