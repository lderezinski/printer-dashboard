"""Independent close-up sampler; no Obico inference or printer commands."""
import base64
import json
from pathlib import Path
import re
import sys
import cv2
import numpy as np
from height_capture import HeightCamera
from gap_tracker import GapTracker, annotate

root = Path(__file__).resolve().parent
camera = HeightCamera(root)
tracker, tracker_id = None, None
print(json.dumps({'type':'ready'}),flush=True)
for line in sys.stdin:
    request = json.loads(line)
    if request.get('type') != 'capture':
        continue
    result = camera.capture(None)
    result['heightMeasurement'] = {'state':'unknown','reason':'Waiting for a clear close-up.'}
    context = request.get('gapContext')
    if context and result.get('heightReferenceJpeg'):
        try:
            if context['calibrationId'] != tracker_id:
                config = json.loads((root/'data'/'gap-a5mp.json').read_text())
                if config['id'] != context['calibrationId'] or config['jobKey'] != context['jobKey']:
                    raise ValueError('Print changed')
                if not re.fullmatch(r'gap-reference-[a-f0-9-]{36}\.jpg',config['referenceFile']):
                    raise ValueError('Reference invalid')
                tracker = GapTracker(cv2.imread(str(root/'data'/config['referenceFile'])),config)
                tracker_id = config['id']
            image = cv2.imdecode(np.frombuffer(base64.b64decode(result['heightReferenceJpeg']),dtype=np.uint8),cv2.IMREAD_COLOR)
            measurement = tracker.measure(image)
            result['heightMeasurement'] = measurement
            ok,jpeg = cv2.imencode('.jpg',annotate(image,measurement),[cv2.IMWRITE_JPEG_QUALITY,90])
            if ok:
                result['heightJpeg'] = base64.b64encode(jpeg).decode()
        except Exception:
            result['heightMeasurement'] = {'state':'unknown','reason':'Gap reference unavailable. Mark the nozzle and part again.'}
    print(json.dumps({**result,'type':'result','id':request['id']},allow_nan=False),flush=True)
