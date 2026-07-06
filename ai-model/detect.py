"""
StoreVision AI - Empty Shelf detection test (Day 13).

Runs a trained YOLOv8 model on a single image to detect empty shelf spaces
(class: "Empty-space") and saves the annotated result image.

Run it from inside the ai-model/ folder:

    python detect.py
    python detect.py --model <path-to-weights.pt> --source <path-to-image>
"""

from pathlib import Path
import argparse
import sys

from ultralytics import YOLO

# Build paths from this file's location so nothing is hardcoded and the script
# stays portable across machines.
HERE = Path(__file__).resolve().parent            # .../storevision-ai/ai-model

DEFAULT_MODEL = HERE / "outputs" / "training-runs" / "empty_shelf_yolov8n_day13" / "weights" / "best.pt"
DEFAULT_SOURCE = HERE / ".." / "dataset" / "sample-test-images" / "test_image.jpg"
RESULTS_DIR = HERE / "outputs" / "detection-results"

# Only keep detections the model is at least 25% confident about.
CONFIDENCE = 0.25


def parse_args():
    parser = argparse.ArgumentParser(
        description="Test the empty-shelf YOLO model on a single image."
    )
    parser.add_argument("--model", default=str(DEFAULT_MODEL),
                        help="Path to trained YOLO weights (.pt)")
    parser.add_argument("--source", default=str(DEFAULT_SOURCE),
                        help="Path to the image to run detection on")
    return parser.parse_args()


def main():
    args = parse_args()
    model_path = Path(args.model).resolve()
    source_path = Path(args.source).resolve()

    # 1. The trained model must exist.
    if not model_path.exists():
        print(f"ERROR: trained model not found: {model_path}")
        print("Train the model first by running train.py, then try again.")
        print("Expected weights at:")
        print("  outputs/training-runs/empty_shelf_yolov8n_day13/weights/best.pt")
        sys.exit(1)

    # 2. The test image must exist.
    if not source_path.exists():
        print(f"ERROR: test image not found: {source_path}")
        print("Put an image at dataset/sample-test-images/test_image.jpg,")
        print("or pass one with:  python detect.py --source <path-to-image>")
        sys.exit(1)

    print("=" * 60)
    print("StoreVision AI - Empty Shelf detection")
    print(f"  model  : {model_path}")
    print(f"  image  : {source_path}")
    print(f"  conf   : {CONFIDENCE}")
    print(f"  output : {RESULTS_DIR}")
    print("=" * 60)

    # 3. Run detection and save the annotated image.
    model = YOLO(str(model_path))
    model.predict(
        source=str(source_path),
        conf=CONFIDENCE,
        save=True,
        project=str(RESULTS_DIR.parent),   # outputs/
        name=RESULTS_DIR.name,             # detection-results/
        exist_ok=True,
    )

    print("\nDetection complete. Annotated image saved under:")
    print(f"  {RESULTS_DIR}")


if __name__ == "__main__":
    main()
