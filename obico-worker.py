# Copyright (C) 2026 Flashforge Health contributors
# SPDX-License-Identifier: AGPL-3.0-only
"""Local camera capture and inference using Obico's official ONNX model."""
import base64
import hashlib
import ipaddress
import subprocess
import json
from pathlib import Path
import signal
import sys
import time

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'vendor' / 'obico'))

def emit(value):
    print(json.dumps(value, allow_nan=False), flush=True)

capture_process = None

def stop(*_):
    if capture_process is not None and capture_process.poll() is None:
        capture_process.kill()
        capture_process.wait()
    raise SystemExit(0)

signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)

def main():
    global capture_process
    import imageio_ffmpeg
    import numpy as np
    import cv2
    import onnxruntime as ort
    from lib.onnx import OnnxNet
    from lib.meta import Meta

    printer_id = sys.argv[1] if len(sys.argv) > 1 else 'ad5m'
    if printer_id not in ('ad5m', 'a5mp', 'c5', 'c5p'):
        raise ValueError('Unsupported printer camera')
    source = sys.argv[2] if len(sys.argv) > 2 else 'flashforge-integrated'
    if source not in ('flashforge-integrated', 'tapo-c120'):
        raise ValueError('Unsupported camera source')
    if source == 'tapo-c120':
        config = json.loads((ROOT / 'data' / f'camera-{printer_id}.json').read_text())
        address = ipaddress.IPv4Address(config['host'])
        if not address.is_private or address.is_loopback or address.is_link_local:
            raise ValueError('Camera must use a private LAN IPv4 address')
        # FFmpeg receives the URL directly as an argument, never through a shell.
        # Keep camera credentials out of diagnostics and the dashboard API.
        for key in ('username', 'password'):
            if not isinstance(config[key], str) or any(c in config[key] for c in '@\r\n/'):
                raise ValueError('Unsupported camera account characters')
        url = f"rtsp://{config['username']}:{config['password']}@{address}:554/stream1"
    model = ROOT / 'data' / 'obico-model' / 'model.onnx'
    expected = '0a6ebd8e30dbf6a450c50f9c0a5406f04ba7eb1c99fd5996e888c78bb383b9aa'
    if hashlib.sha256(model.read_bytes()).hexdigest() != expected:
        raise ValueError('Unexpected model checksum')
    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    options.inter_op_num_threads = 1
    net = OnnxNet.__new__(OnnxNet)
    net.session = ort.InferenceSession(str(model), sess_options=options, providers=['CPUExecutionProvider'])
    net.meta = Meta(str(ROOT / 'vendor' / 'obico' / 'model.meta'))
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    from height_capture import HeightCamera
    from flashforge_camera import capture_flashforge
    height_camera = HeightCamera(ROOT) if printer_id == 'a5mp' else None
    emit({'type': 'ready'})
    for line in sys.stdin:
        request = json.loads(line)
        if request.get('type') != 'capture':
            continue
        height_result = height_camera.capture(request['heightContext']) if height_camera and request.get('heightContext') else {}
        try:
            if source == 'flashforge-integrated':
                shared = request.get('referenceFrame')
                if printer_id == 'a5mp' and shared:
                    frame = base64.b64decode(shared['jpeg'], validate=True)
                    img = cv2.imdecode(np.frombuffer(frame, dtype=np.uint8), cv2.IMREAD_COLOR)
                    captured_at = shared['capturedAt']
                    if img is None:
                        raise ValueError('Invalid shared camera image')
                else:
                    img, _, captured_at = capture_flashforge(ROOT, printer_id)
            else:
                capture_process = subprocess.Popen([
                    ffmpeg, '-hide_banner', '-loglevel', 'error', '-rtsp_transport', 'tcp',
                    '-i', url, '-an', '-frames:v', '1', '-vf', 'scale=1280:-2',
                    '-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', '3', 'pipe:1',
                ], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                try:
                    frame, errors = capture_process.communicate(timeout=20)
                except subprocess.TimeoutExpired:
                    capture_process.kill()
                    capture_process.communicate()
                    emit({**height_result, 'type': 'error', 'id': request['id'], 'message': 'Camera timed out. Retrying automatically.'})
                    continue
                if capture_process.returncode != 0:
                    message = 'Camera rejected its login. Check the camera account.' if b'401' in errors else 'Camera feed unavailable. Retrying automatically.'
                    emit({**height_result, 'type': 'error', 'id': request['id'], 'message': message})
                    continue
                captured_at = int(time.time() * 1000)
                img = cv2.imdecode(np.frombuffer(frame, dtype=np.uint8), cv2.IMREAD_COLOR)
                if img is None:
                    raise ValueError('Invalid image')
        except Exception:
            emit({**height_result, 'type': 'error', 'id': request['id'], 'message': 'Internal Flashforge camera unavailable. Check that the camera is installed and enabled. Retrying automatically.' if source == 'flashforge-integrated' else 'C120 camera unavailable. Retrying automatically.'})
            continue
        try:
            started = time.monotonic()
            # Obico's server uses 0.08 for proposals and 0.45 for suppression.
            detections = net.detect(net.meta, img, None, thresh=0.08, nms=0.45)
            inference_ms = round((time.monotonic() - started) * 1000)
            for label, confidence, (xc, yc, w, h) in detections:
                if confidence < 0.3:
                    continue
                x1, y1 = max(0, int(xc-w/2)), max(0, int(yc-h/2))
                x2, y2 = min(img.shape[1]-1, int(xc+w/2)), min(img.shape[0]-1, int(yc+h/2))
                cv2.rectangle(img, (x1, y1), (x2, y2), (0, 180, 255), 2)
                cv2.putText(img, 'Possible spaghetti', (x1, max(20, y1-8)), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 180, 255), 2)
            ok, jpeg = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 85])
            if not ok:
                raise ValueError('Cannot encode image')
            emit({**height_result, 'type': 'result', 'id': request['id'], 'capturedAt': captured_at,
                  'inferenceMs': inference_ms, 'detections': detections,
                  'jpeg': base64.b64encode(jpeg).decode()})
        except Exception:
            emit({**height_result, 'type': 'error', 'id': request['id'], 'message': 'Camera analysis failed. Retrying automatically.'})

if __name__ == '__main__':
    try:
        main()
    except Exception:
        emit({'type': 'fatal', 'message': 'Local detector could not start. Check the Obico installation and private camera configuration.'})
        sys.exit(1)
