"""
Shared CSV import logic used by both ingest.py (CLI) and the /import/csv API endpoint.
"""
import hashlib
import io
import json
from collections import defaultdict

import pandas as pd
from sqlalchemy.orm import Session

from src.models import Transaction


def generate_base_hash(date_str: str, desc: str, amount: float) -> str:
    unique_string = f"{date_str}{desc}{float(amount):.2f}"
    return hashlib.sha256(unique_string.encode("utf-8")).hexdigest()


def import_csv_content(content: bytes, source_file: str, db: Session) -> dict:
    """
    Parse Wells Fargo CSV bytes and insert new transactions into the database.
    Returns {"imported": N, "skipped": N}.
    """
    try:
        df = pd.read_csv(
            io.BytesIO(content),
            header=None,
            names=["date", "amount", "star", "empty", "description"],
        )
    except Exception as e:
        raise ValueError(f"Could not parse CSV: {e}")

    imported = 0
    skipped = 0
    file_hash_counts: dict = defaultdict(int)

    for _, row in df.iterrows():
        try:
            t_date = pd.to_datetime(row["date"]).date()
            desc = str(row["description"]).strip()
            amount = float(row["amount"])
        except Exception:
            skipped += 1
            continue

        base_hash = generate_base_hash(str(t_date), desc, amount)
        occurrence = file_hash_counts[base_hash]
        file_hash_counts[base_hash] += 1
        tx_id = f"{base_hash}-{occurrence}"

        if db.query(Transaction).filter(Transaction.id == tx_id).first():
            skipped += 1
            continue

        db.add(Transaction(
            id=tx_id,
            transaction_date=t_date,
            description=desc,
            amount=amount,
            source_file=source_file,
            raw_data=json.loads(row.to_json()),
            is_cleaned=False,
        ))
        imported += 1

    db.commit()
    return {"imported": imported, "skipped": skipped}
