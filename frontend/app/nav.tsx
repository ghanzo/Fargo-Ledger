"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect, useCallback, useRef } from "react";
import { useTheme } from "next-themes";
import { useAccount } from "@/context/account-context";
import { AccountManagerDialog } from "@/components/account-manager-dialog";
import { Sun, Moon, FolderInput } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API ?? "http://localhost:8001";
const POLL_INTERVAL = 30_000;

interface WatcherLogEntry {
  timestamp: string;
  file: string;
  account: string;
  account_id?: number;
  status: string;
  imported?: number;
  skipped?: number;
  auto_categorized?: number;
  detail?: string;
}

interface WatcherStatus {
  running: boolean;
  inbox_dir: string;
  recent_imports: WatcherLogEntry[];
}

export function NavBar() {
  const pathname = usePathname();
  const { accounts, activeAccount, setActiveAccount } = useAccount();
  const [manageOpen, setManageOpen] = useState(false);
  const { theme, setTheme } = useTheme();

  // Watcher indicator state
  const [watcherStatus, setWatcherStatus] = useState<WatcherStatus | null>(null);
  const [unseenCount, setUnseenCount] = useState(0);
  const [showLog, setShowLog] = useState(false);
  const lastSeenTs = useRef<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API}/watcher/status`);
      if (!res.ok) return;
      const data: WatcherStatus = await res.json();
      setWatcherStatus(data);

      // Count entries newer than the last-seen timestamp
      if (data.recent_imports.length > 0) {
        const newest = data.recent_imports[0]?.timestamp;
        if (!lastSeenTs.current) {
          // First load — mark all as seen
          lastSeenTs.current = newest;
        } else {
          const unseen = data.recent_imports.filter(
            (e) => e.timestamp > lastSeenTs.current!
          ).length;
          setUnseenCount((prev) => prev + unseen);
          if (newest > lastSeenTs.current) {
            lastSeenTs.current = newest;
          }
        }
      }
    } catch {
      // Watcher endpoint unavailable — ignore
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [fetchStatus]);

  // Close popover on outside click
  useEffect(() => {
    if (!showLog) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowLog(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showLog]);

  const link = (href: string, label: string) => (
    <Link
      href={href}
      className={`text-sm transition-colors px-1 pb-0.5 border-b-2 ${
        pathname === href
          ? "text-foreground font-medium border-foreground"
          : "text-muted-foreground hover:text-foreground border-transparent"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <>
      <nav className="bg-background border-b px-8 py-3 flex items-center gap-6">
        <span className="text-sm font-bold text-foreground mr-2">Finance</span>
        {link("/", "Transactions")}
        {link("/analysis", "Analysis")}
        {link("/report", "Report")}
        {link("/management", "Management")}

        <div className="ml-auto flex items-center gap-2">
          {/* Auto-import watcher indicator */}
          <div className="relative" ref={popoverRef}>
            <button
              onClick={() => {
                setShowLog((v) => !v);
                setUnseenCount(0);
              }}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors relative"
              title="Auto-import status"
            >
              <FolderInput className="h-4 w-4" />
              {unseenCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-blue-500 text-[9px] font-bold text-white flex items-center justify-center">
                  {unseenCount > 9 ? "9+" : unseenCount}
                </span>
              )}
            </button>

            {showLog && (
              <div className="absolute right-0 top-full mt-2 w-80 bg-popover border rounded-lg shadow-lg z-50 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-foreground">Auto-Import Log</span>
                  {watcherStatus?.running && (
                    <span className="text-[10px] text-green-500 flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-green-500 inline-block" />
                      Watching
                    </span>
                  )}
                </div>
                {(!watcherStatus?.recent_imports || watcherStatus.recent_imports.length === 0) ? (
                  <p className="text-xs text-muted-foreground py-2">No recent imports.</p>
                ) : (
                  <ul className="space-y-1.5 max-h-60 overflow-y-auto">
                    {watcherStatus.recent_imports.map((entry, i) => (
                      <li
                        key={`${entry.timestamp}-${i}`}
                        className="text-xs border rounded px-2 py-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-foreground truncate max-w-[180px]">{entry.file}</span>
                          <span
                            className={`text-[10px] font-semibold ${
                              entry.status === "success"
                                ? "text-green-600"
                                : entry.status === "error"
                                  ? "text-red-500"
                                  : "text-yellow-500"
                            }`}
                          >
                            {entry.status}
                          </span>
                        </div>
                        <div className="text-muted-foreground mt-0.5">
                          {entry.account}
                          {entry.status === "success" && (
                            <> — {entry.imported} new, {entry.skipped} dup</>
                          )}
                          {entry.detail && <> — {entry.detail}</>}
                        </div>
                        <div className="text-muted-foreground/60 mt-0.5">
                          {new Date(entry.timestamp).toLocaleString()}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Toggle theme"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <select
            value={activeAccount?.id ?? ""}
            onChange={(e) => {
              const selected = accounts.find((a) => a.id === Number(e.target.value));
              if (selected) setActiveAccount(selected);
            }}
            className="text-sm border rounded px-2 py-1 text-foreground bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <button
            onClick={() => setManageOpen(true)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
          >
            Manage
          </button>
        </div>
      </nav>
      <AccountManagerDialog open={manageOpen} onOpenChange={setManageOpen} />
    </>
  );
}
