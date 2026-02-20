from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List, Optional
from sqlalchemy import func
from datetime import date
from collections import defaultdict, Counter

from src.database import SessionLocal, engine
from src.models import Base, Transaction, Budget, Account
from src.schemas import (
    TransactionResponse, TransactionUpdate, TransactionBulkUpdate, TransactionRestore,
    BudgetCreate, BudgetUpdate, BudgetResponse, BudgetStatus,
    AccountCreate, AccountResponse,
)
from src.importer import import_csv_content

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Finance API")

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

    for field in ("category", "vendor", "project", "notes", "tags", "tax_deductible", "is_cleaned"):
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
