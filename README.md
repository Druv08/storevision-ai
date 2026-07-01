# StoreVision AI

An AI-based smart retail monitoring system that watches store shelves and flags problems in real time.

## Description

StoreVision AI analyzes shelf data to keep retail displays accurate and well-stocked. It detects missing shelf items, wrong product placement, expired products, near-expiry products, items kept on shelves too long, and suspicious product movement — helping store staff act before issues affect customers.

## Current Status

**Day 10 — stable MVP (backend + frontend, static data).** The alert engine, API, and dashboard are all working end-to-end on demo data. AI model training begins Day 11.

- ✅ FastAPI backend with product data, shelf layout, and alert engine
- ✅ React + Vite dashboard connected to the backend
- ✅ All 5 alert types working from real logic (no fake/test data)
- ⬜ YOLO object detection model (Day 11 onward)
- ⬜ Real camera / image input (upcoming)

## Features

- **Missing item detection** — identify empty or under-stocked shelf slots.
- **Wrong placement detection** — flag products that are not in their assigned slot.
- **Expired product detection** — surface products past their expiry date.
- **Near-expiry detection** — warn about products expiring within 7 days.
- **Old stock / dwell-time monitoring** — detect items kept on a shelf too long.
- **Suspicious movement detection** — spot unusual product movement (planned).

## Tech Stack

- **Backend:** FastAPI, Uvicorn
- **Frontend:** React, Vite
- **AI / Computer Vision (upcoming):** Python, PyTorch, Ultralytics (YOLO), OpenCV, NumPy
- **Data:** static demo data now; raw + labelled images for model training later

## Project Structure

```
storevision-ai/
├── ai-model/                 # Training + inference code (Day 11 onward)
│   ├── train.py
│   ├── detect.py
│   └── requirements.txt
├── backend/                  # FastAPI service
│   ├── app/
│   │   ├── main.py           # App, routes, product + shelf data
│   │   ├── data.py           # Demo product + shelf data
│   │   ├── shelf.py          # Shelf layout (source of truth)
│   │   ├── detection_data.py # Simulated detection scenarios
│   │   └── detection_logic.py# Alert generation logic
│   └── requirements.txt
├── frontend/                 # React + Vite dashboard
│   └── src/
│       ├── App.jsx           # Dashboard UI
│       └── components/
├── dataset/
│   ├── raw-images/
│   └── labelled-data/
├── demo/                     # Demo assets
└── README.md
```

## Getting Started

### 1. Backend (FastAPI)

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload
```

API available at `http://127.0.0.1:8000`.

### 2. Frontend (React + Vite)

```bash
cd frontend
npm install
npm run dev
```

Dashboard available at `http://localhost:5173` (or the next free port).

> **Note (Windows + antivirus/proxy):** if `npm install` fails with
> `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, run it once as
> `NODE_OPTIONS="--use-system-ca" npm install` so Node trusts your
> system certificate store. This keeps TLS verification enabled.

## API Routes

| Method | Route             | Description                                  |
|--------|-------------------|----------------------------------------------|
| GET    | `/`               | Backend running message                      |
| GET    | `/health`         | Health / status check                        |
| GET    | `/products`       | List of demo products                        |
| GET    | `/shelf-layout`   | Expected product for each shelf slot         |
| GET    | `/alerts`         | Live alerts from the detection engine        |
| GET    | `/alerts/normal`  | Debug: alerts for a normal shelf             |
| GET    | `/alerts/missing` | Debug: alerts for a missing-item scenario    |
| GET    | `/alerts/wrong`   | Debug: alerts for a wrong-placement scenario |
| GET    | `/docs`           | Interactive Swagger API docs                 |

## Alert Types

| Type              | Severity | Trigger                                  |
|-------------------|----------|------------------------------------------|
| `missing_item`    | high     | Expected product not detected in a slot  |
| `wrong_placement` | medium   | A different product is in the slot       |
| `expired_product` | critical | Product past its expiry date             |
| `near_expiry`     | low      | Product expires within 7 days            |
| `old_stock`       | low      | Product on shelf longer than 10 days     |

## Next Steps (Day 11 onward)

1. Collect and organize a dataset of shelf/product images.
2. Label the images for the 5 demo products.
3. Train a YOLO object detection model.
4. Replace the simulated detection data with real model output.
5. Feed detections into the existing alert engine.
