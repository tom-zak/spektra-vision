import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { LabelOption } from "@/store/annotation";

export function LabelCombobox({
  options,
  value,
  onChange,
}: {
  options: LabelOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [query, setQuery] = useState("");
  const active = options.find((option) => option.id === value);

  const filtered = useMemo(() => {
    if (!query) {
      return options;
    }
    return options.filter((option) =>
      option.name.toLowerCase().includes(query.toLowerCase()),
    );
  }, [options, query]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="secondary" className="w-full justify-between">
          <span>{active?.name ?? "Select label"}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent>
        <Command>
          <CommandInput
            placeholder="Search label"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            {filtered.map((option) => (
              <CommandItem key={option.id} onSelect={() => onChange(option.id)}>
                <span
                  className="mr-2 inline-flex h-2 w-2 rounded-full"
                  style={{ background: option.color }}
                />
                {option.name}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
