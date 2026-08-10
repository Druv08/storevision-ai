import os
import tempfile

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.detection_service import run_empty_shelf_detection

app = FastAPI(title="StoreVision AI Backend")

# ----------------------------
# CORS
# ----------------------------
# Development setup: allow any origin so the frontend also works from HTTPS
# tunnel URLs and phone browsers. No cookies/credentials are used, so the
# wildcard is safe for this local demo. Lock this down for real deployment.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ----------------------------
# ROUTES
# ----------------------------
@app.get("/")
def home():
    return {"message": "StoreVision AI backend is running"}


@app.get("/health")
def health():
    return {"status": "ok"}


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
