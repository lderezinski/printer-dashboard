# Copyright (C) 2026 Flashforge Health contributors
# SPDX-License-Identifier: AGPL-3.0-only
"""Bounded, read-only capture from Flashforge's integrated MJPEG cameras."""
import ipaddress
import json
import time
import urllib.request

import cv2
import numpy as np


def capture_flashforge(root, printer_id, opener=None):
    if printer_id not in ('ad5m', 'a5mp', 'c5', 'c5p'):
        raise ValueError('Unsupported integrated camera')
    host = json.loads((root / 'data' / 'printers.json').read_text())[printer_id]['host']
    address = ipaddress.IPv4Address(host)
    if not address.is_private or address.is_loopback or address.is_link_local:
        raise ValueError('Camera must use a private LAN address')
    opener = opener or urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(f'http://{address}:8080/?action=stream', timeout=4) as response:
        data = b''
        deadline = time.monotonic() + 6
        while time.monotonic() < deadline and len(data) < 2_000_000:
            chunk = response.read(4096)
            if not chunk:
                break
            data += chunk
            start = data.find(b'\xff\xd8')
            end = data.find(b'\xff\xd9', start + 2)
            if start >= 0 and end > start:
                jpeg = data[start:end + 2]
                image = cv2.imdecode(np.frombuffer(jpeg, dtype=np.uint8), cv2.IMREAD_COLOR)
                if image is None:
                    raise ValueError('Invalid camera image')
                return image, jpeg, int(time.time() * 1000)
    raise ValueError('No complete camera image')
