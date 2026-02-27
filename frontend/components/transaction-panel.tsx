"use client";

import { useState, useEffect } from "react";
import axios from "axios";
import { Transaction } from "@/types/transaction";
import { X, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { VendorCombobox } from "@/components/vendor-combobox";
import { CategoryCombobox } from "@/components/category-combobox";
import { ProjectCombobox } from "@/components/project-combobox";
import { TagInput } from "@/components/tag-input";
import { toast } from "sonner";

interface TransactionPanelProps {
  transaction: Transaction | null;
  open: boolean;
  onClose: () => void;
  onSave: () => void;
}

export function TransactionPanel({ transaction, open, onClose, onSave }: TransactionPanelProps) {
  const [vendor,       setVendor]       = useState("");
  const [category,     setCategory]     = useState("");
  const [project,      setProject]      = useState("");
  const [notes,        setNotes]        = useState("");
  const [tags,         setTags]         = useState<string[]>([]);
  const [taxDeductible,setTaxDeductible]= useState(false);
  const [isTransfer,   setIsTransfer]   = useState(false);
  const [loading,      setLoading]      = useState(false);
  const [suggestion,   setSuggestion]   = useState<{ vendor: string | null; category: string | null } | null>(null);

  // Populate form and fetch suggestion when panel opens
  useEffect(() => {
    if (!transaction || !open) return;

    setVendor(transaction.vendor || "");
    setCategory(transaction.category || "");
    setProject(transaction.project || "");
    setNotes(transaction.notes || "");
    setTags(transaction.tags || []);
    setTaxDeductible(transaction.tax_deductible ?? false);
    setIsTransfer(transaction.is_transfer ?? false);
    setSuggestion(null);

    // Only fetch suggestions for uncategorized transactions
    if (!transaction.is_cleaned) {
      axios
        .get(`http://localhost:8001/transactions/${transaction.id}/suggest`)
        .then((res) => {
          if (res.data.vendor || res.data.category) setSuggestion(res.data);
        })
        .catch(() => {});
    }
  }, [transaction, open]);

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    if (open) document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const applySuggestion = () => {
    if (!suggestion) return;
    if (suggestion.vendor)   setVendor(suggestion.vendor);
    if (suggestion.category) setCategory(suggestion.category);
    setSuggestion(null);
  };

  const handleSave = async () => {
    if (!transaction) return;
    setLoading(true);
    try {
      await axios.put(`http://localhost:8001/transactions/${transaction.id}`, {
        vendor:        vendor   || null,
        category:      category || null,
        project:       project  || null,
        notes:         notes    || null,
        tags:          tags.length > 0 ? tags : null,
        tax_deductible: taxDeductible,
        is_transfer:   isTransfer,
        is_cleaned:    true,
      });
      toast.success("Transaction saved");
      onSave();
      onClose();
    } catch {
      toast.error("Failed to save transaction");
    } finally {
      setLoading(false);
    }
  };

  if (!transaction) return null;

  const amount = parseFloat(String(transaction.amount));
  const fmtAmount = new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
  }).format(Math.abs(amount));

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/25 z-40 transition-opacity duration-200 ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={`fixed top-0 right-0 h-full w-[420px] bg-white shadow-2xl z-50 flex flex-col
          transition-transform duration-200 ease-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <h2 className="font-semibold text-zinc-900 text-sm">Transaction Detail</h2>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-700 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

          {/* Read-only info block */}
          <div className="rounded-lg bg-zinc-50 border p-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-zinc-400">Date</span>
              <span className="font-medium">{transaction.transaction_date}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Amount</span>
              <span className={`font-semibold ${amount > 0 ? "text-emerald-600" : ""}`}>
                {amount > 0 ? "+" : ""}{fmtAmount}
              </span>
            </div>
            <div>
              <span className="text-zinc-400 text-xs block mb-1">Description</span>
              <span className="text-xs font-mono text-zinc-600 leading-relaxed">
                {transaction.description}
              </span>
            </div>
            {transaction.source_file && (
              <div className="flex justify-between">
                <span className="text-zinc-400">Source</span>
                <span className="text-xs text-zinc-500">{transaction.source_file}</span>
              </div>
            )}
          </div>

          {/* Auto-suggest banner */}
          {suggestion && (
            <div className="rounded-lg bg-blue-50 border border-blue-100 p-3 flex items-start gap-2.5">
              <Sparkles className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-blue-700">Suggested from similar transactions</p>
                <p className="text-xs text-blue-600 mt-0.5 truncate">
                  {[suggestion.vendor, suggestion.category].filter(Boolean).join(" · ")}
                </p>
              </div>
              <button
                onClick={applySuggestion}
                className="text-xs font-semibold text-blue-700 hover:text-blue-900 transition-colors whitespace-nowrap"
              >
                Apply
              </button>
            </div>
          )}

          {/* Edit form */}
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-zinc-500 mb-1.5 block">Vendor</Label>
              <VendorCombobox value={vendor} onChange={setVendor} />
            </div>
            <div>
              <Label className="text-xs text-zinc-500 mb-1.5 block">Project</Label>
              <ProjectCombobox value={project} onChange={setProject} />
            </div>
            <div>
              <Label className="text-xs text-zinc-500 mb-1.5 block">Category</Label>
              <CategoryCombobox value={category} onChange={setCategory} />
            </div>
            <div>
              <Label className="text-xs text-zinc-500 mb-1.5 block">Notes</Label>
              <Input
                placeholder="Add a note..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs text-zinc-500 mb-1.5 block">Tags</Label>
              <TagInput value={tags} onChange={setTags} />
            </div>
            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="panel-tax"
                checked={taxDeductible}
                onChange={(e) => setTaxDeductible(e.target.checked)}
                className="h-4 w-4 rounded border-zinc-300 cursor-pointer"
              />
              <Label htmlFor="panel-tax" className="cursor-pointer text-sm font-normal">
                Tax Deductible
              </Label>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="panel-transfer"
                checked={isTransfer}
                onChange={(e) => setIsTransfer(e.target.checked)}
                className="h-4 w-4 rounded border-zinc-300 cursor-pointer"
              />
              <Label htmlFor="panel-transfer" className="cursor-pointer text-sm font-normal">
                Transfer — exclude from income &amp; expenses
              </Label>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t px-6 py-4 flex gap-2 shrink-0">
          <Button variant="outline" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={loading} className="flex-1">
            {loading ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </div>
    </>
  );
}
