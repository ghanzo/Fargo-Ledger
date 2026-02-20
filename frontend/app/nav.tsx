"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavBar() {
  const pathname = usePathname();

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
    <nav className="bg-white border-b px-8 py-3 flex items-center gap-6">
      <span className="text-sm font-bold text-zinc-900 mr-2">Finance</span>
      {link("/", "Transactions")}
      {link("/analysis", "Analysis")}
    </nav>
  );
}
