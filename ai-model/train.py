from ultralytics import YOLO


def main():
    model = YOLO("yolov8n.pt")

    model.train(
        data="dataset/labelled-data/roboflow-empty-shelf/data.yaml",
        epochs=20,
        imgsz=640
    )


if __name__ == "__main__":
    main()