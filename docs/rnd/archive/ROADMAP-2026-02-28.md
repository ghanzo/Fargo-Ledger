# Development Roadmap — Finance Dashboard

**Last Updated:** 2026-02-28

---

## How to Use This Document

This roadmap is organized into phases. Each phase contains discrete tasks that an LLM coder can pick up independently. Tasks are written as clear instructions with context about *what* to change and *why*. Reference the [REVIEW.md](./REVIEW.md) for detailed findings.

---

## Completed Tasks

These tasks are already implemented and should not be re-done. Listed here for context.

| Task | Implemented In | Notes |
|------|---------------|-------|
| Scheduled CSV import (was 7.1) | `src/watcher.py` | Folder watcher monitors `inbox/{AccountName}/`, auto-imports, moves to `processed/`. Thread-safe logging. Lifespan-managed. Status/log endpoints: `GET /watcher/status`, `GET /watcher/log`. |
| Suggestion review queue | `src/api.py`, `frontend/components/suggestion-banner.tsx` | Auto-categorization generates pending suggestions. Banner UI for approve/edit/dismiss individually or batch approve-all. Endpoints: `GET /suggestions`, `POST /suggestions/{id}/approve`, `POST /suggestions/{id}/dismiss`, `POST /suggestions/approve-all`. |
| Dark mode toggle | `frontend/app/nav.tsx`, `frontend/app/globals.css` | Theme toggle in NavBar using `next-themes`. OKLCH color variables for light/dark. |
| Vendor management with rules | `frontend/app/management/page.tsx`, `src/api.py` | Card grid UI with pattern editing, confidence badges. Rebuild-rules and import-from-transactions endpoints. |
| Property/tenant CRUD | `frontend/app/management/page.tsx`, `src/api.py` | Full CRUD with cascade deletes, lease tracking, monthly rent. |

---

## Phase 0: Foundation & Stability (Do First)

These tasks fix critical gaps and create the safety net for all future work.

### 0.1 — Pin Backend Dependency Versions
**Files:** `requirements.txt`
**Task:** Run `pip freeze` inside the Docker container and pin all dependency versions (e.g., `fastapi==0.115.*`). This prevents silent breakage from upstream updates.

### 0.2 — Extract API Base URL to Environment Variable
**Files:** All frontend files that call `axios.get("http://localhost:8000/...")`
**Task:** Create a `NEXT_PUBLIC_API_URL` environment variable. Replace all hardcoded `http://localhost:8000` references with this variable. Add to `.env.example`.

### 0.3 — Add ORM Relationships to Models
**Files:** `src/models.py`, `src/api.py`
**Task:** Add SQLAlchemy `relationship()` definitions to Account (transactions, budgets, vendor_info, properties) and Property (tenants). Update the `list_properties` endpoint to use `joinedload(Property.tenants)` instead of N+1 separate queries.

### 0.4 — Remove Dead Code
**Files:** `frontend/components/edit-transaction-dialog.tsx`
**Task:** Delete this file. It was replaced by `transaction-panel.tsx` and is no longer imported anywhere. Also remove the default Next.js SVGs in `frontend/public/` (file.svg, globe.svg, next.svg, vercel.svg, window.svg) if unused.

### 0.5 — Add React Error Boundary
**Files:** `frontend/app/layout.tsx` (new: `frontend/components/error-boundary.tsx`)
**Task:** Create a React error boundary component that catches rendering errors and shows a user-friendly fallback instead of a blank page. Wrap the main content area in `layout.tsx`.

### 0.6 — CORS from Environment Variable
**Files:** `src/api.py`
**Task:** Read allowed origins from `CORS_ORIGINS` env variable (comma-separated) instead of hardcoding `http://localhost:3000`. Default to `http://localhost:3000` if not set.

### 0.7 — Add Audit Timestamps to Transaction Model
**Files:** `src/models.py`, DB migration
**Task:** Add `created_at` (server_default=now) and `updated_at` (onupdate=now) columns to the `transactions` table. Enables tracking when records were imported and last modified. Requires `ALTER TABLE` until Alembic is set up (Phase 8.2).

### 0.8 — Extract Magic Numbers to Constants
**Files:** `src/importer.py`, `src/api.py`
**Task:** Move hardcoded values to a `src/constants.py` or top-of-file constants:
- Confidence thresholds: `AUTO_ASSIGN_THRESHOLD = 0.85`, `MIN_CONFIDENCE = 0.70`
- Pattern prefix length: `DESCRIPTION_PREFIX_LENGTH = 30`
- Noise word list → separate constant or config file
- Watcher stability delay: `FILE_STABILITY_SECONDS = 2`

### 0.9 — Centralize Frontend API Client
**Files:** New `frontend/lib/api.ts`, all files with `axios.get/post/put/patch/delete` calls
**Task:** Create an axios instance in `frontend/lib/api.ts` with base URL from `NEXT_PUBLIC_API_URL`, default timeout, and account_id interceptor. Replace all raw axios calls across the frontend. This also sets up the foundation for adding auth headers (Phase 2.1).

---

## Phase 1: Testing

### 1.1 — Backend API Tests
**Files:** New `tests/` directory, `tests/conftest.py`, `tests/test_api.py`
**Task:** Set up pytest with an in-memory SQLite database (or test PostgreSQL container). Write tests for:
- Account CRUD (create, list, rename, delete with cascade)
- Transaction CRUD (create via import, update, bulk update, restore)
- Budget CRUD and status calculation
- Vendor info CRUD and rule rebuild
- Property/tenant CRUD
- CSV import (valid file, duplicate detection, malformed file)
- Stats endpoints (verify calculations)

### 1.2 — Frontend Component Tests
**Files:** New test files alongside components
**Task:** Set up Vitest + React Testing Library. Write tests for:
- DataTable: rendering, filtering, sorting, selection, keyboard shortcuts
- TransactionPanel: opening, editing, saving
- BulkEditDialog: field updates, undo snapshot capture
- ImportDialog: file selection, upload flow
- AccountContext: account switching, localStorage persistence

### 1.3 — Add Pre-commit Linting
**Files:** Root config files
**Task:** Add a pre-commit hook that runs `ruff check` (Python) and `eslint` (frontend) before each commit. Prevents regressions from being committed.

---

## Phase 1.5: Performance & Query Fixes

These are low-effort / high-impact fixes discovered during the 2026-02-28 deep analysis.

### 1.5.1 — Fix N+1 Query in Suggestions Endpoint
**Files:** `src/api.py` (GET `/suggestions`)
**Task:** The current code loops over each suggestion and queries sample transaction descriptions individually. Refactor to batch-fetch all transaction descriptions in a single query, then distribute to suggestions in Python. Expected: O(1) queries instead of O(n).

### 1.5.2 — Fix top_vendors SQL Sort
**Files:** `src/api.py` (GET `/stats/top_vendors`)
**Task:** Currently loads ALL vendor amounts into Python and sorts client-side. Replace with SQL `ORDER BY abs(total) DESC LIMIT :n` to push sorting to the database. Reduces memory usage and improves response time.

### 1.5.3 — Add Stats Endpoint Caching
**Files:** `src/api.py` (all `/stats/*` endpoints)
**Task:** Add a simple TTL cache (60-second expiry, keyed by `account_id + endpoint + params`). Options: `cachetools.TTLCache` in-process, or a custom decorator. Every chart request currently triggers a full table scan — caching prevents redundant work when users navigate back and forth to the analysis page.

### 1.5.4 — Log Malformed CSV Rows
**Files:** `src/importer.py`
**Task:** Currently malformed rows are silently skipped during CSV import. Add structured logging that records: row number, column that failed parsing, and the error type. Do NOT log row content (privacy). Return a `warnings` array in the import response so the frontend can display "X rows skipped due to parse errors".

### 1.5.5 — Add Server-Side Pagination Guard
**Files:** `src/api.py` (GET `/transactions`)
**Task:** Add a `MAX_LIMIT = 5000` constant. If no `limit` is provided, default to `MAX_LIMIT`. If `limit` exceeds `MAX_LIMIT`, cap it. This prevents unbounded memory usage while still allowing the frontend to load all data for client-side filtering (current architecture). Add `X-Total-Count` response header for future frontend pagination support.

---

## Phase 2: Data Integrity & Security

### 2.1 — Add Basic Authentication
**Files:** `src/api.py`, new `src/auth.py`
**Task:** Implement API key authentication. Store the key in `.env`. Add a FastAPI dependency that checks the `Authorization: Bearer <key>` header on all routes. Frontend sends the key with every request (stored in env variable). This is sufficient for a self-hosted single-user tool.

### 2.2 — Fix Transaction ID Race Condition
**Files:** `src/importer.py`
**Task:** Before generating a transaction ID, query the database for existing IDs with the same base hash to determine the correct occurrence number. This prevents duplicate IDs when concurrent imports process the same transactions.

### 2.3 — Add File Upload Validation
**Files:** `src/api.py` (import endpoint)
**Task:** Add validation for CSV uploads:
- Max file size: 10MB
- Verify MIME type is `text/csv`
- Validate CSV has expected column count before processing
- Return clear error messages for each validation failure

### 2.4 — Use Decimal for Currency Calculations
**Files:** `src/api.py` (stats endpoints), `src/schemas.py`
**Task:** Replace `float()` casts with `Decimal` in all currency aggregation calculations. Update Pydantic schemas to use `float` output but keep internal math in Decimal to avoid rounding errors.

### 2.5 — Add Soft Delete for Accounts
**Files:** `src/models.py`, `src/api.py`, `src/schemas.py`
**Task:** Add an `is_deleted` boolean column to the accounts table. Change `DELETE /accounts/{id}` to set this flag instead of hard deleting. Filter deleted accounts from `GET /accounts`. Add a `POST /accounts/{id}/restore` endpoint. Keep hard delete as `DELETE /accounts/{id}?permanent=true` with confirmation.

---

## Phase 3: Multi-Bank CSV Support

### 3.1 — Pluggable CSV Parser Architecture
**Files:** `src/importer.py`, new `src/parsers/` directory
**Task:** Refactor the import system to support multiple bank formats:
- Create a `src/parsers/base.py` with an abstract `BankParser` class (methods: `detect(content) -> bool`, `parse(content) -> list[ParsedTransaction]`)
- Move Wells Fargo logic to `src/parsers/wells_fargo.py`
- Add a parser registry that auto-detects bank format from CSV headers
- Update `import_csv_content()` to use the registry

### 3.2 — Add Chase CSV Parser
**Files:** `src/parsers/chase.py`
**Task:** Implement parser for Chase bank CSV format (columns: Transaction Date, Post Date, Description, Category, Type, Amount). Register in the parser registry.

### 3.3 — Add Generic/Custom CSV Parser
**Files:** `src/parsers/generic.py`, frontend mapping UI
**Task:** Create a generic parser where the user maps CSV columns to fields (date, description, amount). Add a frontend dialog that shows the first 3 rows and lets the user assign columns via dropdowns. Save column mappings per account for reuse.

---

## Phase 4: Enhanced Analytics

### 4.1 — Year-over-Year Comparison
**Files:** `src/api.py` (new endpoint), `frontend/app/analysis/page.tsx`
**Task:** Add `GET /stats/yoy_comparison?account_id=X&year=YYYY` endpoint that returns monthly income/expenses for the given year and previous year. Add a comparison chart to the analysis page showing both years side by side.

### 4.2 — Spending Trends & Alerts
**Files:** `src/api.py` (new endpoint), `frontend/app/analysis/page.tsx`
**Task:** Add `GET /stats/trends?account_id=X` endpoint that identifies:
- Categories with spending increasing month-over-month (3+ months)
- Unusual transactions (amount > 2x the category average)
- New recurring charges (same vendor, similar amount, 2+ months)
Display as alert cards on the analysis page.

### 4.3 — Cash Flow Forecasting
**Files:** `src/api.py` (new endpoint), `frontend/app/analysis/page.tsx`
**Task:** Add a simple cash flow forecast based on:
- Average monthly income (last 6 months)
- Average monthly expenses by category (last 6 months)
- Known upcoming rent payments (from tenant lease data)
Display as a projected 3-month chart.

### 4.4 — Tax Summary Report
**Files:** `frontend/app/report/page.tsx`
**Task:** Add a "Tax Summary" section to the annual report that groups all `tax_deductible=true` transactions by category, with subtotals. Include in Excel export as a separate sheet.

---

## Phase 5: UX Improvements

### 5.1 — Virtual Scrolling for Large Datasets
**Files:** `frontend/app/data-table.tsx`
**Task:** Replace the current table renderer with TanStack Virtual (`@tanstack/react-virtual`) for row virtualization. This keeps the DOM lightweight even with 50k+ rows. Preserve existing keyboard navigation and selection behavior.

### 5.2 — Mobile Responsive Layout
**Files:** `frontend/app/data-table.tsx`, `frontend/app/nav.tsx`, `frontend/app/globals.css`
**Task:** Add responsive breakpoints:
- Mobile (<768px): Card layout instead of table, hamburger nav, bottom sheet for transaction panel
- Tablet (768-1024px): Condensed table with fewer columns, collapsible sidebar panel
- Keep desktop layout unchanged

### 5.3 — ~~Dark Mode~~ DONE
> Already implemented. Theme toggle in NavBar using `next-themes`. OKLCH color variables in `globals.css`. See Completed Tasks above.

### 5.4 — Optimistic UI Updates
**Files:** `frontend/components/transaction-panel.tsx`, `frontend/components/bulk-edit-dialog.tsx`
**Task:** Update the mutation flow to:
1. Immediately update local state with new values
2. Send API request in background
3. Revert local state if API fails (with error toast)
This makes the UI feel instant instead of waiting for server response.

### 5.5 — Batch Import Progress
**Files:** `frontend/components/import-dialog.tsx`, `src/api.py`
**Task:** For large CSV files, add progress feedback:
- Backend: Stream import progress via Server-Sent Events or return intermediate counts
- Frontend: Show a progress bar with "X of Y rows processed" during import

---

## Phase 6: Property Management Expansion

### 6.1 — Rent Payment Tracking
**Files:** `src/api.py`, `frontend/app/management/page.tsx`
**Task:** Add logic to match incoming transactions to expected rent payments:
- Match by amount (within tolerance) and timing (around lease date)
- Show a rent collection dashboard: expected vs received per property per month
- Flag late or missing payments

### 6.2 — Lease Expiry Alerts
**Files:** `frontend/app/management/page.tsx`
**Task:** Show visual indicators for leases expiring within 30/60/90 days. Add a summary card at the top of the properties tab showing upcoming expirations.

### 6.3 — Maintenance Expense Tracking
**Files:** `src/models.py`, `src/api.py`, `frontend/app/management/page.tsx`
**Task:** Add ability to tag transactions as maintenance for a specific property. Show per-property maintenance cost summary in the management page and include in the annual report.

---

## Phase 7: Automation & Intelligence

### 7.1 — ~~Scheduled CSV Import~~ DONE
> Already implemented in `src/watcher.py`. See Completed Tasks above. Frontend polls `/watcher/status` every 30s, shows green dot + unseen import count badge in NavBar.

### 7.2 — Improved Auto-Categorization
**Files:** `src/importer.py`
**Task:** Enhance the pattern matching beyond substring matching:
- Use TF-IDF or simple ML on description text
- Consider amount ranges for better vendor discrimination
- Allow user to train/retrain the model from the management page

### 7.3 — Receipt/Document Attachment
**Files:** `src/models.py`, `src/api.py`, `frontend/components/transaction-panel.tsx`
**Task:** Add ability to attach receipt images or documents to transactions:
- New `attachments` table (transaction_id, filename, file_path, uploaded_at)
- Upload endpoint with file storage (local disk or S3-compatible)
- Display attachments in the transaction panel with preview

---

## Phase 8: Deployment & Operations

### 8.1 — Production Docker Configuration
**Files:** `docker-compose.prod.yml`, `Dockerfile`
**Task:** Create a production Docker Compose that:
- Builds frontend as static export or runs Next.js with standalone output
- Runs uvicorn without `--reload` and with multiple workers
- Adds nginx reverse proxy for both services
- Uses Docker secrets instead of `.env` for credentials
- Adds health checks for all services

### 8.2 — Database Migrations
**Files:** New `alembic/` directory
**Task:** Set up Alembic for database migrations. Generate initial migration from current models. Replace the `create_all()` approach with managed migrations. This is critical for safely adding/modifying columns without data loss.

### 8.3 — Backup & Restore
**Files:** New backup script
**Task:** Create a backup script that:
- Dumps PostgreSQL database to compressed file
- Stores backups with timestamps
- Supports restore from backup file
- Optionally uploads to cloud storage (S3/GCS)
- Can be scheduled via cron

### 8.4 — Structured Logging & Monitoring
**Files:** `src/api.py`, new `src/logging_config.py`
**Task:** Add Python structured logging (JSON format) with:
- Request/response logging middleware (excluding sensitive data)
- Import operation logging (counts only, no transaction content)
- Error logging with stack traces
- Configurable log level via environment variable

---

## Task Dependency Graph

```
Phase 0 (Foundation) — all independent, do in any order
  ├── 0.1 Pin versions
  ├── 0.2 API URL env var ─┐
  ├── 0.3 ORM relationships│
  ├── 0.4 Remove dead code │
  ├── 0.5 Error boundary   │
  ├── 0.6 CORS env var     │
  ├── 0.7 Audit timestamps │
  ├── 0.8 Extract constants│
  └── 0.9 API client ──────┘ (depends on 0.2)
        │
        ├── Phase 1 (Testing) ← depends on Phase 0
        │   ├── 1.1 Backend tests
        │   ├── 1.2 Frontend tests
        │   └── 1.3 Pre-commit hooks
        │
        ├── Phase 1.5 (Performance) ← independent of Phase 1, depends on Phase 0
        │   ├── 1.5.1 Fix N+1 suggestions
        │   ├── 1.5.2 Fix top_vendors SQL
        │   ├── 1.5.3 Stats caching
        │   ├── 1.5.4 Log CSV parse errors
        │   └── 1.5.5 Pagination guard
        │
        └── Phase 2 (Security) ← depends on Phase 0
            ├── 2.1 Authentication ← 0.9 (API client) makes this easier
            ├── 2.2 Fix race condition
            ├── 2.3 Upload validation
            ├── 2.4 Decimal currency
            └── 2.5 Soft delete
                │
Phase 3 (Multi-bank) ← depends on 1.1
  ├── 3.1 Parser architecture
  ├── 3.2 Chase parser ← depends on 3.1
  └── 3.3 Generic parser ← depends on 3.1
        │
Phase 4-7 (Features) ← can run in parallel after Phase 2
  Note: 5.3 (Dark mode) and 7.1 (CSV watcher) already DONE
        │
Phase 8 (Deployment) ← depends on Phase 2
  ├── 8.1 Production Docker
  ├── 8.2 Alembic migrations (unblocks 0.7 for future columns)
  ├── 8.3 Backup script
  └── 8.4 Logging
```

---

## Notes for the LLM Coder

- **Privacy Rule:** Never print real user data (amounts, descriptions, vendors) in terminal output. Only check HTTP status codes or record counts.
- **DB Column Changes:** SQLAlchemy `create_all()` does NOT add columns to existing tables. When adding a column to `src/models.py`, you must also run an `ALTER TABLE` command in the Docker container. Once Phase 8.2 (Alembic) is complete, use migrations instead.
- **Account Scoping:** Every query and every API call must include `account_id`. Never return data across accounts.
- **Frontend State:** Filters persist in sessionStorage. Account selection persists in localStorage. Do not break these patterns.
- **TanStack Table Meta:** Pass callbacks (onRefresh, openPanel) via the `meta` option in `useReactTable`. Components access them via `table.options.meta`.
- **Undo Pattern:** Capture field snapshots before mutations. POST to `/transactions/bulk-restore` in the toast undo action.
- **Vendor Confidence System:** Thresholds are 0.85 (auto-assign + cleaned) and 0.70 (auto-assign only). Formula: `1.0 - (corrected / max(assigned, 1))`. Correction tracking increments on manual vendor edits. Below 0.70 auto-disables the rule. Sign-aware rules store separate category/project per +/- sign.
- **Import Pipeline:** CSV → `importer.py:import_csv_content()` → deduplicate by hash ID → apply vendor rules → generate `import_suggestions` for unmatched patterns. Watcher moves processed files to `processed/{TIMESTAMP}_{filename}`.
- **Component Tree:** Layout → ThemeProvider → AccountProvider → NavBar + Page routes. Main page: SuggestionBanner + DataTable (BulkEditDialog, TransactionPanel with comboboxes). Analysis: Recharts charts + BudgetDialog. Report: aggregations + PDF/Excel export. Management: vendor cards + property/tenant CRUD.
- **No Global State Library:** React Context for accounts only. Props for everything else. sessionStorage via `usePersistentState()` hook. This is intentional — do not introduce Redux/Zustand unless complexity demands it.
- **Docker Ports:** Backend maps 8001→8000 (host→container). Database: 5432. Frontend: 3000.
