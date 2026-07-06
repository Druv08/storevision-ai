"""
StoreVision AI - Empty Shelf YOLO training (Day 13).

Trains a small YOLOv8 model to detect empty shelf spaces (single class:
"Empty-space") using the local Roboflow dataset. This model finds shelf gaps,
not specific product brands.

Run it from inside the ai-model/ folder:

    python train.py
"""

from pathlib import Path
import sys
import tempfile

import yaml
from ultralytics import YOLO

# Build paths from this file's location so nothing is hardcoded and the script
# stays portable across machines.
HERE = Path(__file__).resolve().parent            # .../storevision-ai/ai-model
CONFIG_FILE = HERE / "storevision_empty_shelf.yaml"

# Training settings - kept light so it runs on a normal laptop.
BASE_MODEL = "yolov8n.pt"
EPOCHS = 20
IMG_SIZE = 640
BATCH = 8
# Absolute output path so results always land inside this project's ai-model/
# folder, regardless of any global YOLO "runs_dir" setting on the machine.
PROJECT_DIR = str(HERE / "outputs" / "training-runs")
RUN_NAME = "empty_shelf_yolov8n_day13"


def build_training_config():
    """Load our dataset config and return (dataset_dir, config_path_to_use).

    The config stores the dataset location as a relative path
    ("../dataset/..."). YOLO resolves relative dataset paths against its own
    internal setting, which can point to the wrong place. To avoid that, we
    turn the path into an absolute one here and save the result to a temporary
    file. The original config in the repo is left unchanged.
    """
    with open(CONFIG_FILE, "r") as f:
        cfg = yaml.safe_load(f)

    # Resolve the dataset root relative to the config file's own folder.
    dataset_dir = (CONFIG_FILE.parent / cfg["path"]).resolve()
    cfg["path"] = str(dataset_dir)

    resolved_path = Path(tempfile.gettempdir()) / "storevision_empty_shelf_resolved.yaml"
    with open(resolved_path, "w") as f:
        yaml.safe_dump(cfg, f, sort_keys=False)

    return dataset_dir, str(resolved_path)


def main():
    # 1. Make sure the config file exists before doing anything.
    if not CONFIG_FILE.exists():
        print(f"ERROR: config file not found: {CONFIG_FILE}")
        print("Expected 'storevision_empty_shelf.yaml' inside the ai-model/ folder.")
        sys.exit(1)

    dataset_dir, training_config = build_training_config()

    # 2. Make sure the dataset itself is present locally.
    if not dataset_dir.exists():
        print(f"ERROR: dataset folder not found: {dataset_dir}")
        print("Download the dataset first (see dataset/ROBOFLOW_DATASET_SOURCE.md).")
        sys.exit(1)

    print("=" * 60)
    print("StoreVision AI - Empty Shelf detection training")
    print(f"  dataset : {dataset_dir}")
    print(f"  model   : {BASE_MODEL}")
    print(f"  epochs  : {EPOCHS} | imgsz: {IMG_SIZE} | batch: {BATCH}")
    print(f"  output  : {PROJECT_DIR}/{RUN_NAME}")
    print("=" * 60)
    print("Starting training... this can take a while.\n")

    # 3. Load the base model and train.
    model = YOLO(BASE_MODEL)
    model.train(
        data=training_config,
        epochs=EPOCHS,
        imgsz=IMG_SIZE,
        batch=BATCH,
        project=PROJECT_DIR,
        name=RUN_NAME,
    )

    print("\n" + "=" * 60)
    print("Training complete.")
    print(f"Results saved in: {PROJECT_DIR}/{RUN_NAME}")
    print("=" * 60)


if __name__ == "__main__":
    main()
