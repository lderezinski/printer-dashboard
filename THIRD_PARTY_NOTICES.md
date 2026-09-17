# Third-party licenses and review

Reviewed 2026-09-17 against the installed packages, `package-lock.json`, the
Python requirements, and upstream license files. This is a review of the
current source checkout and installed environments, not a guarantee for every
future dependency version, platform, binary bundle, or hosted deployment.

## Project license and scope

Original Flashforge Health source is **AGPL-3.0-only**. Copyright (C) 2026
Flashforge Health contributors. The complete terms are in [LICENSE](LICENSE).
Original documentation, tests, configuration examples, and scripts use the same
license unless another notice applies. Generated printer records and user data
are not relicensed by this declaration. Product names and trademarks belong to
their respective owners.

Third-party files retain their original licenses and attribution. In particular,
the files in `vendor/obico` keep their upstream AGPL notice. Nothing in the root
license grants new rights to model weights, Flashforge binaries, firmware,
third-party print designs, or other externally supplied material.

[licenses/inventory.json](licenses/inventory.json) records package versions,
declared licenses, notice locations, and SHA-256 hashes.
[licenses/third-party.txt](licenses/third-party.txt) preserves collected license
and notice text, including notices for components bundled in Python wheels and
the local Node.js/CPython toolchains. The README retains the author credits.
Package-level license names in the tables are not exhaustive licenses for all
native or vendored components inside each package.

## Findings and remaining questions

| Component | Finding | Consequence |
| --- | --- | --- |
| Original dashboard source | AGPL-3.0-only notices added to source files and package metadata. | Preserve notices; provide corresponding source when distributing covered versions and offer source to remote users of modified network versions as required by section 13. |
| Vendored Obico helpers and model metadata | AGPLv3; all four copied files and the license match the pinned upstream revision byte for byte. | Original upstream license and provenance preserved. |
| npm dependencies | 49 installed package/version entries (48 package names): MIT, ISC, BSD-3-Clause, or 0BSD declarations. | No package-level copyleft incompatibility identified; retain their notices. See the `ipp` notice limitation below. |
| Python runtime and audit environments | 13 camera-environment distributions and 30 audit-tool distributions, overlapping in three packages: 40 distinct package/version entries. | Package-level terms are compatible with this source project subject to notices and applicable copyleft conditions. Native bundled components need build-specific treatment. |
| FFmpeg executable | Installed imageio-ffmpeg executable reports FFmpeg 7.1 with `--enable-gpl`, licensed GPL-2.0-or-later. | Do not describe this binary as merely BSD or LGPL. It is run as a subprocess and is not committed. Binary redistribution requires matching source and notices. |
| Obico ONNX weights | Provenance and checksum verified; explicit weights license not established. | **Unresolved.** Do not claim the weights are AGPL/MIT or cleared for redistribution or commercial deployment. |
| Flashforge networking plugin | Upstream identifies the networking libraries as non-free; this helper loads a locally installed dylib. | **Unresolved.** No redistribution permission or AGPL linking exception was established. The library is not committed or covered by this project's license. |
| Planned TigerTag projects | SDK Apache-2.0; TigerScale V3 and Studio Manager MIT. | Not imported or bundled. Preserve notices and review the exact chosen version before implementation. |
| Parallel-7 protocol documentation | No explicit license found in the inspected repository README or standard license endpoint. | Reference links only. Do not assume permission to copy its prose or code. |

### Obico source

Upstream: [TheSpaghettiDetective/obico-server at the pinned revision](https://github.com/TheSpaghettiDetective/obico-server/tree/49c0bc7001a3fd8d56297fc3032ba287bfe1d50b).
The review compared `ml_api/lib/onnx.py`, `ml_api/lib/meta.py`,
`ml_api/lib/__init__.py`, `ml_api/model/model.meta`, and `LICENSE` with the
local copies. The source files were not modified to add the dashboard's own
copyright. See [vendor/obico/README.md](vendor/obico/README.md).

### Model weights

The pinned [upstream URL file](https://github.com/TheSpaghettiDetective/obico-server/blob/49c0bc7001a3fd8d56297fc3032ba287bfe1d50b/ml_api/model/model-weights.onnx.url)
and [upstream Dockerfile](https://github.com/TheSpaghettiDetective/obico-server/blob/49c0bc7001a3fd8d56297fc3032ba287bfe1d50b/ml_api/Dockerfile)
point to the same external `model-weights-5a6b1be1fa.onnx` downloaded by
`setup-obico-model.py`. Its SHA-256 is
`0a6ebd8e30dbf6a450c50f9c0a5406f04ba7eb1c99fd5996e888c78bb383b9aa`.
The installed model has no license declaration in its description or custom
metadata. No separate weights license was found in the reviewed upstream tree
or README. A repository's source-code license and a third-party mirror's license
label are not sufficient evidence of the original owner's grant for these weights.

The weights remain in ignored `data/obico-model`, downloaded directly from the
upstream host. Existing monitoring was not disabled by this review. Before
redistributing the weights, promising commercial rights, or packaging a service
around them, obtain clarification from Obico covering that exact artifact.

### Flashforge cloud integration

The [official Orca-Flashforge README](https://github.com/FlashForge/Orca-Flashforge/blob/main/README.md#license)
licenses the slicer under AGPLv3 but separately identifies its networking plugin
as based on non-free Flashforge libraries. `cloud-bootstrap.py` uses `ctypes`
to load the user's installed `libFlashNetwork.dylib`; it does not copy that
library into this repository.

Not bundling the library does not by itself settle all licensing questions about
linking to it. No explicit third-party integration grant, redistribution grant,
or applicable AGPL linking exception was verified. Keep the binary out of
releases and obtain permission or a qualified assessment of the adapter before
distributing a combined executable or offering hosted cloud integration.
This project does not invent an exception for Obico's upstream code, and its
AGPL declaration does not override Flashforge's terms.

### Native libraries, runtimes, and security tools

- **FFmpeg:** the BSD-2-Clause license on imageio-ffmpeg covers that Python
  wrapper, not every FFmpeg binary it supplies. The local executable's `-L`
  output identifies GPL-2.0-or-later. Its configure flags include GPL codecs
  such as libx264/libx265 and no `--enable-nonfree` flag. Platform builds can
  differ. If distributing a binary, supply the corresponding source and build
  information for that exact build and its libraries; a link to the latest
  upstream source is not an adequate replacement. See [FFmpeg's legal guidance](https://ffmpeg.org/legal.html).
- **OpenCV:** the Python packaging notice is MIT, while the OpenCV library is
  Apache-2.0. Its supplied third-party notices also cover FFmpeg/LGPL components
  and other libraries. Both notice files are preserved in the notice bundle.
- **NumPy:** BSD-3-Clause at the package level; its wheel notices also cover
  OpenBLAS, LAPACK, GCC runtime components with the GCC Runtime Library
  Exception, and libquadmath under LGPL-2.1-or-later. Preserve those conditions
  and notices if redistributing the wheel or native libraries.
- **ONNX Runtime:** MIT at the package level. Its broad third-party notice file
  includes optional components, including Intel MKL under a restrictive Intel
  license and Eigen under MPL-2.0. A notice's presence does not prove that a
  component is linked into this Mac wheel. No binary-level inclusion audit was
  completed, so binary bundles are **not cleared** by the MIT package label.
- **certifi:** audit-tool dependency under MPL-2.0. Preserve its notices and
  make the covered source available when redistributing it. It is not merged
  into dashboard source. See [Mozilla's MPL FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/).
- **pip and setuptools:** MIT package licenses with separately licensed
  vendored dependencies. Their supplied vendor notices are included in the bundle.
- **Node.js, npm, and CPython:** installed separately, not committed. Node.js
  is MIT with bundled-component notices; npm is Artistic-2.0 with separately
  licensed dependencies; Python uses PSF licensing and historical notices.
  Their local license texts are included for reference. This review does not
  certify a redistributed runtime or every system library supplied by macOS.
- **Gitleaks and the three pinned GitHub Actions:** MIT project licenses
  verified against the selected release/commits. The review does not enumerate
  every dependency built into those external tools or the GitHub runner image.

The `asn1-ber` and `net-snmp` packages put their complete MIT notices in their
README License sections; those sections were collected. `ipp` 1.1.0 declares
MIT in its package metadata and README but supplies no full license notice in
the inspected package. The declaration is preserved; confirm a complete notice
before repackaging that dependency. FlatBuffers 25.12.19 and packageurl-python
0.17.6 omit license text from the installed wheels; their exact upstream release
license files were retrieved and included.

## Before publishing or packaging

For a source release, include `LICENSE`, the README license section,
`THIRD_PARTY_NOTICES.md`, `licenses/`, and the untouched upstream license and
source under `vendor/obico`. Keep local settings, credentials, model weights,
virtual environments, and installed binaries out of Git.

The dashboard footer links to the project source and AGPL terms. Push the
complete corresponding source for the version being shared and ensure its
intended recipients can actually access it; a private or stale repository link
does not satisfy a required source offer. Forks and modified deployments must
update that link to their own complete corresponding source.

For an installer, executable bundle, container image, or hosted service, first
resolve the weights and proprietary plugin questions and review the exact
included native binaries. The notice bundle alone does not fulfill GPL/LGPL
source, relinking, or installation-information obligations. Licenses should be
reviewed again whenever versions, copied code, build flags, or integration
boundaries change. No upstream permissions were requested or presumed by this
review.

Compatibility guidance used: [GNU license compatibility](https://www.gnu.org/licenses/license-compatibility.en.html),
[GNU GPL questions about incompatible libraries](https://www.gnu.org/licenses/gpl-faq.html.en#GPLIncompatibleLibs),
and [the AGPLv3 terms](https://www.gnu.org/licenses/agpl-3.0.html).

## npm dependencies

| Project | Version / pinned revision | Declared license | Scope |
| --- | --- | --- | --- |
| [@babel/runtime](https://www.npmjs.com/package/@babel/runtime/v/7.29.7) | 7.29.7 | MIT | runtime |
| [@types/node](https://www.npmjs.com/package/@types/node/v/22.20.2) | 22.20.2 | MIT | runtime |
| [@types/readable-stream](https://www.npmjs.com/package/@types/readable-stream/v/4.0.24) | 4.0.24 | MIT | runtime |
| [@types/ws](https://www.npmjs.com/package/@types/ws/v/8.18.1) | 8.18.1 | MIT | runtime |
| [abort-controller](https://www.npmjs.com/package/abort-controller/v/3.0.0) | 3.0.0 | MIT | runtime |
| [asn1-ber](https://www.npmjs.com/package/asn1-ber/v/1.2.2) | 1.2.2 | MIT | runtime |
| [base64-js](https://www.npmjs.com/package/base64-js/v/1.5.1) | 1.5.1 | MIT | runtime |
| [bl](https://www.npmjs.com/package/bl/v/6.1.6) | 6.1.6 | MIT | runtime |
| [broker-factory](https://www.npmjs.com/package/broker-factory/v/3.1.15) | 3.1.15 | MIT | runtime |
| [buffer](https://www.npmjs.com/package/buffer/v/6.0.3) | 6.0.3 | MIT | runtime |
| [buffer-from](https://www.npmjs.com/package/buffer-from/v/1.1.2) | 1.1.2 | MIT | runtime |
| [commist](https://www.npmjs.com/package/commist/v/3.2.0) | 3.2.0 | MIT | runtime |
| [concat-stream](https://www.npmjs.com/package/concat-stream/v/2.0.0) | 2.0.0 | MIT | runtime |
| [readable-stream](https://www.npmjs.com/package/readable-stream/v/3.6.2) | 3.6.2 | MIT | runtime |
| [debug](https://www.npmjs.com/package/debug/v/4.4.3) | 4.4.3 | MIT | runtime |
| [event-target-shim](https://www.npmjs.com/package/event-target-shim/v/5.0.1) | 5.0.1 | MIT | runtime |
| [events](https://www.npmjs.com/package/events/v/3.3.0) | 3.3.0 | MIT | runtime |
| [fast-unique-numbers](https://www.npmjs.com/package/fast-unique-numbers/v/9.0.27) | 9.0.27 | MIT | runtime |
| [help-me](https://www.npmjs.com/package/help-me/v/5.0.0) | 5.0.0 | MIT | runtime |
| [ieee754](https://www.npmjs.com/package/ieee754/v/1.2.1) | 1.2.1 | BSD-3-Clause | runtime |
| [inherits](https://www.npmjs.com/package/inherits/v/2.0.4) | 2.0.4 | ISC | runtime |
| [ip-address](https://www.npmjs.com/package/ip-address/v/10.7.0) | 10.7.0 | MIT | runtime |
| [ipp](https://www.npmjs.com/package/ipp/v/1.1.0) | 1.1.0 | MIT | runtime |
| [js-sdsl](https://www.npmjs.com/package/js-sdsl/v/4.3.0) | 4.3.0 | MIT | runtime |
| [lru-cache](https://www.npmjs.com/package/lru-cache/v/10.4.3) | 10.4.3 | ISC | runtime |
| [minimist](https://www.npmjs.com/package/minimist/v/1.2.8) | 1.2.8 | MIT | runtime |
| [mqtt](https://www.npmjs.com/package/mqtt/v/5.15.2) | 5.15.2 | MIT | runtime |
| [mqtt-packet](https://www.npmjs.com/package/mqtt-packet/v/9.0.2) | 9.0.2 | MIT | runtime |
| [ms](https://www.npmjs.com/package/ms/v/2.1.3) | 2.1.3 | MIT | runtime |
| [net-snmp](https://www.npmjs.com/package/net-snmp/v/3.29.1) | 3.29.1 | MIT | runtime |
| [number-allocator](https://www.npmjs.com/package/number-allocator/v/1.0.14) | 1.0.14 | MIT | runtime |
| [process](https://www.npmjs.com/package/process/v/0.11.10) | 0.11.10 | MIT | runtime |
| [process-nextick-args](https://www.npmjs.com/package/process-nextick-args/v/2.0.1) | 2.0.1 | MIT | runtime |
| [readable-stream](https://www.npmjs.com/package/readable-stream/v/4.7.0) | 4.7.0 | MIT | runtime |
| [rfdc](https://www.npmjs.com/package/rfdc/v/1.4.1) | 1.4.1 | MIT | runtime |
| [safe-buffer](https://www.npmjs.com/package/safe-buffer/v/5.2.1) | 5.2.1 | MIT | runtime |
| [smart-buffer](https://www.npmjs.com/package/smart-buffer/v/4.2.0) | 4.2.0 | MIT | runtime |
| [socks](https://www.npmjs.com/package/socks/v/2.8.10) | 2.8.10 | MIT | runtime |
| [split2](https://www.npmjs.com/package/split2/v/4.2.0) | 4.2.0 | ISC | runtime |
| [string_decoder](https://www.npmjs.com/package/string_decoder/v/1.3.0) | 1.3.0 | MIT | runtime |
| [tslib](https://www.npmjs.com/package/tslib/v/2.8.1) | 2.8.1 | 0BSD | runtime |
| [typedarray](https://www.npmjs.com/package/typedarray/v/0.0.6) | 0.0.6 | MIT | runtime |
| [undici-types](https://www.npmjs.com/package/undici-types/v/6.21.0) | 6.21.0 | MIT | runtime |
| [util-deprecate](https://www.npmjs.com/package/util-deprecate/v/1.0.2) | 1.0.2 | MIT | runtime |
| [worker-factory](https://www.npmjs.com/package/worker-factory/v/7.0.50) | 7.0.50 | MIT | runtime |
| [worker-timers](https://www.npmjs.com/package/worker-timers/v/8.0.34) | 8.0.34 | MIT | runtime |
| [worker-timers-broker](https://www.npmjs.com/package/worker-timers-broker/v/8.0.18) | 8.0.18 | MIT | runtime |
| [worker-timers-worker](https://www.npmjs.com/package/worker-timers-worker/v/9.0.15) | 9.0.15 | MIT | runtime |
| [ws](https://www.npmjs.com/package/ws/v/8.21.3) | 8.21.3 | MIT | runtime |

## Python camera and audit packages

| Project | Version / pinned revision | Declared license | Scope |
| --- | --- | --- | --- |
| [boolean.py](https://pypi.org/project/boolean.py/5.0/) | 5.0 | BSD-2-Clause | audit tools |
| [CacheControl](https://pypi.org/project/CacheControl/0.14.4/) | 0.14.4 | Apache-2.0 | audit tools |
| [certifi](https://pypi.org/project/certifi/2026.7.22/) | 2026.7.22 | MPL-2.0 | audit tools |
| [charset-normalizer](https://pypi.org/project/charset-normalizer/3.5.1/) | 3.5.1 | MIT | audit tools |
| [coloredlogs](https://pypi.org/project/coloredlogs/15.0.1/) | 15.0.1 | MIT | camera environment |
| [cyclonedx-python-lib](https://pypi.org/project/cyclonedx-python-lib/11.12.0/) | 11.12.0 | Apache-2.0 | audit tools |
| [defusedxml](https://pypi.org/project/defusedxml/0.7.1/) | 0.7.1 | PSF-2.0 | audit tools |
| [filelock](https://pypi.org/project/filelock/4.0.0/) | 4.0.0 | MIT | audit tools |
| [flatbuffers](https://pypi.org/project/flatbuffers/25.12.19/) | 25.12.19 | Apache-2.0 | camera environment |
| [humanfriendly](https://pypi.org/project/humanfriendly/10.0/) | 10.0 | MIT | camera environment |
| [idna](https://pypi.org/project/idna/3.19/) | 3.19 | BSD-3-Clause | audit tools |
| [imageio-ffmpeg](https://pypi.org/project/imageio-ffmpeg/0.6.0/) | 0.6.0 | BSD-2-Clause | camera environment |
| [license-expression](https://pypi.org/project/license-expression/30.4.4/) | 30.4.4 | Apache-2.0 | audit tools |
| [markdown-it-py](https://pypi.org/project/markdown-it-py/4.2.0/) | 4.2.0 | MIT | audit tools |
| [mdurl](https://pypi.org/project/mdurl/0.1.2/) | 0.1.2 | MIT | audit tools |
| [mpmath](https://pypi.org/project/mpmath/1.3.0/) | 1.3.0 | BSD-3-Clause | camera environment |
| [msgpack](https://pypi.org/project/msgpack/1.2.2/) | 1.2.2 | Apache-2.0 | audit tools |
| [numpy](https://pypi.org/project/numpy/2.2.6/) | 2.2.6 | BSD-3-Clause | camera environment |
| [onnxruntime](https://pypi.org/project/onnxruntime/1.22.1/) | 1.22.1 | MIT | camera environment |
| [opencv-python-headless](https://pypi.org/project/opencv-python-headless/4.12.0.88/) | 4.12.0.88 | Apache-2.0 AND MIT | camera environment |
| [packageurl-python](https://pypi.org/project/packageurl-python/0.17.6/) | 0.17.6 | MIT | audit tools |
| [packaging](https://pypi.org/project/packaging/26.3/) | 26.3 | Apache-2.0 OR BSD-2-Clause | camera environment, audit tools |
| [pip](https://pypi.org/project/pip/26.2.1/) | 26.2.1 | MIT | camera environment, audit tools |
| [pip-requirements-parser](https://pypi.org/project/pip-requirements-parser/32.0.1/) | 32.0.1 | MIT | audit tools |
| [pip_api](https://pypi.org/project/pip_api/0.0.35/) | 0.0.35 | Apache-2.0 | audit tools |
| [pip_audit](https://pypi.org/project/pip_audit/2.10.1/) | 2.10.1 | Apache-2.0 | audit tools |
| [platformdirs](https://pypi.org/project/platformdirs/4.11.9/) | 4.11.9 | MIT | audit tools |
| [protobuf](https://pypi.org/project/protobuf/7.36.1/) | 7.36.1 | BSD-3-Clause | camera environment |
| [py-serializable](https://pypi.org/project/py-serializable/2.1.0/) | 2.1.0 | Apache-2.0 | audit tools |
| [Pygments](https://pypi.org/project/Pygments/2.21.0/) | 2.21.0 | BSD-2-Clause | audit tools |
| [pyparsing](https://pypi.org/project/pyparsing/3.3.2/) | 3.3.2 | MIT | audit tools |
| [requests](https://pypi.org/project/requests/2.34.2/) | 2.34.2 | Apache-2.0 | audit tools |
| [rich](https://pypi.org/project/rich/15.0.0/) | 15.0.0 | MIT | audit tools |
| [setuptools](https://pypi.org/project/setuptools/84.0.0/) | 84.0.0 | MIT | camera environment, audit tools |
| [sortedcontainers](https://pypi.org/project/sortedcontainers/2.4.0/) | 2.4.0 | Apache-2.0 | audit tools |
| [sympy](https://pypi.org/project/sympy/1.14.0/) | 1.14.0 | BSD-3-Clause | camera environment |
| [tomli](https://pypi.org/project/tomli/2.4.1/) | 2.4.1 | MIT | audit tools |
| [tomli_w](https://pypi.org/project/tomli_w/1.2.0/) | 1.2.0 | MIT | audit tools |
| [typing_extensions](https://pypi.org/project/typing_extensions/4.16.0/) | 4.16.0 | PSF-2.0 | audit tools |
| [urllib3](https://pypi.org/project/urllib3/2.8.0/) | 2.8.0 | MIT | audit tools |

## Security executables and GitHub Actions

| Project | Version / pinned revision | Declared license | Scope |
| --- | --- | --- | --- |
| [Gitleaks](https://github.com/gitleaks/gitleaks/blob/v8.30.1/LICENSE) | 8.30.1 | MIT | security tooling |
| [actions/checkout](https://github.com/actions/checkout/blob/11d5960a326750d5838078e36cf38b85af677262/LICENSE) | 11d5960a326750d5838078e36cf38b85af677262 | MIT | security tooling |
| [actions/setup-node](https://github.com/actions/setup-node/blob/49933ea5288caeca8642d1e84afbd3f7d6820020/LICENSE) | 49933ea5288caeca8642d1e84afbd3f7d6820020 | MIT | security tooling |
| [actions/setup-python](https://github.com/actions/setup-python/blob/a26af69be951a213d495a4c3e4e4022e16d87065/LICENSE) | a26af69be951a213d495a4c3e4e4022e16d87065 | MIT | security tooling |

## Planned integrations and reference material

These are not installed or bundled. License files were inspected on 2026-09-17; verify the chosen revision when integrating.

| Project | License found | Use here |
| --- | --- | --- |
| [TigerTag JavaScript SDK](https://github.com/TigerTag-Project/TigerTag-SDK-JS/blob/main/LICENSE) | Apache-2.0 | Planned NFC integration |
| [TigerScale V3](https://github.com/TigerTag-Project/Tiger-Scale-V3/blob/main/LICENSE) | MIT | Planned hardware/firmware reference |
| [TigerTag Studio Manager](https://github.com/TigerTag-Project/TigerTag-Studio-Manager/blob/main/LICENSE) | MIT | Research reference |
| [FlashForge 5M Python API](https://github.com/GhostTypes/ff-5mp-api-py/blob/main/LICENSE) | MIT | Alternative client reference |
| [Parallel-7 Flashforge API documentation](https://github.com/Parallel-7/flashforge-api-docs) | No explicit license located | Protocol reference links; no license assumed for copying prose or code |
