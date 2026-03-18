"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import api from "@/lib/api";
import { useAccount } from "@/context/account-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Trash2, Plus, Download, RefreshCw, ChevronRight, ChevronDown, X, Search, Phone, Mail, Sparkles, Globe, MapPin, CreditCard, User, FileText, Shield, Hash, Wrench } from "lucide-react";
import { toast } from "sonner";


// ── Types ────────────────────────────────────────────────────────────────────

interface BySignEntry {
  category: string | null;
  project:  string | null;
}

interface VendorRules {
  patterns:         string[];
  default_category: string | null;
  default_project:  string | null;
  by_sign?:         { income: BySignEntry; expense: BySignEntry } | null;
  enabled:          boolean;
  assigned_count:   number;
  corrected_count:  number;
  confidence:       number;
}

interface VendorInfo {
  id:                  number;
  account_id:          number;
  vendor_name:         string;
  business_name:       string | null;
  trade_category:      string | null;
  phone:               string | null;
  email:               string | null;
  rating:              number | null;
  notes:               string | null;
  rules:               VendorRules | null;
  website:             string | null;
  address:             string | null;
  account_number:      string | null;
  contact_person:      string | null;
  payment_method:      string | null;
  tax_id:              string | null;
  license_number:      string | null;
  insurance_info:      string | null;
  service_description: string | null;
}

interface TenantData {
  id:           number;
  property_id:  number;
  name:         string;
  phone:        string | null;
  email:        string | null;
  lease_start:  string | null;
  lease_end:    string | null;
  monthly_rent: number | null;
  notes:        string | null;
}

interface PropertyData {
  id:           number;
  account_id:   number;
  project_name: string;
  address:      string | null;
  notes:        string | null;
  tenants:      TenantData[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function ConfidenceBadge({ confidence, enabled }: { confidence: number; enabled: boolean }) {
  if (!enabled) return <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">OFF</span>;
  const pct  = Math.round(confidence * 100);
  const cls  = pct >= 85 ? "bg-emerald-500/15 text-emerald-400"
             : pct >= 70 ? "bg-amber-500/15 text-amber-400"
             :              "bg-red-500/15 text-red-400";
  return <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${cls}`}>{pct}%</span>;
}

function PatternChips({
  patterns,
  onRemove,
  onAdd,
}: {
  patterns: string[];
  onRemove: (p: string) => void;
  onAdd: (p: string) => void;
}) {
  const [draft, setDraft] = useState("");

  const commit = () => {
    const val = draft.trim().toUpperCase();
    if (val && !patterns.includes(val)) onAdd(val);
    setDraft("");
  };

  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      {patterns.map((p) => (
        <span key={p} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500/15 border border-blue-500/25 text-xs text-blue-400 font-mono">
          {p}
          <button onClick={() => onRemove(p)} className="hover:text-red-500 transition-colors">
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <div className="flex items-center gap-1">
        <Input
          placeholder="+ pattern"
          className="h-6 text-xs w-28 px-2 font-mono"
          value={draft}
          onChange={(e) => setDraft(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commit(); }
            if (e.key === "Escape") setDraft("");
          }}
          onBlur={commit}
        />
      </div>
    </div>
  );
}

function EditCell({
  value,
  onSave,
  placeholder,
  type = "text",
  className = "",
}: {
  value: string | number | null;
  onSave: (val: string) => void;
  placeholder?: string;
  type?: string;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(String(value ?? ""));

  const commit = () => {
    setEditing(false);
    if (draft !== String(value ?? "")) onSave(draft);
  };

  if (editing) {
    return (
      <Input
        autoFocus
        type={type}
        className={`h-7 text-xs px-1 ${className}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") { setDraft(String(value ?? "")); setEditing(false); }
        }}
      />
    );
  }

  return (
    <span
      className={`cursor-pointer hover:bg-muted rounded px-1 py-0.5 block min-w-[40px] text-xs ${!value ? "text-muted-foreground" : ""} ${className}`}
      onClick={() => { setDraft(String(value ?? "")); setEditing(true); }}
    >
      {value ?? placeholder ?? "—"}
    </span>
  );
}

function StarRating({ rating, onChange }: { rating: number | null; onChange: (r: number | null) => void }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          className={`text-sm leading-none ${(rating ?? 0) >= n ? "text-amber-400" : "text-muted"}`}
          onClick={() => onChange(rating === n ? null : n)}
        >
          ★
        </button>
      ))}
    </div>
  );
}

// ── Vendor Card ───────────────────────────────────────────────────────────────

function VendorCard({
  vendor,
  updateVendor,
  updateRules,
  deleteVendor,
  resetConfidence,
  enrichVendor,
  clearEnrichment,
}: {
  vendor: VendorInfo;
  updateVendor: (id: number, field: string, value: string | number | null) => void;
  updateRules: (vendor: VendorInfo, patch: Partial<VendorRules>) => void;
  deleteVendor: (id: number, name: string) => void;
  resetConfidence: (vendor: VendorInfo) => void;
  enrichVendor: (id: number) => void;
  clearEnrichment: (id: number, name: string) => void;
}) {
  const [rulesOpen, setRulesOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const v = vendor;
  const rules = v.rules;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="p-3 pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-semibold text-sm text-foreground leading-tight">{v.vendor_name}</div>
            <div className="mt-0.5">
              <EditCell value={v.business_name} placeholder="Business name" onSave={(val) => updateVendor(v.id, "business_name", val)} className="text-muted-foreground" />
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {v.trade_category && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-600 whitespace-nowrap">
                {v.trade_category}
              </span>
            )}
            {rules && (
              <ConfidenceBadge confidence={rules.confidence} enabled={rules.enabled} />
            )}
            <button className="p-1 text-muted-foreground hover:text-purple-500 transition-colors" onClick={() => enrichVendor(v.id)} title="Enrich with AI">
              <Sparkles className="h-3.5 w-3.5" />
            </button>
            <button className="p-1 text-muted-foreground hover:text-red-500 transition-colors" onClick={() => deleteVendor(v.id, v.vendor_name)}>
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-3 pt-0 space-y-1.5">
        {/* Contact info */}
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-xs">
            <Phone className="h-3 w-3 text-muted-foreground shrink-0" />
            {v.phone ? (
              <a href={`tel:${v.phone}`} className="text-blue-600 hover:underline">{v.phone}</a>
            ) : (
              <EditCell value={v.phone} placeholder="Add phone" type="tel" onSave={(val) => updateVendor(v.id, "phone", val)} />
            )}
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <Mail className="h-3 w-3 text-muted-foreground shrink-0" />
            {v.email ? (
              <a href={`mailto:${v.email}`} className="text-blue-600 hover:underline truncate">{v.email}</a>
            ) : (
              <EditCell value={v.email} placeholder="Add email" type="email" onSave={(val) => updateVendor(v.id, "email", val)} />
            )}
          </div>
        </div>

        {/* Rating */}
        <StarRating rating={v.rating} onChange={(r) => updateVendor(v.id, "rating", r)} />

        {/* Trade category (editable) */}
        {!v.trade_category && (
          <EditCell value={v.trade_category} placeholder="Set trade category" onSave={(val) => updateVendor(v.id, "trade_category", val)} />
        )}

        {/* Notes */}
        <div className="text-xs">
          <EditCell value={v.notes} placeholder="Add notes" onSave={(val) => updateVendor(v.id, "notes", val)} />
        </div>

        {/* Service description */}
        {v.service_description && (
          <div className="text-xs text-muted-foreground italic">{v.service_description}</div>
        )}

        {/* Collapsible Details Section */}
        <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
          <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-full pt-1 border-t">
            {detailsOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            <span className="font-medium">Details</span>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2 space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs">
              <Globe className="h-3 w-3 text-muted-foreground shrink-0" />
              {v.website ? (
                <a href={v.website} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate">{v.website}</a>
              ) : (
                <EditCell value={v.website} placeholder="Add website" onSave={(val) => updateVendor(v.id, "website", val)} />
              )}
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <MapPin className="h-3 w-3 text-muted-foreground shrink-0" />
              <EditCell value={v.address} placeholder="Add address" onSave={(val) => updateVendor(v.id, "address", val)} />
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <User className="h-3 w-3 text-muted-foreground shrink-0" />
              <EditCell value={v.contact_person} placeholder="Contact person" onSave={(val) => updateVendor(v.id, "contact_person", val)} />
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <Hash className="h-3 w-3 text-muted-foreground shrink-0" />
              <EditCell value={v.account_number} placeholder="Account number" onSave={(val) => updateVendor(v.id, "account_number", val)} />
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <CreditCard className="h-3 w-3 text-muted-foreground shrink-0" />
              <EditCell value={v.payment_method} placeholder="Payment method" onSave={(val) => updateVendor(v.id, "payment_method", val)} />
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
              <EditCell value={v.tax_id} placeholder="Tax ID / EIN" onSave={(val) => updateVendor(v.id, "tax_id", val)} />
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <Shield className="h-3 w-3 text-muted-foreground shrink-0" />
              <EditCell value={v.license_number} placeholder="License number" onSave={(val) => updateVendor(v.id, "license_number", val)} />
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <Shield className="h-3 w-3 text-muted-foreground shrink-0" />
              <EditCell value={v.insurance_info} placeholder="Insurance info" onSave={(val) => updateVendor(v.id, "insurance_info", val)} />
            </div>
            {!v.service_description && (
              <div className="flex items-center gap-1.5 text-xs">
                <Wrench className="h-3 w-3 text-muted-foreground shrink-0" />
                <EditCell value={v.service_description} placeholder="Service description" onSave={(val) => updateVendor(v.id, "service_description", val)} />
              </div>
            )}
            {/* Clear & Re-enrich */}
            {(v.business_name || v.trade_category || v.website || v.address || v.phone || v.service_description) && (
              <button
                className="text-xs text-muted-foreground hover:text-red-500 underline mt-1"
                onClick={() => clearEnrichment(v.id, v.vendor_name)}
              >
                Clear AI data &amp; re-enrich
              </button>
            )}
          </CollapsibleContent>
        </Collapsible>

        {/* Expandable Rules Section */}
        <Collapsible open={rulesOpen} onOpenChange={setRulesOpen}>
          <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-full pt-1 border-t">
            {rulesOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            <span className="font-medium">Auto-Assign Rules</span>
            {rules && (
              <div className="flex items-center gap-1 ml-auto">
                <button
                  className={`w-7 h-4 rounded-full transition-colors ${rules.enabled ? "bg-blue-500" : "bg-muted"}`}
                  onClick={(e) => { e.stopPropagation(); updateRules(v, { enabled: !rules.enabled }); }}
                  title={rules.enabled ? "Disable auto-assign" : "Enable auto-assign"}
                >
                  <span className={`block w-3 h-3 rounded-full bg-background shadow mx-0.5 transition-transform ${rules.enabled ? "translate-x-3" : "translate-x-0"}`} />
                </button>
              </div>
            )}
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2 space-y-3">
            {/* Patterns */}
            <div>
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                Match Patterns
              </div>
              <PatternChips
                patterns={rules?.patterns ?? []}
                onRemove={(p) => updateRules(v, { patterns: (rules?.patterns ?? []).filter((x) => x !== p) })}
                onAdd={(p) => updateRules(v, { patterns: [...(rules?.patterns ?? []), p] })}
              />
              {(!rules?.patterns?.length) && (
                <p className="text-xs text-muted-foreground mt-1">No patterns yet.</p>
              )}
            </div>

            {/* Category & Project */}
            <div className="space-y-2">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Category &amp; Project
              </div>
              {rules?.by_sign ? (
                <>
                  <div>
                    <div className="text-xs text-emerald-700 font-medium mb-1">Income (+)</div>
                    <div className="flex gap-2 flex-wrap">
                      <EditCell value={rules.by_sign.income.category} placeholder="category"
                        onSave={(val) => updateRules(v, { by_sign: { ...rules.by_sign!, income: { ...rules.by_sign!.income, category: val || null } } })}
                        className="border border-border rounded w-full" />
                      <EditCell value={rules.by_sign.income.project} placeholder="project"
                        onSave={(val) => updateRules(v, { by_sign: { ...rules.by_sign!, income: { ...rules.by_sign!.income, project: val || null } } })}
                        className="border border-border rounded w-full" />
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-red-600 font-medium mb-1">Expense (-)</div>
                    <div className="flex gap-2 flex-wrap">
                      <EditCell value={rules.by_sign.expense.category} placeholder="category"
                        onSave={(val) => updateRules(v, { by_sign: { ...rules.by_sign!, expense: { ...rules.by_sign!.expense, category: val || null } } })}
                        className="border border-border rounded w-full" />
                      <EditCell value={rules.by_sign.expense.project} placeholder="project"
                        onSave={(val) => updateRules(v, { by_sign: { ...rules.by_sign!, expense: { ...rules.by_sign!.expense, project: val || null } } })}
                        className="border border-border rounded w-full" />
                    </div>
                  </div>
                  <button className="text-xs text-muted-foreground hover:text-foreground underline" onClick={() => updateRules(v, { by_sign: null })}>Remove split</button>
                </>
              ) : (
                <>
                  <div>
                    <div className="text-xs text-muted-foreground mb-0.5">Default Category</div>
                    <EditCell value={rules?.default_category ?? null} placeholder="none"
                      onSave={(val) => updateRules(v, { default_category: val || null })}
                      className="border border-border rounded" />
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-0.5">Default Project</div>
                    <EditCell value={rules?.default_project ?? null} placeholder="none"
                      onSave={(val) => updateRules(v, { default_project: val || null })}
                      className="border border-border rounded" />
                  </div>
                  <button className="text-xs text-blue-600 hover:underline"
                    onClick={() => updateRules(v, {
                      by_sign: {
                        income:  { category: rules?.default_category ?? null, project: rules?.default_project ?? null },
                        expense: { category: rules?.default_category ?? null, project: rules?.default_project ?? null },
                      },
                    })}>
                    + Split by income / expense
                  </button>
                </>
              )}
            </div>

            {/* Stats */}
            {rules && (
              <div className="text-xs text-muted-foreground space-y-1">
                <div className="font-semibold uppercase tracking-wider">Stats</div>
                <div className="flex justify-between"><span>Assigned:</span><span className="font-mono text-foreground">{rules.assigned_count}</span></div>
                <div className="flex justify-between"><span>Corrected:</span><span className={`font-mono ${rules.corrected_count > 0 ? "text-amber-600" : "text-foreground"}`}>{rules.corrected_count}</span></div>
                <div className="flex justify-between"><span>Confidence:</span><ConfidenceBadge confidence={rules.confidence} enabled={rules.enabled} /></div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${rules.confidence >= 0.85 ? "bg-emerald-500" : rules.confidence >= 0.70 ? "bg-amber-400" : "bg-red-400"}`}
                    style={{ width: `${Math.round(rules.confidence * 100)}%` }}
                  />
                </div>
                {rules.corrected_count > 0 && (
                  <button className="text-xs text-blue-600 hover:underline" onClick={() => resetConfidence(v)}>Reset correction history</button>
                )}
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

// ── Vendors Tab ───────────────────────────────────────────────────────────────

function VendorsTab() {
  const { activeAccount } = useAccount();
  const [vendors,      setVendors]      = useState<VendorInfo[]>([]);
  const [importing,    setImporting]    = useState(false);
  const [learning,     setLearning]     = useState(false);
  const [researching,  setResearching]  = useState(false);
  const [enriching,    setEnriching]    = useState(false);
  const [addingNew,    setAddingNew]    = useState(false);
  const [newName,      setNewName]      = useState("");
  const [search,       setSearch]       = useState("");

  const fetchVendors = useCallback(async () => {
    if (!activeAccount) return;
    const res = await api.get(`/vendor-info?account_id=${activeAccount.id}`);
    setVendors(res.data);
  }, [activeAccount]);

  useEffect(() => { fetchVendors(); }, [fetchVendors]);

  const handleImport = async () => {
    if (!activeAccount) return;
    setImporting(true);
    try {
      const res = await api.post(`/vendor-info/import-from-transactions?account_id=${activeAccount.id}`);
      await fetchVendors();
      alert(`Imported ${res.data.created} vendors (${res.data.already_existed} already existed)`);
    } finally {
      setImporting(false);
    }
  };

  const handleLearn = async () => {
    if (!activeAccount) return;
    setLearning(true);
    try {
      const res = await api.post(`/vendor-info/rebuild-rules?account_id=${activeAccount.id}`);
      await fetchVendors();
      alert(`Learned from history: ${res.data.updated} vendors updated, ${res.data.ambiguous_patterns_resolved} ambiguous patterns resolved.`);
    } finally {
      setLearning(false);
    }
  };

  const handleResearch = async () => {
    if (!activeAccount) return;
    setResearching(true);
    try {
      const res = await api.post(`/research/vendors?account_id=${activeAccount.id}`);
      const d = res.data;
      const parts: string[] = [];
      if (d.rule_matched > 0) parts.push(`${d.rule_matched} matched by rules`);
      if (d.suggestions_created > 0) parts.push(`${d.suggestions_created} new suggestion${d.suggestions_created !== 1 ? "s" : ""}`);
      if (d.cards_created > 0) parts.push(`${d.cards_created} vendor card${d.cards_created !== 1 ? "s" : ""} created`);
      if (parts.length > 0) {
        toast.success(parts.join(", ") + ". Review suggestions on Transactions page.");
        await fetchVendors();
      } else if (d.groups_found === 0 && d.rule_matched === 0) {
        toast.info("No uncategorized transactions to research.");
      } else {
        toast.info(`${d.skipped_existing} already pending, ${d.skipped_transfers} transfers skipped.`);
      }
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      if (e?.response?.status === 503) {
        toast.error(detail || "Cannot connect to LLM service. Check your XAI_API_KEY.");
      } else {
        toast.error(detail || "Research failed.");
      }
    } finally {
      setResearching(false);
    }
  };

  const updateVendor = async (id: number, field: string, value: string | number | null) => {
    await api.put(`/vendor-info/${id}?account_id=${activeAccount!.id}`, { [field]: value || null });
    await fetchVendors();
  };

  const updateRules = async (vendor: VendorInfo, patch: Partial<VendorRules>) => {
    const existing = vendor.rules ?? {
      patterns: [], default_category: null, default_project: null,
      enabled: false, assigned_count: 0, corrected_count: 0, confidence: 1,
    };
    const newRules = { ...existing, ...patch };
    await api.put(`/vendor-info/${vendor.id}?account_id=${activeAccount!.id}`, { rules: newRules });
    await fetchVendors();
  };

  const addVendor = async () => {
    if (!activeAccount || !newName.trim()) return;
    try {
      await api.post(`/vendor-info?account_id=${activeAccount.id}`, { vendor_name: newName.trim() });
      setNewName(""); setAddingNew(false);
      await fetchVendors();
    } catch (e: any) {
      alert(e?.response?.data?.detail ?? "Error adding vendor");
    }
  };

  const deleteVendor = async (id: number, name: string) => {
    if (!window.confirm(`Delete vendor "${name}"?`)) return;
    await api.delete(`/vendor-info/${id}?account_id=${activeAccount!.id}`);
    await fetchVendors();
  };

  const resetConfidence = async (vendor: VendorInfo) => {
    if (!vendor.rules) return;
    if (!window.confirm(`Reset correction history for "${vendor.vendor_name}"? This will re-enable auto-assign.`)) return;
    await updateRules(vendor, { corrected_count: 0, confidence: 1.0, enabled: true });
  };

  const enrichVendor = async (id: number) => {
    const toastId = toast.loading("Enriching vendor...");
    try {
      await api.post(`/vendor-info/${id}/enrich?account_id=${activeAccount!.id}`);
      await fetchVendors();
      toast.success("Vendor enriched with AI data.", { id: toastId });
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      if (e?.response?.status === 503) {
        toast.error(detail || "Cannot connect to LLM. Make sure it's running.", { id: toastId });
      } else {
        toast.error(detail || "Enrichment failed.", { id: toastId });
      }
    }
  };

  const clearEnrichment = async (id: number, name: string) => {
    if (!window.confirm(`Clear AI-populated data for "${name}" and re-enrich?`)) return;
    const toastId = toast.loading(`Re-enriching "${name}"...`);
    try {
      await api.post(`/vendor-info/${id}/clear-enrichment?account_id=${activeAccount!.id}`);
      await api.post(`/vendor-info/${id}/enrich?account_id=${activeAccount!.id}`);
      await fetchVendors();
      toast.success(`Re-enriched "${name}".`, { id: toastId });
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      toast.error(detail || "Re-enrichment failed.", { id: toastId });
    }
  };

  const handleEnrichAll = async () => {
    if (!activeAccount) return;
    setEnriching(true);
    try {
      const res = await api.post(`/vendor-info/enrich-all?account_id=${activeAccount.id}`);
      await fetchVendors();
      toast.success(`Enriched ${res.data.updated} of ${res.data.total} vendors.`);
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      if (e?.response?.status === 503) {
        toast.error(detail || "Cannot connect to LLM. Make sure it's running.");
      } else {
        toast.error(detail || "Enrich all failed.");
      }
    } finally {
      setEnriching(false);
    }
  };

  // Filter by search
  const filtered = useMemo(() => {
    if (!search.trim()) return vendors;
    const q = search.toLowerCase();
    return vendors.filter((v) =>
      v.vendor_name.toLowerCase().includes(q) ||
      (v.business_name ?? "").toLowerCase().includes(q) ||
      (v.trade_category ?? "").toLowerCase().includes(q) ||
      (v.phone ?? "").toLowerCase().includes(q) ||
      (v.email ?? "").toLowerCase().includes(q) ||
      (v.notes ?? "").toLowerCase().includes(q)
    );
  }, [vendors, search]);

  // Group by trade_category
  const sortedGroups = useMemo(() => {
    const groups = new Map<string, VendorInfo[]>();
    for (const v of filtered) {
      const key = v.trade_category ?? "(No Trade)";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(v);
    }
    return [...groups.entries()].sort(([a], [b]) => {
      if (a === "(No Trade)") return 1;
      if (b === "(No Trade)") return -1;
      return a.localeCompare(b);
    });
  }, [filtered]);

  const rulesCount = vendors.filter((v) => v.rules?.patterns?.length).length;

  return (
    <div>
      {/* Search bar */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search vendors..."
          className="pl-9 h-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onClick={() => setSearch("")}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <Button size="sm" variant="outline" onClick={() => setAddingNew(true)} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" /> Add Vendor
        </Button>
        <Button size="sm" variant="outline" onClick={handleImport} disabled={importing} className="gap-1.5">
          <Download className="h-3.5 w-3.5" />
          {importing ? "Importing..." : "Import from Txns"}
        </Button>
        <Button size="sm" variant="outline" onClick={handleLearn} disabled={learning} className="gap-1.5 border-blue-500/30 text-blue-400 hover:bg-blue-500/10">
          <RefreshCw className={`h-3.5 w-3.5 ${learning ? "animate-spin" : ""}`} />
          {learning ? "Learning..." : "Learn Rules"}
        </Button>
        <Button size="sm" variant="outline" onClick={handleResearch} disabled={researching} className="gap-1.5 border-purple-500/30 text-purple-400 hover:bg-purple-500/10">
          <Sparkles className={`h-3.5 w-3.5 ${researching ? "animate-pulse" : ""}`} />
          {researching ? "Researching..." : "Research Vendors"}
        </Button>
        <Button size="sm" variant="outline" onClick={handleEnrichAll} disabled={enriching} className="gap-1.5 border-amber-500/30 text-amber-400 hover:bg-amber-500/10">
          <Sparkles className={`h-3.5 w-3.5 ${enriching ? "animate-pulse" : ""}`} />
          {enriching ? "Enriching..." : "Enrich All"}
        </Button>
        <span className="text-xs text-muted-foreground ml-auto">
          {filtered.length}{search ? ` of ${vendors.length}` : ""} vendors · {rulesCount} with rules
        </span>
      </div>

      {/* Add vendor inline */}
      {addingNew && (
        <div className="flex items-center gap-2 mb-4 p-2 bg-muted rounded border">
          <Input
            autoFocus placeholder="Vendor name"
            className="h-7 text-xs w-48"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addVendor();
              if (e.key === "Escape") { setAddingNew(false); setNewName(""); }
            }}
          />
          <Button size="sm" onClick={addVendor} disabled={!newName.trim()}>Add</Button>
          <Button size="sm" variant="ghost" onClick={() => { setAddingNew(false); setNewName(""); }}>Cancel</Button>
        </div>
      )}

      {/* Card grid grouped by trade_category */}
      <div className="space-y-4">
        {sortedGroups.map(([trade, tradeVendors]) => (
          <Collapsible key={trade} defaultOpen>
            <CollapsibleTrigger className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 hover:text-foreground transition-colors group w-full">
              <ChevronDown className="h-3.5 w-3.5 group-data-[state=closed]:rotate-[-90deg] transition-transform" />
              {trade} ({tradeVendors.length})
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mb-2">
                {tradeVendors.map((v) => (
                  <VendorCard
                    key={v.id}
                    vendor={v}
                    updateVendor={updateVendor}
                    updateRules={updateRules}
                    deleteVendor={deleteVendor}
                    resetConfidence={resetConfidence}
                    enrichVendor={enrichVendor}
                    clearEnrichment={clearEnrichment}
                  />
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        ))}
        {filtered.length === 0 && (
          <div className="text-center py-12 text-muted-foreground text-sm border rounded">
            {search ? "No vendors match your search." : "No vendors yet. Import from transactions or add manually."}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tenants & Properties Tab ──────────────────────────────────────────────────

function PropertiesTab() {
  const { activeAccount } = useAccount();
  const [properties,    setProperties]    = useState<PropertyData[]>([]);
  const [addingProperty, setAddingProperty] = useState(false);
  const [newProp,        setNewProp]        = useState({ project_name: "", address: "", notes: "" });
  const [addingTenant,  setAddingTenant]  = useState<Map<number, Partial<TenantData>>>(new Map());

  const fetchProperties = useCallback(async () => {
    if (!activeAccount) return;
    const res = await api.get(`/properties?account_id=${activeAccount.id}`);
    setProperties(res.data);
  }, [activeAccount]);

  useEffect(() => { fetchProperties(); }, [fetchProperties]);

  const createProperty = async () => {
    if (!activeAccount || !newProp.project_name.trim()) return;
    try {
      await api.post(`/properties?account_id=${activeAccount.id}`, {
        project_name: newProp.project_name.trim(),
        address: newProp.address || null,
        notes: newProp.notes || null,
      });
      setNewProp({ project_name: "", address: "", notes: "" });
      setAddingProperty(false);
      await fetchProperties();
    } catch (e: any) {
      alert(e?.response?.data?.detail ?? "Error creating property");
    }
  };

  const updateProperty = async (pid: number, field: string, value: string) => {
    await api.put(`/properties/${pid}?account_id=${activeAccount!.id}`, { [field]: value || null });
    await fetchProperties();
  };

  const deleteProperty = async (pid: number, name: string) => {
    if (!window.confirm(`Delete project "${name}" and all its tenants?`)) return;
    await api.delete(`/properties/${pid}?account_id=${activeAccount!.id}`);
    await fetchProperties();
  };

  const startAddingTenant = (pid: number) => {
    setAddingTenant((prev) => {
      const next = new Map(prev);
      next.set(pid, { name: "", phone: "", email: "", lease_start: "", lease_end: "", monthly_rent: undefined, notes: "" });
      return next;
    });
  };

  const cancelAddingTenant = (pid: number) =>
    setAddingTenant((prev) => { const next = new Map(prev); next.delete(pid); return next; });

  const createTenant = async (pid: number) => {
    const draft = addingTenant.get(pid);
    if (!draft?.name?.trim()) return;
    await api.post(`/properties/${pid}/tenants?account_id=${activeAccount!.id}`, {
      name: draft.name, phone: draft.phone || null, email: draft.email || null,
      lease_start: draft.lease_start || null, lease_end: draft.lease_end || null,
      monthly_rent: draft.monthly_rent ?? null, notes: draft.notes || null,
    });
    cancelAddingTenant(pid);
    await fetchProperties();
  };

  const updateTenant = async (tid: number, field: string, value: string | number | null) => {
    await api.put(`/tenants/${tid}?account_id=${activeAccount!.id}`, { [field]: value || null });
    await fetchProperties();
  };

  const deleteTenant = async (tid: number, name: string) => {
    if (!window.confirm(`Delete tenant "${name}"?`)) return;
    await api.delete(`/tenants/${tid}?account_id=${activeAccount!.id}`);
    await fetchProperties();
  };

  const inputCls = "h-7 text-xs px-1";

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <Button size="sm" variant="outline" onClick={() => setAddingProperty(true)} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" /> Add Project
        </Button>
        <span className="text-xs text-muted-foreground ml-auto">{properties.length} projects · Click any cell to edit</span>
      </div>

      {addingProperty && (
        <div className="flex items-center gap-2 mb-4 p-3 bg-muted rounded border">
          <Input autoFocus placeholder="Project name *" className={`${inputCls} w-44`}
            value={newProp.project_name} onChange={(e) => setNewProp((p) => ({ ...p, project_name: e.target.value }))} />
          <Input placeholder="Address" className={`${inputCls} w-56`}
            value={newProp.address} onChange={(e) => setNewProp((p) => ({ ...p, address: e.target.value }))} />
          <Input placeholder="Notes" className={`${inputCls} w-48`}
            value={newProp.notes} onChange={(e) => setNewProp((p) => ({ ...p, notes: e.target.value }))} />
          <Button size="sm" onClick={createProperty} disabled={!newProp.project_name.trim()}>Add</Button>
          <Button size="sm" variant="ghost" onClick={() => { setAddingProperty(false); setNewProp({ project_name: "", address: "", notes: "" }); }}>Cancel</Button>
        </div>
      )}

      <div className="space-y-4">
        {properties.map((prop) => {
          const draft = addingTenant.get(prop.id);
          return (
            <div key={prop.id} className="border rounded overflow-hidden">
              <div className="bg-foreground text-background px-3 py-2 flex items-center gap-3">
                <span className="font-semibold text-sm">{prop.project_name}</span>
                <EditCell value={prop.address} placeholder="Address" onSave={(val) => updateProperty(prop.id, "address", val)} className="text-muted-foreground" />
                <div className="ml-auto flex items-center gap-2">
                  <button className="text-xs text-muted-foreground hover:text-white underline" onClick={() => startAddingTenant(prop.id)}>+ Add Tenant</button>
                  <button className="p-1 text-muted-foreground hover:text-red-400" onClick={() => deleteProperty(prop.id, prop.project_name)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <table className="w-full text-xs border-collapse">
                <thead className="bg-muted border-b">
                  <tr>
                    <th className="text-left px-2 py-1.5 font-medium text-muted-foreground w-[160px]">Name</th>
                    <th className="text-left px-2 py-1.5 font-medium text-muted-foreground w-[120px]">Phone</th>
                    <th className="text-left px-2 py-1.5 font-medium text-muted-foreground w-[160px]">Email</th>
                    <th className="text-left px-2 py-1.5 font-medium text-muted-foreground w-[100px]">Lease Start</th>
                    <th className="text-left px-2 py-1.5 font-medium text-muted-foreground w-[100px]">Lease End</th>
                    <th className="text-left px-2 py-1.5 font-medium text-muted-foreground w-[90px]">$/mo</th>
                    <th className="text-left px-2 py-1.5 font-medium text-muted-foreground">Notes</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {prop.tenants.map((t) => (
                    <tr key={t.id} className="hover:bg-muted/50">
                      <td className="px-2 py-1"><EditCell value={t.name} onSave={(val) => updateTenant(t.id, "name", val)} /></td>
                      <td className="px-2 py-1"><EditCell value={t.phone} placeholder="Phone" type="tel" onSave={(val) => updateTenant(t.id, "phone", val)} /></td>
                      <td className="px-2 py-1"><EditCell value={t.email} placeholder="Email" type="email" onSave={(val) => updateTenant(t.id, "email", val)} /></td>
                      <td className="px-2 py-1"><EditCell value={t.lease_start} placeholder="YYYY-MM-DD" type="date" onSave={(val) => updateTenant(t.id, "lease_start", val)} /></td>
                      <td className="px-2 py-1"><EditCell value={t.lease_end} placeholder="YYYY-MM-DD" type="date" onSave={(val) => updateTenant(t.id, "lease_end", val)} /></td>
                      <td className="px-2 py-1"><EditCell value={t.monthly_rent} placeholder="0.00" type="number" onSave={(val) => updateTenant(t.id, "monthly_rent", parseFloat(val) || null)} /></td>
                      <td className="px-2 py-1"><EditCell value={t.notes} placeholder="Notes" onSave={(val) => updateTenant(t.id, "notes", val)} /></td>
                      <td className="px-1">
                        <button className="p-1 text-muted-foreground hover:text-red-500" onClick={() => deleteTenant(t.id, t.name)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}

                  {draft && (
                    <tr className="bg-blue-500/10">
                      <td className="px-2 py-1">
                        <Input autoFocus placeholder="Name *" className={`${inputCls} w-36`} value={draft.name ?? ""}
                          onChange={(e) => setAddingTenant((prev) => { const next = new Map(prev); next.set(prop.id, { ...next.get(prop.id)!, name: e.target.value }); return next; })} />
                      </td>
                      {(["phone","email"] as const).map((f) => (
                        <td key={f} className="px-2 py-1">
                          <Input placeholder={f} className={`${inputCls} w-24`} value={(draft as any)[f] ?? ""}
                            onChange={(e) => setAddingTenant((prev) => { const next = new Map(prev); next.set(prop.id, { ...next.get(prop.id)!, [f]: e.target.value }); return next; })} />
                        </td>
                      ))}
                      {(["lease_start","lease_end"] as const).map((f) => (
                        <td key={f} className="px-2 py-1">
                          <Input type="date" className={`${inputCls} w-28`} value={(draft as any)[f] ?? ""}
                            onChange={(e) => setAddingTenant((prev) => { const next = new Map(prev); next.set(prop.id, { ...next.get(prop.id)!, [f]: e.target.value }); return next; })} />
                        </td>
                      ))}
                      <td className="px-2 py-1">
                        <Input type="number" placeholder="0.00" className={`${inputCls} w-20`} value={draft.monthly_rent ?? ""}
                          onChange={(e) => setAddingTenant((prev) => { const next = new Map(prev); next.set(prop.id, { ...next.get(prop.id)!, monthly_rent: parseFloat(e.target.value) || undefined }); return next; })} />
                      </td>
                      <td className="px-2 py-1">
                        <Input placeholder="Notes" className={`${inputCls} w-36`} value={draft.notes ?? ""}
                          onChange={(e) => setAddingTenant((prev) => { const next = new Map(prev); next.set(prop.id, { ...next.get(prop.id)!, notes: e.target.value }); return next; })} />
                      </td>
                      <td className="px-1 flex gap-1 items-center pt-1">
                        <Button size="sm" className="h-6 text-xs px-2" onClick={() => createTenant(prop.id)} disabled={!draft.name?.trim()}>✓</Button>
                        <Button size="sm" variant="ghost" className="h-6 text-xs px-1" onClick={() => cancelAddingTenant(prop.id)}>✕</Button>
                      </td>
                    </tr>
                  )}

                  {prop.tenants.length === 0 && !draft && (
                    <tr>
                      <td colSpan={8} className="px-4 py-4 text-center text-muted-foreground text-xs">
                        No tenants yet.{" "}
                        <button className="underline hover:text-muted-foreground" onClick={() => startAddingTenant(prop.id)}>Add one</button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          );
        })}
        {properties.length === 0 && (
          <div className="text-center py-12 text-muted-foreground text-sm border rounded">
            No projects yet. Click "Add Project" to get started.
          </div>
        )}
      </div>
    </div>
  );
}

// ── Chart of Accounts Tab ────────────────────────────────────────────────────

interface CategoryMapping {
  id: number;
  account_id: number;
  category: string;
  account_code: string;
  account_name: string;
  account_type: string;
}

function ChartOfAccountsTab() {
  const { activeAccount } = useAccount();
  const [mappings, setMappings] = useState<CategoryMapping[]>([]);
  const [unmapped, setUnmapped] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ category: "", account_code: "", account_name: "", account_type: "expense" });

  const fetchData = useCallback(async () => {
    if (!activeAccount) return;
    const [mapRes, unmapRes] = await Promise.all([
      api.get(`/category-map?account_id=${activeAccount.id}`),
      api.get(`/category-map/unmapped?account_id=${activeAccount.id}`),
    ]);
    setMappings(mapRes.data);
    setUnmapped(unmapRes.data);
  }, [activeAccount]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const createMapping = async () => {
    if (!activeAccount || !draft.category.trim() || !draft.account_code.trim() || !draft.account_name.trim()) return;
    try {
      await api.post(`/category-map?account_id=${activeAccount.id}`, {
        category: draft.category.trim(),
        account_code: draft.account_code.trim(),
        account_name: draft.account_name.trim(),
        account_type: draft.account_type,
      });
      setDraft({ category: "", account_code: "", account_name: "", account_type: "expense" });
      setAdding(false);
      await fetchData();
    } catch (e: any) {
      alert(e?.response?.data?.detail ?? "Error creating mapping");
    }
  };

  const updateMapping = async (id: number, field: string, value: string) => {
    await api.put(`/category-map/${id}?account_id=${activeAccount!.id}`, { [field]: value });
    await fetchData();
  };

  const deleteMapping = async (id: number, category: string) => {
    if (!window.confirm(`Remove mapping for "${category}"?`)) return;
    await api.delete(`/category-map/${id}?account_id=${activeAccount!.id}`);
    await fetchData();
  };

  const quickMap = (category: string) => {
    setDraft({ category, account_code: "", account_name: "", account_type: "expense" });
    setAdding(true);
  };

  // Group mappings by account_code
  const grouped = useMemo(() => {
    const groups = new Map<string, CategoryMapping[]>();
    for (const m of mappings) {
      const key = `${m.account_code} - ${m.account_name}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(m);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [mappings]);

  const inputCls = "h-7 text-xs px-1";

  return (
    <div>
      {/* Unmapped categories banner */}
      {unmapped.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-500/25 bg-amber-500/10 p-3">
          <div className="text-xs font-semibold text-amber-600 mb-2">
            {unmapped.length} unmapped categor{unmapped.length === 1 ? "y" : "ies"} — click to assign an account code
          </div>
          <div className="flex flex-wrap gap-1.5">
            {unmapped.map((cat) => (
              <button
                key={cat}
                onClick={() => quickMap(cat)}
                className="px-2 py-1 rounded text-xs bg-amber-500/20 text-amber-700 hover:bg-amber-500/30 transition-colors"
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-3 mb-4">
        <Button size="sm" variant="outline" onClick={() => setAdding(true)} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" /> Add Mapping
        </Button>
        <span className="text-xs text-muted-foreground ml-auto">
          {mappings.length} mapped · {unmapped.length} unmapped
        </span>
      </div>

      {/* Add mapping inline */}
      {adding && (
        <div className="flex items-center gap-2 mb-4 p-3 bg-muted rounded border flex-wrap">
          <Input
            autoFocus
            placeholder="Category *"
            className={`${inputCls} w-40`}
            value={draft.category}
            onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
          />
          <Input
            placeholder="Code (e.g. 5200) *"
            className={`${inputCls} w-32`}
            value={draft.account_code}
            onChange={(e) => setDraft((d) => ({ ...d, account_code: e.target.value }))}
          />
          <Input
            placeholder="Account Name (e.g. Meals & Entertainment) *"
            className={`${inputCls} w-64`}
            value={draft.account_name}
            onChange={(e) => setDraft((d) => ({ ...d, account_name: e.target.value }))}
          />
          <select
            className="h-7 text-xs px-1 rounded border border-border bg-background"
            value={draft.account_type}
            onChange={(e) => setDraft((d) => ({ ...d, account_type: e.target.value }))}
          >
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </select>
          <Button size="sm" onClick={createMapping} disabled={!draft.category.trim() || !draft.account_code.trim() || !draft.account_name.trim()}>
            Add
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setDraft({ category: "", account_code: "", account_name: "", account_type: "expense" }); }}>
            Cancel
          </Button>
        </div>
      )}

      {/* Mappings table grouped by account code */}
      <div className="border rounded overflow-hidden">
        <table className="w-full text-xs border-collapse">
          <thead className="bg-muted border-b">
            <tr>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground w-[100px]">Code</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground w-[220px]">Account Name</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground w-[80px]">Type</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Category</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {grouped.map(([groupLabel, items]) => (
              <React.Fragment key={groupLabel}>
                {items.map((m, i) => (
                  <tr key={m.id} className="hover:bg-muted/50">
                    <td className="px-3 py-2">
                      {i === 0 ? (
                        <EditCell
                          value={m.account_code}
                          onSave={(val) => {
                            items.forEach((item) => updateMapping(item.id, "account_code", val));
                          }}
                          className="font-mono font-semibold"
                        />
                      ) : (
                        <span className="text-muted-foreground font-mono">{m.account_code}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {i === 0 ? (
                        <EditCell
                          value={m.account_name}
                          onSave={(val) => {
                            items.forEach((item) => updateMapping(item.id, "account_name", val));
                          }}
                        />
                      ) : (
                        <span className="text-muted-foreground">{m.account_name}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${
                        m.account_type === "income"
                          ? "bg-emerald-500/15 text-emerald-400"
                          : "bg-red-500/15 text-red-400"
                      }`}>
                        {m.account_type}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-400 border border-violet-500/25 text-xs">
                        {m.category}
                      </span>
                    </td>
                    <td className="px-1">
                      <button className="p-1 text-muted-foreground hover:text-red-500" onClick={() => deleteMapping(m.id, m.category)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </React.Fragment>
            ))}
            {mappings.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground text-sm">
                  No account code mappings yet. Click "Add Mapping" or map categories from the banner above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Management Page ───────────────────────────────────────────────────────────

// ── Categories Tab ────────────────────────────────────────────────────────────

interface CategoryInfoData {
  id: number;
  account_id: number;
  name: string;
  description: string | null;
  transaction_count: number;
}

function CategoriesTab() {
  const { activeAccount } = useAccount();
  const [categories, setCategories] = useState<CategoryInfoData[]>([]);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDesc, setEditDesc] = useState("");

  const fetchCategories = useCallback(async () => {
    if (!activeAccount) return;
    const res = await api.get(`/category-info?account_id=${activeAccount.id}`);
    setCategories(res.data);
  }, [activeAccount]);

  useEffect(() => { fetchCategories(); }, [fetchCategories]);

  const handleSave = async (c: CategoryInfoData) => {
    try {
      await api.put(`/category-info/${c.id}?account_id=${activeAccount!.id}`, { description: editDesc });
      setEditingId(null);
      await fetchCategories();
    } catch { toast.error("Failed to save"); }
  };

  const handleDelete = async (c: CategoryInfoData) => {
    if (!confirm(`Delete "${c.name}"? This will unset the category on ${c.transaction_count} transactions.`)) return;
    try {
      const res = await api.delete(`/category-info/${c.id}?account_id=${activeAccount!.id}`);
      toast.success(res.data.message);
      await fetchCategories();
    } catch { toast.error("Failed to delete"); }
  };

  const filtered = categories.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search categories..." className="pl-9 h-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <span className="text-sm text-muted-foreground">{categories.length} categories</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((c) => {
          const isEditing = editingId === c.id;
          return (
            <Card key={c.id} className="relative group">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-sm font-semibold">{c.name}</h3>
                    <span className="text-xs text-muted-foreground">{c.transaction_count} transaction{c.transaction_count !== 1 ? "s" : ""}</span>
                  </div>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500" onClick={() => handleDelete(c)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                {isEditing ? (
                  <div className="space-y-2">
                    <textarea
                      className="w-full text-xs rounded border bg-background px-2 py-1.5 min-h-[60px] resize-none"
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      placeholder="Describe what this category is for..."
                    />
                    <div className="flex gap-1.5">
                      <Button size="sm" className="h-6 text-xs" onClick={() => handleSave(c)}>Save</Button>
                      <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setEditingId(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <p
                    className="text-xs text-muted-foreground cursor-pointer hover:text-foreground min-h-[24px]"
                    onClick={() => { setEditingId(c.id); setEditDesc(c.description || ""); }}
                  >
                    {c.description || "Click to add description..."}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}


// ── Projects Tab ─────────────────────────────────────────────────────────────

interface ProjectInfoData {
  id: number;
  account_id: number;
  name: string;
  description: string | null;
  transaction_count: number;
}

function ProjectsTab() {
  const { activeAccount } = useAccount();
  const [projects, setProjects] = useState<ProjectInfoData[]>([]);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDesc, setEditDesc] = useState("");

  const fetchProjects = useCallback(async () => {
    if (!activeAccount) return;
    const res = await api.get(`/project-info?account_id=${activeAccount.id}`);
    setProjects(res.data);
  }, [activeAccount]);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);

  const handleSave = async (p: ProjectInfoData) => {
    try {
      await api.put(`/project-info/${p.id}?account_id=${activeAccount!.id}`, { description: editDesc });
      setEditingId(null);
      await fetchProjects();
    } catch { toast.error("Failed to save"); }
  };

  const handleDelete = async (p: ProjectInfoData) => {
    if (!confirm(`Delete "${p.name}"? This will unset the project on ${p.transaction_count} transactions.`)) return;
    try {
      const res = await api.delete(`/project-info/${p.id}?account_id=${activeAccount!.id}`);
      toast.success(res.data.message);
      await fetchProjects();
    } catch { toast.error("Failed to delete"); }
  };

  const filtered = projects.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search projects..." className="pl-9 h-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <span className="text-sm text-muted-foreground">{projects.length} projects</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((p) => {
          const isEditing = editingId === p.id;
          return (
            <Card key={p.id} className="relative group">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-sm font-semibold">{p.name}</h3>
                    <span className="text-xs text-muted-foreground">{p.transaction_count} transaction{p.transaction_count !== 1 ? "s" : ""}</span>
                  </div>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500" onClick={() => handleDelete(p)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                {isEditing ? (
                  <div className="space-y-2">
                    <textarea
                      className="w-full text-xs rounded border bg-background px-2 py-1.5 min-h-[60px] resize-none"
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      placeholder="Describe what this project is for..."
                    />
                    <div className="flex gap-1.5">
                      <Button size="sm" className="h-6 text-xs" onClick={() => handleSave(p)}>Save</Button>
                      <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setEditingId(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <p
                    className="text-xs text-muted-foreground cursor-pointer hover:text-foreground min-h-[24px]"
                    onClick={() => { setEditingId(p.id); setEditDesc(p.description || ""); }}
                  >
                    {p.description || "Click to add description..."}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}


export default function ManagementPage() {
  const [tab, setTab] = useState<"vendors" | "categories" | "projects" | "properties" | "chart">("vendors");

  const tabCls = (t: string) =>
    `px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
      tab === t
        ? "border-foreground text-foreground"
        : "border-transparent text-muted-foreground hover:text-foreground"
    }`;

  return (
    <div className="min-h-screen bg-muted">
      <div className="max-w-7xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-bold text-foreground mb-1">Management</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Manage vendors, categories, projects, properties, and chart of accounts.
        </p>

        <div className="flex border-b mb-6">
          <button className={tabCls("vendors")} onClick={() => setTab("vendors")}>Vendors</button>
          <button className={tabCls("categories")} onClick={() => setTab("categories")}>Categories</button>
          <button className={tabCls("projects")} onClick={() => setTab("projects")}>Projects</button>
          <button className={tabCls("properties")} onClick={() => setTab("properties")}>Properties &amp; Tenants</button>
          <button className={tabCls("chart")} onClick={() => setTab("chart")}>Chart of Accounts</button>
        </div>

        {tab === "vendors" && <VendorsTab />}
        {tab === "categories" && <CategoriesTab />}
        {tab === "projects" && <ProjectsTab />}
        {tab === "properties" && <PropertiesTab />}
        {tab === "chart" && <ChartOfAccountsTab />}
      </div>
    </div>
  );
}
