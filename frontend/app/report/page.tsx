"use client";

import { useEffect, useState, useMemo } from "react";
import axios from "axios";
import { Transaction } from "@/types/transaction";
import { useAccount } from "@/context/account-context";
import { Button } from "@/components/ui/button";
import { Printer, Download, ChevronLeft, ChevronRight } from "lucide-react";

// ── Helpers ──────────────────────────────────────────────────────────────────

const API = "http://localhost:8000";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Math.abs(n));

const fmtSigned = (n: number) => (n >= 0 ? "+" : "−") + fmt(n);

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function monthLabel(year: number, month: number) {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

// ── Aggregation types ─────────────────────────────────────────────────────────

interface VendorAgg {
  label: string;
  income: number;
  expenses: number;
  count: number;
}

interface ProjectAgg {
  label: string;
  income: number;
  expenses: number;
  vendors: Map<string, VendorAgg>;
  // detail tree: category → vendor → Transaction[]
  detail: Map<string, Map<string, Transaction[]>>;
}

// ── Report Page ───────────────────────────────────────────────────────────────

export default function ReportPage() {
  const { activeAccount } = useAccount();

  // Period selector
  const today = new Date();
  const [periodMode, setPeriodMode] = useState<"month" | "year">("month");
  const [year,       setYear]       = useState(today.getFullYear());
  const [month,      setMonth]      = useState(today.getMonth() + 1);
  const [reportYear, setReportYear] = useState(today.getFullYear());

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading,      setLoading]      = useState(false);
  const [saving,       setSaving]       = useState(false);

  // Derive date range from current mode
  const { dateFrom, dateTo, periodLabel } = useMemo(() => {
    if (periodMode === "year") {
      return {
        dateFrom:    `${reportYear}-01-01`,
        dateTo:      `${reportYear}-12-31`,
        periodLabel: String(reportYear),
      };
    }
    const lastDay = new Date(year, month, 0).getDate();
    return {
      dateFrom:    `${year}-${String(month).padStart(2, "0")}-01`,
      dateTo:      `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
      periodLabel: monthLabel(year, month),
    };
  }, [periodMode, year, month, reportYear]);

  // Fetch transactions when period or account changes
  useEffect(() => {
    if (!activeAccount) return;
    setLoading(true);
    axios
      .get(`${API}/transactions`, {
        params: { account_id: activeAccount.id, date_from: dateFrom, date_to: dateTo },
      })
      .then((res) => setTransactions(res.data))
      .catch(() => setTransactions([]))
      .finally(() => setLoading(false));
  }, [activeAccount, dateFrom, dateTo]);

  const prevMonth = () => {
    if (month === 1) { setYear((y) => y - 1); setMonth(12); }
    else setMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (month === 12) { setYear((y) => y + 1); setMonth(1); }
    else setMonth((m) => m + 1);
  };

  // ── Aggregations ────────────────────────────────────────────────────────────

  const { summary, projectList } = useMemo(() => {
    let totalIncome   = 0;
    let totalExpenses = 0;
    let taxDed        = 0;

    const projectMap = new Map<string, ProjectAgg>();

    const getProject = (key: string, label: string): ProjectAgg => {
      if (!projectMap.has(key)) {
        projectMap.set(key, { label, income: 0, expenses: 0, vendors: new Map(), detail: new Map() });
      }
      return projectMap.get(key)!;
    };

    for (const tx of transactions) {
      const amount  = parseFloat(String(tx.amount));
      const isIncome = amount > 0;

      if (isIncome) totalIncome   += amount;
      else          totalExpenses += Math.abs(amount);
      if (tx.tax_deductible) taxDed += Math.abs(amount);

      const projKey   = tx.project  || "__none__";
      const projLabel = tx.project  || "(No Project)";
      const vendKey   = tx.vendor   || "__novendor__";
      const vendLabel = tx.vendor   || "(No Vendor)";
      const catKey    = tx.category || "(No Category)";

      const proj = getProject(projKey, projLabel);
      if (isIncome) proj.income   += amount;
      else          proj.expenses += Math.abs(amount);

      // Vendor agg
      if (!proj.vendors.has(vendKey)) {
        proj.vendors.set(vendKey, { label: vendLabel, income: 0, expenses: 0, count: 0 });
      }
      const vend = proj.vendors.get(vendKey)!;
      if (isIncome) vend.income   += amount;
      else          vend.expenses += Math.abs(amount);
      vend.count++;

      // Detail tree
      if (!proj.detail.has(catKey)) proj.detail.set(catKey, new Map());
      const catMap = proj.detail.get(catKey)!;
      if (!catMap.has(vendKey)) catMap.set(vendKey, []);
      catMap.get(vendKey)!.push(tx);
    }

    // Sort transactions within each vendor by date
    for (const proj of projectMap.values()) {
      for (const catMap of proj.detail.values()) {
        for (const txList of catMap.values()) {
          txList.sort((a, b) => a.transaction_date.localeCompare(b.transaction_date));
        }
      }
    }

    // Sort projects: most expenses first; (No Project) always last
    const sorted = [...projectMap.entries()].sort(([ak, av], [bk, bv]) => {
      if (ak === "__none__") return 1;
      if (bk === "__none__") return -1;
      return bv.expenses - av.expenses;
    });

    return {
      summary: {
        income:   totalIncome,
        expenses: totalExpenses,
        net:      totalIncome - totalExpenses,
        taxDed,
        count:    transactions.length,
      },
      projectList: sorted,
    };
  }, [transactions]);

  const generatedDate = new Date().toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });

  // ── Save as PDF ─────────────────────────────────────────────────────────────

  const saveReport = async () => {
    const content = document.getElementById("report-content");
    if (!content) return;
    setSaving(true);
    try {
      const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
        import("jspdf"),
        import("html2canvas"),
      ]);

      const canvas = await html2canvas(content, { scale: 2, useCORS: true, logging: false });
      const imgData = canvas.toDataURL("image/png");

      const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
      const pageW  = pdf.internal.pageSize.getWidth();
      const pageH  = pdf.internal.pageSize.getHeight();
      const imgW   = pageW;
      const imgH   = (canvas.height * pageW) / canvas.width;

      let y = 0;
      let remaining = imgH;
      let page = 0;
      while (remaining > 0) {
        if (page > 0) pdf.addPage();
        pdf.addImage(imgData, "PNG", 0, -y, imgW, imgH);
        y         += pageH;
        remaining -= pageH;
        page++;
      }

      pdf.save(`report-${periodLabel.replace(/\s+/g, "-")}.pdf`);
    } finally {
      setSaving(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-zinc-50 print:bg-white">
      {/* ── Screen-only controls ─────────────────────────────────────── */}
      <div className="print:hidden bg-white border-b px-8 py-3 flex items-center gap-4">
        {/* Mode toggle */}
        <div className="flex rounded-md border overflow-hidden text-xs">
          {(["month", "year"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setPeriodMode(mode)}
              className={`px-3 py-1.5 transition-colors ${
                periodMode === mode
                  ? "bg-zinc-900 text-white"
                  : "text-zinc-500 hover:text-zinc-700 hover:bg-zinc-50"
              }`}
            >
              {mode === "month" ? "Month" : "Year"}
            </button>
          ))}
        </div>

        {/* Navigator */}
        {periodMode === "month" ? (
          <div className="flex items-center gap-1">
            <button onClick={prevMonth} className="p-1 rounded hover:bg-zinc-100">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-medium w-[160px] text-center">
              {monthLabel(year, month)}
            </span>
            <button onClick={nextMonth} className="p-1 rounded hover:bg-zinc-100">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <button onClick={() => setReportYear((y) => y - 1)} className="p-1 rounded hover:bg-zinc-100">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-medium w-[60px] text-center">
              {reportYear}
            </span>
            <button onClick={() => setReportYear((y) => y + 1)} className="p-1 rounded hover:bg-zinc-100">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}

        {loading && <span className="text-xs text-zinc-400">Loading...</span>}
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={saveReport} disabled={saving} className="gap-2">
            <Download className="h-4 w-4" />
            {saving ? "Saving..." : "Save PDF"}
          </Button>
          <Button size="sm" onClick={() => window.print()} className="gap-2">
            <Printer className="h-4 w-4" />
            Print Report
          </Button>
        </div>
      </div>

      {/* ── Report content ───────────────────────────────────────────── */}
      <div id="report-content" className="max-w-4xl mx-auto py-8 px-6 print:py-0 print:px-0 print:max-w-none">
        {/* Header */}
        <div className="mb-6 print:mb-4">
          <h1 className="text-2xl font-bold text-zinc-900 print:text-xl">Finance Report</h1>
          <div className="mt-1 text-sm text-zinc-500 flex flex-wrap gap-4 print:gap-6">
            <span>Account: <strong className="text-zinc-700">{activeAccount?.name ?? "—"}</strong></span>
            <span>Period: <strong className="text-zinc-700">{periodLabel}</strong></span>
            <span>Generated: <strong className="text-zinc-700">{generatedDate}</strong></span>
          </div>
          <div className="mt-3 border-b-2 border-zinc-900 print:border-zinc-700" />
        </div>

        {/* ── OVERVIEW ─────────────────────────────────────────────── */}
        <section className="mb-8 print:mb-6">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-3 print:text-zinc-500">
            Overview
          </h2>
          <div className="border rounded-lg overflow-hidden print:rounded-none print:border-zinc-300">
            <table className="w-full text-sm">
              <tbody>
                <OverviewRow label="Total Income"       value={fmt(summary.income)}        valueClass="text-emerald-700 font-semibold" />
                <OverviewRow label="Total Expenses"     value={fmt(summary.expenses)}      valueClass="font-semibold" />
                <OverviewRow label="Net"                value={fmtSigned(summary.net)}     valueClass={`font-bold ${summary.net >= 0 ? "text-emerald-700" : "text-red-600"}`} highlight />
                <OverviewRow label="Tax Deductible"     value={fmt(summary.taxDed)}        />
                <OverviewRow label="Total Transactions" value={String(summary.count)}      />
              </tbody>
            </table>
          </div>
        </section>

        {/* ── BY PROJECT ───────────────────────────────────────────── */}
        <section className="mb-8 print:mb-6">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-3 print:text-zinc-500">
            By Project
          </h2>
          <div className="space-y-4 print:space-y-3">
            {projectList.length === 0 && (
              <p className="text-sm text-zinc-400">No transactions in this period.</p>
            )}
            {projectList.map(([key, proj]) => (
              <div key={key} className="border rounded-lg overflow-hidden print:rounded-none print:border-zinc-300 print:break-inside-avoid">
                {/* Project header */}
                <div className="bg-zinc-50 px-4 py-2.5 border-b print:bg-white print:border-zinc-300">
                  <div className="flex items-baseline gap-3 flex-wrap">
                    <span className="font-semibold text-sm text-zinc-900">{proj.label}</span>
                    <span className="text-xs text-zinc-500">
                      Income {fmt(proj.income)} · Expenses {fmt(proj.expenses)} · Net{" "}
                      <span className={proj.income - proj.expenses >= 0 ? "text-emerald-700 font-medium" : "text-red-600 font-medium"}>
                        {fmtSigned(proj.income - proj.expenses)}
                      </span>
                    </span>
                  </div>
                </div>

                {/* Vendor table */}
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-white print:border-zinc-200">
                      <th className="text-left py-1.5 px-4 font-medium text-zinc-500">Vendor</th>
                      <th className="text-right py-1.5 px-4 font-medium text-zinc-500">Income</th>
                      <th className="text-right py-1.5 px-4 font-medium text-zinc-500">Expenses</th>
                      <th className="text-right py-1.5 px-4 font-medium text-zinc-500">Txns</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...proj.vendors.entries()]
                      .sort(([, a], [, b]) => b.expenses - a.expenses)
                      .map(([vk, vend]) => (
                        <tr key={vk} className="border-b last:border-0 print:border-zinc-100">
                          <td className="py-1.5 px-4 text-zinc-700">{vend.label}</td>
                          <td className="py-1.5 px-4 text-right text-emerald-700">
                            {vend.income > 0 ? fmt(vend.income) : "—"}
                          </td>
                          <td className="py-1.5 px-4 text-right text-zinc-700">
                            {vend.expenses > 0 ? fmt(vend.expenses) : "—"}
                          </td>
                          <td className="py-1.5 px-4 text-right text-zinc-500">{vend.count}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </section>

        {/* ── TRANSACTION DETAIL ───────────────────────────────────── */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-3 print:text-zinc-500">
            Transaction Detail
          </h2>
          <div className="space-y-6 print:space-y-4">
            {projectList.map(([projKey, proj]) => (
              <div key={projKey} className="print:break-inside-avoid">
                {/* Project heading */}
                <div className="font-semibold text-sm text-zinc-900 border-b-2 border-zinc-900 pb-1 mb-2 print:border-zinc-700">
                  {proj.label}
                </div>

                {[...proj.detail.entries()]
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([catKey, vendorMap]) => (
                    <div key={catKey} className="ml-4 mb-3 print:ml-3">
                      {/* Category heading */}
                      <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-1 print:text-zinc-600">
                        {catKey}
                      </div>

                      {[...vendorMap.entries()]
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([vendKey, txList]) => {
                          const vendLabel = txList[0]?.vendor || "(No Vendor)";
                          return (
                            <div key={vendKey} className="ml-4 mb-2 print:ml-3">
                              {/* Vendor heading */}
                              <div className="text-xs font-medium text-zinc-600 mb-0.5 print:text-zinc-700">
                                {vendLabel}
                              </div>

                              {/* Transactions */}
                              <table className="w-full text-xs">
                                <tbody>
                                  {txList.map((tx) => {
                                    const amt = parseFloat(String(tx.amount));
                                    return (
                                      <tr key={tx.id} className="leading-snug">
                                        <td className="py-0.5 pr-3 text-zinc-400 whitespace-nowrap font-mono">
                                          {periodMode === "year" ? tx.transaction_date : tx.transaction_date.slice(5)}
                                        </td>
                                        <td className="py-0.5 pr-3 text-zinc-600 max-w-[320px] truncate">
                                          {tx.notes || tx.description}
                                        </td>
                                        <td className={`py-0.5 text-right whitespace-nowrap font-mono ${amt > 0 ? "text-emerald-700" : "text-zinc-700"}`}>
                                          {amt > 0 ? "+" : "−"}{fmt(amt)}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          );
                        })}
                    </div>
                  ))}
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* ── Print styles ─────────────────────────────────────────────── */}
      <style jsx global>{`
        @media print {
          nav { display: none !important; }
          .print\\:hidden { display: none !important; }
          body { font-size: 10pt; }
          * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>
    </div>
  );
}

// ── Helper component ──────────────────────────────────────────────────────────

function OverviewRow({
  label, value, valueClass = "", highlight = false,
}: {
  label: string; value: string; valueClass?: string; highlight?: boolean;
}) {
  return (
    <tr className={highlight ? "bg-zinc-50 print:bg-zinc-50" : ""}>
      <td className="py-2.5 px-4 text-zinc-500 print:py-1.5">{label}</td>
      <td className={`py-2.5 px-4 text-right tabular-nums print:py-1.5 ${valueClass}`}>{value}</td>
    </tr>
  );
}
