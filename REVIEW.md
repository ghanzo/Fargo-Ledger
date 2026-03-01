# Independent Technical Review — Finance Dashboard

**Date:** 2026-02-27 (updated 2026-02-28)
**Reviewer:** Claude (Opus 4.6)
**Codebase:** Fargo Ledger — Self-hosted personal finance tracker

---

## Executive Summary

This is a well-built personal finance dashboard with a FastAPI + PostgreSQL backend and a Next.js 16 + React 19 frontend. The project covers transaction management, CSV import with auto-categorization, analytics/charting, budget tracking, property/tenant management, vendor rule learning, and Excel/PDF report generation. The architecture is sound for a single-user self-hosted tool. Below is a detailed assessment.

---

## Architecture Overview

```
Browser (localhost:3000)
   │  Axios HTTP
   ▼
FastAPI  (localhost:8000, Docker: finance-app-1)
   │  SQLAlchemy ORM
   ▼
PostgreSQL 15  (localhost:5432, Docker: finance-db-1)
```

**Backend:** 7 Python files (~1,900 LOC) — api.py (1,071), models.py (116), schemas.py (204), importer.py (210), watcher.py (201), database.py (16), ingest.py (119)
**Frontend:** ~25 TSX/TS files (~7,000 LOC) — pages, components, context, hooks, types
**Infrastructure:** Docker Compose (2 services), .env config
**Total:** ~8,900 lines of code across 51 source files

---

## What Works Well

### Backend
- **Clean REST API** — FastAPI with Pydantic schemas gives automatic validation and documentation
- **Smart auto-categorization** — Vendor pattern matching with confidence scoring, sign-aware rules (income vs expense), and correction tracking that adjusts confidence over time
- **Shared import logic** — `importer.py` is reusable between API endpoint and CLI script
- **Account scoping** — All queries filter by `account_id`, supporting true multi-account isolation
- **Undo system** — Snapshot-based bulk restore via `POST /transactions/bulk-restore`

### Frontend
- **Keyboard-first UX** — j/k navigation, space to select, e to edit, Esc to close, Ctrl+A select all
- **Persistent filters** — sessionStorage keeps filter state across page navigation
- **Professional reporting** — Excel export with formulas and styled sheets, PDF with smart page breaks
- **Component architecture** — Clean separation: pages fetch data, components render it, dialogs handle mutations
- **Modern stack** — React 19, Next.js 16 with Turbopack, TanStack Table, shadcn/ui, Tailwind CSS 4

### Data Flow
- **Client-side filtering** — All transactions loaded once, filtered in `useMemo` — fast and responsive
- **Combobox pattern** — Free-form creation ("Create: new value") for vendor/category/project
- **3-state FilterPill** — Elegant null → true → false → null cycling for boolean filters

### Automation & Intelligence
- **Folder watcher** (`watcher.py`) — Monitors `/app/data/inbox/{AccountName}/` for new CSVs, waits for file stability (2s size check), imports automatically, moves to `processed/` folder. Thread-safe logging with `threading.Lock`. Lifespan-managed via FastAPI context manager.
- **Import suggestions** — Auto-categorization generates pending suggestions (pattern match + proposed vendor/category). Users review via SuggestionBanner (approve/edit/dismiss individually or batch approve-all).
- **Vendor confidence scoring** — Self-correcting: `confidence = 1.0 - (corrected_count / max(assigned_count, 1))`. Thresholds: ≥0.85 auto-assign + mark cleaned, ≥0.70 auto-assign only, <0.70 auto-disables the rule.
- **Sign-aware vendor rules** — Learns separate category/project per transaction sign (+/-), so vendor refunds get different categories than purchases.
- **Pattern extraction** — Tokenizes descriptions with 50+ noise word filter (DEBIT, PAYMENT, state abbreviations), extracts 1-2 meaningful tokens ≥3 chars. Ambiguity resolution: only the vendor with highest `assigned_count` keeps a shared pattern.
- **Correction tracking** — When user manually edits an auto-categorized transaction's vendor: old vendor's `corrected_count` increments, confidence recalculates, and auto-disable triggers if confidence drops below 0.70.

---

## Issues Found

### Critical

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| 1 | **No authentication** — All endpoints are public. Anyone on the network can read/modify all accounts | `src/api.py` (all routes) | Security |
| 2 | **N+1 query in properties** — Each property triggers a separate tenant query | `src/api.py` list_properties | Performance |
| 3 | **Race condition in ID generation** — Concurrent imports can generate duplicate transaction IDs | `src/importer.py:134-137` | Data integrity |
| 4 | **No dependency version pinning** — `requirements.txt` has no versions; a breaking update could break the app silently | `requirements.txt` | Stability |
| 5 | **Hardcoded API URL** — Frontend uses `http://localhost:8000` everywhere instead of env variable | All frontend API calls | Deployment |

### Moderate

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| 6 | **Float precision for currency** — Python float used in stats calculations instead of Decimal | `src/api.py` stats endpoints | Accuracy |
| 7 | **No ORM relationships defined** — Models use ForeignKey but no `relationship()`, preventing eager loading | `src/models.py` | Performance |
| 8 | **No error boundary** — Frontend has no React error boundary; a crash in one component takes down the page | `frontend/app/layout.tsx` | UX |
| 9 | **File upload not validated** — Only checks `.csv` extension, no file size limit or MIME type check | `src/api.py` import endpoint | Security |
| 10 | **Hard cascade deletes** — Deleting an account permanently removes all transactions, budgets, vendors, properties | `src/models.py` Account model | Data safety |
| 11 | **CSV import only supports Wells Fargo** — Hardcoded 5-column format | `src/importer.py` | Flexibility |
| 12 | **N+1 query in suggestions** — Each suggestion triggers a separate query for sample transaction descriptions in a loop | `src/api.py` `/suggestions` endpoint | Performance |
| 13 | **Stats endpoints not cached** — Every chart request triggers a full DB scan; no TTL caching | `src/api.py` `/stats/*` endpoints | Performance |
| 14 | **No audit timestamps** — Transactions have no `created_at`/`updated_at`; cannot trace when changes happened | `src/models.py` Transaction model | Auditing |
| 15 | **No concurrency control** — No optimistic locking on bulk operations; overlapping updates can conflict | `src/api.py` bulk endpoints | Data integrity |
| 16 | **No server-side pagination enforced** — `GET /transactions` has optional `limit` but no max; all rows can load into memory | `src/api.py` transactions endpoint | Scalability |

### Minor

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| 17 | Dead code: `edit-transaction-dialog.tsx` exists but is unused (replaced by TransactionPanel) | `frontend/components/` | Cleanliness |
| 18 | Vendor combobox fetches on mount; category/project fetch on popover open — inconsistent | `frontend/components/` | Consistency |
| 19 | No structured logging — debugging in production requires reading stdout | `src/api.py` | Observability |
| 20 | No mobile responsive design — tables overflow on small screens | `frontend/app/data-table.tsx` | Accessibility |
| 21 | CORS hardcoded to `localhost:3000` — needs env var for deployment | `src/api.py` | Deployment |
| 22 | `top_vendors` stat sorts in Python — should use SQL `ORDER BY` + `LIMIT` | `src/api.py` ~line 582 | Performance |
| 23 | CSV import silently skips malformed rows — counted as imported with no logging | `src/importer.py` | Observability |
| 24 | Magic numbers without constants — confidence thresholds (0.70, 0.85), pattern prefix length (30) hardcoded | `src/importer.py`, `src/api.py` | Maintainability |
| 25 | `any` type cast for TanStack Table meta — bypasses type safety | `frontend/app/data-table.tsx` | Type safety |
| 26 | No request deduplication on frontend — same facets can be fetched multiple times | Frontend comboboxes | Performance |
| 27 | Watcher account lookup by folder name is fragile — breaks if user renames account | `src/watcher.py` | Reliability |

---

## Code Quality Assessment

| Area | Rating | Notes |
|------|--------|-------|
| **API Design** | Good | RESTful, consistent patterns, proper HTTP methods |
| **Data Modeling** | Good | Proper constraints, sensible schema design |
| **Frontend Architecture** | Good | Clean component hierarchy, good state management |
| **Error Handling** | Needs Work | Backend catches some errors; frontend uses toast but no boundaries |
| **Security** | Needs Work | No auth, no rate limiting, no input sanitization on uploads |
| **Testing** | Missing | Zero test files in the entire project |
| **Documentation** | Minimal | README exists but no API docs beyond auto-generated FastAPI /docs |
| **Performance** | Adequate | Works for small datasets; N+1 queries and no pagination will hurt at scale |
| **Type Safety** | Good | Pydantic on backend, TypeScript strict mode on frontend |
| **UX Polish** | Excellent | Keyboard shortcuts, animations, toast feedback, undo support |

---

## Database Schema

```
accounts
├── transactions (FK account_id, CASCADE DELETE)
│   └── id = SHA256(date+description+amount) + occurrence suffix
│   └── tags (JSON array), raw_data (JSON)
├── budgets (FK account_id, CASCADE DELETE)
│   └── UNIQUE(account_id, category)
├── vendor_info (FK account_id, CASCADE DELETE)
│   └── UNIQUE(account_id, vendor_name)
│   └── rules (JSON: patterns, defaults, by_sign, confidence, enabled)
├── import_suggestions (FK account_id, CASCADE DELETE)
│   └── status: pending/approved/dismissed
│   └── transaction_ids (JSON array), pattern_matched
├── properties (FK account_id, CASCADE DELETE)
│   └── UNIQUE(account_id, project_name)
│   └── tenants (FK property_id, CASCADE DELETE)
```

**7 tables, all account-scoped, all with cascade deletes.**

---

## API Endpoint Inventory

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/` | Health check |
| GET | `/accounts` | List accounts |
| POST | `/accounts` | Create account |
| PUT | `/accounts/{id}` | Rename account |
| DELETE | `/accounts/{id}` | Delete account + cascade |
| GET | `/transactions` | List with filters (account_id required) |
| PUT | `/transactions/{id}` | Update single transaction |
| PATCH | `/transactions/bulk` | Bulk update transactions |
| POST | `/transactions/bulk-restore` | Undo bulk operations |
| GET | `/transactions/{id}/suggest` | Auto-suggest vendor/category |
| GET | `/facets` | Distinct categories, vendors, projects |
| POST | `/import/csv` | Import Wells Fargo CSV |
| GET | `/suggestions` | List pending auto-categorization suggestions |
| POST | `/suggestions/{id}/approve` | Apply suggestion to matched transactions |
| POST | `/suggestions/{id}/dismiss` | Dismiss suggestion |
| POST | `/suggestions/approve-all` | Batch approve all pending suggestions |
| GET | `/watcher/status` | Import watcher running state |
| GET | `/watcher/log` | Recent auto-import log entries |
| GET | `/stats/summary` | Income/expenses/net totals |
| GET | `/stats/category_breakdown` | Spending by category |
| GET | `/stats/project_breakdown` | Income/expenses by project |
| GET | `/stats/monthly` | Monthly income vs expenses |
| GET | `/stats/top_vendors` | Top 15 vendors by spend |
| GET | `/stats/subscriptions` | Recurring vendor detection |
| GET | `/stats/budget_status` | Budget vs actual for month |
| GET | `/budgets` | List budgets |
| POST | `/budgets` | Create budget |
| PUT | `/budgets/{id}` | Update budget limit |
| DELETE | `/budgets/{id}` | Delete budget |
| GET | `/vendor-info` | List vendor info records |
| POST | `/vendor-info` | Create vendor info |
| PUT | `/vendor-info/{id}` | Update vendor metadata/rules |
| DELETE | `/vendor-info/{id}` | Delete vendor info |
| POST | `/vendor-info/rebuild-rules` | Learn rules from transaction history |
| POST | `/vendor-info/import-from-transactions` | Create vendors from transaction data |
| GET | `/properties` | List properties with tenants |
| POST | `/properties` | Create property |
| PUT | `/properties/{id}` | Update property |
| DELETE | `/properties/{id}` | Delete property + tenants |
| POST | `/properties/{id}/tenants` | Create tenant |
| PUT | `/tenants/{id}` | Update tenant |
| DELETE | `/tenants/{id}` | Delete tenant |

**42 endpoints total across 9 resource groups.**

---

## Frontend Page Inventory

| Route | Page | Key Features |
|-------|------|-------------|
| `/` | Transactions | Data table with filtering, sorting, selection, bulk edit, CSV export, import dialog |
| `/analysis` | Analysis | Summary cards, monthly bar chart, category pie chart, vendor bar chart, budget tracker |
| `/report` | Report | Annual P&L by property, reconciliation, check register, Excel/PDF export |
| `/management` | Management | Vendor table with auto-assign rules, property/tenant CRUD, inline editing |

---

## Dependency Summary

### Backend (Python 3.11)
| Package | Purpose | Version Pinned? |
|---------|---------|-----------------|
| fastapi | REST API framework | No |
| sqlalchemy | ORM | No |
| psycopg2-binary | PostgreSQL driver | No |
| pandas | CSV parsing | No |
| uvicorn | ASGI server | No |
| pydantic | Validation | No |
| python-multipart | File uploads | No |

### Frontend (Node.js)
| Package | Version | Purpose |
|---------|---------|---------|
| next | 16.1.6 | Framework |
| react | 19.2.3 | UI library |
| @tanstack/react-table | ^8.21.3 | Table logic |
| axios | ^1.13.5 | HTTP client |
| recharts | ^3.7.0 | Charts |
| exceljs | ^4.4.0 | Excel export |
| jspdf | ^4.2.0 | PDF generation |
| sonner | ^2.0.7 | Toast notifications |
| shadcn/ui | latest | Component library |
| tailwindcss | ^4 | Styling |

---

## Key Algorithms Deep Dive

### Transaction Deduplication
```
base_hash = SHA256(date + description + amount)
tx_id = "{base_hash}-{occurrence_index}"
```
Occurrence index is per-file (reset on each import). Handles genuine duplicates (two identical transactions same day) and prevents re-imports of the same file.

### Vendor Auto-Assignment Flow
1. On CSV import, `importer.py` extracts description patterns
2. Matches patterns against `vendor_info.rules.patterns`
3. If confidence ≥ 0.85: auto-assign vendor + category + mark `is_cleaned=true`
4. If confidence ≥ 0.70 but < 0.85: auto-assign but leave for review
5. If confidence < 0.70: disable the rule automatically
6. Unmatched patterns with enough frequency create `import_suggestions`

### Pattern Ambiguity Resolution
When multiple vendors share a description pattern, only the vendor with the highest `assigned_count` keeps the pattern. This runs during `POST /vendor-info/rebuild-rules`.

---

## Performance Profile

| Operation | Current Behavior | Scale Concern |
|-----------|-----------------|---------------|
| Load transactions | All rows to client, filter in useMemo | Degrades at 10k+ rows |
| Stats queries | Full table scan per chart | Redundant on each page visit |
| Facets query | All distinct values, no pagination | Fine for <1000 unique values |
| Suggestions | N+1 loop for sample descriptions | Slow with many pending suggestions |
| Vendor rule rebuild | O(n²) ambiguity resolution | Fine for <1000 vendors |
| top_vendors stat | Loads all, sorts in Python | Should be SQL ORDER BY + LIMIT |

---

## Test Coverage

**Backend tests:** None
**Frontend tests:** None
**E2E tests:** None

This is the single biggest gap. Any refactoring or new feature risks breaking existing functionality with no safety net.

---

## Recommendations (Priority Order)

1. **Add tests** — At minimum: API endpoint tests (pytest + httpx), component tests (vitest + testing-library)
2. **Pin dependency versions** — Lock `requirements.txt` and verify `package-lock.json` is committed
3. **Add authentication** — Even basic API key or session auth before exposing beyond localhost
4. **Extract API base URL** — Use `NEXT_PUBLIC_API_URL` env variable
5. **Add ORM relationships** — Enable eager loading, fix N+1 queries (properties + suggestions)
6. **Add React error boundary** — Prevent full-page crashes
7. **Remove dead code** — Delete unused `edit-transaction-dialog.tsx`
8. **Add structured logging** — Python `logging` module with configurable levels
9. **Consider soft deletes** — Flag records as deleted rather than cascade removing
10. **Add file upload validation** — Size limits, MIME type checking
11. **Add audit timestamps** — `created_at`/`updated_at` on Transaction model for change tracking
12. **Cache stats endpoints** — Even 60-second TTL prevents redundant full-table scans
13. **Batch suggestion queries** — Replace N+1 loop with single batch fetch for sample descriptions
14. **Extract constants** — Move magic numbers (confidence thresholds, pattern lengths) to config
15. **Add server-side pagination** — Enforce max `limit` on `/transactions` to prevent unbounded memory usage
