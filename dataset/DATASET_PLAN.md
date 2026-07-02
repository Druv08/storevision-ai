# StoreVision AI — Dataset Plan (Day 11)

This document defines the dataset structure and image-collection plan for the
first YOLO object detection model. **No images are collected, labelled, or
trained in this phase — this is the preparation and planning step only.**

## 1. MVP Products

The first model targets 5 products:

| ID | Product     | Category    |
|----|-------------|-------------|
| 1  | Lays        | Snacks      |
| 2  | Oreo        | Biscuits    |
| 3  | Coke        | Drinks      |
| 4  | Maggi       | Noodles     |
| 5  | Dairy Milk  | Chocolate   |

## 2. Shelf Layout (expected placement)

| Slot | Expected Product |
|------|------------------|
| A1   | Lays             |
| A2   | Oreo             |
| A3   | Coke             |
| A4   | Maggi            |
| A5   | Dairy Milk       |

## 3. Image Categories

Images are grouped by shelf scenario so the model learns both normal and
problem conditions. Each category maps to a folder under `raw-images/`.

| Category           | Folder                          | Purpose                                              |
|--------------------|---------------------------------|------------------------------------------------------|
| Normal shelf       | `raw-images/normal-shelf/`      | All 5 products correctly placed                      |
| Missing item       | `raw-images/missing-item/`      | One or more slots empty                              |
| Wrong placement    | `raw-images/wrong-placement/`   | A product placed in the wrong slot                   |
| Low light          | `raw-images/low-light/`         | Dim / uneven lighting for robustness                 |
| Side angle         | `raw-images/side-angle/`        | Shelf photographed from left/right angles            |
| Messy shelf        | `raw-images/messy-shelf/`       | Cluttered / disorganised products                    |
| Partially blocked  | `raw-images/partially-blocked/` | Products partly hidden (e.g. by a hand)              |

## 4. Target Image Counts (first dataset)

| Category           | Target Images |
|--------------------|---------------|
| Normal shelf       | 50            |
| Missing item       | 80            |
| Wrong placement    | 80            |
| Low light          | 40            |
| Side angle         | 40            |
| Messy shelf        | 40            |
| Partially blocked  | 40            |
| **Raw subtotal**   | **370**       |
| Sample test images | 20            |
| **Total**          | **390**       |

Sample test images live in `sample-test-images/` and are kept aside for quick
manual checks — they are **not** used for training.

## 5. Image Naming Format

Use lowercase, underscores, and a zero-padded 3-digit counter. Format:

```
<scenario>[_<detail>]_<NNN>.jpg
```

Examples:

| Scenario          | Example filename            |
|-------------------|-----------------------------|
| Normal shelf      | `normal_001.jpg`            |
| Missing (Oreo)    | `missing_oreo_001.jpg`      |
| Missing (Coke)    | `missing_coke_001.jpg`      |
| Wrong placement   | `wrong_coke_oreo_001.jpg`   |
| Wrong placement   | `wrong_maggi_lays_001.jpg`  |
| Low light         | `lowlight_001.jpg`          |
| Side angle (left) | `sideangle_left_001.jpg`    |
| Messy shelf       | `messy_001.jpg`             |
| Partially blocked | `blocked_hand_001.jpg`      |

For wrong placement, the order is `wrong_<actual>_<expected>` — e.g.
`wrong_coke_oreo_001.jpg` means Coke is sitting in Oreo's slot (A2).

## 6. Basic Image Collection Rules

1. Use the same shelf and the same 5 products across all images.
2. Keep the full shelf (slots A1–A5) visible in the frame where possible.
3. One scenario per image; save it in the matching category folder.
4. Vary distance, lighting, and angle so the model generalises.
5. Prefer clear, in-focus photos; avoid heavy blur except where the category
   requires it (e.g. low light).
6. Use `.jpg` at a reasonable resolution (around 640–1280 px on the long edge).
7. Follow the naming format exactly, with sequential numbering per scenario.
8. Do **not** commit raw image files to GitHub (see `.gitignore`). Only folder
   structure (`.gitkeep`) and this plan are tracked.

## 7. Folder Structure

```
dataset/
  raw-images/
    normal-shelf/
    missing-item/
    wrong-placement/
    low-light/
    side-angle/
    messy-shelf/
    partially-blocked/
  labelled-data/
  sample-test-images/
  DATASET_PLAN.md
```

## 8. Next Steps (after Day 11)

1. Collect images per the targets above.
2. Label images for the 5 products (bounding boxes).
3. Export labels in YOLO format into `labelled-data/`.
4. Train the first YOLO model.
5. Replace the simulated detection data with real model output.
