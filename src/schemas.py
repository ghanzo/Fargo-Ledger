from pydantic import BaseModel
from datetime import date
from typing import Optional, List, Any

# ── Account schemas ────────────────────────────────────────────────────────

class AccountCreate(BaseModel):
    name: str

class AccountResponse(BaseModel):
    id:   int
    name: str

    class Config:
        from_attributes = True

# ── Transaction schemas ────────────────────────────────────────────────────

class TransactionUpdate(BaseModel):
    category:       Optional[str]       = None
    vendor:         Optional[str]       = None
    project:        Optional[str]       = None
    notes:          Optional[str]       = None
    tags:           Optional[List[str]] = None
    tax_deductible: Optional[bool]      = None
    is_transfer:    Optional[bool]      = None
    is_cleaned:     Optional[bool]      = None

class TransactionBulkUpdate(BaseModel):
    ids:         List[str]
    update_data: TransactionUpdate

class TransactionRestore(BaseModel):
    """Per-row snapshot used by the undo endpoint."""
    id:             str
    vendor:         Optional[str]       = None
    category:       Optional[str]       = None
    project:        Optional[str]       = None
    notes:          Optional[str]       = None
    tags:           Optional[List[str]] = None
    tax_deductible: Optional[bool]      = None
    is_transfer:    Optional[bool]      = None
    is_cleaned:     bool                = False

class TransactionResponse(BaseModel):
    id:               str
    account_id:       int
    transaction_date: date
    description:      str
    amount:           float
    source_file:      str
    category:         Optional[str]       = None
    vendor:           Optional[str]       = None
    project:          Optional[str]       = None
    notes:            Optional[str]       = None
    tags:             Optional[List[str]] = None
    tax_deductible:   Optional[bool]      = None
    is_transfer:      bool                = False
    is_cleaned:       bool
    auto_categorized: bool                = False

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
    account_id:    int
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

# ── VendorInfo schemas ──────────────────────────────────────────────────────

class VendorInfoCreate(BaseModel):
    vendor_name:    str
    business_name:  Optional[str] = None
    trade_category: Optional[str] = None
    phone:          Optional[str] = None
    email:          Optional[str] = None
    rating:         Optional[int] = None
    notes:          Optional[str] = None

class VendorInfoUpdate(BaseModel):
    business_name:  Optional[str]  = None
    trade_category: Optional[str]  = None
    phone:          Optional[str]  = None
    email:          Optional[str]  = None
    rating:         Optional[int]  = None
    notes:          Optional[str]  = None
    rules:          Optional[Any]  = None  # full rules dict replacement

class VendorInfoResponse(BaseModel):
    id:             int
    account_id:     int
    vendor_name:    str
    business_name:  Optional[str] = None
    trade_category: Optional[str] = None
    phone:          Optional[str] = None
    email:          Optional[str] = None
    rating:         Optional[int] = None
    notes:          Optional[str] = None
    rules:          Optional[Any] = None

    class Config:
        from_attributes = True

# ── Tenant schemas ──────────────────────────────────────────────────────────

class TenantCreate(BaseModel):
    name:         str
    phone:        Optional[str]   = None
    email:        Optional[str]   = None
    lease_start:  Optional[date]  = None
    lease_end:    Optional[date]  = None
    monthly_rent: Optional[float] = None
    notes:        Optional[str]   = None

class TenantUpdate(BaseModel):
    name:         Optional[str]   = None
    phone:        Optional[str]   = None
    email:        Optional[str]   = None
    lease_start:  Optional[date]  = None
    lease_end:    Optional[date]  = None
    monthly_rent: Optional[float] = None
    notes:        Optional[str]   = None

class TenantResponse(BaseModel):
    id:           int
    property_id:  int
    name:         str
    phone:        Optional[str]   = None
    email:        Optional[str]   = None
    lease_start:  Optional[date]  = None
    lease_end:    Optional[date]  = None
    monthly_rent: Optional[float] = None
    notes:        Optional[str]   = None

    class Config:
        from_attributes = True

# ── Property schemas ────────────────────────────────────────────────────────

class PropertyCreate(BaseModel):
    project_name: str
    address:      Optional[str] = None
    notes:        Optional[str] = None

class PropertyUpdate(BaseModel):
    address: Optional[str] = None
    notes:   Optional[str] = None

class PropertyResponse(BaseModel):
    id:           int
    account_id:   int
    project_name: str
    address:      Optional[str] = None
    notes:        Optional[str] = None
    tenants:      List[TenantResponse] = []

    class Config:
        from_attributes = True
