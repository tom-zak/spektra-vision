import { Sparkles, Trash2, X, Plus } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { LabelCombobox } from "@/components/workspace/LabelCombobox";
import { useAnnotationStore } from "@/store/annotation";
import { Tag, fetchProjectTags, createTag, updateImageTags } from "@/lib/api";

type AnnotationSidebarProps = {
  imageId?: string;
  projectId?: string;
  imageTags?: Tag[];
  onDeleteAnnotation?: (id: string) => void;
};

export function AnnotationSidebar({
  imageId,
  projectId,
  imageTags = [],
  onDeleteAnnotation,
}: AnnotationSidebarProps) {
  const annotations = useAnnotationStore((state) => state.annotations);
  const labels = useAnnotationStore((state) => state.labels);
  const updateAnnotationLabel = useAnnotationStore(
    (state) => state.updateAnnotationLabel,
  );
  const deleteAnnotation = useAnnotationStore(
    (state) => state.deleteAnnotation,
  );
  const handleDeleteAnnotation = onDeleteAnnotation ?? deleteAnnotation;
  const selectAnnotation = useAnnotationStore(
    (state) => state.selectAnnotation,
  );
  const selectedIds = useAnnotationStore((state) => state.selectedIds);

  return (
    <aside className="w-full max-w-sm border-l border-border bg-card p-4 space-y-6">
      <div>
        <div className="text-sm font-semibold">Annotations</div>
        <div className="mt-4 space-y-3">
          {annotations.length === 0 && (
            <div className="text-sm text-muted-foreground">
              No annotations yet.
            </div>
          )}
          {annotations.map((annotation, index) => (
            <div
              key={annotation.id}
              className={
                selectedIds.includes(annotation.id)
                  ? "rounded-md border border-accent bg-muted/40 p-3"
                  : "rounded-md border border-border p-3"
              }
              onClick={() => selectAnnotation(annotation.id)}
              role="button"
              tabIndex={0}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {annotation.kind === "polygon" ? "Polygon" : "Box"}{" "}
                  {index + 1}
                  {annotation.isPrediction && (
                    <span className="inline-flex items-center gap-0.5 rounded bg-purple-500/20 px-1.5 py-0.5 text-[10px] font-medium text-purple-400">
                      <Sparkles className="h-3 w-3" />
                      AI
                    </span>
                  )}
                  {annotation.confidence != null && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono">
                      {(annotation.confidence * 100).toFixed(0)}%
                    </span>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleDeleteAnnotation(annotation.id);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <div className="mt-2">
                <LabelCombobox
                  options={labels}
                  value={annotation.labelId}
                  onChange={(value) =>
                    updateAnnotationLabel(annotation.id, value)
                  }
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tags section */}
      {imageId && projectId && (
        <ImageTagsSection
          imageId={imageId}
          projectId={projectId}
          imageTags={imageTags}
        />
      )}
    </aside>
  );
}

function ImageTagsSection({
  imageId,
  projectId,
  imageTags,
}: {
  imageId: string;
  projectId: string;
  imageTags: Tag[];
}) {
  const queryClient = useQueryClient();

  const { data: projectTags = [] } = useQuery({
    queryKey: ["projectTags", projectId],
    queryFn: () => fetchProjectTags(projectId),
  });

  const setTagsMutation = useMutation({
    mutationFn: (tagIds: string[]) => updateImageTags(imageId, tagIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["images"] });
    },
  });

  const createTagMutation = useMutation({
    mutationFn: (name: string) => createTag(projectId, { name }),
    onSuccess: (newTag) => {
      queryClient.invalidateQueries({ queryKey: ["projectTags", projectId] });
      // also add the new tag to image
      const currentIds = imageTags.map((t) => t.id);
      setTagsMutation.mutate([...currentIds, newTag.id]);
    },
  });

  const appliedIds = new Set(imageTags.map((t) => t.id));
  const availableTags = projectTags.filter((t) => !appliedIds.has(t.id));

  const removeTag = (tagId: string) => {
    setTagsMutation.mutate(
      imageTags.filter((t) => t.id !== tagId).map((t) => t.id),
    );
  };

  const addTag = (tagId: string) => {
    setTagsMutation.mutate([...imageTags.map((t) => t.id), tagId]);
  };

  return (
    <div>
      <div className="text-sm font-semibold">Tags</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {imageTags.length === 0 && (
          <div className="text-xs text-muted-foreground">No tags</div>
        )}
        {imageTags.map((tag) => (
          <span
            key={tag.id}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-xs"
          >
            {tag.color && (
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: tag.color }}
              />
            )}
            {tag.name}
            <button
              type="button"
              className="ml-0.5 text-muted-foreground hover:text-foreground"
              onClick={() => removeTag(tag.id)}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      {availableTags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {availableTags.map((tag) => (
            <button
              key={tag.id}
              type="button"
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => addTag(tag.id)}
            >
              <Plus className="h-3 w-3" />
              {tag.name}
            </button>
          ))}
        </div>
      )}
      <div className="mt-2">
        <input
          placeholder="New tag…"
          className="h-7 w-full rounded border border-border bg-background px-2 text-xs"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const name = (e.target as HTMLInputElement).value.trim();
              if (name) {
                createTagMutation.mutate(name);
                (e.target as HTMLInputElement).value = "";
              }
            }
          }}
        />
      </div>
    </div>
  );
}
