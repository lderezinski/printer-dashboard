# Copyright (C) 2026 Flashforge Health contributors
# SPDX-License-Identifier: AGPL-3.0-only
"""Private IPC helper. Read-only Flash Studio session bootstrap; never run in a terminal.
The parent captures stdout in memory. No credentials are written to disk or browser APIs.
"""
import ctypes as C
import json
import sys
import uuid
from pathlib import Path


def main():
    if sys.stdout.isatty():
        raise RuntimeError('This helper must be started by the dashboard.')
    settings = Path.home() / 'Library/Application Support/Orca-Flashforge/Orca-Flashforge.conf'
    app = json.loads(settings.read_text())['app']
    token = app.get('access_token')
    if not token:
        raise RuntimeError('Sign in to Flash Studio on this Mac, then reconnect cloud.')
    base = Path('/Applications/Flash Studio.app/Contents')
    lib = C.CDLL(str(base / 'MacOS/libFlashNetwork.dylib'))
    class Log(C.Structure):
        _fields_ = [('directory', C.c_char_p), ('hours', C.c_int), ('level', C.c_int)]
    lib.fnet_initlize.argtypes = [C.c_char_p, C.POINTER(Log)]
    lib.fnet_doBusGetRequest.argtypes = [C.c_char_p, C.c_char_p, C.c_char_p, C.c_char_p, C.POINTER(C.c_void_p), C.c_int]
    lib.fnet_freeString.argtypes = [C.c_void_p]
    lib.fnet_getBusComUrl.restype = C.c_char_p
    if lib.fnet_initlize(str(base / 'Resources/data/FLASHNETWORK9.DAT').encode(), C.byref(Log(None, 1, 0))):
        raise RuntimeError('Could not initialize Flash Studio networking.')
    try:
        # Pin the verified service before sending the existing account token.
        if lib.fnet_getBusComUrl() != b'https://api.voxelshare.com':
            raise RuntimeError('Flash Studio cloud endpoint changed; connection needs updating.')
        client = ('health_' + uuid.uuid4().hex).encode()
        def get(target):
            result = C.c_void_p()
            code = lib.fnet_doBusGetRequest(client, token.encode(), b'en', target.encode(), C.byref(result), 8000)
            try:
                if code == 2001:
                    raise RuntimeError('Flash Studio session expired. Sign in there, then reconnect cloud.')
                if code or not result.value:
                    raise RuntimeError('Flashforge cloud could not be reached. Retrying shortly.')
                return json.loads(C.string_at(result))
            finally:
                if result.value:
                    lib.fnet_freeString(result)
        cloud = get('/api/v2/external/truck/device/mqtt/config')
        listed = get('/api/v2/external/truck/device/list')
        if listed.get('next'):
            raise RuntimeError('Cloud returned a paginated device list; automatic pairing is unavailable.')
        # Device registry only. Cached REST status is deliberately not used as live data.
        models = ['Adventurer 5M', 'Adventurer 5M Pro', 'Creator 5', 'Creator 5 Pro']
        devices = [{k: d.get(k) for k in ['model', 'sn', 'deviceID', 'gTopic']} for d in listed.get('detail', []) if d.get('model') in models]
        print(json.dumps({'clientId': client.decode(), 'server': cloud.get('server'), 'username': cloud.get('username'), 'password': cloud.get('password'),
                          'devices': devices, 'userTopic': cloud.get('uTopic')}), flush=True)
    finally:
        lib.fnet_uninitlize()


if __name__ == '__main__':
    try:
        main()
    except RuntimeError as error:
        print(json.dumps({'error': str(error)}), flush=True)
        sys.exit(1)
    except Exception:
        print(json.dumps({'error': 'Could not read the Flash Studio session. Keep Flash Studio installed and signed in on this Mac.'}), flush=True)
        sys.exit(1)
