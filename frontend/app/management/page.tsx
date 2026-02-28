"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import axios from "axios";
import { useAccount } from "@/context/account-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Trash2, Plus, Download, RefreshCw, ChevronRight, ChevronDown, X, Search, Phone, Mail } from "lucide-react";

const API = "http://localhost:8001";

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
  id:             number;
  account_id:     number;
  vendor_name:    string;
  business_name:  string | null;
  trade_category: string | null;
  phone:          string | null;
  email:          string | null;
  rating:         number | null;
  notes:          string | null;
  rules:          VendorRules | null;
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
}: {
  vendor: VendorInfo;
  updateVendor: (id: number, field: string, value: string | number | null) => void;
  updateRules: (vendor: VendorInfo, patch: Partial<VendorRules>) => void;
  deleteVendor: (id: number, name: string) => void;
  resetConfidence: (vendor: VendorInfo) => void;
}) {
  const [rulesOpen, setRulesOpen] = useState(false);
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
  const [vendors,    setVendors]    = useState<VendorInfo[]>([]);
  const [importing,  setImporting]  = useState(false);
  const [learning,   setLearning]   = useState(false);
  const [addingNew,  setAddingNew]  = useState(false);
  const [newName,    setNewName]    = useState("");
  const [search,     setSearch]     = useState("");

  const fetchVendors = useCallback(async () => {
    if (!activeAccount) return;
    const res = await axios.get(`${API}/vendor-info?account_id=${activeAccount.id}`);
    setVendors(res.data);
  }, [activeAccount]);

  useEffect(() => { fetchVendors(); }, [fetchVendors]);

  const handleImport = async () => {
    if (!activeAccount) return;
    setImporting(true);
    try {
      const res = await axios.post(`${API}/vendor-info/import-from-transactions?account_id=${activeAccount.id}`);
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
      const res = await axios.post(`${API}/vendor-info/rebuild-rules?account_id=${activeAccount.id}`);
      await fetchVendors();
      alert(`Learned from history: ${res.data.updated} vendors updated, ${res.data.ambiguous_patterns_resolved} ambiguous patterns resolved.`);
    } finally {
      setLearning(false);
    }
  };

  const updateVendor = async (id: number, field: string, value: string | number | null) => {
    await axios.put(`${API}/vendor-info/${id}`, { [field]: value || null });
    await fetchVendors();
  };

  const updateRules = async (vendor: VendorInfo, patch: Partial<VendorRules>) => {
    const existing = vendor.rules ?? {
      patterns: [], default_category: null, default_project: null,
      enabled: false, assigned_count: 0, corrected_count: 0, confidence: 1,
    };
    const newRules = { ...existing, ...patch };
    await axios.put(`${API}/vendor-info/${vendor.id}`, { rules: newRules });
    await fetchVendors();
  };

  const addVendor = async () => {
    if (!activeAccount || !newName.trim()) return;
    try {
      await axios.post(`${API}/vendor-info?account_id=${activeAccount.id}`, { vendor_name: newName.trim() });
      setNewName(""); setAddingNew(false);
      await fetchVendors();
    } catch (e: any) {
      alert(e?.response?.data?.detail ?? "Error adding vendor");
    }
  };

  const deleteVendor = async (id: number, name: string) => {
    if (!window.confirm(`Delete vendor "${name}"?`)) return;
    await axios.delete(`${API}/vendor-info/${id}`);
    await fetchVendors();
  };

  const resetConfidence = async (vendor: VendorInfo) => {
    if (!vendor.rules) return;
    if (!window.confirm(`Reset correction history for "${vendor.vendor_name}"? This will re-enable auto-assign.`)) return;
    await updateRules(vendor, { corrected_count: 0, confidence: 1.0, enabled: true });
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
    const res = await axios.get(`${API}/properties?account_id=${activeAccount.id}`);
    setProperties(res.data);
  }, [activeAccount]);

  useEffect(() => { fetchProperties(); }, [fetchProperties]);

  const createProperty = async () => {
    if (!activeAccount || !newProp.project_name.trim()) return;
    try {
      await axios.post(`${API}/properties?account_id=${activeAccount.id}`, {
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
    await axios.put(`${API}/properties/${pid}`, { [field]: value || null });
    await fetchProperties();
  };

  const deleteProperty = async (pid: number, name: string) => {
    if (!window.confirm(`Delete property "${name}" and all its tenants?`)) return;
    await axios.delete(`${API}/properties/${pid}`);
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
    await axios.post(`${API}/properties/${pid}/tenants`, {
      name: draft.name, phone: draft.phone || null, email: draft.email || null,
      lease_start: draft.lease_start || null, lease_end: draft.lease_end || null,
      monthly_rent: draft.monthly_rent ?? null, notes: draft.notes || null,
    });
    cancelAddingTenant(pid);
    await fetchProperties();
  };

  const updateTenant = async (tid: number, field: string, value: string | number | null) => {
    await axios.put(`${API}/tenants/${tid}`, { [field]: value || null });
    await fetchProperties();
  };

  const deleteTenant = async (tid: number, name: string) => {
    if (!window.confirm(`Delete tenant "${name}"?`)) return;
    await axios.delete(`${API}/tenants/${tid}`);
    await fetchProperties();
  };

  const inputCls = "h-7 text-xs px-1";

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <Button size="sm" variant="outline" onClick={() => setAddingProperty(true)} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" /> Add Property
        </Button>
        <span className="text-xs text-muted-foreground ml-auto">{properties.length} properties · Click any cell to edit</span>
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
            No properties yet. Click "Add Property" to get started.
          </div>
        )}
      </div>
    </div>
  );
}

// ── Management Page ───────────────────────────────────────────────────────────

export default function ManagementPage() {
  const [tab, setTab] = useState<"vendors" | "properties">("vendors");

  const tabCls = (t: string) =>
    `px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
      tab === t
        ? "border-foreground text-foreground"
        : "border-transparent text-muted-foreground hover:text-foreground"
    }`;

  return (
    <div className="min-h-screen bg-muted">
      <div className="max-w-7xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-bold text-foreground mb-1">Management Info</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Manage vendors, properties, and tenants. Use{" "}
          <span className="font-medium text-foreground">Learn from History</span> to build auto-categorization rules from past transactions.
        </p>

        <div className="flex border-b mb-6">
          <button className={tabCls("vendors")} onClick={() => setTab("vendors")}>Vendors</button>
          <button className={tabCls("properties")} onClick={() => setTab("properties")}>Tenants &amp; Properties</button>
        </div>

        {tab === "vendors" ? <VendorsTab /> : <PropertiesTab />}
      </div>
    </div>
  );
}
