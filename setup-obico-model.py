# Copyright (C) 2026 Flashforge Health contributors
# SPDX-License-Identifier: AGPL-3.0-only
"""Download the pinned official Obico ONNX model; no camera/account access."""
import hashlib
import os
from pathlib import Path
import urllib.request

URL = 'https://tsd-pub-static.s3.amazonaws.com/ml-models/model-weights-5a6b1be1fa.onnx'
SHA256 = '0a6ebd8e30dbf6a450c50f9c0a5406f04ba7eb1c99fd5996e888c78bb383b9aa'
target = Path(__file__).resolve().parent / 'data' / 'obico-model' / 'model.onnx'
target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() == SHA256:
    print('Obico model already installed and verified.')
else:
    temporary = target.with_suffix('.download')
    try:
        digest = hashlib.sha256()
        with urllib.request.urlopen(URL, timeout=60) as source, temporary.open('wb') as dest:
            while chunk := source.read(1024 * 1024):
                digest.update(chunk)
                dest.write(chunk)
        if digest.hexdigest() != SHA256:
            raise ValueError('Model checksum does not match the pinned release.')
        os.replace(temporary, target)
        print('Obico model installed and verified.')
    finally:
        temporary.unlink(missing_ok=True)
