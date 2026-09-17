"""Install a pinned, checksum-verified scanner into ignored local data only."""
import hashlib
import io
from pathlib import Path
import platform
import tarfile
import urllib.request

VERSION = '8.30.1'
CHECKSUMS = {
    'darwin_arm64': 'b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5',
    'darwin_x64': 'dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709',
    'linux_arm64': 'e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080',
    'linux_x64': '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb',
}
arch = {'arm64': 'arm64', 'aarch64': 'arm64', 'x86_64': 'x64', 'AMD64': 'x64'}.get(platform.machine())
target = f'{platform.system().lower()}_{arch}'
if target not in CHECKSUMS:
    raise SystemExit('Unsupported platform. Install Gitleaks and set GITLEAKS_BIN to its path.')
url = f'https://github.com/gitleaks/gitleaks/releases/download/v{VERSION}/gitleaks_{VERSION}_{target}.tar.gz'
with urllib.request.urlopen(url, timeout=60) as response:
    archive = response.read()
if hashlib.sha256(archive).hexdigest() != CHECKSUMS[target]:
    raise SystemExit('Scanner checksum mismatch; installation refused.')
destination = Path(__file__).resolve().parent.parent / 'data' / 'security-tools' / 'gitleaks'
destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
with tarfile.open(fileobj=io.BytesIO(archive), mode='r:gz') as tar:
    # Extract only the expected binary, never archive paths or symlinks.
    member = tar.getmember('gitleaks')
    if not member.isfile():
        raise SystemExit('Invalid scanner archive.')
    destination.write_bytes(tar.extractfile(member).read())
destination.chmod(0o700)
print(f'Installed checksum-verified Gitleaks {VERSION} in data/security-tools.')
