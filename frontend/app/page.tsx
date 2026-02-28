"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { Transaction } from "@/types/transaction";
import { DataTable } from "./data-table";
import { columns } from "./columns";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Upload } from "lucide-react";
import { ImportDialog } from "@/components/import-dialog";
import { SuggestionBanner } from "@/components/suggestion-banner";
import { useAccount } from "@/context/account-context";

export default function Home() {
  const { activeAccount } = useAccount();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading,      setLoading]      = useState(false);
  const [importOpen,   setImportOpen]   = useState(false);

  const fetchData = async () => {
    if (!activeAccount) return;
    setLoading(true);
    try {
      const response = await axios.get(
        `http://localhost:8001/transactions?account_id=${activeAccount.id}`
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
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => setImportOpen(true)}
        >
          <Upload className="h-4 w-4" />
          Import CSV
        </Button>
      </header>

      {activeAccount && (
        <SuggestionBanner accountId={activeAccount.id} onApplied={fetchData} />
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
