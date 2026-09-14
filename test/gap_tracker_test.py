"""Synthetic gap, travel and occlusion tests; not live failure validation."""
import sys
from pathlib import Path
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import numpy as np
from gap_tracker import GapTracker, DARK_CHESS_RULE


class GapTests(unittest.TestCase):
    def setUp(self):
        rng=np.random.default_rng(22)
        self.textures={k:rng.integers(30,210,(17,17,3),dtype=np.uint8) for k in ('nozzle','top','anchor')}
        self.points={'nozzle':(300,200),'top':(300,205),'anchor':(60,60)}
        self.tracker=GapTracker(self.frame(),self.points)

    def frame(self,part_shift=0,nozzle_x=0,nozzle_y=0,anchor_shift=0,missing=None):
        image=np.full((480,640,3),25,dtype=np.uint8)
        for key,(x,y) in self.points.items():
            if key==missing:continue
            if key=='nozzle':x+=nozzle_x;y+=nozzle_y-9
            if key=='top':y+=part_shift+9
            if key=='anchor':y+=anchor_shift
            image[y-8:y+9,x-8:x+9]=self.textures[key]
        return image

    def test_gap_widens_as_part_drops(self):
        for shift in (0,3,8,15):
            result=self.tracker.measure(self.frame(part_shift=shift))
            self.assertEqual(result['state'],'measured')
            self.assertEqual(result['gapPx'],5+shift)

    def test_nozzle_motion_and_hidden_edges_are_not_measurements(self):
        for image in [self.frame(nozzle_x=20),self.frame(nozzle_y=-12),self.frame(missing='top'),self.frame(missing='nozzle')]:
            self.assertEqual(self.tracker.measure(image)['state'],'unknown')

    def test_camera_motion_and_ambiguous_part_are_unknown(self):
        self.assertEqual(self.tracker.measure(self.frame(anchor_shift=4))['state'],'unknown')
        image=self.frame();image[245:262,292:309]=self.textures['top']
        self.assertEqual(self.tracker.measure(image)['state'],'unknown')

    def test_contact_patches_do_not_both_follow_the_nozzle(self):
        # Moving the part independently must not leave an artificial constant gap.
        result=self.tracker.measure(self.frame(part_shift=25))
        self.assertEqual(result['gapPx'],30)

class DarkChessTests(GapTests):
    def setUp(self):
        super().setUp()
        rng=np.random.default_rng(19)
        head=rng.integers(180,245,(17,17,1),dtype=np.uint8)
        part=rng.integers(30,90,(17,17,1),dtype=np.uint8)
        self.textures['nozzle']=np.repeat(head,3,axis=2)
        self.textures['top']=np.repeat(part,3,axis=2)
        # Bright silk streaks do not turn the whole black part into a light part.
        self.textures['top'][:,::4]=230
        self.tracker=GapTracker(self.frame(),{**self.points,'rule':DARK_CHESS_RULE})

    def test_gap_widens_as_part_drops(self):
        for shift in (0,2,4,15):
            result=self.tracker.measure(self.frame(part_shift=shift))
            self.assertEqual(result['state'],'measured')
            self.assertEqual(result['gapPx'],shift)
            self.assertEqual(result['rule'],DARK_CHESS_RULE)

    def test_contact_patches_do_not_both_follow_the_nozzle(self):
        self.assertEqual(self.tracker.measure(self.frame(part_shift=25))['gapPx'],25)

    def test_other_colors_cannot_use_dark_chess_reference(self):
        self.textures['top']=self.textures['nozzle'].copy()
        with self.assertRaisesRegex(ValueError,'silk-black'):
            GapTracker(self.frame(),{**self.points,'rule':DARK_CHESS_RULE})

    def test_good_real_reference_has_no_open_gap(self):
        import cv2
        source=Path(__file__).parent/'fixtures'/'a5mp-dark-chess-healthy.jpg'
        image=cv2.imread(str(source))
        tracker=GapTracker(image,{'nozzle':[350,148],'top':[350,158],
                                  'anchor':[90,122],'rule':DARK_CHESS_RULE})
        result=tracker.measure(image)
        self.assertEqual(result['state'],'measured')
        self.assertEqual(result['gapPx'],0)

if __name__=='__main__':unittest.main()
