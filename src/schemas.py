from pydantic import BaseModel
from datetime import date
from typing import Optional, List

# ── Transaction schemas ────────────────────────────────────────────────────

class TransactionUpdate(BaseModel):
    category:       Optional[str]       = None
    vendor:         Optional[str]       = None
    notes:          Optional[str]       = None
    tags:           Optional[List[str]] = None
    tax_deductible: Optional[bool]      = None
    is_cleaned:     Optional[bool]      = None

class TransactionBulkUpdate(BaseModel):
    ids:         List[str]
    update_data: TransactionUpdate

class TransactionRestore(BaseModel):
    """Per-row snapshot used by the undo endpoint."""
    id:             str
    vendor:         Optional[str]       = None
    category:       Optional[str]       = None
    notes:          Optional[str]       = None
    tags:           Optional[List[str]] = None
    tax_deductible: Optional[bool]      = None
    is_cleaned:     bool                = False

class TransactionResponse(BaseModel):
    id:               str
    transaction_date: date
    description:      str
    amount:           float
    source_file:      str
    category:         Optional[str]       = None
    vendor:           Optional[str]       = None
    notes:            Optional[str]       = None
    tags:             Optional[List[str]] = None
    tax_deductible:   Optional[bool]      = None
    is_cleaned:       bool

    class Config:
        from_attributes = True

# ── Budget schemas ─────────────────────────────────────────────────────────

class BudgetCreate(BaseModel):
    category:      str
    monthly_limit: float

class BudgetUpdate(BaseModel):
    monthly_limit: float

class BudgetResponse(BaseModel):
    id:            int
    category:      str
    monthly_limit: float

    class Config:
        from_attributes = True

class BudgetStatus(BaseModel):
    category:      str
    monthly_limit: float
    actual_spend:  float
    remaining:     float
    percentage:    float
