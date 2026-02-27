"use client";

import { useState, useRef } from "react";
import axios from "axios";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Upload, FileText, X } from "lucide-react";

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  accountId: number;
}

export function ImportDialog({ open, onOpenChange, onSuccess, accountId }: ImportDialogProps) {
  const [file,    setFile]    = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result,  setResult]  = useState<{ imported: number; skipped: number } | null>(null);
  const [dragOver,setDragOver]= useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (f: File) => {
    if (!f.name.toLowerCase().endsWith(".csv")) {
      toast.error("Please select a .csv file");
      return;
    }
    setFile(f);
    setResult(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  const handleImport = async () => {
    if (!file) return;
    setLoading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("account_id", String(accountId));
      const res = await axios.post("http://localhost:8001/import/csv", form);
      setResult(res.data);
      toast.success(`Imported ${res.data.imported} new transactions`);
      onSuccess();
    } catch (err: any) {
      toast.error(err?.response?.data?.detail ?? "Import failed");
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setFile(null);
    setResult(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Import Transactions</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Drop zone */}
          <div
            onDrop={handleDrop}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onClick={() => inputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
              dragOver
                ? "border-blue-400 bg-blue-50"
                : "border-zinc-200 hover:border-zinc-400 hover:bg-zinc-50"
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
            {file ? (
              <div className="flex items-center justify-center gap-2">
                <FileText className="h-5 w-5 text-blue-500 shrink-0" />
                <span className="text-sm font-medium text-zinc-700 truncate max-w-[260px]">
                  {file.name}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); setFile(null); setResult(null); }}
                  className="text-zinc-400 hover:text-zinc-600 shrink-0"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <Upload className="h-8 w-8 text-zinc-300 mx-auto" />
                <p className="text-sm text-zinc-500">Drop a CSV file here, or click to browse</p>
                <p className="text-xs text-zinc-400">Wells Fargo export format</p>
              </div>
            )}
          </div>

          {/* Result */}
          {result && (
            <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-3">
              <p className="text-sm font-medium text-emerald-700">Import complete</p>
              <p className="text-xs text-emerald-600 mt-0.5">
                {result.imported} new · {result.skipped} already in database
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>Close</Button>
          <Button onClick={handleImport} disabled={!file || loading || !!result}>
            {loading ? "Importing..." : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
