"""
StoreVision AI - empty-shelf detection service.

Loads the trained YOLO model once (lazily) and runs empty-shelf detection on a
single image, returning clean JSON-friendly results.
"""

from pathlib import Path

from ultralytics import YOLO

# Project root is two levels up from backend/app/ (app -> backend -> root).
# Building the path this way avoids hardcoding absolute machine paths.
PROJECT_ROOT = Path(__file__).resolve().parents[2]

MODEL_PATH = (
    Path(__file__)
    .resolve()
    .parents[2]
    / "runs" 
    / "detect" 
    / "train-5"
    / "weights" 
    / "best.pt"
)

CONFIDENCE = 0.25

# The model is loaded on first use and then reused across requests.
_model = None


def get_model():
    """Load the trained YOLO model once and reuse it on later calls."""
    global _model
    if _model is None:
        if not MODEL_PATH.exists():
            raise FileNotFoundError(
                f"Trained model not found at: {MODEL_PATH}. "
                "Train the model first (see ai-model/train.py)."
            )
        _model = YOLO(str(MODEL_PATH))
    return _model


def run_empty_shelf_detection(image_path: str, annotate_dir: str | None = None) -> dict:
    """Detect empty shelf spaces in one image and return JSON-friendly results.

    If annotate_dir is given, an annotated copy of the image (with the detection
    boxes drawn on it) is saved there and its filename is returned under
    "annotated_file".
    """
    model = get_model()
    results = model.predict(source=image_path, conf=CONFIDENCE, save=False, verbose=False)

    print("YOLO RESULTS:", results)

    print(
        "NUMBER OF BOXES:",
        len(results[0].boxes)
    )

    detections = []
    if results:
        result = results[0]
        names = result.names
        for box in result.boxes:
            class_id = int(box.cls[0])
            x1, y1, x2, y2 = (float(v) for v in box.xyxy[0])
            detections.append({
                "class_id": class_id,
                "class_name": names.get(class_id, str(class_id)),
                "confidence": round(float(box.conf[0]), 4),
                "box": {
                    "x1": round(x1, 2),
                    "y1": round(y1, 2),
                    "x2": round(x2, 2),
                    "y2": round(y2, 2),
                },
            })

    annotated_file = None
    if annotate_dir and results:
        import uuid

        import cv2  # installed with ultralytics

        out_dir = Path(annotate_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        annotated_file = f"{uuid.uuid4().hex[:10]}.jpg"
        # result.plot() returns the image with boxes/labels already drawn.
        cv2.imwrite(str(out_dir / annotated_file), results[0].plot())

    detection_count = len(detections)
    return {
        "detection_count": detection_count,
        "issue_detected": detection_count > 0,
        "detections": detections,
        "annotated_file": annotated_file,
    }
