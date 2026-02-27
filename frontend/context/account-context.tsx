"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import axios from "axios";

export interface Account {
  id: number;
  name: string;
}

interface AccountContextValue {
  accounts: Account[];
  activeAccount: Account | null;
  setActiveAccount: (account: Account) => void;
  refreshAccounts: () => Promise<void>;
}

const AccountContext = createContext<AccountContextValue | null>(null);

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeAccount, setActiveAccountState] = useState<Account | null>(null);

  const refreshAccounts = useCallback(async () => {
    try {
      const res = await axios.get("http://localhost:8001/accounts");
      const fetched: Account[] = res.data;
      setAccounts(fetched);

      // Restore previously selected account if still valid, otherwise pick first
      const savedId = localStorage.getItem("activeAccountId");
      const saved = savedId ? fetched.find((a) => a.id === Number(savedId)) : null;
      const next = saved ?? fetched[0] ?? null;

      setActiveAccountState(next);
      if (next) {
        localStorage.setItem("activeAccountId", String(next.id));
      }
    } catch {
      // silently fail — backend may not be up yet
    }
  }, []);

  useEffect(() => {
    refreshAccounts();
  }, [refreshAccounts]);

  const setActiveAccount = (account: Account) => {
    setActiveAccountState(account);
    localStorage.setItem("activeAccountId", String(account.id));
  };

  return (
    <AccountContext.Provider value={{ accounts, activeAccount, setActiveAccount, refreshAccounts }}>
      {children}
    </AccountContext.Provider>
  );
}

export function useAccount(): AccountContextValue {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error("useAccount must be used within AccountProvider");
  return ctx;
}
