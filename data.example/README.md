# Example data files

These files document the JSON formats used in `data/`. All addresses,
credentials, identifiers, job names, and timestamps are placeholders.

- Copy `printers.json` to `data/printers.json` and replace its values.
- Copy a `camera-PRINTER_ID.json` file only when that printer has an optional
  Tapo C120 camera. The integrated Flashforge cameras use `printers.json`.
- `history.json` and `maintenance.json` are normally created and updated by
  the dashboard. Their examples show the persisted record formats.
- `gap-a5mp.json` is normally created by the gap calibration flow. Its
  referenced JPEG must exist in `data/`; the example coordinates and UUID do
  not form a usable calibration.
- `gap-before-dark-chess.json` illustrates the same calibration format without
  the optional dark-chess rule. It is an archival filename, not one the app
  reads automatically.
- `obico-model/provenance.json` records the pinned model source. Run
  `python3 setup-obico-model.py` to create the model binary itself.

Generated logs, captured `gap-reference-*.jpg` images, `obico-model/model.onnx`,
and the `obico-venv/` virtual environment are intentionally omitted. Do not
commit real files from `data/`; they can contain private network details,
camera credentials, printer serial numbers, and print history.
