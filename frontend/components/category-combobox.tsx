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

interface CategoryComboboxProps {
  value: string;
  onChange: (value: string) => void;
}

export function CategoryCombobox({ value, onChange }: CategoryComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [categories, setCategories] = React.useState<string[]>([]);
  const [inputValue, setInputValue] = React.useState("");
  const { activeAccount } = useAccount();

  // Refresh category list every time the popover opens
  React.useEffect(() => {
    if (!open || !activeAccount) return;
    const fetchFacets = async () => {
      try {
        const res = await axios.get(`http://localhost:8001/facets?account_id=${activeAccount.id}`);
        setCategories(res.data.categories || []);
      } catch (err) {
        console.error("Failed to load categories", err);
      }
    };
    fetchFacets();
  }, [open, activeAccount]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
        >
          {value || "Select or type category..."}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full p-0">
        <Command>
          <CommandInput
            placeholder="Search or create category..."
            onValueChange={setInputValue}
          />
          <CommandList>
            <CommandEmpty>
              <div
                className="p-2 text-sm cursor-pointer hover:bg-zinc-100"
                onClick={() => {
                  if (inputValue.trim()) {
                    onChange(inputValue.trim());
                    setOpen(false);
                  }
                }}
              >
                {inputValue.trim() ? `Create: "${inputValue.trim()}"` : "Type to create a new category"}
              </div>
            </CommandEmpty>
            <CommandGroup>
              {categories.map((cat) => (
                <CommandItem
                  key={cat}
                  value={cat}
                  onSelect={(currentValue) => {
                    onChange(currentValue === value ? "" : currentValue);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === cat ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {cat}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
