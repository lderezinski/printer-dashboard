"""Read-only A5MP built-in camera capture and local height analysis."""
import base64
import ipaddress
import json
import re
import time
import urllib.request

import cv2
import numpy as np
from height_tracker import HeightTracker, annotate


class HeightCamera:
    def __init__(self, root):
        self.root = root
        self.tracker = None
        self.calibration_id = None

    def capture(self, context):
        result = {'heightCapturedAt': int(time.time()*1000),
                  'heightMeasurement': {'state': 'unknown', 'reason': 'Built-in camera unavailable. Retrying.'}}
        try:
            host = json.loads((self.root/'data'/'printers.json').read_text())['a5mp']['host']
            address = ipaddress.IPv4Address(host)
            if not address.is_private or address.is_loopback or address.is_link_local:
                return result
            # Ignore environment HTTP proxies for this private camera.
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with opener.open(f'http://{address}:8080/?action=stream', timeout=4) as response:
                data = b''
                complete = False
                deadline = time.monotonic()+6
                while time.monotonic() < deadline and len(data) < 2_000_000:
                    chunk = response.read(4096)
                    if not chunk:
                        break
                    data += chunk
                    start = data.find(b'\xff\xd8')
                    end = data.find(b'\xff\xd9', start+2)
                    if start >= 0 and end > start:
                        data = data[start:end+2]
                        complete = True
                        break
                else:
                    return result
                if not complete:
                    return result
            img = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
            if img is None:
                return result
            result.update(heightCapturedAt=int(time.time()*1000), heightWidth=img.shape[1], heightHeight=img.shape[0],
                          heightReferenceJpeg=base64.b64encode(data).decode(), heightJpeg=base64.b64encode(data).decode())
            if not context:
                result['heightMeasurement'] = {'state': 'unknown', 'reason': 'Set the scale and landmarks to start height checks.'}
                return result
            if context['calibrationId'] != self.calibration_id:
                config = json.loads((self.root/'data'/'height-a5mp.json').read_text())
                if config['id'] != context['calibrationId'] or config['jobKey'] != context['jobKey']:
                    return result
                if not re.fullmatch(r'height-reference-[a-f0-9-]{36}\.jpg', config['referenceFile']):
                    return result
                reference = cv2.imread(str(self.root/'data'/config['referenceFile']))
                self.tracker = HeightTracker(reference, config)
                self.calibration_id = config['id']
            measurement = self.tracker.measure(img, context['expectedMm'])
            result['heightMeasurement'] = measurement
            ok, jpeg = cv2.imencode('.jpg', annotate(img, measurement), [cv2.IMWRITE_JPEG_QUALITY, 90])
            if ok:
                result['heightJpeg'] = base64.b64encode(jpeg).decode()
        except Exception:
            result['heightMeasurement'] = {'state': 'unknown', 'reason': 'Height view or landmarks unavailable. Check the camera and calibration.'}
        return result
