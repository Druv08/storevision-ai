from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.ai_service import (
    detect_empty_shelf as ai_detect_empty_shelf,
    convert_ai_to_shelf_data
)

from app.detection_service import run_empty_shelf_detection

from app.detection_logic import (
    generate_alerts,
    generate_all_alerts
)

from app.detection_data import (
    detected_products_missing,
    detected_products_wrong,
    detected_products_normal
)

import shutil
import os
import tempfile
from pathlib import Path

app = FastAPI(title="StoreVision AI Backend")
app.mount(
    "/results",
    StaticFiles(directory="runs/detect"),
    name="results"
)

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
        "http://localhost:8001",      
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ALLOWED_IMAGE_EXTENSIONS = {
    ".jpg",
    ".jpeg",
    ".png",
    ".webp"
}


def is_valid_image_upload(file: UploadFile) -> bool:
    extension = Path(
        file.filename or ""
    ).suffix.lower()

    if extension not in ALLOWED_IMAGE_EXTENSIONS:
        return False

    if file.content_type and file.content_type.startswith("image/"):
        return True

    return True

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
# MAIN ALERT ENGINE
# ----------------------------
@app.get("/alerts")
def get_alerts():

    image_path = (
        "../dataset/labelled-data/roboflow-empty-shelf/test/images/test_468_jpg.rf.e43ddaf2a66e5f24b54b78c94387efee.jpg"
    )

    ai_result = ai_detect_empty_shelf(image_path)

    shelf_data = convert_ai_to_shelf_data(ai_result)

    all_alerts = generate_all_alerts(
        shelf_data,
        products
    )

    return {
        "ai_detection": ai_result,
        "shelf_status": shelf_data,
        "total_alerts": len(all_alerts),
        "alerts": all_alerts
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

@app.get("/detect-test")
def detect_test():

    image_path = (
        "../dataset/labelled-data/roboflow-empty-shelf/test/images/test_468_jpg.rf.e43ddaf2a66e5f24b54b78c94387efee.jpg"
    )

    result = ai_detect_empty_shelf(image_path)

    return result

@app.post("/upload-image")
async def upload_image(file: UploadFile = File(...)):
    upload_dir = Path("uploads")

    upload_dir.mkdir(
        parents=True,
        exist_ok=True
    )

    upload_path = Path("uploads") / file.filename

    with open(upload_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    ai_result = ai_detect_empty_shelf(str(upload_path))

    shelf_data = convert_ai_to_shelf_data(ai_result)

    alerts = generate_all_alerts(
        shelf_data,
        products
    )

    return {
        "filename": file.filename,
        "ai_detection": ai_result,
        "shelf_status": shelf_data,
        "total_alerts": len(alerts),
        "alerts": alerts
    }

@app.post("/detect")
async def detect_endpoint(
    file: UploadFile = File(...)
):

    if not is_valid_image_upload(file):
        raise HTTPException(
            status_code=400,
            detail="Invalid image file"
        )

    suffix = Path(
        file.filename or ""
    ).suffix.lower()

    temp_file_path = None
    try:
        with tempfile.NamedTemporaryFile(
            delete=False,
            suffix=suffix
        ) as temp_file:


            temp_file_path = temp_file.name

            content = await file.read()

            temp_file.write(content)



        result = run_empty_shelf_detection(
            temp_file_path
        )


        return {
            "filename": file.filename,
            "detection_count": result["detection_count"],
            "issue_detected": result["issue_detected"],
            "detections": result["detections"],
            "annotated_image": result["annotated_image"]

        }


    except FileNotFoundError as error:

        raise HTTPException(
            status_code=500,
            detail=str(error)
        )


    except Exception as error:

        raise HTTPException(
            status_code=500,
            detail=f"Detection failed: {str(error)}"
        )


    finally:

        if temp_file_path and os.path.exists(temp_file_path):

            os.remove(temp_file_path)