from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.detection_logic import generate_alerts
from app.detection_data import (
    detected_products_normal,
    detected_products_missing,
    detected_products_wrong
)

app = FastAPI(title="StoreVision AI Backend")

#  CORS CONFIG
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

#  PRODUCT DATA
products = [
    {"id": 1, "name": "Lays", "category": "Snacks", "slot": "A1", "expiry_date": "2026-07-20", "status": "available"},
    {"id": 2, "name": "Oreo", "category": "Biscuits", "slot": "A2", "expiry_date": "2026-08-10", "status": "available"},
    {"id": 3, "name": "Coke", "category": "Drinks", "slot": "A3", "expiry_date": "2026-09-01", "status": "available"},
    {"id": 4, "name": "Maggi", "category": "Noodles", "slot": "A4", "expiry_date": "2026-08-25", "status": "available"},
    {"id": 5, "name": "Dairy Milk", "category": "Chocolate", "slot": "A5", "expiry_date": "2026-07-15", "status": "available"},
]

#  EXPECTED SHELF (GROUND TRUTH)
shelf_layout = {
    "A1": "Lays",
    "A2": "Oreo",
    "A3": "Coke",
    "A4": "Maggi",
    "A5": "Dairy Milk"
}

#  ROOT
@app.get("/")
def home():
    return {"message": "StoreVision AI backend is running"}

#  HEALTH CHECK
@app.get("/health")
def health():
    return {"status": "ok"}

#  PRODUCTS API
@app.get("/products")
def get_products():
    return {
        "total_products": len(products),
        "products": products
    }

#  SHELF LAYOUT API
@app.get("/shelf-layout")
def get_shelf():
    return shelf_layout

#  ALERTS (MAIN API - DAY 6 CORE)
@app.get("/alerts")
def get_alerts():
    alerts = generate_alerts(detected_products_missing)

    return {
        "total_alerts": len(alerts),
        "alerts": alerts
    }

#  TEST ROUTES (VERY USEFUL FOR DEBUGGING)

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