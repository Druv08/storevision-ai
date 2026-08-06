from pathlib import Path
import sys


AI_MODEL_PATH = (
    Path(__file__)
    .resolve()
    .parents[2]
    / "ai-model"
)

sys.path.append(str(AI_MODEL_PATH))

try:
    from inference import run_inference
except Exception:
    import importlib.util
    import os

    inference_path = os.path.join(str(AI_MODEL_PATH), "inference.py")
    spec = importlib.util.spec_from_file_location("inference", inference_path)
    inference = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(inference)
    run_inference = inference.run_inference

def detect_empty_shelf(image_path):

    result = run_inference(image_path)

    empty_spaces = []

    for detection in result["detections"]:

        if (
            detection["class"] == "Empty-space"
            and detection["confidence"] >= 0.40
        ):
            empty_spaces.append(detection)


    return {
        "detection_count": len(empty_spaces),
        "issue_detected": len(empty_spaces) > 0,
        "detections": empty_spaces
    }

def convert_ai_to_shelf_data(ai_result):

    shelf_status = {
        "A1": "Lays",
        "A2": "Oreo",
        "A3": "Coke",
        "A4": "Maggi",
        "A5": "Dairy Milk"
    }


    for detection in ai_result["detections"]:

        x1, y1, x2, y2 = detection["box"]

        center_x = (x1 + x2) / 2


        if center_x < 100:
            slot = "A1"

        elif center_x < 200:
            slot = "A2"

        elif center_x < 300:
            slot = "A3"

        elif center_x < 400:
            slot = "A4"

        else:
            slot = "A5"


        shelf_status[slot] = None


    return shelf_status