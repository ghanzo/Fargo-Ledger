# Roadmap — Fargo Ledger

**Last Updated:** 2026-03-03

This roadmap is organized into three temporal layers. When an LLM agent begins a session, check **Immediate** first — that's the current work. **Mid-term** is what's coming next. **Long-term** is the horizon that shapes decisions but doesn't drive daily work.

---

## Immediate — Current Focus

These are the tasks to pick up right now. They are specific, scoped, and ready to implement.

### Phase 1: Testing (next priority)

| Task | Description | Files |
|------|-------------|-------|
| 1.1 Backend API tests | Set up pytest with test DB. Cover: account CRUD, transaction CRUD + bulk + restore, budget CRUD + status, vendor info + rule rebuild, property/tenant CRUD, CSV import, stats endpoints | New `tests/` directory |
| 1.2 Frontend component tests | Set up Vitest + React Testing Library. Cover: DataTable rendering/filtering/sorting/selection/keyboard, TransactionPanel edit flow, BulkEditDialog undo capture, ImportDialog upload, AccountContext switching | New test files alongside components |
| 1.3 Pre-commit linting | Add pre-commit hook running `ruff check` (Python) and `eslint` (frontend) | Root config files |

### Phase 1.5: Performance Quick Wins

| Task | Description | Files |
|------|-------------|-------|
| 1.5.1 Fix N+1 in suggestions | Batch-fetch sample descriptions in one query instead of per-suggestion loop | `src/api.py` GET `/suggestions` |
| 1.5.2 Fix top_vendors SQL sort | Push sorting to DB with `ORDER BY abs(total) DESC LIMIT :n` | `src/api.py` GET `/stats/top_vendors` |
| 1.5.3 Stats endpoint caching | 60-second TTL cache keyed by account_id + endpoint + params | `src/api.py` all `/stats/*` |
| 1.5.4 Log malformed CSV rows | Structured logging of parse errors (row number + error type, no content). Return `warnings` array | `src/importer.py` |
| 1.5.5 Pagination guard | `MAX_LIMIT = 5000`, default applied when no limit given. `X-Total-Count` header | `src/api.py` GET `/transactions` |

---

## Mid-term — Next 2-3 Phases

These are well-understood but not yet started. They become Immediate once the current phase completes.

### Phase 2: Data Integrity & Security

| Task | Description |
|------|-------------|
| 2.1 Basic authentication | API key auth via `Authorization: Bearer <key>`. Stored in `.env`. Sufficient for single-user self-hosted. |
| 2.2 Fix transaction ID race condition | Query existing hashes before generating new IDs to prevent duplicates on concurrent import |
| 2.3 File upload validation | Max 10MB, MIME type check, column count validation before processing |
| 2.4 Decimal currency math | Replace `float()` with `Decimal` in stats calculations. Pydantic outputs float, internal math uses Decimal |
| 2.5 Soft delete for accounts | `is_deleted` flag instead of hard cascade. Restore endpoint. Hard delete as `?permanent=true` |

### Phase 3: Multi-Bank CSV Support

| Task | Description |
|------|-------------|
| 3.1 Pluggable parser architecture | Abstract `BankParser` class, parser registry, auto-detection from CSV headers |
| 3.2 Chase CSV parser | Implement Chase format (Date, Post Date, Description, Category, Type, Amount) |
| 3.3 Generic CSV parser | User-defined column mapping via frontend dialog. Save mappings per account for reuse |

---

## Long-term — Horizon Direction

These shape architectural decisions but aren't planned in detail yet. They move to Mid-term when we're ready to scope them.

### Enhanced Analytics (Phase 4)
- Year-over-year spending comparison charts
- Spending trend detection and anomaly alerts (category spend increasing 3+ months, unusual amounts)
- Cash flow forecasting from historical averages + known rent obligations
- Tax summary report section (all deductible transactions grouped by category)

### UX Improvements (Phase 5)
- Virtual scrolling for 50k+ row tables (`@tanstack/react-virtual`)
- Mobile responsive layout (card view on small screens, condensed table on tablet)
- Optimistic UI updates (instant local state, async API, revert on failure)
- Batch import progress feedback (Server-Sent Events or streaming counts)

### Property Management Expansion (Phase 6)
- Rent payment matching (amount + timing → expected vs received dashboard)
- Lease expiry alerts (30/60/90 day warnings)
- Per-property maintenance expense tracking and reporting

### Automation & Intelligence (Phase 7)
- Improved auto-categorization (TF-IDF or simple ML on descriptions)
- Receipt/document attachment (local or S3-compatible storage)

### Deployment & Operations (Phase 8)
- Production Docker config (standalone Next.js, multi-worker uvicorn, nginx proxy, health checks)
- Alembic database migrations (replace manual `ALTER TABLE`)
- Automated backup/restore (pg_dump + optional cloud upload)
- Structured JSON logging with configurable levels

---

## Completed

| Phase/Task | What was done | Date |
|------------|---------------|------|
| Phase 0: Foundation | Pinned deps, centralized API client, ORM relationships + N+1 fix, removed dead code, error boundary, CORS env var, audit timestamps, extracted magic numbers | 2026-03-03 |
| Folder watcher | `src/watcher.py` — auto-imports CSVs from inbox, moves to processed, NavBar status indicator | 2026-02-27 |
| Suggestion queue | Import suggestions with approve/edit/dismiss UI in SuggestionBanner | 2026-02-28 |
| Dark mode | `next-themes` toggle in NavBar, OKLCH color variables | 2026-02-27 |
| Vendor management | Card grid UI with pattern editing, confidence badges, rebuild-rules | 2026-02-28 |
| Property/tenant CRUD | Full CRUD with cascade, lease tracking, monthly rent | 2026-02-28 |

---

## Dependency Graph

```
Phase 0 (Foundation) ........... DONE
  |
  +-- Phase 1 (Testing) ......... IMMEDIATE
  |     |
  +-- Phase 1.5 (Performance) ... IMMEDIATE (parallel with Phase 1)
  |
  +-- Phase 2 (Security) ........ MID-TERM (after Phase 1)
  |     |
  |     +-- Phase 3 (Multi-bank) . MID-TERM (after 2 + 1.1)
  |
  +-- Phase 4-7 (Features) ...... LONG-TERM (after Phase 2)
  |
  +-- Phase 8 (Deployment) ...... LONG-TERM (after Phase 2)
```

---

## Notes for LLM Agents

- **Privacy Rule:** Never print real financial data in terminal output. Only check HTTP status codes or record counts.
- **DB Column Changes:** Use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` via docker exec until Alembic is set up (Phase 8.2).
- **Account Scoping:** Every query must filter by `account_id`. Never return cross-account data.
- **Frontend State:** Filters persist in sessionStorage. Account selection in localStorage. Don't break these patterns.
- **TanStack Table Meta:** Callbacks passed via `meta` option in `useReactTable`.
- **Undo Pattern:** Capture snapshots before mutations, POST to `/transactions/bulk-restore` in toast action.
- **API Client:** All frontend HTTP calls go through `@/lib/api` (centralized axios instance with env-based baseURL).
