import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createLabel, deleteLabel, fetchLabels, updateLabel } from "@/lib/api";
import { useProjectStore } from "@/store/project";

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

type LabelDraft = { name: string; color: string };

type DraftState = Record<string, LabelDraft>;

export function LabelSettings() {
  const projectId = useProjectStore((s) => s.activeProjectId);
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<DraftState>({});
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(DEFAULT_COLORS[0]);

  const { data: labels = [] } = useQuery({
    queryKey: ["labels", projectId],
    queryFn: () => fetchLabels(projectId!),
    enabled: Boolean(projectId),
  });

  useEffect(() => {
    const next: DraftState = {};
    for (const label of labels) {
      next[label.id] = {
        name: label.name,
        color: label.color ?? "#38bdf8",
      };
    }
    setDrafts(next);
  }, [labels]);

  const createMutation = useMutation({
    mutationFn: () =>
      createLabel(projectId!, {
        name: newName.trim(),
        path: newName.trim().toLowerCase().replace(/\s+/g, "_"),
        color: newColor,
      }),
    onSuccess: () => {
      setNewName("");
      setNewColor(DEFAULT_COLORS[(labels.length + 1) % DEFAULT_COLORS.length]);
      queryClient.invalidateQueries({ queryKey: ["labels", projectId] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ labelId, data }: { labelId: string; data: LabelDraft }) =>
      updateLabel(projectId!, labelId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["labels", projectId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (labelId: string) => deleteLabel(projectId!, labelId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["labels", projectId] });
    },
  });

  const hasChanges = useMemo(() => {
    return labels.some((label) => {
      const draft = drafts[label.id];
      if (!draft) return false;
      const color = label.color ?? "#38bdf8";
      return draft.name.trim() !== label.name || draft.color !== color;
    });
  }, [drafts, labels]);

  if (!projectId) {
    return (
      <div className="rounded-lg border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
        Select a project to manage labels.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Labels</h2>
          <p className="text-xs text-muted-foreground">
            Create labels and adjust colors for annotations.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          disabled={!hasChanges || updateMutation.isPending}
          onClick={() => {
            labels.forEach((label) => {
              const draft = drafts[label.id];
              if (!draft) return;
              const color = label.color ?? "#38bdf8";
              if (draft.name.trim() !== label.name || draft.color !== color) {
                updateMutation.mutate({
                  labelId: label.id,
                  data: { name: draft.name.trim(), color: draft.color },
                });
              }
            });
          }}
        >
          Save Changes
        </Button>
      </div>

      <div className="space-y-2">
        {labels.map((label) => {
          const draft = drafts[label.id] ?? {
            name: label.name,
            color: label.color ?? "#38bdf8",
          };
          return (
            <div
              key={label.id}
              className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-muted/30 px-3 py-2"
            >
              <input
                type="color"
                value={draft.color}
                onChange={(e) =>
                  setDrafts((prev) => ({
                    ...prev,
                    [label.id]: { ...draft, color: e.target.value },
                  }))
                }
                className="h-8 w-8 cursor-pointer rounded border border-border bg-transparent p-0.5"
              />
              <Input
                value={draft.name}
                onChange={(e) =>
                  setDrafts((prev) => ({
                    ...prev,
                    [label.id]: { ...draft, name: e.target.value },
                  }))
                }
                className="h-9 w-56"
              />
              <Button
                variant="ghost"
                size="icon"
                className="text-destructive"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(label.id)}
                title="Delete label"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          );
        })}
        {labels.length === 0 && (
          <div className="text-sm text-muted-foreground">No labels yet.</div>
        )}
      </div>

      <div className="flex items-end gap-3">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">
            New label name
          </label>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Label name"
            className="h-9 w-56"
            onKeyDown={(e) => {
              if (e.key === "Enter" && newName.trim()) {
                createMutation.mutate();
              }
            }}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">
            Color
          </label>
          <input
            type="color"
            value={newColor}
            onChange={(e) => setNewColor(e.target.value)}
            className="h-9 w-12 cursor-pointer rounded border border-border bg-transparent p-0.5"
          />
        </div>
        <Button
          className="gap-1"
          disabled={!newName.trim() || createMutation.isPending}
          onClick={() => createMutation.mutate()}
        >
          <Plus className="h-4 w-4" /> Create
        </Button>
      </div>
    </div>
  );
}
