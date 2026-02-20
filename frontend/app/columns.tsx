"use client";

import { ColumnDef, CellContext } from "@tanstack/react-table";
import { Transaction } from "@/types/transaction";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowUpDown, MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Separate component so we can use hooks (useState) inside the cell
function ActionsCell({ row, table }: CellContext<Transaction, unknown>) {
  const tx         = row.original;
  const openPanel  = (table.options.meta as any)?.openPanel as ((tx: Transaction) => void) | undefined;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-8 w-8 p-0">
          <span className="sr-only">Open menu</span>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Actions</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => navigator.clipboard.writeText(tx.id)}>
          Copy ID
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => openPanel?.(tx)}>
          Edit Details
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export const columns: ColumnDef<Transaction>[] = [
  // 1. SELECT CHECKBOX
  {
    id: "select",
    header: ({ table }) => (
      <Checkbox
        checked={table.getIsAllPageRowsSelected()}
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        aria-label="Select all"
      />
    ),
    cell: ({ row }) => (
      // data-row-checkbox lets the row onClick identify this as a selection click
      // onCheckedChange is intentionally omitted — the row click handler owns all toggling
      <span data-row-checkbox="true" className="flex items-center">
        <Checkbox
          checked={row.getIsSelected()}
          aria-label="Select row"
        />
      </span>
    ),
    enableSorting: false,
    enableHiding: false,
  },
  // 2. DATE
  {
    accessorKey: "transaction_date",
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Date
        <ArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    cell: ({ row }) => (
      <div className="w-[100px] text-sm">{row.getValue("transaction_date")}</div>
    ),
  },
  // 3. VENDOR
  {
    accessorKey: "vendor",
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Vendor
        <ArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    cell: ({ row }) => {
      const vendor = row.getValue("vendor") as string;
      return vendor ? (
        <div className="font-medium text-sm">{vendor}</div>
      ) : (
        <span className="text-zinc-300 text-xs">—</span>
      );
    },
  },
  // 4. PROJECT
  {
    accessorKey: "project",
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Project
        <ArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    cell: ({ row }) => {
      const project = row.getValue("project") as string;
      return project ? (
        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-teal-50 text-teal-700 border border-teal-200 whitespace-nowrap">
          {project}
        </span>
      ) : (
        <span className="text-zinc-300 text-xs">—</span>
      );
    },
  },
  // 5. DESCRIPTION
  {
    accessorKey: "description",
    header: "Description",
    cell: ({ row }) => (
      <div className="min-w-[180px] max-w-[280px] whitespace-normal leading-snug text-xs text-zinc-600">
        {row.getValue("description")}
      </div>
    ),
  },
  // 5. CATEGORY
  {
    accessorKey: "category",
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Category
        <ArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    cell: ({ row }) => {
      const category = row.getValue("category") as string;
      return category ? (
        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 whitespace-nowrap">
          {category}
        </span>
      ) : (
        <span className="text-zinc-300 text-xs">—</span>
      );
    },
  },
  // 6. AMOUNT
  {
    accessorKey: "amount",
    header: ({ column }) => (
      <div className="text-right">
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Amount
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      </div>
    ),
    cell: ({ row }) => {
      const amount = parseFloat(row.getValue("amount"));
      const formatted = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(Math.abs(amount));
      return (
        <div className={`text-right font-medium text-sm ${amount > 0 ? "text-emerald-600" : ""}`}>
          {amount > 0 ? "+" : ""}{formatted}
        </div>
      );
    },
  },
  // 7. NOTES
  {
    accessorKey: "notes",
    header: "Notes",
    cell: ({ row }) => {
      const notes = row.getValue("notes") as string;
      return notes ? (
        <div
          className="max-w-[160px] truncate text-xs text-zinc-600"
          title={notes}
        >
          {notes}
        </div>
      ) : (
        <span className="text-zinc-300 text-xs">—</span>
      );
    },
  },
  // 8. TAGS
  {
    accessorKey: "tags",
    header: "Tags",
    cell: ({ row }) => {
      const tags = row.getValue("tags") as string[] | null;
      if (!tags || tags.length === 0) {
        return <span className="text-zinc-300 text-xs">—</span>;
      }
      return (
        <div className="flex flex-wrap gap-1">
          {tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs">
              {tag}
            </Badge>
          ))}
        </div>
      );
    },
  },
  // 9. TAX DEDUCTIBLE
  {
    accessorKey: "tax_deductible",
    header: "Tax",
    cell: ({ row }) => {
      const taxDeductible = row.getValue("tax_deductible") as boolean | null;
      return taxDeductible ? (
        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 whitespace-nowrap">
          ✓ Deductible
        </span>
      ) : (
        <span className="text-zinc-300 text-xs">—</span>
      );
    },
  },
  // 10. ACTIONS
  {
    id: "actions",
    cell: (context) => <ActionsCell {...context} />,
  },
];
