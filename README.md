# Fast-MC Visual Tests

Public, descriptive visual QA for the CBSC-ZDC conditional Fast-MC project.
Each checkpoint compares 50 fixed validation conditions, one Geant4 reference
per condition, and five independently sampled Fast-MC showers with the same
incident four-vector.

The dashboard is diagnostic evidence, not physics validation. It never uses the
test split for visualization or checkpoint selection.

## Local development

```powershell
npm install
python scripts/export_public_data.py --source "..\Fast MC CBSC\dashboard\public\data" --destination "public\data" --selection "config\public_snapshots.json"
npm run test
npm run dev
```

## Updating checkpoint evidence

After a QA-passing Vertex epoch has been synced into the source dashboard,
update `config/public_snapshots.json` only if that epoch becomes the accepted
checkpoint for one calibrated family, then run the export command above. The
exporter publishes exactly one allowlisted checkpoint per calibrated family
and verifies hashes, geometry, the fixed selection, the 50-by-5 contract, and
zero test events before writing deterministic gzip artifacts. Commit and
push; GitHub Pages deploys the update.

Live site: <https://julianattemptscoding.github.io/Fast-MC-Visual-Tests/>
