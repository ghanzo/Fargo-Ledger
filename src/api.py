import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional
from sqlalchemy import func
from datetime import date
from collections import defaultdict, Counter

from src.database import SessionLocal, engine
from src.models import Base, Transaction, Budget, Account, VendorInfo, Property, Tenant, ImportSuggestion, CategoryMap, CategoryInfo, ProjectInfo
from src.schemas import (
    TransactionResponse, TransactionUpdate, TransactionBulkUpdate, TransactionRestore,
    BudgetCreate, BudgetUpdate, BudgetResponse, BudgetStatus,
    AccountCreate, AccountResponse,
    VendorInfoCreate, VendorInfoUpdate, VendorInfoResponse,
    PropertyCreate, PropertyUpdate, PropertyResponse,
    TenantCreate, TenantUpdate, TenantResponse,
    ImportSuggestionResponse, SuggestionApproveBody,
    CategoryMapCreate, CategoryMapUpdate, CategoryMapResponse,
    CategoryInfoCreate, CategoryInfoUpdate, CategoryInfoResponse,
    ProjectInfoCreate, ProjectInfoUpdate, ProjectInfoResponse,
)
from src.importer import import_csv_content, extract_description_patterns, find_matching_vendor, _CONFIDENCE_ASSIGN_THRESHOLD
from src import watcher, researcher

logging.basicConfig(level=logging.INFO)

_SUBSCRIPTION_TOLERANCE = 0.30

Base.metadata.create_all(bind=engine)


@asynccontextmanager
async def lifespan(app: FastAPI):
    watcher.start_watcher()
    yield
    watcher.stop_watcher()


app = FastAPI(title="Finance API", lifespan=lifespan)

_cors_origins = [
    o.strip()
    for o in os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(",")
    if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
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
def update_transaction(tx_id: str, update_data: TransactionUpdate, account_id: int = Query(...), db: Session = Depends(get_db)):
    tx = db.query(Transaction).filter(Transaction.id == tx_id, Transaction.account_id == account_id).first()
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
                if confidence < _CONFIDENCE_ASSIGN_THRESHOLD:
                    rules["enabled"] = False
                vi.rules = rules

    # Once a user manually touches vendor/category/project, clear the auto flag
    if tx.auto_categorized and any(k in update_dict for k in ("vendor", "category", "project")):
        tx.auto_categorized = False

    for field in ("category", "vendor", "project", "notes", "tags", "tax_deductible", "is_transfer", "is_cleaned", "institution"):
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
    institutions = (
        db.query(Transaction.institution)
        .distinct()
        .filter(Transaction.account_id == account_id, Transaction.institution != None)
        .all()
    )
    return {
        "categories":   sorted([c[0] for c in categories   if c[0]]),
        "vendors":      sorted([v[0] for v in vendors       if v[0]]),
        "projects":     sorted([p[0] for p in projects      if p[0]]),
        "institutions": sorted([i[0] for i in institutions  if i[0]]),
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
    # Batch-fetch all sample transactions to avoid N+1
    all_sample_ids = []
    for s in rows:
        tx_ids = s.transaction_ids or []
        all_sample_ids.extend(tx_ids[:5])
    tx_map = {}
    if all_sample_ids:
        sample_txs = db.query(Transaction).filter(Transaction.id.in_(all_sample_ids)).all()
        tx_map = {t.id: t for t in sample_txs}

    for s in rows:
        tx_ids = s.transaction_ids or []
        sample_descs = []
        sample_txns = []
        for tid in tx_ids[:5]:
            tx = tx_map.get(tid)
            if tx:
                sample_descs.append(tx.description)
                sample_txns.append({
                    "description": tx.description,
                    "amount": float(tx.amount),
                    "date": str(tx.transaction_date),
                })
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
            sample_descriptions=sample_descs,
            sample_transactions=sample_txns,
            status=s.status,
            created_at=s.created_at,
        ))
    return result


@app.post("/suggestions/{suggestion_id}/approve")
def approve_suggestion(
    suggestion_id: int,
    body: SuggestionApproveBody = None,
    account_id: int = Query(...),
    db: Session = Depends(get_db),
):
    s = db.query(ImportSuggestion).filter(ImportSuggestion.id == suggestion_id, ImportSuggestion.account_id == account_id).first()
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

    # Confirm and update the linked vendor card
    if s.vendor_info_id:
        vi = db.query(VendorInfo).filter(VendorInfo.id == s.vendor_info_id).first()
        if vi:
            # If user edited the vendor name, update the card
            if body and body.vendor and body.vendor != vi.vendor_name:
                # Check no duplicate confirmed card with that name
                existing = (
                    db.query(VendorInfo)
                    .filter(VendorInfo.account_id == s.account_id, VendorInfo.vendor_name == body.vendor, VendorInfo.id != vi.id)
                    .first()
                )
                if not existing:
                    vi.vendor_name = body.vendor

            # Confirm the card (was unconfirmed if LLM-created)
            vi.confirmed = True

            # Update rules with approved category/project
            rules = dict(vi.rules) if vi.rules else {}
            rules["assigned_count"] = rules.get("assigned_count", 0) + len(tx_ids)
            if category:
                rules["default_category"] = category
            if project:
                rules["default_project"] = project
            vi.rules = rules

    s.status = "approved"
    db.commit()
    return {"message": f"Applied to {len(tx_ids)} transactions"}


@app.post("/suggestions/{suggestion_id}/dismiss")
def dismiss_suggestion(suggestion_id: int, account_id: int = Query(...), db: Session = Depends(get_db)):
    s = db.query(ImportSuggestion).filter(ImportSuggestion.id == suggestion_id, ImportSuggestion.account_id == account_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    if s.status != "pending":
        raise HTTPException(status_code=400, detail="Suggestion already processed")

    # Clean up unconfirmed vendor card if no other suggestions reference it
    if s.vendor_info_id:
        vi = db.query(VendorInfo).filter(VendorInfo.id == s.vendor_info_id).first()
        if vi and not vi.confirmed:
            other_refs = (
                db.query(ImportSuggestion)
                .filter(
                    ImportSuggestion.vendor_info_id == vi.id,
                    ImportSuggestion.id != s.id,
                )
                .count()
            )
            if other_refs == 0:
                db.delete(vi)

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
            if vi:
                vi.confirmed = True
                rules = dict(vi.rules) if vi.rules else {}
                rules["assigned_count"] = rules.get("assigned_count", 0) + len(tx_ids)
                if s.suggested_category:
                    rules["default_category"] = s.suggested_category
                if s.suggested_project:
                    rules["default_project"] = s.suggested_project
                vi.rules = rules

        s.status = "approved"

    db.commit()
    return {"message": f"Approved {len(pending)} suggestions, updated {total_txs} transactions"}


# ── Suggest ────────────────────────────────────────────────────────────────

@app.get("/transactions/{tx_id}/suggest")
def suggest_categorization(tx_id: str, account_id: int = Query(...), db: Session = Depends(get_db)):
    tx = db.query(Transaction).filter(Transaction.id == tx_id, Transaction.account_id == account_id).first()
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")

    _PREFIX_LEN = 30
    _MAX_SIMILAR = 30

    # Match on first N chars of description — enough to identify the merchant
    prefix = (tx.description or "")[:_PREFIX_LEN]
    similar = db.query(Transaction).filter(
        Transaction.id != tx_id,
        Transaction.account_id == account_id,
        Transaction.description.ilike(f"%{prefix}%"),
        Transaction.vendor != None,
    ).limit(_MAX_SIMILAR).all()

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
    )
    if project == "__none__":
        query = query.filter(Transaction.project == None)
    elif project is not None:
        query = query.filter(Transaction.project == project)
    query = apply_date_filter(query, date_from, date_to)
    results = query.group_by(Transaction.category).all()
    return [{"category": r[0] or "(Uncategorized)", "total": round(float(r[1]), 2)} for r in results]


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
            abs(t - avg_monthly) / avg_monthly < _SUBSCRIPTION_TOLERANCE for t in totals
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

@app.post("/transactions/by-ids")
def get_transactions_by_ids(ids: List[str], account_id: int = Query(...), db: Session = Depends(get_db)):
    """Fetch transactions by a list of IDs. Returns date, amount, description."""
    txs = db.query(Transaction).filter(Transaction.id.in_(ids), Transaction.account_id == account_id).order_by(Transaction.transaction_date.desc()).all()
    return [
        {"description": tx.description, "amount": float(tx.amount), "date": str(tx.transaction_date)}
        for tx in txs
    ]


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
        tx.institution     = snap.institution
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
def update_budget(budget_id: int, payload: BudgetUpdate, account_id: int = Query(...), db: Session = Depends(get_db)):
    budget = db.query(Budget).filter(Budget.id == budget_id, Budget.account_id == account_id).first()
    if not budget:
        raise HTTPException(status_code=404, detail="Budget not found")
    budget.monthly_limit = payload.monthly_limit
    db.commit()
    db.refresh(budget)
    return budget


@app.delete("/budgets/{budget_id}")
def delete_budget(budget_id: int, account_id: int = Query(...), db: Session = Depends(get_db)):
    budget = db.query(Budget).filter(Budget.id == budget_id, Budget.account_id == account_id).first()
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
def update_vendor_info(vid: int, payload: VendorInfoUpdate, account_id: int = Query(...), db: Session = Depends(get_db)):
    vendor = db.query(VendorInfo).filter(VendorInfo.id == vid, VendorInfo.account_id == account_id).first()
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(vendor, field, value)
    db.commit()
    db.refresh(vendor)
    return vendor


@app.delete("/vendor-info/{vid}")
def delete_vendor_info(vid: int, account_id: int = Query(...), db: Session = Depends(get_db)):
    vendor = db.query(VendorInfo).filter(VendorInfo.id == vid, VendorInfo.account_id == account_id).first()
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    db.delete(vendor)
    db.commit()
    return {"message": "Vendor deleted"}


@app.post("/vendor-info/enrich-all")
async def enrich_all_vendors(account_id: int = Query(...), db: Session = Depends(get_db)):
    """Enrich all vendors that have empty fields using LLM lookup."""
    vendors = db.query(VendorInfo).filter(VendorInfo.account_id == account_id).all()
    enrichable_fields = [
        "business_name", "trade_category", "website", "address",
        "phone", "service_description",
    ]
    updated_count = 0
    for vendor in vendors:
        # Only enrich if at least one enrichable field is empty
        empty_fields = [f for f in enrichable_fields if not getattr(vendor, f)]
        if not empty_fields:
            continue
        # Gather context for LLM
        txs = (
            db.query(Transaction.description, Transaction.category)
            .filter(Transaction.vendor == vendor.vendor_name, Transaction.account_id == account_id)
            .limit(20)
            .all()
        )
        samples = list({t.description for t in txs})[:5] if txs else None
        categories = list({t.category for t in txs if t.category})
        tx_count = db.query(func.count(Transaction.id)).filter(
            Transaction.vendor == vendor.vendor_name, Transaction.account_id == account_id
        ).scalar()
        context = {
            "trade_category": vendor.trade_category,
            "categories_used": categories[:5],
            "transaction_count": tx_count,
        }
        try:
            result = await researcher.enrich_vendor(vendor.vendor_name, sample_descriptions=samples, context=context)
        except (ConnectionError, ValueError) as e:
            raise HTTPException(status_code=503, detail=str(e))
        if not result:
            continue
        changed = False
        for field in enrichable_fields:
            if not getattr(vendor, field) and result.get(field):
                setattr(vendor, field, result[field])
                changed = True
        if changed:
            updated_count += 1
    db.commit()
    return {"updated": updated_count, "total": len(vendors)}


@app.post("/vendor-info/{vid}/clear-enrichment", response_model=VendorInfoResponse)
def clear_vendor_enrichment(vid: int, account_id: int = Query(...), db: Session = Depends(get_db)):
    """Clear all LLM-populated fields on a vendor card so it can be re-enriched."""
    vendor = db.query(VendorInfo).filter(VendorInfo.id == vid, VendorInfo.account_id == account_id).first()
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    for field in ("business_name", "trade_category", "website", "address", "phone",
                  "service_description"):
        setattr(vendor, field, None)
    db.commit()
    db.refresh(vendor)
    return vendor


@app.post("/vendor-info/{vid}/enrich", response_model=VendorInfoResponse)
async def enrich_vendor_info(vid: int, account_id: int = Query(...), db: Session = Depends(get_db)):
    """Enrich a single vendor card using LLM lookup. Only fills NULL fields."""
    vendor = db.query(VendorInfo).filter(VendorInfo.id == vid, VendorInfo.account_id == account_id).first()
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    # Gather context for LLM
    txs = (
        db.query(Transaction.description, Transaction.category)
        .filter(Transaction.vendor == vendor.vendor_name, Transaction.account_id == vendor.account_id)
        .limit(20)
        .all()
    )
    samples = list({t.description for t in txs})[:5] if txs else None
    categories = list({t.category for t in txs if t.category})
    tx_count = db.query(func.count(Transaction.id)).filter(
        Transaction.vendor == vendor.vendor_name, Transaction.account_id == vendor.account_id
    ).scalar()
    context = {
        "trade_category": vendor.trade_category,
        "categories_used": categories[:5],
        "transaction_count": tx_count,
    }
    try:
        result = await researcher.enrich_vendor(vendor.vendor_name, sample_descriptions=samples, context=context)
    except (ConnectionError, ValueError) as e:
        raise HTTPException(status_code=503, detail=str(e))
    if not result:
        raise HTTPException(status_code=422, detail="LLM returned no usable data")
    enrichable_fields = [
        "business_name", "trade_category", "website", "address",
        "phone", "service_description",
    ]
    for field in enrichable_fields:
        if not getattr(vendor, field) and result.get(field):
            setattr(vendor, field, result[field])
    db.commit()
    db.refresh(vendor)
    return vendor


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
        enabled        = (not was_disabled) and confidence >= _CONFIDENCE_ASSIGN_THRESHOLD

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
    props = (
        db.query(Property)
        .options(joinedload(Property.tenants))
        .filter(Property.account_id == account_id)
        .order_by(Property.project_name)
        .all()
    )
    result = []
    for prop in props:
        tenants_sorted = sorted(prop.tenants, key=lambda t: t.name)
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
            ) for t in tenants_sorted],
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
def update_property(pid: int, payload: PropertyUpdate, account_id: int = Query(...), db: Session = Depends(get_db)):
    prop = db.query(Property).filter(Property.id == pid, Property.account_id == account_id).first()
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
def delete_property(pid: int, account_id: int = Query(...), db: Session = Depends(get_db)):
    prop = db.query(Property).filter(Property.id == pid, Property.account_id == account_id).first()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    db.delete(prop)
    db.commit()
    return {"message": "Property deleted"}


# ── Tenants ──────────────────────────────────────────────────────────────────

@app.post("/properties/{pid}/tenants", response_model=TenantResponse)
def create_tenant(pid: int, payload: TenantCreate, account_id: int = Query(...), db: Session = Depends(get_db)):
    prop = db.query(Property).filter(Property.id == pid, Property.account_id == account_id).first()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    tenant = Tenant(property_id=pid, **payload.model_dump())
    db.add(tenant)
    db.commit()
    db.refresh(tenant)
    return tenant


@app.put("/tenants/{tid}", response_model=TenantResponse)
def update_tenant(tid: int, payload: TenantUpdate, account_id: int = Query(...), db: Session = Depends(get_db)):
    tenant = (
        db.query(Tenant)
        .join(Property, Tenant.property_id == Property.id)
        .filter(Tenant.id == tid, Property.account_id == account_id)
        .first()
    )
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(tenant, field, value)
    db.commit()
    db.refresh(tenant)
    return tenant


@app.delete("/tenants/{tid}")
def delete_tenant(tid: int, account_id: int = Query(...), db: Session = Depends(get_db)):
    tenant = (
        db.query(Tenant)
        .join(Property, Tenant.property_id == Property.id)
        .filter(Tenant.id == tid, Property.account_id == account_id)
        .first()
    )
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    db.delete(tenant)
    db.commit()
    return {"message": "Tenant deleted"}


# ── Chart of Accounts (Category Map) ────────────────────────────────────

@app.get("/category-map", response_model=List[CategoryMapResponse])
def list_category_maps(account_id: int = Query(...), db: Session = Depends(get_db)):
    return (
        db.query(CategoryMap)
        .filter(CategoryMap.account_id == account_id)
        .order_by(CategoryMap.account_code)
        .all()
    )


@app.post("/category-map", response_model=CategoryMapResponse)
def create_category_map(
    payload: CategoryMapCreate,
    account_id: int = Query(...),
    db: Session = Depends(get_db),
):
    existing = (
        db.query(CategoryMap)
        .filter(CategoryMap.account_id == account_id, CategoryMap.category == payload.category)
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail=f"Category '{payload.category}' is already mapped")
    m = CategoryMap(account_id=account_id, **payload.model_dump())
    db.add(m)
    db.commit()
    db.refresh(m)
    return m


@app.put("/category-map/{map_id}", response_model=CategoryMapResponse)
def update_category_map(map_id: int, payload: CategoryMapUpdate, account_id: int = Query(...), db: Session = Depends(get_db)):
    m = db.query(CategoryMap).filter(CategoryMap.id == map_id, CategoryMap.account_id == account_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Mapping not found")
    for field, val in payload.model_dump(exclude_unset=True).items():
        if val is not None:
            setattr(m, field, val)
    db.commit()
    db.refresh(m)
    return m


@app.delete("/category-map/{map_id}")
def delete_category_map(map_id: int, account_id: int = Query(...), db: Session = Depends(get_db)):
    m = db.query(CategoryMap).filter(CategoryMap.id == map_id, CategoryMap.account_id == account_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Mapping not found")
    db.delete(m)
    db.commit()
    return {"message": "Mapping deleted"}


@app.get("/category-map/unmapped")
def get_unmapped_categories(account_id: int = Query(...), db: Session = Depends(get_db)):
    """Return category strings that exist on transactions but have no mapping."""
    all_cats = (
        db.query(Transaction.category)
        .distinct()
        .filter(Transaction.account_id == account_id, Transaction.category != None)
        .all()
    )
    mapped_cats = (
        db.query(CategoryMap.category)
        .filter(CategoryMap.account_id == account_id)
        .all()
    )
    mapped_set = {c[0] for c in mapped_cats}
    unmapped = sorted([c[0] for c in all_cats if c[0] and c[0] not in mapped_set])
    return unmapped


# ── Research helpers ──────────────────────────────────────────────────────

def _build_correspondence_history(db: Session, account_id: int) -> list[dict]:
    """Build ranked correspondence history from approved suggestions and user edits."""
    correspondence: list[dict] = []
    seen_descs: set[str] = set()

    # 1. Approved suggestions (strongest signal)
    approved = (
        db.query(ImportSuggestion)
        .filter(
            ImportSuggestion.account_id == account_id,
            ImportSuggestion.status == "approved",
            ImportSuggestion.suggested_vendor != None,
        )
        .order_by(ImportSuggestion.created_at.desc())
        .limit(20)
        .all()
    )
    for s in approved:
        desc = s.pattern_matched
        if desc in seen_descs:
            continue
        seen_descs.add(desc)
        correspondence.append({
            "desc": researcher.scrub_description(desc),
            "vendor": s.suggested_vendor,
            "category": s.suggested_category or "?",
            "project": s.suggested_project,
            "source": "approved",
        })

    # 2. User-edited transactions (manual categorization)
    user_edited = (
        db.query(Transaction.description, Transaction.vendor, Transaction.category, Transaction.project)
        .filter(
            Transaction.account_id == account_id,
            Transaction.vendor != None,
            Transaction.category != None,
            Transaction.is_cleaned == True,
            Transaction.auto_categorized == False,
        )
        .order_by(Transaction.updated_at.desc())
        .limit(20)
        .all()
    )
    for t in user_edited:
        scrubbed = researcher.scrub_description(t.description)
        if scrubbed in seen_descs:
            continue
        seen_descs.add(scrubbed)
        correspondence.append({
            "desc": scrubbed,
            "vendor": t.vendor,
            "category": t.category,
            "project": t.project,
            "source": "user-edited",
        })

    # 3. Rule-matched auto-categorized (bulk patterns)
    if len(correspondence) < 40:
        remaining = 40 - len(correspondence)
        rule_matched = (
            db.query(Transaction.description, Transaction.vendor, Transaction.category, Transaction.project)
            .filter(
                Transaction.account_id == account_id,
                Transaction.vendor != None,
                Transaction.category != None,
                Transaction.auto_categorized == True,
            )
            .order_by(Transaction.updated_at.desc())
            .limit(remaining)
            .all()
        )
        for t in rule_matched:
            scrubbed = researcher.scrub_description(t.description)
            if scrubbed in seen_descs:
                continue
            seen_descs.add(scrubbed)
            correspondence.append({
                "desc": scrubbed,
                "vendor": t.vendor,
                "category": t.category,
                "project": t.project,
                "source": "rule-matched",
            })

    return correspondence


# ── Vendor Research (LLM) ────────────────────────────────────────────────

@app.post("/research/vendors")
async def research_vendors(
    account_id: int = Query(...),
    db: Session = Depends(get_db),
):
    """
    LLM-powered research for unvendored transactions.
    All unvendored transactions are sent to Grok for classification.
    Only bank description text is sent to LLM — never amounts, dates, or personal info.
    """
    # ── Find transactions with no vendor assigned ────────────────────────────
    uncategorized = (
        db.query(Transaction)
        .filter(
            Transaction.account_id == account_id,
            Transaction.vendor == None,
            Transaction.is_transfer == False,
        )
        .all()
    )

    if not uncategorized:
        return {
            "groups_found": 0, "skipped_transfers": 0,
            "skipped_existing": 0, "suggestions_created": 0, "cards_created": 0, "errors": 0,
        }

    # ── Deduplicate by exact description for LLM research ────────────────────
    groups: dict[str, dict] = {}
    skipped_transfers = 0

    for tx in uncategorized:
        desc = tx.description.strip()
        if researcher.is_skippable(desc):
            skipped_transfers += 1
            continue

        # Group by exact description — no pattern collapsing
        key = desc

        if key not in groups:
            groups[key] = {"desc": desc, "tx_ids": []}
        groups[key]["tx_ids"].append(tx.id)

    # Skip descriptions that already have pending suggestions
    existing_patterns = {
        s.pattern_matched
        for s in db.query(ImportSuggestion.pattern_matched)
        .filter(
            ImportSuggestion.account_id == account_id,
            ImportSuggestion.status == "pending",
        )
        .all()
        if s.pattern_matched
    }
    skipped_existing = 0
    to_research: dict[str, dict] = {}
    for key, group in groups.items():
        if key in existing_patterns:
            skipped_existing += 1
        else:
            to_research[key] = group

    if not to_research:
        return {
            "groups_found": len(groups),
            "skipped_transfers": skipped_transfers, "skipped_existing": skipped_existing,
            "suggestions_created": 0, "cards_created": 0, "errors": 0,
        }

    # Gather context for constrained LLM research
    # Only send confirmed vendors — unconfirmed ones haven't been vetted by user
    all_vendors_for_account = (
        db.query(VendorInfo)
        .filter(VendorInfo.account_id == account_id)
        .all()
    )
    vendor_context = []
    vendor_name_to_vi: dict[str, VendorInfo] = {}
    for vi in all_vendors_for_account:
        vendor_name_to_vi[vi.vendor_name.upper()] = vi
        if not vi.confirmed:
            continue  # exclude unconfirmed from LLM context
        rules = vi.rules or {}
        vendor_context.append({
            "name": vi.vendor_name,
            "category": rules.get("default_category") or vi.trade_category,
            "patterns": rules.get("patterns", []),
        })

    # Distinct categories from transactions
    cat_rows = (
        db.query(Transaction.category)
        .filter(Transaction.account_id == account_id, Transaction.category != None)
        .distinct()
        .all()
    )
    category_list = sorted([r[0] for r in cat_rows])

    # Distinct projects
    proj_rows = (
        db.query(Transaction.project)
        .filter(Transaction.account_id == account_id, Transaction.project != None)
        .distinct()
        .all()
    )
    project_list = sorted([r[0] for r in proj_rows])

    correspondence = _build_correspondence_history(db, account_id)

    # Send to LLM (constrained batch via Grok)
    descriptions = [g["desc"] for g in to_research.values()]
    try:
        llm_results = await researcher.research_descriptions_constrained(
            descriptions, vendor_context, category_list, project_list, correspondence,
        )
    except (ConnectionError, ValueError) as e:
        raise HTTPException(status_code=503, detail=str(e))

    # ── Phase 3: Create suggestions + vendor cards from LLM results ──────────
    suggestions_created = 0
    cards_created = 0
    errors = 0

    for key, group in to_research.items():
        result = llm_results.get(group["desc"])
        if not result:
            errors += 1
            continue

        vendor_name = result.get("vendor_name")
        category = result.get("category")
        trade_category = result.get("trade_category")
        project = result.get("project")
        is_new_vendor = result.get("is_new_vendor", True)

        linked_vi_id = None

        if vendor_name:
            existing_vi = vendor_name_to_vi.get(vendor_name.upper())
            if existing_vi and not is_new_vendor:
                # LLM matched an existing vendor — link to it
                linked_vi_id = existing_vi.id
            elif not existing_vi:
                # Genuinely new vendor — create card
                new_vi = VendorInfo(
                    account_id=account_id,
                    vendor_name=vendor_name,
                    confirmed=False,  # awaits user approval
                    trade_category=trade_category,
                    rules={
                        "patterns": [key],
                        "default_category": category,
                        "default_project": project,
                        "enabled": True,
                        "assigned_count": 0,
                        "corrected_count": 0,
                        "confidence": 1.0,
                    },
                )
                db.add(new_vi)
                db.flush()  # get new_vi.id
                linked_vi_id = new_vi.id
                vendor_name_to_vi[vendor_name.upper()] = new_vi
                cards_created += 1

        # Create suggestion for user review
        db.add(ImportSuggestion(
            account_id=account_id,
            vendor_info_id=linked_vi_id,
            suggested_vendor=vendor_name,
            suggested_category=category,
            suggested_project=project,
            pattern_matched=key,
            transaction_ids=group["tx_ids"],
            status="pending",
        ))
        suggestions_created += 1

    if suggestions_created or cards_created:
        db.commit()

    return {
        "groups_found": len(groups),
        "skipped_transfers": skipped_transfers,
        "skipped_existing": skipped_existing,
        "suggestions_created": suggestions_created,
        "cards_created": cards_created,
        "errors": errors,
    }


# ── Category Research (LLM) ──────────────────────────────────────────────

@app.post("/research/categories")
async def research_categories(
    account_id: int = Query(...),
    db: Session = Depends(get_db),
):
    """
    Research categories for transactions that have a vendor but no category.
    Preserves existing vendor and project assignments.
    """
    uncategorized = (
        db.query(Transaction)
        .filter(
            Transaction.account_id == account_id,
            Transaction.vendor != None,
            Transaction.category == None,
            Transaction.is_transfer == False,
        )
        .all()
    )

    if not uncategorized:
        return {"found": 0, "suggestions_created": 0, "errors": 0}

    # Distinct categories
    cat_rows = (
        db.query(Transaction.category)
        .filter(Transaction.account_id == account_id, Transaction.category != None)
        .distinct()
        .all()
    )
    category_list = sorted([r[0] for r in cat_rows])

    if not category_list:
        return {"found": len(uncategorized), "suggestions_created": 0, "errors": 0,
                "detail": "No existing categories to match against"}

    correspondence = _build_correspondence_history(db, account_id)

    # Build transaction list for LLM (deduplicate by exact description)
    existing_patterns = {
        s.pattern_matched
        for s in db.query(ImportSuggestion.pattern_matched)
        .filter(
            ImportSuggestion.account_id == account_id,
            ImportSuggestion.status == "pending",
        )
        .all()
        if s.pattern_matched
    }

    groups: dict[str, dict] = {}
    for tx in uncategorized:
        key = tx.description.strip()
        if key in existing_patterns:
            continue
        if key not in groups:
            groups[key] = {
                "description": key,
                "vendor": tx.vendor,
                "project": tx.project,
                "tx_ids": [],
            }
        groups[key]["tx_ids"].append(tx.id)

    if not groups:
        return {"found": len(uncategorized), "suggestions_created": 0, "errors": 0}

    tx_list = [{"description": g["description"], "vendor": g["vendor"]} for g in groups.values()]
    try:
        llm_results = await researcher.research_categories(tx_list, category_list, correspondence)
    except (ConnectionError, ValueError) as e:
        raise HTTPException(status_code=503, detail=str(e))

    # Create suggestions
    suggestions_created = 0
    errors = 0
    group_keys = list(groups.keys())

    for idx, result in llm_results.items():
        if idx >= len(group_keys):
            continue
        key = group_keys[idx]
        group = groups[key]
        category = result.get("category")
        if not category:
            errors += 1
            continue

        # Find vendor_info_id for linking (case-insensitive)
        vi = (
            db.query(VendorInfo)
            .filter(VendorInfo.account_id == account_id, func.upper(VendorInfo.vendor_name) == group["vendor"].upper())
            .first()
        ) if group["vendor"] else None

        db.add(ImportSuggestion(
            account_id=account_id,
            vendor_info_id=vi.id if vi else None,
            suggested_vendor=group["vendor"],
            suggested_category=category,
            suggested_project=group["project"],
            pattern_matched=key,
            transaction_ids=group["tx_ids"],
            status="pending",
        ))
        suggestions_created += 1

    if suggestions_created:
        db.commit()

    return {"found": len(uncategorized), "suggestions_created": suggestions_created, "errors": errors}


# ── Project Research (LLM) ───────────────────────────────────────────────

@app.post("/research/projects")
async def research_projects(
    account_id: int = Query(...),
    db: Session = Depends(get_db),
):
    """
    Research projects for transactions that have a vendor but no project.
    Preserves existing vendor and category assignments.
    """
    unprojectd = (
        db.query(Transaction)
        .filter(
            Transaction.account_id == account_id,
            Transaction.vendor != None,
            Transaction.project == None,
            Transaction.is_transfer == False,
        )
        .all()
    )

    if not unprojectd:
        return {"found": 0, "suggestions_created": 0, "errors": 0}

    # Distinct projects
    proj_rows = (
        db.query(Transaction.project)
        .filter(Transaction.account_id == account_id, Transaction.project != None)
        .distinct()
        .all()
    )
    project_list = sorted([r[0] for r in proj_rows])

    if not project_list:
        return {"found": len(unprojectd), "suggestions_created": 0, "errors": 0,
                "detail": "No existing projects to match against"}

    correspondence = _build_correspondence_history(db, account_id)

    # Build transaction list for LLM (deduplicate by exact description)
    existing_patterns = {
        s.pattern_matched
        for s in db.query(ImportSuggestion.pattern_matched)
        .filter(
            ImportSuggestion.account_id == account_id,
            ImportSuggestion.status == "pending",
        )
        .all()
        if s.pattern_matched
    }

    groups: dict[str, dict] = {}
    for tx in unprojectd:
        key = tx.description.strip()
        if key in existing_patterns:
            continue
        if key not in groups:
            groups[key] = {
                "description": key,
                "vendor": tx.vendor,
                "category": tx.category,
                "tx_ids": [],
            }
        groups[key]["tx_ids"].append(tx.id)

    if not groups:
        return {"found": len(unprojectd), "suggestions_created": 0, "errors": 0}

    tx_list = [{"description": g["description"], "vendor": g["vendor"], "category": g["category"]} for g in groups.values()]
    try:
        llm_results = await researcher.research_projects(tx_list, project_list, correspondence)
    except (ConnectionError, ValueError) as e:
        raise HTTPException(status_code=503, detail=str(e))

    # Create suggestions
    suggestions_created = 0
    errors = 0
    group_keys = list(groups.keys())

    for idx, result in llm_results.items():
        if idx >= len(group_keys):
            continue
        key = group_keys[idx]
        group = groups[key]
        project = result.get("project")
        if not project:
            errors += 1
            continue

        vi = (
            db.query(VendorInfo)
            .filter(VendorInfo.account_id == account_id, func.upper(VendorInfo.vendor_name) == group["vendor"].upper())
            .first()
        ) if group["vendor"] else None

        db.add(ImportSuggestion(
            account_id=account_id,
            vendor_info_id=vi.id if vi else None,
            suggested_vendor=group["vendor"],
            suggested_category=group["category"],
            suggested_project=project,
            pattern_matched=key,
            transaction_ids=group["tx_ids"],
            status="pending",
        ))
        suggestions_created += 1

    if suggestions_created:
        db.commit()

    return {"found": len(unprojectd), "suggestions_created": suggestions_created, "errors": errors}


# ── Category Info CRUD ───────────────────────────────────────────────────

@app.get("/category-info", response_model=List[CategoryInfoResponse])
def list_category_info(account_id: int = Query(...), db: Session = Depends(get_db)):
    """List all category info cards, including categories that exist only on transactions."""
    # Get existing cards
    cards = db.query(CategoryInfo).filter(CategoryInfo.account_id == account_id).all()
    card_names = {c.name for c in cards}

    # Get all distinct categories from transactions
    tx_cats = (
        db.query(Transaction.category)
        .filter(Transaction.account_id == account_id, Transaction.category != None)
        .distinct()
        .all()
    )

    # Auto-create cards for categories that exist on transactions but have no card
    new_cards = []
    for (cat_name,) in tx_cats:
        if cat_name not in card_names:
            card = CategoryInfo(account_id=account_id, name=cat_name)
            db.add(card)
            new_cards.append(card)
            card_names.add(cat_name)
    if new_cards:
        db.commit()
        cards = db.query(CategoryInfo).filter(CategoryInfo.account_id == account_id).all()

    # Count transactions per category
    counts = dict(
        db.query(Transaction.category, func.count(Transaction.id))
        .filter(Transaction.account_id == account_id, Transaction.category != None)
        .group_by(Transaction.category)
        .all()
    )

    result = []
    for c in sorted(cards, key=lambda x: x.name):
        resp = CategoryInfoResponse.model_validate(c)
        resp.transaction_count = counts.get(c.name, 0)
        result.append(resp)
    return result


@app.post("/category-info", response_model=CategoryInfoResponse)
def create_category_info(body: CategoryInfoCreate, account_id: int = Query(...), db: Session = Depends(get_db)):
    existing = db.query(CategoryInfo).filter(CategoryInfo.account_id == account_id, CategoryInfo.name == body.name).first()
    if existing:
        raise HTTPException(status_code=409, detail="Category already exists")
    card = CategoryInfo(account_id=account_id, name=body.name, description=body.description)
    db.add(card)
    db.commit()
    db.refresh(card)
    return card


@app.put("/category-info/{cid}", response_model=CategoryInfoResponse)
def update_category_info(cid: int, body: CategoryInfoUpdate, account_id: int = Query(...), db: Session = Depends(get_db)):
    card = db.query(CategoryInfo).filter(CategoryInfo.id == cid, CategoryInfo.account_id == account_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="Category not found")
    if body.description is not None:
        card.description = body.description
    db.commit()
    db.refresh(card)
    return card


@app.delete("/category-info/{cid}")
def delete_category_info(cid: int, account_id: int = Query(...), db: Session = Depends(get_db)):
    """Delete a category card and unset category on all transactions using it."""
    card = db.query(CategoryInfo).filter(CategoryInfo.id == cid, CategoryInfo.account_id == account_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="Category not found")
    # Unset category on transactions
    affected = db.query(Transaction).filter(
        Transaction.account_id == account_id,
        Transaction.category == card.name,
    ).update({"category": None, "auto_categorized": False}, synchronize_session=False)
    db.delete(card)
    db.commit()
    return {"message": f"Deleted category '{card.name}', unset on {affected} transactions"}


# ── Project Info CRUD ────────────────────────────────────────────────────

@app.get("/project-info", response_model=List[ProjectInfoResponse])
def list_project_info(account_id: int = Query(...), db: Session = Depends(get_db)):
    """List all project info cards, including projects that exist only on transactions."""
    cards = db.query(ProjectInfo).filter(ProjectInfo.account_id == account_id).all()
    card_names = {c.name for c in cards}

    tx_projs = (
        db.query(Transaction.project)
        .filter(Transaction.account_id == account_id, Transaction.project != None)
        .distinct()
        .all()
    )

    new_cards = []
    for (proj_name,) in tx_projs:
        if proj_name not in card_names:
            card = ProjectInfo(account_id=account_id, name=proj_name)
            db.add(card)
            new_cards.append(card)
            card_names.add(proj_name)
    if new_cards:
        db.commit()
        cards = db.query(ProjectInfo).filter(ProjectInfo.account_id == account_id).all()

    counts = dict(
        db.query(Transaction.project, func.count(Transaction.id))
        .filter(Transaction.account_id == account_id, Transaction.project != None)
        .group_by(Transaction.project)
        .all()
    )

    result = []
    for c in sorted(cards, key=lambda x: x.name):
        resp = ProjectInfoResponse.model_validate(c)
        resp.transaction_count = counts.get(c.name, 0)
        result.append(resp)
    return result


@app.post("/project-info", response_model=ProjectInfoResponse)
def create_project_info(body: ProjectInfoCreate, account_id: int = Query(...), db: Session = Depends(get_db)):
    existing = db.query(ProjectInfo).filter(ProjectInfo.account_id == account_id, ProjectInfo.name == body.name).first()
    if existing:
        raise HTTPException(status_code=409, detail="Project already exists")
    card = ProjectInfo(account_id=account_id, name=body.name, description=body.description)
    db.add(card)
    db.commit()
    db.refresh(card)
    return card


@app.put("/project-info/{pid}", response_model=ProjectInfoResponse)
def update_project_info(pid: int, body: ProjectInfoUpdate, account_id: int = Query(...), db: Session = Depends(get_db)):
    card = db.query(ProjectInfo).filter(ProjectInfo.id == pid, ProjectInfo.account_id == account_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="Project not found")
    if body.description is not None:
        card.description = body.description
    db.commit()
    db.refresh(card)
    return card


@app.delete("/project-info/{pid}")
def delete_project_info(pid: int, account_id: int = Query(...), db: Session = Depends(get_db)):
    """Delete a project card and unset project on all transactions using it."""
    card = db.query(ProjectInfo).filter(ProjectInfo.id == pid, ProjectInfo.account_id == account_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="Project not found")
    affected = db.query(Transaction).filter(
        Transaction.account_id == account_id,
        Transaction.project == card.name,
    ).update({"project": None}, synchronize_session=False)
    db.delete(card)
    db.commit()
    return {"message": f"Deleted project '{card.name}', unset on {affected} transactions"}
