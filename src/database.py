# src/database.py
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from src.models import Base

# Fetch URL from Docker Environment Variables
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://user:password@db:5432/finance_db")

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def init_db():
    print("Creating database tables...")
    Base.metadata.create_all(bind=engine)
    print("Tables created.")