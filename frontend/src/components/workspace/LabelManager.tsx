import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createLabel, deleteLabel, updateLabel } from "@/lib/api";
import { useAnnotationStore, type LabelOption } from "@/store/annotation";
import { useProjectStore } from "@/store/project";
import { cn } from "@/lib/utils";

const DEFAULT_COLORS = [
  "#38bdf8",
  "#f87171",
  "#4ade80",
  "#facc15",
  "#c084fc",
  "#fb923c",
  "#2dd4bf",
  "#f472b6",
];

export function LabelManager() {
  const projectId = useProjectStore((s) => s.activeProjectId);
  const labels = useAnnotationStore((s) => s.labels);
  const setLabels = useAnnotationStore((s) => s.setLabels);
  const activeLabelId = useAnnotationStore((s) => s.activeLabelId);
  const activeLabel = labels.find((label) => label.id === activeLabelId);
  const setActiveLabel = useAnnotationStore((s) => s.setActiveLabel);
  const setTool = useAnnotationStore((s) => s.setTool);
  const setToolForImage = useAnnotationStore((s) => s.setToolForImage);
  const activeImageId = useAnnotationStore((s) => s.activeImageId);
  const queryClient = useQueryClient();

  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(DEFAULT_COLORS[0]);

  const createMutation = useMutation({
    mutationFn: () =>
      createLabel(projectId!, {
        name: newName.trim(),
        path: newName.trim().toLowerCase().replace(/\s+/g, "_"),
        color: newColor,
      }),
    onSuccess: (created) => {
      setLabels([
        ...labels,
        {
          id: created.id,
          name: created.name,
          color: created.color ?? newColor,
        },
      ]);
      setActiveLabel(created.id);
      setNewName("");
      setNewColor(DEFAULT_COLORS[(labels.length + 1) % DEFAULT_COLORS.length]);
      queryClient.invalidateQueries({ queryKey: ["labels", projectId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (labelId: string) => deleteLabel(projectId!, labelId),
    onSuccess: (_data, labelId) => {
      setLabels(labels.filter((l) => l.id !== labelId));
      queryClient.invalidateQueries({ queryKey: ["labels", projectId] });
    },
  });

  const updateColorMutation = useMutation({
    mutationFn: ({ labelId, color }: { labelId: string; color: string }) =>
      updateLabel(projectId!, labelId, { color }),
    onSuccess: (updated) => {
      setLabels(
        labels.map((l) =>
          l.id === updated.id ? { ...l, color: updated.color ?? l.color } : l,
        ),
      );
      queryClient.invalidateQueries({ queryKey: ["labels", projectId] });
    },
  });

  const handleCreate = () => {
    if (!newName.trim() || !projectId) return;
    createMutation.mutate();
  };

  const handleActivateLabel = (label: LabelOption) => {
    setActiveLabel(label.id);
    if (activeImageId) {
      setToolForImage(activeImageId, "box");
    } else {
      setTool("box");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">Labels</div>
        {activeLabel && (
          <div className="text-xs text-muted-foreground">
            Active: {activeLabel.name}
          </div>
        )}
      </div>

      {labels.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No labels yet. Add one below.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {labels.map((label) => {
          const isActive = activeLabelId === label.id;
          return (
            <div
              key={label.id}
              className={cn(
                "flex items-center gap-2 rounded-full border px-2 py-1 text-xs",
                isActive
                  ? "border-accent bg-accent/20 text-accent-foreground"
                  : "border-border bg-muted/50 text-muted-foreground",
              )}
              onClick={() => handleActivateLabel(label)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  handleActivateLabel(label);
                }
              }}
            >
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: label.color }}
              />
              <span className="max-w-[140px] truncate">{label.name}</span>
              <label
                className="relative h-4 w-4 cursor-pointer"
                onClick={(event) => event.stopPropagation()}
              >
                <span className="inline-block h-3 w-3 rounded-full border border-border" />
                <input
                  type="color"
                  value={label.color || "#38bdf8"}
                  onChange={(e) =>
                    updateColorMutation.mutate({
                      labelId: label.id,
                      color: e.target.value,
                    })
                  }
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                />
              </label>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                disabled={deleteMutation.isPending}
                onClick={(event) => {
                  event.stopPropagation();
                  deleteMutation.mutate(label.id);
                }}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <input
          type="color"
          value={newColor}
          onChange={(e) => setNewColor(e.target.value)}
          className="h-8 w-8 cursor-pointer rounded border border-border bg-transparent p-0.5"
        />
        <Input
          placeholder="Label name…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleCreate();
          }}
          className="h-8 flex-1 text-sm"
        />
        <Button
          variant="secondary"
          size="icon"
          className="h-8 w-8"
          disabled={!newName.trim() || createMutation.isPending || !projectId}
          onClick={handleCreate}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
