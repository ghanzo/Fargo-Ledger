# System Architecture — Fargo Ledger

**Last Updated:** 2026-03-16

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
| `src/api.py` | ~1,100 | All REST endpoints (42+ routes across 9 resource groups) |
| `src/models.py` | ~140 | SQLAlchemy ORM models (7 tables) with relationships |
| `src/schemas.py` | ~210 | Pydantic request/response schemas |
| `src/importer.py` | ~245 | CSV parsing, format auto-detection, pattern extraction, vendor matching, deduplication |
| `src/watcher.py` | ~200 | Folder watcher for auto-importing CSVs from inbox |
| `src/database.py` | ~16 | SQLAlchemy engine and session setup |
| `src/ingest.py` | ~120 | CLI script for manual CSV import (legacy) |

### Key Patterns

**Account Scoping:** Every database query filters by `account_id`. API endpoints require it as a query parameter. There is no cross-account data access.

**CORS:** Configured from `CORS_ORIGINS` environment variable (comma-separated). Defaults to `http://localhost:3000`.

**Confidence System:** Vendor auto-assignment uses a self-correcting confidence score:
- Formula: `confidence = 1.0 - (corrected_count / max(assigned_count, 1))`
- `>= 0.85`: auto-assign + mark `is_cleaned=true`
- `>= 0.70`: auto-assign only (user reviews)
- `< 0.70`: rule auto-disables
- Corrections tracked when user manually changes an auto-categorized vendor

**Sign-aware Rules:** Vendor rules can store separate category/project for income (+) vs expense (-) transactions via `by_sign` in the rules JSON.

**Multi-Format Import Pipeline:**
```
CSV file
  -> importer.py:_detect_and_parse_csv()
  -> Detect format from first line:
     - "Account ID," header → Redwood Credit Union
       - Parse "$-61.95" amounts, MM/DD/YY dates
       - institution = "Redwood Credit Union"
     - No header → Wells Fargo
       - 5-column format (date, amount, star, empty, description)
       - institution = "Wells Fargo"
  -> Normalize to (date, amount, description) DataFrame
  -> importer.py:import_csv_content()
  -> Generate hash ID: SHA256(date+description+amount) + occurrence suffix
  -> Deduplicate against existing transactions
  -> Store institution on each transaction
  -> Match against vendor rules (pattern matching, confidence thresholds)
  -> Create import_suggestions for high-confidence matches (pending)
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
| `app/analysis/page.tsx` | Charts, budget tracker, category/vendor/project breakdowns with in-place editing |
| `app/report/page.tsx` | Annual P&L by project, reconciliation, Excel/PDF export |
| `app/management/page.tsx` | Vendor card grid with rules, property/tenant CRUD |
| `app/error.tsx` | Error boundary — catches rendering errors, shows retry UI |
| `app/layout.tsx` | Root layout with ThemeProvider + AccountProvider |
| `app/nav.tsx` | NavBar with active-link underline, account selector, watcher indicator, theme toggle |
| `app/columns.tsx` | TanStack Table column definitions (select, date, vendor, project, institution, description, category, amount, notes, tags, tax, actions) |
| `app/data-table.tsx` | Virtualized table with filters, shift-click, keyboard shortcuts, CSV export |
| **Components** | |
| `components/transaction-panel.tsx` | Slide-in detail/edit panel with auto-suggest, institution field |
| `components/bulk-edit-dialog.tsx` | Bulk edit modal with undo (sonner toast action), institution support |
| `components/import-dialog.tsx` | Drag-and-drop CSV import (Wells Fargo + Redwood CU) |
| `components/budget-dialog.tsx` | Budget CRUD manager |
| `components/suggestion-banner.tsx` | Import suggestion review (approve/edit/dismiss/approve-all) |
| `components/account-manager-dialog.tsx` | Create/rename/delete accounts |
| `components/vendor-combobox.tsx` | Free-form vendor selection/creation |
| `components/category-combobox.tsx` | Free-form category selection/creation |
| `components/project-combobox.tsx` | Free-form project selection/creation |
| `components/institution-combobox.tsx` | Free-form institution selection/creation |
| `components/tag-input.tsx` | Chip badge input for tags |
| **Infrastructure** | |
| `lib/api.ts` | Centralized axios instance (baseURL from `NEXT_PUBLIC_API_URL`) |
| `lib/utils.ts` | Tailwind `cn()` utility |
| `context/account-context.tsx` | AccountProvider + `useAccount()` hook |
| `hooks/use-persistent-state.ts` | sessionStorage-backed useState |
| `types/transaction.ts` | Transaction TypeScript interface |

### Key Patterns

**Component Tree:**
```
layout.tsx
  -> ThemeProvider (next-themes)
  -> AccountProvider (context)
    -> NavBar
    -> Page routes
      -> Transactions: SuggestionBanner + DataTable (virtualized)
         -> BulkEditDialog
         -> TransactionPanel (with comboboxes)
      -> Analysis: Charts + BudgetDialog + editable TransactionTables
         -> Built-in BulkEditDialog per drill-down
      -> Report: Aggregations + PDF/Excel export
      -> Management: Vendor cards + Property/tenant CRUD
```

**State Management:** React Context for accounts only. Props for everything else. No Redux/Zustand — intentionally simple.

**Persistence:**
- `sessionStorage` via `usePersistentState()` — filters, expanded sections, active tab (survives page navigation, clears on tab close)
- `localStorage` — active account ID (survives sessions)

**TanStack Table:** Callbacks (`onRefresh`, `openPanel`) passed via `meta` option in `useReactTable`. Column components access them via `table.options.meta`.

**Virtualized Scrolling:** `@tanstack/react-virtual` renders only ~40-50 rows in the DOM regardless of total count. Top/bottom spacer `<tr>` elements maintain scroll height. `overscan: 15` for smooth scrolling. Dynamic row measurement via `virtualizer.measureElement`.

**Undo Pattern:** Before a bulk edit, snapshots of all affected transactions are captured (including institution). On success, a sonner toast with an "Undo" action calls `POST /transactions/bulk-restore` with the snapshots.

**FilterPill:** Three-state cycle: `null` -> `true` -> `false` -> `null`. Used for boolean filters (has vendor, has category, has institution, etc).

**Keyboard Shortcuts (DataTable):**
- `j`/`k` or `↑`/`↓` — move cursor up/down
- `Space` — toggle selection on focused row
- `e` — open edit panel for focused row
- `Esc` — close panel / deselect
- `Ctrl+A` — select all visible rows

**Analysis Transaction Editing:**
- Transactions shown in analysis drill-downs have full editing capabilities
- Checkboxes with shift-click range selection
- Search bar filtering within the drill-down
- Sort by date or amount (click header to cycle asc/desc/none)
- Actions menu (Edit Details, Copy ID) per row
- Floating bulk edit bar when rows selected
- On save/bulk-edit, analysis data refreshes to reflect changes

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
  |     |-- category, vendor, project, institution
  |     |-- notes, tags (JSON)
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

### Key Fields

| Field | Purpose |
|-------|---------|
| `transaction.institution` | Bank/source that originated the transaction (auto-set on import, editable) |
| `transaction.is_transfer` | Excludes from P&L in reports and analysis |
| `transaction.is_cleaned` | Indicates transaction has been reviewed/categorized |
| `transaction.auto_categorized` | Set when vendor rules auto-assigned fields on import |
| `transaction.raw_data` | Original CSV row as JSON, preserved for audit and format re-detection |
| `vendor_info.rules` | JSON blob with patterns, defaults, by_sign, confidence, enabled, assigned_count, corrected_count |

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
| GET | `/transactions?account_id=X` | List with filters (category, vendor, project, has_category, has_vendor, has_project, date range, cleaned, search, limit) |
| PUT | `/transactions/{id}` | Update single transaction (category, vendor, project, institution, notes, tags, tax_deductible, is_transfer, is_cleaned) |
| PATCH | `/transactions/bulk?account_id=X` | Bulk update |
| POST | `/transactions/bulk-restore` | Undo bulk operations (restores all fields including institution) |
| GET | `/transactions/{id}/suggest` | Auto-suggest vendor/category from similar descriptions |

### Facets & Import (3 endpoints)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/facets?account_id=X` | Distinct categories, vendors, projects, institutions |
| POST | `/import/csv` | Import CSV (auto-detects Wells Fargo or Redwood CU format) |
| GET | `/watcher/status` | Import watcher running state + recent log |

### Suggestions (4 endpoints)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/suggestions?account_id=X` | List pending suggestions with sample descriptions |
| POST | `/suggestions/{id}/approve` | Apply suggestion to matched transactions |
| POST | `/suggestions/{id}/dismiss` | Dismiss suggestion |
| POST | `/suggestions/approve-all?account_id=X` | Batch approve all pending |

### Stats (7 endpoints)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/stats/summary` | Income/expenses/net/tax_deductible/uncategorized totals |
| GET | `/stats/category_breakdown` | Spending by category (includes uncategorized), filterable by project |
| GET | `/stats/project_breakdown` | Income/expenses/count by project |
| GET | `/stats/monthly` | Monthly income vs expenses |
| GET | `/stats/top_vendors` | Top vendors by spend volume |
| GET | `/stats/subscriptions` | Recurring vendor detection (30% tolerance) |
| GET | `/stats/budget_status` | Budget vs actual for current month |

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
| POST | `/vendor-info/rebuild-rules?account_id=X` | Re-learn rules from transaction history |
| POST | `/vendor-info/import-from-transactions?account_id=X` | Create vendors from existing transaction data |

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

**42+ endpoints total across 9 resource groups.**

---

## Report Structure

The report page (`/report`) generates annual financial reports per account.

### Sections
1. **Summary Table** — all projects with income/expenses/net columns
2. **Income Statements** — per-project detail: income categories, expense categories, net income
3. **Reconciliation** — beginning balance + net income + transfers in - transfers out = ending balance
4. **Transactions by Project** — every transaction grouped by project with subtotals
5. **All Transactions by Date** — chronological check register with project, vendor, category, institution, running balance

### Excel Export (4 sheets)
1. **Income Statement** — project-level P&L with SUM formulas
2. **Reconciliation** — 5-line summary with formula for ending balance
3. **Check Register** — all transactions with Date, Project, Description, Vendor, Category, Institution, Amount, Balance (running balance formula per row)
4. **Management** — vendors grouped by trade category, properties with tenant details

### PDF Export
Canvas-based rendering via html-to-image + jsPDF with smart page breaks.

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

**Frontend:** Next.js 16, React 19, TanStack Table 8, TanStack Virtual, axios, Recharts 3, ExcelJS 4, jsPDF 4, sonner 2, shadcn/ui, Tailwind CSS 4

### Adding New Database Columns
SQLAlchemy's `create_all` does NOT add columns to existing tables. When a new column is added to `src/models.py`, run manually:
```bash
docker exec finance-db-1 psql -U user -d finance_db -c \
  "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS <col> <type> DEFAULT <default>;"
```
