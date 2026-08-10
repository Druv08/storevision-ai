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