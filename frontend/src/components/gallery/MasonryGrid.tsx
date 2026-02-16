import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { GalleryItem, useGalleryStore } from "@/store/gallery";

const GAP = 12;
const MIN_H = 120;

type Pos = { index: number; x: number; y: number; w: number; h: number };

function computeLayout(
  items: GalleryItem[],
  cols: number,
  colW: number,
): { positions: Pos[]; height: number } {
  const heights = Array.from({ length: cols }, () => 0);
  const positions: Pos[] = [];
  items.forEach((item, i) => {
    const col = heights.indexOf(Math.min(...heights));
    const h = Math.max(MIN_H, Math.round((item.height / item.width) * colW));
    positions.push({
      index: i,
      x: col * (colW + GAP),
      y: heights[col],
      w: colW,
      h,
    });
    heights[col] += h + GAP;
  });
  return { positions, height: Math.max(0, ...heights) };
}

type MasonryGridProps = {
  items: GalleryItem[];
  onOpen?: (id: string) => void;
  scrollToId?: string;
};

export function MasonryGrid({ items, onOpen, scrollToId }: MasonryGridProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const toggle = useGalleryStore((s) => s.toggleSelection);
  const selected = useGalleryStore((s) => s.selected);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cols = width > 1200 ? 5 : width > 900 ? 4 : width > 600 ? 3 : 2;
  const colW = width > 0 ? (width - GAP * (cols - 1)) / cols : 240;
  const { positions, height } = useMemo(
    () => computeLayout(items, cols, colW),
    [items, cols, colW],
  );

  const scrollTarget = useMemo(() => {
    if (!scrollToId) return null;
    const index = items.findIndex((item) => item.id === scrollToId);
    if (index < 0) return null;
    return positions.find((pos) => pos.index === index) ?? null;
  }, [items, positions, scrollToId]);

  useEffect(() => {
    if (!scrollTarget || !ref.current) return;
    const container = ref.current;
    const top = scrollTarget.y;
    const bottom = scrollTarget.y + scrollTarget.h;
    const viewTop = container.scrollTop;
    const viewBottom = viewTop + container.clientHeight;
    if (top < viewTop || bottom > viewBottom) {
      container.scrollTo({ top: Math.max(0, top - GAP), behavior: "smooth" });
    }
  }, [scrollTarget]);

  return (
    <div ref={ref} className="flex-1 min-h-0 overflow-y-auto">
      <div className="relative" style={{ height }}>
        {positions.map((pos) => {
          const item = items[pos.index];
          const isSel = selected.has(item.id);
          const manualCount =
            (item.annotationCount ?? 0) - (item.predictionCount ?? 0);
          return (
            <div
              key={item.id}
              className="absolute"
              style={{ left: pos.x, top: pos.y, width: pos.w, height: pos.h }}
            >
              <button
                type="button"
                className={cn(
                  "relative h-full w-full overflow-hidden rounded-lg border border-border bg-muted/50 transition-shadow",
                  isSel ? "ring-2 ring-accent" : "hover:ring-1 hover:ring-ring",
                )}
                onClick={(e) => {
                  if (e.shiftKey) {
                    toggle(item.id, pos.index, true, items);
                    return;
                  }
                  onOpen?.(item.id);
                }}
              >
                <img
                  src={item.url}
                  alt=""
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
                {/* Status — top-left */}
                <div className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                  {item.status}
                </div>
                {/* Label pills — top-right */}
                {item.labels && item.labels.length > 0 && (
                  <div className="absolute right-1.5 top-1.5 flex flex-col items-end gap-0.5">
                    {item.labels.slice(0, 3).map((l) => (
                      <span
                        key={l.id}
                        className="inline-flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-medium text-white backdrop-blur-sm"
                      >
                        <span
                          className="inline-block h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: l.color ?? "#3b82f6" }}
                        />
                        {l.name}
                        {l.ai_count > 0 && l.ai_count === l.count && (
                          <span className="text-purple-300">AI</span>
                        )}
                      </span>
                    ))}
                    {item.labels.length > 3 && (
                      <span className="rounded bg-black/60 px-1.5 py-0.5 text-[9px] text-white backdrop-blur-sm">
                        +{item.labels.length - 3}
                      </span>
                    )}
                  </div>
                )}
                {/* Tags — bottom-left */}
                {item.tags && item.tags.length > 0 && (
                  <div className="absolute bottom-1.5 left-1.5 flex flex-wrap gap-0.5">
                    {item.tags.slice(0, 3).map((tag) => (
                      <span
                        key={tag.id}
                        className="inline-flex items-center gap-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] text-white backdrop-blur-sm"
                      >
                        {tag.color && (
                          <span
                            className="inline-block h-1.5 w-1.5 rounded-full"
                            style={{ backgroundColor: tag.color }}
                          />
                        )}
                        {tag.name}
                      </span>
                    ))}
                    {item.tags.length > 3 && (
                      <span className="rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] text-white backdrop-blur-sm">
                        +{item.tags.length - 3}
                      </span>
                    )}
                  </div>
                )}
                {/* Annotation count — bottom-right */}
                {(item.annotationCount ?? 0) > 0 && (
                  <div className="absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[9px] text-white backdrop-blur-sm">
                    {(item.predictionCount ?? 0) > 0 && (
                      <span className="text-purple-300">
                        {item.predictionCount} AI
                      </span>
                    )}
                    {manualCount > 0 && <span>{manualCount}m</span>}
                  </div>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
