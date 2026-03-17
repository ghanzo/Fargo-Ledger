# Testing Strategy — Fargo Ledger

**Last Updated:** 2026-03-16

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
- CSV import: Wells Fargo format, Redwood CU format, auto-detection, duplicates skipped, malformed rows handled
- Institution auto-detection: correct institution assigned based on CSV format
- Facets: returns correct distinct values per account (categories, vendors, projects, institutions)

**Priority 2 — Business logic:**
- Budget status calculation: spend vs limit, percentage, correct month filtering
- Vendor rule rebuild: pattern extraction, confidence calculation, ambiguity resolution
- Confidence scoring: `1.0 - (corrected / assigned)`, threshold behavior at 0.85/0.70
- Auto-suggest: returns correct vendor/category for similar descriptions
- Import suggestions: creation on import, approve/dismiss status changes, batch approve-all
- Sign-aware rules: income vs expense category/project assignment per vendor

**Priority 3 — Stats accuracy:**
- Category breakdown: sums match manual calculation, includes uncategorized as "(Uncategorized)"
- Project breakdown: income/expense/count correctly bucketed, null project handled
- Monthly stats: correctly bucket transactions by month
- Subscription detection: identifies recurring charges within tolerance
- Top vendors: sorting is correct
- Summary: total_income, total_expenses, net, tax_deductible_total all accurate

**Priority 4 — Edge cases:**
- Account scoping: ensure no cross-account data leakage
- Empty states: no transactions, no budgets, no vendors — endpoints return gracefully
- Concurrent imports: transaction ID deduplication under simultaneous CSV uploads
- Large datasets: 5000+ transactions don't cause timeout or memory issues
- Malformed input: bad CSV data, missing fields, non-numeric amounts

### Frontend — Component Behavior

The frontend is complex with keyboard shortcuts, selection state, filter persistence, virtualized scrolling, and undo flows. Manual testing misses regressions.

**Priority 1 — DataTable:**
- Renders with mock transaction data
- Filtering: text search, boolean pills (vendor/category/project/institution/tax/status), date range
- Sorting: by column, preserves selection
- Selection: checkbox click, shift-click range, Ctrl+A
- Keyboard: j/k navigation, space select, e open panel, Esc close
- Virtualization: renders only visible rows, scroll works correctly
- CSV export: correct headers, proper escaping, includes institution

**Priority 2 — Mutation flows:**
- TransactionPanel: opens with correct data, saves all fields (including institution), triggers refresh
- BulkEditDialog: captures snapshots (including institution) before save, posts correct update, undo restores all fields
- ImportDialog: accepts CSV, shows results (imported/skipped/suggestions), triggers table refresh
- Analysis TransactionTable: checkboxes, shift-click, search, sort, bulk edit, actions menu all work

**Priority 3 — State management:**
- AccountContext: loads accounts, restores selection from localStorage, handles empty state
- usePersistentState: survives navigation, clears correctly
- Filter state: persists across page navigation within session

**Priority 4 — Report & Analysis:**
- Report aggregations: P&L by project matches expected totals, transfers excluded
- Excel export: correct sheet structure, formulas reference right cells, institution column present
- Analysis drill-downs: category → vendor → transactions, project → category → transactions
- Analysis editing: bulk edit from analysis refreshes the breakdown data

---

## How to Test

### Backend: pytest + httpx

```
tests/
  conftest.py          # Test database setup (SQLite in-memory or test PostgreSQL)
  test_accounts.py     # Account CRUD + cascade
  test_transactions.py # Transaction CRUD + bulk + restore
  test_import.py       # CSV import + deduplication + institution detection
  test_budgets.py      # Budget CRUD + status
  test_vendors.py      # Vendor info + rule rebuild + confidence
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
- `wells_fargo_csv`: bytes of a valid Wells Fargo CSV
- `redwood_csv`: bytes of a valid Redwood CU CSV

**Privacy:** Test fixtures should use obviously fake data ("Test Vendor", $100.00, "Test Category"). Never copy real transaction data into test files.

**Import tests should verify:**
- Wells Fargo CSV → institution = "Wells Fargo"
- Redwood CU CSV → institution = "Redwood Credit Union"
- Unknown format → appropriate error
- Duplicate rows → skipped count correct
- Malformed rows → skipped, not crashed

### Frontend: Vitest + React Testing Library

```
components/
  __tests__/
    data-table.test.tsx
    transaction-panel.test.tsx
    bulk-edit-dialog.test.tsx
    import-dialog.test.tsx
    account-context.test.tsx
    analysis-transaction-table.test.tsx
```

**Mocking:** Mock `@/lib/api` to return controlled responses. Mock `useAccount()` to provide test account data. Mock `sonner` toast to verify notification behavior.

**Key assertions:**
- Renders without crashing (baseline for every component)
- Correct data appears in the DOM after API response
- User interactions (click, type, keyboard) trigger expected behavior
- Error states show appropriate feedback
- Virtualized table renders correct subset of rows

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
| Business logic (confidence, dedup, stats, import detection) | 100% | These are the calculations that matter most |
| Frontend components | 70%+ | Cover critical paths; full coverage is diminishing returns |
| E2E flows | 0% for now | Add after unit/integration tests are solid |

---

## Known Issues to Test Against

These are bugs or risks identified in code review that tests should specifically cover:

| Issue | Test |
|-------|------|
| Transaction ID race condition under concurrent imports | Two imports of overlapping CSVs should not produce duplicate IDs |
| Float precision in currency aggregation | Stats totals over 1000+ transactions should match Decimal-precision calculation |
| Uncategorized transactions in category breakdown | `/stats/category_breakdown` returns "(Uncategorized)" row |
| Institution auto-detection | Wells Fargo (no header) vs Redwood CU (header row) correctly identified |
| Bulk restore preserves institution field | Undo after bulk edit restores institution to original value |
| Analysis drill-down into uncategorized | Project → "(Uncategorized)" fetches `has_category=false` transactions |

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
