import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List, Optional
from sqlalchemy import func
from datetime import date
from collections import defaultdict, Counter

from src.database import SessionLocal, engine
from src.models import Base, Transaction, Budget, Account, VendorInfo, Property, Tenant, ImportSuggestion
from src.schemas import (
    TransactionResponse, TransactionUpdate, TransactionBulkUpdate, TransactionRestore,
    BudgetCreate, BudgetUpdate, BudgetResponse, BudgetStatus,
    AccountCreate, AccountResponse,
    VendorInfoCreate, VendorInfoUpdate, VendorInfoResponse,
    PropertyCreate, PropertyUpdate, PropertyResponse,
    TenantCreate, TenantUpdate, TenantResponse,
    ImportSuggestionResponse, SuggestionApproveBody,
)
from src.importer import import_csv_content, extract_description_patterns
from src import watcher

logging.basicConfig(level=logging.INFO)

Base.metadata.create_all(bind=engine)


@asynccontextmanager
async def lifespan(app: FastAPI):
    watcher.start_watcher()
    yield
    watcher.stop_watcher()


app = FastAPI(title="Finance API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ── Helpers ────────────────────────────────────────────────────────────────

def apply_date_filter(query, date_from: Optional[date], date_to: Optional[date]):
    if date_from:
        query = query.filter(Transaction.transaction_date >= date_from)
    if date_to:
        query = query.filter(Transaction.transaction_date <= date_to)
    return query


# ── Core routes ────────────────────────────────────────────────────────────

@app.get("/")
def read_root():
    return {"status": "ok", "message": "Finance API is running"}


# ── Watcher ───────────────────────────────────────────────────────────────

@app.get("/watcher/status")
def watcher_status():
    return watcher.get_status()


@app.get("/watcher/log")
def watcher_log(limit: int = Query(20, ge=1, le=100)):
    return watcher.get_log(limit)


# ── Account CRUD ───────────────────────────────────────────────────────────

@app.get("/accounts", response_model=List[AccountResponse])
def list_accounts(db: Session = Depends(get_db)):
    return db.query(Account).order_by(Account.name).all()


@app.post("/accounts", response_model=AccountResponse)
def create_account(payload: AccountCreate, db: Session = Depends(get_db)):
    existing = db.query(Account).filter(Account.name == payload.name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Account with this name already exists")
    account = Account(name=payload.name)
    db.add(account)
    db.commit()
    db.refresh(account)
    return account


@app.put("/accounts/{account_id}", response_model=AccountResponse)
def rename_account(account_id: int, payload: AccountCreate, db: Session = Depends(get_db)):
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    account.name = payload.name
    db.commit()
    db.refresh(account)
    return account


@app.delete("/accounts/{account_id}")
def delete_account(account_id: int, db: Session = Depends(get_db)):
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    db.delete(account)
    db.commit()
    return {"message": "Account deleted"}


# ── Transactions ───────────────────────────────────────────────────────────

@app.get("/transactions", response_model=List[TransactionResponse])
def get_transactions(
    account_id: int = Query(...),
    skip: int = 0,
    limit: Optional[int] = None,
    cleaned: Optional[bool] = None,
    search: Optional[str] = None,
    has_vendor: Optional[bool] = None,
    has_category: Optional[bool] = None,
    has_project: Optional[bool] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    vendor: Optional[str] = None,
    category: Optional[str] = None,
    project: Optional[str] = None,
    db: Session = Depends(get_db),
):
    query = db.query(Transaction).filter(Transaction.account_id == account_id)

    if cleaned is not None:
        query = query.filter(Transaction.is_cleaned == cleaned)
    if search:
        s = f"%{search}%"
        query = query.filter(
            Transaction.description.ilike(s) |
            Transaction.vendor.ilike(s) |
            Transaction.notes.ilike(s)
        )
    if has_vendor is True:
        query = query.filter(Transaction.vendor != None)
    elif has_vendor is False:
        query = query.filter(Transaction.vendor == None)
    if has_category is True:
        query = query.filter(Transaction.category != None)
    elif has_category is False:
        query = query.filter(Transaction.category == None)
    if has_project is True:
        query = query.filter(Transaction.project != None)
    elif has_project is False:
        query = query.filter(Transaction.project == None)
    if vendor:
        query = query.filter(Transaction.vendor == vendor)
    if category:
        query = query.filter(Transaction.category == category)
    if project:
        query = query.filter(Transaction.project == project)

    query = apply_date_filter(query, date_from, date_to)
    query = query.order_by(Transaction.transaction_date.desc()).offset(skip)
    if limit is not None:
        query = query.limit(limit)
    return query.all()


@app.put("/transactions/{tx_id}", response_model=TransactionResponse)
def update_transaction(tx_id: str, update_data: TransactionUpdate, db: Session = Depends(get_db)):
    tx = db.query(Transaction).filter(Transaction.id == tx_id).first()
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")

    update_dict = update_data.model_dump(exclude_unset=True)

    # ── Correction tracking ─────────────────────────────────────────────────
    # If this transaction was auto-categorized and the user changes the vendor,
    # that is a correction — penalise the old vendor's confidence score.
    if tx.auto_categorized and "vendor" in update_dict:
        old_vendor = tx.vendor
        new_vendor = update_dict["vendor"]
        if old_vendor and new_vendor != old_vendor:
            vi = db.query(VendorInfo).filter(
                VendorInfo.account_id == tx.account_id,
                VendorInfo.vendor_name == old_vendor,
            ).first()
            if vi and vi.rules:
                rules            = dict(vi.rules)
                corrected        = rules.get("corrected_count", 0) + 1
                assigned         = rules.get("assigned_count", 1)
                confidence       = round(1.0 - (corrected / max(assigned, 1)), 4)
                rules["corrected_count"] = corrected
                rules["confidence"]      = confidence
                if confidence < 0.70:
                    rules["enabled"] = False
                vi.rules = rules

    # Once a user manually touches vendor/category/project, clear the auto flag
    if tx.auto_categorized and any(k in update_dict for k in ("vendor", "category", "project")):
        tx.auto_categorized = False

    for field in ("category", "vendor", "project", "notes", "tags", "tax_deductible", "is_transfer", "is_cleaned"):
        val = getattr(update_data, field)
        if val is not None:
            setattr(tx, field, val)

    db.commit()
    db.refresh(tx)
    return tx


@app.patch("/transactions/bulk")
def bulk_update_transactions(
    payload: TransactionBulkUpdate,
    account_id: int = Query(...),
    db: Session = Depends(get_db),
):
    update_data = payload.update_data.model_dump(exclude_unset=True)
    if not update_data:
        return {"message": "No changes provided"}
    db.query(Transaction).filter(
        Transaction.id.in_(payload.ids),
        Transaction.account_id == account_id,
    ).update(update_data, synchronize_session=False)
    db.commit()
    return {"message": f"Updated {len(payload.ids)} transactions"}


@app.get("/facets")
def get_facets(account_id: int = Query(...), db: Session = Depends(get_db)):
    categories = (
        db.query(Transaction.category)
        .distinct()
        .filter(Transaction.account_id == account_id, Transaction.category != None)
        .all()
    )
    vendors = (
        db.query(Transaction.vendor)
        .distinct()
        .filter(Transaction.account_id == account_id, Transaction.vendor != None)
        .all()
    )
    projects = (
        db.query(Transaction.project)
        .distinct()
        .filter(Transaction.account_id == account_id, Transaction.project != None)
        .all()
    )
    return {
        "categories": sorted([c[0] for c in categories if c[0]]),
        "vendors":    sorted([v[0] for v in vendors    if v[0]]),
        "projects":   sorted([p[0] for p in projects   if p[0]]),
    }


# ── Import ─────────────────────────────────────────────────────────────────

@app.post("/import/csv")
async def import_csv(
    account_id: int = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="File must be a .csv")
    # Verify account exists
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    content = await file.read()
    try:
        result = import_csv_content(content, file.filename, db, account_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return result


# ── Import Suggestions ─────────────────────────────────────────────────────

@app.get("/suggestions", response_model=List[ImportSuggestionResponse])
def list_suggestions(account_id: int = Query(...), db: Session = Depends(get_db)):
    rows = (
        db.query(ImportSuggestion)
        .filter(ImportSuggestion.account_id == account_id, ImportSuggestion.status == "pending")
        .order_by(ImportSuggestion.created_at.desc())
        .all()
    )
    result = []
    for s in rows:
        tx_ids = s.transaction_ids or []
        samples = []
        if tx_ids:
            sample_txs = (
                db.query(Transaction.description)
                .filter(Transaction.id.in_(tx_ids[:5]))
                .all()
            )
            samples = [t.description for t in sample_txs]
        result.append(ImportSuggestionResponse(
            id=s.id,
            account_id=s.account_id,
            vendor_info_id=s.vendor_info_id,
            suggested_vendor=s.suggested_vendor,
            suggested_category=s.suggested_category,
            suggested_project=s.suggested_project,
            pattern_matched=s.pattern_matched,
            transaction_ids=tx_ids,
            transaction_count=len(tx_ids),
            sample_descriptions=samples,
            status=s.status,
            created_at=s.created_at,
        ))
    return result


@app.post("/suggestions/{suggestion_id}/approve")
def approve_suggestion(
    suggestion_id: int,
    body: SuggestionApproveBody = None,
    db: Session = Depends(get_db),
):
    s = db.query(ImportSuggestion).filter(ImportSuggestion.id == suggestion_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    if s.status != "pending":
        raise HTTPException(status_code=400, detail="Suggestion already processed")

    vendor   = (body.vendor   if body and body.vendor   else None) or s.suggested_vendor
    category = (body.category if body and body.category else None) or s.suggested_category
    project  = (body.project  if body and body.project  else None) or s.suggested_project

    tx_ids = s.transaction_ids or []
    update_data = {}
    if vendor:
        update_data["vendor"] = vendor
    if category:
        update_data["category"] = category
    if project:
        update_data["project"] = project
    update_data["auto_categorized"] = True

    if tx_ids and update_data:
        db.query(Transaction).filter(Transaction.id.in_(tx_ids)).update(
            update_data, synchronize_session=False
        )

    # Increment assigned_count on the vendor
    if s.vendor_info_id:
        vi = db.query(VendorInfo).filter(VendorInfo.id == s.vendor_info_id).first()
        if vi and vi.rules:
            rules = dict(vi.rules)
            rules["assigned_count"] = rules.get("assigned_count", 0) + len(tx_ids)
            vi.rules = rules

    s.status = "approved"
    db.commit()
    return {"message": f"Applied to {len(tx_ids)} transactions"}


@app.post("/suggestions/{suggestion_id}/dismiss")
def dismiss_suggestion(suggestion_id: int, db: Session = Depends(get_db)):
    s = db.query(ImportSuggestion).filter(ImportSuggestion.id == suggestion_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    if s.status != "pending":
        raise HTTPException(status_code=400, detail="Suggestion already processed")
    s.status = "dismissed"
    db.commit()
    return {"message": "Suggestion dismissed"}


@app.post("/suggestions/approve-all")
def approve_all_suggestions(account_id: int = Query(...), db: Session = Depends(get_db)):
    pending = (
        db.query(ImportSuggestion)
        .filter(ImportSuggestion.account_id == account_id, ImportSuggestion.status == "pending")
        .all()
    )
    total_txs = 0
    for s in pending:
        tx_ids = s.transaction_ids or []
        update_data = {}
        if s.suggested_vendor:
            update_data["vendor"] = s.suggested_vendor
        if s.suggested_category:
            update_data["category"] = s.suggested_category
        if s.suggested_project:
            update_data["project"] = s.suggested_project
        update_data["auto_categorized"] = True

        if tx_ids and update_data:
            db.query(Transaction).filter(Transaction.id.in_(tx_ids)).update(
                update_data, synchronize_session=False
            )
            total_txs += len(tx_ids)

        if s.vendor_info_id:
            vi = db.query(VendorInfo).filter(VendorInfo.id == s.vendor_info_id).first()
            if vi and vi.rules:
                rules = dict(vi.rules)
                rules["assigned_count"] = rules.get("assigned_count", 0) + len(tx_ids)
                vi.rules = rules

        s.status = "approved"

    db.commit()
    return {"message": f"Approved {len(pending)} suggestions, updated {total_txs} transactions"}


# ── Suggest ────────────────────────────────────────────────────────────────

@app.get("/transactions/{tx_id}/suggest")
def suggest_categorization(tx_id: str, db: Session = Depends(get_db)):
    tx = db.query(Transaction).filter(Transaction.id == tx_id).first()
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")

    # Match on first 30 chars of description — enough to identify the merchant
    prefix = (tx.description or "")[:30]
    similar = db.query(Transaction).filter(
        Transaction.id != tx_id,
        Transaction.description.ilike(f"%{prefix}%"),
        Transaction.vendor != None,
    ).limit(30).all()

    if not similar:
        return {"vendor": None, "category": None}

    best = Counter((t.vendor, t.category) for t in similar if t.vendor).most_common(1)
    if not best:
        return {"vendor": None, "category": None}

    vendor, category = best[0][0]
    return {"vendor": vendor, "category": category}


# ── Stats ──────────────────────────────────────────────────────────────────

@app.get("/stats/category_breakdown")
def get_category_breakdown(
    account_id: int = Query(...),
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    project: Optional[str] = None,
    db: Session = Depends(get_db),
):
    query = db.query(Transaction.category, func.sum(Transaction.amount)).filter(
        Transaction.account_id == account_id,
        Transaction.category != None,
    )
    if project == "__none__":
        query = query.filter(Transaction.project == None)
    elif project is not None:
        query = query.filter(Transaction.project == project)
    query = apply_date_filter(query, date_from, date_to)
    results = query.group_by(Transaction.category).all()
    return [{"category": r[0], "total": round(float(r[1]), 2)} for r in results]


@app.get("/stats/project_breakdown")
def get_project_breakdown(
    account_id: int = Query(...),
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    db: Session = Depends(get_db),
):
    query = db.query(Transaction.project, Transaction.amount).filter(
        Transaction.account_id == account_id
    )
    query = apply_date_filter(query, date_from, date_to)
    rows = query.all()

    proj_map: dict = defaultdict(lambda: {"income": 0.0, "expenses": 0.0, "count": 0})
    for row in rows:
        amount = float(row.amount)
        key = row.project  # None = unassigned
        if amount > 0:
            proj_map[key]["income"] += amount
        else:
            proj_map[key]["expenses"] += abs(amount)
        proj_map[key]["count"] += 1

    return [
        {
            "project":  key,
            "income":   round(v["income"],   2),
            "expenses": round(v["expenses"], 2),
            "count":    v["count"],
        }
        for key, v in proj_map.items()
    ]


@app.get("/stats/summary")
def get_summary(
    account_id: int = Query(...),
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    db: Session = Depends(get_db),
):
    query = db.query(Transaction.amount, Transaction.tax_deductible, Transaction.is_cleaned).filter(
        Transaction.account_id == account_id
    )
    query = apply_date_filter(query, date_from, date_to)
    rows = query.all()

    total_income   = sum(float(r.amount) for r in rows if float(r.amount) > 0)
    total_expenses = sum(float(r.amount) for r in rows if float(r.amount) < 0)
    tax_ded_total  = sum(float(r.amount) for r in rows if r.tax_deductible)
    tax_ded_count  = sum(1 for r in rows if r.tax_deductible)
    uncategorized  = sum(1 for r in rows if not r.is_cleaned)

    return {
        "total_income":         round(total_income, 2),
        "total_expenses":       round(abs(total_expenses), 2),
        "net":                  round(total_income + total_expenses, 2),
        "transaction_count":    len(rows),
        "uncategorized_count":  uncategorized,
        "tax_deductible_total": round(abs(tax_ded_total), 2),
        "tax_deductible_count": tax_ded_count,
    }


@app.get("/stats/monthly")
def get_monthly_stats(
    account_id: int = Query(...),
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    db: Session = Depends(get_db),
):
    query = db.query(Transaction.transaction_date, Transaction.amount).filter(
        Transaction.account_id == account_id
    )
    query = apply_date_filter(query, date_from, date_to)
    rows = query.all()

    monthly: dict = defaultdict(lambda: {"income": 0.0, "expenses": 0.0})
    for row in rows:
        month  = row.transaction_date.strftime("%Y-%m")
        amount = float(row.amount)
        if amount > 0:
            monthly[month]["income"]   += amount
        else:
            monthly[month]["expenses"] += abs(amount)

    return [
        {"month": m, "income": round(monthly[m]["income"], 2), "expenses": round(monthly[m]["expenses"], 2)}
        for m in sorted(monthly.keys())
    ]


@app.get("/stats/top_vendors")
def get_top_vendors(
    account_id: int = Query(...),
    limit: int = 15,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    category: Optional[str] = None,
    db: Session = Depends(get_db),
):
    query = db.query(Transaction.vendor, Transaction.amount).filter(
        Transaction.account_id == account_id,
        Transaction.vendor != None,
    )
    if category:
        query = query.filter(Transaction.category == category)
    query = apply_date_filter(query, date_from, date_to)
    rows = query.all()

    totals: dict = defaultdict(lambda: {"total": 0.0, "count": 0})
    for row in rows:
        totals[row.vendor]["total"] += float(row.amount)  # signed net
        totals[row.vendor]["count"] += 1

    # Positives (income) first high→low, then negatives (expense) largest→smallest
    ranked = sorted(
        totals.items(),
        key=lambda x: (x[1]["total"] < 0, -abs(x[1]["total"]))
    )[:limit]
    return [{"vendor": v, "total": round(d["total"], 2), "count": d["count"]} for v, d in ranked]


@app.get("/stats/subscriptions")
def get_subscriptions(
    account_id: int = Query(...),
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    db: Session = Depends(get_db),
):
    query = db.query(Transaction.vendor, Transaction.transaction_date, Transaction.amount).filter(
        Transaction.account_id == account_id,
        Transaction.vendor != None,
        Transaction.amount < 0,
    )
    query = apply_date_filter(query, date_from, date_to)
    rows = query.all()

    vendor_months: dict = defaultdict(lambda: defaultdict(float))
    for row in rows:
        month = row.transaction_date.strftime("%Y-%m")
        vendor_months[row.vendor][month] += abs(float(row.amount))

    subscriptions = []
    for vendor, months_data in vendor_months.items():
        if len(months_data) < 2:
            continue
        totals      = list(months_data.values())
        avg_monthly = sum(totals) / len(totals)
        likely = avg_monthly > 0 and all(
            abs(t - avg_monthly) / avg_monthly < 0.30 for t in totals
        )
        subscriptions.append({
            "vendor":              vendor,
            "months_active":       len(months_data),
            "avg_monthly":         round(avg_monthly, 2),
            "total_spent":         round(sum(totals), 2),
            "likely_subscription": likely,
        })

    subscriptions.sort(key=lambda x: (-x["months_active"], -x["avg_monthly"]))
    return subscriptions


# ── Bulk restore (undo) ─────────────────────────────────────────────────────

@app.post("/transactions/bulk-restore")
def bulk_restore_transactions(snapshots: List[TransactionRestore], db: Session = Depends(get_db)):
    ids = [s.id for s in snapshots]
    txs = {tx.id: tx for tx in db.query(Transaction).filter(Transaction.id.in_(ids)).all()}
    for snap in snapshots:
        tx = txs.get(snap.id)
        if not tx:
            continue
        tx.vendor          = snap.vendor
        tx.category        = snap.category
        tx.project         = snap.project
        tx.notes           = snap.notes
        tx.tags            = snap.tags
        tx.tax_deductible  = snap.tax_deductible
        tx.is_transfer     = snap.is_transfer
        tx.is_cleaned      = snap.is_cleaned
    db.commit()
    return {"message": f"Restored {len(snapshots)} transactions"}


# ── Budget CRUD ─────────────────────────────────────────────────────────────

@app.get("/budgets", response_model=List[BudgetResponse])
def list_budgets(account_id: int = Query(...), db: Session = Depends(get_db)):
    return db.query(Budget).filter(Budget.account_id == account_id).order_by(Budget.category).all()


@app.post("/budgets", response_model=BudgetResponse)
def create_budget(
    payload: BudgetCreate,
    account_id: int = Query(...),
    db: Session = Depends(get_db),
):
    existing = db.query(Budget).filter(
        Budget.account_id == account_id,
        Budget.category == payload.category,
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Budget for this category already exists")
    budget = Budget(account_id=account_id, category=payload.category, monthly_limit=payload.monthly_limit)
    db.add(budget)
    db.commit()
    db.refresh(budget)
    return budget


@app.put("/budgets/{budget_id}", response_model=BudgetResponse)
def update_budget(budget_id: int, payload: BudgetUpdate, db: Session = Depends(get_db)):
    budget = db.query(Budget).filter(Budget.id == budget_id).first()
    if not budget:
        raise HTTPException(status_code=404, detail="Budget not found")
    budget.monthly_limit = payload.monthly_limit
    db.commit()
    db.refresh(budget)
    return budget


@app.delete("/budgets/{budget_id}")
def delete_budget(budget_id: int, db: Session = Depends(get_db)):
    budget = db.query(Budget).filter(Budget.id == budget_id).first()
    if not budget:
        raise HTTPException(status_code=404, detail="Budget not found")
    db.delete(budget)
    db.commit()
    return {"message": "Budget deleted"}


# ── Budget status ───────────────────────────────────────────────────────────

@app.get("/stats/budget_status", response_model=List[BudgetStatus])
def get_budget_status(
    account_id: int = Query(...),
    month: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Return spend vs budget for each budgeted category.
    month: YYYY-MM string; defaults to current calendar month."""
    from datetime import datetime
    if month:
        try:
            year, mon = int(month[:4]), int(month[5:7])
        except (ValueError, IndexError):
            raise HTTPException(status_code=400, detail="month must be YYYY-MM")
    else:
        now  = datetime.now()
        year = now.year
        mon  = now.month

    from calendar import monthrange
    last_day  = monthrange(year, mon)[1]
    start     = date(year, mon, 1)
    end       = date(year, mon, last_day)

    # Actual spend per category (expenses only, negative amounts)
    rows = (
        db.query(Transaction.category, func.sum(Transaction.amount))
        .filter(
            Transaction.account_id == account_id,
            Transaction.category != None,
            Transaction.amount < 0,
            Transaction.transaction_date >= start,
            Transaction.transaction_date <= end,
        )
        .group_by(Transaction.category)
        .all()
    )
    actual: dict = {r[0]: abs(float(r[1])) for r in rows}

    budgets = db.query(Budget).filter(Budget.account_id == account_id).order_by(Budget.category).all()
    result = []
    for b in budgets:
        spent     = actual.get(b.category, 0.0)
        limit     = float(b.monthly_limit)
        remaining = limit - spent
        pct       = round((spent / limit) * 100, 1) if limit > 0 else 0.0
        result.append(BudgetStatus(
            category=b.category,
            monthly_limit=limit,
            actual_spend=round(spent, 2),
            remaining=round(remaining, 2),
            percentage=pct,
        ))
    return result


# ── Vendor Info ──────────────────────────────────────────────────────────────

@app.get("/vendor-info", response_model=List[VendorInfoResponse])
def list_vendor_info(account_id: int = Query(...), db: Session = Depends(get_db)):
    return (
        db.query(VendorInfo)
        .filter(VendorInfo.account_id == account_id)
        .order_by(VendorInfo.trade_category, VendorInfo.vendor_name)
        .all()
    )


@app.post("/vendor-info", response_model=VendorInfoResponse)
def create_vendor_info(payload: VendorInfoCreate, account_id: int = Query(...), db: Session = Depends(get_db)):
    existing = db.query(VendorInfo).filter(
        VendorInfo.account_id == account_id,
        VendorInfo.vendor_name == payload.vendor_name,
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Vendor with this name already exists")
    vendor = VendorInfo(account_id=account_id, **payload.model_dump())
    db.add(vendor)
    db.commit()
    db.refresh(vendor)
    return vendor


@app.put("/vendor-info/{vid}", response_model=VendorInfoResponse)
def update_vendor_info(vid: int, payload: VendorInfoUpdate, db: Session = Depends(get_db)):
    vendor = db.query(VendorInfo).filter(VendorInfo.id == vid).first()
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(vendor, field, value)
    db.commit()
    db.refresh(vendor)
    return vendor


@app.delete("/vendor-info/{vid}")
def delete_vendor_info(vid: int, db: Session = Depends(get_db)):
    vendor = db.query(VendorInfo).filter(VendorInfo.id == vid).first()
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    db.delete(vendor)
    db.commit()
    return {"message": "Vendor deleted"}


@app.post("/vendor-info/rebuild-rules")
def rebuild_vendor_rules(account_id: int = Query(...), db: Session = Depends(get_db)):
    """
    Scan all transactions assigned to each vendor and (re)build the auto-assign
    rules: description patterns, default category/project, and confidence stats.
    Existing corrected_count / enabled overrides are preserved across rebuilds.
    """
    from collections import Counter

    vendors = db.query(VendorInfo).filter(VendorInfo.account_id == account_id).all()
    txs     = (
        db.query(Transaction)
        .filter(Transaction.account_id == account_id, Transaction.vendor != None)
        .all()
    )

    # Group transactions by vendor name
    vendor_txs: dict = defaultdict(list)
    for tx in txs:
        vendor_txs[tx.vendor].append(tx)

    updated = 0
    for vi in vendors:
        vtxs = vendor_txs.get(vi.vendor_name, [])
        if not vtxs:
            continue  # no history yet — leave rules as-is

        # Extract patterns from every assigned description, deduplicate
        pattern_set: set[str] = set()
        for tx in vtxs:
            pattern_set.update(extract_description_patterns(tx.description))

        cat_counter  = Counter(tx.category for tx in vtxs if tx.category)
        proj_counter = Counter(tx.project  for tx in vtxs if tx.project)

        default_category = cat_counter.most_common(1)[0][0]  if cat_counter  else None
        default_project  = proj_counter.most_common(1)[0][0] if proj_counter else None

        # Sign-aware: learn separate rules for income (>=0) vs expense (<0)
        pos_txs = [tx for tx in vtxs if float(tx.amount or 0) >= 0]
        neg_txs = [tx for tx in vtxs if float(tx.amount or 0) <  0]
        by_sign = None
        if pos_txs and neg_txs:
            ic_top  = Counter(tx.category for tx in pos_txs if tx.category).most_common(1)
            ip_top  = Counter(tx.project  for tx in pos_txs if tx.project ).most_common(1)
            ec_top  = Counter(tx.category for tx in neg_txs if tx.category).most_common(1)
            ep_top  = Counter(tx.project  for tx in neg_txs if tx.project ).most_common(1)
            ic = ic_top[0][0] if ic_top else default_category
            ip = ip_top[0][0] if ip_top else default_project
            ec = ec_top[0][0] if ec_top else default_category
            ep = ep_top[0][0] if ep_top else default_project
            if ic != ec or ip != ep:
                by_sign = {
                    "income":  {"category": ic, "project": ip},
                    "expense": {"category": ec, "project": ep},
                }

        # Preserve correction/confidence history across rebuilds
        existing       = vi.rules or {}
        corrected      = existing.get("corrected_count", 0)
        # assigned_count = historical transaction count (reset on rebuild)
        assigned       = len(vtxs)
        confidence     = round(1.0 - (corrected / max(assigned, 1)), 4)
        # Only auto-disable on rebuild if confidence is very low; let the user re-enable
        was_disabled   = existing.get("enabled") is False
        enabled        = (not was_disabled) and confidence >= 0.70

        vi.rules = {
            "patterns":         sorted(pattern_set),
            "default_category": default_category,
            "default_project":  default_project,
            "by_sign":          by_sign,
            "enabled":          enabled,
            "assigned_count":   assigned,
            "corrected_count":  corrected,
            "confidence":       confidence,
        }
        updated += 1

    # ── Ambiguity cleanup ────────────────────────────────────────────────────
    # Patterns shared by multiple vendors are unreliable as sole identifiers.
    # For each contested pattern, only the vendor with the highest assigned_count
    # keeps it; the others have it stripped.
    pattern_owners: dict = defaultdict(list)  # pattern → [(assigned_count, vendor)]
    for vi in vendors:
        if not vi.rules:
            continue
        for p in vi.rules.get("patterns", []):
            pattern_owners[p].append((vi.rules.get("assigned_count", 0), vi))

    for p, owner_list in pattern_owners.items():
        if len(owner_list) <= 1:
            continue
        # Sort by assigned_count descending; winner keeps the pattern
        owner_list.sort(key=lambda x: -x[0])
        for _, vi in owner_list[1:]:
            rules = dict(vi.rules)
            rules["patterns"] = [x for x in rules["patterns"] if x != p]
            vi.rules = rules

    db.commit()
    return {"updated": updated, "ambiguous_patterns_resolved": sum(
        1 for owners in pattern_owners.values() if len(owners) > 1
    )}


@app.post("/vendor-info/import-from-transactions")
def import_vendors_from_transactions(account_id: int = Query(...), db: Session = Depends(get_db)):
    distinct_vendors = (
        db.query(Transaction.vendor)
        .distinct()
        .filter(Transaction.account_id == account_id, Transaction.vendor != None)
        .all()
    )
    created = 0
    already_existed = 0
    for (vendor_name,) in distinct_vendors:
        if not vendor_name:
            continue
        existing = db.query(VendorInfo).filter(
            VendorInfo.account_id == account_id,
            VendorInfo.vendor_name == vendor_name,
        ).first()
        if existing:
            already_existed += 1
        else:
            db.add(VendorInfo(account_id=account_id, vendor_name=vendor_name))
            created += 1
    db.commit()
    return {"created": created, "already_existed": already_existed}


# ── Properties ───────────────────────────────────────────────────────────────

@app.get("/properties", response_model=List[PropertyResponse])
def list_properties(account_id: int = Query(...), db: Session = Depends(get_db)):
    props = db.query(Property).filter(Property.account_id == account_id).order_by(Property.project_name).all()
    result = []
    for prop in props:
        tenants = db.query(Tenant).filter(Tenant.property_id == prop.id).order_by(Tenant.name).all()
        result.append(PropertyResponse(
            id=prop.id,
            account_id=prop.account_id,
            project_name=prop.project_name,
            address=prop.address,
            notes=prop.notes,
            tenants=[TenantResponse(
                id=t.id,
                property_id=t.property_id,
                name=t.name,
                phone=t.phone,
                email=t.email,
                lease_start=t.lease_start,
                lease_end=t.lease_end,
                monthly_rent=float(t.monthly_rent) if t.monthly_rent is not None else None,
                notes=t.notes,
            ) for t in tenants],
        ))
    return result


@app.post("/properties", response_model=PropertyResponse)
def create_property(payload: PropertyCreate, account_id: int = Query(...), db: Session = Depends(get_db)):
    existing = db.query(Property).filter(
        Property.account_id == account_id,
        Property.project_name == payload.project_name,
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Property with this name already exists")
    prop = Property(account_id=account_id, **payload.model_dump())
    db.add(prop)
    db.commit()
    db.refresh(prop)
    return PropertyResponse(
        id=prop.id,
        account_id=prop.account_id,
        project_name=prop.project_name,
        address=prop.address,
        notes=prop.notes,
        tenants=[],
    )


@app.put("/properties/{pid}", response_model=PropertyResponse)
def update_property(pid: int, payload: PropertyUpdate, db: Session = Depends(get_db)):
    prop = db.query(Property).filter(Property.id == pid).first()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(prop, field, value)
    db.commit()
    db.refresh(prop)
    tenants = db.query(Tenant).filter(Tenant.property_id == prop.id).order_by(Tenant.name).all()
    return PropertyResponse(
        id=prop.id,
        account_id=prop.account_id,
        project_name=prop.project_name,
        address=prop.address,
        notes=prop.notes,
        tenants=[TenantResponse(
            id=t.id,
            property_id=t.property_id,
            name=t.name,
            phone=t.phone,
            email=t.email,
            lease_start=t.lease_start,
            lease_end=t.lease_end,
            monthly_rent=float(t.monthly_rent) if t.monthly_rent is not None else None,
            notes=t.notes,
        ) for t in tenants],
    )


@app.delete("/properties/{pid}")
def delete_property(pid: int, db: Session = Depends(get_db)):
    prop = db.query(Property).filter(Property.id == pid).first()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    db.delete(prop)
    db.commit()
    return {"message": "Property deleted"}


# ── Tenants ──────────────────────────────────────────────────────────────────

@app.post("/properties/{pid}/tenants", response_model=TenantResponse)
def create_tenant(pid: int, payload: TenantCreate, db: Session = Depends(get_db)):
    prop = db.query(Property).filter(Property.id == pid).first()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    tenant = Tenant(property_id=pid, **payload.model_dump())
    db.add(tenant)
    db.commit()
    db.refresh(tenant)
    return tenant


@app.put("/tenants/{tid}", response_model=TenantResponse)
def update_tenant(tid: int, payload: TenantUpdate, db: Session = Depends(get_db)):
    tenant = db.query(Tenant).filter(Tenant.id == tid).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(tenant, field, value)
    db.commit()
    db.refresh(tenant)
    return tenant


@app.delete("/tenants/{tid}")
def delete_tenant(tid: int, db: Session = Depends(get_db)):
    tenant = db.query(Tenant).filter(Tenant.id == tid).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    db.delete(tenant)
    db.commit()
    return {"message": "Tenant deleted"}
