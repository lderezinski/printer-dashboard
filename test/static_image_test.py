# Copyright (C) 2026 Flashforge Health contributors
# SPDX-License-Identifier: AGPL-3.0-only
import importlib.util
from pathlib import Path
import unittest
import cv2
import numpy as np

spec = importlib.util.spec_from_file_location('static_image', Path(__file__).resolve().parents[1] / 'scripts/static-image.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class StaticImageTest(unittest.TestCase):
    def test_webp_preserves_aspect_ratio_and_never_upscales(self):
        for width, height, expected in [(1280, 720, (360, 640)), (640, 480, (480, 640)), (320, 240, (240, 320))]:
            image = np.zeros((height, width, 3), dtype=np.uint8)
            cv2.rectangle(image, (20, 20), (width - 20, height - 20), (0, 255, 0), 3)
            ok, jpeg = cv2.imencode('.jpg', image)
            self.assertTrue(ok)
            webp = module.optimize(jpeg.tobytes())
            self.assertEqual(webp[8:12], b'WEBP')
            decoded = cv2.imdecode(np.frombuffer(webp, dtype=np.uint8), cv2.IMREAD_COLOR)
            self.assertEqual(decoded.shape[:2], expected)
            self.assertLess(len(webp), len(jpeg))

    def test_rejects_non_image_input(self):
        with self.assertRaises(ValueError):
            module.optimize(b'<svg onload="alert(1)"/>')


if __name__ == '__main__':
    unittest.main()
