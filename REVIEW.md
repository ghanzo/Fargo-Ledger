# Independent Technical Review — Finance Dashboard

**Date:** 2026-02-27
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

**Backend:** 5 Python files (~1,500 LOC) — api.py, models.py, schemas.py, database.py, importer.py
**Frontend:** ~25 TSX/TS files — pages, components, context, hooks, types
**Infrastructure:** Docker Compose (2 services), .env config

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

### Minor

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| 12 | Dead code: `edit-transaction-dialog.tsx` exists but is unused (replaced by TransactionPanel) | `frontend/components/` | Cleanliness |
| 13 | Vendor combobox fetches on mount; category/project fetch on popover open — inconsistent | `frontend/components/` | Consistency |
| 14 | No structured logging — debugging in production requires reading stdout | `src/api.py` | Observability |
| 15 | No mobile responsive design — tables overflow on small screens | `frontend/app/data-table.tsx` | Accessibility |
| 16 | CORS hardcoded to `localhost:3000` — needs env var for deployment | `src/api.py` | Deployment |

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
├── budgets (FK account_id, CASCADE DELETE)
│   └── UNIQUE(account_id, category)
├── vendor_info (FK account_id, CASCADE DELETE)
│   └── UNIQUE(account_id, vendor_name)
│   └── rules (JSON: patterns, defaults, by_sign, confidence)
└── properties (FK account_id, CASCADE DELETE)
    └── UNIQUE(account_id, project_name)
    └── tenants (FK property_id, CASCADE DELETE)
```

**6 tables, all account-scoped, all with cascade deletes.**

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

**35 endpoints total across 6 resource groups.**

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
5. **Add ORM relationships** — Enable eager loading, fix N+1 queries
6. **Add React error boundary** — Prevent full-page crashes
7. **Remove dead code** — Delete unused `edit-transaction-dialog.tsx`
8. **Add structured logging** — Python `logging` module with configurable levels
9. **Consider soft deletes** — Flag records as deleted rather than cascade removing
10. **Add file upload validation** — Size limits, MIME type checking
