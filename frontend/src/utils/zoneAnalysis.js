// Reference-based zone analysis for the live shelf monitor.
//
// The shelf is split into a fixed grid of zones (rows A.. x columns 1..).
// A "reference" scan of the correctly stocked shelf is stored as one small
// image signature per zone; every later scan is compared zone-by-zone
// against that baseline. YOLO empty-space detections are only used as
// supporting evidence - the comparison works even when YOLO misses a gap.
//
// The logic is item-agnostic: the planogram currently holds demo book
// titles, but any product names work without changing this file.

export const SHELF_ROWS = ["A", "B", "C"];
export const SHELF_COLUMNS = [1, 2, 3, 4, 5];

export const ALL_ZONES = SHELF_ROWS.flatMap((row) =>
  SHELF_COLUMNS.map((col) => `${row}${col}`)
);

export const STATUS_LABELS = {
  ok: "OK",
  missing: "Possible missing item",
  wrong: "Possible wrong item",
  changed: "Possible changed item",
  unknown: "Unknown change",
};

// ---- Signature geometry ------------------------------------------------------
// Zone crops are downsampled twice: a 32x32 grid for texture stats and a very
// coarse 8x8 grid for position-tolerant pixel comparison (small camera shifts
// land in the same coarse cell).
const SIGNATURE_SIZE = 32;
const COARSE_SIZE = 8;
const HIST_BINS = 6; // per RGB channel -> 216 color histogram buckets
const ZONE_CROP_MARGIN = 0.12; // ignore the outer 12% of each zone (grid lines, shadows, neighbours)

// ---- Status thresholds (tune here) -------------------------------------------
// Difference scores are 0..1. A zone only counts as changed when its score
// passes an absolute floor AND stands out from the scan's median score.
// This is self-calibrating: global camera drift or lighting change raises
// every zone together, so no single zone "stands out" and nothing is flagged
// (a warning is raised instead of 15 false alerts).
const OWN_MATCH_OK_THRESHOLD = 0.08; // below this a zone matches its own reference
const STRONG_CHANGE_THRESHOLD = 0.16; // absolute score for a confident change
const WEAK_RELATIVE_FACTOR = 1.8; // must also exceed scan median x this
const STRONG_RELATIVE_FACTOR = 2.4;
const MISSING_RELATIVE_FACTOR = 1.3; // missing check is a bit more sensitive
const MIN_NOISE_FLOOR = 0.03; // median below this is treated as this

// Missing detection: several independent "looks empty" signals are counted.
const MISSING_SIGNALS_REQUIRED = 2;
const MISSING_THRESHOLD = 0.5; // minimum confidence, weaker evidence -> "unknown"
const EMPTY_TEXTURE_RATIO = 0.6; // texture drop vs reference
const EMPTY_VARIANCE_RATIO = 0.55; // contrast drop vs reference
const EMPTY_HIST_PEAK = 0.45; // one flat color dominating the zone
const YOLO_SUPPORT_OVERLAP = 0.3; // YOLO box covering 30%+ of the zone

// Wrong/replaced detection: the best other-zone match must be close in
// absolute terms AND clearly better than the zone's own reference match.
// NOTE: this check is NOT gated on the zone "looking changed" - similar
// items (e.g. books from the same series) can swap with only a small own
// difference. Matching another zone clearly better IS the evidence.
// The floors also self-calibrate against the scan's median content noise,
// so noisy captures do not produce random false "wrong item" alerts.
const WRONG_OWN_MIN = 0.08; // own match must be at least this poor
const WRONG_MATCH_THRESHOLD = 0.3; // max content-diff for a usable match
const WRONG_MATCH_RATIO = 0.85; // best match must beat own match by this factor
const WRONG_MATCH_MARGIN = 0.04; // ...and by this absolute gap
const WRONG_MATCH_CONFIDENCE_THRESHOLD = 0.55;
const SWAP_PAIR_MAX_DIFF = 0.35; // mutual matches may be looser - two zones
// pointing at each other is strong evidence on its own
const MIN_CONTENT_FLOOR = 0.04; // content-noise floor for the adaptive gates

// Frame consistency: too many alert-worthy zones means the camera or the
// shelf itself moved - treat the scan as a reference mismatch, not 15 alerts.
const GLOBAL_SHIFT_MEDIAN = 0.12;
const MISMATCH_ALERT_COUNT = 8;

const REFERENCE_VERSION = 3; // bump when the signature format changes

// ---- YOLO display pipeline (boxes drawn over the captured frame) -------------
// Same values chosen in the Day 18/19 threshold tests.
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

// Highest confidence among the detections that landed in this zone.
export function getZoneConfidence(zone, detections) {
  const zoneDetections = detections.filter((d) => d.zone === zone);

  if (zoneDetections.length === 0) return 0;

  return Math.max(...zoneDetections.map((d) => d.confidence));
}

export function getAlertPriority(confidence) {
  if (confidence >= 0.6) return "High";
  if (confidence >= 0.4) return "Medium";
  return "Low";
}

// ---- Zone geometry ------------------------------------------------------------

// Pixel rectangle of one zone inside a frame of the given size.
export function getZoneBounds(zone, imageWidth, imageHeight) {
  const rowIndex = SHELF_ROWS.indexOf(zone[0]);
  const colIndex = SHELF_COLUMNS.indexOf(Number(zone.slice(1)));
  const cellWidth = imageWidth / SHELF_COLUMNS.length;
  const cellHeight = imageHeight / SHELF_ROWS.length;

  return {
    x1: colIndex * cellWidth,
    y1: rowIndex * cellHeight,
    x2: (colIndex + 1) * cellWidth,
    y2: (rowIndex + 1) * cellHeight,
  };
}

// Center area of a zone rectangle, with the outer margin removed so grid
// lines, shadows and neighbouring items do not leak into the signature.
export function getInnerZoneBounds(bounds, marginRatio = ZONE_CROP_MARGIN) {
  const marginX = (bounds.x2 - bounds.x1) * marginRatio;
  const marginY = (bounds.y2 - bounds.y1) * marginRatio;

  return {
    x1: bounds.x1 + marginX,
    y1: bounds.y1 + marginY,
    x2: bounds.x2 - marginX,
    y2: bounds.y2 - marginY,
  };
}

// Map a detection box to a shelf zone like "B3" using the box center.
// Must be given the ORIGINAL image size, not the displayed (scaled) size.
export function getZoneForBox(box, imageWidth, imageHeight) {
  const centerX = (box.x1 + box.x2) / 2;
  const centerY = (box.y1 + box.y2) / 2;

  const colIndex = Math.min(
    SHELF_COLUMNS.length - 1,
    Math.max(0, Math.floor((centerX / imageWidth) * SHELF_COLUMNS.length))
  );

  const rowIndex = Math.min(
    SHELF_ROWS.length - 1,
    Math.max(0, Math.floor((centerY / imageHeight) * SHELF_ROWS.length))
  );

  return `${SHELF_ROWS[rowIndex]}${SHELF_COLUMNS[colIndex]}`;
}

// ---- Zone signatures ------------------------------------------------------------

// Downsampled crop of one region from a canvas holding the full frame.
function getZoneCrop(sourceCanvas, bounds) {
  const crop = document.createElement("canvas");
  crop.width = SIGNATURE_SIZE;
  crop.height = SIGNATURE_SIZE;

  const ctx = crop.getContext("2d");
  ctx.drawImage(
    sourceCanvas,
    bounds.x1,
    bounds.y1,
    bounds.x2 - bounds.x1,
    bounds.y2 - bounds.y1,
    0,
    0,
    SIGNATURE_SIZE,
    SIGNATURE_SIZE
  );

  return ctx.getImageData(0, 0, SIGNATURE_SIZE, SIGNATURE_SIZE);
}

// Compact description of a zone crop: coarse pixels for aligned comparison,
// a color histogram for position-independent matching, plus average color,
// brightness, contrast (variance) and edge/texture scores.
export function createImageSignature(imageData) {
  const { data } = imageData;
  const gray = [];
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;

  const histogram = new Array(HIST_BINS * HIST_BINS * HIST_BINS).fill(0);
  const binSize = 256 / HIST_BINS;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    rSum += r;
    gSum += g;
    bSum += b;
    gray.push(0.299 * r + 0.587 * g + 0.114 * b);

    const bin =
      Math.min(HIST_BINS - 1, Math.floor(r / binSize)) * HIST_BINS * HIST_BINS +
      Math.min(HIST_BINS - 1, Math.floor(g / binSize)) * HIST_BINS +
      Math.min(HIST_BINS - 1, Math.floor(b / binSize));
    histogram[bin]++;
  }

  const count = gray.length;
  for (let i = 0; i < histogram.length; i++) {
    histogram[i] /= count;
  }
  const histPeak = Math.max(...histogram);

  const brightness = gray.reduce((sum, v) => sum + v, 0) / count;
  const variance =
    gray.reduce((sum, v) => sum + (v - brightness) * (v - brightness), 0) /
    count;

  // Edge/texture score: mean absolute difference between neighbour pixels.
  // A stocked zone has covers/labels (high texture); an empty one is flat.
  const size = SIGNATURE_SIZE;
  let edgeSum = 0;
  let edgeCount = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (x + 1 < size) {
        edgeSum += Math.abs(gray[i] - gray[i + 1]);
        edgeCount++;
      }
      if (y + 1 < size) {
        edgeSum += Math.abs(gray[i] - gray[i + size]);
        edgeCount++;
      }
    }
  }

  // Coarse grid: mean gray of each block, tolerant to small camera shifts.
  const block = SIGNATURE_SIZE / COARSE_SIZE;
  const coarse = [];
  for (let cy = 0; cy < COARSE_SIZE; cy++) {
    for (let cx = 0; cx < COARSE_SIZE; cx++) {
      let sum = 0;
      for (let y = 0; y < block; y++) {
        for (let x = 0; x < block; x++) {
          sum += gray[(cy * block + y) * size + (cx * block + x)];
        }
      }
      coarse.push(sum / (block * block));
    }
  }

  return {
    coarse,
    histogram,
    histPeak,
    avgColor: [rSum / count, gSum / count, bSum / count],
    brightness,
    variance,
    edgeScore: edgeSum / Math.max(edgeCount, 1),
  };
}

// Signature of one zone region (center crop) from a canvas with the frame.
export function extractZoneSignature(sourceCanvas, bounds) {
  return createImageSignature(getZoneCrop(sourceCanvas, bounds));
}

// One signature per zone for a full frame already drawn onto a canvas.
export function createZoneSignatures(sourceCanvas) {
  const signatures = {};
  for (const zone of ALL_ZONES) {
    const bounds = getInnerZoneBounds(
      getZoneBounds(zone, sourceCanvas.width, sourceCanvas.height)
    );
    signatures[zone] = extractZoneSignature(sourceCanvas, bounds);
  }
  return signatures;
}

// ---- Signature comparison -------------------------------------------------------

// Aligned pixel difference on the coarse grid, brightness-normalised so
// camera auto-exposure changes do not count as change. 0..1.
function compareAlignedPixels(a, b) {
  const count = Math.min(a.coarse.length, b.coarse.length);
  let sum = 0;
  for (let i = 0; i < count; i++) {
    sum += Math.abs(a.coarse[i] - a.brightness - (b.coarse[i] - b.brightness));
  }
  return Math.min(1, sum / count / 128);
}

// Color histogram distance, 0..1. Position-independent.
function histogramDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.histogram.length; i++) {
    sum += Math.abs(a.histogram[i] - b.histogram[i]);
  }
  return sum / 2;
}

// Position-independent "does this look like the same item" score, 0..1.
// Used for matching a zone against ANY reference zone (swap detection).
export function contentDifference(a, b) {
  const histDiff = histogramDistance(a, b);
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

// Same-zone difference: half aligned pixels, half content. 0 = identical.
export function compareSignatures(sigA, sigB) {
  return 0.5 * compareAlignedPixels(sigA, sigB) + 0.5 * contentDifference(sigA, sigB);
}

// Does the zone look physically empty? Counts independent signals instead
// of trusting any single threshold.
export function estimateZoneOccupancy(currentSig, referenceSig, yoloOverlap = 0) {
  const textureRatio =
    currentSig.edgeScore / Math.max(referenceSig.edgeScore, 1e-6);
  const varianceRatio =
    currentSig.variance / Math.max(referenceSig.variance, 1e-6);
  const yoloSupport = yoloOverlap >= YOLO_SUPPORT_OVERLAP;

  let signals = 0;
  if (textureRatio < EMPTY_TEXTURE_RATIO) signals++;
  if (varianceRatio < EMPTY_VARIANCE_RATIO) signals++;
  if (
    currentSig.histPeak > EMPTY_HIST_PEAK &&
    currentSig.histPeak > referenceSig.histPeak * 1.4
  ) {
    signals++; // one flat color now dominates a zone that used to be varied
  }
  if (yoloSupport) signals++;

  const looksEmpty =
    signals >= MISSING_SIGNALS_REQUIRED ||
    (yoloSupport && textureRatio < 0.8);

  return { looksEmpty, signals, textureRatio, varianceRatio, yoloSupport };
}

// Full matching matrix row: compare this crop against EVERY reference zone
// (excluding its own) and keep the best and second-best matches.
export function findBestMatchingReferenceZone(currentSignature, referenceSignatures, ownZone) {
  let bestZone = null;
  let bestDiff = Infinity;
  let secondBestZone = null;
  let secondBestDiff = Infinity;

  for (const other of ALL_ZONES) {
    if (other === ownZone) continue;
    const otherSig = referenceSignatures[other];
    if (!otherSig) continue;
    const diff = contentDifference(currentSignature, otherSig);
    if (diff < bestDiff) {
      secondBestDiff = bestDiff;
      secondBestZone = bestZone;
      bestDiff = diff;
      bestZone = other;
    } else if (diff < secondBestDiff) {
      secondBestDiff = diff;
      secondBestZone = other;
    }
  }

  return { bestZone, bestDiff, secondBestZone, secondBestDiff };
}

// Fraction of a zone rectangle covered by the strongest overlapping YOLO box.
function getZoneYoloOverlap(bounds, detections) {
  const zoneArea = (bounds.x2 - bounds.x1) * (bounds.y2 - bounds.y1);
  if (zoneArea <= 0) return 0;

  let maxCover = 0;
  for (const det of detections) {
    const box = det.box;
    const overlapX = Math.min(bounds.x2, box.x2) - Math.max(bounds.x1, box.x1);
    const overlapY = Math.min(bounds.y2, box.y2) - Math.max(bounds.y1, box.y1);
    if (overlapX <= 0 || overlapY <= 0) continue;
    maxCover = Math.max(maxCover, (overlapX * overlapY) / zoneArea);
  }
  return maxCover;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ---- Main analysis ---------------------------------------------------------------

// Full per-zone comparison of the current frame against the reference.
// Every zone is classified INDEPENDENTLY (no early exits), so any number of
// missing and wrong items in the same scan are all reported.
// Returns { zones, medianDiff, referenceMismatch, manyZonesChanged,
//           cameraShiftSuspected }.
export function analyzeZonesAgainstReference({
  currentSignatures,
  referenceSignatures,
  planogram,
  detections = [],
  frameWidth,
  frameHeight,
}) {
  // Enable per-zone console logs with: localStorage.setItem("zoneDebug", "1")
  const debugEnabled =
    typeof localStorage !== "undefined" &&
    localStorage.getItem("zoneDebug") === "1";

  // Pass 1: measure every zone - own-reference difference plus the full
  // matching matrix (this crop vs every reference zone).
  const measurements = ALL_ZONES.map((zone) => {
    const currentSig = currentSignatures[zone];
    const referenceSig = referenceSignatures[zone];
    if (!currentSig || !referenceSig) {
      return { zone, currentSig, referenceSig, ownDiff: null };
    }

    const bounds = getZoneBounds(zone, frameWidth, frameHeight);
    return {
      zone,
      currentSig,
      referenceSig,
      ownDiff: compareSignatures(currentSig, referenceSig),
      ownContent: contentDifference(currentSig, referenceSig),
      match: findBestMatchingReferenceZone(currentSig, referenceSignatures, zone),
      yoloOverlap: getZoneYoloOverlap(bounds, detections),
    };
  });

  const valid = measurements.filter((m) => m.ownDiff !== null);
  const medianDiff = valid.length ? median(valid.map((m) => m.ownDiff)) : 0;
  const noiseFloor = Math.max(medianDiff, MIN_NOISE_FLOOR);

  // Adaptive floors for identity matching: most zones are unchanged, so the
  // median content difference is this scan's noise level. Wrong-item calls
  // must clear it, which stops random zones flagging on noisy captures.
  const contentFloor = Math.max(
    valid.length ? median(valid.map((m) => m.ownContent)) : 0,
    MIN_CONTENT_FLOOR
  );
  const wrongOwnFloor = Math.max(WRONG_OWN_MIN, contentFloor * 1.4);
  const wrongMarginFloor = Math.max(WRONG_MATCH_MARGIN, contentFloor * 0.5);

  // Pass 2: classify each zone relative to the scan-wide noise level.
  const zones = measurements.map((m) => {
    const { zone, currentSig, referenceSig, ownDiff, ownContent, match } = m;
    const expectedItem = planogram[zone] || "Unknown item";

    if (ownDiff === null) {
      return {
        zone,
        expectedItem,
        status: "unknown",
        statusLabel: STATUS_LABELS.unknown,
        matchedZone: null,
        matchedItem: null,
        ownReferenceScore: null,
        ownContentScore: null,
        bestMatchedZone: null,
        bestMatchedItem: null,
        bestMatchedScore: null,
        secondBestZone: null,
        secondBestScore: null,
        matchMargin: null,
        missingScore: 0,
        changeScore: 0,
        confidence: 0,
        yoloSupport: false,
        isSwapPair: false,
      };
    }

    const occupancy = estimateZoneOccupancy(
      currentSig,
      referenceSig,
      m.yoloOverlap
    );

    const missGate =
      ownDiff >=
      Math.max(OWN_MATCH_OK_THRESHOLD * 0.8, noiseFloor * MISSING_RELATIVE_FACTOR);
    const weakChanged =
      ownDiff >=
      Math.max(OWN_MATCH_OK_THRESHOLD, noiseFloor * WEAK_RELATIVE_FACTOR);
    const strongChanged =
      ownDiff >=
      Math.max(STRONG_CHANGE_THRESHOLD, noiseFloor * STRONG_RELATIVE_FACTOR);

    const matchMargin = ownContent - match.bestDiff;
    const missingScore = Math.min(
      0.95,
      0.45 + 0.12 * occupancy.signals + (occupancy.yoloSupport ? 0.1 : 0)
    );

    let status = "ok";
    let matchedZone = null;
    let confidence = 1 - ownDiff;

    if (missGate && occupancy.looksEmpty) {
      // 1) Strong empty evidence (2+ signals, or YOLO box + texture drop).
      // Missing has priority over wrong.
      status = missingScore >= MISSING_THRESHOLD ? "missing" : "unknown";
      confidence = missingScore;
    } else {
      // 2) Wrong/replaced item. Deliberately NOT gated on the zone "looking
      // changed" - similar items swap with only small own differences, so
      // matching another reference zone clearly better is the evidence.
      const clearlyBetter =
        match.bestZone &&
        ownContent >= wrongOwnFloor &&
        match.bestDiff < WRONG_MATCH_THRESHOLD &&
        match.bestDiff < ownContent * WRONG_MATCH_RATIO &&
        matchMargin >= wrongMarginFloor;

      if (clearlyBetter) {
        const matchConfidence = Math.min(0.95, 0.5 + matchMargin * 2.5);
        if (matchConfidence >= WRONG_MATCH_CONFIDENCE_THRESHOLD) {
          status = "wrong";
          matchedZone = match.bestZone;
          confidence = matchConfidence;
        }
      }

      // 3) Changed / unknown for zones that differ without a clear story.
      if (status === "ok" && weakChanged) {
        if (
          missGate &&
          strongChanged &&
          occupancy.signals >= 1 &&
          occupancy.textureRatio < 0.75
        ) {
          // Weaker empty evidence: strongly changed + some empty signal,
          // and no other zone explains what is there instead.
          status = missingScore >= MISSING_THRESHOLD ? "missing" : "unknown";
          confidence = missingScore;
        } else if (strongChanged) {
          status = "changed";
          confidence = Math.min(0.9, ownDiff * 3);
        } else {
          status = "unknown";
          confidence = Math.min(0.85, ownDiff * 2);
        }
      }
    }

    return {
      zone,
      expectedItem,
      status,
      statusLabel: STATUS_LABELS[status],
      matchedZone,
      matchedItem: matchedZone ? planogram[matchedZone] || null : null,
      ownReferenceScore: ownDiff,
      ownContentScore: ownContent,
      bestMatchedZone: match.bestZone,
      bestMatchedItem: match.bestZone
        ? planogram[match.bestZone] || null
        : null,
      bestMatchedScore: match.bestDiff,
      secondBestZone: match.secondBestZone,
      secondBestScore: match.secondBestDiff,
      matchMargin,
      missingScore,
      changeScore: ownDiff,
      confidence,
      yoloSupport: occupancy.yoloSupport,
      isSwapPair: false,
    };
  });

  // Pass 3: swap-pair promotion on the full match matrix.
  detectSwapPairs(zones, planogram, { wrongOwnFloor, wrongMarginFloor });

  if (debugEnabled) {
    console.log(
      `[zoneAnalysis] median=${medianDiff.toFixed(3)} ` +
        `floor=${noiseFloor.toFixed(3)} contentFloor=${contentFloor.toFixed(3)}`
    );
    for (const z of zones) {
      console.log(
        `Zone ${z.zone}: own=${(z.ownReferenceScore ?? 0).toFixed(3)} ` +
          `ownContent=${(z.ownContentScore ?? 0).toFixed(3)} ` +
          `best=${z.bestMatchedZone}/${z.bestMatchedItem}` +
          `(${(z.bestMatchedScore ?? 0).toFixed(3)}) ` +
          `2nd=${z.secondBestZone}(${(z.secondBestScore ?? 0).toFixed(3)}) ` +
          `margin=${(z.matchMargin ?? 0).toFixed(3)} ` +
          `missingScore=${z.missingScore.toFixed(2)} ` +
          `status=${z.status}${z.isSwapPair ? " (swap pair)" : ""}`
      );
    }
  }

  // Frame consistency: if too many zones are alert-worthy at once, the
  // camera or reference has almost certainly moved - report a mismatch
  // instead of a wall of false alerts.
  const alertWorthy = zones.filter(
    (z) => z.status === "missing" || z.status === "wrong" || z.status === "changed"
  ).length;
  const manyZonesChanged = alertWorthy > MISMATCH_ALERT_COUNT;
  const cameraShiftSuspected = medianDiff >= GLOBAL_SHIFT_MEDIAN;

  return {
    zones,
    medianDiff,
    manyZonesChanged,
    cameraShiftSuspected,
    referenceMismatch: manyZonesChanged || cameraShiftSuspected,
  };
}

// Swap-pair detection: two zones whose best matches point at EACH OTHER are
// very likely swapped, even if each match alone was too weak to pass the
// single-zone gates. Runs on the match matrix regardless of the per-zone
// status (a subtle swap can leave both zones looking "ok"). Mutates rows.
export function detectSwapPairs(
  zones,
  planogram,
  {
    wrongOwnFloor = WRONG_OWN_MIN * 0.75,
    wrongMarginFloor = WRONG_MATCH_MARGIN,
  } = {}
) {
  const byZone = Object.fromEntries(zones.map((z) => [z.zone, z]));

  for (const row of zones) {
    if (row.status === "missing" || !row.bestMatchedZone) continue;
    const partner = byZone[row.bestMatchedZone];
    if (!partner || partner.status === "missing") continue;

    const mutual =
      partner.bestMatchedZone === row.zone &&
      row.bestMatchedScore < SWAP_PAIR_MAX_DIFF &&
      partner.bestMatchedScore < SWAP_PAIR_MAX_DIFF &&
      row.ownContentScore >= wrongOwnFloor * 0.75 &&
      partner.ownContentScore >= wrongOwnFloor * 0.75 &&
      row.matchMargin >= wrongMarginFloor * 0.5 &&
      partner.matchMargin >= wrongMarginFloor * 0.5;

    if (mutual) {
      for (const side of [row, partner]) {
        side.status = "wrong";
        side.statusLabel = STATUS_LABELS.wrong;
        side.matchedZone = side.bestMatchedZone;
        side.matchedItem = planogram[side.bestMatchedZone] || null;
        side.isSwapPair = true;
        side.confidence = Math.max(side.confidence, 0.75);
      }
    }
  }

  return zones;
}

// Group analyzed zones into the alert arrays the UI renders.
export function buildZoneAlerts(zones) {
  return {
    missingItemAlerts: zones.filter((z) => z.status === "missing"),
    wrongItemAlerts: zones.filter((z) => z.status === "wrong"),
    changedZones: zones.filter((z) => z.status === "changed"),
    unclearZones: zones.filter((z) => z.status === "unknown"),
    okZones: zones.filter((z) => z.status === "ok"),
  };
}

// ---- Change-over-time events -------------------------------------------------
// Compares two consecutive scans and reports zones whose status changed in a
// way worth telling the user about. Careful wording only - never "stolen".
export function detectZoneEvents(previousZones, currentZones) {
  if (!previousZones || !currentZones) return [];

  const prevByZone = Object.fromEntries(previousZones.map((z) => [z.zone, z]));
  const time = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const events = [];
  for (const current of currentZones) {
    const previous = prevByZone[current.zone];
    if (!previous || previous.status === current.status) continue;

    if (previous.status === "ok" && current.status === "missing") {
      events.push({
        zone: current.zone,
        type: "removal",
        typeLabel: "Sudden removal",
        expectedItem: current.expectedItem,
        message: `Sudden item removal detected in Zone ${current.zone} — ${current.expectedItem} may have been removed.`,
        time,
      });
    } else if (previous.status === "ok" && current.status === "wrong") {
      events.push({
        zone: current.zone,
        type: "replacement",
        typeLabel: "Possible replacement",
        expectedItem: current.expectedItem,
        message:
          `Possible item replacement detected in Zone ${current.zone}` +
          (current.matchedItem
            ? ` — it looks like ${current.matchedItem} from Zone ${current.matchedZone}.`
            : "."),
        time,
      });
    } else if (previous.status === "missing" && current.status === "ok") {
      events.push({
        zone: current.zone,
        type: "restocked",
        typeLabel: "Restocked",
        expectedItem: current.expectedItem,
        message: `Zone ${current.zone} appears restocked.`,
        time,
      });
    }
  }

  return events;
}

// ---- Reference persistence (survives a page refresh) -----------------------

const REFERENCE_STORAGE_KEY = "storevision-zone-reference";

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
    // Older signature formats cannot be compared against - ignore them.
    if (parsed?.version !== REFERENCE_VERSION || !parsed.signatures) {
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
