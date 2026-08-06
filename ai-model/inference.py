from ultralytics import YOLO
import cv2
import os

from pathlib import Path

MODEL_PATH = r"..\runs\detect\train-5\weights\best.pt"
print("Loading model from:", MODEL_PATH)
model = YOLO(MODEL_PATH)


def run_inference(image_path):

    results = model(image_path)

    img = cv2.imread(image_path)

    detections = []


    for result in results:

        boxes = result.boxes

        for box in boxes:

            x1, y1, x2, y2 = map(int, box.xyxy[0])

            conf = float(box.conf[0])

            cls = int(box.cls[0])

            class_name = model.names[cls]


            detections.append(
                {
                    "class": class_name,
                    "confidence": round(conf, 2),
                    "box": [x1, y1, x2, y2]
                }
            )


            cv2.rectangle(
                img,
                (x1, y1),
                (x2, y2),
                (0,255,0),
                2
            )


    output_dir = "outputs/inference"

    os.makedirs(output_dir, exist_ok=True)


    output_path = os.path.join(
        output_dir,
        "result.jpg"
    )


    cv2.imwrite(output_path, img)


    return {
        "image": image_path,
        "detections": detections,
        "output": output_path
    }