"use client";

import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import api from "@/lib/api";

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

interface InstitutionComboboxProps {
  value: string;
  onChange: (value: string) => void;
}

export function InstitutionCombobox({ value, onChange }: InstitutionComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [institutions, setInstitutions] = React.useState<string[]>([]);
  const [inputValue, setInputValue] = React.useState("");
  const { activeAccount } = useAccount();

  // Refresh institution list every time the popover opens
  React.useEffect(() => {
    if (!open || !activeAccount) return;
    const fetchFacets = async () => {
      try {
        const res = await api.get(`/facets?account_id=${activeAccount.id}`);
        setInstitutions(res.data.institutions || []);
      } catch (err) {
        console.error("Failed to load institutions", err);
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
          {value || "Select or type institution..."}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full p-0">
        <Command>
          <CommandInput
            placeholder="Search or create institution..."
            onValueChange={setInputValue}
          />
          <CommandList>
            <CommandEmpty>
              <div
                className="p-2 text-sm cursor-pointer hover:bg-muted"
                onClick={() => {
                  if (inputValue.trim()) {
                    onChange(inputValue.trim());
                    setOpen(false);
                  }
                }}
              >
                {inputValue.trim() ? `Create: "${inputValue.trim()}"` : "Type to create a new institution"}
              </div>
            </CommandEmpty>
            <CommandGroup>
              {institutions.map((inst) => (
                <CommandItem
                  key={inst}
                  value={inst}
                  onSelect={(currentValue) => {
                    onChange(currentValue === value ? "" : currentValue);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === inst ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {inst}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
