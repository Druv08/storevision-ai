from pathlib import Path
from typing import Any

from ultralytics import YOLO


CONFIDENCE_THRESHOLD = 0.25


PROJECT_ROOT = Path(__file__).resolve().parents[2]


MODEL_PATH = (
    PROJECT_ROOT
    / "runs"
    / "detect"
    / "outputs"
    / "training-runs"
    / "empty_shelf_final-3"
    / "weights"
    / "best.pt"
)


_model = None


def get_model():
    global _model

    if not MODEL_PATH.exists():
        raise FileNotFoundError(
            f"Trained model not found at: {MODEL_PATH}"
        )

    if _model is None:
        _model = YOLO(str(MODEL_PATH))

    return _model



def run_empty_shelf_detection(image_path: str) -> dict[str, Any]:

    image_file = Path(image_path)

    if not image_file.exists():
        raise FileNotFoundError(
            f"Image not found: {image_file}"
        )


    model = get_model()


    results = model.predict(
        source=str(image_file),
        conf=CONFIDENCE_THRESHOLD,
        save=False,
        verbose=False
    )


    detections = []


    if results:

        result = results[0]

        names = result.names


        for box in result.boxes:

            class_id = int(box.cls[0].item())

            confidence = float(box.conf[0].item())


            x1, y1, x2, y2 = box.xyxy[0].tolist()


            detections.append(
                {
                    "class_id": class_id,
                    "class_name": names.get(
                        class_id,
                        str(class_id)
                    ),
                    "confidence": round(
                        confidence,
                        4
                    ),
                    "box": {
                        "x1": round(float(x1),2),
                        "y1": round(float(y1),2),
                        "x2": round(float(x2),2),
                        "y2": round(float(y2),2)
                    }
                }
            )


    return {
        "detection_count": len(detections),
        "issue_detected": len(detections) > 0,
        "detections": detections
    }