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

## License review

The four copied files and the accompanying AGPL license were compared with the
pinned upstream revision on 2026-09-17 and match byte for byte. Their original
license is preserved; the dashboard's own SPDX headers do not replace it.

The upstream model URL file points to the exact separately downloaded weights
used here. That establishes provenance, not an explicit license grant for the
weights. No separate weights license was found in the reviewed upstream files
or the model's metadata. Keep the weights out of source releases and obtain
upstream clarification before redistributing them or claiming commercial rights.
See [the full review](../../THIRD_PARTY_NOTICES.md#model-weights).
