# Testing Strategy — Fargo Ledger

**Last Updated:** 2026-03-03

---

## Current State

**Backend tests:** None
**Frontend tests:** None
**E2E tests:** None

This is the single biggest gap in the project. Every refactoring or new feature risks breaking existing functionality with no safety net. Testing is the top priority after Phase 0 stabilization.

---

## What We Need to Test (and Why)

### Backend — API Correctness

The API is the contract between the frontend and the database. If an endpoint returns wrong data or fails silently, everything downstream breaks.

**Priority 1 — Core data flow:**
- Account CRUD: create, list, rename, delete with cascade verification
- Transaction CRUD: create via import, update single, bulk update, bulk restore (undo)
- CSV import: valid file produces correct records, duplicates are skipped, malformed rows are handled
- Facets: returns correct distinct values per account, respects account scoping

**Priority 2 — Business logic:**
- Budget status calculation: spend vs limit, percentage, correct month filtering
- Vendor rule rebuild: pattern extraction, confidence calculation, ambiguity resolution
- Auto-suggest: returns correct vendor/category for similar descriptions
- Import suggestions: creation on import, approve/dismiss status changes, batch approve-all

**Priority 3 — Stats accuracy:**
- Category breakdown sums match manual calculation
- Monthly stats correctly bucket transactions by month
- Subscription detection identifies recurring charges
- Top vendors sorting is correct

**Priority 4 — Edge cases:**
- Account scoping: ensure no cross-account data leakage
- Empty states: no transactions, no budgets, no vendors — endpoints return gracefully
- Concurrent operations: bulk update doesn't corrupt data

### Frontend — Component Behavior

The frontend is complex with keyboard shortcuts, selection state, filter persistence, and undo flows. Manual testing misses regressions.

**Priority 1 — DataTable:**
- Renders with mock transaction data
- Filtering: text search, boolean pills, date range
- Sorting: by column, preserves selection
- Selection: single click, shift-click range, Ctrl+A
- Keyboard: j/k navigation, space select, e open panel, Esc close

**Priority 2 — Mutation flows:**
- TransactionPanel: opens with correct data, saves updates, triggers refresh
- BulkEditDialog: captures snapshots before save, posts correct update, undo restores
- ImportDialog: accepts CSV, shows results, triggers table refresh

**Priority 3 — State management:**
- AccountContext: loads accounts, restores selection from localStorage, handles empty state
- usePersistentState: survives navigation, clears correctly

---

## How to Test

### Backend: pytest + httpx

```
tests/
  conftest.py          # Test database setup (SQLite in-memory or test PostgreSQL)
  test_accounts.py     # Account CRUD
  test_transactions.py # Transaction CRUD + bulk + restore
  test_import.py       # CSV import + deduplication
  test_budgets.py      # Budget CRUD + status
  test_vendors.py      # Vendor info + rule rebuild
  test_properties.py   # Property/tenant CRUD
  test_stats.py        # Stats endpoint calculations
  test_suggestions.py  # Import suggestion workflow
```

**Test database:** Use SQLite in-memory for speed (`sqlite:///`), or spin up a dedicated test PostgreSQL container for full fidelity. SQLite may have minor behavior differences with JSON columns — if tests pass on SQLite but fail on Postgres, switch to Postgres.

**Fixtures:**
- `db_session`: fresh database per test (create_all + drop_all)
- `client`: httpx `TestClient(app)` with dependency override for test DB
- `sample_account`: pre-created account for tests that need one
- `sample_transactions`: a small set of known transactions for stats verification

**Privacy:** Test fixtures should use obviously fake data ("Test Vendor", $100.00, "Test Category"). Never copy real transaction data into test files.

### Frontend: Vitest + React Testing Library

```
components/
  __tests__/
    data-table.test.tsx
    transaction-panel.test.tsx
    bulk-edit-dialog.test.tsx
    import-dialog.test.tsx
    account-context.test.tsx
```

**Mocking:** Mock `@/lib/api` to return controlled responses. Mock `useAccount()` to provide test account data. Mock `sonner` toast to verify notification behavior.

**Key assertions:**
- Renders without crashing (baseline for every component)
- Correct data appears in the DOM after API response
- User interactions (click, type, keyboard) trigger expected behavior
- Error states show appropriate feedback

---

## What We're NOT Testing (and Why)

- **Database internals** — SQLAlchemy and PostgreSQL are trusted. We test our queries, not theirs.
- **Third-party libraries** — Recharts renders a chart, ExcelJS produces a file. We don't test their output.
- **CSS/styling** — Visual correctness is verified by eye. No visual regression testing for now.
- **Performance benchmarks** — Not yet. When we have tests, we can add benchmarks.

---

## Coverage Goals

| Area | Target | Rationale |
|------|--------|-----------|
| API endpoints | 90%+ | Every endpoint should have at least a happy-path test |
| Business logic (confidence, dedup, stats) | 100% | These are the calculations that matter most |
| Frontend components | 70%+ | Cover critical paths; full coverage is diminishing returns |
| E2E flows | 0% for now | Add after unit/integration tests are solid |

---

## Running Tests

_To be updated once test infrastructure is set up._

```bash
# Backend
cd Finance
pytest tests/ -v

# Frontend
cd frontend
npx vitest run
```
