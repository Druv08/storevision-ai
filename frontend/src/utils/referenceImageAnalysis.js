// Reference-image based shelf/desk/rack monitoring.
//
// No fixed grid, no planogram, no A1-C5, no item names. The user captures ONE
// reference photo of a correct layout; every later scan is compared against it
// as a whole. Changed areas are found with a brightness-normalised difference
// map, grouped into dynamic regions, and each region is classified as:
//   empty_space / missing / added / moved / swapped / changed
// The system reports generic AREAS ("lower-right", "center-left"), never object
// titles. YOLO empty-space detections are supporting evidence only.
//
// Pipeline (each step is an exported, testable function):
//   captureReferenceAnalysis(canvas)                  -> reference signature
//   buildDifferenceMap(refImage, curImage)            -> thresholded diff mask
//   findChangedRegions(diffMap)                        -> merged changed blobs
//   classifyChangedRegion(blob, ref, cur, yolo, ...)   -> one region + status
//   detectMovedOrSwappedObjects(regions)               -> moved / swapped pass
//   analyzeCurrentAgainstReference(ref, canvas, yolo)  -> full result for the UI
//   buildReferenceAlerts(result)                       -> grouped alert arrays

// ---- Analysis geometry -------------------------------------------------------
// Frames are downsampled to this working size before comparison. Small enough
// to store in localStorage and diff quickly, big enough to see objects.
export const ANALYSIS_WIDTH = 96;
export const ANALYSIS_HEIGHT = 72;

// ---- Tuning thresholds (tune here) -------------------------------------------
export const DIFF_THRESHOLD = 26; // 0-255 gray difference after brightness normalisation
export const CHROMA_THRESHOLD = 45; // colour (hue) change even when brightness is unchanged
export const MIN_REGION_AREA = 0.004; // ignore changed specks smaller than this share of the frame
export const MERGE_DISTANCE = 7; // changed blobs closer than this (analysis px) merge into one region
// (a removed object often fragments into strips where its brightness matched
// the background - the gap must be big enough to re-join them)
export const CAMERA_MISMATCH_THRESHOLD = 0.45; // >45% of frame changed = camera/reference mismatch
export const MISSING_CONFIDENCE_THRESHOLD = 0.5; // below this an empty/missing region is treated as "changed"
export const MOVED_CONFIDENCE_THRESHOLD = 0.55; // below this a moved match is downgraded to "changed"

const MAX_REGIONS = 12; // more simultaneous regions than this = unreliable scan

// "Looks empty now" signals for missing/empty-space detection.
const EMPTY_TEXTURE_RATIO = 0.7; // current texture (edges) dropped to <70% of the reference crop
const EMPTY_VARIANCE_RATIO = 0.7; // current contrast dropped to <70% of the reference crop
const EMPTY_ABS_EDGE = 10; // an absolutely flat area on the analysis image (shelf/background)
const YOLO_SUPPORT_OVERLAP = 0.3; // a YOLO box covering 30%+ of a region supports "empty space"

// "Looks like a new object now" signals for added detection (inverse of empty).
const ADDED_REF_FLAT_EDGE = 15; // reference crop was near-background (few edges)
const ADDED_TEXTURE_GAIN = 1 / EMPTY_TEXTURE_RATIO; // current has clearly more texture than the reference

// Moved/swap matching: the current content of one region must clearly match the
// REFERENCE content of another region (position-independent signatures).
const MATCH_DIFF_MAX = 0.26; // best cross-region content difference must be under this
const MATCH_ADVANTAGE = 0.8; // ...and beat its own reference difference by this factor

const HIST_BINS = 4; // per RGB channel -> 64 color buckets per region

export const REGION_STATUS_LABELS = {
  empty_space: "Empty space",
  missing: "Possible missing object",
  added: "Added / new object",
  moved: "Possible moved object",
  swapped: "Possible swap / replacement",
  changed: "Changed area",
};

// ---- YOLO display pipeline (boxes drawn over the captured frame) -------------
export const DISPLAY_CONFIDENCE_THRESHOLD = 0.35; // hide weak/noisy boxes
const IOU_SUPPRESSION_THRESHOLD = 0.4; // overlapping boxes above this are duplicates

// Intersection-over-Union of two boxes ({x1, y1, x2, y2}). Returns 0..1.
export function calculateIoU(boxA, boxB) {
  const xLeft = Math.max(boxA.x1, boxB.x1);
  const yTop = Math.max(boxA.y1, boxB.y1);
  const xRight = Math.min(boxA.x2, boxB.x2);
  const yBottom = Math.min(boxA.y2, boxB.y2);

  if (xRight <= xLeft || yBottom <= yTop) {
    return 0;
  }

  const intersection = (xRight - xLeft) * (yBottom - yTop);
  const areaA = (boxA.x2 - boxA.x1) * (boxA.y2 - boxA.y1);
  const areaB = (boxB.x2 - boxB.x1) * (boxB.y2 - boxB.y1);
  const union = areaA + areaB - intersection;

  return union > 0 ? intersection / union : 0;
}

// Simple non-max suppression: keep the strongest box, drop near-duplicates.
export function removeDuplicateDetections(detections) {
  const sorted = [...detections].sort((a, b) => b.confidence - a.confidence);
  const kept = [];
  for (const det of sorted) {
    const overlapsKept = kept.some(
      (k) => calculateIoU(det.box, k.box) > IOU_SUPPRESSION_THRESHOLD
    );
    if (!overlapsKept) {
      kept.push(det);
    }
  }
  return kept;
}

// Are two boxes probably the same shelf gap, even if IoU is low?
function areBoxesNearSameGap(boxA, boxB) {
  const heightA = boxA.y2 - boxA.y1;
  const heightB = boxB.y2 - boxB.y1;
  const avgHeight = (heightA + heightB) / 2;
  const avgWidth = ((boxA.x2 - boxA.x1) + (boxB.x2 - boxB.x1)) / 2;

  const centerAy = (boxA.y1 + boxA.y2) / 2;
  const centerBy = (boxB.y1 + boxB.y2) / 2;
  const verticalCentersClose = Math.abs(centerAy - centerBy) <= avgHeight * 0.6;

  const overlapY = Math.min(boxA.y2, boxB.y2) - Math.max(boxA.y1, boxB.y1);
  const verticalOverlapOk =
    overlapY > 0 && overlapY >= Math.min(heightA, heightB) * 0.4;

  const horizontalGap = Math.max(boxA.x1, boxB.x1) - Math.min(boxA.x2, boxB.x2);
  const horizontallyClose = horizontalGap <= avgWidth * 0.5;

  return verticalCentersClose && verticalOverlapOk && horizontallyClose;
}

// Merge boxes that belong to the same empty space into one bigger box.
export function mergeNearbyDetections(detections) {
  const sorted = [...detections].sort((a, b) => b.confidence - a.confidence);
  const used = new Array(sorted.length).fill(false);
  const merged = [];

  for (let i = 0; i < sorted.length; i++) {
    if (used[i]) continue;

    let { x1, y1, x2, y2 } = sorted[i].box;
    let bestConfidence = sorted[i].confidence;
    used[i] = true;

    let grew = true;
    while (grew) {
      grew = false;
      const groupBox = { x1, y1, x2, y2 };
      for (let j = 0; j < sorted.length; j++) {
        if (used[j]) continue;
        if (areBoxesNearSameGap(groupBox, sorted[j].box)) {
          x1 = Math.min(x1, sorted[j].box.x1);
          y1 = Math.min(y1, sorted[j].box.y1);
          x2 = Math.max(x2, sorted[j].box.x2);
          y2 = Math.max(y2, sorted[j].box.y2);
          bestConfidence = Math.max(bestConfidence, sorted[j].confidence);
          used[j] = true;
          grew = true;
        }
      }
    }

    merged.push({
      class_name: "Empty-space",
      confidence: bestConfidence,
      box: { x1, y1, x2, y2 },
    });
  }

  return merged;
}

// Shared display pipeline: filter weak boxes, drop duplicates, merge gaps.
export function buildDisplayDetections(rawDetections) {
  const confident = (rawDetections ?? []).filter(
    (d) => d.confidence >= DISPLAY_CONFIDENCE_THRESHOLD
  );
  return mergeNearbyDetections(removeDuplicateDetections(confident));
}

// ---- Frame signatures --------------------------------------------------------

// Downsample a full frame from a canvas into a compact comparable image.
export function downsampleCanvas(sourceCanvas) {
  const work = document.createElement("canvas");
  work.width = ANALYSIS_WIDTH;
  work.height = ANALYSIS_HEIGHT;
  const ctx = work.getContext("2d");
  ctx.drawImage(sourceCanvas, 0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
  const data = ctx.getImageData(0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT).data;
  return imageFromRgba(data, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
}

// Build the comparable image object from raw RGBA pixel data.
// Exported separately so the logic is testable without a browser canvas.
export function imageFromRgba(data, width, height) {
  const gray = new Array(width * height);
  const rgb = new Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    rgb[i * 3] = r;
    rgb[i * 3 + 1] = g;
    rgb[i * 3 + 2] = b;
    gray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }
  return { width, height, gray, rgb };
}

// Capture the reference layout signature from the camera canvas.
// Stores a downsampled comparable image only - never the real photo file.
export function captureReferenceAnalysis(referenceCanvas) {
  return {
    savedAt: new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
    image: downsampleCanvas(referenceCanvas),
  };
}
// Backward-compatible alias.
export const captureReferenceSignature = captureReferenceAnalysis;

// ---- Region helpers ----------------------------------------------------------

// Human-readable location of a box: "upper-left" ... "lower-right".
// Accepts a normalized box (0..1); if imageWidth/Height are given and the box
// is in pixels, it is normalized first.
export function getAreaLabel(box, imageWidth = 1, imageHeight = 1) {
  const nx1 = imageWidth > 1 ? box.x1 / imageWidth : box.x1;
  const nx2 = imageWidth > 1 ? box.x2 / imageWidth : box.x2;
  const ny1 = imageHeight > 1 ? box.y1 / imageHeight : box.y1;
  const ny2 = imageHeight > 1 ? box.y2 / imageHeight : box.y2;
  const cx = (nx1 + nx2) / 2;
  const cy = (ny1 + ny2) / 2;
  const col = cx < 1 / 3 ? "left" : cx < 2 / 3 ? "center" : "right";
  const row = cy < 1 / 3 ? "upper" : cy < 2 / 3 ? "center" : "lower";
  if (row === "center" && col === "center") return "center";
  return `${row}-${col}`;
}
// Backward-compatible alias.
export const areaLabelForBox = getAreaLabel;

// Stats of one rectangular crop of a comparable image (pixel coordinates).
function computeRegionStats(image, px) {
  const { width, gray, rgb } = image;
  const histogram = new Array(HIST_BINS * HIST_BINS * HIST_BINS).fill(0);
  const binSize = 256 / HIST_BINS;

  let sum = 0;
  let count = 0;
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let edgeSum = 0;
  let edgeCount = 0;

  for (let y = px.y1; y < px.y2; y++) {
    for (let x = px.x1; x < px.x2; x++) {
      const i = y * width + x;
      sum += gray[i];
      count++;
      const r = rgb[i * 3];
      const g = rgb[i * 3 + 1];
      const b = rgb[i * 3 + 2];
      rSum += r;
      gSum += g;
      bSum += b;
      const bin =
        Math.min(HIST_BINS - 1, Math.floor(r / binSize)) * HIST_BINS * HIST_BINS +
        Math.min(HIST_BINS - 1, Math.floor(g / binSize)) * HIST_BINS +
        Math.min(HIST_BINS - 1, Math.floor(b / binSize));
      histogram[bin]++;

      if (x + 1 < px.x2) {
        edgeSum += Math.abs(gray[i] - gray[i + 1]);
        edgeCount++;
      }
      if (y + 1 < px.y2) {
        edgeSum += Math.abs(gray[i] - gray[i + width]);
        edgeCount++;
      }
    }
  }

  const brightness = count ? sum / count : 0;
  let varSum = 0;
  for (let y = px.y1; y < px.y2; y++) {
    for (let x = px.x1; x < px.x2; x++) {
      const v = gray[y * width + x] - brightness;
      varSum += v * v;
    }
  }
  for (let i = 0; i < histogram.length; i++) {
    histogram[i] /= Math.max(count, 1);
  }

  return {
    brightness,
    variance: count ? varSum / count : 0,
    edgeScore: edgeCount ? edgeSum / edgeCount : 0,
    avgColor: [rSum / Math.max(count, 1), gSum / Math.max(count, 1), bSum / Math.max(count, 1)],
    histogram,
  };
}

// Position-independent "same object?" difference between two crops. 0..1.
function contentDifference(a, b) {
  let histDiff = 0;
  for (let i = 0; i < a.histogram.length; i++) {
    histDiff += Math.abs(a.histogram[i] - b.histogram[i]);
  }
  histDiff /= 2;

  const colorDiff = Math.min(
    1,
    (Math.abs(a.avgColor[0] - b.avgColor[0]) +
      Math.abs(a.avgColor[1] - b.avgColor[1]) +
      Math.abs(a.avgColor[2] - b.avgColor[2])) /
      (3 * 255)
  );
  const edgeDiff = Math.min(
    1,
    Math.abs(a.edgeScore - b.edgeScore) /
      Math.max(a.edgeScore, b.edgeScore, 1e-6)
  );

  return 0.6 * histDiff + 0.25 * colorDiff + 0.15 * edgeDiff;
}

// ---- Change detection --------------------------------------------------------

// Colour-aware, thresholded difference mask between two comparable images.
// A pixel is "changed" if its brightness OR its colour (hue) changed enough.
// Lighting tolerance: each frame's mean is subtracted from both the luminance
// and the two colour-opponent channels, so a uniform brightness change or a
// global colour cast does not light up the whole frame. Using colour (not just
// grayscale) means two objects of similar brightness but different colour - a
// swap - are still detected.
export function buildDifferenceMap(referenceImage, currentImage) {
  const { width, height } = referenceImage;
  const total = width * height;

  // Colour-opponent signals (luminance-independent): red-green and yellow-blue.
  const opponents = (image) => {
    const rg = new Float32Array(total);
    const yb = new Float32Array(total);
    let graySum = 0, rgSum = 0, ybSum = 0;
    for (let i = 0; i < total; i++) {
      const r = image.rgb[i * 3];
      const g = image.rgb[i * 3 + 1];
      const b = image.rgb[i * 3 + 2];
      rg[i] = r - g;
      yb[i] = (r + g) / 2 - b;
      graySum += image.gray[i];
      rgSum += rg[i];
      ybSum += yb[i];
    }
    return {
      rg,
      yb,
      grayMean: graySum / Math.max(total, 1),
      rgMean: rgSum / Math.max(total, 1),
      ybMean: ybSum / Math.max(total, 1),
    };
  };

  const ref = opponents(referenceImage);
  const cur = opponents(currentImage);

  const changed = new Uint8Array(total);
  let changedCount = 0;
  for (let i = 0; i < total; i++) {
    const grayDiff = Math.abs(
      currentImage.gray[i] - cur.grayMean - (referenceImage.gray[i] - ref.grayMean)
    );
    const chromaDiff =
      Math.abs(cur.rg[i] - cur.rgMean - (ref.rg[i] - ref.rgMean)) +
      Math.abs(cur.yb[i] - cur.ybMean - (ref.yb[i] - ref.ybMean));
    if (grayDiff > DIFF_THRESHOLD || chromaDiff > CHROMA_THRESHOLD) {
      changed[i] = 1;
      changedCount++;
    }
  }

  return {
    width,
    height,
    changed,
    changedFraction: changedCount / Math.max(total, 1),
  };
}

// Connected components (8-connectivity BFS) over a difference mask => changed
// regions with pixel bboxes. Tiny specks dropped, nearby blobs merged.
export function findChangedRegions(diffMap) {
  const { width, height, changed, changedFraction } = diffMap;
  const total = width * height;

  const visited = new Uint8Array(total);
  let blobs = [];
  for (let start = 0; start < total; start++) {
    if (!changed[start] || visited[start]) continue;
    const queue = [start];
    visited[start] = 1;
    let x1 = width;
    let y1 = height;
    let x2 = 0;
    let y2 = 0;
    let area = 0;
    while (queue.length) {
      const i = queue.pop();
      const x = i % width;
      const y = Math.floor(i / width);
      area++;
      if (x < x1) x1 = x;
      if (y < y1) y1 = y;
      if (x + 1 > x2) x2 = x + 1;
      if (y + 1 > y2) y2 = y + 1;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const ni = ny * width + nx;
          if (changed[ni] && !visited[ni]) {
            visited[ni] = 1;
            queue.push(ni);
          }
        }
      }
    }
    blobs.push({ x1, y1, x2, y2, area });
  }

  // Drop tiny noise blobs.
  blobs = blobs.filter((b) => b.area >= MIN_REGION_AREA * total);

  // Merge blobs whose (slightly expanded) boxes touch, until stable.
  let mergedSomething = true;
  while (mergedSomething) {
    mergedSomething = false;
    outer: for (let i = 0; i < blobs.length; i++) {
      for (let j = i + 1; j < blobs.length; j++) {
        const a = blobs[i];
        const b = blobs[j];
        const touch =
          a.x1 - MERGE_DISTANCE < b.x2 &&
          b.x1 - MERGE_DISTANCE < a.x2 &&
          a.y1 - MERGE_DISTANCE < b.y2 &&
          b.y1 - MERGE_DISTANCE < a.y2;
        if (touch) {
          blobs[i] = {
            x1: Math.min(a.x1, b.x1),
            y1: Math.min(a.y1, b.y1),
            x2: Math.max(a.x2, b.x2),
            y2: Math.max(a.y2, b.y2),
            area: a.area + b.area,
          };
          blobs.splice(j, 1);
          mergedSomething = true;
          break outer;
        }
      }
    }
  }

  // Reading order (top-left first) for stable region numbering.
  blobs.sort((a, b) => (a.y1 !== b.y1 ? a.y1 - b.y1 : a.x1 - b.x1));

  return { blobs, changedFraction };
}

// Backward-compatible one-shot: difference map + regions in a single call.
export function detectChangedRegions(referenceImage, currentImage) {
  return findChangedRegions(buildDifferenceMap(referenceImage, currentImage));
}

// Fraction of a normalized box covered by the strongest overlapping YOLO box
// (YOLO boxes given in normalized 0..1 coordinates).
function yoloOverlapForBox(normBox, yoloBoxes) {
  const area = (normBox.x2 - normBox.x1) * (normBox.y2 - normBox.y1);
  if (area <= 0) return 0;
  let maxCover = 0;
  for (const b of yoloBoxes) {
    const ox = Math.min(normBox.x2, b.x2) - Math.max(normBox.x1, b.x1);
    const oy = Math.min(normBox.y2, b.y2) - Math.max(normBox.y1, b.y1);
    if (ox <= 0 || oy <= 0) continue;
    maxCover = Math.max(maxCover, (ox * oy) / area);
  }
  return maxCover;
}

// Classify ONE changed blob by comparing the same area in reference vs current.
// Returns a region object with a first-pass status:
//   empty_space | missing | added | changed
// (moved / swapped are decided later across regions.)
export function classifyChangedRegion(
  blob,
  referenceImage,
  currentImage,
  yoloBoxes = [],
  index = 0,
  changedFraction = 0
) {
  const { width, height } = referenceImage;
  const normBox = {
    x1: blob.x1 / width,
    y1: blob.y1 / height,
    x2: blob.x2 / width,
    y2: blob.y2 / height,
  };
  const referenceStats = computeRegionStats(referenceImage, blob);
  const currentStats = computeRegionStats(currentImage, blob);

  const textureRatio =
    currentStats.edgeScore / Math.max(referenceStats.edgeScore, 1e-6);
  const varianceRatio =
    currentStats.variance / Math.max(referenceStats.variance, 1e-6);
  const yoloOverlap = yoloOverlapForBox(normBox, yoloBoxes);
  const yoloSupport = yoloOverlap >= YOLO_SUPPORT_OVERLAP;

  // Object gone: current area is much flatter/lower-texture than the reference.
  // Texture drop is the main signal; a variance drop OR an absolutely flat
  // current area confirms it (variance alone misleads when the reference
  // object's colors share a similar brightness). YOLO gap boxes also support it.
  const looksEmpty =
    (textureRatio < EMPTY_TEXTURE_RATIO &&
      (varianceRatio < EMPTY_VARIANCE_RATIO ||
        currentStats.edgeScore < EMPTY_ABS_EDGE)) ||
    (yoloSupport && textureRatio < 0.85);

  // Object added: reference area was near-background (few edges) and the current
  // area now has clearly more texture/detail. Inverse of "looks empty".
  const looksAdded =
    !looksEmpty &&
    referenceStats.edgeScore < ADDED_REF_FLAT_EDGE &&
    currentStats.edgeScore > EMPTY_ABS_EDGE &&
    textureRatio > ADDED_TEXTURE_GAIN;

  let status;
  let confidence;
  if (looksEmpty) {
    // A clean physical gap (very flat now, or YOLO confirms) = empty_space;
    // a softer "something is gone" = missing.
    const cleanGap = yoloSupport || currentStats.edgeScore < EMPTY_ABS_EDGE;
    status = cleanGap ? "empty_space" : "missing";
    confidence = Math.min(
      0.95,
      0.5 + (1 - Math.min(textureRatio, 1)) * 0.3 + (yoloSupport ? 0.15 : 0)
    );
    // Weak empty signals are just "changed" (avoid false missing alerts).
    if (confidence < MISSING_CONFIDENCE_THRESHOLD) {
      status = "changed";
    }
  } else if (looksAdded) {
    status = "added";
    confidence = Math.min(
      0.9,
      0.5 + Math.min(1, (textureRatio - 1) / 2) * 0.3
    );
  } else {
    status = "changed";
    confidence = Math.min(
      0.9,
      0.4 + changedFraction + (1 - 1 / (1 + blob.area / 100))
    );
  }

  return {
    id: `Region ${index + 1}`,
    box: normBox,
    areaLabel: getAreaLabel(normBox),
    status,
    confidence,
    textureRatio,
    varianceRatio,
    yoloSupport,
    matchedRegionId: null,
    matchedAreaLabel: null,
    sourceAreaLabel: null,
    destinationAreaLabel: null,
    referenceStats,
    currentStats,
  };
}

// Moved/swap pass: does the CURRENT content of one changed region match the
// REFERENCE content of another changed region? Mutual matches = swap.
export function detectMovedOrSwappedObjects(regions) {
  for (const region of regions) {
    // Empty/missing regions are move SOURCES (their object left), not
    // destinations - skip them as candidates to reclassify.
    if (region.status === "missing" || region.status === "empty_space") continue;

    let bestId = null;
    let bestDiff = Infinity;
    for (const other of regions) {
      if (other.id === region.id) continue;
      const diff = contentDifference(region.currentStats, other.referenceStats);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestId = other.id;
      }
    }

    const ownDiff = contentDifference(region.currentStats, region.referenceStats);
    if (
      bestId !== null &&
      bestDiff < MATCH_DIFF_MAX &&
      bestDiff < ownDiff * MATCH_ADVANTAGE
    ) {
      const confidence = Math.min(0.95, 1 - bestDiff);
      // Only accept the move if the match is confident enough; otherwise the
      // region stays whatever it was (usually "changed").
      if (confidence >= MOVED_CONFIDENCE_THRESHOLD) {
        region.status = "moved";
        region.matchedRegionId = bestId;
        region.confidence = confidence;
      }
    }
  }

  // Mutual pointers = likely swap.
  const byId = Object.fromEntries(regions.map((r) => [r.id, r]));
  for (const region of regions) {
    if (region.status !== "moved" || !region.matchedRegionId) continue;
    const partner = byId[region.matchedRegionId];
    if (partner?.status === "moved" && partner.matchedRegionId === region.id) {
      region.status = "swapped";
      partner.status = "swapped";
      region.confidence = Math.max(region.confidence, 0.8);
      partner.confidence = Math.max(partner.confidence, 0.8);
    }
  }

  return regions;
}

// Just the missing/empty regions of an analysis (convenience per the spec).
export function detectMissingRegions(analysisRegions) {
  return analysisRegions.filter(
    (r) => r.status === "missing" || r.status === "empty_space"
  );
}

// ---- Main analysis -----------------------------------------------------------

// Pure core: compare two comparable images. Exported for headless testing.
// yoloBoxes must be in NORMALIZED 0..1 frame coordinates.
export function analyzeImagesAgainstReference(referenceImage, currentImage, yoloBoxes = []) {
  const diffMap = buildDifferenceMap(referenceImage, currentImage);
  const { blobs, changedFraction } = findChangedRegions(diffMap);

  // Whole-frame guard: too much changed at once = the camera or reference moved.
  const referenceMismatch =
    changedFraction > CAMERA_MISMATCH_THRESHOLD || blobs.length > MAX_REGIONS;

  const regions = blobs.map((blob, index) =>
    classifyChangedRegion(
      blob,
      referenceImage,
      currentImage,
      yoloBoxes,
      index,
      changedFraction
    )
  );

  // No move/swap reasoning during a mismatch (everything is unreliable then).
  if (!referenceMismatch) {
    detectMovedOrSwappedObjects(regions);
  }

  // Final display fields (stats objects stay internal but are kept for tests).
  const byId = Object.fromEntries(regions.map((r) => [r.id, r]));
  for (const region of regions) {
    region.statusLabel = REGION_STATUS_LABELS[region.status] || region.status;
    if (region.matchedRegionId) {
      const matchedArea = byId[region.matchedRegionId]?.areaLabel ?? null;
      region.matchedAreaLabel = matchedArea;
      // For a moved object: it came FROM the matched reference area TO here.
      region.sourceAreaLabel = matchedArea;
      region.destinationAreaLabel = region.areaLabel;
    }
    region.message = buildRegionMessage(region);
  }

  return {
    regions,
    changedFraction,
    referenceMismatch,
  };
}

// Browser entry point: downsample the current canvas, normalize YOLO boxes,
// run the pure comparison.
export function analyzeCurrentAgainstReference(referenceData, currentCanvas, yoloDetections = []) {
  const currentImage = downsampleCanvas(currentCanvas);
  const w = currentCanvas.width || 1;
  const h = currentCanvas.height || 1;
  const yoloBoxes = yoloDetections.map((d) => ({
    x1: d.box.x1 / w,
    y1: d.box.y1 / h,
    x2: d.box.x2 / w,
    y2: d.box.y2 / h,
  }));
  return analyzeImagesAgainstReference(referenceData.image, currentImage, yoloBoxes);
}

function buildRegionMessage(region) {
  const area = region.areaLabel;
  switch (region.status) {
    case "empty_space":
      return `Empty space detected in the ${area} area compared to the reference layout.`;
    case "missing":
      return `Possible object missing from the ${area} area compared to the reference.`;
    case "added":
      return `New object/change detected in the ${area} area (this area looked empty in the reference).`;
    case "moved":
      return `Possible object movement — the ${area} area appears to hold an object from the ${region.matchedAreaLabel} area of the reference.`;
    case "swapped":
      return `Possible swap/replacement detected between the ${area} and ${region.matchedAreaLabel} areas.`;
    default:
      return `The ${area} area appears changed compared to the reference and needs review.`;
  }
}

// Group regions into the alert arrays the UI renders. Empty spaces are ALSO
// surfaced as possible-missing (a gap is a possible missing object), but each
// region still produces only ONE issue in the history (see issueHistory).
export function buildReferenceAlerts(analysis) {
  const regions = analysis?.regions ?? [];
  return {
    emptySpaceAlerts: regions.filter((r) => r.status === "empty_space"),
    missingAlerts: regions.filter(
      (r) => r.status === "empty_space" || r.status === "missing"
    ),
    movedAlerts: regions.filter((r) => r.status === "moved"),
    swapAlerts: regions.filter((r) => r.status === "swapped"),
    addedAlerts: regions.filter((r) => r.status === "added"),
    changedAlerts: regions.filter((r) => r.status === "changed"),
  };
}

// ---- Change-over-time events -------------------------------------------------
// Compare two consecutive stable analyses. Careful wording only.
export function detectReferenceEvents(previousAnalysis, currentAnalysis) {
  if (!previousAnalysis || !currentAnalysis) return [];

  const key = (r) => `${r.status}:${r.areaLabel}`;
  const prevKeys = new Set(previousAnalysis.regions.map(key));
  const prevAreas = new Set(previousAnalysis.regions.map((r) => r.areaLabel));
  const currAreas = new Set(currentAnalysis.regions.map((r) => r.areaLabel));

  const isGone = (s) => s === "missing" || s === "empty_space";

  const time = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const events = [];
  for (const region of currentAnalysis.regions) {
    if (prevKeys.has(key(region))) continue;
    if (isGone(region.status) && !prevAreas.has(region.areaLabel)) {
      events.push({
        type: "removal",
        typeLabel: "Sudden removal",
        areaLabel: region.areaLabel,
        message: `Sudden shelf change — an object may have been removed from the ${region.areaLabel} area.`,
        time,
      });
    } else if (region.status === "added" && !prevAreas.has(region.areaLabel)) {
      events.push({
        type: "added",
        typeLabel: "Object added",
        areaLabel: region.areaLabel,
        message: `A new object/change appeared in the ${region.areaLabel} area.`,
        time,
      });
    } else if (
      (region.status === "moved" || region.status === "swapped") &&
      !prevAreas.has(region.areaLabel)
    ) {
      events.push({
        type: "movement",
        typeLabel: "Possible movement",
        areaLabel: region.areaLabel,
        message: `Possible object movement detected in the ${region.areaLabel} area.`,
        time,
      });
    }
  }

  // Areas that had a problem before and are clean now.
  for (const prev of previousAnalysis.regions) {
    if (!isGone(prev.status)) continue;
    if (!currAreas.has(prev.areaLabel)) {
      events.push({
        type: "restored",
        typeLabel: "Restored",
        areaLabel: prev.areaLabel,
        message: `The ${prev.areaLabel} area appears restored to the reference layout.`,
        time,
      });
    }
  }

  return events;
}

// ---- Reference persistence (survives a page refresh) -------------------------

const REFERENCE_STORAGE_KEY = "storevision-reference-image";
const REFERENCE_VERSION = 1;

export function saveReference(reference) {
  try {
    localStorage.setItem(
      REFERENCE_STORAGE_KEY,
      JSON.stringify({ ...reference, version: REFERENCE_VERSION })
    );
  } catch {
    // Storage full or blocked - the in-memory reference still works.
  }
}

export function loadReference() {
  try {
    const raw = localStorage.getItem(REFERENCE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.version !== REFERENCE_VERSION || !parsed.image) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearStoredReference() {
  try {
    localStorage.removeItem(REFERENCE_STORAGE_KEY);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}
