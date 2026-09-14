Official Obico ONNX inference helpers, copied without modification from
https://github.com/TheSpaghettiDetective/obico-server
at commit `49c0bc7001a3fd8d56297fc3032ba287bfe1d50b` (release branch).

Files: `ml_api/lib/{onnx.py,meta.py,__init__.py}` and `ml_api/model/model.meta`.
Licensed under AGPL-3.0; see LICENSE. Source for this dashboard integration is
in `obico-worker.py` and `obico.mjs` at the project root.

The worker uses the unmodified preprocessing, inference, and nonmaximum
suppression functions with a CPU session limited to two inference threads.
The weights are the official model-weights-5a6b1be1fa.onnx release (downloaded
separately into ignored data/obico-model). No cloud prediction API is used.
Dashboard alert rules are separately implemented and are not Obico Cloud's
temporal decision algorithm or a calibrated probability of print success.
