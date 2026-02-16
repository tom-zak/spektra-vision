import { useAnnotationStore } from "@/store/annotation";

export function ActiveLabelPicker() {
  const labels = useAnnotationStore((state) => state.labels);
  const activeLabelId = useAnnotationStore((state) => state.activeLabelId);
  const setActiveLabel = useAnnotationStore((state) => state.setActiveLabel);
  const setTool = useAnnotationStore((state) => state.setTool);
  const setToolForImage = useAnnotationStore((state) => state.setToolForImage);
  const activeImageId = useAnnotationStore((state) => state.activeImageId);

  if (labels.length === 0) {
    return (
      <div className="text-xs text-muted-foreground">
        No labels yet. Add labels in Settings.
      </div>
    );
  }

  const resolvedActiveLabelId = activeLabelId ?? labels[0].id;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">Labels</span>
      <div className="flex flex-wrap items-center gap-2">
        {labels.map((label) => {
          const isActive = label.id === resolvedActiveLabelId;
          return (
            <button
              key={label.id}
              type="button"
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition ${
                isActive
                  ? "border-foreground/50 bg-foreground/10 text-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-muted/40 hover:text-foreground"
              }`}
              onClick={() => {
                setActiveLabel(label.id);
                if (activeImageId) {
                  setToolForImage(activeImageId, "box");
                } else {
                  setTool("box");
                }
              }}
              aria-pressed={isActive}
            >
              <span
                className="inline-flex h-2 w-2 rounded-full"
                style={{ backgroundColor: label.color }}
              />
              {label.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
