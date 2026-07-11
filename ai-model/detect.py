"""
StoreVision AI - Empty Shelf detection (Day 15).

Runs the trained YOLOv8 model on a single image or a whole folder of images
to detect empty shelf spaces (class: "Empty-space") and saves the annotated
results locally.

Run it from inside the ai-model/ folder:

    python detect.py
    python detect.py --model <path-to-weights.pt> --source <image-or-folder>
"""

from pathlib import Path
import argparse
import sys

from ultralytics import YOLO

# Build paths from this file's location so nothing is hardcoded and the script
# stays portable across machines.
HERE = Path(__file__).resolve().parent            # .../storevision-ai/ai-model

DEFAULT_MODEL = HERE / "outputs" / "training-runs" / "empty_shelf_yolov8n_day13" / "weights" / "best.pt"
DEFAULT_SOURCE = HERE / ".." / "dataset" / "sample-test-images"
RESULTS_DIR = HERE / "outputs" / "detection-results"

# Only keep detections the model is at least 25% confident about.
CONFIDENCE = 0.25


def parse_args():
    parser = argparse.ArgumentParser(
        description="Detect empty shelf spaces on an image or a folder of images."
    )
    parser.add_argument("--model", default=str(DEFAULT_MODEL),
                        help="Path to trained YOLO weights (.pt)")
    parser.add_argument("--source", default=str(DEFAULT_SOURCE),
                        help="Path to a single image or a folder of images")
    return parser.parse_args()


def main():
    args = parse_args()
    model_path = Path(args.model).resolve()
    source_path = Path(args.source).resolve()

    # The trained model must exist.
    if not model_path.exists():
        print(f"ERROR: trained model not found: {model_path}")
        print("Train the model first by running train.py, then try again.")
        sys.exit(1)

    # The source (image or folder) must exist.
    if not source_path.exists():
        print(f"ERROR: source path not found: {source_path}")
        print("Add images to dataset/sample-test-images/, or pass one with:")
        print("  python detect.py --source <image-or-folder>")
        sys.exit(1)

    # Run detection on the image or every image in the folder.
    model = YOLO(str(model_path))
    results = model.predict(
        source=str(source_path),
        conf=CONFIDENCE,
        save=True,
        project=str(RESULTS_DIR.parent),   # outputs/
        name=RESULTS_DIR.name,             # detection-results/
        exist_ok=True,
    )

    print("=" * 60)
    print("StoreVision AI - Empty Shelf detection")
    print(f"  model   : {model_path}")
    print(f"  source  : {source_path}")
    print(f"  output  : {RESULTS_DIR}")
    print(f"  results : {len(results)} image(s) processed")
    print("=" * 60)


if __name__ == "__main__":
    main()
