"""Experimental image-space gap tracking at a repeatable camera pose."""
import json
import sys
import cv2
import numpy as np
from height_tracker import patch, locate

DARK_CHESS_RULE = 'light-head-dark-chess-v1'


def light_head_dark_part(image, head, top):
    """Check the two tracked surfaces, without classifying the gap background.

    The lower part quantile tolerates the bright streaks on silk-black plastic.
    Brightness is camera-specific; these checks are only for this print profile.
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    light = float(np.median(patch(gray, head + np.array([0., -9.]), 8)))
    dark = float(np.percentile(patch(gray, top + np.array([0., 9.]), 8), 35))
    return light >= 140 and dark <= 140 and light - dark >= 55


class GapTracker:
    def __init__(self, reference, config):
        if reference is None:
            raise ValueError('Reference image unavailable.')
        self.shape = reference.shape[:2]
        self.points = {k: np.array(config[k], dtype=float) for k in ('nozzle', 'top', 'anchor')}
        self.dark_chess = config.get('rule') == DARK_CHESS_RULE
        self.contact_gap = float(self.points['top'][1] - self.points['nozzle'][1])
        # Keep the nozzle patch above its tip and the part patch below its edge.
        # Overlapping contact patches could otherwise both follow the toolhead.
        self.offsets = {'nozzle':np.array([0.,-9.]), 'top':np.array([0.,9.]), 'anchor':np.array([0.,0.])}
        self.origins = {k:p+self.offsets[k] for k,p in self.points.items()}
        self.gray = cv2.cvtColor(reference, cv2.COLOR_BGR2GRAY)
        self.templates = {k: patch(self.gray, point, 8) for k, point in self.origins.items()}
        if any(float(t.std()) < 6 for t in self.templates.values()):
            raise ValueError('Choose visible, distinct edges for the nozzle, part and fixed frame.')
        if abs(self.points['nozzle'][0]-self.points['top'][0]) > 20:
            raise ValueError('Choose the part surface directly beneath the nozzle in this view.')
        if not -3 <= self.points['top'][1]-self.points['nozzle'][1] <= 100:
            raise ValueError('The part edge must be just below the visible nozzle tip.')
        if self.dark_chess:
            if not 0 <= self.contact_gap <= 15:
                raise ValueError('Use a healthy close-contact view of the light-gray head and dark chess piece.')
            if not light_head_dark_part(reference, self.points['nozzle'], self.points['top']):
                raise ValueError('Mark the light-gray head edge and the silk-black piece directly below it.')

    def measure(self, image):
        unknown = lambda message: {'state':'unknown', 'reason':message}
        if image.shape[:2] != self.shape:
            return unknown('Camera size changed. Mark a fresh reference.')
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        up = np.array([0., -1.])
        anchor, error = locate(gray, self.templates['anchor'], self.points['anchor'], up, -12, 12, 12)
        if error or np.linalg.norm(anchor[0]-self.points['anchor']) > 2:
            return unknown('Fixed frame feature changed or camera moved. Mark a fresh reference.')
        # Only compare similar nozzle poses; XY travel changes perspective.
        nozzle, error = locate(gray, self.templates['nozzle'], self.origins['nozzle'], up, -5, 5, 5)
        if error:
            return unknown('Waiting for a clear light-gray head view at the reference position.' if self.dark_chess else 'Waiting for a clear nozzle view at the reference position.')
        top, error = locate(gray, self.templates['top'], self.origins['top'], up, -100, 8, 5)
        if error:
            return unknown('Part edge is hidden or changed. Gap cannot be measured.')
        nozzle = (nozzle[0]-self.offsets['nozzle'],nozzle[1])
        top = (top[0]-self.offsets['top'],top[1])
        if abs(top[0][0]-nozzle[0][0]) > 20:
            return unknown('Nozzle is not above the selected part edge.')
        gap = float(top[0][1]-nozzle[0][1])
        if gap < -3 or gap > 100:
            return unknown('Nozzle and part edge are not comparable in this image.')
        if self.dark_chess and not light_head_dark_part(image, nozzle[0], top[0]):
            return unknown('The light-gray head or silk-black chess piece is not clearly visible.')
        if not self.dark_chess and np.mean(np.min(patch(image, nozzle[0], 8), axis=2) > 245) > .4:
            return unknown('Glare obscures the nozzle tip.')
        # The housing sits above the extrusion point even during a healthy print.
        # Subtract that known-good spacing, rather than flagging the housing offset.
        visible_gap = max(0, gap - self.contact_gap) if self.dark_chess else max(0, gap)
        return {'state':'measured', 'gapPx':round(visible_gap,2),
                'separationPx':round(max(0,gap),2),
                'rule':DARK_CHESS_RULE if self.dark_chess else 'landmark-gap',
                'confidence':round(min(anchor[1],nozzle[1],top[1]),3),
                'nozzle':nozzle[0].tolist(), 'top':top[0].tolist(),
                'reason':'Light-gray head to dark chess piece, relative to healthy contact.' if self.dark_chess else 'Visible gap at a comparable nozzle position.'}


def annotate(image, measurement):
    result = image.copy()
    if measurement.get('state') != 'measured':
        return result
    a,b = [tuple(int(round(v)) for v in measurement[key]) for key in ('nozzle','top')]
    cv2.line(result,a,b,(0,210,255),2)
    labels = ('Light head', 'Dark piece') if measurement.get('rule') == DARK_CHESS_RULE else ('Nozzle', 'Part edge')
    for p,label in zip((a,b),labels):
        cv2.circle(result,p,4,(0,210,255),1)
        cv2.putText(result,label,(p[0]+7,p[1]-5),cv2.FONT_HERSHEY_SIMPLEX,.4,(0,210,255),1)
    return result


if __name__ == '__main__':
    try:
        image = cv2.imread(sys.argv[1])
        tracker = GapTracker(image,json.loads(sys.argv[2]))
        measurement = tracker.measure(image)
        if measurement['state'] != 'measured':
            raise ValueError(measurement['reason'])
        print(json.dumps({'valid':True}))
    except Exception as error:
        print(json.dumps({'valid':False,'error':str(error) if isinstance(error,ValueError) else 'Reference could not be checked.'}))
