from fastapi import FastAPI

app = FastAPI(title="StoreVision AI", version="0.1.0")


@app.get("/")
def root():
    return {"message": "StoreVision AI backend is running"}


@app.get("/health")
def health():
    return {"status": "ok"}
