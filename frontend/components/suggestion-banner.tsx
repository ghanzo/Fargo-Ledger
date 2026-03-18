"use client";

import { useEffect, useState, useCallback } from "react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { VendorCombobox } from "@/components/vendor-combobox";
import { CategoryCombobox } from "@/components/category-combobox";
import { ProjectCombobox } from "@/components/project-combobox";
import {
  ChevronDown,
  ChevronRight,
  Check,
  X,
  Pencil,
  Sparkles,
  CheckCheck,
} from "lucide-react";


interface SampleTransaction {
  description: string;
  amount: number;
  date: string;
}

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
  sample_transactions: SampleTransaction[];
  status: string;
  created_at: string;
}

interface SuggestionBannerProps {
  accountId: number;
  onApplied: () => void;
}

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Math.abs(n));

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
  const [expandedTxs, setExpandedTxs] = useState<Record<number, SampleTransaction[]>>({});
  const [loadingTxs, setLoadingTxs] = useState<number | null>(null);

  const fetchSuggestions = useCallback(async () => {
    try {
      const res = await api.get(`/suggestions?account_id=${accountId}`);
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
      await api.post(`/suggestions/${s.id}/approve?account_id=${accountId}`);
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
      await api.post(`/suggestions/${s.id}/approve?account_id=${accountId}`, body);
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
      await api.post(`/suggestions/${s.id}/dismiss?account_id=${accountId}`);
      await fetchSuggestions();
    } catch {
      toast.error("Failed to dismiss suggestion");
    } finally {
      setLoading(null);
    }
  };

  const handleApproveAll = async () => {
    try {
      const res = await api.post(`/suggestions/approve-all?account_id=${accountId}`);
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
            const samples = s.sample_transactions.length > 0 ? s.sample_transactions : null;

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
                      {!s.vendor_info_id && s.suggested_vendor && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 border border-blue-500/25">
                          New vendor
                        </span>
                      )}
                      {s.suggested_category && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400 border border-violet-500/25">
                          {s.suggested_category}
                        </span>
                      )}
                      {s.suggested_project && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-teal-500/15 text-teal-400 border border-teal-500/25">
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

                {/* Transaction list — expandable */}
                {(() => {
                  const allTxs = expandedTxs[s.id];
                  const displayTxs = allTxs || (samples ?? []);
                  const isExpanded = !!allTxs;
                  const isLoadingAll = loadingTxs === s.id;
                  const hasMore = s.transaction_count > 5 && !isExpanded;

                  if (displayTxs.length === 0 && s.sample_descriptions.length > 0) {
                    return (
                      <div className="text-xs text-muted-foreground space-y-0.5 pl-1">
                        {s.sample_descriptions.map((d, i) => (
                          <div key={i} className="truncate font-mono">{d}</div>
                        ))}
                      </div>
                    );
                  }

                  return displayTxs.length > 0 ? (
                    <div className="text-xs space-y-1 pl-1">
                      <div className="max-h-[300px] overflow-y-auto">
                        <table className="w-full">
                          <tbody>
                            {displayTxs.map((tx, i) => (
                              <tr key={i} className="text-muted-foreground">
                                <td className="py-0.5 pr-3 whitespace-nowrap font-mono w-24">{tx.date}</td>
                                <td className={`py-0.5 pr-3 whitespace-nowrap font-mono text-right w-24 ${tx.amount > 0 ? "text-emerald-600" : ""}`}>
                                  {tx.amount > 0 ? "+" : "-"}{fmt(tx.amount)}
                                </td>
                                <td className="py-0.5 truncate font-mono">{tx.description}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {hasMore && (
                        <button
                          className="text-xs text-blue-600 hover:underline"
                          disabled={isLoadingAll}
                          onClick={async () => {
                            setLoadingTxs(s.id);
                            try {
                              const res = await api.post(`/transactions/by-ids?account_id=${accountId}`, s.transaction_ids);
                              setExpandedTxs((prev) => ({ ...prev, [s.id]: res.data }));
                            } catch {
                              toast.error("Failed to load transactions");
                            } finally {
                              setLoadingTxs(null);
                            }
                          }}
                        >
                          {isLoadingAll ? "Loading..." : `Show all ${s.transaction_count} transactions`}
                        </button>
                      )}
                      {isExpanded && (
                        <button
                          className="text-xs text-muted-foreground hover:underline"
                          onClick={() => setExpandedTxs((prev) => {
                            const next = { ...prev };
                            delete next[s.id];
                            return next;
                          })}
                        >
                          Collapse
                        </button>
                      )}
                    </div>
                  ) : null;
                })()}

                {/* Edit mode with comboboxes */}
                {isEditing && (
                  <div className="border-t pt-2 space-y-2">
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="text-xs text-muted-foreground mb-0.5 block">Vendor</label>
                        <VendorCombobox
                          value={editValues.vendor}
                          onChange={(v) => setEditValues((prev) => ({ ...prev, vendor: v }))}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground mb-0.5 block">Category</label>
                        <CategoryCombobox
                          value={editValues.category}
                          onChange={(v) => setEditValues((prev) => ({ ...prev, category: v }))}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground mb-0.5 block">Project</label>
                        <ProjectCombobox
                          value={editValues.project}
                          onChange={(v) => setEditValues((prev) => ({ ...prev, project: v }))}
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
