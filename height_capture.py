# Copyright (C) 2026 Flashforge Health contributors
# SPDX-License-Identifier: AGPL-3.0-only
"""Read-only A5MP built-in camera capture and local height analysis."""
import base64
import json
import re
import time

import cv2
from height_tracker import HeightTracker, annotate
from flashforge_camera import capture_flashforge


class HeightCamera:
    def __init__(self, root):
        self.root = root
        self.tracker = None
        self.calibration_id = None

    def capture(self, context):
        result = {'heightCapturedAt': int(time.time()*1000),
                  'heightMeasurement': {'state': 'unknown', 'reason': 'Built-in camera unavailable. Retrying.'}}
        try:
            img, data, captured_at = capture_flashforge(self.root, 'a5mp')
            result.update(heightCapturedAt=captured_at, heightWidth=img.shape[1], heightHeight=img.shape[0],
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
