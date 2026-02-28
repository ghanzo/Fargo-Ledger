"""
Shared CSV import logic used by both ingest.py (CLI) and the /import/csv API endpoint.
"""
import hashlib
import io
import json
import re
from collections import defaultdict

import pandas as pd
from sqlalchemy.orm import Session

from src.models import Transaction, VendorInfo, ImportSuggestion


# ── Pattern helpers ──────────────────────────────────────────────────────────

# Words that appear in many bank descriptions but don't identify a vendor
_NOISE = {
    # Generic legal / business suffixes
    'LLC', 'INC', 'CO', 'CORP', 'LTD', 'DBA',
    # Common English words
    'THE', 'AND', 'OF', 'FOR', 'AT', 'BY',
    # Wells Fargo description prefixes / boilerplate
    'AUTHORIZED', 'CHECKCARD', 'DEBIT', 'PURCHASE', 'RECURRING',
    'PAYMENT', 'PMTS', 'PMT', 'ACH', 'POS', 'PIN', 'ATM', 'TST',
    'ONLINE', 'TRANSFER', 'DEPOSIT', 'WITHDRAWAL', 'CHARGE',
    # US state abbreviations
    'WA', 'CA', 'TX', 'FL', 'NY', 'OR', 'AZ', 'NV', 'IL', 'OH',
    'GA', 'NC', 'VA', 'MA', 'CO', 'MN', 'WI', 'MO',
    # Web/tech noise
    'WWW', 'COM', 'NET', 'ORG', 'HTTP', 'HTTPS',
    # Square (SQ *VENDOR) — leave PAYPAL/VENMO since they ARE vendors for some users
    'SQU',
}

_SPLIT_RE = re.compile(r'[\s\*\#\@\!\-\_\/\\\.\,\+\&]+')
_ALL_DIGITS_RE = re.compile(r'^[\d]+$')


def extract_description_patterns(description: str) -> list[str]:
    """Return 1–2 discriminative uppercase tokens from a raw bank description."""
    desc = description.upper().strip()
    tokens = _SPLIT_RE.split(desc)
    meaningful = [
        t for t in tokens
        if t and len(t) >= 3
        and not _ALL_DIGITS_RE.match(t)
        and t not in _NOISE
    ]
    if not meaningful:
        return []
    patterns = [meaningful[0]]
    if len(meaningful) >= 2:
        patterns.append(f"{meaningful[0]} {meaningful[1]}")
    return patterns


def find_matching_vendor(description: str, candidates: list) -> "VendorInfo | None":
    """
    Return the best-matching VendorInfo for a description, or None.
    Candidates is a pre-filtered list of VendorInfo objects with rules that are
    enabled and above the confidence threshold.
    Ties broken by highest assigned_count (most trained vendor wins).
    """
    desc_upper = description.upper()
    matches: list[tuple[VendorInfo, int]] = []
    for vi in candidates:
        rules = vi.rules or {}
        for pattern in rules.get("patterns", []):
            if pattern and pattern.upper() in desc_upper:
                matches.append((vi, rules.get("assigned_count", 0)))
                break  # one match per vendor is enough
    if not matches:
        return None
    matches.sort(key=lambda x: -x[1])
    return matches[0][0]


def generate_base_hash(date_str: str, desc: str, amount: float) -> str:
    unique_string = f"{date_str}{desc}{float(amount):.2f}"
    return hashlib.sha256(unique_string.encode("utf-8")).hexdigest()


# ── Main import function ─────────────────────────────────────────────────────

_CONFIDENCE_CLEAN_THRESHOLD  = 0.85  # auto-assign + mark is_cleaned
_CONFIDENCE_ASSIGN_THRESHOLD = 0.70  # auto-assign only (leave is_cleaned=False)


def import_csv_content(content: bytes, source_file: str, db: Session, account_id: int) -> dict:
    """
    Parse Wells Fargo CSV bytes and insert new transactions into the database.
    Pattern matches are stored as pending suggestions instead of being applied directly.
    Returns {"imported": N, "skipped": N, "suggestions_created": N}.
    """
    try:
        df = pd.read_csv(
            io.BytesIO(content),
            header=None,
            names=["date", "amount", "star", "empty", "description"],
        )
    except Exception as e:
        raise ValueError(f"Could not parse CSV: {e}")

    # Load eligible vendor rules for this account once, before the row loop
    all_vendor_infos = (
        db.query(VendorInfo)
        .filter(VendorInfo.account_id == account_id, VendorInfo.rules != None)
        .all()
    )
    auto_candidates = [
        vi for vi in all_vendor_infos
        if vi.rules
        and vi.rules.get("enabled", True)
        and vi.rules.get("confidence", 1.0) >= _CONFIDENCE_ASSIGN_THRESHOLD
        and vi.rules.get("patterns")
    ]

    imported = 0
    skipped  = 0
    file_hash_counts: dict = defaultdict(int)

    # Accumulate suggestion groups: vendor_info_id → {vi, tx_ids, pattern}
    suggestions_map: dict[int, dict] = {}

    for _, row in df.iterrows():
        try:
            t_date = pd.to_datetime(row["date"]).date()
            desc   = str(row["description"]).strip()
            amount = float(row["amount"])
        except Exception:
            skipped += 1
            continue

        base_hash  = generate_base_hash(str(t_date), desc, amount)
        occurrence = file_hash_counts[base_hash]
        file_hash_counts[base_hash] += 1
        tx_id = f"{base_hash}-{occurrence}"

        if db.query(Transaction).filter(Transaction.id == tx_id).first():
            skipped += 1
            continue

        # Insert transaction with NULL vendor/category/project
        db.add(Transaction(
            id               = tx_id,
            account_id       = account_id,
            transaction_date = t_date,
            description      = desc,
            amount           = amount,
            source_file      = source_file,
            raw_data         = json.loads(row.to_json()),
        ))
        imported += 1

        # Check for pattern match → accumulate into suggestions
        matched_vi = find_matching_vendor(desc, auto_candidates)
        if matched_vi:
            vi_id = matched_vi.id
            if vi_id not in suggestions_map:
                rules = matched_vi.rules
                by_sign = rules.get("by_sign")
                if by_sign:
                    sign_key   = "income" if amount >= 0 else "expense"
                    sign_rules = by_sign.get(sign_key, {})
                    s_category = sign_rules.get("category") or rules.get("default_category")
                    s_project  = sign_rules.get("project")  or rules.get("default_project")
                else:
                    s_category = rules.get("default_category")
                    s_project  = rules.get("default_project")
                # Find which pattern actually matched
                desc_upper = desc.upper()
                matched_pattern = ""
                for p in rules.get("patterns", []):
                    if p and p.upper() in desc_upper:
                        matched_pattern = p
                        break
                suggestions_map[vi_id] = {
                    "vi": matched_vi,
                    "tx_ids": [],
                    "pattern": matched_pattern,
                    "category": s_category,
                    "project": s_project,
                }
            suggestions_map[vi_id]["tx_ids"].append(tx_id)

    db.commit()

    # Create ImportSuggestion records for each matched vendor group
    suggestions_created = 0
    for vi_id, sg in suggestions_map.items():
        vi = sg["vi"]
        db.add(ImportSuggestion(
            account_id       = account_id,
            vendor_info_id   = vi_id,
            suggested_vendor   = vi.vendor_name,
            suggested_category = sg["category"],
            suggested_project  = sg["project"],
            pattern_matched    = sg["pattern"],
            transaction_ids    = sg["tx_ids"],
            status             = "pending",
        ))
        suggestions_created += 1

    if suggestions_created:
        db.commit()

    return {"imported": imported, "skipped": skipped, "suggestions_created": suggestions_created}
