import hashlib
from sqlalchemy import Column, String, Date, Numeric, Boolean, JSON, Integer, ForeignKey, UniqueConstraint
from sqlalchemy.orm import declarative_base

Base = declarative_base()

class Account(Base):
    __tablename__ = 'accounts'

    id   = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False, unique=True)

    def __repr__(self):
        return f"<Account(id={self.id}, name={self.name})>"

class Transaction(Base):
    __tablename__ = 'transactions'

    # Primary Key (Hash)
    id = Column(String, primary_key=True)

    # Account
    account_id = Column(Integer, ForeignKey('accounts.id', ondelete='CASCADE'), nullable=False)

    # Core Bank Data
    transaction_date = Column(Date, nullable=False)
    description = Column(String, nullable=False)
    amount = Column(Numeric(10, 2), nullable=False)

    # Metadata
    source_file = Column(String, nullable=False)
    raw_data = Column(JSON, nullable=False)

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

    def __repr__(self):
        return f"<Transaction(date={self.transaction_date}, desc={self.description}, amount={self.amount})>"

class Budget(Base):
    __tablename__ = 'budgets'

    id             = Column(Integer, primary_key=True, autoincrement=True)
    account_id     = Column(Integer, ForeignKey('accounts.id', ondelete='CASCADE'), nullable=False)
    category       = Column(String, nullable=False)
    monthly_limit  = Column(Numeric(10, 2), nullable=False)

    __table_args__ = (
        UniqueConstraint('account_id', 'category', name='budgets_account_category_unique'),
    )


class VendorInfo(Base):
    __tablename__ = 'vendor_info'
    id             = Column(Integer, primary_key=True, autoincrement=True)
    account_id     = Column(Integer, ForeignKey('accounts.id', ondelete='CASCADE'), nullable=False)
    vendor_name    = Column(String, nullable=False)
    business_name  = Column(String)
    trade_category = Column(String)
    phone          = Column(String)
    email          = Column(String)
    rating         = Column(Integer)  # 1–5
    notes          = Column(String)
    rules          = Column(JSON)     # auto-assign rules: patterns, default_category/project, confidence, etc.
    __table_args__ = (UniqueConstraint('account_id', 'vendor_name', name='vendor_info_account_name_uq'),)

class Property(Base):
    __tablename__ = 'properties'
    id           = Column(Integer, primary_key=True, autoincrement=True)
    account_id   = Column(Integer, ForeignKey('accounts.id', ondelete='CASCADE'), nullable=False)
    project_name = Column(String, nullable=False)
    address      = Column(String)
    notes        = Column(String)
    __table_args__ = (UniqueConstraint('account_id', 'project_name', name='properties_account_proj_uq'),)

class Tenant(Base):
    __tablename__ = 'tenants'
    id           = Column(Integer, primary_key=True, autoincrement=True)
    property_id  = Column(Integer, ForeignKey('properties.id', ondelete='CASCADE'), nullable=False)
    name         = Column(String, nullable=False)
    phone        = Column(String)
    email        = Column(String)
    lease_start  = Column(Date)
    lease_end    = Column(Date)
    monthly_rent = Column(Numeric(10, 2))
    notes        = Column(String)


def generate_id(date_obj, description, amount):
    unique_string = f"{date_obj}{description}{float(amount):.2f}"
    return hashlib.sha256(unique_string.encode('utf-8')).hexdigest()
