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

export default function Home() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [importOpen,   setImportOpen]   = useState(false);

  const fetchData = async () => {
    try {
      const response = await axios.get("http://localhost:8000/transactions");
      setTransactions(response.data);
    } catch {
      toast.error("Failed to load transactions. Is the backend running?");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 font-sans p-8">
      <Toaster />

      <header className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Transactions</h1>
          <p className="text-zinc-500 text-sm mt-0.5">
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

      <div className="bg-white rounded-xl border shadow-sm p-6">
        {loading ? (
          <div className="text-center py-16 text-zinc-400">Loading transactions...</div>
        ) : (
          <DataTable columns={columns} data={transactions} onRefresh={fetchData} />
        )}
      </div>

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onSuccess={fetchData}
      />
    </div>
  );
}
