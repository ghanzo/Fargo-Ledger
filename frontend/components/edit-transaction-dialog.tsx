"use client";

import { useState, useEffect } from "react";
import axios from "axios";
import { Transaction } from "@/types/transaction";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { VendorCombobox } from "@/components/vendor-combobox";
import { CategoryCombobox } from "@/components/category-combobox";
import { TagInput } from "@/components/tag-input";

interface EditTransactionDialogProps {
  transaction: Transaction | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: () => void;
}

export function EditTransactionDialog({ transaction, open, onOpenChange, onSave }: EditTransactionDialogProps) {
  const [vendor, setVendor] = useState("");
  const [category, setCategory] = useState("");
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [taxDeductible, setTaxDeductible] = useState(false);
  const [loading, setLoading] = useState(false);

  // Populate form with current transaction data when it opens
  useEffect(() => {
    if (transaction && open) {
      setVendor(transaction.vendor || "");
      setCategory(transaction.category || "");
      setNotes(transaction.notes || "");
      setTags(transaction.tags || []);
      setTaxDeductible(transaction.tax_deductible || false);
    }
  }, [transaction, open]);

  const handleSave = async () => {
    if (!transaction) return;
    setLoading(true);
    try {
      await axios.put(`http://localhost:8000/transactions/${transaction.id}`, {
        vendor: vendor || null,
        category: category || null,
        notes: notes || null,
        tags: tags.length > 0 ? tags : null,
        tax_deductible: taxDeductible,
        is_cleaned: true,
      });

      toast.success("Transaction updated");
      onSave();
      onOpenChange(false);
    } catch (error) {
      toast.error("Failed to save transaction. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (!transaction) return null;

  const amount = parseFloat(String(transaction.amount));
  const formattedAmount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Math.abs(amount));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Edit Transaction</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Read-only transaction info */}
          <div className="rounded-lg bg-zinc-50 border p-3 grid gap-2">
            <div className="flex justify-between text-sm">
              <span className="text-zinc-500">Date</span>
              <span className="font-medium">{transaction.transaction_date}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-zinc-500">Amount</span>
              <span className={`font-medium ${amount > 0 ? "text-emerald-600" : ""}`}>
                {amount > 0 ? "+" : ""}{formattedAmount}
              </span>
            </div>
            <div className="text-sm">
              <span className="text-zinc-500">Description</span>
              <p className="mt-1 text-xs text-zinc-700 font-mono leading-relaxed">
                {transaction.description}
              </p>
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Vendor</Label>
            <VendorCombobox value={vendor} onChange={setVendor} />
          </div>

          <div className="grid gap-2">
            <Label>Category</Label>
            <CategoryCombobox value={category} onChange={setCategory} />
          </div>

          <div className="grid gap-2">
            <Label>Notes</Label>
            <Input
              placeholder="Add a note..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label>Tags</Label>
            <TagInput value={tags} onChange={setTags} />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="tax-deductible"
              checked={taxDeductible}
              onChange={(e) => setTaxDeductible(e.target.checked)}
              className="h-4 w-4 rounded border-zinc-300 cursor-pointer"
            />
            <Label htmlFor="tax-deductible" className="cursor-pointer">
              Tax Deductible
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
