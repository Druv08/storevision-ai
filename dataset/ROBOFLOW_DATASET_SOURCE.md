# Roboflow Dataset Source — Empty Shelf Detection

This note tracks the source and details of the first external dataset used in
StoreVision AI. The dataset images and label files themselves are **not**
committed to GitHub (they are Git-ignored); only this reference note is tracked.

## Source

- **Dataset:** Empty shelf detection (v2)
- **Platform:** Roboflow Universe
- **Workspace / Project:** `policenta` / `empty-shelf-detection`
- **Version:** 2
- **URL:** https://universe.roboflow.com/policenta/empty-shelf-detection/dataset/2
- **License:** CC BY 4.0
- **Exported:** May 23, 2026 (YOLOv8 format)

## Local Location (not committed)

```
dataset/labelled-data/roboflow-empty-shelf/
```

## Contents

- **Format:** YOLOv8 (images + `.txt` label files per split)
- **Splits:** train / valid / test
- **Image counts (extracted):**

  | Split | Images | Labels |
  |-------|--------|--------|
  | train | 308    | 308    |
  | valid | 87     | 87     |
  | test  | 50     | 50     |
  | **Total** | **445** | **445** |

  (Roboflow lists the source project as ~450 images.)

## Classes

Defined in the dataset's `data.yaml`:

- `nc: 1`
- `names: ['Empty-space']`

This is a **single-class** dataset that detects empty/void shelf regions.

## Preprocessing (applied by Roboflow at export)

- Auto-orientation (EXIF orientation stripped)
- Resized to 416×416 (stretch)
- No augmentation applied

## Purpose in StoreVision AI

Empty-space detection is the foundation for the **missing item** alert: when a
shelf slot shows an empty region where a product is expected, the system can
flag it as missing. This external dataset lets us prototype detection before
our own 5-product dataset (see [DATASET_PLAN.md](DATASET_PLAN.md)) is collected
and labelled.

## Notes

- Do **not** commit the image/label files — they stay local and Git-ignored.
- This dataset only detects empty space, not specific products. Product-level
  detection (Lays, Oreo, Coke, Maggi, Dairy Milk) will come from our own
  labelled dataset later.
- Attribution: dataset provided by a Roboflow user under CC BY 4.0; keep this
  credit if the dataset is used or redistributed.
