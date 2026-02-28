"use client";

import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronRight,
  Check,
  X,
  Pencil,
  Sparkles,
  CheckCheck,
} from "lucide-react";

const API = "http://localhost:8001";

interface Suggestion {
  id: number;
  account_id: number;
  vendor_info_id: number | null;
  suggested_vendor: string | null;
  suggested_category: string | null;
  suggested_project: string | null;
  pattern_matched: string;
  transaction_ids: string[];
  transaction_count: number;
  sample_descriptions: string[];
  status: string;
  created_at: string;
}

interface SuggestionBannerProps {
  accountId: number;
  onApplied: () => void;
}

export function SuggestionBanner({ accountId, onApplied }: SuggestionBannerProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<{
    vendor: string;
    category: string;
    project: string;
  }>({ vendor: "", category: "", project: "" });
  const [loading, setLoading] = useState<number | null>(null);

  const fetchSuggestions = useCallback(async () => {
    try {
      const res = await axios.get(`${API}/suggestions?account_id=${accountId}`);
      setSuggestions(res.data);
    } catch {
      // silent — banner just won't show
    }
  }, [accountId]);

  useEffect(() => {
    fetchSuggestions();
  }, [fetchSuggestions]);

  const handleApprove = async (s: Suggestion) => {
    setLoading(s.id);
    try {
      await axios.post(`${API}/suggestions/${s.id}/approve`);
      toast.success(`Applied "${s.suggested_vendor}" to ${s.transaction_count} transactions`);
      await fetchSuggestions();
      onApplied();
    } catch {
      toast.error("Failed to approve suggestion");
    } finally {
      setLoading(null);
    }
  };

  const handleEditApprove = async (s: Suggestion) => {
    setLoading(s.id);
    try {
      const body: Record<string, string> = {};
      if (editValues.vendor) body.vendor = editValues.vendor;
      if (editValues.category) body.category = editValues.category;
      if (editValues.project) body.project = editValues.project;
      await axios.post(`${API}/suggestions/${s.id}/approve`, body);
      toast.success(`Applied edited values to ${s.transaction_count} transactions`);
      setEditingId(null);
      await fetchSuggestions();
      onApplied();
    } catch {
      toast.error("Failed to approve suggestion");
    } finally {
      setLoading(null);
    }
  };

  const handleDismiss = async (s: Suggestion) => {
    setLoading(s.id);
    try {
      await axios.post(`${API}/suggestions/${s.id}/dismiss`);
      await fetchSuggestions();
    } catch {
      toast.error("Failed to dismiss suggestion");
    } finally {
      setLoading(null);
    }
  };

  const handleApproveAll = async () => {
    try {
      const res = await axios.post(`${API}/suggestions/approve-all?account_id=${accountId}`);
      toast.success(res.data.message);
      await fetchSuggestions();
      onApplied();
    } catch {
      toast.error("Failed to approve all suggestions");
    }
  };

  const startEditing = (s: Suggestion) => {
    setEditingId(s.id);
    setEditValues({
      vendor: s.suggested_vendor ?? "",
      category: s.suggested_category ?? "",
      project: s.suggested_project ?? "",
    });
  };

  if (suggestions.length === 0) return null;

  return (
    <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/5 overflow-hidden">
      {/* Collapsed bar */}
      <div
        className="flex items-center justify-between px-4 py-2.5 cursor-pointer hover:bg-amber-500/10 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-amber-600" />
          ) : (
            <ChevronRight className="h-4 w-4 text-amber-600" />
          )}
          <Sparkles className="h-4 w-4 text-amber-500" />
          <span className="text-sm font-medium text-foreground">
            {suggestions.length} suggestion{suggestions.length !== 1 ? "s" : ""} pending review
          </span>
          <span className="text-xs text-muted-foreground">
            ({suggestions.reduce((n, s) => n + s.transaction_count, 0)} transactions)
          </span>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 border-amber-500/30 text-amber-700 hover:bg-amber-500/10 h-7 text-xs"
          onClick={(e) => {
            e.stopPropagation();
            handleApproveAll();
          }}
        >
          <CheckCheck className="h-3.5 w-3.5" />
          Approve All
        </Button>
      </div>

      {/* Expanded cards */}
      {expanded && (
        <div className="border-t border-amber-500/20 px-4 py-3 space-y-3">
          {suggestions.map((s) => {
            const isEditing = editingId === s.id;
            const isLoading = loading === s.id;

            return (
              <div
                key={s.id}
                className="rounded-lg border bg-background p-3 space-y-2"
              >
                {/* Header row */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-foreground">
                        {s.suggested_vendor ?? "Unknown"}
                      </span>
                      {s.suggested_category && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-600">
                          {s.suggested_category}
                        </span>
                      )}
                      {s.suggested_project && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-600">
                          {s.suggested_project}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {s.transaction_count} txn{s.transaction_count !== 1 ? "s" : ""}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Pattern: <span className="font-mono text-amber-600">{s.pattern_matched}</span>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {!isEditing && (
                      <>
                        <Button
                          size="sm"
                          className="h-7 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700"
                          onClick={() => handleApprove(s)}
                          disabled={isLoading}
                        >
                          <Check className="h-3 w-3" />
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1"
                          onClick={() => startEditing(s)}
                          disabled={isLoading}
                        >
                          <Pencil className="h-3 w-3" />
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs gap-1 text-muted-foreground hover:text-red-500"
                          onClick={() => handleDismiss(s)}
                          disabled={isLoading}
                        >
                          <X className="h-3 w-3" />
                          Dismiss
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {/* Sample descriptions */}
                {s.sample_descriptions.length > 0 && (
                  <div className="text-xs text-muted-foreground space-y-0.5 pl-1">
                    {s.sample_descriptions.map((d, i) => (
                      <div key={i} className="truncate font-mono">
                        {d}
                      </div>
                    ))}
                  </div>
                )}

                {/* Edit mode */}
                {isEditing && (
                  <div className="border-t pt-2 space-y-2">
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="text-xs text-muted-foreground mb-0.5 block">Vendor</label>
                        <Input
                          className="h-7 text-xs"
                          value={editValues.vendor}
                          onChange={(e) =>
                            setEditValues((v) => ({ ...v, vendor: e.target.value }))
                          }
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground mb-0.5 block">Category</label>
                        <Input
                          className="h-7 text-xs"
                          value={editValues.category}
                          onChange={(e) =>
                            setEditValues((v) => ({ ...v, category: e.target.value }))
                          }
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground mb-0.5 block">Project</label>
                        <Input
                          className="h-7 text-xs"
                          value={editValues.project}
                          onChange={(e) =>
                            setEditValues((v) => ({ ...v, project: e.target.value }))
                          }
                        />
                      </div>
                    </div>
                    <div className="flex gap-1.5">
                      <Button
                        size="sm"
                        className="h-7 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700"
                        onClick={() => handleEditApprove(s)}
                        disabled={isLoading}
                      >
                        <Check className="h-3 w-3" />
                        Apply
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => setEditingId(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
