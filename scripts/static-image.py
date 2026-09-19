# Copyright (C) 2026 Flashforge Health contributors
# SPDX-License-Identifier: AGPL-3.0-only
"""Resize an already annotated camera JPEG for public export; never run detection."""
import sys
import cv2
import numpy as np


def optimize(jpeg):
    image = cv2.imdecode(np.frombuffer(jpeg, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError('Invalid camera image')
    height, width = image.shape[:2]
    if width > 640:
        image = cv2.resize(image, (640, max(1, round(height * 640 / width))), interpolation=cv2.INTER_AREA)
    ok, encoded = cv2.imencode('.webp', image, [cv2.IMWRITE_WEBP_QUALITY, 65])
    if not ok:
        raise ValueError('Cannot encode public image')
    return encoded.tobytes()


if __name__ == '__main__':
    cv2.setNumThreads(1)
    source = sys.stdin.buffer.read(4_000_001)
    if len(source) > 4_000_000:
        raise ValueError('Camera image is too large')
    sys.stdout.buffer.write(optimize(source))
