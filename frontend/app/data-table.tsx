"use client";

import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
  getSortedRowModel,
  SortingState,
  getFilteredRowModel,
  Row,
} from "@tanstack/react-table";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useState, useRef, useMemo, useEffect, useCallback } from "react";
import { BulkEditDialog } from "@/components/bulk-edit-dialog";
import { TransactionPanel } from "@/components/transaction-panel";
import { Transaction } from "@/types/transaction";
import { X, Download } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Filter Pill ─────────────────────────────────────────────────────────────
type FilterState = boolean | null;

function FilterPill({
  offLabel, onLabel, offOnLabel, value, onChange,
}: {
  offLabel: string; onLabel: string; offOnLabel: string;
  value: FilterState; onChange: (v: FilterState) => void;
}) {
  const cycle = () => {
    if (value === null) onChange(true);
    else if (value === true) onChange(false);
    else onChange(null);
  };
  return (
    <button
      onClick={cycle}
      className={cn(
        "text-xs px-3 py-1.5 rounded-full border font-medium transition-colors whitespace-nowrap",
        value === null
          ? "border-zinc-200 text-zinc-500 hover:border-zinc-400 hover:text-zinc-700"
          : value === true
          ? "bg-blue-600 text-white border-blue-600"
          : "bg-amber-500 text-white border-amber-500"
      )}
    >
      {value === null ? offLabel : value === true ? onLabel : offOnLabel}
    </button>
  );
}
// ────────────────────────────────────────────────────────────────────────────

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  onRefresh?: () => void;
}

export function DataTable<TData, TValue>({ columns, data, onRefresh }: DataTableProps<TData, TValue>) {
  const [sorting,      setSorting]      = useState<SortingState>([]);
  const [rowSelection, setRowSelection] = useState({});
  const [globalFilter, setGlobalFilter] = useState("");
  const [isBulkOpen,   setIsBulkOpen]   = useState(false);

  // Side panel state
  const [panelTx,   setPanelTx]   = useState<Transaction | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  // Filter state — null = off, true = "has/yes", false = "no/hasn't"
  const [filterVendor,         setFilterVendor]         = useState<FilterState>(null);
  const [filterCategory,       setFilterCategory]       = useState<FilterState>(null);
  const [filterProject,        setFilterProject]        = useState<FilterState>(null);
  const [filterTaxDeductible,  setFilterTaxDeductible]  = useState<FilterState>(null);
  const [filterCategorized,    setFilterCategorized]    = useState<FilterState>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo,   setDateTo]   = useState("");

  const lastSelectedIndex = useRef<number | null>(null);
  const [focusedIndex,   setFocusedIndex]   = useState<number | null>(null);
  const rowRefs          = useRef<(HTMLTableRowElement | null)[]>([]);

  // Client-side filtering
  const filteredData = useMemo(() => {
    let result = data as unknown as Transaction[];
    if (filterVendor === true)        result = result.filter((tx) => !!tx.vendor);
    else if (filterVendor === false)  result = result.filter((tx) => !tx.vendor);
    if (filterCategory === true)      result = result.filter((tx) => !!tx.category);
    else if (filterCategory === false)result = result.filter((tx) => !tx.category);
    if (filterProject === true)       result = result.filter((tx) => !!tx.project);
    else if (filterProject === false) result = result.filter((tx) => !tx.project);
    if (filterTaxDeductible === true) result = result.filter((tx) => !!tx.tax_deductible);
    else if (filterTaxDeductible === false) result = result.filter((tx) => !tx.tax_deductible);
    if (filterCategorized === true)   result = result.filter((tx) => tx.is_cleaned);
    else if (filterCategorized === false)   result = result.filter((tx) => !tx.is_cleaned);
    if (dateFrom) result = result.filter((tx) => tx.transaction_date >= dateFrom);
    if (dateTo)   result = result.filter((tx) => tx.transaction_date <= dateTo);
    return result as unknown as TData[];
  }, [data, filterVendor, filterCategory, filterProject, filterTaxDeductible, filterCategorized, dateFrom, dateTo]);

  const openPanel = useCallback((tx: Transaction) => {
    setPanelTx(tx);
    setPanelOpen(true);
  }, []);

  const table = useReactTable({
    data: filteredData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    onSortingChange: setSorting,
    getSortedRowModel: getSortedRowModel(),
    onRowSelectionChange: setRowSelection,
    getFilteredRowModel: getFilteredRowModel(),
    state: { sorting, rowSelection, globalFilter },
    onGlobalFilterChange: setGlobalFilter,
    meta: { onRefresh, openPanel },
  });

  const selectedRows         = table.getFilteredSelectedRowModel().rows;
  const selectedIds          = selectedRows.map((row: any) => row.original.id);
  const selectedTransactions = selectedRows.map((row: any) => row.original as Transaction);

  // ── CSV export ─────────────────────────────────────────────────────────
  const exportCsv = useCallback(() => {
    const rows = table.getRowModel().rows.map((r) => r.original as Transaction);
    const headers = ["Date", "Description", "Vendor", "Category", "Amount", "Notes", "Tags", "Tax Deductible", "Status"];
    const escape = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      headers.join(","),
      ...rows.map((tx) => [
        tx.transaction_date, tx.description, tx.vendor ?? "",
        tx.category ?? "", tx.amount,
        tx.notes ?? "", (tx.tags ?? []).join("; "),
        tx.tax_deductible ? "Yes" : "", tx.is_cleaned ? "Cleaned" : "Uncleaned",
      ].map(escape).join(",")),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = "transactions.csv"; a.click();
    URL.revokeObjectURL(url);
  }, [table]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const rows = table.getRowModel().rows;
      const len  = rows.length;

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = prev === null ? 0 : Math.min(prev + 1, len - 1);
          rowRefs.current[next]?.scrollIntoView({ block: "nearest" });
          return next;
        });
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = prev === null ? 0 : Math.max(prev - 1, 0);
          rowRefs.current[next]?.scrollIntoView({ block: "nearest" });
          return next;
        });
      } else if (e.key === " " && focusedIndex !== null) {
        e.preventDefault();
        const row = rows[focusedIndex];
        if (row) { row.toggleSelected(!row.getIsSelected()); lastSelectedIndex.current = focusedIndex; }
      } else if (e.key === "e" && focusedIndex !== null) {
        e.preventDefault();
        const row = rows[focusedIndex];
        if (row) openPanel(row.original as Transaction);
      } else if (e.key === "Escape") {
        if (panelOpen) { setPanelOpen(false); }
        else { table.toggleAllRowsSelected(false); lastSelectedIndex.current = null; setFocusedIndex(null); }
      } else if ((e.ctrlKey || e.metaKey) && e.key === "a") {
        e.preventDefault();
        table.toggleAllRowsSelected(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [table, focusedIndex, panelOpen, openPanel]);

  const activeFilterCount = [
    filterVendor !== null, filterCategory !== null, filterProject !== null,
    filterTaxDeductible !== null, filterCategorized !== null,
    !!dateFrom, !!dateTo,
  ].filter(Boolean).length;

  const clearFilters = () => {
    setFilterVendor(null); setFilterCategory(null); setFilterProject(null);
    setFilterTaxDeductible(null); setFilterCategorized(null);
    setDateFrom(""); setDateTo("");
  };

  return (
    <div>
      {/* ── FILTER BAR ──────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2 pb-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Input
            placeholder="Search transactions..."
            value={globalFilter ?? ""}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="max-w-xs h-8 text-sm"
          />
          <div className="h-5 w-px bg-zinc-200 mx-1" />
          <FilterPill offLabel="Vendor"   onLabel="Has Vendor"   offOnLabel="No Vendor"       value={filterVendor}        onChange={setFilterVendor} />
          <FilterPill offLabel="Category" onLabel="Has Category" offOnLabel="No Category"     value={filterCategory}      onChange={setFilterCategory} />
          <FilterPill offLabel="Project"  onLabel="Has Project"  offOnLabel="No Project"      value={filterProject}       onChange={setFilterProject} />
          <FilterPill offLabel="Tax"      onLabel="Tax Deductible" offOnLabel="Not Deductible" value={filterTaxDeductible} onChange={setFilterTaxDeductible} />
          <FilterPill offLabel="Status"   onLabel="Categorized" offOnLabel="Uncategorized"    value={filterCategorized}   onChange={setFilterCategorized} />
          {activeFilterCount > 0 && (
            <>
              <div className="h-5 w-px bg-zinc-200 mx-1" />
              <button
                onClick={clearFilters}
                className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-700 transition-colors"
              >
                <X className="h-3 w-3" /> Clear all
              </button>
            </>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-zinc-400">Date range:</span>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-[140px] text-xs h-7" />
          <span className="text-zinc-300 text-xs">→</span>
          <Input type="date" value={dateTo}   onChange={(e) => setDateTo(e.target.value)}   className="w-[140px] text-xs h-7" />
          <span className="text-xs text-zinc-400 ml-1">
            {table.getRowModel().rows.length.toLocaleString()} of {(data as any[]).length.toLocaleString()} transactions
          </span>
          <div className="ml-auto">
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={exportCsv}>
              <Download className="h-3 w-3" /> Export CSV
            </Button>
          </div>
        </div>
      </div>

      {/* ── TABLE ───────────────────────────────────────────────────── */}
      <div className="rounded-md border overflow-auto" style={{ maxHeight: "calc(100vh - 300px)" }}>
        <Table>
          <TableHeader className="sticky top-0 bg-white z-10 shadow-[0_1px_0_0_#e4e4e7]">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row, rowIndex) => (
                <TableRow
                  key={row.id}
                  ref={(el) => { rowRefs.current[rowIndex] = el; }}
                  data-state={row.getIsSelected() && "selected"}
                  className={cn("cursor-pointer", focusedIndex === rowIndex && "outline outline-2 outline-blue-400 outline-offset-[-2px]")}
                  onMouseDown={(e) => { if (e.shiftKey) e.preventDefault(); }}
                  onClick={(e) => {
                    const target = e.target as HTMLElement;
                    const isCheckbox = !!target.closest("[data-row-checkbox]");

                    // Block dropdown triggers and menu items
                    if (!isCheckbox && target.closest("button")) return;
                    if (target.closest('[role="menuitem"]') || target.closest("[data-radix-popper-content-wrapper]")) return;

                    if (e.shiftKey) {
                      // Range select from last clicked row
                      if (lastSelectedIndex.current !== null) {
                        const start = Math.min(lastSelectedIndex.current, rowIndex);
                        const end   = Math.max(lastSelectedIndex.current, rowIndex);
                        table.getRowModel().rows.slice(start, end + 1).forEach((r) => r.toggleSelected(true));
                      }
                      lastSelectedIndex.current = rowIndex;
                    } else if (isCheckbox) {
                      // Checkbox click = toggle selection
                      row.toggleSelected(!row.getIsSelected());
                      lastSelectedIndex.current = rowIndex;
                    } else {
                      // Regular row click = open detail panel
                      openPanel(row.original as Transaction);
                    }
                  }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-zinc-500">
                  No transactions found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* ── STATUS ──────────────────────────────────────────────────── */}
      <div className="py-2 text-xs text-zinc-400">
        {selectedIds.length > 0
          ? `${selectedIds.length} selected — shift+click to extend · Esc to clear`
          : "j/k or ↑↓ to navigate · Space to select · e to edit · Ctrl+A select all · shift+click range"}
      </div>

      {/* ── FLOATING ACTION BAR ─────────────────────────────────────── */}
      {selectedIds.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-zinc-900 text-white px-6 py-3 rounded-full shadow-xl flex items-center gap-4 z-50 animate-in slide-in-from-bottom-5 fade-in">
          <span className="text-sm font-medium">{selectedIds.length} selected</span>
          <div className="h-4 w-px bg-zinc-700" />
          <Button size="sm" variant="secondary" className="h-8 text-xs hover:bg-zinc-200" onClick={() => setIsBulkOpen(true)}>
            Categorize / Edit
          </Button>
          <Button
            size="sm" variant="ghost" className="h-8 text-xs text-zinc-400 hover:text-white hover:bg-zinc-800"
            onClick={() => { table.toggleAllRowsSelected(false); lastSelectedIndex.current = null; }}
          >
            Clear
          </Button>
        </div>
      )}

      {/* ── DIALOGS ─────────────────────────────────────────────────── */}
      <BulkEditDialog
        open={isBulkOpen}
        onOpenChange={setIsBulkOpen}
        selectedIds={selectedIds}
        selectedTransactions={selectedTransactions}
        onSuccess={() => {
          table.toggleAllRowsSelected(false);
          lastSelectedIndex.current = null;
          onRefresh?.();
        }}
      />

      <TransactionPanel
        transaction={panelTx}
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        onSave={() => { setPanelOpen(false); onRefresh?.(); }}
      />
    </div>
  );
}
