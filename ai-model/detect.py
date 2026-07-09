"""
StoreVision AI - Empty Shelf Detection Test (Day 15)

Runs the trained YOLOv8 model on one image or a folder of images.
Saves annotated prediction results locally.

Run from inside ai-model:

    python detect.py

Optional:

    python detect.py --model path/to/model.pt
    python detect.py --source path/to/image_or_folder
"""

from pathlib import Path
import argparse
import sys

from ultralytics import YOLO


# Project paths
HERE = Path(__file__).resolve().parent
PROJECT_ROOT = HERE.parent


# Trained YOLO model
DEFAULT_MODEL = (
    PROJECT_ROOT
    / "runs"
    / "detect"
    / "train-3"
    / "weights"
    / "best.pt"
)


# Test dataset images
DEFAULT_SOURCE = (
    PROJECT_ROOT
    / "dataset"
    / "labelled-data"
    / "roboflow-empty-shelf"
    / "test"
    / "images"
)


# Detection output folder
RESULTS_DIR = (
    HERE
    / "outputs"
    / "detection-results"
)


CONFIDENCE = 0.20



def parse_args():

    parser = argparse.ArgumentParser(
        description="Run StoreVision AI empty shelf detection"
    )


    parser.add_argument(
        "--model",
        default=str(DEFAULT_MODEL),
        help="Path to YOLO weights"
    )


    parser.add_argument(
        "--source",
        default=str(DEFAULT_SOURCE),
        help="Path to image or folder"
    )


    return parser.parse_args()



def main():

    args = parse_args()


    model_path = Path(args.model).resolve()
    source_path = Path(args.source).resolve()


    # Check model exists

    if not model_path.exists():

        print("\nERROR: Model file not found")
        print(model_path)

        print(
            "\nExpected location:"
            "\nruns/detect/train-3/weights/best.pt"
        )

        sys.exit(1)



    # Check source exists

    if not source_path.exists():

        print("\nERROR: Test images not found")
        print(source_path)

        print(
            "\nExpected location:"
            "\ndataset/labelled-data/roboflow-empty-shelf/test/images"
        )

        sys.exit(1)



    print("=" * 60)
    print("StoreVision AI - Empty Shelf Detection")
    print("=" * 60)

    print(f"Model  : {model_path}")
    print(f"Source : {source_path}")
    print(f"Output : {RESULTS_DIR}")
    print(f"Conf   : {CONFIDENCE}")

    print("=" * 60)



    # Load YOLO model

    model = YOLO(str(model_path))
    print("Loaded model:", model_path)
    print("Model classes:", model.names)



    # Run detection

    results = model.predict(
        source=str(source_path),
        conf=CONFIDENCE,
        imgsz=1024,
        save=True,
        project=str(RESULTS_DIR.parent),
        name=RESULTS_DIR.name,
        exist_ok=True
    )

    for result in results:
     print("Number of detections:", len(result.boxes))

     for box in result.boxes:
        cls = int(box.cls[0])
        confidence = float(box.conf[0])

        print(
            "Class:",
            cls,
            "Confidence:",
            round(confidence, 3)
        )

    

    print("\nDetection completed successfully.")
    print(
        f"Images processed: {len(results)}"
    )

    print(
        "\nResults saved at:"
    )

    print(
        RESULTS_DIR
    )


if __name__ == "__main__":
    main()