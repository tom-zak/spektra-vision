import { Hand, MousePointer2, PenLine, Square } from "lucide-react";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ToolMode, useAnnotationStore } from "@/store/annotation";

const tools: Array<{ id: ToolMode; label: string; icon: typeof Square }> = [
  { id: "select", label: "Select", icon: MousePointer2 },
  { id: "box", label: "Box", icon: Square },
  { id: "polygon", label: "Polygon", icon: PenLine },
  { id: "pan", label: "Pan", icon: Hand },
];

export function Toolbar() {
  const tool = useAnnotationStore((state) => state.tool);
  const setTool = useAnnotationStore((state) => state.setTool);
  const setToolForImage = useAnnotationStore((state) => state.setToolForImage);
  const activeImageId = useAnnotationStore((state) => state.activeImageId);

  return (
    <div className="flex items-center gap-3">
      <ToggleGroup
        type="single"
        value={tool}
        onValueChange={(value) => {
          if (!value) {
            return;
          }
          if (activeImageId) {
            setToolForImage(activeImageId, value as ToolMode);
          } else {
            setTool(value as ToolMode);
          }
        }}
      >
        {tools.map((item) => (
          <ToggleGroupItem
            key={item.id}
            value={item.id}
            aria-label={item.label}
          >
            <item.icon className="h-4 w-4" />
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <div className="text-xs text-muted-foreground">
        Alt + Drag to pan, Wheel to zoom
      </div>
    </div>
  );
}
