import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Box,
  Pencil,
  Trash2,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  fetchTrainedModels,
  updateModel,
  deleteModel,
  type TrainedModel,
} from "@/lib/api";
import { useProjectStore } from "@/store/project";
import { useAuthStore } from "@/store/auth";

export function ModelsPage() {
  const projectId = useProjectStore((s) => s.activeProjectId);
  const isAdmin = useAuthStore((s) => s.user?.role) === "ADMIN";
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const { data: models = [], isLoading } = useQuery({
    queryKey: ["models", projectId],
    queryFn: () => fetchTrainedModels(projectId!),
    enabled: Boolean(projectId),
  });

  const updateMut = useMutation({
    mutationFn: ({
      jobId,
      data,
    }: {
      jobId: string;
      data: { display_name?: string; notes?: string };
    }) => updateModel(projectId!, jobId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["models", projectId] });
      setEditingId(null);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (jobId: string) => deleteModel(projectId!, jobId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["models", projectId] }),
  });

  const startEdit = (m: TrainedModel) => {
    setEditingId(m.job_id);
    setEditName(m.display_name ?? "");
    setEditNotes(m.notes ?? "");
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  };

  if (!projectId) {
    return (
      <div className="p-6 text-muted-foreground text-sm">
        Select a project to view models.
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Box className="h-6 w-6" />
          Models
        </h1>
        <p className="text-sm text-muted-foreground">
          Trained model registry. Each training run produces a unique artifact.
        </p>
      </div>

      {isLoading && (
        <div className="text-sm text-muted-foreground">Loading models…</div>
      )}

      {models.length === 0 && !isLoading && (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No trained models yet. Complete a training job to see models here.
        </div>
      )}

      <div className="space-y-3">
        {models.map((m) => {
          const isExpanded = expandedId === m.job_id;
          const isEditing = editingId === m.job_id;
          const metricsDisplay = Object.entries(m.metrics)
            .filter(([, v]) => typeof v === "number")
            .slice(0, 4);

          return (
            <div
              key={m.job_id}
              className="rounded-xl border border-border bg-card overflow-hidden"
            >
              {/* Header */}
              <div
                className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() => setExpandedId(isExpanded ? null : m.job_id)}
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                  <Box className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">
                    {m.display_name || m.model_arch || "Untitled Model"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {m.created_at
                      ? new Date(m.created_at).toLocaleDateString()
                      : "—"}{" "}
                    · {m.model_arch}
                  </div>
                </div>

                {/* Quick metrics */}
                <div className="hidden md:flex items-center gap-3">
                  {metricsDisplay.map(([key, val]) => (
                    <div key={key} className="text-center">
                      <div className="text-[10px] text-muted-foreground uppercase">
                        {key.replace(/_/g, " ")}
                      </div>
                      <div className="text-xs font-mono font-semibold tabular-nums">
                        {typeof val === "number" ? val.toFixed(4) : String(val)}
                      </div>
                    </div>
                  ))}
                </div>

                {isExpanded ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </div>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="border-t border-border px-4 py-3 space-y-3">
                  {/* Artifact path with copy */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      Artifact:
                    </span>
                    <code className="flex-1 truncate text-xs font-mono bg-muted rounded px-2 py-0.5">
                      {m.artifact_path}
                    </code>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCopy(m.artifact_path, m.job_id);
                      }}
                    >
                      {copied === m.job_id ? (
                        <Check className="h-3 w-3 text-emerald-400" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                    </Button>
                  </div>

                  {/* Notes display */}
                  {m.notes && !isEditing && (
                    <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                      {m.notes}
                    </p>
                  )}

                  {/* Metrics panel (match Jobs page) */}
                  {m.metrics && Object.keys(m.metrics).length > 0 && (
                    <div className="rounded border border-border bg-muted/40 p-3">
                      <h4 className="mb-2 text-xs font-semibold text-muted-foreground">
                        Training Metrics
                      </h4>
                      <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
                        {[
                          {
                            key: "mAP50",
                            label: "mAP@50",
                            fmt: (v: number) => (v * 100).toFixed(1) + "%",
                          },
                          {
                            key: "mAP50-95",
                            label: "mAP@50-95",
                            fmt: (v: number) => (v * 100).toFixed(1) + "%",
                          },
                          {
                            key: "precision",
                            label: "Precision",
                            fmt: (v: number) => (v * 100).toFixed(1) + "%",
                          },
                          {
                            key: "recall",
                            label: "Recall",
                            fmt: (v: number) => (v * 100).toFixed(1) + "%",
                          },
                          {
                            key: "box_loss",
                            label: "Box Loss",
                            fmt: (v: number) => v.toFixed(4),
                          },
                          {
                            key: "cls_loss",
                            label: "Cls Loss",
                            fmt: (v: number) => v.toFixed(4),
                          },
                        ].map((metric) => {
                          const val = m.metrics?.[metric.key];
                          if (val === undefined) return null;
                          return (
                            <div key={metric.key} className="text-center">
                              <div className="text-lg font-semibold">
                                {metric.fmt(val as number)}
                              </div>
                              <div className="text-[10px] text-muted-foreground">
                                {metric.label}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Edit form */}
                  {isEditing && (
                    <div className="space-y-2 rounded-lg border border-border bg-background p-3">
                      <input
                        className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        placeholder="Display name"
                      />
                      <textarea
                        className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring min-h-[48px]"
                        value={editNotes}
                        onChange={(e) => setEditNotes(e.target.value)}
                        placeholder="Notes (training context, purpose, etc.)"
                      />
                      <div className="flex gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            updateMut.mutate({
                              jobId: m.job_id,
                              data: {
                                display_name: editName,
                                notes: editNotes,
                              },
                            })
                          }
                          disabled={updateMut.isPending}
                        >
                          Save
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  {isAdmin && !isEditing && (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1 text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          startEdit(m);
                        }}
                      >
                        <Pencil className="h-3 w-3" /> Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1 text-xs text-destructive hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (
                            confirm("Remove this model artifact reference?")
                          ) {
                            deleteMut.mutate(m.job_id);
                          }
                        }}
                      >
                        <Trash2 className="h-3 w-3" /> Remove
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
