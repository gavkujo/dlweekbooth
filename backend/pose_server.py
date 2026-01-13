import base64
import time
from typing import Any, Dict, Optional

import cv2
import numpy as np
from flask import Flask, jsonify, request
from flask_cors import CORS
import mediapipe as mp

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

try:
    mp_pose = mp.solutions.pose
except AttributeError as exc:
    raise RuntimeError(
        "The installed mediapipe distribution only exposes the Tasks API. "
        "Install a solutions-enabled build via 'pip install mediapipe==0.10.8' "
        "(or mediapipe-silicon==0.9.1 on Apple Silicon) inside this virtualenv."
    ) from exc
pose = mp_pose.Pose(
    model_complexity=1,
    enable_segmentation=False,
    smooth_landmarks=True,
    min_detection_confidence=0.5,
    min_tracking_confidence=0.5
)

UPPER_BODY_LANDMARKS = {11, 12, 13, 14, 15, 16}
TOTAL_LANDMARKS = 33


def _decode_image(data_url: str) -> Optional[np.ndarray]:
    if not data_url:
        return None
    try:
        encoded = data_url.split(',', 1)[-1]
        image_bytes = base64.b64decode(encoded)
        frame = cv2.imdecode(np.frombuffer(image_bytes, np.uint8), cv2.IMREAD_COLOR)
        return frame
    except (ValueError, cv2.error):
        return None


def _landmark_payload(idx: int, landmark: Any) -> Dict[str, Any]:
    return {
        "index": idx,
        "x": float(landmark.x),
        "y": float(landmark.y),
        "z": float(landmark.z),
        "visibility": float(landmark.visibility)
    }


@app.post('/detect-pose')
def detect_pose() -> Any:
    payload = request.get_json(silent=True) or {}
    frame = _decode_image(payload.get('image'))

    if frame is None:
        return jsonify({"error": "Invalid frame"}), 400

    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    results = pose.process(rgb_frame)

    if not results.pose_landmarks:
        return jsonify({
            "landmarks": [],
            "confidence": 0.0,
            "fullBodyVisible": False,
            "upperBodyVisible": False,
            "coverage": {"widthRatio": 0.0, "heightRatio": 0.0, "crowded": False},
            "timestamp": time.time()
        })

    visible_points = []
    upper_visible = 0

    for idx, landmark in enumerate(results.pose_landmarks.landmark):
        if landmark.visibility > 0.5:
            visible_points.append((idx, landmark))
            if idx in UPPER_BODY_LANDMARKS:
                upper_visible += 1

    width_ratio = 0.0
    height_ratio = 0.0
    crowded = False

    if visible_points:
        xs = [landmark.x for _, landmark in visible_points]
        ys = [landmark.y for _, landmark in visible_points]
        width_ratio = max(xs) - min(xs)
        height_ratio = max(ys) - min(ys)

        # Heuristic: if the detected body is very wide but short, likely multiple people close to camera.
        crowded = width_ratio > 0.75 and height_ratio < 0.35

    confidence = min(1.0, len(visible_points) / (TOTAL_LANDMARKS * 0.6))
    full_body_visible = height_ratio > 0.55 and len(visible_points) >= 18
    upper_body_visible = upper_visible >= 6

    landmarks = [
        _landmark_payload(idx, landmark)
        for idx, landmark in enumerate(results.pose_landmarks.landmark)
    ]

    return jsonify({
        "landmarks": landmarks,
        "confidence": confidence,
        "fullBodyVisible": full_body_visible,
        "upperBodyVisible": upper_body_visible,
        "coverage": {
            "widthRatio": width_ratio,
            "heightRatio": height_ratio,
            "crowded": crowded
        },
        "timestamp": time.time()
    })


if __name__ == '__main__':
    import os

    port = int(os.environ.get('POSE_SERVER_PORT', '5002'))
    app.run(host='0.0.0.0', port=port, debug=False)
