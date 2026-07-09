from ultralytics import YOLO
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent.parent


def main():

    model = YOLO("yolov8s.pt")

    model.train(
        data=str(
            BASE_DIR /
            "dataset" /
            "labelled-data" /
            "roboflow-empty-shelf" /
            "data.yaml"
        ),
        epochs=100,
        imgsz=1024,
        batch=8
    )


if __name__ == "__main__":
    main()