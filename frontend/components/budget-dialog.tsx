"use client";

import { useState, useEffect } from "react";
import axios from "axios";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Trash2, Plus } from "lucide-react";
import { CategoryCombobox } from "@/components/category-combobox";

interface Budget {
  id: number;
  category: string;
  monthly_limit: number;
}

interface BudgetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}

export function BudgetDialog({ open, onOpenChange, onSaved }: BudgetDialogProps) {
  const [budgets,  setBudgets]  = useState<Budget[]>([]);
  const [category, setCategory] = useState("");
  const [limit,    setLimit]    = useState("");
  const [loading,  setLoading]  = useState(false);

  const fetchBudgets = async () => {
    try {
      const res = await axios.get("http://localhost:8000/budgets");
      setBudgets(res.data);
    } catch {
      toast.error("Failed to load budgets");
    }
  };

  useEffect(() => { if (open) fetchBudgets(); }, [open]);

  const handleAdd = async () => {
    if (!category || !limit) return;
    const numLimit = parseFloat(limit);
    if (isNaN(numLimit) || numLimit <= 0) { toast.error("Enter a valid monthly limit"); return; }
    setLoading(true);
    try {
      await axios.post("http://localhost:8000/budgets", { category, monthly_limit: numLimit });
      setCategory(""); setLimit("");
      await fetchBudgets();
      onSaved?.();
    } catch (err: any) {
      toast.error(err?.response?.data?.detail ?? "Failed to create budget");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateLimit = async (id: number, newLimit: string) => {
    const num = parseFloat(newLimit);
    if (isNaN(num) || num <= 0) return;
    try {
      await axios.put(`http://localhost:8000/budgets/${id}`, { monthly_limit: num });
      await fetchBudgets();
      onSaved?.();
    } catch {
      toast.error("Failed to update budget");
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await axios.delete(`http://localhost:8000/budgets/${id}`);
      await fetchBudgets();
      onSaved?.();
    } catch {
      toast.error("Failed to delete budget");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Manage Budgets</DialogTitle>
        </DialogHeader>

        {/* Existing budgets */}
        {budgets.length > 0 && (
          <div className="divide-y border rounded-lg mb-4">
            {budgets.map((b) => (
              <div key={b.id} className="flex items-center gap-3 px-3 py-2">
                <span className="flex-1 text-sm font-medium text-zinc-700">{b.category}</span>
                <span className="text-xs text-zinc-400 mr-1">$/mo</span>
                <Input
                  type="number"
                  defaultValue={b.monthly_limit}
                  onBlur={(e) => handleUpdateLimit(b.id, e.target.value)}
                  className="w-[100px] h-7 text-sm text-right"
                  min={0}
                  step={0.01}
                />
                <button
                  onClick={() => handleDelete(b.id)}
                  className="text-zinc-300 hover:text-red-500 transition-colors ml-1"
                  title="Delete budget"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        {budgets.length === 0 && (
          <p className="text-sm text-zinc-400 text-center py-4">
            No budgets yet — add one below.
          </p>
        )}

        {/* Add new budget */}
        <div className="border rounded-lg p-3 bg-zinc-50">
          <p className="text-xs font-medium text-zinc-500 mb-2 uppercase tracking-wide">Add Budget</p>
          <div className="flex gap-2 items-end">
            <div className="flex-1 grid gap-1">
              <Label className="text-xs">Category</Label>
              <CategoryCombobox value={category} onChange={setCategory} />
            </div>
            <div className="w-[110px] grid gap-1">
              <Label className="text-xs">Monthly Limit ($)</Label>
              <Input
                type="number"
                placeholder="500"
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                className="h-9 text-sm"
                min={0}
                step={0.01}
                onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
              />
            </div>
            <Button size="sm" className="h-9 gap-1" onClick={handleAdd} disabled={loading || !category || !limit}>
              <Plus className="h-4 w-4" /> Add
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
