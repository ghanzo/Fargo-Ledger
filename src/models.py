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
    tax_deductible = Column(Boolean, default=False, nullable=True)  # True if tax deductible

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


def generate_id(date_obj, description, amount):
    unique_string = f"{date_obj}{description}{float(amount):.2f}"
    return hashlib.sha256(unique_string.encode('utf-8')).hexdigest()
