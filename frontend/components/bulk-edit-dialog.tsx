"use client";

import { useState } from "react";
import axios from "axios";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { VendorCombobox } from "@/components/vendor-combobox";
import { CategoryCombobox } from "@/components/category-combobox";
import { ProjectCombobox } from "@/components/project-combobox";
import { TagInput } from "@/components/tag-input";
import { Transaction } from "@/types/transaction";
import { useAccount } from "@/context/account-context";

interface BulkEditDialogProps {
  selectedIds: string[];
  selectedTransactions: Transaction[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function BulkEditDialog({
  selectedIds, selectedTransactions, open, onOpenChange, onSuccess,
}: BulkEditDialogProps) {
  const [vendor,        setVendor]        = useState("");
  const [category,      setCategory]      = useState("");
  const [project,       setProject]       = useState("");
  const [notes,         setNotes]         = useState("");
  const [tags,          setTags]          = useState<string[]>([]);
  const [taxDeductible, setTaxDeductible] = useState<boolean | null>(null);
  const [loading,       setLoading]       = useState(false);
  const { activeAccount } = useAccount();

  const reset = () => {
    setVendor(""); setCategory(""); setProject(""); setNotes(""); setTags([]); setTaxDeductible(null);
  };

  const handleSave = async () => {
    setLoading(true);
    // Capture snapshots BEFORE the update so we can restore them on undo
    const snapshots = selectedTransactions.map((tx) => ({
      id:             tx.id,
      vendor:         tx.vendor,
      category:       tx.category,
      project:        tx.project,
      notes:          tx.notes,
      tags:           tx.tags,
      tax_deductible: tx.tax_deductible,
      is_cleaned:     tx.is_cleaned,
    }));

    try {
      const updateData: any = {};
      if (vendor)            updateData.vendor         = vendor;
      if (category)          updateData.category       = category;
      if (project)           updateData.project        = project;
      if (notes)             updateData.notes          = notes;
      if (tags.length > 0)   updateData.tags           = tags;
      if (taxDeductible !== null) updateData.tax_deductible = taxDeductible;
      updateData.is_cleaned = true;

      await axios.patch(
        `http://localhost:8000/transactions/bulk?account_id=${activeAccount?.id}`,
        { ids: selectedIds, update_data: updateData },
      );

      const count = selectedIds.length;
      onSuccess();
      onOpenChange(false);
      reset();

      toast.success(`Updated ${count} transaction${count !== 1 ? "s" : ""}`, {
        action: {
          label: "Undo",
          onClick: async () => {
            try {
              await axios.post("http://localhost:8000/transactions/bulk-restore", snapshots);
              toast.success("Reverted changes");
              onSuccess(); // refresh the table
            } catch {
              toast.error("Undo failed");
            }
          },
        },
        duration: 8000,
      });
    } catch {
      toast.error("Failed to update transactions. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => { reset(); onOpenChange(false); };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            Bulk Edit — {selectedIds.length} {selectedIds.length !== 1 ? "items" : "item"}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <p className="text-sm text-zinc-500">
            Leave any field empty to keep existing values unchanged.
          </p>

          <div className="grid gap-2">
            <Label>Vendor</Label>
            <VendorCombobox value={vendor} onChange={setVendor} />
          </div>

          <div className="grid gap-2">
            <Label>Category</Label>
            <CategoryCombobox value={category} onChange={setCategory} />
          </div>

          <div className="grid gap-2">
            <Label>Project</Label>
            <ProjectCombobox value={project} onChange={setProject} />
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

          <div className="flex items-center gap-3">
            <Label>Tax Deductible</Label>
            <div className="flex gap-2">
              {([
                [null,  "No Change", "bg-zinc-900 text-white border-zinc-900"],
                [true,  "Yes",       "bg-emerald-600 text-white border-emerald-600"],
                [false, "No",        "bg-red-500 text-white border-red-500"],
              ] as const).map(([val, label, activeClass]) => (
                <button
                  key={String(val)}
                  type="button"
                  onClick={() => setTaxDeductible(val)}
                  className={`text-xs px-3 py-1 rounded border transition-colors ${
                    taxDeductible === val
                      ? activeClass
                      : "border-zinc-200 text-zinc-500 hover:border-zinc-400"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? "Saving..." : "Apply Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
