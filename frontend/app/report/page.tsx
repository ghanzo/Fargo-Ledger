"use client";

import { useEffect, useState, useMemo } from "react";
import { usePersistentState } from "@/hooks/use-persistent-state";
import axios from "axios";
import { Transaction } from "@/types/transaction";
import { useAccount } from "@/context/account-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Printer, Download, ChevronLeft, ChevronRight } from "lucide-react";

// ── Helpers ──────────────────────────────────────────────────────────────────

const API = "http://localhost:8000";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Math.abs(n));

const fmtParen = (n: number) =>
  n < 0 ? `(${fmt(n)})` : fmt(n);

// ── Aggregation types ─────────────────────────────────────────────────────────

interface CategoryLine {
  label: string;
  amount: number;
}

interface PropertyAgg {
  label: string;
  income: CategoryLine[];
  expenses: CategoryLine[];
  totalIncome: number;
  totalExpenses: number;
  net: number;
}

// ── Report Page ───────────────────────────────────────────────────────────────

export default function ReportPage() {
  const { activeAccount } = useAccount();

  const today = new Date();
  const [year,             setYear]             = usePersistentState<number>("report:year", today.getFullYear());
  const [beginningBalance, setBeginningBalance] = usePersistentState<string>("report:beginningBalance", "");
  const [transactions,     setTransactions]     = useState<Transaction[]>([]);
  const [loading,          setLoading]          = useState(false);
  const [saving,           setSaving]           = useState(false);

  const dateFrom = `${year}-01-01`;
  const dateTo   = `${year}-12-31`;

  // Fetch transactions when year or account changes
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

  // ── Aggregations ────────────────────────────────────────────────────────────

  const { propertyList, transfersIn, transfersOut, totalIncome, totalExpenses, netIncome, txByPropertyList, txByDate } = useMemo(() => {
    // Separate transfers from P&L transactions
    let tIn  = 0;
    let tOut = 0;

    // Map: project key → category → amount
    const projectIncomeMap  = new Map<string, Map<string, number>>();
    const projectExpenseMap = new Map<string, Map<string, number>>();

    for (const tx of transactions) {
      const amount = parseFloat(String(tx.amount));

      if (tx.is_transfer) {
        if (amount > 0) tIn  += amount;
        else            tOut += Math.abs(amount);
        continue; // exclude from P&L
      }

      const projKey = tx.project || "__none__";
      const catKey  = tx.category || "Uncategorized";

      if (amount > 0) {
        if (!projectIncomeMap.has(projKey))  projectIncomeMap.set(projKey, new Map());
        const catMap = projectIncomeMap.get(projKey)!;
        catMap.set(catKey, (catMap.get(catKey) ?? 0) + amount);
      } else {
        if (!projectExpenseMap.has(projKey)) projectExpenseMap.set(projKey, new Map());
        const catMap = projectExpenseMap.get(projKey)!;
        catMap.set(catKey, (catMap.get(catKey) ?? 0) + Math.abs(amount));
      }
    }

    // Build all project keys (union of income + expense projects)
    const allKeys = new Set([...projectIncomeMap.keys(), ...projectExpenseMap.keys()]);

    const list: [string, PropertyAgg][] = [];
    for (const key of allKeys) {
      const label = key === "__none__" ? "Other / Miscellaneous" : key;

      const incomeLines: CategoryLine[] = [...(projectIncomeMap.get(key) ?? new Map()).entries()]
        .map(([l, a]) => ({ label: l, amount: a }))
        .sort((a, b) => b.amount - a.amount);

      const expenseLines: CategoryLine[] = [...(projectExpenseMap.get(key) ?? new Map()).entries()]
        .map(([l, a]) => ({ label: l, amount: a }))
        .sort((a, b) => b.amount - a.amount);

      const totalInc  = incomeLines.reduce((s, l) => s + l.amount, 0);
      const totalExp  = expenseLines.reduce((s, l) => s + l.amount, 0);

      list.push([key, {
        label,
        income:        incomeLines,
        expenses:      expenseLines,
        totalIncome:   totalInc,
        totalExpenses: totalExp,
        net:           totalInc - totalExp,
      }]);
    }

    // Sort: alphabetical by project name, "Other / Miscellaneous" always last
    list.sort(([ak, av], [bk, bv]) => {
      if (ak === "__none__") return 1;
      if (bk === "__none__") return -1;
      return av.label.localeCompare(bv.label);
    });

    const totalInc  = list.reduce((s, [, p]) => s + p.totalIncome,   0);
    const totalExp  = list.reduce((s, [, p]) => s + p.totalExpenses, 0);

    // ── Audit groupings: ALL transactions including transfers ──────────────
    const txProjMap = new Map<string, { label: string; txs: Transaction[] }>();
    for (const tx of transactions) {
      const key   = tx.project || "__none__";
      const label = tx.project || "Other / Miscellaneous";
      if (!txProjMap.has(key)) txProjMap.set(key, { label, txs: [] });
      txProjMap.get(key)!.txs.push(tx);
    }
    for (const { txs } of txProjMap.values()) {
      txs.sort((a, b) => a.transaction_date.localeCompare(b.transaction_date));
    }
    const txByPropertyList = [...txProjMap.entries()].sort(([ak], [bk]) => {
      if (ak === "__none__") return 1;
      if (bk === "__none__") return -1;
      return txProjMap.get(ak)!.label.localeCompare(txProjMap.get(bk)!.label);
    });
    const txByDate = [...transactions].sort((a, b) =>
      a.transaction_date.localeCompare(b.transaction_date)
    );

    return {
      propertyList:      list,
      transfersIn:       tIn,
      transfersOut:      tOut,
      totalIncome:       totalInc,
      totalExpenses:     totalExp,
      netIncome:         totalInc - totalExp,
      txByPropertyList,
      txByDate,
    };
  }, [transactions]);

  const beginBal  = parseFloat(beginningBalance.replace(/[^0-9.-]/g, "")) || 0;
  const endingBal = beginBal + netIncome + transfersIn - transfersOut;

  // Running balance per row — depends on both txByDate and beginBal
  const txByDateWithBalance = useMemo(() => {
    let bal = beginBal;
    return txByDate.map((tx) => {
      bal += parseFloat(String(tx.amount));
      return { tx, runningBal: bal };
    });
  }, [txByDate, beginBal]);

  const generatedDate = new Date().toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });

  // ── Save as PDF ─────────────────────────────────────────────────────────────

  const saveReport = async () => {
    const content = document.getElementById("report-content");
    if (!content) return;
    setSaving(true);
    try {
      const [{ default: jsPDF }, { toCanvas }] = await Promise.all([
        import("jspdf"),
        import("html-to-image"),
      ]);

      const canvas = await toCanvas(content, {
        pixelRatio: 2,
        backgroundColor: "#ffffff",
        style: { margin: "0", maxWidth: "none", width: `${content.scrollWidth}px` },
      });

      const pdf   = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const MX    = 40;
      const MY    = 48;
      const cW    = pageW - 2 * MX;
      const cH    = pageH - 2 * MY;
      const scale = cW / canvas.width;

      const ctx = canvas.getContext("2d")!;
      const isWhiteRow = (row: number): boolean => {
        const px = ctx.getImageData(0, row, canvas.width, 1).data;
        for (let i = 0; i < px.length; i += 4) {
          if (px[i] < 238 || px[i + 1] < 238 || px[i + 2] < 238) return false;
        }
        return true;
      };

      const findCutRow = (target: number, searchPx = 150): number => {
        for (let d = 0; d <= searchPx; d++) {
          if (target - d >= 0            && isWhiteRow(target - d)) return target - d;
          if (target + d < canvas.height && isWhiteRow(target + d)) return target + d;
        }
        return target;
      };

      const pageHeightPx = Math.round(cH / scale);
      const cuts: number[] = [0];
      let nextTarget = pageHeightPx;
      while (nextTarget < canvas.height) {
        const cut = findCutRow(nextTarget);
        cuts.push(Math.max(cut, cuts[cuts.length - 1] + 1));
        nextTarget = cuts[cuts.length - 1] + pageHeightPx;
      }
      cuts.push(canvas.height);

      for (let i = 0; i < cuts.length - 1; i++) {
        if (i > 0) pdf.addPage();
        const y0 = cuts[i];
        const y1 = cuts[i + 1];
        const sliceH = y1 - y0;

        const slice = document.createElement("canvas");
        slice.width  = canvas.width;
        slice.height = sliceH;
        const sCtx = slice.getContext("2d")!;
        sCtx.fillStyle = "#ffffff";
        sCtx.fillRect(0, 0, slice.width, slice.height);
        sCtx.drawImage(canvas, 0, y0, canvas.width, sliceH, 0, 0, canvas.width, sliceH);

        pdf.addImage(slice.toDataURL("image/png"), "PNG", MX, MY, cW, sliceH * scale);
      }

      pdf.save(`finance-report-${year}.pdf`);
    } finally {
      setSaving(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-zinc-50 print:bg-white">
      {/* ── Screen-only controls bar ───────────────────────────────── */}
      <div className="print:hidden bg-white border-b px-8 py-3 flex items-center gap-4 flex-wrap">
        {/* Year selector */}
        <div className="flex items-center gap-1">
          <button onClick={() => setYear((y) => y - 1)} className="p-1 rounded hover:bg-zinc-100">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-semibold w-[52px] text-center tabular-nums">{year}</span>
          <button onClick={() => setYear((y) => y + 1)} className="p-1 rounded hover:bg-zinc-100">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* Beginning balance */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-zinc-500 whitespace-nowrap">Beginning Balance:</span>
          <Input
            className="w-36 h-8 text-sm"
            placeholder="$0.00"
            value={beginningBalance}
            onChange={(e) => setBeginningBalance(e.target.value)}
          />
        </div>

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

      {/* ── Report content ─────────────────────────────────────────── */}
      <div id="report-content" className="max-w-4xl mx-auto py-8 px-6 print:py-0 print:px-0 print:max-w-none font-mono">

        {/* 1. HEADER */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-zinc-900">{activeAccount?.name ?? "—"}</h1>
          <h2 className="text-lg font-bold text-zinc-800 mt-1">Income Statement for {year}</h2>
          <div className="mt-2 text-xs text-zinc-400">Generated: {generatedDate}</div>
          <div className="mt-3 border-b-2 border-zinc-900" />
        </div>

        {/* 2. SUMMARY TABLE */}
        <section className="mb-10">
          <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-700 mb-3">Properties</h2>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-zinc-300">
                <th className="text-left pb-1.5 font-semibold text-zinc-700">Property</th>
                <th className="text-right pb-1.5 font-semibold text-zinc-700 w-32">Income</th>
                <th className="text-right pb-1.5 font-semibold text-zinc-700 w-32">Expenses</th>
                <th className="text-right pb-1.5 font-semibold text-zinc-700 w-32">Net</th>
              </tr>
            </thead>
            <tbody>
              {propertyList.map(([key, prop]) => (
                <tr key={key} className="border-b border-zinc-100">
                  <td className="py-1.5 text-zinc-800">{prop.label}</td>
                  <td className="py-1.5 text-right tabular-nums text-emerald-700">{fmt(prop.totalIncome)}</td>
                  <td className="py-1.5 text-right tabular-nums text-zinc-700">{prop.totalExpenses > 0 ? `(${fmt(prop.totalExpenses)})` : "—"}</td>
                  <td className={`py-1.5 text-right tabular-nums font-medium ${prop.net >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                    {prop.net >= 0 ? fmt(prop.net) : `(${fmt(prop.net)})`}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-zinc-400">
                <td className="pt-2 font-bold text-zinc-900 uppercase tracking-wide text-xs">Total</td>
                <td className="pt-2 text-right tabular-nums font-bold text-emerald-700">{fmt(totalIncome)}</td>
                <td className="pt-2 text-right tabular-nums font-bold text-zinc-700">{totalExpenses > 0 ? `(${fmt(totalExpenses)})` : "—"}</td>
                <td className={`pt-2 text-right tabular-nums font-bold ${netIncome >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                  {netIncome >= 0 ? fmt(netIncome) : `(${fmt(netIncome)})`}
                </td>
              </tr>
            </tfoot>
          </table>
        </section>

        {/* 3. INCOME STATEMENTS — per property */}
        <section className="mb-10">
          <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-4">Income Statements</h2>
          <div className="space-y-8">
            {propertyList.map(([key, prop]) => (
              <div key={key} className="print:break-inside-avoid">
                {/* Property heading */}
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-1 h-5 bg-zinc-800 rounded-sm" />
                  <span className="font-bold text-sm uppercase tracking-wide text-zinc-800">{prop.label}</span>
                </div>

                <div className="ml-4 space-y-4">
                  {/* INCOME */}
                  {prop.income.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-1">Income</div>
                      <table className="w-full text-sm">
                        <tbody>
                          {prop.income.map((line) => (
                            <tr key={line.label}>
                              <td className="py-0.5 pl-4 text-zinc-700">{line.label}</td>
                              <td className="py-0.5 text-right tabular-nums text-emerald-700 w-36">{fmt(line.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-zinc-300">
                            <td className="pt-1 pl-4 font-semibold text-zinc-800">Total Income</td>
                            <td className="pt-1 text-right tabular-nums font-semibold text-emerald-700 w-36">{fmt(prop.totalIncome)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}

                  {/* EXPENSES */}
                  {prop.expenses.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-1">Expenses</div>
                      <table className="w-full text-sm">
                        <tbody>
                          {prop.expenses.map((line) => (
                            <tr key={line.label}>
                              <td className="py-0.5 pl-4 text-zinc-700">{line.label}</td>
                              <td className="py-0.5 text-right tabular-nums text-zinc-700 w-36">({fmt(line.amount)})</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-zinc-300">
                            <td className="pt-1 pl-4 font-semibold text-zinc-800">Total Expenses</td>
                            <td className="pt-1 text-right tabular-nums font-semibold text-zinc-700 w-36">({fmt(prop.totalExpenses)})</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}

                  {/* NET INCOME */}
                  <div className="border-t-2 border-zinc-400 pt-2 flex justify-between items-center">
                    <span className="font-bold text-zinc-900">Net Income {prop.label}</span>
                    <span className={`font-bold tabular-nums text-sm ${prop.net >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                      {prop.net >= 0 ? fmt(prop.net) : `(${fmt(prop.net)})`}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 4. RECONCILIATION */}
        <section className="print:break-inside-avoid">
          <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-700 mb-3">Reconciliation</h2>
          <div className="border-t border-b border-zinc-300 py-3 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-zinc-600">Beginning Balance (Jan 1, {year})</span>
              <span className="tabular-nums font-medium text-zinc-800">{fmt(beginBal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-600">+ Net Income</span>
              <span className={`tabular-nums font-medium ${netIncome >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                {netIncome >= 0 ? fmt(netIncome) : `(${fmt(netIncome)})`}
              </span>
            </div>
            {transfersIn > 0 && (
              <div className="flex justify-between">
                <span className="text-zinc-600">+ Transfers In</span>
                <span className="tabular-nums font-medium text-zinc-700">{fmt(transfersIn)}</span>
              </div>
            )}
            {transfersOut > 0 && (
              <div className="flex justify-between">
                <span className="text-zinc-600">− Transfers Out</span>
                <span className="tabular-nums font-medium text-zinc-700">({fmt(transfersOut)})</span>
              </div>
            )}
          </div>
          <div className="border-b-2 border-zinc-400 pt-2 pb-2 flex justify-between items-center">
            <span className="font-bold text-zinc-900">Ending Balance (Dec 31, {year})</span>
            <span className={`font-bold tabular-nums ${endingBal >= 0 ? "text-emerald-700" : "text-red-600"}`}>
              {endingBal >= 0 ? fmt(endingBal) : `(${fmt(endingBal)})`}
            </span>
          </div>
        </section>

        {/* 5. TRANSACTIONS BY PROPERTY */}
        <section className="mt-12 mb-10">
          <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-700 mb-4">Transactions by Property</h2>
          <div className="space-y-8">
            {txByPropertyList.map(([key, { label, txs }]) => {
              const subtotal = txs.reduce((s, tx) => s + parseFloat(String(tx.amount)), 0);
              return (
                <div key={key} className="print:break-inside-avoid">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-1 h-4 bg-zinc-800 rounded-sm" />
                    <span className="font-bold text-sm text-zinc-800">{label}</span>
                    <span className="text-xs text-zinc-400">({txs.length} transactions)</span>
                  </div>
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-zinc-200">
                        <th className="text-left pb-1.5 font-medium text-zinc-400 w-24">Date</th>
                        <th className="text-left pb-1.5 font-medium text-zinc-400">Description</th>
                        <th className="text-left pb-1.5 font-medium text-zinc-400 w-28">Vendor</th>
                        <th className="text-left pb-1.5 font-medium text-zinc-400 w-28">Category</th>
                        <th className="text-right pb-1.5 font-medium text-zinc-400 w-28">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {txs.map((tx) => {
                        const amount     = parseFloat(String(tx.amount));
                        const isTransfer = tx.is_transfer;
                        const amtClass   = isTransfer ? "text-zinc-400" : amount > 0 ? "text-emerald-600" : "text-zinc-700";
                        return (
                          <tr key={tx.id} className="border-b border-zinc-50">
                            <td className="py-1 pr-2 font-mono text-zinc-400 whitespace-nowrap">{tx.transaction_date}</td>
                            <td className="py-1 pr-2 text-zinc-700 max-w-[240px] truncate">{tx.description}</td>
                            <td className="py-1 pr-2 text-zinc-500 truncate">{tx.vendor ?? <span className="text-zinc-300">—</span>}</td>
                            <td className="py-1 pr-2">
                              {tx.category ? (
                                <span className="inline-flex px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 whitespace-nowrap">{tx.category}</span>
                              ) : isTransfer ? (
                                <span className="inline-flex px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-400 whitespace-nowrap">Transfer</span>
                              ) : (
                                <span className="text-zinc-300">—</span>
                              )}
                            </td>
                            <td className={`py-1 text-right font-mono tabular-nums ${amtClass}`}>
                              {amount >= 0 ? "+" : "−"}{fmt(amount)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-zinc-300">
                        <td colSpan={4} className="pt-1.5 pr-2 text-right font-semibold text-zinc-700">Subtotal</td>
                        <td className={`pt-1.5 text-right font-semibold font-mono tabular-nums ${subtotal >= 0 ? "text-emerald-700" : "text-zinc-700"}`}>
                          {subtotal >= 0 ? "+" : "−"}{fmt(subtotal)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              );
            })}
          </div>
        </section>

        {/* 6. ALL TRANSACTIONS BY DATE */}
        <section className="mt-12">
          <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-700 mb-4">All Transactions by Date</h2>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b-2 border-zinc-300">
                <th className="text-left pb-1.5 font-medium text-zinc-400 w-24">Date</th>
                <th className="text-left pb-1.5 font-medium text-zinc-400 w-24">Property</th>
                <th className="text-left pb-1.5 font-medium text-zinc-400">Description</th>
                <th className="text-left pb-1.5 font-medium text-zinc-400 w-28">Vendor</th>
                <th className="text-left pb-1.5 font-medium text-zinc-400 w-28">Category</th>
                <th className="text-right pb-1.5 font-medium text-zinc-400 w-24">Amount</th>
                <th className="text-right pb-1.5 font-medium text-zinc-400 w-28">Balance</th>
              </tr>
            </thead>
            <tbody>
              {txByDateWithBalance.map(({ tx, runningBal }) => {
                const amount     = parseFloat(String(tx.amount));
                const isTransfer = tx.is_transfer;
                const amtClass   = isTransfer ? "text-zinc-400" : amount > 0 ? "text-emerald-600" : "text-zinc-700";
                return (
                  <tr key={tx.id} className="border-b border-zinc-50">
                    <td className="py-1 pr-2 font-mono text-zinc-400 whitespace-nowrap">{tx.transaction_date}</td>
                    <td className="py-1 pr-2 text-zinc-500 truncate">{tx.project ?? <span className="text-zinc-300">—</span>}</td>
                    <td className="py-1 pr-2 text-zinc-700 max-w-[200px] truncate">{tx.description}</td>
                    <td className="py-1 pr-2 text-zinc-500 truncate">{tx.vendor ?? <span className="text-zinc-300">—</span>}</td>
                    <td className="py-1 pr-2">
                      {tx.category ? (
                        <span className="inline-flex px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 whitespace-nowrap">{tx.category}</span>
                      ) : isTransfer ? (
                        <span className="inline-flex px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-400 whitespace-nowrap">Transfer</span>
                      ) : (
                        <span className="text-zinc-300">—</span>
                      )}
                    </td>
                    <td className={`py-1 text-right font-mono tabular-nums ${amtClass}`}>
                      {amount >= 0 ? "+" : "−"}{fmt(amount)}
                    </td>
                    <td className={`py-1 text-right font-mono tabular-nums font-medium ${runningBal >= 0 ? "text-zinc-700" : "text-red-600"}`}>
                      {fmt(runningBal)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-zinc-400">
                <td colSpan={5} className="pt-2 font-bold text-zinc-900 text-sm">Ending Balance (Dec 31, {year})</td>
                <td colSpan={2} className={`pt-2 text-right font-bold font-mono tabular-nums text-sm ${endingBal >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                  {fmt(endingBal)}
                </td>
              </tr>
            </tfoot>
          </table>
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
