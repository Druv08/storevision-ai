# StoreVision AI

An AI-based smart retail monitoring system that watches store shelves and flags problems in real time.

## Description

StoreVision AI analyzes shelf imagery to keep retail displays accurate and well-stocked. It detects missing shelf items, wrong product placement, expired products, items kept on shelves too long, and suspicious product movement — helping store staff act before issues affect customers.

## Features

- **Missing item detection** — identify empty or under-stocked shelf spots.
- **Wrong placement detection** — flag products that are not in their assigned location.
- **Expired product detection** — surface products past their expiry date.
- **Dwell-time monitoring** — detect items that have stayed on a shelf too long.
- **Suspicious movement detection** — spot unusual product movement patterns.

## Tech Stack

- **AI / Computer Vision:** Python, PyTorch, Ultralytics (YOLO), OpenCV, NumPy
- **Backend:** FastAPI, Uvicorn
- **Frontend:** (to be added)
- **Dataset:** raw images and labelled data for model training

## Project Structure

```
storevision-ai/
├── ai-model/          # Training and inference code
│   ├── train.py
│   ├── detect.py
│   └── requirements.txt
├── backend/           # FastAPI service
│   ├── app/
│   │   └── main.py
│   └── requirements.txt
├── frontend/          # UI (to be added)
├── dataset/
│   ├── raw-images/
│   └── labelled-data/
├── demo/              # Demo assets
└── README.md
```

## Getting Started

### Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload
```

The API will be available at `http://127.0.0.1:8000` with routes:

- `GET /` — health message
- `GET /health` — status check
