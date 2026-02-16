import { create } from "zustand";

export type GalleryItem = {
  id: string;
  width: number;
  height: number;
  status: "NEW" | "IN_PROGRESS" | "DONE";
  url: string;
  tags?: { id: string; name: string; color: string | null }[];
  labels?: {
    id: string;
    name: string;
    color: string | null;
    count: number;
    ai_count: number;
  }[];
  annotationCount?: number;
  predictionCount?: number;
};

type GalleryState = {
  selected: Set<string>;
  lastSelectedIndex: number | null;
  toggleSelection: (
    id: string,
    index: number,
    withRange: boolean,
    items: GalleryItem[],
  ) => void;
  clearSelection: () => void;
};

export const useGalleryStore = create<GalleryState>((set, get) => ({
  selected: new Set(),
  lastSelectedIndex: null,
  toggleSelection: (id, index, withRange, items) => {
    const selected = new Set(get().selected);
    if (withRange && get().lastSelectedIndex !== null) {
      const start = Math.min(get().lastSelectedIndex!, index);
      const end = Math.max(get().lastSelectedIndex!, index);
      for (let i = start; i <= end; i += 1) {
        selected.add(items[i].id);
      }
    } else if (selected.has(id)) {
      selected.delete(id);
    } else {
      selected.add(id);
    }
    set({ selected, lastSelectedIndex: index });
  },
  clearSelection: () => set({ selected: new Set(), lastSelectedIndex: null }),
}));
