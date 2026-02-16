import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Check,
  Wand2,
  Ban,
  ShieldCheck,
  ShieldX,
  ClipboardList,
} from "lucide-react";

import { AnnotationSidebar } from "@/components/workspace/AnnotationSidebar";
import { CanvasStage } from "@/components/workspace/CanvasStage";
import { ActiveLabelPicker } from "@/components/workspace/ActiveLabelPicker";
import { Toolbar } from "@/components/workspace/Toolbar";
import { Button } from "@/components/ui/button";
import {
  Toast,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast";
import {
  fetchAnnotations,
  fetchImages,
  fetchLabels,
  updateAnnotations,
  updateImageStatus,
  predictSingleImage,
  markImageNull,
  reviewImage,
  fetchAnnotationJob,
  updateAnnotationJobImage,
} from "@/lib/api";
import { useAnnotationStore, type ToolMode } from "@/store/annotation";
import { useProjectStore } from "@/store/project";
import { useAuthStore } from "@/store/auth";

export function WorkspacePage() {
  const { imageId } = useParams();
  const [searchParams] = useSearchParams();
  const annotationJobId = searchParams.get("annotation_job");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const projectId = useProjectStore((s) => s.activeProjectId);
  const authUser = useAuthStore((s) => s.user);
  const canReview = authUser?.role === "ADMIN" || authUser?.role === "REVIEWER";
  const setAnnotations = useAnnotationStore((state) => state.setAnnotations);
  const setLabels = useAnnotationStore((state) => state.setLabels);
  const storeAnnotations = useAnnotationStore((state) => state.annotations);
  const deletedIds = useAnnotationStore((state) => state.deletedIds);
  const clearDeleted = useAnnotationStore((state) => state.clearDeleted);
  const setActiveImage = useAnnotationStore((state) => state.setActiveImage);
  const setTool = useAnnotationStore((state) => state.setTool);
  const setToolForImage = useAnnotationStore((state) => state.setToolForImage);
  const toolByImage = useAnnotationStore((state) => state.toolByImage);
  const selectedIds = useAnnotationStore((state) => state.selectedIds);
  const deleteAnnotation = useAnnotationStore(
    (state) => state.deleteAnnotation,
  );
  const deleteAnnotations = useAnnotationStore(
    (state) => state.deleteAnnotations,
  );
  const clearSelection = useAnnotationStore((state) => state.clearSelection);
  const undo = useAnnotationStore((state) => state.undo);
  const redo = useAnnotationStore((state) => state.redo);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [rejectComment, setRejectComment] = useState("");
  const [showRejectInput, setShowRejectInput] = useState(false);
  const deletePendingRef = useRef(false);

  const reviewMut = useMutation({
    mutationFn: ({
      status,
      comment,
    }: {
      status: string;
      comment?: string | null;
    }) => {
      if (!activeImage) return Promise.reject(new Error("No active image"));
      return reviewImage(activeImage.id, status, comment);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["images", projectId] });
      setShowRejectInput(false);
      setRejectComment("");
    },
    onError: (err) =>
      setError(err instanceof Error ? err.message : "Review failed"),
  });

  const { data: imageList } = useQuery({
    queryKey: ["images", projectId, "all"],
    queryFn: async () => {
      const items = [] as Awaited<ReturnType<typeof fetchImages>>["items"];
      let cursor:
        | { after_created_at?: string | null; after_id?: string | null }
        | undefined;
      let hasNext = true;
      while (hasNext) {
        const page = await fetchImages(projectId!, {
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
    enabled: Boolean(projectId),
  });

  // Annotation job scoping — filter images to job's image set
  const { data: annotationJob, isLoading: isAnnotationJobLoading } = useQuery({
    queryKey: ["annotation-job", annotationJobId],
    queryFn: () => fetchAnnotationJob(annotationJobId!),
    enabled: Boolean(annotationJobId),
  });

  const jobImageOrder = useMemo(() => {
    if (!annotationJob) return null;
    return Object.keys(annotationJob.image_ids);
  }, [annotationJob]);

  const allItems = useMemo(() => {
    const items = imageList?.items ?? [];
    if (!annotationJobId) return items;
    if (isAnnotationJobLoading || !annotationJob || !jobImageOrder) return [];
    const byId = new Map(items.map((img) => [img.id, img]));
    return jobImageOrder
      .map((id) => byId.get(id))
      .filter(Boolean) as typeof items;
  }, [
    annotationJobId,
    annotationJob,
    imageList,
    isAnnotationJobLoading,
    jobImageOrder,
  ]);

  const activeImage = useMemo(() => {
    if (allItems.length === 0) return undefined;
    if (imageId)
      return allItems.find((img) => img.id === imageId) ?? allItems[0];
    return allItems[0];
  }, [allItems, imageId]);

  useEffect(() => {
    if (!annotationJobId || !annotationJob || allItems.length === 0) return;
    if (imageId && !allItems.some((img) => img.id === imageId)) {
      navigate(
        `/workspace/${allItems[0].id}?annotation_job=${annotationJobId}`,
        {
          replace: true,
        },
      );
    }
  }, [allItems, annotationJob, annotationJobId, imageId, navigate]);

  const currentIndex = useMemo(
    () =>
      activeImage ? allItems.findIndex((img) => img.id === activeImage.id) : -1,
    [allItems, activeImage],
  );

  const canPrev = currentIndex > 0;
  const canNext = currentIndex >= 0 && currentIndex < allItems.length - 1;

  const goPrev = useCallback(() => {
    const base = annotationJobId
      ? `/workspace/${allItems[currentIndex - 1].id}?annotation_job=${annotationJobId}`
      : `/workspace/${allItems[currentIndex - 1].id}`;
    if (canPrev) navigate(base);
  }, [canPrev, allItems, currentIndex, navigate, annotationJobId]);

  const goNext = useCallback(() => {
    const base = annotationJobId
      ? `/workspace/${allItems[currentIndex + 1].id}?annotation_job=${annotationJobId}`
      : `/workspace/${allItems[currentIndex + 1].id}`;
    if (canNext) navigate(base);
  }, [canNext, allItems, currentIndex, navigate, annotationJobId]);

  const { data: labels } = useQuery({
    queryKey: ["labels", projectId],
    queryFn: () => fetchLabels(projectId!),
    enabled: Boolean(projectId),
  });

  const { data: fetchedAnnotations } = useQuery({
    queryKey: ["annotations", activeImage?.id],
    queryFn: () => fetchAnnotations(activeImage!.id),
    enabled: Boolean(activeImage?.id),
  });

  useEffect(() => {
    if (labels) {
      setLabels(
        labels.map((label) => ({
          id: label.id,
          name: label.name,
          color: label.color ?? "#38bdf8",
        })),
      );
    }
  }, [labels, setLabels]);

  useEffect(() => {
    if (fetchedAnnotations) {
      setAnnotations(
        fetchedAnnotations.map((annotation) => ({
          id: annotation.id,
          labelId: annotation.label_id,
          kind: (annotation.geometry as any).points ? "polygon" : "box",
          x: (annotation.geometry as any).x ?? 0,
          y: (annotation.geometry as any).y ?? 0,
          width:
            (annotation.geometry as any).w ??
            (annotation.geometry as any).width ??
            0,
          height:
            (annotation.geometry as any).h ??
            (annotation.geometry as any).height ??
            0,
          points: (annotation.geometry as any).points ?? undefined,
          isLocal: false,
          confidence: annotation.confidence ?? null,
          isPrediction: annotation.is_prediction ?? false,
        })),
      );
    }
  }, [fetchedAnnotations, setAnnotations]);

  useEffect(() => {
    setActiveImage(activeImage?.id);
    if (activeImage?.id && toolByImage[activeImage.id]) {
      setTool(toolByImage[activeImage.id]);
    }
  }, [activeImage?.id, setActiveImage, setTool, toolByImage]);

  const requestAutoSave = useCallback(() => {
    deletePendingRef.current = true;
  }, []);

  // --- Label Assist (auto-annotate) ---
  const autoAnnotateMut = useMutation({
    mutationFn: (modelPath: string) => {
      if (!activeImage) return Promise.reject(new Error("No active image"));
      return predictSingleImage(projectId!, activeImage.id, modelPath);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["annotations", activeImage?.id],
      });
      queryClient.invalidateQueries({ queryKey: ["jobs", projectId] });
    },
    onError: (err) =>
      setError(err instanceof Error ? err.message : "Auto-annotate failed"),
  });

  // --- Mark Null (background image) ---
  const handleMarkNull = useCallback(async () => {
    if (!activeImage) return;
    try {
      const isCurrentlyNull = activeImage.is_null ?? false;
      await markImageNull(activeImage.id, !isCurrentlyNull);
      queryClient.invalidateQueries({ queryKey: ["images", projectId] });
      if (!isCurrentlyNull && canNext) goNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to mark image");
    }
  }, [activeImage, projectId, canNext, goNext, queryClient]);

  const handleSave = useCallback(async () => {
    if (!activeImage || saving) return;
    setSaving(true);
    try {
      const ops = [
        ...deletedIds.map((id) => ({ action: "delete" as const, id })),
        ...storeAnnotations.map((annotation) => ({
          action: annotation.isLocal
            ? ("create" as const)
            : ("update" as const),
          id: annotation.isLocal ? undefined : annotation.id,
          label_id: annotation.labelId,
          geometry:
            annotation.kind === "polygon"
              ? { points: annotation.points ?? [] }
              : {
                  x: annotation.x,
                  y: annotation.y,
                  w: annotation.width,
                  h: annotation.height,
                },
        })),
      ];
      const next = await updateAnnotations(activeImage.id, ops);
      setAnnotations(
        next.map((annotation) => ({
          id: annotation.id,
          labelId: annotation.label_id,
          kind: (annotation.geometry as any).points ? "polygon" : "box",
          x: (annotation.geometry as any).x ?? 0,
          y: (annotation.geometry as any).y ?? 0,
          width:
            (annotation.geometry as any).w ??
            (annotation.geometry as any).width ??
            0,
          height:
            (annotation.geometry as any).h ??
            (annotation.geometry as any).height ??
            0,
          points: (annotation.geometry as any).points ?? undefined,
          isLocal: false,
          confidence: annotation.confidence ?? null,
          isPrediction: annotation.is_prediction ?? false,
        })),
      );
      clearDeleted();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to save annotations",
      );
    } finally {
      setSaving(false);
    }
  }, [
    activeImage,
    saving,
    deletedIds,
    storeAnnotations,
    setAnnotations,
    clearDeleted,
    setError,
  ]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      // Ignore shortcuts when typing in input/select
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT"
      )
        return;

      // Tool shortcuts
      const toolKeys: Record<string, ToolMode> = {
        v: "select",
        b: "box",
        p: "polygon",
        h: "pan",
      };
      if (toolKeys[event.key] && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        const mode = toolKeys[event.key];
        if (activeImage?.id) {
          setToolForImage(activeImage.id, mode);
        } else {
          setTool(mode);
        }
        return;
      }

      // Ctrl+S / Cmd+S → save
      if ((event.ctrlKey || event.metaKey) && event.key === "s") {
        event.preventDefault();
        handleSave();
        return;
      }

      // Ctrl+Z / Cmd+Z → undo  |  Ctrl+Shift+Z / Cmd+Shift+Z → redo
      if ((event.ctrlKey || event.metaKey) && event.key === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          redo();
        } else {
          undo();
        }
        return;
      }

      // Arrow navigation
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goPrev();
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        goNext();
        return;
      }

      // Delete/Backspace selected annotations
      if (
        (event.key === "Delete" || event.key === "Backspace") &&
        selectedIds.length > 0
      ) {
        event.preventDefault();
        requestAutoSave();
        deleteAnnotations(selectedIds);
        clearSelection();
      }

      // N → mark null
      if (event.key === "n" && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        handleMarkNull();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [
    selectedIds,
    deleteAnnotations,
    clearSelection,
    activeImage?.id,
    setTool,
    setToolForImage,
    goPrev,
    goNext,
    undo,
    redo,
    handleMarkNull,
    handleSave,
    requestAutoSave,
  ]);

  useEffect(() => {
    deletePendingRef.current = false;
  }, [activeImage?.id]);

  useEffect(() => {
    if (!activeImage || !deletePendingRef.current || saving) {
      return;
    }
    deletePendingRef.current = false;
    handleSave();
  }, [activeImage, deletedIds, storeAnnotations, saving, handleSave]);

  const handleDeleteAnnotation = useCallback(
    (id: string) => {
      requestAutoSave();
      deleteAnnotation(id);
    },
    [requestAutoSave, deleteAnnotation],
  );

  const handleMarkDone = async () => {
    if (!activeImage) return;
    try {
      await updateImageStatus(activeImage.id, "DONE");
      // If working inside an annotation job, mark this image done in the job too
      if (annotationJobId) {
        await updateAnnotationJobImage(annotationJobId, activeImage.id, "done");
        queryClient.invalidateQueries({
          queryKey: ["annotation-job", annotationJobId],
        });
      }
      queryClient.invalidateQueries({ queryKey: ["images", projectId] });
      // Auto-advance to next image
      if (canNext) goNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status");
    }
  };

  return (
    <ToastProvider>
      <section className="flex flex-col gap-6">
        {/* Annotation job banner */}
        {annotationJob && (
          <div className="flex items-center gap-2 rounded-lg border border-sky-500/30 bg-sky-500/10 px-4 py-2 text-sm text-sky-300">
            <ClipboardList className="h-4 w-4" />
            <span className="font-semibold">Labeling Job:</span>
            {annotationJob.batch_name || `Job ${annotationJob.id.slice(0, 8)}`}
            <span className="text-sky-400/60">—</span>
            <span className="tabular-nums">
              {annotationJob.completed_images}/{annotationJob.total_images} done
            </span>
            {annotationJob.instructions && (
              <span className="ml-2 text-sky-400/60">
                {annotationJob.instructions}
              </span>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Workspace</h1>
            <p className="text-sm text-muted-foreground">
              Draw and edit annotations on images.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              disabled={!canPrev}
              onClick={goPrev}
              title="Previous image (←)"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <span className="text-xs text-muted-foreground tabular-nums">
              {currentIndex >= 0
                ? `${currentIndex + 1} / ${allItems.length}`
                : "—"}
            </span>
            <Button
              variant="ghost"
              size="icon"
              disabled={!canNext}
              onClick={goNext}
              title="Next image (→)"
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
            {activeImage && activeImage.status !== "DONE" && (
              <Button
                variant="secondary"
                className="gap-1"
                onClick={handleMarkDone}
              >
                <Check className="h-4 w-4" /> Done
              </Button>
            )}
            {activeImage && activeImage.status === "DONE" && (
              <span className="rounded-full bg-green-500/20 px-2 py-0.5 text-xs font-medium text-green-400">
                DONE
              </span>
            )}
            <Button
              variant="secondary"
              onClick={handleSave}
              disabled={!activeImage || saving}
            >
              {saving ? "Saving…" : "Save (Ctrl+S)"}
            </Button>
            <Button
              variant="outline"
              className="gap-1"
              onClick={() => autoAnnotateMut.mutate("latest")}
              disabled={!projectId || !activeImage || autoAnnotateMut.isPending}
              title="Auto-label unannotated images using last trained model"
            >
              <Wand2 className="h-4 w-4" />
              {autoAnnotateMut.isPending ? "Running…" : "Label Assist"}
            </Button>
            {activeImage && (
              <Button
                variant={activeImage.is_null ? "destructive" : "outline"}
                className="gap-1"
                onClick={handleMarkNull}
                title="Mark this image as null / background (N)"
              >
                <Ban className="h-4 w-4" />
                {activeImage.is_null ? "Unmark Null" : "Null (N)"}
              </Button>
            )}

            {/* Review status + buttons */}
            {canReview && activeImage && (
              <>
                <div className="h-5 w-px bg-border" />
                <Button
                  variant="outline"
                  className="gap-1 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
                  onClick={() => reviewMut.mutate({ status: "APPROVED" })}
                  disabled={reviewMut.isPending}
                >
                  <ShieldCheck className="h-4 w-4" /> Approve
                </Button>
                {showRejectInput ? (
                  <div className="flex items-center gap-1">
                    <input
                      className="h-8 w-44 rounded-md border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
                      placeholder="Reason (optional)"
                      value={rejectComment}
                      onChange={(e) => setRejectComment(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          reviewMut.mutate({
                            status: "REJECTED",
                            comment: rejectComment || null,
                          });
                        }
                        if (e.key === "Escape") setShowRejectInput(false);
                      }}
                      autoFocus
                    />
                    <Button
                      variant="destructive"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() =>
                        reviewMut.mutate({
                          status: "REJECTED",
                          comment: rejectComment || null,
                        })
                      }
                      disabled={reviewMut.isPending}
                    >
                      Reject
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    className="gap-1 border-red-500/40 text-red-400 hover:bg-red-500/10"
                    onClick={() => setShowRejectInput(true)}
                    disabled={reviewMut.isPending}
                  >
                    <ShieldX className="h-4 w-4" /> Reject
                  </Button>
                )}
              </>
            )}
            {activeImage &&
              activeImage.review_status &&
              activeImage.review_status !== "UNREVIEWED" && (
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    activeImage.review_status === "APPROVED"
                      ? "bg-emerald-500/20 text-emerald-400"
                      : activeImage.review_status === "REJECTED"
                        ? "bg-red-500/20 text-red-400"
                        : "bg-amber-500/20 text-amber-400"
                  }`}
                >
                  {activeImage.review_status}
                </span>
              )}
          </div>
        </div>

        {/* Rejection banner */}
        {activeImage &&
          activeImage.review_status === "REJECTED" &&
          activeImage.review_comment && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
              <span className="font-semibold">Rejected:</span>{" "}
              {activeImage.review_comment}
            </div>
          )}
        <div className="flex flex-wrap items-center gap-4">
          <Toolbar />
        </div>
        {activeImage ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <ActiveLabelPicker />
                <span className="text-xs text-muted-foreground">
                  V=Select B=Box P=Polygon H=Pan
                </span>
              </div>
              <CanvasStage
                imageUrl={activeImage.url}
                imageWidth={activeImage.width ?? 1200}
                imageHeight={activeImage.height ?? 800}
              />
            </div>
            <AnnotationSidebar
              imageId={activeImage.id}
              projectId={projectId ?? undefined}
              imageTags={activeImage.tags ?? []}
              onDeleteAnnotation={handleDeleteAnnotation}
            />
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
            No images available. Ingest a dataset to start labeling.
          </div>
        )}
      </section>
      <Toast
        open={Boolean(error)}
        onOpenChange={(open: boolean) => !open && setError(null)}
      >
        <ToastTitle>Error</ToastTitle>
        <ToastDescription>{error}</ToastDescription>
      </Toast>
      <ToastViewport />
    </ToastProvider>
  );
}
