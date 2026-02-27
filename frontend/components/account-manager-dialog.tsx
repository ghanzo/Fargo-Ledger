"use client";

import { useState } from "react";
import axios from "axios";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Trash2, Plus, Pencil, Check, X } from "lucide-react";
import { useAccount } from "@/context/account-context";

interface AccountManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AccountManagerDialog({ open, onOpenChange }: AccountManagerDialogProps) {
  const { accounts, refreshAccounts } = useAccount();
  const [newName,    setNewName]    = useState("");
  const [loading,    setLoading]    = useState(false);
  const [editingId,  setEditingId]  = useState<number | null>(null);
  const [editName,   setEditName]   = useState("");

  const handleAdd = async () => {
    if (!newName.trim()) return;
    setLoading(true);
    try {
      await axios.post("http://localhost:8001/accounts", { name: newName.trim() });
      setNewName("");
      await refreshAccounts();
    } catch (err: any) {
      toast.error(err?.response?.data?.detail ?? "Failed to create account");
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (id: number, currentName: string) => {
    setEditingId(id);
    setEditName(currentName);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName("");
  };

  const handleRename = async (id: number) => {
    if (!editName.trim()) return;
    try {
      await axios.put(`http://localhost:8001/accounts/${id}`, { name: editName.trim() });
      setEditingId(null);
      setEditName("");
      await refreshAccounts();
    } catch (err: any) {
      toast.error(err?.response?.data?.detail ?? "Failed to rename account");
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await axios.delete(`http://localhost:8001/accounts/${id}`);
      await refreshAccounts();
    } catch (err: any) {
      toast.error(err?.response?.data?.detail ?? "Failed to delete account");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Manage Accounts</DialogTitle>
        </DialogHeader>

        {accounts.length > 0 && (
          <div className="divide-y border rounded-lg mb-4">
            {accounts.map((a) => (
              <div key={a.id} className="flex items-center gap-2 px-3 py-2">
                {editingId === a.id ? (
                  <>
                    <Input
                      autoFocus
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleRename(a.id);
                        if (e.key === "Escape") cancelEdit();
                      }}
                      className="h-7 text-sm flex-1"
                    />
                    <button
                      onClick={() => handleRename(a.id)}
                      className="text-zinc-400 hover:text-emerald-600 transition-colors"
                      title="Save"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="text-zinc-400 hover:text-zinc-700 transition-colors"
                      title="Cancel"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 text-sm font-medium text-zinc-700">{a.name}</span>
                    <button
                      onClick={() => startEdit(a.id, a.name)}
                      className="text-zinc-300 hover:text-zinc-600 transition-colors"
                      title="Rename account"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(a.id)}
                      className="text-zinc-300 hover:text-red-500 transition-colors"
                      title="Delete account"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {accounts.length === 0 && (
          <p className="text-sm text-zinc-400 text-center py-4">No accounts yet.</p>
        )}

        <div className="border rounded-lg p-3 bg-zinc-50">
          <p className="text-xs font-medium text-zinc-500 mb-2 uppercase tracking-wide">Add Account</p>
          <div className="flex gap-2">
            <Input
              placeholder="Account name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
              className="h-9 text-sm"
            />
            <Button size="sm" className="h-9 gap-1" onClick={handleAdd} disabled={loading || !newName.trim()}>
              <Plus className="h-4 w-4" /> Add
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
