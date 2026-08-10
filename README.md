# StoreVision AI

An AI-based smart retail monitoring system that watches store shelves and flags problems in real time.

## Description

StoreVision AI watches store shelves with computer vision. It detects empty shelf space with a trained YOLO model and compares each camera scan against a saved reference layout to flag areas that look missing, moved, or changed — helping store staff act before issues affect customers.

## Current Status

**Day 14 — first empty-shelf model trained.** A YOLOv8n model was trained
(20 epochs) on the empty-shelf dataset and successfully detects empty shelf
spaces on test images. Model weights, training outputs, and dataset files stay
local and Git-ignored. The backend + frontend MVP remains stable.

- ✅ FastAPI backend with YOLO empty-shelf detection (`/detect`)
- ✅ React + Vite frontend with live camera monitoring
- ✅ Reference-image change detection (missing / moved / changed areas)
- ✅ Dataset structure + collection plan ready ([dataset/DATASET_PLAN.md](dataset/DATASET_PLAN.md))
- ✅ First labelled dataset added locally ([dataset/ROBOFLOW_DATASET_SOURCE.md](dataset/ROBOFLOW_DATASET_SOURCE.md))
- ✅ YOLO config + training/detection scripts prepared ([ai-model/](ai-model/))
- ✅ First empty-shelf model trained + detection tested (local)
- ⬜ Real camera / image input tuning (ongoing)

### Day 14

- Ran the first full YOLOv8n training for empty shelf detection.
- Verified that the trained model produced `best.pt` locally.
- Tested the trained model on a sample test image.
- Confirmed that training outputs, model weights, and dataset files remain ignored from GitHub.

Final training metrics (20 epochs, empty-shelf validation set):

| Metric    | Value |
| --------- | ----- |
| Precision | 0.607 |
| Recall    | 0.542 |
| mAP50     | 0.575 |
| mAP50-95  | 0.245 |

### Day 13

- Inspected the Roboflow empty shelf dataset.
- Confirmed the dataset class: `Empty-space`.
- Added a project-level YOLO config file for training.
- Prepared the YOLO training script.
- Prepared the YOLO detection test script.
- Updated model-output ignore rules to avoid committing model weights and training outputs.

## Features

- **Empty-shelf detection** — a YOLO model locates empty / under-stocked space on the shelf.
- **Reference-image change detection** — save a reference photo of the correct layout, then flag areas that look missing, moved, or changed on later scans.
- **Live camera monitoring** — scan continuously from a phone or webcam.

## Tech Stack

- **Backend:** FastAPI, Uvicorn
- **Frontend:** React, Vite
- **AI / Computer Vision:** Python, PyTorch, Ultralytics (YOLO), OpenCV, NumPy
- **Data:** raw + labelled shelf images for model training (local, Git-ignored)

## Project Structure

```
storevision-ai/
├── ai-model/                 # Training + inference code (Day 11 onward)
│   ├── train.py
│   ├── detect.py
│   └── requirements.txt
├── backend/                  # FastAPI service
│   ├── app/
│   │   ├── main.py               # App + routes (health, empty-shelf /detect)
│   │   ├── detection_service.py  # YOLO empty-shelf detection
│   │   └── ai_service.py         # Inference helper
│   └── requirements.txt
├── frontend/                 # React + Vite app
│   └── src/
│       ├── App.jsx           # App UI
│       └── components/       # Live camera monitor, etc.
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

App available at `http://localhost:5173` (or the next free port).

> **Note (Windows + antivirus/proxy):** if `npm install` fails with
> `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, run it once as
> `NODE_OPTIONS="--use-system-ca" npm install` so Node trusts your
> system certificate store. This keeps TLS verification enabled.

## API Routes

| Method | Route      | Description                                |
| ------ | ---------- | ------------------------------------------ |
| GET    | `/`        | Backend running message                    |
| GET    | `/health`  | Health / status check                      |
| POST   | `/detect`  | Empty-shelf detection on an uploaded image |
| GET    | `/docs`    | Interactive Swagger API docs               |

## Next Steps

1. Expand the labelled dataset and retrain for better empty-shelf accuracy.
2. Tune the reference-image change detection on real shelves.
3. Improve live camera capture and mobile UX.
