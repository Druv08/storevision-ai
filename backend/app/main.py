from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.detection_logic import (
    generate_alerts,
    generate_all_alerts
)

from app.detection_data import (
    detected_products_missing,
    detected_products_wrong,
    detected_products_normal
)

app = FastAPI(title="StoreVision AI Backend")

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