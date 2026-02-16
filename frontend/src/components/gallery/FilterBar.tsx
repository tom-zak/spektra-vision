import { useMemo, useState } from "react";
import { Filter, Tag as TagIcon, Layers, Eye } from "lucide-react";

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

import type { Label, Tag } from "@/lib/api";

const statusOptions = ["NEW", "IN_PROGRESS", "DONE"] as const;

const sourceOptions = [
  { value: "ai", label: "AI only" },
  { value: "manual", label: "Manual only" },
  { value: "both", label: "Both" },
  { value: "none", label: "Unannotated" },
] as const;

type AnnotationSource = "ai" | "manual" | "both" | "none" | null;

type FilterBarProps = {
  status: "NEW" | "IN_PROGRESS" | "DONE" | null;
  onStatusChange: (status: "NEW" | "IN_PROGRESS" | "DONE" | null) => void;
  tagId: string | null;
  onTagIdChange: (tagId: string | null) => void;
  tags: Tag[];
  labelId: string | null;
  onLabelIdChange: (labelId: string | null) => void;
  labels: Label[];
  annotationSource: AnnotationSource;
  onAnnotationSourceChange: (source: AnnotationSource) => void;
};

export function FilterBar({
  status,
  onStatusChange,
  tagId,
  onTagIdChange,
  tags,
  labelId,
  onLabelIdChange,
  labels,
  annotationSource,
  onAnnotationSourceChange,
}: FilterBarProps) {
  const [query, setQuery] = useState("");
  const [tagQuery, setTagQuery] = useState("");
  const [labelQuery, setLabelQuery] = useState("");

  const filtered = useMemo(() => {
    if (!query) {
      return statusOptions;
    }
    return statusOptions.filter((item) =>
      item.toLowerCase().includes(query.toLowerCase()),
    );
  }, [query]);

  const filteredTags = useMemo(() => {
    if (!tagQuery) return tags;
    return tags.filter((t) =>
      t.name.toLowerCase().includes(tagQuery.toLowerCase()),
    );
  }, [tags, tagQuery]);

  const filteredLabels = useMemo(() => {
    if (!labelQuery) return labels;
    return labels.filter((l) =>
      l.name.toLowerCase().includes(labelQuery.toLowerCase()),
    );
  }, [labels, labelQuery]);

  const selectedTag = tags.find((t) => t.id === tagId);
  const selectedLabel = labels.find((l) => l.id === labelId);
  const selectedSource = sourceOptions.find(
    (s) => s.value === annotationSource,
  );

  return (
    <div className="flex items-center gap-2">
      {/* Status */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="secondary" size="sm" className="gap-1.5">
            <Filter className="h-3.5 w-3.5" />
            {status ?? "Status"}
          </Button>
        </PopoverTrigger>
        <PopoverContent>
          <Command>
            <CommandInput
              placeholder="Search status"
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              {filtered.map((item) => (
                <CommandItem
                  key={item}
                  onSelect={() =>
                    onStatusChange(item as "NEW" | "IN_PROGRESS" | "DONE")
                  }
                >
                  {item}
                </CommandItem>
              ))}
              <CommandItem onSelect={() => onStatusChange(null)}>
                Clear filter
              </CommandItem>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Tag */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="secondary" size="sm" className="gap-1.5">
            <TagIcon className="h-3.5 w-3.5" />
            {selectedTag ? (
              <span className="flex items-center gap-1">
                {selectedTag.color && (
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: selectedTag.color }}
                  />
                )}
                {selectedTag.name}
              </span>
            ) : (
              "Tag"
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent>
          <Command>
            <CommandInput
              placeholder="Search tags"
              value={tagQuery}
              onValueChange={setTagQuery}
            />
            <CommandList>
              {filteredTags.map((t) => (
                <CommandItem key={t.id} onSelect={() => onTagIdChange(t.id)}>
                  <span className="flex items-center gap-2">
                    {t.color && (
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: t.color }}
                      />
                    )}
                    {t.name}
                  </span>
                </CommandItem>
              ))}
              {tags.length === 0 && (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  No tags yet
                </div>
              )}
              <CommandItem onSelect={() => onTagIdChange(null)}>
                Clear filter
              </CommandItem>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Label */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="secondary" size="sm" className="gap-1.5">
            <Layers className="h-3.5 w-3.5" />
            {selectedLabel ? (
              <span className="flex items-center gap-1">
                {selectedLabel.color && (
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: selectedLabel.color }}
                  />
                )}
                {selectedLabel.name}
              </span>
            ) : (
              "Label"
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent>
          <Command>
            <CommandInput
              placeholder="Search labels"
              value={labelQuery}
              onValueChange={setLabelQuery}
            />
            <CommandList>
              {filteredLabels.map((l) => (
                <CommandItem key={l.id} onSelect={() => onLabelIdChange(l.id)}>
                  <span className="flex items-center gap-2">
                    {l.color && (
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: l.color }}
                      />
                    )}
                    {l.name}
                  </span>
                </CommandItem>
              ))}
              {labels.length === 0 && (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  No labels yet
                </div>
              )}
              <CommandItem onSelect={() => onLabelIdChange(null)}>
                Clear filter
              </CommandItem>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Annotation Source */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="secondary" size="sm" className="gap-1.5">
            <Eye className="h-3.5 w-3.5" />
            {selectedSource?.label ?? "Source"}
          </Button>
        </PopoverTrigger>
        <PopoverContent>
          <Command>
            <CommandList>
              {sourceOptions.map((opt) => (
                <CommandItem
                  key={opt.value}
                  onSelect={() => onAnnotationSourceChange(opt.value)}
                >
                  {opt.label}
                </CommandItem>
              ))}
              <CommandItem onSelect={() => onAnnotationSourceChange(null)}>
                All (clear)
              </CommandItem>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          onStatusChange(null);
          onTagIdChange(null);
          onLabelIdChange(null);
          onAnnotationSourceChange(null);
        }}
      >
        Reset
      </Button>
    </div>
  );
}
