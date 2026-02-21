export interface Transaction {
  id: string;
  transaction_date: string; // API sends dates as strings
  description: string;
  amount: number;
  category: string | null;
  vendor: string | null;
  project: string | null;
  notes: string | null;
  tags: string[] | null;
  tax_deductible: boolean | null;
  is_transfer: boolean;
  source_file: string;
  is_cleaned: boolean;
}
