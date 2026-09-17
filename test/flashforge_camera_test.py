"""Integrated-camera routing and bounded capture, with no network requests."""
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from flashforge_camera import capture_flashforge


class IntegratedCameraTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'data').mkdir()
        self.config = self.root / 'data' / 'printers.json'
        self.config.write_text(json.dumps({'ad5m': {'host': '192.168.50.101'},
                                           'c5': {'host': '192.168.50.103'},
                                           'a5mp': {'host': '192.168.50.102'},
                                           'c5p': {'host': '192.168.50.104'}}))
        ok, encoded = cv2.imencode('.jpg', np.full((48, 64, 3), 120, dtype=np.uint8))
        assert ok
        self.jpeg = encoded.tobytes()

    def test_c5p_uses_its_integrated_camera_without_tapo_credentials(self):
        opener = Mock()
        stream = io.BytesIO(b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + self.jpeg)
        opener.open.return_value = stream
        image, jpeg, captured_at = capture_flashforge(self.root, 'c5p', opener)
        opener.open.assert_called_once_with('http://192.168.50.104:8080/?action=stream', timeout=4)
        self.assertEqual(image.shape, (48, 64, 3))
        self.assertEqual(jpeg, self.jpeg)
        self.assertGreater(captured_at, 0)
        self.assertTrue(stream.closed)

    def test_incomplete_invalid_and_oversized_streams_fail(self):
        for content in [b'no image', b'\xff\xd8broken\xff\xd9', b'x' * 2_010_000]:
            opener = Mock()
            opener.open.return_value = io.BytesIO(content)
            with self.assertRaises(ValueError):
                capture_flashforge(self.root, 'c5p', opener)
            self.assertTrue(opener.open.return_value.closed)

    def test_rejects_non_lan_hosts_and_unsupported_printers_before_connecting(self):
        opener = Mock()
        for host in ['8.8.8.8', '127.0.0.1', '169.254.1.2', 'example.com']:
            self.config.write_text(json.dumps({'c5p': {'host': host}}))
            with self.assertRaises(ValueError):
                capture_flashforge(self.root, 'c5p', opener)
        with self.assertRaises(ValueError):
            capture_flashforge(self.root, '../data', opener)
        opener.open.assert_not_called()

    def test_all_printers_route_to_their_own_internal_camera(self):
        for id, host in [('ad5m', '192.168.50.101'), ('a5mp', '192.168.50.102'),
                         ('c5', '192.168.50.103'), ('c5p', '192.168.50.104')]:
            with self.subTest(printer=id):
                opener = Mock()
                opener.open.return_value = io.BytesIO(self.jpeg)
                capture_flashforge(self.root, id, opener)
                opener.open.assert_called_once_with(f'http://{host}:8080/?action=stream', timeout=4)

    def test_changed_printer_address_is_used_on_the_next_capture(self):
        self.config.write_text(json.dumps({'ad5m': {'host': '192.168.1.9'}}))
        opener = Mock()
        opener.open.return_value = io.BytesIO(self.jpeg)
        capture_flashforge(self.root, 'ad5m', opener)
        opener.open.assert_called_once_with('http://192.168.1.9:8080/?action=stream', timeout=4)


if __name__ == '__main__':
    unittest.main()
