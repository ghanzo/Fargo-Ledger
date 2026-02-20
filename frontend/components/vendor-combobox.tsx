"use client";

import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import axios from "axios";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useAccount } from "@/context/account-context";

interface VendorComboboxProps {
  value: string;
  onChange: (value: string) => void;
}

export function VendorCombobox({ value, onChange }: VendorComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [vendors, setVendors] = React.useState<string[]>([]);
  const [inputValue, setInputValue] = React.useState("");
  const { activeAccount } = useAccount();

  // Fetch existing vendors when component loads
  React.useEffect(() => {
    if (!activeAccount) return;
    const fetchFacets = async () => {
      try {
        const res = await axios.get(`http://localhost:8000/facets?account_id=${activeAccount.id}`);
        setVendors(res.data.vendors || []);
      } catch (err) {
        console.error("Failed to load vendors", err);
      }
    };
    fetchFacets();
  }, [activeAccount]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
        >
          {value || "Select or type vendor..."}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full p-0">
        <Command>
          <CommandInput 
            placeholder="Search vendor..." 
            onValueChange={setInputValue} 
          />
          <CommandList>
            <CommandEmpty>
                {/* If no match, allow clicking to "Create" the new vendor */}
                <div 
                    className="p-2 text-sm cursor-pointer hover:bg-zinc-100"
                    onClick={() => {
                        onChange(inputValue);
                        setOpen(false);
                    }}
                >
                    Create new: "{inputValue}"
                </div>
            </CommandEmpty>
            <CommandGroup>
              {vendors.map((vendor) => (
                <CommandItem
                  key={vendor}
                  value={vendor}
                  onSelect={(currentValue) => {
                    onChange(currentValue === value ? "" : currentValue);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === vendor ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {vendor}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}