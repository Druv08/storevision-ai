import os
import tempfile
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from PIL import Image

from app.detection_logic import (
    generate_alerts,
    generate_all_alerts
)

from app.detection_data import (
    detected_products_missing,
    detected_products_wrong,
    detected_products_normal
)

from app.detection_service import run_empty_shelf_detection

app = FastAPI(title="StoreVision AI Backend")

# Annotated result images are saved here and served at /results/<filename>.
# The folder is inside backend/outputs/ which is Git-ignored.
ANNOTATED_DIR = Path(__file__).resolve().parents[1] / "outputs" / "annotated"
ANNOTATED_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/results", StaticFiles(directory=str(ANNOTATED_DIR)), name="results")

# ----------------------------
# CORS
# ----------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
        "http://localhost:5175",
        "http://127.0.0.1:5175",
        "http://localhost:5176",
        "http://127.0.0.1:5176",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ----------------------------
# PRODUCT DATA
# ----------------------------
products = [
    {"id": 1, "name": "Lays", "category": "Snacks", "slot": "A1", "expiry_date": "2026-08-20", "stock_entry_date": "2026-06-01", "status": "available"},
    {"id": 2, "name": "Oreo", "category": "Biscuits", "slot": "A2", "expiry_date": "2026-08-10", "stock_entry_date": "2026-06-28", "status": "available"},
    {"id": 3, "name": "Coke", "category": "Drinks", "slot": "A3", "expiry_date": "2026-07-06", "stock_entry_date": "2026-06-28", "status": "available"},
    {"id": 4, "name": "Maggi", "category": "Noodles", "slot": "A4", "expiry_date": "2026-08-25", "stock_entry_date": "2026-06-28", "status": "available"},
    {"id": 5, "name": "Dairy Milk", "category": "Chocolate", "slot": "A5", "expiry_date": "2026-06-25", "stock_entry_date": "2026-06-28", "status": "available"},
]

# ----------------------------
# SHELF TRUTH
# ----------------------------
shelf_layout = {
    "A1": "Lays",
    "A2": "Oreo",
    "A3": "Coke",
    "A4": "Maggi",
    "A5": "Dairy Milk"
}

# ----------------------------
# ROUTES
# ----------------------------
@app.get("/")
def home():
    return {"message": "StoreVision AI backend is running"}

@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/products")
def get_products():
    return {
        "total_products": len(products),
        "products": products
    }

@app.get("/shelf-layout")
def get_shelf():
    return shelf_layout

# ----------------------------
# EMPTY-SHELF DETECTION (image upload)
# ----------------------------
@app.post("/detect")
async def detect(file: UploadFile = File(...)):
    # Only accept image uploads.
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Uploaded file must be an image.")

    # Save the upload to a temporary file, run detection, then clean up.
    suffix = os.path.splitext(file.filename or "")[1] or ".jpg"
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(await file.read())
            tmp_path = tmp.name

        result = run_empty_shelf_detection(tmp_path)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Detection failed: {exc}")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)

    message = (
        "Empty shelf space detected"
        if result["issue_detected"]
        else "No empty shelf space detected"
    )
    return {
        "filename": file.filename,
        "detection_count": result["detection_count"],
        "issue_detected": result["issue_detected"],
        "detections": result["detections"],
        "message": message,
    }

# ----------------------------
# DASHBOARD IMAGE ANALYSIS (upload -> AI detection -> shelf status -> alerts)
# ----------------------------
# Detections at or above this confidence are trusted enough to mark a shelf
# slot as empty when mapping boxes to slots.
SLOT_CONFIDENCE = 0.40


def map_detections_to_shelf(detections, image_width):
    """Map empty-space boxes to shelf slots A1-A5 by horizontal position."""
    slots = list(shelf_layout.keys())          # ["A1", ..., "A5"]
    shelf_status = dict(shelf_layout)          # start with expected products
    band = image_width / len(slots)            # each slot covers one vertical band

    for det in detections:
        if det["confidence"] < SLOT_CONFIDENCE:
            continue
        center_x = (det["box"]["x1"] + det["box"]["x2"]) / 2
        index = min(len(slots) - 1, int(center_x // band))
        shelf_status[slots[index]] = None      # None = slot looks empty

    return shelf_status


@app.post("/upload-image")
async def upload_image(file: UploadFile = File(...)):
    # Only accept image uploads.
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Uploaded file must be an image.")

    suffix = os.path.splitext(file.filename or "")[1] or ".jpg"
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(await file.read())
            tmp_path = tmp.name

        result = run_empty_shelf_detection(tmp_path, annotate_dir=str(ANNOTATED_DIR))
        image_width = Image.open(tmp_path).size[0]
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Detection failed: {exc}")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)

    # Turn the detections into real shelf status + alerts.
    shelf_status = map_detections_to_shelf(result["detections"], image_width)
    alerts = generate_all_alerts(shelf_status, products)

    # Shape the detections the way the dashboard expects (box as [x1,y1,x2,y2]).
    detections = [
        {
            "class": d["class_name"],
            "confidence": d["confidence"],
            "box": [d["box"]["x1"], d["box"]["y1"], d["box"]["x2"], d["box"]["y2"]],
        }
        for d in result["detections"]
    ]

    annotated_image = (
        f"results/{result['annotated_file']}" if result["annotated_file"] else None
    )

    return {
        "filename": file.filename,
        "ai_detection": {
            "detection_count": result["detection_count"],
            "issue_detected": result["issue_detected"],
            "detections": detections,
            "annotated_image": annotated_image,
        },
        "shelf_status": shelf_status,
        "total_alerts": len(alerts),
        "alerts": alerts,
    }


# ----------------------------
# MAIN ALERT ENGINE
# ----------------------------
@app.get("/alerts")
def get_alerts():
    all_alerts = generate_all_alerts(detected_products_missing, products)

    return {
        "total_alerts": len(all_alerts),
        "alerts": all_alerts
    }

# ----------------------------
# SMART SUGGESTIONS
# ----------------------------
PRIORITY_RANK = {"High": 0, "Medium": 1, "Low": 2}


def build_suggestion(alert):
    """Turn one alert into a store suggestion with a priority and an action."""
    alert_type = alert.get("type")
    slot = alert.get("slot", "?")

    if alert_type == "missing_item":
        product = alert.get("expected", "Unknown")
        return {
            "priority": "High",
            "product": product,
            "issue": "Missing item",
            "action": f"Restock {product} in shelf {slot} immediately",
        }
    if alert_type == "expired_product":
        product = alert.get("product", "Unknown")
        return {
            "priority": "High",
            "product": product,
            "issue": "Expired product",
            "action": f"Remove expired {product} from shelf {slot}",
        }
    if alert_type == "near_expiry":
        product = alert.get("product", "Unknown")
        return {
            "priority": "Medium",
            "product": product,
            "issue": "Near expiry",
            "action": f"Move {product} to the front shelf or apply a discount",
        }
    if alert_type == "wrong_placement":
        product = alert.get("detected", "Unknown")
        return {
            "priority": "Medium",
            "product": product,
            "issue": "Wrong placement",
            "action": f"Move {product} out of slot {slot} back to its own slot",
        }
    if alert_type == "old_stock":
        product = alert.get("product", "Unknown")
        return {
            "priority": "Low",
            "product": product,
            "issue": "Old stock",
            "action": f"Review stock age of {product} in shelf {slot}",
        }
    return None


@app.get("/smart-suggestions")
def smart_suggestions():
    all_alerts = generate_all_alerts(detected_products_missing, products)

    suggestions = []
    for alert in all_alerts:
        suggestion = build_suggestion(alert)
        if suggestion:
            suggestions.append(suggestion)

    # Most urgent first: High, then Medium, then Low.
    suggestions.sort(key=lambda s: PRIORITY_RANK[s["priority"]])

    return {
        "total_suggestions": len(suggestions),
        "suggestions": suggestions,
    }


# ----------------------------
# DEBUG ROUTES
# ----------------------------
@app.get("/alerts/normal")
def alerts_normal():
    return {
        "mode": "normal",
        "alerts": generate_alerts(detected_products_normal)
    }

@app.get("/alerts/missing")
def alerts_missing():
    return {
        "mode": "missing",
        "alerts": generate_alerts(detected_products_missing)
    }

@app.get("/alerts/wrong")
def alerts_wrong():
    return {
        "mode": "wrong",
        "alerts": generate_alerts(detected_products_wrong)
    }