"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { usePersistentState } from "@/hooks/use-persistent-state";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Settings2, ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";
import { BudgetDialog } from "@/components/budget-dialog";
import { BulkEditDialog } from "@/components/bulk-edit-dialog";
import { TransactionPanel } from "@/components/transaction-panel";
import { Transaction } from "@/types/transaction";
import { useAccount } from "@/context/account-context";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

// ── Types ───────────────────────────────────────────────────────────────────

interface Summary {
  total_income: number;
  total_expenses: number;
  net: number;
  transaction_count: number;
  uncategorized_count: number;
  tax_deductible_total: number;
  tax_deductible_count: number;
}

interface CategoryData {
  category: string;
  total: number;
}

interface VendorData {
  vendor: string;
  total: number;
  count: number;
}

interface MonthlyData {
  month: string;
  income: number;
  expenses: number;
}

interface BudgetStatus {
  category: string;
  monthly_limit: number;
  actual_spend: number;
  remaining: number;
  percentage: number;
}

interface ProjectData {
  project: string | null;
  income: number;
  expenses: number;
  count: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────


const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

// ── Sub-components ──────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, accent,
}: {
  label: string; value: string; sub?: string; accent?: "emerald" | "red" | "blue" | "zinc";
}) {
  const colors = { emerald: "text-emerald-600", red: "text-red-500", blue: "text-blue-600", zinc: "text-foreground" };
  return (
    <div className="bg-background rounded-xl border shadow-sm p-5">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${colors[accent ?? "zinc"]}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

function PeriodSelector({
  periodMode, setPeriodMode,
  selectedMonth, setSelectedMonth,
  selectedYear, setSelectedYear,
  dateFrom, setDateFrom,
  dateTo, setDateTo,
  onApplyCustom,
}: {
  periodMode: "month" | "year" | "custom";
  setPeriodMode: (m: "month" | "year" | "custom") => void;
  selectedMonth: { year: number; month: number };
  setSelectedMonth: (m: { year: number; month: number }) => void;
  selectedYear: number;
  setSelectedYear: (y: number) => void;
  dateFrom: string; setDateFrom: (s: string) => void;
  dateTo: string; setDateTo: (s: string) => void;
  onApplyCustom: () => void;
}) {
  const prevMonth = () => {
    const { year, month } = selectedMonth;
    if (month === 1) setSelectedMonth({ year: year - 1, month: 12 });
    else setSelectedMonth({ year, month: month - 1 });
  };
  const nextMonth = () => {
    const { year, month } = selectedMonth;
    if (month === 12) setSelectedMonth({ year: year + 1, month: 1 });
    else setSelectedMonth({ year, month: month + 1 });
  };

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {/* Mode toggle pills */}
      <div className="flex rounded-md border overflow-hidden text-xs">
        {(["month", "year", "custom"] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => setPeriodMode(mode)}
            className={`px-3 py-1.5 transition-colors ${
              periodMode === mode
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            {mode === "month" ? "Month" : mode === "year" ? "Year" : "Custom"}
          </button>
        ))}
      </div>

      {/* Period navigator */}
      {periodMode === "month" && (
        <div className="flex items-center gap-1">
          <button
            onClick={prevMonth}
            className="h-7 w-7 flex items-center justify-center rounded hover:bg-muted transition-colors"
          >
            <ChevronLeft className="h-4 w-4 text-muted-foreground" />
          </button>
          <span className="text-sm font-medium text-foreground min-w-[130px] text-center">
            {MONTH_NAMES[selectedMonth.month - 1]} {selectedMonth.year}
          </span>
          <button
            onClick={nextMonth}
            className="h-7 w-7 flex items-center justify-center rounded hover:bg-muted transition-colors"
          >
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
      )}

      {periodMode === "year" && (
        <div className="flex items-center gap-1">
          <button
            onClick={() => setSelectedYear(selectedYear - 1)}
            className="h-7 w-7 flex items-center justify-center rounded hover:bg-muted transition-colors"
          >
            <ChevronLeft className="h-4 w-4 text-muted-foreground" />
          </button>
          <span className="text-sm font-medium text-foreground min-w-[60px] text-center">
            {selectedYear}
          </span>
          <button
            onClick={() => setSelectedYear(selectedYear + 1)}
            className="h-7 w-7 flex items-center justify-center rounded hover:bg-muted transition-colors"
          >
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
      )}

      {periodMode === "custom" && (
        <div className="flex items-center gap-2">
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-[140px] text-xs h-8" />
          <span className="text-muted-foreground text-xs">→</span>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-[140px] text-xs h-8" />
          <Button size="sm" onClick={onApplyCustom} className="h-8 text-xs">Apply</Button>
        </div>
      )}
    </div>
  );
}

function Breadcrumb({
  items,
}: {
  items: { label: string; onClick: () => void }[];
}) {
  return (
    <nav className="flex items-center gap-1 text-sm flex-wrap">
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
          {i < items.length - 1 ? (
            <button
              onClick={item.onClick}
              className="text-blue-600 hover:text-blue-800 transition-colors font-medium"
            >
              {item.label}
            </button>
          ) : (
            <span className="text-foreground font-medium">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

function CategoryTable({
  categories,
  totalExpenses,
  totalIncome,
  onSelect,
}: {
  categories: CategoryData[];
  totalExpenses: number;
  totalIncome: number;
  onSelect: (cat: string) => void;
}) {
  if (categories.length === 0) {
    return <div className="text-sm text-muted-foreground py-8 text-center">No categorized transactions for this period.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="pb-2 text-xs font-medium text-muted-foreground">Category</th>
            <th className="pb-2 text-xs font-medium text-muted-foreground text-right">Amount</th>
            <th className="pb-2 text-xs font-medium text-muted-foreground text-right">% of Total</th>
            <th className="pb-2 w-6"></th>
          </tr>
        </thead>
        <tbody>
          {categories.map((c) => {
            const isExpense = c.total < 0;
            const abs = Math.abs(c.total);
            const pct = isExpense
              ? totalExpenses > 0 ? ((abs / totalExpenses) * 100).toFixed(1) : "0.0"
              : totalIncome  > 0 ? ((abs / totalIncome)  * 100).toFixed(1) : "0.0";
            return (
              <tr
                key={c.category}
                onClick={() => onSelect(c.category)}
                className="border-b last:border-0 hover:bg-muted cursor-pointer transition-colors group"
              >
                <td className={`py-2.5 font-medium ${c.category === "(Uncategorized)" ? "text-muted-foreground italic" : "text-foreground"}`}>{c.category}</td>
                <td className={`py-2.5 text-right font-medium ${isExpense ? "text-foreground" : "text-emerald-600"}`}>
                  {isExpense ? `−${fmt(abs)}` : `+${fmt(abs)}`}
                </td>
                <td className="py-2.5 text-right text-muted-foreground">{pct}%</td>
                <td className="py-2.5 text-right">
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-muted-foreground transition-colors ml-auto" />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function VendorTable({
  vendors,
  showPct,
  totalForPct,
  pctLabel,
  onSelect,
}: {
  vendors: VendorData[];
  showPct: boolean;
  totalForPct?: number;
  pctLabel?: string;
  onSelect: (v: string) => void;
}) {
  if (vendors.length === 0) {
    return <div className="text-sm text-muted-foreground py-8 text-center">No vendor data for this period.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="pb-2 text-xs font-medium text-muted-foreground">Vendor</th>
            <th className="pb-2 text-xs font-medium text-muted-foreground text-right">Amount</th>
            <th className="pb-2 text-xs font-medium text-muted-foreground text-right"># Txns</th>
            {showPct && <th className="pb-2 text-xs font-medium text-muted-foreground text-right">{pctLabel ?? "% of Total"}</th>}
            <th className="pb-2 w-6"></th>
          </tr>
        </thead>
        <tbody>
          {vendors.map((v) => {
            const absDenom = totalForPct ? Math.abs(totalForPct) : 0;
            const pct = showPct && absDenom > 0
              ? ((v.total / absDenom) * 100).toFixed(1)
              : null;
            return (
              <tr
                key={v.vendor}
                onClick={() => onSelect(v.vendor)}
                className="border-b last:border-0 hover:bg-muted cursor-pointer transition-colors group"
              >
                <td className={`py-2.5 font-medium ${v.vendor === "(No Vendor)" ? "text-muted-foreground italic" : "text-foreground"}`}>{v.vendor}</td>
                <td className={`py-2.5 text-right font-medium ${v.total >= 0 ? "text-emerald-600" : "text-foreground"}`}>
                  {v.total >= 0 ? `+${fmt(v.total)}` : `−${fmt(Math.abs(v.total))}`}
                </td>
                <td className="py-2.5 text-right text-muted-foreground">{v.count}</td>
                {showPct && <td className="py-2.5 text-right text-muted-foreground">{pct}%</td>}
                <td className="py-2.5 text-right">
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-muted-foreground transition-colors ml-auto" />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TransactionTable({
  transactions,
  showCategory,
  showVendor,
  onSelect,
  onBulkSuccess,
}: {
  transactions: Transaction[];
  showCategory: boolean;
  showVendor?: boolean;
  onSelect: (tx: Transaction) => void;
  onBulkSuccess?: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<"date" | "amount" | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const lastClicked = useRef<number | null>(null);

  // Reset selection and search when transactions change
  useEffect(() => { setSelected(new Set()); lastClicked.current = null; setSearch(""); setSortKey(null); }, [transactions]);

  const toggleSort = (key: "date" | "amount") => {
    if (sortKey === key) {
      if (sortDir === "asc") setSortDir("desc");
      else { setSortKey(null); setSortDir("asc"); }
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const filtered = useMemo(() => {
    let result = transactions;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((tx) =>
        tx.description.toLowerCase().includes(q) ||
        (tx.vendor && tx.vendor.toLowerCase().includes(q)) ||
        (tx.category && tx.category.toLowerCase().includes(q)) ||
        (tx.notes && tx.notes.toLowerCase().includes(q)) ||
        (tx.tags && tx.tags.some((t) => t.toLowerCase().includes(q))) ||
        tx.transaction_date.includes(q) ||
        String(tx.amount).includes(q)
      );
    }
    if (sortKey) {
      result = [...result].sort((a, b) => {
        let cmp = 0;
        if (sortKey === "date") cmp = a.transaction_date.localeCompare(b.transaction_date);
        else cmp = parseFloat(String(a.amount)) - parseFloat(String(b.amount));
        return sortDir === "asc" ? cmp : -cmp;
      });
    }
    return result;
  }, [transactions, search, sortKey, sortDir]);

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((tx) => tx.id)));
  };

  const handleRowClick = (e: React.MouseEvent, tx: Transaction, idx: number) => {
    const target = e.target as HTMLElement;
    if (target.closest("[data-row-checkbox]")) {
      toggleOne(tx.id);
      lastClicked.current = idx;
      return;
    }
    if (target.closest("button") || target.closest('[role="menuitem"]') || target.closest("[data-radix-popper-content-wrapper]")) return;

    if (e.shiftKey) {
      e.preventDefault();
      if (lastClicked.current !== null) {
        const start = Math.min(lastClicked.current, idx);
        const end = Math.max(lastClicked.current, idx);
        setSelected((prev) => {
          const next = new Set(prev);
          for (let i = start; i <= end; i++) next.add(filtered[i].id);
          return next;
        });
      } else {
        toggleOne(tx.id);
      }
      lastClicked.current = idx;
    } else {
      lastClicked.current = idx;
      onSelect(tx);
    }
  };

  const selectedTxs = transactions.filter((tx) => selected.has(tx.id));

  if (transactions.length === 0) {
    return <div className="text-sm text-muted-foreground py-8 text-center">No transactions found.</div>;
  }
  return (
    <>
      <div className="flex items-center gap-3 mb-3">
        <Input
          placeholder="Search transactions..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs h-8 text-sm"
        />
        <span className="text-xs text-muted-foreground">
          {filtered.length === transactions.length
            ? `${transactions.length} transactions`
            : `${filtered.length} of ${transactions.length} transactions`}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="pb-2 w-8">
                <span data-row-checkbox="true" className="flex items-center">
                  <Checkbox
                    checked={selected.size === filtered.length && filtered.length > 0}
                    onCheckedChange={toggleAll}
                    aria-label="Select all"
                  />
                </span>
              </th>
              <th className="pb-2 text-xs font-medium text-muted-foreground">
                <button onClick={() => toggleSort("date")} className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
                  Date {sortKey === "date" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                </button>
              </th>
              <th className="pb-2 text-xs font-medium text-muted-foreground text-right">
                <button onClick={() => toggleSort("amount")} className="inline-flex items-center gap-1 hover:text-foreground transition-colors ml-auto">
                  Amount {sortKey === "amount" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                </button>
              </th>
              {showCategory && <th className="pb-2 text-xs font-medium text-muted-foreground">Category</th>}
              {showVendor && <th className="pb-2 text-xs font-medium text-muted-foreground">Vendor</th>}
              <th className="pb-2 text-xs font-medium text-muted-foreground">Description</th>
              <th className="pb-2 text-xs font-medium text-muted-foreground">Notes</th>
              <th className="pb-2 text-xs font-medium text-muted-foreground">Tags</th>
              <th className="pb-2 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((tx, idx) => {
              const amount = parseFloat(String(tx.amount));
              const isSelected = selected.has(tx.id);
              return (
                <tr
                  key={tx.id}
                  onClick={(e) => handleRowClick(e, tx, idx)}
                  onMouseDown={(e) => { if (e.shiftKey) e.preventDefault(); }}
                  className={cn(
                    "border-b last:border-0 hover:bg-muted cursor-pointer transition-colors",
                    isSelected && "bg-blue-500/10"
                  )}
                >
                  <td className="py-2.5">
                    <span data-row-checkbox="true" className="flex items-center">
                      <Checkbox checked={isSelected} aria-label="Select row" />
                    </span>
                  </td>
                  <td className="py-2.5 text-muted-foreground whitespace-nowrap">{tx.transaction_date}</td>
                  <td className={`py-2.5 text-right font-medium whitespace-nowrap ${amount > 0 ? "text-emerald-600" : "text-foreground"}`}>
                    {amount > 0 ? "+" : ""}{fmt(Math.abs(amount))}
                  </td>
                  {showCategory && (
                    <td className="py-2.5 text-muted-foreground max-w-[120px] truncate">
                      {tx.category ?? <span className="text-muted-foreground italic">—</span>}
                    </td>
                  )}
                  {showVendor && (
                    <td className="py-2.5 text-muted-foreground max-w-[120px] truncate">
                      {tx.vendor ?? <span className="text-muted-foreground italic">—</span>}
                    </td>
                  )}
                  <td className="py-2.5 text-muted-foreground max-w-[200px] truncate text-xs">
                    {tx.description}
                  </td>
                  <td className="py-2.5 text-muted-foreground max-w-[160px] truncate">
                    {tx.notes ?? <span className="text-muted-foreground italic">—</span>}
                  </td>
                  <td className="py-2.5 max-w-[150px]">
                    {tx.tags && tx.tags.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {tx.tags.slice(0, 3).map((t) => (
                          <span key={t} className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-muted text-muted-foreground">
                            {t}
                          </span>
                        ))}
                        {tx.tags.length > 3 && (
                          <span className="text-xs text-muted-foreground">+{tx.tags.length - 3}</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground italic">—</span>
                    )}
                  </td>
                  <td className="py-2.5">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-7 w-7 p-0">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                        <DropdownMenuItem onClick={() => onSelect(tx)}>Edit Details</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => navigator.clipboard.writeText(tx.id)}>Copy ID</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Floating action bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-zinc-900 text-white px-6 py-3 rounded-full shadow-xl flex items-center gap-4 z-50 animate-in slide-in-from-bottom-5 fade-in">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <div className="h-4 w-px bg-zinc-700" />
          <Button size="sm" variant="secondary" className="h-8 text-xs hover:bg-muted" onClick={() => setBulkOpen(true)}>
            Categorize / Edit
          </Button>
          <Button
            size="sm" variant="ghost" className="h-8 text-xs text-muted-foreground hover:text-white hover:bg-zinc-800"
            onClick={() => { setSelected(new Set()); lastClicked.current = null; }}
          >
            Clear
          </Button>
        </div>
      )}

      <BulkEditDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        selectedIds={[...selected]}
        selectedTransactions={selectedTxs}
        onSuccess={() => {
          setSelected(new Set());
          lastClicked.current = null;
          onBulkSuccess?.();
        }}
      />
    </>
  );
}

function MonthlyTrendsTable({ monthly }: { monthly: MonthlyData[] }) {
  if (monthly.length === 0) {
    return <div className="text-sm text-muted-foreground py-8 text-center">No data available.</div>;
  }
  const sorted = [...monthly].sort((a, b) => b.month.localeCompare(a.month));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="pb-2 text-xs font-medium text-muted-foreground">Month</th>
            <th className="pb-2 text-xs font-medium text-muted-foreground text-right">Income</th>
            <th className="pb-2 text-xs font-medium text-muted-foreground text-right">Expenses</th>
            <th className="pb-2 text-xs font-medium text-muted-foreground text-right">Net</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((m) => {
            const net = m.income - m.expenses;
            return (
              <tr key={m.month} className="border-b last:border-0 hover:bg-muted transition-colors">
                <td className="py-2.5 font-medium text-foreground">{m.month}</td>
                <td className="py-2.5 text-right text-emerald-600 font-medium">{fmt(m.income)}</td>
                <td className="py-2.5 text-right text-foreground">{fmt(m.expenses)}</td>
                <td className={`py-2.5 text-right font-semibold ${net >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                  {net >= 0 ? "+" : ""}{fmt(net)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ProjectTable({
  projects,
  onSelect,
}: {
  projects: ProjectData[];
  onSelect: (p: string | null) => void;
}) {
  if (projects.length === 0) {
    return <div className="text-sm text-muted-foreground py-8 text-center">No project data for this period.</div>;
  }
  const sorted = [...projects].sort((a, b) => {
    if (a.project === null) return 1;
    if (b.project === null) return -1;
    return b.expenses - a.expenses;
  });
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="pb-2 text-xs font-medium text-muted-foreground">Project</th>
            <th className="pb-2 text-xs font-medium text-muted-foreground text-right">Income</th>
            <th className="pb-2 text-xs font-medium text-muted-foreground text-right">Expenses</th>
            <th className="pb-2 text-xs font-medium text-muted-foreground text-right">Net</th>
            <th className="pb-2 text-xs font-medium text-muted-foreground text-right"># Txns</th>
            <th className="pb-2 w-6"></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => {
            const net = p.income - p.expenses;
            const label = p.project ?? "(No Project)";
            return (
              <tr
                key={label}
                onClick={() => onSelect(p.project)}
                className="border-b last:border-0 hover:bg-muted cursor-pointer transition-colors group"
              >
                <td className={`py-2.5 font-medium ${p.project === null ? "text-muted-foreground italic" : "text-foreground"}`}>
                  {label}
                </td>
                <td className="py-2.5 text-right text-emerald-600 font-medium">
                  {p.income > 0 ? `+${fmt(p.income)}` : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="py-2.5 text-right text-foreground">
                  {p.expenses > 0 ? `−${fmt(p.expenses)}` : <span className="text-muted-foreground">—</span>}
                </td>
                <td className={`py-2.5 text-right font-semibold ${net >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                  {net >= 0 ? "+" : "−"}{fmt(Math.abs(net))}
                </td>
                <td className="py-2.5 text-right text-muted-foreground">{p.count}</td>
                <td className="py-2.5 text-right">
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-muted-foreground transition-colors ml-auto" />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function AnalysisPage() {
  const { activeAccount } = useAccount();

  // Period — persisted across navigation
  const now = new Date();
  const [periodMode,    setPeriodMode]    = usePersistentState<"month" | "year" | "custom">("analysis:periodMode", "month");
  const [selectedMonth, setSelectedMonth] = usePersistentState<{ year: number; month: number }>("analysis:selectedMonth", { year: now.getFullYear(), month: now.getMonth() + 1 });
  const [selectedYear,  setSelectedYear]  = usePersistentState<number>("analysis:selectedYear", now.getFullYear());
  const [dateFrom,      setDateFrom]      = usePersistentState<string>("analysis:dateFrom", "");
  const [dateTo,        setDateTo]        = usePersistentState<string>("analysis:dateTo", "");
  const [customApplied, setCustomApplied] = usePersistentState<{ from: string; to: string }>("analysis:customApplied", { from: "", to: "" });

  // Tabs — persisted; drill-down resets on navigation (requires re-fetch to restore cleanly)
  const [activeTab, setActiveTab] = usePersistentState<"category" | "vendor" | "project" | "trends">("analysis:activeTab", "category");
  const [catDrill, setCatDrill] = useState<{ category?: string; vendor?: string; directTx?: boolean }>({});
  const [venDrill, setVenDrill] = useState<{ vendor?: string }>({});
  const [projDrill, setProjDrill] = useState<{ project?: string | null; category?: string }>({});

  // Data
  const [summary, setSummary] = useState<Summary | null>(null);
  const [categories, setCategories] = useState<CategoryData[]>([]);
  const [catVendors, setCatVendors] = useState<VendorData[]>([]);
  const [allVendors, setAllVendors] = useState<VendorData[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [unassignedTxns, setUnassignedTxns] = useState<Transaction[]>([]);
  const [uncategorizedTxns, setUncategorizedTxns] = useState<Transaction[]>([]);
  const [monthly, setMonthly] = useState<MonthlyData[]>([]);
  const [budgetStatuses, setBudgetStatuses] = useState<BudgetStatus[]>([]);
  const [projects, setProjects] = useState<ProjectData[]>([]);
  const [projCategories, setProjCategories] = useState<CategoryData[]>([]);

  // Loading states
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [loadingDrill, setLoadingDrill] = useState(false);

  // Panel
  const [panelTx, setPanelTx] = useState<Transaction | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [budgetOpen, setBudgetOpen] = useState(false);

  // ── Period params ──
  const periodParams = useMemo(() => {
    if (periodMode === "custom") return { from: customApplied.from, to: customApplied.to };
    if (periodMode === "year")   return { from: `${selectedYear}-01-01`, to: `${selectedYear}-12-31` };
    const { year, month } = selectedMonth;
    const lastDay = new Date(year, month, 0).getDate();
    return {
      from: `${year}-${String(month).padStart(2, "0")}-01`,
      to:   `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
    };
  }, [periodMode, selectedMonth, selectedYear, customApplied]);

  const buildQs = useCallback((extra: Record<string, string> = {}) => {
    const p = new URLSearchParams();
    if (activeAccount) p.set("account_id", String(activeAccount.id));
    if (periodParams.from) p.set("date_from", periodParams.from);
    if (periodParams.to)   p.set("date_to",   periodParams.to);
    Object.entries(extra).forEach(([k, v]) => { if (v) p.set(k, v); });
    return p.toString() ? `?${p}` : "";
  }, [periodParams, activeAccount]);

  // ── Fetch summary + categories (on period change) ──
  const fetchSummaryAndCategories = useCallback(async () => {
    if (!activeAccount) return;
    setLoadingSummary(true);
    try {
      const qs = buildQs();
      const [sumRes, catRes, budRes, uncatRes] = await Promise.all([
        api.get(`/stats/summary${qs}`),
        api.get(`/stats/category_breakdown${qs}`),
        api.get(`/stats/budget_status${buildQs()}`),
        api.get(`/transactions${buildQs({ has_category: "false" })}`),
      ]);
      setSummary(sumRes.data);
      const uncategorized: Transaction[] = uncatRes.data;
      setUncategorizedTxns(uncategorized);
      const sortCats = (list: CategoryData[]) =>
        list.sort((a, b) => {
          const aPos = a.total >= 0, bPos = b.total >= 0;
          if (aPos !== bPos) return aPos ? -1 : 1;  // income first
          if (aPos) return b.total - a.total;         // income: high → low
          return a.total - b.total;                   // expense: most negative first
        });
      setCategories(sortCats([...catRes.data]));
      setBudgetStatuses(budRes.data);
    } catch {
      // silent
    } finally {
      setLoadingSummary(false);
    }
  }, [buildQs, activeAccount]);

  // ── Fetch monthly trends (when account changes) ──
  const fetchMonthly = useCallback(async () => {
    if (!activeAccount) return;
    try {
      const res = await api.get(`/stats/monthly?account_id=${activeAccount.id}`);
      setMonthly(res.data);
    } catch {
      // silent
    }
  }, [activeAccount]);

  // ── Fetch all vendors (when By Vendor tab opens or period changes) ──
  const fetchAllVendors = useCallback(async () => {
    setLoadingDrill(true);
    try {
      const qs = buildQs({ limit: "200" });
      const res = await api.get(`/stats/top_vendors${qs}`);
      setAllVendors(res.data);
    } catch {
      // silent
    } finally {
      setLoadingDrill(false);
    }
  }, [buildQs]);

  // ── Fetch vendors within a category (+ unassigned bucket) ──
  const fetchCatVendors = useCallback(async (category: string) => {
    setLoadingDrill(true);
    try {
      const [vendorRes, unassignedRes] = await Promise.all([
        api.get(`/stats/top_vendors${buildQs({ category, limit: "200" })}`),
        api.get(`/transactions${buildQs({ category, has_vendor: "false" })}`),
      ]);
      const vendors: VendorData[] = vendorRes.data;
      const unassigned: Transaction[] = unassignedRes.data;
      setUnassignedTxns(unassigned);
      if (unassigned.length > 0) {
        const total = unassigned.reduce(
          (sum, tx) => sum + parseFloat(String(tx.amount)),
          0
        );
        vendors.push({ vendor: "(No Vendor)", total: Math.round(total * 100) / 100, count: unassigned.length });
      }
      setCatVendors(vendors);
    } catch {
      // silent
    } finally {
      setLoadingDrill(false);
    }
  }, [buildQs]);

  // ── Fetch transactions for a vendor (+ optional category) ──
  const fetchTransactions = useCallback(async (vendor: string, category?: string) => {
    setLoadingDrill(true);
    try {
      const extra: Record<string, string> = { vendor };
      if (category) extra.category = category;
      const qs = buildQs(extra);
      const res = await api.get(`/transactions${qs}`);
      setTransactions(res.data);
    } catch {
      // silent
    } finally {
      setLoadingDrill(false);
    }
  }, [buildQs]);

  // ── Fetch project breakdown ──
  const fetchProjectBreakdown = useCallback(async () => {
    setLoadingDrill(true);
    try {
      const res = await api.get(`/stats/project_breakdown${buildQs()}`);
      setProjects(res.data);
    } catch {
      // silent
    } finally {
      setLoadingDrill(false);
    }
  }, [buildQs]);

  // ── Fetch categories within a project ──
  const fetchProjCategories = useCallback(async (project: string | null) => {
    setLoadingDrill(true);
    try {
      const projectParam = project === null ? "__none__" : project;
      const res = await api.get(`/stats/category_breakdown${buildQs({ project: projectParam })}`);
      const sortCats = (list: CategoryData[]) =>
        list.sort((a, b) => {
          const aPos = a.total >= 0, bPos = b.total >= 0;
          if (aPos !== bPos) return aPos ? -1 : 1;
          if (aPos) return b.total - a.total;
          return a.total - b.total;
        });
      setProjCategories(sortCats([...res.data]));
    } catch {
      // silent
    } finally {
      setLoadingDrill(false);
    }
  }, [buildQs]);

  // ── Fetch transactions within a project + category ──
  const fetchProjCategoryTxns = useCallback(async (project: string | null, category: string) => {
    setLoadingDrill(true);
    try {
      const extra: Record<string, string> = {};
      if (category === "(Uncategorized)") extra.has_category = "false";
      else extra.category = category;
      if (project === null) extra.has_project = "false";
      else extra.project = project;
      const res = await api.get(`/transactions${buildQs(extra)}`);
      setTransactions(res.data);
    } catch {
      // silent
    } finally {
      setLoadingDrill(false);
    }
  }, [buildQs]);

  // ── Effects ──
  useEffect(() => {
    fetchSummaryAndCategories();
    // Reset drill-down on period change
    setCatDrill({});
    setVenDrill({});
    setProjDrill({});
    setTransactions([]);
    setCatVendors([]);
    setUnassignedTxns([]);
  }, [fetchSummaryAndCategories]);

  useEffect(() => {
    fetchMonthly();
  }, [fetchMonthly]);

  useEffect(() => {
    if (activeTab === "vendor") fetchAllVendors();
  }, [activeTab, fetchAllVendors]);

  useEffect(() => {
    if (activeTab === "project") fetchProjectBreakdown();
  }, [activeTab, fetchProjectBreakdown]);

  // ── Drill-down handlers ──
  const handleSelectCategory = (category: string) => {
    if (category === "(Uncategorized)") {
      setCatDrill({ category, directTx: true });
      setTransactions(uncategorizedTxns);
    } else {
      setCatDrill({ category });
      setTransactions([]);
      fetchCatVendors(category);
    }
  };

  const handleSelectCatVendor = (vendor: string) => {
    setCatDrill((prev) => ({ ...prev, vendor }));
    if (vendor === "(No Vendor)") {
      setTransactions(unassignedTxns);
    } else {
      fetchTransactions(vendor, catDrill.category);
    }
  };

  const handleSelectProject = (project: string | null) => {
    setProjDrill({ project });
    setTransactions([]);
    fetchProjCategories(project);
  };

  const handleSelectProjCategory = (category: string) => {
    const currentProject = projDrill.project ?? null;
    setProjDrill((prev) => ({ ...prev, category }));
    fetchProjCategoryTxns(currentProject, category);
  };

  const handleSelectVendor = (vendor: string) => {
    setVenDrill({ vendor });
    fetchTransactions(vendor);
  };

  const handleOpenPanel = (tx: Transaction) => {
    setPanelTx(tx);
    setPanelOpen(true);
  };

  const handlePanelSave = () => {
    if (catDrill.directTx) {
      // Uncategorized bucket — refresh everything so the saved tx may graduate out
      fetchSummaryAndCategories();
      setCatDrill({}); // return to category list so counts are visibly updated
    } else if (catDrill.vendor === "(No Vendor)" && catDrill.category) {
      fetchCatVendors(catDrill.category);
      setCatDrill({ category: catDrill.category });
    } else if (catDrill.vendor) {
      fetchTransactions(catDrill.vendor, catDrill.category);
    } else if (venDrill.vendor) {
      fetchTransactions(venDrill.vendor);
    } else if (projDrill.category !== undefined) {
      fetchProjCategoryTxns(projDrill.project ?? null, projDrill.category);
    }
    fetchSummaryAndCategories();
  };

  const applyCustom = () => {
    setCustomApplied({ from: dateFrom, to: dateTo });
    setCatDrill({});
    setVenDrill({});
    setTransactions([]);
    setCatVendors([]);
  };

  // ── Breadcrumb builders ──
  const catBreadcrumb = () => {
    const items = [{ label: "All Categories", onClick: () => { setCatDrill({}); setTransactions([]); setCatVendors([]); } }];
    if (catDrill.category) {
      if (catDrill.directTx) {
        // At transaction level directly (Uncategorized) — category is the leaf
        items.push({ label: catDrill.category, onClick: () => {} });
      } else {
        items.push({ label: catDrill.category, onClick: () => { setCatDrill({ category: catDrill.category }); setTransactions([]); } });
      }
    }
    if (catDrill.vendor) {
      items.push({ label: catDrill.vendor, onClick: () => {} });
    }
    return items;
  };

  const venBreadcrumb = () => {
    const items = [{ label: "All Vendors", onClick: () => { setVenDrill({}); setTransactions([]); } }];
    if (venDrill.vendor) {
      items.push({ label: venDrill.vendor, onClick: () => {} });
    }
    return items;
  };

  const projBreadcrumb = () => {
    const items = [{ label: "All Projects", onClick: () => { setProjDrill({}); setTransactions([]); } }];
    if (projDrill.project !== undefined) {
      const projLabel = projDrill.project ?? "(No Project)";
      const capturedProject = projDrill.project;
      items.push({ label: projLabel, onClick: () => { setProjDrill({ project: capturedProject }); setTransactions([]); fetchProjCategories(capturedProject ?? null); } });
    }
    if (projDrill.category !== undefined) {
      items.push({ label: projDrill.category, onClick: () => {} });
    }
    return items;
  };

  // ── Render ──
  const net = summary?.net ?? 0;

  return (
    <div className="min-h-screen bg-muted p-6 md:p-8">
      {/* HEADER */}
      <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Analysis</h1>
          {summary && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {summary.transaction_count.toLocaleString()} transactions
              {summary.uncategorized_count > 0 && (
                <span className="ml-2 text-amber-500">· {summary.uncategorized_count} uncategorized</span>
              )}
            </p>
          )}
        </div>
        <PeriodSelector
          periodMode={periodMode}
          setPeriodMode={setPeriodMode}
          selectedMonth={selectedMonth}
          setSelectedMonth={setSelectedMonth}
          selectedYear={selectedYear}
          setSelectedYear={setSelectedYear}
          dateFrom={dateFrom}
          setDateFrom={setDateFrom}
          dateTo={dateTo}
          setDateTo={setDateTo}
          onApplyCustom={applyCustom}
        />
      </header>

      {/* SUMMARY CARDS */}
      {loadingSummary ? (
        <div className="h-24 flex items-center justify-center text-muted-foreground text-sm">Loading...</div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard label="Total Income"    value={fmt(summary?.total_income ?? 0)}          accent="emerald" />
          <StatCard label="Total Expenses"  value={fmt(summary?.total_expenses ?? 0)}         accent="zinc" />
          <StatCard label="Net"             value={fmt(net)} accent={net >= 0 ? "emerald" : "red"} sub={net >= 0 ? "surplus" : "deficit"} />
          <StatCard label="Tax Deductible"  value={fmt(summary?.tax_deductible_total ?? 0)}   sub={`${summary?.tax_deductible_count ?? 0} transactions`} accent="blue" />
        </div>
      )}

      {/* TABS */}
      <div className="bg-background rounded-xl border shadow-sm mb-6">
        {/* Tab bar */}
        <div className="flex border-b">
          {(["category", "vendor", "project", "trends"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-5 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
                activeTab === tab
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-muted-foreground"
              }`}
            >
              {tab === "category" ? "By Category" : tab === "vendor" ? "By Vendor" : tab === "project" ? "By Project" : "Monthly Trends"}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="p-6">

          {/* ── BY CATEGORY TAB ── */}
          {activeTab === "category" && (
            <div>
              <div className="mb-4">
                <Breadcrumb items={catBreadcrumb()} />
              </div>

              {/* Level 0: category list */}
              {!catDrill.category && (
                <CategoryTable
                  categories={categories}
                  totalExpenses={summary?.total_expenses ?? 0}
                  totalIncome={summary?.total_income ?? 0}
                  onSelect={handleSelectCategory}
                />
              )}

              {/* Level 1: vendor list within category */}
              {catDrill.category && !catDrill.vendor && !catDrill.directTx && (
                loadingDrill ? (
                  <div className="py-8 text-center text-muted-foreground text-sm">Loading vendors...</div>
                ) : (
                  <VendorTable
                    vendors={catVendors}
                    showPct
                    totalForPct={categories.find((c) => c.category === catDrill.category)?.total}
                    pctLabel="% of Category"
                    onSelect={handleSelectCatVendor}
                  />
                )
              )}

              {/* Level 2: transaction list */}
              {(catDrill.vendor || catDrill.directTx) && (
                loadingDrill ? (
                  <div className="py-8 text-center text-muted-foreground text-sm">Loading transactions...</div>
                ) : (
                  <TransactionTable
                    transactions={transactions}
                    showCategory={false}
                    showVendor={catDrill.directTx}
                    onSelect={handleOpenPanel}
                    onBulkSuccess={handlePanelSave}
                  />
                )
              )}
            </div>
          )}

          {/* ── BY VENDOR TAB ── */}
          {activeTab === "vendor" && (
            <div>
              <div className="mb-4">
                <Breadcrumb items={venBreadcrumb()} />
              </div>

              {/* Level 0: all vendors */}
              {!venDrill.vendor && (
                loadingDrill ? (
                  <div className="py-8 text-center text-muted-foreground text-sm">Loading vendors...</div>
                ) : (
                  <VendorTable
                    vendors={allVendors}
                    showPct={false}
                    onSelect={handleSelectVendor}
                  />
                )
              )}

              {/* Level 1: transactions for vendor */}
              {venDrill.vendor && (
                loadingDrill ? (
                  <div className="py-8 text-center text-muted-foreground text-sm">Loading transactions...</div>
                ) : (
                  <TransactionTable
                    transactions={transactions}
                    showCategory
                    onSelect={handleOpenPanel}
                    onBulkSuccess={handlePanelSave}
                  />
                )
              )}
            </div>
          )}

          {/* ── BY PROJECT TAB ── */}
          {activeTab === "project" && (
            <div>
              <div className="mb-4">
                <Breadcrumb items={projBreadcrumb()} />
              </div>

              {/* Level 0: project list */}
              {projDrill.project === undefined && (
                loadingDrill ? (
                  <div className="py-8 text-center text-muted-foreground text-sm">Loading projects...</div>
                ) : (
                  <ProjectTable projects={projects} onSelect={handleSelectProject} />
                )
              )}

              {/* Level 1: categories within project */}
              {projDrill.project !== undefined && projDrill.category === undefined && (
                loadingDrill ? (
                  <div className="py-8 text-center text-muted-foreground text-sm">Loading categories...</div>
                ) : (
                  <CategoryTable
                    categories={projCategories}
                    totalExpenses={projects.find((p) => p.project === projDrill.project)?.expenses ?? 0}
                    totalIncome={projects.find((p) => p.project === projDrill.project)?.income ?? 0}
                    onSelect={handleSelectProjCategory}
                  />
                )
              )}

              {/* Level 2: transactions within project + category */}
              {projDrill.category !== undefined && (
                loadingDrill ? (
                  <div className="py-8 text-center text-muted-foreground text-sm">Loading transactions...</div>
                ) : (
                  <TransactionTable
                    transactions={transactions}
                    showCategory={false}
                    showVendor
                    onSelect={handleOpenPanel}
                    onBulkSuccess={handlePanelSave}
                  />
                )
              )}
            </div>
          )}

          {/* ── MONTHLY TRENDS TAB ── */}
          {activeTab === "trends" && (
            <MonthlyTrendsTable monthly={monthly} />
          )}
        </div>
      </div>

      {/* BUDGET TRACKER */}
      <div className="bg-background rounded-xl border shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Monthly Budget</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Current calendar month spend vs limits</p>
          </div>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={() => setBudgetOpen(true)}>
            <Settings2 className="h-3 w-3" /> Manage
          </Button>
        </div>

        {budgetStatuses.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center">
            No budgets set — click Manage to add category limits
          </div>
        ) : (
          <div className="grid gap-4">
            {budgetStatuses.map((b) => {
              const pct = Math.min(b.percentage, 100);
              const over = b.actual_spend > b.monthly_limit;
              return (
                <div key={b.category}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-foreground">{b.category}</span>
                    <span className={`text-xs font-medium ${over ? "text-red-500" : "text-muted-foreground"}`}>
                      {fmt(b.actual_spend)} / {fmt(b.monthly_limit)}
                      {over && <span className="ml-1.5">over by {fmt(b.actual_spend - b.monthly_limit)}</span>}
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${over ? "bg-red-500" : pct > 80 ? "bg-amber-400" : "bg-emerald-500"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {over
                      ? `${b.percentage.toFixed(0)}% used`
                      : `${fmt(b.remaining)} remaining · ${b.percentage.toFixed(0)}% used`}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* DIALOGS */}
      <BudgetDialog
        open={budgetOpen}
        onOpenChange={setBudgetOpen}
        onSaved={() => { fetchSummaryAndCategories(); }}
      />
      <TransactionPanel
        transaction={panelTx}
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        onSave={handlePanelSave}
      />
    </div>
  );
}
