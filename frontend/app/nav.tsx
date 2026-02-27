"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useAccount } from "@/context/account-context";
import { AccountManagerDialog } from "@/components/account-manager-dialog";

export function NavBar() {
  const pathname = usePathname();
  const { accounts, activeAccount, setActiveAccount } = useAccount();
  const [manageOpen, setManageOpen] = useState(false);

  const link = (href: string, label: string) => (
    <Link
      href={href}
      className={`text-sm transition-colors px-1 pb-0.5 border-b-2 ${
        pathname === href
          ? "text-zinc-900 font-medium border-zinc-900"
          : "text-zinc-400 hover:text-zinc-700 border-transparent"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <>
      <nav className="bg-white border-b px-8 py-3 flex items-center gap-6">
        <span className="text-sm font-bold text-zinc-900 mr-2">Finance</span>
        {link("/", "Transactions")}
        {link("/analysis", "Analysis")}
        {link("/report", "Report")}
        {link("/management", "Management")}

        <div className="ml-auto flex items-center gap-2">
          <select
            value={activeAccount?.id ?? ""}
            onChange={(e) => {
              const selected = accounts.find((a) => a.id === Number(e.target.value));
              if (selected) setActiveAccount(selected);
            }}
            className="text-sm border rounded px-2 py-1 text-zinc-700 bg-white focus:outline-none focus:ring-1 focus:ring-zinc-300"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <button
            onClick={() => setManageOpen(true)}
            className="text-xs text-zinc-400 hover:text-zinc-700 transition-colors underline underline-offset-2"
          >
            Manage
          </button>
        </div>
      </nav>
      <AccountManagerDialog open={manageOpen} onOpenChange={setManageOpen} />
    </>
  );
}
