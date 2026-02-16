import { create } from "zustand";

export type ToolMode = "select" | "box" | "polygon" | "pan";

export type LabelOption = {
  id: string;
  name: string;
  color: string;
};

export type Annotation = {
  id: string;
  labelId: string;
  kind: "box" | "polygon";
  x: number;
  y: number;
  width: number;
  height: number;
  points?: number[];
  isLocal?: boolean;
  confidence?: number | null;
  isPrediction?: boolean;
};

type HistoryEntry = {
  annotations: Annotation[];
  deletedIds: string[];
};

const MAX_HISTORY = 50;

type AnnotationState = {
  tool: ToolMode;
  toolByImage: Record<string, ToolMode>;
  activeImageId?: string;
  activeLabelId?: string;
  labels: LabelOption[];
  annotations: Annotation[];
  deletedIds: string[];
  selectedIds: string[];
  // undo/redo stacks
  _past: HistoryEntry[];
  _future: HistoryEntry[];
  setActiveImage: (imageId?: string) => void;
  setTool: (tool: ToolMode) => void;
  setToolForImage: (imageId: string, tool: ToolMode) => void;
  setActiveLabel: (labelId: string) => void;
  addAnnotation: (annotation: Annotation) => void;
  setAnnotations: (annotations: Annotation[]) => void;
  setLabels: (labels: LabelOption[]) => void;
  updateAnnotationLabel: (id: string, labelId: string) => void;
  updateAnnotationGeometry: (id: string, patch: Partial<Annotation>) => void;
  selectAnnotation: (id: string | null, additive?: boolean) => void;
  clearSelection: () => void;
  deleteAnnotation: (id: string) => void;
  deleteAnnotations: (ids: string[]) => void;
  clearDeleted: () => void;
  undo: () => void;
  redo: () => void;
};

function pushHistory(
  state: AnnotationState,
): Pick<AnnotationState, "_past" | "_future"> {
  const entry: HistoryEntry = {
    annotations: state.annotations,
    deletedIds: state.deletedIds,
  };
  return {
    _past: [...state._past.slice(-MAX_HISTORY + 1), entry],
    _future: [],
  };
}

export const useAnnotationStore = create<AnnotationState>((set) => ({
  tool: "select",
  toolByImage: {},
  labels: [],
  annotations: [],
  deletedIds: [],
  selectedIds: [],
  _past: [],
  _future: [],
  setActiveImage: (imageId) => set({ activeImageId: imageId }),
  setTool: (tool) => set({ tool }),
  setToolForImage: (imageId, tool) =>
    set((state) => ({
      tool,
      toolByImage: { ...state.toolByImage, [imageId]: tool },
    })),
  setActiveLabel: (labelId) => set({ activeLabelId: labelId }),
  addAnnotation: (annotation) =>
    set((state) => ({
      ...pushHistory(state),
      annotations: [...state.annotations, annotation],
    })),
  setAnnotations: (annotations) => set({ annotations, _past: [], _future: [] }),
  setLabels: (labels) =>
    set((state) => ({
      labels,
      activeLabelId:
        labels.find((label) => label.id === state.activeLabelId)?.id ??
        labels[0]?.id,
    })),
  updateAnnotationLabel: (id, labelId) =>
    set((state) => ({
      ...pushHistory(state),
      annotations: state.annotations.map((annotation) =>
        annotation.id === id ? { ...annotation, labelId } : annotation,
      ),
    })),
  updateAnnotationGeometry: (id, patch) =>
    set((state) => ({
      ...pushHistory(state),
      annotations: state.annotations.map((annotation) =>
        annotation.id === id ? { ...annotation, ...patch } : annotation,
      ),
    })),
  selectAnnotation: (id, additive) =>
    set((state) => {
      if (!id) {
        return { selectedIds: [] };
      }
      if (additive) {
        const next = state.selectedIds.includes(id)
          ? state.selectedIds.filter((item) => item !== id)
          : [...state.selectedIds, id];
        return { selectedIds: next };
      }
      return { selectedIds: [id] };
    }),
  clearSelection: () => set({ selectedIds: [] }),
  deleteAnnotation: (id) =>
    set((state) => ({
      ...pushHistory(state),
      annotations: state.annotations.filter(
        (annotation) => annotation.id !== id,
      ),
      deletedIds: id.startsWith("local-")
        ? state.deletedIds
        : [...state.deletedIds, id],
      selectedIds: state.selectedIds.filter((item) => item !== id),
    })),
  deleteAnnotations: (ids) =>
    set((state) => ({
      ...pushHistory(state),
      annotations: state.annotations.filter(
        (annotation) => !ids.includes(annotation.id),
      ),
      deletedIds: [
        ...state.deletedIds,
        ...ids.filter(
          (id) => !id.startsWith("local-") && !state.deletedIds.includes(id),
        ),
      ],
      selectedIds: state.selectedIds.filter((item) => !ids.includes(item)),
    })),
  clearDeleted: () => set({ deletedIds: [] }),
  undo: () =>
    set((state) => {
      if (state._past.length === 0) return state;
      const prev = state._past[state._past.length - 1];
      const currentEntry: HistoryEntry = {
        annotations: state.annotations,
        deletedIds: state.deletedIds,
      };
      return {
        annotations: prev.annotations,
        deletedIds: prev.deletedIds,
        _past: state._past.slice(0, -1),
        _future: [...state._future, currentEntry],
      };
    }),
  redo: () =>
    set((state) => {
      if (state._future.length === 0) return state;
      const next = state._future[state._future.length - 1];
      const currentEntry: HistoryEntry = {
        annotations: state.annotations,
        deletedIds: state.deletedIds,
      };
      return {
        annotations: next.annotations,
        deletedIds: next.deletedIds,
        _past: [...state._past, currentEntry],
        _future: state._future.slice(0, -1),
      };
    }),
}));
