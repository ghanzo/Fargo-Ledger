import hashlib
from sqlalchemy import Column, String, Date, Numeric, Boolean, JSON, Integer, ForeignKey, UniqueConstraint, DateTime, func
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()

class Account(Base):
    __tablename__ = 'accounts'

    id   = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False, unique=True)

    transactions   = relationship("Transaction",  back_populates="account", cascade="all, delete-orphan")
    budgets        = relationship("Budget",       back_populates="account", cascade="all, delete-orphan")
    vendor_infos   = relationship("VendorInfo",   back_populates="account", cascade="all, delete-orphan")
    properties     = relationship("Property",     back_populates="account", cascade="all, delete-orphan")
    category_maps  = relationship("CategoryMap",  back_populates="account", cascade="all, delete-orphan")
    category_infos = relationship("CategoryInfo", back_populates="account", cascade="all, delete-orphan")
    project_infos  = relationship("ProjectInfo",  back_populates="account", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Account(id={self.id}, name={self.name})>"

class Transaction(Base):
    __tablename__ = 'transactions'

    # Primary Key (Hash)
    id = Column(String, primary_key=True)

    # Account
    account_id = Column(Integer, ForeignKey('accounts.id', ondelete='CASCADE'), nullable=False)
    account = relationship("Account", back_populates="transactions")

    # Core Bank Data
    transaction_date = Column(Date, nullable=False)
    description = Column(String, nullable=False)
    amount = Column(Numeric(10, 2), nullable=False)

    # Metadata
    source_file = Column(String, nullable=False)
    raw_data = Column(JSON, nullable=False)
    institution = Column(String, nullable=True)     # e.g. "Wells Fargo", "Redwood Credit Union"

    # --- NEW FIELDS FOR "DATA GRID" ---
    category = Column(String, nullable=True)     # e.g. "Food"
    vendor = Column(String, nullable=True)       # e.g. "Starbucks" (Normalized)
    project = Column(String, nullable=True)      # e.g. "Project Alpha"
    notes = Column(String, nullable=True)        # e.g. "Meeting with Client X"
    tags = Column(JSON, nullable=True)           # e.g. ["Thailand 2025", "Project A"]
    tax_deductible   = Column(Boolean, default=False, nullable=True)  # True if tax deductible
    is_transfer      = Column(Boolean, default=False)                 # True if bank transfer (excluded from P&L)
    auto_categorized = Column(Boolean, default=False, nullable=True)  # True if assigned by auto-assign on import

    # Status Flags
    is_cleaned = Column(Boolean, default=False)  # True if categorized/processed

    # Audit Timestamps
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    def __repr__(self):
        return f"<Transaction(date={self.transaction_date}, desc={self.description}, amount={self.amount})>"

class Budget(Base):
    __tablename__ = 'budgets'

    id             = Column(Integer, primary_key=True, autoincrement=True)
    account_id     = Column(Integer, ForeignKey('accounts.id', ondelete='CASCADE'), nullable=False)
    category       = Column(String, nullable=False)
    monthly_limit  = Column(Numeric(10, 2), nullable=False)

    account = relationship("Account", back_populates="budgets")

    __table_args__ = (
        UniqueConstraint('account_id', 'category', name='budgets_account_category_unique'),
    )


class VendorInfo(Base):
    __tablename__ = 'vendor_info'
    id             = Column(Integer, primary_key=True, autoincrement=True)
    account_id     = Column(Integer, ForeignKey('accounts.id', ondelete='CASCADE'), nullable=False)
    vendor_name    = Column(String, nullable=False)
    confirmed      = Column(Boolean, default=True, nullable=False)  # False = LLM-created, awaiting user approval
    business_name  = Column(String)
    trade_category = Column(String)
    phone          = Column(String)
    email          = Column(String)
    rating         = Column(Integer)  # 1–5
    notes          = Column(String)
    website             = Column(String)
    address             = Column(String)
    account_number      = Column(String)   # user's account with the vendor
    contact_person      = Column(String)
    payment_method      = Column(String)   # how user pays (auto-pay, check, card)
    tax_id              = Column(String)   # EIN for 1099 filing
    license_number      = Column(String)   # contractor license
    insurance_info      = Column(String)   # insurance details/expiry
    service_description = Column(String)   # what they do specifically
    rules          = Column(JSON)     # auto-assign rules: patterns, default_category/project, confidence, etc.

    account     = relationship("Account", back_populates="vendor_infos")
    suggestions = relationship("ImportSuggestion", back_populates="vendor_info", cascade="all, delete-orphan")

    __table_args__ = (UniqueConstraint('account_id', 'vendor_name', name='vendor_info_account_name_uq'),)

class Property(Base):
    __tablename__ = 'properties'
    id           = Column(Integer, primary_key=True, autoincrement=True)
    account_id   = Column(Integer, ForeignKey('accounts.id', ondelete='CASCADE'), nullable=False)
    project_name = Column(String, nullable=False)
    address      = Column(String)
    notes        = Column(String)

    account = relationship("Account", back_populates="properties")
    tenants = relationship("Tenant", back_populates="property", cascade="all, delete-orphan")

    __table_args__ = (UniqueConstraint('account_id', 'project_name', name='properties_account_proj_uq'),)

class Tenant(Base):
    __tablename__ = 'tenants'
    id           = Column(Integer, primary_key=True, autoincrement=True)
    property_id  = Column(Integer, ForeignKey('properties.id', ondelete='CASCADE'), nullable=False)
    property     = relationship("Property", back_populates="tenants")
    name         = Column(String, nullable=False)
    phone        = Column(String)
    email        = Column(String)
    lease_start  = Column(Date)
    lease_end    = Column(Date)
    monthly_rent = Column(Numeric(10, 2))
    notes        = Column(String)


class ImportSuggestion(Base):
    __tablename__ = 'import_suggestions'
    id                 = Column(Integer, primary_key=True, autoincrement=True)
    account_id         = Column(Integer, ForeignKey('accounts.id', ondelete='CASCADE'))
    vendor_info_id     = Column(Integer, ForeignKey('vendor_info.id', ondelete='CASCADE'), nullable=True)
    vendor_info        = relationship("VendorInfo", back_populates="suggestions")
    suggested_vendor   = Column(String, nullable=True)
    suggested_category = Column(String, nullable=True)
    suggested_project  = Column(String, nullable=True)
    pattern_matched    = Column(String)
    transaction_ids    = Column(JSON)     # ["hash-0", "hash-1", ...]
    status             = Column(String, default='pending')  # pending/approved/dismissed
    created_at         = Column(DateTime, default=func.now())


class CategoryMap(Base):
    __tablename__ = 'category_map'
    id            = Column(Integer, primary_key=True, autoincrement=True)
    account_id    = Column(Integer, ForeignKey('accounts.id', ondelete='CASCADE'), nullable=False)
    category      = Column(String, nullable=False)
    account_code  = Column(String, nullable=False)       # e.g. "5200"
    account_name  = Column(String, nullable=False)       # e.g. "Meals & Entertainment"
    account_type  = Column(String, nullable=False, default='expense')  # income, expense

    account = relationship("Account", back_populates="category_maps")

    __table_args__ = (
        UniqueConstraint('account_id', 'category', name='category_map_account_cat_uq'),
    )


class CategoryInfo(Base):
    __tablename__ = 'category_info'
    id          = Column(Integer, primary_key=True, autoincrement=True)
    account_id  = Column(Integer, ForeignKey('accounts.id', ondelete='CASCADE'), nullable=False)
    name        = Column(String, nullable=False)
    description = Column(String)

    account = relationship("Account", back_populates="category_infos")

    __table_args__ = (UniqueConstraint('account_id', 'name', name='category_info_account_name_uq'),)


class ProjectInfo(Base):
    __tablename__ = 'project_info'
    id          = Column(Integer, primary_key=True, autoincrement=True)
    account_id  = Column(Integer, ForeignKey('accounts.id', ondelete='CASCADE'), nullable=False)
    name        = Column(String, nullable=False)
    description = Column(String)

    account = relationship("Account", back_populates="project_infos")

    __table_args__ = (UniqueConstraint('account_id', 'name', name='project_info_account_name_uq'),)


def generate_id(date_obj, description, amount):
    unique_string = f"{date_obj}{description}{float(amount):.2f}"
    return hashlib.sha256(unique_string.encode('utf-8')).hexdigest()
