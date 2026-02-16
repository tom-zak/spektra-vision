import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Upload,
  Loader2,
  Trash2,
  CheckCircle,
  X,
  FileArchive,
  Tag as TagIcon,
  ClipboardList,
} from "lucide-react";

import { FilterBar } from "@/components/gallery/FilterBar";
import { MasonryGrid } from "@/components/gallery/MasonryGrid";
import { Button } from "@/components/ui/button";
import {
  fetchImages,
  fetchLabels,
  uploadImages,
  importYolov4Dataset,
  deleteImage,
  updateImageStatus,
  fetchProjectTags,
  createTag,
  bulkUpdateTags,
  fetchAnnotationJob,
  type ImageListResponse,
  type ImportResult,
  type Label,
  type Tag,
} from "@/lib/api";
import { GalleryItem, useGalleryStore } from "@/store/gallery";
import { useAnnotationStore } from "@/store/annotation";
import { useProjectStore } from "@/store/project";

export function GalleryPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const annotationJobId = searchParams.get("annotation_job");
  const queryClient = useQueryClient();
  const projectId = useProjectStore((s) => s.activeProjectId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"NEW" | "IN_PROGRESS" | "DONE" | null>(
    null,
  );
  const [tagId, setTagId] = useState<string | null>(null);
  const [labelId, setLabelId] = useState<string | null>(null);
  const [annotationSource, setAnnotationSource] = useState<
    "ai" | "manual" | "both" | "none" | null
  >(null);
  const [dragOver, setDragOver] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [showBulkTagDialog, setShowBulkTagDialog] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const selected = useGalleryStore((s) => s.selected);
  const clearSelection = useGalleryStore((s) => s.clearSelection);
  const activeImageId = useAnnotationStore((s) => s.activeImageId);

  // Annotation job scoping
  const { data: annotationJob, isLoading: isAnnotationJobLoading } = useQuery({
    queryKey: ["annotation-job", annotationJobId],
    queryFn: () => fetchAnnotationJob(annotationJobId!),
    enabled: Boolean(annotationJobId),
  });
  const jobImageIds = useMemo(() => {
    if (!annotationJob) return null;
    return new Set(Object.keys(annotationJob.image_ids));
  }, [annotationJob]);
  const jobImageOrder = useMemo(() => {
    if (!annotationJob) return null;
    return Object.keys(annotationJob.image_ids);
  }, [annotationJob]);

  const { data: projectTags = [] } = useQuery({
    queryKey: ["tags", projectId],
    queryFn: () => fetchProjectTags(projectId!),
    enabled: Boolean(projectId),
  });

  const { data: projectLabels = [] } = useQuery<Label[]>({
    queryKey: ["labels", projectId],
    queryFn: () => fetchLabels(projectId!),
    enabled: Boolean(projectId),
  });

  const { data: jobImageData, isLoading: isJobLoading } = useQuery({
    queryKey: ["annotation-job-images", projectId, annotationJobId],
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
    enabled: Boolean(projectId && annotationJobId),
  });

  const [bulkSelectedTagIds, setBulkSelectedTagIds] = useState<Set<string>>(
    new Set(),
  );

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => deleteImage(id)));
    },
    onSuccess: () => {
      clearSelection();
      queryClient.invalidateQueries({ queryKey: ["images", projectId] });
    },
  });

  const bulkStatusMutation = useMutation({
    mutationFn: async ({
      ids,
      status: newStatus,
    }: {
      ids: string[];
      status: "NEW" | "IN_PROGRESS" | "DONE";
    }) => {
      await Promise.all(ids.map((id) => updateImageStatus(id, newStatus)));
    },
    onSuccess: () => {
      clearSelection();
      queryClient.invalidateQueries({ queryKey: ["images", projectId] });
    },
  });

  const bulkTagMutation = useMutation({
    mutationFn: async ({
      ids,
      tagIds,
    }: {
      ids: string[];
      tagIds: string[];
    }) => {
      await bulkUpdateTags(ids, tagIds);
    },
    onSuccess: () => {
      clearSelection();
      setShowBulkTagDialog(false);
      setBulkSelectedTagIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["images", projectId] });
    },
  });

  const createTagMutation = useMutation({
    mutationFn: async (name: string) => {
      return createTag(projectId!, { name });
    },
    onSuccess: () => {
      setNewTagName("");
      queryClient.invalidateQueries({ queryKey: ["tags", projectId] });
    },
  });

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery<ImageListResponse>({
      queryKey: ["images", projectId, status, tagId, labelId, annotationSource],
      queryFn: ({ pageParam }) => {
        const cursor = pageParam as
          | {
              after_created_at?: string | null;
              after_id?: string | null;
            }
          | undefined;
        return fetchImages(projectId!, {
          status: status ?? undefined,
          tag_id: tagId ?? undefined,
          label_id: labelId ?? undefined,
          annotation_source: annotationSource ?? undefined,
          limit: 50,
          after_created_at: cursor?.after_created_at,
          after_id: cursor?.after_id,
        });
      },
      initialPageParam: undefined,
      getNextPageParam: (lastPage) =>
        lastPage.next_after_created_at && lastPage.next_after_id
          ? {
              after_created_at: lastPage.next_after_created_at,
              after_id: lastPage.next_after_id,
            }
          : undefined,
      enabled: Boolean(projectId) && !annotationJobId,
    });

  const uploadMutation = useMutation({
    mutationFn: (files: File[]) => uploadImages(projectId!, files),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["images", projectId] });
    },
  });

  const importMutation = useMutation({
    mutationFn: (zipFile: File) => importYolov4Dataset(projectId!, zipFile),
    onSuccess: (result) => {
      setImportResult(result);
      queryClient.invalidateQueries({ queryKey: ["images", projectId] });
      queryClient.invalidateQueries({ queryKey: ["labels", projectId] });
      queryClient.invalidateQueries({ queryKey: ["health", projectId] });
    },
  });

  const handleImportFile = useCallback(
    (files: FileList | null) => {
      if (!files || !projectId) return;
      const zipFile = files[0];
      if (
        zipFile &&
        (zipFile.name.endsWith(".zip") || zipFile.type === "application/zip")
      ) {
        importMutation.mutate(zipFile);
      }
    },
    [projectId, importMutation],
  );

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || !projectId) return;
      const arr = Array.from(files).filter((f) => f.type.startsWith("image/"));
      if (arr.length > 0) uploadMutation.mutate(arr);
    },
    [projectId, uploadMutation],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  const items = useMemo<GalleryItem[]>(() => {
    if (annotationJobId && (isAnnotationJobLoading || !annotationJob)) {
      return [];
    }
    const source = annotationJobId
      ? (jobImageData?.items ?? [])
      : (data?.pages.flatMap((page) => page.items) ?? []);
    if (source.length === 0) return [];
    const all = source.map((image) => ({
      id: image.id,
      width: image.width ?? 600,
      height: image.height ?? 400,
      status: image.status,
      url: image.url,
      tags: image.tags?.map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
      })),
      labels: image.labels,
      annotationCount: image.annotation_count,
      predictionCount: image.prediction_count,
    }));
    if (!jobImageIds) return all;
    if (jobImageOrder) {
      const byId = new Map(all.map((img) => [img.id, img]));
      return jobImageOrder
        .map((id) => byId.get(id))
        .filter(Boolean) as GalleryItem[];
    }
    return all.filter((img) => jobImageIds.has(img.id));
  }, [
    annotationJobId,
    annotationJob,
    data,
    isAnnotationJobLoading,
    jobImageData,
    jobImageIds,
    jobImageOrder,
  ]);

  useEffect(() => {
    if (!activeImageId || annotationJobId) return;
    const found = items.some((item) => item.id === activeImageId);
    if (!found && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [
    activeImageId,
    annotationJobId,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    items,
  ]);

  return (
    <section
      className="flex flex-col flex-1 min-h-0 gap-6"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Gallery</h1>
          <p className="text-sm text-muted-foreground">
            Browse and triage incoming images.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <FilterBar
            status={status}
            onStatusChange={setStatus}
            tagId={tagId}
            onTagIdChange={setTagId}
            tags={projectTags}
            labelId={labelId}
            onLabelIdChange={setLabelId}
            labels={projectLabels}
            annotationSource={annotationSource}
            onAnnotationSourceChange={setAnnotationSource}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <input
            ref={importInputRef}
            type="file"
            accept=".zip"
            className="hidden"
            onChange={(e) => {
              handleImportFile(e.target.files);
              e.target.value = "";
            }}
          />
          <Button
            variant="secondary"
            className="gap-2"
            onClick={() => importInputRef.current?.click()}
            disabled={importMutation.isPending || !projectId}
          >
            <FileArchive className="h-4 w-4" />
            {importMutation.isPending ? "Importing…" : "Import YOLO v4"}
          </Button>
          <Button
            variant="secondary"
            className="gap-2"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadMutation.isPending || !projectId}
          >
            <Upload className="h-4 w-4" />
            {uploadMutation.isPending ? "Uploading…" : "Upload"}
          </Button>
        </div>
      </div>

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
          <span className="ml-auto text-xs text-sky-400/60">
            {items.length} images shown
          </span>
        </div>
      )}

      {dragOver && (
        <div className="flex items-center justify-center rounded-lg border-2 border-dashed border-accent bg-accent/10 p-12 text-sm text-accent">
          Drop images here to upload
        </div>
      )}

      {importResult && (
        <div className="flex items-center justify-between rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3">
          <span className="text-sm text-green-400">
            Imported {importResult.imported_images} images with{" "}
            {importResult.imported_annotations} annotations across{" "}
            {importResult.splits.join(", ")} splits ({importResult.labels}{" "}
            labels)
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setImportResult(null)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {importMutation.isError && (
        <div className="flex items-center justify-between rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
          <span className="text-sm text-red-400">
            Import failed:{" "}
            {importMutation.error instanceof Error
              ? importMutation.error.message
              : "Unknown error"}
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => importMutation.reset()}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-accent bg-accent/10 px-4 py-2">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <Button
            variant="secondary"
            className="gap-1"
            onClick={() => {
              const ids = Array.from(selected);
              bulkStatusMutation.mutate({ ids, status: "DONE" });
            }}
            disabled={bulkStatusMutation.isPending}
          >
            <CheckCircle className="h-4 w-4" />
            Mark Done
          </Button>
          <Button
            variant="secondary"
            className="gap-1 text-destructive"
            onClick={() => {
              const ids = Array.from(selected);
              bulkDeleteMutation.mutate(ids);
            }}
            disabled={bulkDeleteMutation.isPending}
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </Button>
          <Button
            variant="secondary"
            className="gap-1"
            onClick={() => {
              setBulkSelectedTagIds(new Set());
              setShowBulkTagDialog(true);
            }}
          >
            <TagIcon className="h-4 w-4" />
            Apply Tags
          </Button>
          <Button variant="ghost" size="icon" onClick={clearSelection}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Bulk tag dialog */}
      {showBulkTagDialog && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="text-sm font-semibold">
            Apply tags to {selected.size} image{selected.size > 1 ? "s" : ""}
          </div>
          <div className="flex flex-wrap gap-2">
            {projectTags.map((t) => {
              const isChecked = bulkSelectedTagIds.has(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${
                    isChecked
                      ? "border-accent bg-accent/20 text-accent-foreground"
                      : "border-border bg-muted/50 text-muted-foreground hover:bg-muted"
                  }`}
                  onClick={() => {
                    const next = new Set(bulkSelectedTagIds);
                    if (isChecked) next.delete(t.id);
                    else next.add(t.id);
                    setBulkSelectedTagIds(next);
                  }}
                >
                  {t.color && (
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: t.color }}
                    />
                  )}
                  {t.name}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <input
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              placeholder="New tag name"
              className="h-8 rounded border border-border bg-background px-2 text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter" && newTagName.trim()) {
                  createTagMutation.mutate(newTagName.trim());
                }
              }}
            />
            <Button
              variant="secondary"
              size="sm"
              disabled={!newTagName.trim() || createTagMutation.isPending}
              onClick={() => {
                if (newTagName.trim())
                  createTagMutation.mutate(newTagName.trim());
              }}
            >
              Create
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={
                bulkSelectedTagIds.size === 0 || bulkTagMutation.isPending
              }
              onClick={() => {
                bulkTagMutation.mutate({
                  ids: Array.from(selected),
                  tagIds: Array.from(bulkSelectedTagIds),
                });
              }}
            >
              {bulkTagMutation.isPending ? "Applying…" : "Apply"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowBulkTagDialog(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {(isLoading || isJobLoading || isAnnotationJobLoading) && (
        <div className="text-sm text-muted-foreground">Loading images…</div>
      )}

      {!isLoading &&
        !isJobLoading &&
        !isAnnotationJobLoading &&
        items.length === 0 && (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card p-12 text-center">
            <Upload className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No images yet. Upload images or drag &amp; drop them here.
            </p>
            <Button
              variant="secondary"
              onClick={() => fileInputRef.current?.click()}
              disabled={!projectId}
            >
              Upload Images
            </Button>
          </div>
        )}

      {items.length > 0 && (
        <MasonryGrid
          items={items}
          scrollToId={activeImageId ?? undefined}
          onOpen={(id) => {
            const qs = annotationJobId
              ? `?annotation_job=${annotationJobId}`
              : "";
            navigate(`/workspace/${id}${qs}`);
          }}
        />
      )}

      {!annotationJobId && hasNextPage && (
        <div className="flex justify-center pt-4">
          <Button
            variant="secondary"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading…
              </>
            ) : (
              "Load More"
            )}
          </Button>
        </div>
      )}
    </section>
  );
}
