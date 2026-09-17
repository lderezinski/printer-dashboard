# Copyright (C) 2026 Flashforge Health contributors
# SPDX-License-Identifier: AGPL-3.0-only
"""Conservative, calibrated landmark tracker for a fixed side-view camera.

Tracks an exposed bed texture, the part's upper edge, and a fixed frame feature.
Ambiguous, occluded, or missing landmarks are unknown, never zero height.
"""
import cv2
import numpy as np


def patch(image, point, radius=12):
    x, y = (int(round(v)) for v in point)
    if x-radius < 0 or y-radius < 0 or x+radius >= image.shape[1] or y+radius >= image.shape[0]:
        raise ValueError('Choose landmarks away from the image border.')
    return image[y-radius:y+radius+1, x-radius:x+radius+1].copy()


def locate(gray, template, origin, up, along_min, along_max, side_limit):
    """Template matching with geometric constraints and a uniqueness check."""
    radius = template.shape[0] // 2
    if float(template.std()) < 6:
        return None, 'The selected landmark has too little texture.'
    scores = cv2.matchTemplate(gray, template, cv2.TM_CCOEFF_NORMED)
    yy, xx = np.indices(scores.shape)
    dx, dy = xx+radius-origin[0], yy+radius-origin[1]
    along = dx*up[0] + dy*up[1]
    across = dx*up[1] - dy*up[0]
    valid = (along >= along_min) & (along <= along_max) & (np.abs(across) <= side_limit)
    scores[~valid] = -1
    _, best, _, pos = cv2.minMaxLoc(scores)
    if best < .82:
        return None, 'A landmark is hidden or its appearance has changed.'
    x, y = pos
    competitors = scores.copy()
    competitors[max(0,y-7):y+8, max(0,x-7):x+8] = -1
    if best - float(competitors.max()) < .045:
        return None, 'Several image features look alike; the height is ambiguous.'
    return (np.array([x+radius, y+radius], dtype=float), float(best)), None


class HeightTracker:
    def __init__(self, reference, calibration):
        self.c = calibration
        self.shape = reference.shape[:2]
        self.gray = cv2.cvtColor(reference, cv2.COLOR_BGR2GRAY)
        self.points = {k: np.array(calibration[k], dtype=float) for k in ('bed', 'top', 'anchor')}
        vector = np.array(calibration['scaleTop']) - np.array(calibration['scaleBottom'])
        distance = float(np.linalg.norm(vector))
        if distance < 12 or calibration['scaleMm'] < 5:
            raise ValueError('Use a reference at least 5 mm tall and 12 pixels apart.')
        self.ppm = distance / calibration['scaleMm']
        if not .5 <= self.ppm <= 30:
            raise ValueError('The camera scale is outside the supported range.')
        self.up = vector / distance
        self.templates = {k: patch(self.gray, p) for k, p in self.points.items()}
        if any(float(t.std()) < 6 for t in self.templates.values()):
            raise ValueError('Each landmark needs a distinct, textured feature.')
        self.reference_height = float(np.dot(self.points['top']-self.points['bed'], self.up)/self.ppm)
        if self.reference_height < -1:
            raise ValueError('The top landmark must be above the bed landmark.')

    def measure(self, image, expected_height):
        unknown = lambda reason: {'state': 'unknown', 'reason': reason}
        if image.shape[:2] != self.shape:
            return unknown('Camera resolution changed. Recalibrate.')
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        anchor, error = locate(gray, self.templates['anchor'], self.points['anchor'], self.up, -15, 15, 15)
        if error:
            return unknown('The fixed camera reference is not visible. Recalibrate if the camera moved.')
        if np.linalg.norm(anchor[0]-self.points['anchor']) > 2.5:
            return unknown('Camera movement detected. Recalibrate before using height readings.')
        delta = expected_height - self.c['referenceExpectedMm']
        # A short calibrated range bounds perspective errors. Never extrapolate
        # a local pixel scale throughout the full 220 mm build volume.
        if abs(delta) > 15:
            return unknown('Print moved beyond the 15 mm calibration range. Refresh the landmarks.')
        travel = -delta*self.ppm
        bed, error = locate(gray, self.templates['bed'], self.points['bed'], self.up, travel-4*self.ppm, travel+4*self.ppm, 12)
        if error:
            return unknown('Bed reference unavailable: '+error)
        # The successful top stays close to the nozzle's fixed Z plane; a
        # stopped extrusion surface descends with the moving bed.
        top, error = locate(gray, self.templates['top'], self.points['top'], self.up,
                            min(travel, 0)-5*self.ppm, max(travel, 0)+5*self.ppm, 12)
        if error:
            return unknown('Print surface unavailable: '+error)
        target = patch(image, top[0])
        if np.mean(np.min(target, axis=2) > 240) > .25:
            return unknown('Glare or the printhead obscures the selected surface.')
        height = float(np.dot(top[0]-bed[0], self.up)/self.ppm)
        if height < -1 or height > expected_height+3:
            return unknown('The tracked edge is inconsistent with the bed or expected height.')
        uncertainty = max(1.0, 2/self.ppm + abs(height)*.05)
        return {'state': 'measured', 'heightMm': round(max(0, height), 3),
                'uncertaintyMm': round(uncertainty, 3),
                'confidence': round(min(anchor[1], bed[1], top[1]), 3),
                'bed': bed[0].tolist(), 'top': top[0].tolist(),
                'reason': 'Tracking the calibrated upper-edge landmark.'}


def annotate(image, measurement):
    if measurement.get('state') != 'measured':
        return image
    result = image.copy()
    bed, top = [tuple(int(round(v)) for v in measurement[k]) for k in ('bed', 'top')]
    cv2.line(result, bed, top, (0, 210, 255), 2)
    for point, label in [(bed, 'Bed'), (top, 'Tracked top')]:
        cv2.circle(result, point, 5, (0, 210, 255), 2)
        cv2.putText(result, label, (point[0]+8, max(18,point[1]-5)), cv2.FONT_HERSHEY_SIMPLEX, .45, (0,210,255), 1)
    return result


if __name__ == '__main__':
    import json
    import sys
    try:
        reference = cv2.imread(sys.argv[1])
        calibration = json.loads(sys.argv[2])
        tracker = HeightTracker(reference, calibration)
        check = tracker.measure(reference, calibration['referenceExpectedMm'])
        if check['state'] != 'measured':
            raise ValueError(check['reason'])
        print(json.dumps({'valid': True}))
    except Exception as error:
        print(json.dumps({'valid': False, 'error': str(error) if isinstance(error, ValueError) else 'The reference image could not be validated.'}))
