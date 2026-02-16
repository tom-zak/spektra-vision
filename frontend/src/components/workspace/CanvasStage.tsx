import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import Konva from "konva";
import {
  Circle,
  Image as KonvaImage,
  Label as KonvaLabel,
  Layer,
  Line,
  Rect,
  Stage,
  Tag as KonvaTag,
  Text,
  Transformer,
} from "react-konva";

import { useAnnotationStore } from "@/store/annotation";

const MIN_SCALE = 0.2;
const MAX_SCALE = 6;

type CanvasStageProps = {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
};

export function CanvasStage({
  imageUrl,
  imageWidth,
  imageHeight,
}: CanvasStageProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const draftRef = useRef<Konva.Rect | null>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const panRef = useRef<{ x: number; y: number } | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const shapeRefs = useRef<Record<string, Konva.Shape>>({});

  const tool = useAnnotationStore((state) => state.tool);
  const labels = useAnnotationStore((state) => state.labels);
  const activeLabelId = useAnnotationStore((state) => state.activeLabelId);
  const annotations = useAnnotationStore((state) => state.annotations);
  const addAnnotation = useAnnotationStore((state) => state.addAnnotation);
  const updateAnnotationGeometry = useAnnotationStore(
    (state) => state.updateAnnotationGeometry,
  );
  const selectAnnotation = useAnnotationStore(
    (state) => state.selectAnnotation,
  );
  const selectedIds = useAnnotationStore((state) => state.selectedIds);
  const clearSelection = useAnnotationStore((state) => state.clearSelection);

  const [size, setSize] = useState({ width: 800, height: 600 });
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [draftPoints, setDraftPoints] = useState<number[]>([]);

  useEffect(() => {
    if (!containerRef.current) {
      return undefined;
    }
    const observer = new ResizeObserver(([entry]) => {
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const nextImage = new window.Image();
    nextImage.crossOrigin = "anonymous";
    nextImage.src = imageUrl;
    nextImage.onload = () => {
      imageRef.current = nextImage;
      setImage(nextImage);
    };
  }, [imageUrl]);

  useEffect(() => {
    if (tool !== "polygon" && draftPoints.length > 0) {
      setDraftPoints([]);
    }
  }, [tool, draftPoints.length]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !imageWidth || !imageHeight || !size.width || !size.height) {
      return;
    }
    const scale = Math.min(size.width / imageWidth, size.height / imageHeight);
    stage.scale({ x: scale, y: scale });
    stage.position({
      x: (size.width - imageWidth * scale) / 2,
      y: (size.height - imageHeight * scale) / 2,
    });
    stage.batchDraw();
  }, [imageWidth, imageHeight, size.width, size.height]);

  const selectedBoxIds = useMemo(
    () =>
      selectedIds.filter(
        (id) =>
          annotations.find((annotation) => annotation.id === id)?.kind ===
          "box",
      ),
    [annotations, selectedIds],
  );

  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) {
      return;
    }
    if (selectedBoxIds.length === 0 || tool !== "select") {
      transformer.nodes([]);
      transformer.getLayer()?.batchDraw();
      return;
    }
    const nodes = selectedBoxIds
      .map((id) => shapeRefs.current[id])
      .filter((node) => Boolean(node)) as Konva.Node[];
    transformer.nodes(nodes);
    transformer.getLayer()?.batchDraw();
  }, [selectedBoxIds, tool]);

  const resolvedActiveLabelId = activeLabelId ?? labels[0]?.id ?? "";

  const handleWheel = (event: Konva.KonvaEventObject<WheelEvent>) => {
    event.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) {
      return;
    }
    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();
    if (!pointer) {
      return;
    }
    const scaleBy = 1.05;
    const direction = event.evt.deltaY > 0 ? -1 : 1;
    const newScale = Math.min(
      MAX_SCALE,
      Math.max(MIN_SCALE, oldScale * (direction > 0 ? scaleBy : 1 / scaleBy)),
    );
    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };

    stage.scale({ x: newScale, y: newScale });
    const newPos = {
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    };
    stage.position(newPos);
    stage.batchDraw();
  };

  const handleMouseDown = (event: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }
    const pointer = stage.getPointerPosition();
    if (!pointer) {
      return;
    }

    const transform = stage.getAbsoluteTransform().copy().invert();
    const point = transform.point(pointer);

    if (tool === "select" && event.target === stage) {
      clearSelection();
    }

    if (event.evt.altKey || tool === "pan") {
      setIsPanning(true);
      panRef.current = { x: pointer.x, y: pointer.y };
      return;
    }

    if (tool === "polygon") {
      setDraftPoints((prev) => [...prev, point.x, point.y]);
      return;
    }

    if (tool !== "box") {
      return;
    }

    setIsDrawing(true);
    originRef.current = { x: point.x, y: point.y };
    if (draftRef.current) {
      draftRef.current.visible(true);
      draftRef.current.setAttrs({
        x: point.x,
        y: point.y,
        width: 0,
        height: 0,
      });
      draftRef.current.getLayer()?.batchDraw();
    }
  };

  const handleMouseMove = (event: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }
    const pointer = stage.getPointerPosition();
    if (!pointer) {
      return;
    }

    const transform = stage.getAbsoluteTransform().copy().invert();
    const point = transform.point(pointer);

    if (isPanning && panRef.current) {
      const dx = pointer.x - panRef.current.x;
      const dy = pointer.y - panRef.current.y;
      stage.position({ x: stage.x() + dx, y: stage.y() + dy });
      stage.batchDraw();
      panRef.current = { x: pointer.x, y: pointer.y };
      return;
    }

    if (!isDrawing || !originRef.current || !draftRef.current) {
      return;
    }

    const x = Math.min(originRef.current.x, point.x);
    const y = Math.min(originRef.current.y, point.y);
    const width = Math.abs(point.x - originRef.current.x);
    const height = Math.abs(point.y - originRef.current.y);

    draftRef.current.setAttrs({ x, y, width, height });
    draftRef.current.getLayer()?.batchDraw();
  };

  const handleMouseUp = () => {
    if (isPanning) {
      setIsPanning(false);
      panRef.current = null;
      return;
    }

    if (!isDrawing || !originRef.current || !draftRef.current) {
      return;
    }

    const { x, y, width: w, height: h } = draftRef.current.getAttrs();
    if ((w ?? 0) > 4 && (h ?? 0) > 4) {
      addAnnotation({
        id: `local-${crypto.randomUUID()}`,
        labelId: resolvedActiveLabelId,
        kind: "box",
        x: x ?? 0,
        y: y ?? 0,
        width: w ?? 0,
        height: h ?? 0,
        isLocal: true,
      });
    }
    setIsDrawing(false);
    originRef.current = null;
    draftRef.current.visible(false);
    draftRef.current.setAttrs({ x: 0, y: 0, width: 0, height: 0 });
    draftRef.current.getLayer()?.batchDraw();
  };

  const selectedAnnotation = useMemo(
    () =>
      annotations.find((annotation) => annotation.id === selectedIds[0]) ??
      null,
    [annotations, selectedIds],
  );

  const annotationShapes = useMemo(
    () =>
      annotations.map((annotation) => {
        const label = labels.find((item) => item.id === annotation.labelId);
        const stroke = label?.color ?? "#f97316";
        const labelText = label?.name ?? "Unlabeled";
        const basePoint =
          annotation.kind === "polygon" && annotation.points?.length
            ? {
                x: annotation.points[0],
                y: annotation.points[1],
              }
            : { x: annotation.x, y: annotation.y };
        const labelX = Math.max(0, basePoint.x);
        const labelY = Math.max(0, basePoint.y - 18);
        const labelNode = (
          <KonvaLabel
            key={`${annotation.id}-label`}
            x={labelX}
            y={labelY}
            listening={false}
          >
            <KonvaTag fill={stroke} opacity={0.9} cornerRadius={3} />
            <Text text={labelText} fontSize={12} padding={4} fill="#ffffff" />
          </KonvaLabel>
        );

        if (annotation.kind === "polygon" && annotation.points) {
          return (
            <Fragment key={annotation.id}>
              <Line
                id={annotation.id}
                ref={(node) => {
                  if (node) {
                    shapeRefs.current[annotation.id] = node;
                  }
                }}
                points={annotation.points}
                closed
                stroke={stroke}
                strokeWidth={2}
                draggable={
                  tool === "select" && selectedIds.includes(annotation.id)
                }
                onClick={(event) =>
                  tool === "select" &&
                  selectAnnotation(annotation.id, event.evt.shiftKey)
                }
                onDragEnd={(event) => {
                  const node = event.target;
                  const dx = node.x();
                  const dy = node.y();
                  const next = (annotation.points ?? []).map((value, index) =>
                    index % 2 === 0 ? value + dx : value + dy,
                  );
                  node.position({ x: 0, y: 0 });
                  updateAnnotationGeometry(annotation.id, { points: next });
                }}
              />
              {labelNode}
            </Fragment>
          );
        }

        return (
          <Fragment key={annotation.id}>
            <Rect
              id={annotation.id}
              ref={(node) => {
                if (node) {
                  shapeRefs.current[annotation.id] = node;
                }
              }}
              x={annotation.x}
              y={annotation.y}
              width={annotation.width}
              height={annotation.height}
              stroke={stroke}
              strokeWidth={2}
              draggable={
                tool === "select" && selectedIds.includes(annotation.id)
              }
              onClick={(event) =>
                tool === "select" &&
                selectAnnotation(annotation.id, event.evt.shiftKey)
              }
              onDragEnd={(event) => {
                updateAnnotationGeometry(annotation.id, {
                  x: event.target.x(),
                  y: event.target.y(),
                });
              }}
              onTransformEnd={(event) => {
                const node = event.target;
                const scaleX = node.scaleX();
                const scaleY = node.scaleY();
                node.scaleX(1);
                node.scaleY(1);
                updateAnnotationGeometry(annotation.id, {
                  x: node.x(),
                  y: node.y(),
                  width: Math.max(2, node.width() * scaleX),
                  height: Math.max(2, node.height() * scaleY),
                });
              }}
            />
            {labelNode}
          </Fragment>
        );
      }),
    [
      annotations,
      labels,
      selectAnnotation,
      selectedIds,
      tool,
      updateAnnotationGeometry,
    ],
  );

  const handleDblClick = () => {
    if (tool !== "polygon" || draftPoints.length < 6) {
      return;
    }
    addAnnotation({
      id: `local-${crypto.randomUUID()}`,
      labelId: resolvedActiveLabelId,
      kind: "polygon",
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      points: draftPoints,
      isLocal: true,
    });
    setDraftPoints([]);
  };

  return (
    <div
      ref={containerRef}
      className="relative h-[560px] w-full overflow-hidden rounded-lg border border-border bg-card"
    >
      <Stage
        ref={stageRef}
        width={size.width}
        height={size.height}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onDblClick={handleDblClick}
      >
        <Layer>
          {image && (
            <KonvaImage image={image} width={imageWidth} height={imageHeight} />
          )}
          <Rect ref={draftRef} stroke="#f97316" dash={[6, 4]} visible={false} />
          {annotationShapes}
          {tool === "polygon" && draftPoints.length >= 4 && (
            <Line points={draftPoints} stroke="#f97316" strokeWidth={2} />
          )}
        </Layer>
        <Layer>
          <Transformer
            ref={transformerRef}
            rotateEnabled={false}
            anchorSize={8}
          />
          {selectedAnnotation?.kind === "polygon" &&
            selectedAnnotation.points?.map((value, index) => {
              if (index % 2 !== 0) {
                return null;
              }
              const x = value;
              const y = selectedAnnotation.points?.[index + 1] ?? 0;
              return (
                <Circle
                  key={`${selectedAnnotation.id}-pt-${index}`}
                  x={x}
                  y={y}
                  radius={4}
                  fill="#f97316"
                  opacity={0.9}
                  listening={false}
                />
              );
            })}
        </Layer>
      </Stage>
    </div>
  );
}
