# System Architecture — Fargo Ledger

**Last Updated:** 2026-03-03

This document describes how the system works today. It is the map of the codebase — modules, data flow, APIs, schema, and key algorithms.

---

## System Diagram

```
Browser (localhost:3000)
   |  Next.js 16 + React 19
   |  Centralized API client (@/lib/api.ts)
   |  Axios HTTP
   v
FastAPI  (localhost:8001 -> container:8000)
   |  Docker: finance-app-1
   |  SQLAlchemy ORM
   v
PostgreSQL 15  (localhost:5432)
   |  Docker: finance-db-1
   |  Database: finance_db, User: user
```

---

## Backend — Python / FastAPI

### File Map

| File | LOC (approx) | Purpose |
|------|-------------|---------|
| `src/api.py` | ~1,080 | All REST endpoints (42 routes across 9 resource groups) |
| `src/models.py` | ~120 | SQLAlchemy ORM models (7 tables) with relationships |
| `src/schemas.py` | ~200 | Pydantic request/response schemas |
| `src/importer.py` | ~210 | CSV parsing, pattern extraction, vendor matching, deduplication |
| `src/watcher.py` | ~200 | Folder watcher for auto-importing CSVs from inbox |
| `src/database.py` | ~16 | SQLAlchemy engine and session setup |
| `src/ingest.py` | ~120 | CLI script for manual CSV import |

### Key Patterns

**Account Scoping:** Every database query filters by `account_id`. API endpoints require it as a query parameter. There is no cross-account data access.

**CORS:** Configured from `CORS_ORIGINS` environment variable (comma-separated). Defaults to `http://localhost:3000`.

**Confidence System:** Vendor auto-assignment uses a self-correcting confidence score:
- Formula: `confidence = 1.0 - (corrected_count / max(assigned_count, 1))`
- `>= 0.85`: auto-assign + mark `is_cleaned=true`
- `>= 0.70`: auto-assign only (user reviews)
- `< 0.70`: rule auto-disables
- Corrections tracked when user manually changes an auto-categorized vendor

**Sign-aware Rules:** Vendor rules can store separate category/project for income (+) vs expense (-) transactions.

**Import Pipeline:**
```
CSV file
  -> importer.py:import_csv_content()
  -> Parse rows (Wells Fargo 5-column format)
  -> Generate hash ID: SHA256(date+description+amount) + occurrence suffix
  -> Deduplicate against existing transactions
  -> Match against vendor rules (pattern matching)
  -> High confidence: auto-assign fields
  -> Unmatched patterns: create import_suggestions (pending)
  -> Return {imported, skipped, suggestions_created}
```

**Watcher Pipeline:**
```
watcher.py starts on app lifespan
  -> Monitors /app/data/inbox/{AccountName}/ for new .csv files
  -> Waits for file stability (2s size check)
  -> Looks up account by folder name
  -> Calls import_csv_content()
  -> Moves file to processed/{TIMESTAMP}_{filename}
  -> Logs result (thread-safe)
  -> NavBar polls /watcher/status every 30s
```

---

## Frontend — Next.js / React

### File Map

| File | Purpose |
|------|---------|
| **Pages** | |
| `app/page.tsx` | Main transactions page — fetches all, renders DataTable |
| `app/analysis/page.tsx` | Charts, budget tracker, category/vendor/project breakdowns |
| `app/report/page.tsx` | Annual P&L by property, reconciliation, Excel/PDF export |
| `app/management/page.tsx` | Vendor card grid with rules, property/tenant CRUD |
| `app/error.tsx` | Error boundary — catches rendering errors, shows retry UI |
| `app/layout.tsx` | Root layout with ThemeProvider + AccountProvider |
| `app/nav.tsx` | NavBar with active-link underline, account selector, watcher indicator, theme toggle |
| **Components** | |
| `components/transaction-panel.tsx` | Slide-in detail/edit panel with auto-suggest |
| `components/bulk-edit-dialog.tsx` | Bulk edit modal with undo (sonner toast action) |
| `components/import-dialog.tsx` | Drag-and-drop CSV import |
| `components/budget-dialog.tsx` | Budget CRUD manager |
| `components/suggestion-banner.tsx` | Import suggestion review (approve/edit/dismiss/approve-all) |
| `components/account-manager-dialog.tsx` | Create/rename/delete accounts |
| `components/vendor-combobox.tsx` | Free-form vendor selection/creation |
| `components/category-combobox.tsx` | Free-form category selection/creation |
| `components/project-combobox.tsx` | Free-form project selection/creation |
| `components/tag-input.tsx` | Chip badge input for tags |
| **Infrastructure** | |
| `lib/api.ts` | Centralized axios instance (baseURL from `NEXT_PUBLIC_API_URL`) + `withAccount()` helper |
| `lib/utils.ts` | Tailwind `cn()` utility |
| `context/account-context.tsx` | AccountProvider + `useAccount()` hook |
| `hooks/use-persistent-state.ts` | sessionStorage-backed useState |
| `types/transaction.ts` | Transaction TypeScript interface |
| `app/columns.tsx` | TanStack Table column definitions |
| `app/data-table.tsx` | Table with filters, shift-click, keyboard shortcuts, CSV export |

### Key Patterns

**Component Tree:**
```
layout.tsx
  -> ThemeProvider (next-themes)
  -> AccountProvider (context)
    -> NavBar
    -> Page routes
      -> Transactions: SuggestionBanner + DataTable
         -> BulkEditDialog
         -> TransactionPanel (with comboboxes)
      -> Analysis: Recharts charts + BudgetDialog
      -> Report: Aggregations + PDF/Excel export
      -> Management: Vendor cards + Property/tenant CRUD
```

**State Management:** React Context for accounts only. Props for everything else. No Redux/Zustand — intentionally simple.

**Persistence:**
- `sessionStorage` via `usePersistentState()` — filters, expanded sections (survives page navigation, clears on tab close)
- `localStorage` — active account ID (survives sessions)

**TanStack Table:** Callbacks (`onRefresh`, `openPanel`) passed via `meta` option in `useReactTable`. Column components access them via `table.options.meta`.

**Undo Pattern:** Before a bulk edit, snapshots of all affected transactions are captured. On success, a sonner toast with an "Undo" action calls `POST /transactions/bulk-restore` with the snapshots.

**FilterPill:** Three-state cycle: `null` -> `true` -> `false` -> `null`. Used for boolean filters (has vendor, has category, etc).

**Keyboard Shortcuts (DataTable):**
- `j`/`k` — move cursor up/down
- `Space` — toggle selection on focused row
- `e` — open edit panel for focused row
- `Esc` — close panel / deselect
- `Ctrl+A` — select all visible rows

---

## Database Schema

```
accounts
  |-- id (PK, auto)
  |-- name (unique)
  |
  +-- transactions (FK account_id, CASCADE)
  |     |-- id (PK, SHA256 hash + occurrence suffix)
  |     |-- transaction_date, description, amount
  |     |-- category, vendor, project, notes, tags (JSON)
  |     |-- tax_deductible, is_transfer, is_cleaned, auto_categorized
  |     |-- created_at, updated_at (audit timestamps)
  |     |-- source_file, raw_data (JSON)
  |
  +-- budgets (FK account_id, CASCADE)
  |     |-- id (PK, auto)
  |     |-- category, monthly_limit
  |     |-- UNIQUE(account_id, category)
  |
  +-- vendor_info (FK account_id, CASCADE)
  |     |-- id (PK, auto)
  |     |-- vendor_name (UNIQUE per account)
  |     |-- business_name, trade_category, phone, email, rating, notes
  |     |-- rules (JSON: patterns, defaults, by_sign, confidence, enabled)
  |     |
  |     +-- import_suggestions (FK vendor_info_id, CASCADE)
  |           |-- id (PK, auto)
  |           |-- suggested_vendor, suggested_category, suggested_project
  |           |-- pattern_matched, transaction_ids (JSON)
  |           |-- status (pending/approved/dismissed)
  |           |-- created_at
  |
  +-- properties (FK account_id, CASCADE)
        |-- id (PK, auto)
        |-- project_name (UNIQUE per account), address, notes
        |
        +-- tenants (FK property_id, CASCADE)
              |-- id (PK, auto)
              |-- name, phone, email
              |-- lease_start, lease_end, monthly_rent, notes
```

**7 tables, all account-scoped, all with cascade deletes.**

---

## API Endpoint Inventory

### Accounts (4 endpoints)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/accounts` | List all accounts |
| POST | `/accounts` | Create account |
| PUT | `/accounts/{id}` | Rename account |
| DELETE | `/accounts/{id}` | Delete account + cascade |

### Transactions (5 endpoints)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/transactions?account_id=X` | List with filters |
| PUT | `/transactions/{id}` | Update single transaction |
| PATCH | `/transactions/bulk?account_id=X` | Bulk update |
| POST | `/transactions/bulk-restore` | Undo bulk operations |
| GET | `/transactions/{id}/suggest` | Auto-suggest vendor/category |

### Facets & Import (3 endpoints)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/facets?account_id=X` | Distinct categories, vendors, projects |
| POST | `/import/csv` | Import Wells Fargo CSV |
| GET | `/watcher/status` | Import watcher running state |

### Suggestions (4 endpoints)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/suggestions?account_id=X` | List pending suggestions |
| POST | `/suggestions/{id}/approve` | Apply suggestion |
| POST | `/suggestions/{id}/dismiss` | Dismiss suggestion |
| POST | `/suggestions/approve-all?account_id=X` | Batch approve all |

### Stats (7 endpoints)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/stats/summary` | Income/expenses/net totals |
| GET | `/stats/category_breakdown` | Spending by category |
| GET | `/stats/project_breakdown` | Income/expenses by project |
| GET | `/stats/monthly` | Monthly income vs expenses |
| GET | `/stats/top_vendors` | Top vendors by spend |
| GET | `/stats/subscriptions` | Recurring vendor detection |
| GET | `/stats/budget_status` | Budget vs actual for month |

### Budgets (4 endpoints)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/budgets?account_id=X` | List budgets |
| POST | `/budgets?account_id=X` | Create budget |
| PUT | `/budgets/{id}` | Update budget limit |
| DELETE | `/budgets/{id}` | Delete budget |

### Vendor Info (6 endpoints)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/vendor-info?account_id=X` | List vendor records |
| POST | `/vendor-info?account_id=X` | Create vendor |
| PUT | `/vendor-info/{id}` | Update vendor metadata/rules |
| DELETE | `/vendor-info/{id}` | Delete vendor |
| POST | `/vendor-info/rebuild-rules?account_id=X` | Learn rules from history |
| POST | `/vendor-info/import-from-transactions?account_id=X` | Create vendors from transaction data |

### Properties & Tenants (7 endpoints)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/properties?account_id=X` | List with tenants (eager loaded) |
| POST | `/properties?account_id=X` | Create property |
| PUT | `/properties/{id}` | Update property |
| DELETE | `/properties/{id}` | Delete property + tenants |
| POST | `/properties/{id}/tenants` | Create tenant |
| PUT | `/tenants/{id}` | Update tenant |
| DELETE | `/tenants/{id}` | Delete tenant |

**42 endpoints total across 9 resource groups.**

---

## Infrastructure

### Docker Compose
- `finance-app-1` — FastAPI app, maps host 8001 -> container 8000
- `finance-db-1` — PostgreSQL 15 (Alpine), port 5432, database `finance_db`, user `user`

### Environment Variables
| Variable | Where | Default | Purpose |
|----------|-------|---------|---------|
| `NEXT_PUBLIC_API_URL` | Frontend `.env.local` | `http://localhost:8001` | API base URL |
| `CORS_ORIGINS` | Backend | `http://localhost:3000` | Allowed CORS origins (comma-separated) |
| `DATABASE_URL` | Backend | (from docker-compose) | PostgreSQL connection string |

### Dependencies
**Backend:** FastAPI ~0.115, SQLAlchemy ~2.0, psycopg2-binary ~2.9, pandas ~2.2, uvicorn ~0.34, pydantic ~2.10, python-multipart ~0.0.20, watchdog ~6.0

**Frontend:** Next.js 16, React 19, TanStack Table 8, axios, Recharts 3, ExcelJS 4, jsPDF 4, sonner 2, shadcn/ui, Tailwind CSS 4
