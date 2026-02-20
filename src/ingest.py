import os
import pandas as pd
import hashlib
import json
import sys
from collections import defaultdict

# Add the parent directory to sys.path
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

from src.database import SessionLocal
from src.models import Transaction

IMPORT_DIR = "/app/data/imports"

def generate_base_hash(date_str, desc, amount):
    # specific string format to ensure consistency
    unique_string = f"{date_str}{desc}{float(amount):.2f}"
    return hashlib.sha256(unique_string.encode('utf-8')).hexdigest()

def process_files():
    db = SessionLocal()
    
    if not os.path.exists(IMPORT_DIR):
        print(f"Directory not found: {IMPORT_DIR}")
        return

    files = [f for f in os.listdir(IMPORT_DIR) if f.endswith(".csv")]
    
    if not files:
        print("No CSV files found in 'data/imports'.")
        return

    for filename in files:
        print(f"\nProcessing {filename}...")
        filepath = os.path.join(IMPORT_DIR, filename)
        
        try:
            # Wells Fargo: No header, 5 columns
            df = pd.read_csv(filepath, header=None, names=['date', 'amount', 'star', 'empty', 'description'])
        except Exception as e:
            print(f"Error reading {filename}: {e}")
            continue

        new_count = 0
        skip_count = 0
        
        # OCCURRENCE MAP: Tracks how many times we've seen a hash IN THIS FILE
        # Format: { "abc123hash": 0 } -> Next time it will be 1, then 2...
        file_hash_counts = defaultdict(int)

        skipped_log = []

        for _, row in df.iterrows():
            try:
                # 1. Extract Data
                t_date = pd.to_datetime(row['date']).date()
                desc = row['description']
                amount = row['amount']
                
                # 2. Generate Base Hash
                base_hash = generate_base_hash(str(t_date), desc, amount)
                
                # 3. Determine Occurrence Index
                # If this is the first time seeing this row in this file, count is 0.
                # If it's the second time (e.g., two coffees), count becomes 1.
                occurrence_index = file_hash_counts[base_hash]
                file_hash_counts[base_hash] += 1
                
                # 4. Create Composite ID
                # ID format: "hash-0", "hash-1"
                tx_id = f"{base_hash}-{occurrence_index}"

                # 5. Check DB for this specific Composite ID
                existing = db.query(Transaction).filter(Transaction.id == tx_id).first()
                if existing:
                    skip_count += 1
                    # Log what we skipped for audit
                    skipped_log.append(f"SKIPPED [{tx_id}]: {t_date} | {amount} | {desc[:30]}...")
                    continue
                
                # 6. Create Record
                new_tx = Transaction(
                    id=tx_id,
                    transaction_date=t_date,
                    description=desc,
                    amount=amount,
                    source_file=filename,
                    raw_data=json.loads(row.to_json()),
                    is_cleaned=False
                )
                
                db.add(new_tx)
                new_count += 1

            except Exception as e:
                print(f"Error processing row: {e}")
                continue

        try:
            db.commit()
            print(f"Finished {filename}: {new_count} new, {skip_count} skipped.")
            
            # Print audit log if skips occurred
            if skipped_log:
                print(f"--- Skips Log ({len(skipped_log)}) ---")
                for log in skipped_log[:5]: # Show first 5
                    print(log)
                if len(skipped_log) > 5:
                    print(f"... and {len(skipped_log) - 5} more.")

        except Exception as e:
            db.rollback()
            print(f"Failed to commit {filename}: {e}")

    db.close()

if __name__ == "__main__":
    process_files()