"use client";

import { useEffect, useState, useCallback } from "react";
import api from "@/lib/api";
import { Transaction } from "@/types/transaction";
import { DataTable } from "./data-table";
import { columns } from "./columns";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Upload, Sparkles, ChevronDown, Users, Tag, FolderOpen } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ImportDialog } from "@/components/import-dialog";
import { SuggestionBanner } from "@/components/suggestion-banner";
import { useAccount } from "@/context/account-context";

export default function Home() {
  const { activeAccount } = useAccount();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading,      setLoading]      = useState(false);
  const [importOpen,   setImportOpen]   = useState(false);
  const [researching,  setResearching]  = useState(false);
  const [suggestionKey, setSuggestionKey] = useState(0);

  const fetchData = async () => {
    if (!activeAccount) return;
    setLoading(true);
    try {
      const response = await api.get(
        `/transactions?account_id=${activeAccount.id}`
      );
      setTransactions(response.data);
    } catch {
      toast.error("Failed to load transactions. Is the backend running?");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [activeAccount]);

  const handleResearchVendors = async () => {
    if (!activeAccount) return;
    setResearching(true);
    const toastId = toast.loading("Researching vendors...");
    try {
      const res = await api.post(`/research/vendors?account_id=${activeAccount.id}`);
      const d = res.data;
      const parts: string[] = [];
      if (d.suggestions_created > 0) parts.push(`${d.suggestions_created} suggestion${d.suggestions_created !== 1 ? "s" : ""} created`);
      if (d.cards_created > 0) parts.push(`${d.cards_created} new vendor card${d.cards_created !== 1 ? "s" : ""}`);

      if (parts.length > 0) {
        toast.success(parts.join(", ") + ".", { id: toastId });
        setSuggestionKey((k) => k + 1);
        fetchData();
      } else if (d.groups_found === 0) {
        toast.info("No unvendored transactions to research.", { id: toastId });
      } else {
        toast.info(`${d.skipped_existing} already processed, ${d.skipped_transfers} transfers skipped.`, { id: toastId });
      }
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      if (e?.response?.status === 503) {
        toast.error(detail || "Cannot connect to LLM service. Check your XAI_API_KEY.", { id: toastId });
      } else {
        toast.error(detail || "Research failed.", { id: toastId });
      }
    } finally {
      setResearching(false);
    }
  };

  const handleResearchCategories = async () => {
    if (!activeAccount) return;
    setResearching(true);
    const toastId = toast.loading("Researching categories...");
    try {
      const res = await api.post(`/research/categories?account_id=${activeAccount.id}`);
      const d = res.data;
      if (d.suggestions_created > 0) {
        toast.success(`${d.suggestions_created} category suggestion${d.suggestions_created !== 1 ? "s" : ""} created.`, { id: toastId });
        setSuggestionKey((k) => k + 1);
      } else if (d.found === 0) {
        toast.info("No uncategorized transactions with vendors to research.", { id: toastId });
      } else if (d.detail) {
        toast.info(d.detail, { id: toastId });
      } else {
        toast.info("No new category suggestions.", { id: toastId });
      }
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      toast.error(detail || "Category research failed.", { id: toastId });
    } finally {
      setResearching(false);
    }
  };

  const handleResearchProjects = async () => {
    if (!activeAccount) return;
    setResearching(true);
    const toastId = toast.loading("Researching projects...");
    try {
      const res = await api.post(`/research/projects?account_id=${activeAccount.id}`);
      const d = res.data;
      if (d.suggestions_created > 0) {
        toast.success(`${d.suggestions_created} project suggestion${d.suggestions_created !== 1 ? "s" : ""} created.`, { id: toastId });
        setSuggestionKey((k) => k + 1);
      } else if (d.found === 0) {
        toast.info("No unassigned transactions with vendors to research.", { id: toastId });
      } else if (d.detail) {
        toast.info(d.detail, { id: toastId });
      } else {
        toast.info("No new project suggestions.", { id: toastId });
      }
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      toast.error(detail || "Project research failed.", { id: toastId });
    } finally {
      setResearching(false);
    }
  };

  return (
    <div className="min-h-screen bg-muted text-foreground font-sans p-8">
      <Toaster />

      <header className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Transactions</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {loading ? "Loading..." : `${transactions.length.toLocaleString()} transactions`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="gap-2 border-purple-500/30 text-purple-400 hover:bg-purple-500/10"
                disabled={researching}
              >
                <Sparkles className={`h-4 w-4 ${researching ? "animate-pulse" : ""}`} />
                {researching ? "Researching..." : "Research"}
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleResearchVendors}>
                <Users className="h-4 w-4 mr-2" />
                Vendors
                <span className="ml-auto text-xs text-muted-foreground">unvendored txns</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleResearchCategories}>
                <Tag className="h-4 w-4 mr-2" />
                Categories
                <span className="ml-auto text-xs text-muted-foreground">uncategorized txns</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleResearchProjects}>
                <FolderOpen className="h-4 w-4 mr-2" />
                Projects
                <span className="ml-auto text-xs text-muted-foreground">unassigned txns</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => setImportOpen(true)}
          >
            <Upload className="h-4 w-4" />
            Import CSV
          </Button>
        </div>
      </header>

      {activeAccount && (
        <SuggestionBanner key={suggestionKey} accountId={activeAccount.id} onApplied={fetchData} />
      )}

      <div className="bg-background rounded-xl border shadow-sm p-6">
        {transactions.length === 0 && loading ? (
          <div className="text-center py-16 text-muted-foreground">Loading transactions...</div>
        ) : (
          <DataTable columns={columns} data={transactions} onRefresh={fetchData} />
        )}
      </div>

      {activeAccount && (
        <ImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          onSuccess={fetchData}
          accountId={activeAccount.id}
        />
      )}
    </div>
  );
}
