"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { usePersistentState } from "@/hooks/use-persistent-state";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Settings2, ChevronLeft, ChevronRight } from "lucide-react";
import { BudgetDialog } from "@/components/budget-dialog";
import { TransactionPanel } from "@/components/transaction-panel";
import { Transaction } from "@/types/transaction";
import { useAccount } from "@/context/account-context";

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

const API = "http://localhost:8001";

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
  const colors = { emerald: "text-emerald-600", red: "text-red-500", blue: "text-blue-600", zinc: "text-zinc-700" };
  return (
    <div className="bg-white rounded-xl border shadow-sm p-5">
      <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${colors[accent ?? "zinc"]}`}>{value}</p>
      {sub && <p className="text-xs text-zinc-400 mt-1">{sub}</p>}
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
                ? "bg-zinc-900 text-white"
                : "text-zinc-500 hover:text-zinc-700 hover:bg-zinc-50"
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
            className="h-7 w-7 flex items-center justify-center rounded hover:bg-zinc-100 transition-colors"
          >
            <ChevronLeft className="h-4 w-4 text-zinc-500" />
          </button>
          <span className="text-sm font-medium text-zinc-700 min-w-[130px] text-center">
            {MONTH_NAMES[selectedMonth.month - 1]} {selectedMonth.year}
          </span>
          <button
            onClick={nextMonth}
            className="h-7 w-7 flex items-center justify-center rounded hover:bg-zinc-100 transition-colors"
          >
            <ChevronRight className="h-4 w-4 text-zinc-500" />
          </button>
        </div>
      )}

      {periodMode === "year" && (
        <div className="flex items-center gap-1">
          <button
            onClick={() => setSelectedYear(selectedYear - 1)}
            className="h-7 w-7 flex items-center justify-center rounded hover:bg-zinc-100 transition-colors"
          >
            <ChevronLeft className="h-4 w-4 text-zinc-500" />
          </button>
          <span className="text-sm font-medium text-zinc-700 min-w-[60px] text-center">
            {selectedYear}
          </span>
          <button
            onClick={() => setSelectedYear(selectedYear + 1)}
            className="h-7 w-7 flex items-center justify-center rounded hover:bg-zinc-100 transition-colors"
          >
            <ChevronRight className="h-4 w-4 text-zinc-500" />
          </button>
        </div>
      )}

      {periodMode === "custom" && (
        <div className="flex items-center gap-2">
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-[140px] text-xs h-8" />
          <span className="text-zinc-300 text-xs">→</span>
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
          {i > 0 && <ChevronRight className="h-3 w-3 text-zinc-300" />}
          {i < items.length - 1 ? (
            <button
              onClick={item.onClick}
              className="text-blue-600 hover:text-blue-800 transition-colors font-medium"
            >
              {item.label}
            </button>
          ) : (
            <span className="text-zinc-700 font-medium">{item.label}</span>
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
    return <div className="text-sm text-zinc-400 py-8 text-center">No categorized transactions for this period.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="pb-2 text-xs font-medium text-zinc-400">Category</th>
            <th className="pb-2 text-xs font-medium text-zinc-400 text-right">Amount</th>
            <th className="pb-2 text-xs font-medium text-zinc-400 text-right">% of Total</th>
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
                className="border-b last:border-0 hover:bg-zinc-50 cursor-pointer transition-colors group"
              >
                <td className={`py-2.5 font-medium ${c.category === "(Uncategorized)" ? "text-zinc-400 italic" : "text-zinc-800"}`}>{c.category}</td>
                <td className={`py-2.5 text-right font-medium ${isExpense ? "text-zinc-700" : "text-emerald-600"}`}>
                  {isExpense ? `−${fmt(abs)}` : `+${fmt(abs)}`}
                </td>
                <td className="py-2.5 text-right text-zinc-400">{pct}%</td>
                <td className="py-2.5 text-right">
                  <ChevronRight className="h-3.5 w-3.5 text-zinc-300 group-hover:text-zinc-500 transition-colors ml-auto" />
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
    return <div className="text-sm text-zinc-400 py-8 text-center">No vendor data for this period.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="pb-2 text-xs font-medium text-zinc-400">Vendor</th>
            <th className="pb-2 text-xs font-medium text-zinc-400 text-right">Amount</th>
            <th className="pb-2 text-xs font-medium text-zinc-400 text-right"># Txns</th>
            {showPct && <th className="pb-2 text-xs font-medium text-zinc-400 text-right">{pctLabel ?? "% of Total"}</th>}
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
                className="border-b last:border-0 hover:bg-zinc-50 cursor-pointer transition-colors group"
              >
                <td className={`py-2.5 font-medium ${v.vendor === "(No Vendor)" ? "text-zinc-400 italic" : "text-zinc-800"}`}>{v.vendor}</td>
                <td className={`py-2.5 text-right font-medium ${v.total >= 0 ? "text-emerald-600" : "text-zinc-700"}`}>
                  {v.total >= 0 ? `+${fmt(v.total)}` : `−${fmt(Math.abs(v.total))}`}
                </td>
                <td className="py-2.5 text-right text-zinc-500">{v.count}</td>
                {showPct && <td className="py-2.5 text-right text-zinc-400">{pct}%</td>}
                <td className="py-2.5 text-right">
                  <ChevronRight className="h-3.5 w-3.5 text-zinc-300 group-hover:text-zinc-500 transition-colors ml-auto" />
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
}: {
  transactions: Transaction[];
  showCategory: boolean;
  showVendor?: boolean;
  onSelect: (tx: Transaction) => void;
}) {
  if (transactions.length === 0) {
    return <div className="text-sm text-zinc-400 py-8 text-center">No transactions found.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="pb-2 text-xs font-medium text-zinc-400">Date</th>
            <th className="pb-2 text-xs font-medium text-zinc-400 text-right">Amount</th>
            {showCategory && <th className="pb-2 text-xs font-medium text-zinc-400">Category</th>}
            {showVendor && <th className="pb-2 text-xs font-medium text-zinc-400">Vendor</th>}
            <th className="pb-2 text-xs font-medium text-zinc-400">Notes</th>
            <th className="pb-2 text-xs font-medium text-zinc-400">Tags</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((tx) => {
            const amount = parseFloat(String(tx.amount));
            return (
              <tr
                key={tx.id}
                onClick={() => onSelect(tx)}
                className="border-b last:border-0 hover:bg-zinc-50 cursor-pointer transition-colors"
              >
                <td className="py-2.5 text-zinc-500 whitespace-nowrap">{tx.transaction_date}</td>
                <td className={`py-2.5 text-right font-medium whitespace-nowrap ${amount > 0 ? "text-emerald-600" : "text-zinc-800"}`}>
                  {amount > 0 ? "+" : ""}{fmt(Math.abs(amount))}
                </td>
                {showCategory && (
                  <td className="py-2.5 text-zinc-500 max-w-[120px] truncate">
                    {tx.category ?? <span className="text-zinc-300 italic">—</span>}
                  </td>
                )}
                {showVendor && (
                  <td className="py-2.5 text-zinc-500 max-w-[120px] truncate">
                    {tx.vendor ?? <span className="text-zinc-300 italic">—</span>}
                  </td>
                )}
                <td className="py-2.5 text-zinc-500 max-w-[200px] truncate">
                  {tx.notes ?? <span className="text-zinc-300 italic">—</span>}
                </td>
                <td className="py-2.5 max-w-[150px]">
                  {tx.tags && tx.tags.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {tx.tags.slice(0, 3).map((t) => (
                        <span key={t} className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-zinc-100 text-zinc-600">
                          {t}
                        </span>
                      ))}
                      {tx.tags.length > 3 && (
                        <span className="text-xs text-zinc-400">+{tx.tags.length - 3}</span>
                      )}
                    </div>
                  ) : (
                    <span className="text-zinc-300 italic">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MonthlyTrendsTable({ monthly }: { monthly: MonthlyData[] }) {
  if (monthly.length === 0) {
    return <div className="text-sm text-zinc-400 py-8 text-center">No data available.</div>;
  }
  const sorted = [...monthly].sort((a, b) => b.month.localeCompare(a.month));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="pb-2 text-xs font-medium text-zinc-400">Month</th>
            <th className="pb-2 text-xs font-medium text-zinc-400 text-right">Income</th>
            <th className="pb-2 text-xs font-medium text-zinc-400 text-right">Expenses</th>
            <th className="pb-2 text-xs font-medium text-zinc-400 text-right">Net</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((m) => {
            const net = m.income - m.expenses;
            return (
              <tr key={m.month} className="border-b last:border-0 hover:bg-zinc-50 transition-colors">
                <td className="py-2.5 font-medium text-zinc-700">{m.month}</td>
                <td className="py-2.5 text-right text-emerald-600 font-medium">{fmt(m.income)}</td>
                <td className="py-2.5 text-right text-zinc-700">{fmt(m.expenses)}</td>
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
    return <div className="text-sm text-zinc-400 py-8 text-center">No project data for this period.</div>;
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
            <th className="pb-2 text-xs font-medium text-zinc-400">Project</th>
            <th className="pb-2 text-xs font-medium text-zinc-400 text-right">Income</th>
            <th className="pb-2 text-xs font-medium text-zinc-400 text-right">Expenses</th>
            <th className="pb-2 text-xs font-medium text-zinc-400 text-right">Net</th>
            <th className="pb-2 text-xs font-medium text-zinc-400 text-right"># Txns</th>
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
                className="border-b last:border-0 hover:bg-zinc-50 cursor-pointer transition-colors group"
              >
                <td className={`py-2.5 font-medium ${p.project === null ? "text-zinc-400 italic" : "text-zinc-800"}`}>
                  {label}
                </td>
                <td className="py-2.5 text-right text-emerald-600 font-medium">
                  {p.income > 0 ? `+${fmt(p.income)}` : <span className="text-zinc-300">—</span>}
                </td>
                <td className="py-2.5 text-right text-zinc-700">
                  {p.expenses > 0 ? `−${fmt(p.expenses)}` : <span className="text-zinc-300">—</span>}
                </td>
                <td className={`py-2.5 text-right font-semibold ${net >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                  {net >= 0 ? "+" : "−"}{fmt(Math.abs(net))}
                </td>
                <td className="py-2.5 text-right text-zinc-500">{p.count}</td>
                <td className="py-2.5 text-right">
                  <ChevronRight className="h-3.5 w-3.5 text-zinc-300 group-hover:text-zinc-500 transition-colors ml-auto" />
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
        axios.get(`${API}/stats/summary${qs}`),
        axios.get(`${API}/stats/category_breakdown${qs}`),
        axios.get(`${API}/stats/budget_status${buildQs()}`),
        axios.get(`${API}/transactions${buildQs({ has_category: "false" })}`),
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
      const cats = sortCats([...catRes.data]);
      if (uncategorized.length > 0) {
        const total = uncategorized.reduce(
          (sum, tx) => sum + parseFloat(String(tx.amount)), 0
        );
        cats.push({ category: "(Uncategorized)", total: Math.round(total * 100) / 100 });
      }
      setCategories(cats);
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
      const res = await axios.get(`${API}/stats/monthly?account_id=${activeAccount.id}`);
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
      const res = await axios.get(`${API}/stats/top_vendors${qs}`);
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
        axios.get(`${API}/stats/top_vendors${buildQs({ category, limit: "200" })}`),
        axios.get(`${API}/transactions${buildQs({ category, has_vendor: "false" })}`),
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
      const res = await axios.get(`${API}/transactions${qs}`);
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
      const res = await axios.get(`${API}/stats/project_breakdown${buildQs()}`);
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
      const res = await axios.get(`${API}/stats/category_breakdown${buildQs({ project: projectParam })}`);
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
      const extra: Record<string, string> = { category };
      if (project === null) extra.has_project = "false";
      else extra.project = project;
      const res = await axios.get(`${API}/transactions${buildQs(extra)}`);
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
    <div className="min-h-screen bg-zinc-50 p-6 md:p-8">
      {/* HEADER */}
      <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Analysis</h1>
          {summary && (
            <p className="text-sm text-zinc-500 mt-0.5">
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
        <div className="h-24 flex items-center justify-center text-zinc-400 text-sm">Loading...</div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard label="Total Income"    value={fmt(summary?.total_income ?? 0)}          accent="emerald" />
          <StatCard label="Total Expenses"  value={fmt(summary?.total_expenses ?? 0)}         accent="zinc" />
          <StatCard label="Net"             value={fmt(net)} accent={net >= 0 ? "emerald" : "red"} sub={net >= 0 ? "surplus" : "deficit"} />
          <StatCard label="Tax Deductible"  value={fmt(summary?.tax_deductible_total ?? 0)}   sub={`${summary?.tax_deductible_count ?? 0} transactions`} accent="blue" />
        </div>
      )}

      {/* TABS */}
      <div className="bg-white rounded-xl border shadow-sm mb-6">
        {/* Tab bar */}
        <div className="flex border-b">
          {(["category", "vendor", "project", "trends"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-5 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
                activeTab === tab
                  ? "border-zinc-900 text-zinc-900"
                  : "border-transparent text-zinc-400 hover:text-zinc-600"
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
                  <div className="py-8 text-center text-zinc-400 text-sm">Loading vendors...</div>
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
                  <div className="py-8 text-center text-zinc-400 text-sm">Loading transactions...</div>
                ) : (
                  <TransactionTable
                    transactions={transactions}
                    showCategory={false}
                    showVendor={catDrill.directTx}
                    onSelect={handleOpenPanel}
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
                  <div className="py-8 text-center text-zinc-400 text-sm">Loading vendors...</div>
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
                  <div className="py-8 text-center text-zinc-400 text-sm">Loading transactions...</div>
                ) : (
                  <TransactionTable
                    transactions={transactions}
                    showCategory
                    onSelect={handleOpenPanel}
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
                  <div className="py-8 text-center text-zinc-400 text-sm">Loading projects...</div>
                ) : (
                  <ProjectTable projects={projects} onSelect={handleSelectProject} />
                )
              )}

              {/* Level 1: categories within project */}
              {projDrill.project !== undefined && projDrill.category === undefined && (
                loadingDrill ? (
                  <div className="py-8 text-center text-zinc-400 text-sm">Loading categories...</div>
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
                  <div className="py-8 text-center text-zinc-400 text-sm">Loading transactions...</div>
                ) : (
                  <TransactionTable
                    transactions={transactions}
                    showCategory={false}
                    showVendor
                    onSelect={handleOpenPanel}
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
      <div className="bg-white rounded-xl border shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-zinc-700">Monthly Budget</h2>
            <p className="text-xs text-zinc-400 mt-0.5">Current calendar month spend vs limits</p>
          </div>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={() => setBudgetOpen(true)}>
            <Settings2 className="h-3 w-3" /> Manage
          </Button>
        </div>

        {budgetStatuses.length === 0 ? (
          <div className="text-sm text-zinc-400 py-6 text-center">
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
                    <span className="text-sm font-medium text-zinc-700">{b.category}</span>
                    <span className={`text-xs font-medium ${over ? "text-red-500" : "text-zinc-500"}`}>
                      {fmt(b.actual_spend)} / {fmt(b.monthly_limit)}
                      {over && <span className="ml-1.5">over by {fmt(b.actual_spend - b.monthly_limit)}</span>}
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-zinc-100 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${over ? "bg-red-500" : pct > 80 ? "bg-amber-400" : "bg-emerald-500"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-xs text-zinc-400 mt-0.5">
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
