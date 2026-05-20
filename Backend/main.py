"""
ASL Real-time Backend — FastAPI
รับภาพ base64 จาก frontend → MediaPipe → Model predict → ส่งผลกลับ

วิธีใช้:
    pip install fastapi uvicorn python-multipart mediapipe opencv-python tensorflow numpy
    python main.py
"""

import json
import pickle
import base64
import numpy as np
import cv2
import mediapipe as mp
import tensorflow as tf
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ──────────────────────────────────────────────
# CONFIG — แก้ path ให้ตรงกับเครื่อง
# ──────────────────────────────────────────────
MODEL_PATH    = "./asl_model_output/asl_model.keras"
LABEL_MAP_PATH = "./asl_model_output/label_map.json"

# ──────────────────────────────────────────────
# LOAD MODEL & LABELS
# ──────────────────────────────────────────────
print("Loading model...")
model = tf.keras.models.load_model(MODEL_PATH)

with open(LABEL_MAP_PATH) as f:
    label_map = {int(k): v for k, v in json.load(f).items()}

print(f"Model loaded — {len(label_map)} classes: {list(label_map.values())}")

# ──────────────────────────────────────────────
# MEDIAPIPE
# ──────────────────────────────────────────────
mp_hands = mp.solutions.hands.Hands(
    static_image_mode=False,
    max_num_hands=1,
    min_detection_confidence=0.6,
    min_tracking_confidence=0.5,
)

# ──────────────────────────────────────────────
# APP
# ──────────────────────────────────────────────
app = FastAPI(title="ASL Prediction API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # Vite default port
    allow_methods=["*"],
    allow_headers=["*"],
)

class ImagePayload(BaseModel):
    image: str  # base64 encoded image (data:image/jpeg;base64,...)


def extract_landmarks(frame: np.ndarray):
    """
    รับ BGR frame → return normalized landmarks array (63,) หรือ None
    """
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    result = mp_hands.process(rgb)

    if not result.multi_hand_landmarks:
        return None

    lm = result.multi_hand_landmarks[0].landmark
    row = [v for p in lm for v in (p.x, p.y, p.z)]

    # Normalize: wrist เป็น origin (เหมือนตอน train)
    wx, wy, wz = row[0], row[1], row[2]
    normalized = []
    for i in range(0, 63, 3):
        normalized.extend([row[i]-wx, row[i+1]-wy, row[i+2]-wz])

    return np.array(normalized, dtype=np.float32)


@app.post("/predict")
async def predict(payload: ImagePayload):
    # แปลง base64 → numpy array
    try:
        header, encoded = payload.image.split(",", 1)
        img_bytes = base64.b64decode(encoded)
        img_array = np.frombuffer(img_bytes, dtype=np.uint8)
        frame = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
    except Exception as e:
        return {"error": f"Image decode failed: {e}"}

    if frame is None:
        return {"error": "Invalid image"}

    # Extract landmarks
    landmarks = extract_landmarks(frame)
    if landmarks is None:
        return {"detected": False, "letter": None, "confidence": 0}

    # Predict
    inp = landmarks.reshape(1, -1)
    probs = model.predict(inp, verbose=0)[0]
    idx = int(probs.argmax())
    confidence = float(probs[idx])
    letter = label_map[idx]

    # Top 3 predictions
    top3_idx = probs.argsort()[-3:][::-1]
    top3 = [{"letter": label_map[int(i)], "confidence": float(probs[i])} for i in top3_idx]

    return {
        "detected": True,
        "letter": letter,
        "confidence": round(confidence, 4),
        "top3": top3,
    }


@app.get("/health")
async def health():
    return {"status": "ok", "classes": len(label_map)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)