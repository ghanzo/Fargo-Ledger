# Debug Log — Fargo Ledger

**Last Updated:** 2026-03-03

A running journal of issues found, how they were diagnosed, and what was done. Entries are newest-first. This helps both the developer and LLM agents understand the project's pain points and avoid repeating past mistakes.

---

## Format

Each entry follows this pattern:
- **What:** What was observed
- **Where:** File/endpoint/component affected
- **Cause:** Root cause once identified
- **Fix:** What was done (or what needs to be done)
- **Status:** Fixed / Open / Workaround

---

## 2026-03-03 — Phase 0 Stabilization

### N+1 Query in list_properties
- **What:** Each property in the list triggered a separate SQL query to fetch its tenants
- **Where:** `src/api.py` GET `/properties`
- **Cause:** Manual loop: `db.query(Tenant).filter(Tenant.property_id == prop.id)` inside a for-each-property loop
- **Fix:** Added `relationship()` to Property model, used `joinedload(Property.tenants)` for single-query eager loading, sorted tenants in Python
- **Status:** Fixed

### Hardcoded API URLs across frontend
- **What:** Every frontend file had `http://localhost:8001` hardcoded in axios calls — made deployment impossible without find-and-replace
- **Where:** 15+ frontend files
- **Cause:** No centralized API client; each file imported axios directly and constructed its own URLs
- **Fix:** Created `frontend/lib/api.ts` with axios instance using `NEXT_PUBLIC_API_URL` env var. Migrated all files to use `api.get/post/put/patch/delete` with relative paths
- **Status:** Fixed

### CORS only allowed localhost:3000
- **What:** API would reject requests from any origin other than `http://localhost:3000`
- **Where:** `src/api.py` CORS middleware
- **Cause:** Hardcoded `allow_origins=["http://localhost:3000"]`
- **Fix:** Now reads from `CORS_ORIGINS` environment variable (comma-separated), defaults to `http://localhost:3000`
- **Status:** Fixed

### No audit trail on transactions
- **What:** No way to know when a transaction was imported or last modified
- **Where:** `src/models.py` Transaction model
- **Cause:** `created_at` and `updated_at` columns were never added
- **Fix:** Added both columns with `default=func.now()` and `onupdate=func.now()`. Ran `ALTER TABLE` to add to existing data
- **Status:** Fixed

### Dead code: edit-transaction-dialog.tsx
- **What:** Component file existed but was imported nowhere
- **Where:** `frontend/components/edit-transaction-dialog.tsx`
- **Cause:** Replaced by `transaction-panel.tsx` but never deleted
- **Fix:** Deleted the file and 5 unused Next.js template SVGs
- **Status:** Fixed

### Magic numbers scattered in api.py
- **What:** Confidence threshold `0.70` appeared in two places, subscription tolerance `0.30` was unexplained, suggest function used `30` for prefix length
- **Where:** `src/api.py` lines 208, 879, 624, 433, 438
- **Cause:** Values were written inline as the features were developed
- **Fix:** Imported `_CONFIDENCE_ASSIGN_THRESHOLD` from importer.py, added `_SUBSCRIPTION_TOLERANCE` module constant, added local `_PREFIX_LEN` and `_MAX_SIMILAR` constants
- **Status:** Fixed

### Unpinned Python dependencies
- **What:** `requirements.txt` had bare package names with no version constraints
- **Where:** `requirements.txt`
- **Cause:** Started as a prototype; never locked versions
- **Fix:** Added compatible-release pins (`~=`) for all 8 packages
- **Status:** Fixed

---

## Known Open Issues

These are documented problems that haven't been fixed yet. They come from [REVIEW.md](../../REVIEW.md).

| # | Issue | Severity | Location | Planned Fix |
|---|-------|----------|----------|-------------|
| 1 | No authentication — all endpoints public | Critical | `src/api.py` | Phase 2.1 |
| 2 | Race condition in transaction ID generation | Critical | `src/importer.py` | Phase 2.2 |
| 3 | N+1 in suggestions endpoint | Moderate | `src/api.py` GET `/suggestions` | Phase 1.5.1 |
| 4 | Float precision for currency in stats | Moderate | `src/api.py` stats | Phase 2.4 |
| 5 | No file upload size limit | Moderate | `src/api.py` import | Phase 2.3 |
| 6 | Hard cascade deletes on accounts | Moderate | `src/models.py` | Phase 2.5 |
| 7 | Stats not cached — full scan per request | Moderate | `src/api.py` `/stats/*` | Phase 1.5.3 |
| 8 | No server-side pagination guard | Moderate | `src/api.py` `/transactions` | Phase 1.5.5 |
| 9 | CSV import only supports Wells Fargo | Moderate | `src/importer.py` | Phase 3 |
| 10 | Zero test coverage | Critical | Entire project | Phase 1 |
| 11 | top_vendors sorts in Python, not SQL | Minor | `src/api.py` | Phase 1.5.2 |
| 12 | Malformed CSV rows silently skipped | Minor | `src/importer.py` | Phase 1.5.4 |
| 13 | No mobile responsive layout | Minor | Frontend | Phase 5.2 |
