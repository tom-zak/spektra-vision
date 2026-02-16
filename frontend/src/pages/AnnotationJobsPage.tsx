import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  ClipboardList,
  Plus,
  ChevronRight,
  User as UserIcon,
  Images,
  Trash2,
  PenTool,
  LayoutGrid,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  fetchAnnotationJobs,
  createAnnotationJob,
  updateAnnotationJob,
  deleteAnnotationJob,
  fetchImages,
  fetchProjectStats,
  fetchUsers,
  type AnnotationJob,
  type AuthUser,
} from "@/lib/api";
import { useProjectStore } from "@/store/project";
import { useAuthStore } from "@/store/auth";

const STATUSES = ["PENDING", "IN_PROGRESS", "DONE", "REVIEW"] as const;
const STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending",
  IN_PROGRESS: "In Progress",
  DONE: "Done",
  REVIEW: "Review",
};
const STATUS_COLORS: Record<string, string> = {
  PENDING: "border-l-amber-500",
  IN_PROGRESS: "border-l-sky-500",
  DONE: "border-l-emerald-500",
  REVIEW: "border-l-violet-500",
};
const STATUS_DOT: Record<string, string> = {
  PENDING: "bg-amber-500",
  IN_PROGRESS: "bg-sky-500",
  DONE: "bg-emerald-500",
  REVIEW: "bg-violet-500",
};

function nextStatus(current: string): string | null {
  const flow: Record<string, string> = {
    PENDING: "IN_PROGRESS",
    IN_PROGRESS: "DONE",
    DONE: "REVIEW",
  };
  return flow[current] ?? null;
}

function prevStatus(current: string): string | null {
  const flow: Record<string, string> = {
    IN_PROGRESS: "PENDING",
    DONE: "IN_PROGRESS",
    REVIEW: "DONE",
  };
  return flow[current] ?? null;
}

export function AnnotationJobsPage() {
  const projectId = useProjectStore((s) => s.activeProjectId);
  const authUser = useAuthStore((s) => s.user);
  const isAdmin = authUser?.role === "ADMIN";
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: jobs = [] } = useQuery({
    queryKey: ["annotation-jobs", projectId],
    queryFn: () => fetchAnnotationJobs(projectId!),
    enabled: Boolean(projectId),
  });

  const { data: users = [] } = useQuery({
    queryKey: ["users"],
    queryFn: fetchUsers,
    enabled: isAdmin,
  });

  const grouped = useMemo(() => {
    const map: Record<string, AnnotationJob[]> = {
      PENDING: [],
      IN_PROGRESS: [],
      DONE: [],
      REVIEW: [],
    };
    for (const job of jobs) {
      (map[job.status] ??= []).push(job);
    }
    return map;
  }, [jobs]);

  const transitionMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      updateAnnotationJob(id, { status }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["annotation-jobs", projectId],
      }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteAnnotationJob(id),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["annotation-jobs", projectId],
      }),
  });

  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <ClipboardList className="h-6 w-6" />
            Labeling Jobs
          </h1>
          <p className="text-sm text-muted-foreground">
            Assign images to annotators and track progress.
          </p>
        </div>
        {isAdmin && (
          <Button onClick={() => setShowCreate(true)} className="gap-1">
            <Plus className="h-4 w-4" /> Create Job
          </Button>
        )}
      </div>

      {/* Kanban columns */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {STATUSES.map((status) => (
          <div key={status} className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <span
                className={`inline-block h-2.5 w-2.5 rounded-full ${STATUS_DOT[status]}`}
              />
              {STATUS_LABELS[status]}
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                {grouped[status].length}
              </span>
            </div>
            <div className="space-y-2">
              {grouped[status].map((job) => {
                const isExpanded = expandedId === job.id;
                const pct =
                  job.total_images > 0
                    ? Math.round(
                        (job.completed_images / job.total_images) * 100,
                      )
                    : 0;
                const next = nextStatus(job.status);
                const prev = prevStatus(job.status);
                return (
                  <div
                    key={job.id}
                    className={`rounded-lg border border-border bg-card p-3 border-l-4 ${STATUS_COLORS[job.status]} transition-shadow hover:shadow-md`}
                  >
                    <div
                      className="flex items-center justify-between cursor-pointer"
                      onClick={() => setExpandedId(isExpanded ? null : job.id)}
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">
                          {job.batch_name || `Job ${job.id.slice(0, 8)}`}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                          <UserIcon className="h-3 w-3" />
                          {job.assignee_email ?? "Unassigned"}
                        </div>
                      </div>
                      <ChevronRight
                        className={`h-4 w-4 text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`}
                      />
                    </div>

                    {/* Progress bar */}
                    <div className="mt-2 flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-emerald-500 transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-muted-foreground tabular-nums flex items-center gap-1">
                        <Images className="h-3 w-3" />
                        {job.completed_images}/{job.total_images}
                      </span>
                    </div>

                    {isExpanded && (
                      <div className="mt-3 pt-3 border-t border-border space-y-2">
                        {job.instructions && (
                          <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                            {job.instructions}
                          </p>
                        )}
                        <div className="flex flex-wrap gap-1.5">
                          {Object.entries(job.image_ids).map(
                            ([imgId, imgStatus]) => (
                              <span
                                key={imgId}
                                className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-mono ${
                                  imgStatus === "done"
                                    ? "bg-emerald-500/20 text-emerald-400"
                                    : imgStatus === "in_progress"
                                      ? "bg-sky-500/20 text-sky-400"
                                      : imgStatus === "review"
                                        ? "bg-violet-500/20 text-violet-400"
                                        : "bg-muted text-muted-foreground"
                                }`}
                              >
                                {imgId.slice(0, 6)} — {imgStatus}
                              </span>
                            ),
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 pt-1">
                          {/* Launch buttons */}
                          <Button
                            variant="secondary"
                            size="sm"
                            className="text-xs h-7 gap-1"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/workspace?annotation_job=${job.id}`);
                            }}
                          >
                            <PenTool className="h-3 w-3" /> Workspace
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            className="text-xs h-7 gap-1"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/gallery?annotation_job=${job.id}`);
                            }}
                          >
                            <LayoutGrid className="h-3 w-3" /> Gallery
                          </Button>
                          <div className="flex-1" />
                          {prev && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-xs h-7"
                              disabled={transitionMut.isPending}
                              onClick={(e) => {
                                e.stopPropagation();
                                transitionMut.mutate({
                                  id: job.id,
                                  status: prev,
                                });
                              }}
                            >
                              ← {STATUS_LABELS[prev]}
                            </Button>
                          )}
                          {next && (
                            <Button
                              variant="secondary"
                              size="sm"
                              className="text-xs h-7"
                              disabled={transitionMut.isPending}
                              onClick={(e) => {
                                e.stopPropagation();
                                transitionMut.mutate({
                                  id: job.id,
                                  status: next,
                                });
                              }}
                            >
                              {STATUS_LABELS[next]} →
                            </Button>
                          )}
                          {isAdmin && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive"
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteMut.mutate(job.id);
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {grouped[status].length === 0 && (
                <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                  No jobs
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Create Modal */}
      {showCreate && (
        <CreateJobModal
          projectId={projectId!}
          jobs={jobs}
          users={users}
          onClose={() => setShowCreate(false)}
        />
      )}
    </section>
  );
}

function CreateJobModal({
  projectId,
  jobs,
  users,
  onClose,
}: {
  projectId: string;
  jobs: AnnotationJob[];
  users: AuthUser[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [batchName, setBatchName] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [instructions, setInstructions] = useState("");
  const [mode, setMode] = useState<"select" | "count">("count");
  const [imageCount, setImageCount] = useState(10);
  const [selectedImageIds, setSelectedImageIds] = useState<string[]>([]);

  const { data: stats } = useQuery({
    queryKey: ["project-stats", projectId],
    queryFn: () => fetchProjectStats(projectId),
    enabled: Boolean(projectId),
  });

  const { data: imageData } = useQuery({
    queryKey: ["images", projectId, "all"],
    queryFn: async () => {
      const items = [] as Awaited<ReturnType<typeof fetchImages>>["items"];
      let cursor:
        | { after_created_at?: string | null; after_id?: string | null }
        | undefined;
      let hasNext = true;
      while (hasNext) {
        const page = await fetchImages(projectId, {
          limit: 200,
          after_created_at: cursor?.after_created_at ?? undefined,
          after_id: cursor?.after_id ?? undefined,
        });
        items.push(...page.items);
        if (page.next_after_created_at && page.next_after_id) {
          cursor = {
            after_created_at: page.next_after_created_at,
            after_id: page.next_after_id,
          };
        } else {
          hasNext = false;
        }
      }
      return { items, next_after_created_at: null, next_after_id: null };
    },
    enabled: Boolean(projectId) && mode === "select",
  });
  const images = imageData?.items ?? [];

  const assignedImageIds = useMemo(() => {
    const set = new Set<string>();
    for (const job of jobs) {
      if (job.status === "DONE") continue;
      Object.keys(job.image_ids).forEach((id) => set.add(id));
    }
    return set;
  }, [jobs]);

  const totalImages = stats?.total_images;
  const availableCount =
    totalImages === undefined
      ? null
      : Math.max(0, totalImages - assignedImageIds.size);

  const availableImages = useMemo(
    () => images.filter((img) => !assignedImageIds.has(img.id)),
    [assignedImageIds, images],
  );

  useEffect(() => {
    if (availableCount === null || availableCount === 0) return;
    setImageCount((prev) => Math.min(prev, availableCount));
  }, [availableCount]);

  useEffect(() => {
    setSelectedImageIds((prev) =>
      prev.filter((id) => availableImages.some((img) => img.id === id)),
    );
  }, [availableImages]);

  const createMut = useMutation({
    mutationFn: () =>
      createAnnotationJob({
        project_id: projectId,
        assigned_to: assignedTo || null,
        batch_name: batchName || null,
        instructions: instructions || null,
        ...(mode === "count"
          ? { image_count: imageCount }
          : { image_ids: selectedImageIds }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["annotation-jobs", projectId],
      });
      onClose();
    },
  });

  const toggleImage = (id: string) =>
    setSelectedImageIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  const selectAll = () => setSelectedImageIds(availableImages.map((i) => i.id));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-2xl space-y-4 max-h-[80vh] overflow-y-auto">
        <h2 className="text-lg font-semibold">Create Annotation Job</h2>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">
              Batch Name
            </label>
            <input
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
              value={batchName}
              onChange={(e) => setBatchName(e.target.value)}
              placeholder="e.g. Batch 1 — pedestrians"
            />
          </div>

          <div>
            <label className="block text-xs text-muted-foreground mb-1">
              Assign To
            </label>
            <select
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none"
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
            >
              <option value="">Unassigned</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.email} ({u.role})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-muted-foreground mb-1">
              Instructions
            </label>
            <textarea
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring min-h-[60px]"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Annotation guidelines for the assignee..."
            />
          </div>

          <div>
            <div className="flex items-center gap-2 mb-2">
              <label className="text-xs text-muted-foreground">
                Image Selection
              </label>
              <div className="ml-auto flex rounded-md border border-border text-xs overflow-hidden">
                <button
                  className={`px-3 py-1 transition-colors ${mode === "count" ? "bg-accent text-accent-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
                  onClick={() => setMode("count")}
                >
                  By Count
                </button>
                <button
                  className={`px-3 py-1 transition-colors ${mode === "select" ? "bg-accent text-accent-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
                  onClick={() => setMode("select")}
                >
                  Pick Images
                </button>
              </div>
            </div>

            {mode === "count" ? (
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={1}
                  max={availableCount ?? 1}
                  className="w-24 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                  value={imageCount}
                  onChange={(e) =>
                    setImageCount(Math.max(1, Number(e.target.value)))
                  }
                  disabled={availableCount === null || availableCount === 0}
                />
                <span className="text-xs text-muted-foreground">
                  {availableCount === null
                    ? "Loading available images..."
                    : `random unassigned images (of ${availableCount} available)`}
                </span>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-muted-foreground">
                    {selectedImageIds.length} selected
                  </span>
                  <button
                    className="text-xs text-sky-400 hover:underline"
                    onClick={selectAll}
                  >
                    Select all ({availableImages.length})
                  </button>
                </div>
                <div className="max-h-40 overflow-y-auto rounded-md border border-border bg-background p-2 space-y-1">
                  {availableImages.map((img) => (
                    <label
                      key={img.id}
                      className="flex items-center gap-2 text-xs cursor-pointer hover:bg-muted rounded px-1 py-0.5"
                    >
                      <input
                        type="checkbox"
                        checked={selectedImageIds.includes(img.id)}
                        onChange={() => toggleImage(img.id)}
                        className="accent-sky-500"
                      />
                      <span className="truncate">{img.id.slice(0, 8)}</span>
                      <span className="text-muted-foreground">
                        {img.status}
                      </span>
                    </label>
                  ))}
                  {availableImages.length === 0 && (
                    <span className="text-xs text-muted-foreground">
                      No unassigned images in project
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={
              (mode === "select" && selectedImageIds.length === 0) ||
              (mode === "count" &&
                (availableCount === null ||
                  imageCount < 1 ||
                  availableCount === 0)) ||
              createMut.isPending
            }
            onClick={() => createMut.mutate()}
          >
            {createMut.isPending ? "Creating…" : "Create Job"}
          </Button>
        </div>
        {createMut.isError && (
          <p className="text-xs text-destructive">
            {createMut.error instanceof Error
              ? createMut.error.message
              : "Failed to create job"}
          </p>
        )}
      </div>
    </div>
  );
}
