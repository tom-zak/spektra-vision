from pathlib import Path
from typing import Any

from ultralytics import YOLO


def run_inference(model_path: str, image_path: Path) -> list[dict[str, Any]]:
    model = YOLO(model_path)
    results = model.predict(str(image_path), verbose=False)
    predictions: list[dict[str, Any]] = []
    for result in results:
        if result.boxes is None:
            continue
        for box in result.boxes:
            xyxy = box.xyxy[0].tolist()
            x1, y1, x2, y2 = xyxy
            predictions.append(
                {
                    "class_index": int(box.cls[0].item()),
                    "confidence": float(box.conf[0].item()),
                    "geometry": {"x": x1, "y": y1, "w": x2 - x1, "h": y2 - y1},
                }
            )
    return predictions
