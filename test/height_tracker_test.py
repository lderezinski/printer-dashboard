# Copyright (C) 2026 Flashforge Health contributors
# SPDX-License-Identifier: AGPL-3.0-only
"""Synthetic geometry/occlusion checks; not real-world failure validation."""
import sys
from pathlib import Path
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import numpy as np
from height_tracker import HeightTracker


class HeightTests(unittest.TestCase):
    def setUp(self):
        self.rng = np.random.default_rng(22)
        self.textures = {key:self.rng.integers(30,210,(25,25,3),dtype=np.uint8) for key in ('bed','top','anchor')}
        self.points = {'bed':(200,300),'top':(200,275),'anchor':(60,60)}
        self.c = {**self.points,'scaleBottom':(400,300),'scaleTop':(400,200),'scaleMm':20,'referenceExpectedMm':5}
        self.tracker = HeightTracker(self.frame(),self.c)

    def frame(self, bed_shift=0, top_shift=0, anchor_shift=0, omit=None):
        image = np.full((480,640,3),25,dtype=np.uint8)
        for key,(x,y) in self.points.items():
            if key == omit: continue
            y += {'bed':bed_shift,'top':top_shift,'anchor':anchor_shift}[key]
            image[y-12:y+13,x-12:x+13] = self.textures[key]
        return image

    def test_growing_print(self):
        result = self.tracker.measure(self.frame(bed_shift=25),10)
        self.assertEqual(result['state'],'measured')
        self.assertEqual(result['heightMm'],10)

    def test_stalled_print_moves_down_with_bed(self):
        result = self.tracker.measure(self.frame(bed_shift=25,top_shift=25),10)
        self.assertEqual(result['state'],'measured')
        self.assertEqual(result['heightMm'],5)

    def test_missing_features_are_unknown(self):
        for feature in self.points:
            with self.subTest(feature=feature):
                self.assertEqual(self.tracker.measure(self.frame(omit=feature),5)['state'],'unknown')

    def test_camera_movement_and_range_are_unknown(self):
        self.assertEqual(self.tracker.measure(self.frame(anchor_shift=5),5)['state'],'unknown')
        self.assertEqual(self.tracker.measure(self.frame(),21)['state'],'unknown')
        self.assertEqual(self.tracker.measure(self.frame()[:400],5)['state'],'unknown')

    def test_ambiguous_top_cannot_be_selected(self):
        image = self.frame()
        image[238:263,188:213] = self.textures['top']
        self.assertEqual(self.tracker.measure(image,5)['state'],'unknown')

    def test_untextured_reference_rejected(self):
        with self.assertRaises(ValueError):
            HeightTracker(np.zeros((480,640,3),dtype=np.uint8),self.c)


if __name__ == '__main__':
    unittest.main()
