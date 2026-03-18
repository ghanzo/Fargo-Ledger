# Research — Fargo Ledger

**Last Updated:** 2026-03-03

This document tracks explorations into tools, techniques, and approaches that could improve the project. Each entry records what was looked at, what was learned, and whether it's actionable.

---

## Areas of Interest

### Multi-bank CSV Parsing
**Status:** Not yet researched
**Question:** What formats do major banks use? Is there a standard, or does every bank do its own thing?
**Why it matters:** Currently locked to Wells Fargo's 5-column format. Supporting Chase, Bank of America, and a generic mapper would make the tool useful beyond one bank.
**Next step:** Collect sample CSV exports from 3-4 banks, document column layouts, identify common patterns.

### Auto-categorization Approaches
**Status:** Active — constrained-choice LLM research implemented (2026-03-17)
**What we have:**
- **Pattern matching:** Token extraction from descriptions, substring matching against vendor rules, confidence decay on corrections. Works well for repeat merchants.
- **LLM research (Grok):** Constrained-choice batch classification. Sends existing vendors, categories, projects, and a correspondence history of verified past mappings. LLM must use existing categories, prefer existing vendors. New vendors created as unconfirmed until user approves.
- **Correspondence history:** Three tiers of training signal ranked by quality: (1) approved suggestions, (2) user-edited transactions, (3) rule-matched auto-categorized. Up to 40 examples sent per research run. This gives Grok real context about how the user classifies their transactions.
- **Vendor confirmation flow:** LLM-created vendor cards start as `confirmed=false`. Only confirmed vendors appear in future LLM context, preventing bad guesses from snowballing.

**What's out there (not yet explored):**
- TF-IDF on transaction descriptions (lightweight, no external deps)
- Simple Naive Bayes classifier trained on user's own labeled data
- Plaid's category taxonomy as a starting vocabulary

**Open questions:**
- Cold-start: first research run on a new account has no vendors/categories/history — LLM is basically unconstrained. Consider seeding with common categories.
- Scale: correspondence history capped at 40 examples. May need smarter selection (e.g. diversity sampling) for accounts with hundreds of vendors.

### Receipt/Document Attachment
**Status:** Not yet researched
**Question:** What's the simplest way to attach images/PDFs to transactions?
**Options to explore:**
- Local filesystem storage with UUID filenames
- S3-compatible object storage (MinIO for self-hosted)
- Embedded thumbnails vs. full-resolution storage
**Why it matters:** Tax documentation requires receipts paired with deductions.

### Database Migration Tools
**Status:** Identified (Alembic), not yet implemented
**What we know:** SQLAlchemy's `create_all()` only creates new tables, doesn't modify existing ones. Currently doing manual `ALTER TABLE` commands. Alembic would automate this.
**Decision:** Deferred to Phase 8.2. Low urgency while the schema is still evolving.

### Performance Optimization
**Status:** Partially explored
**Findings from REVIEW.md analysis:**
- N+1 queries identified in properties (fixed) and suggestions (pending)
- Stats endpoints do full table scans every request — caching would help
- Client-side filtering works up to ~10k rows; virtual scrolling needed beyond that
- `top_vendors` sorts in Python when SQL could do it
**Next step:** Profile actual query times with real data volumes before optimizing further.

---

## Completed Research

_Move entries here when they've been fully explored and either adopted or rejected._

| Topic | Outcome | Date |
|-------|---------|------|
| Folder watcher for auto-import | Adopted. Implemented via `watchdog` library in `src/watcher.py`. Thread-safe, lifespan-managed. | 2026-02-27 |
| Suggestion review queue | Adopted. Import creates pending suggestions; user approves/edits/dismisses via banner UI. | 2026-02-28 |
| Dark mode | Adopted. `next-themes` + OKLCH color variables. Toggle in NavBar. | 2026-02-27 |
| Vendor confidence scoring | Adopted. Self-correcting: `1.0 - (corrected / assigned)`. Thresholds at 0.85/0.70. Sign-aware rules. | 2026-02-28 |
| LLM vendor research | Adopted. Grok-only (removed Ollama/Claude). Constrained-choice batch prompts with correspondence history. Vendor confirmation flow for new vendors. | 2026-03-17 |
