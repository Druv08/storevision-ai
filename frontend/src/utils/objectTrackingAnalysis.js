// AI 2 - object tracking (Step 4: object signatures).
//
// Every detected object gets a visual "fingerprint" so later steps can compare
// objects across scans and reason about movement / misplacement / swaps. This
// step ONLY builds and compares signatures - it does not decide swaps yet and
// does not build the object-location table yet.
//
// Fully generic: no product names, no A1-C5 zones, no 15-box grid, no
// planogram. Objects are "Object 1", "Object 2", ... and locations are simple
// area labels ("upper-left" ... "lower-right"). Nothing is saved to disk - a
// signature is a small set of numbers derived from the current canvas.

// ---- Tuning constants (safe to adjust) --------------------------------------

// Ignore this share of each side of a bounding box before sampling, so shelf
// background, shadows, and neighbouring objects at the edges do not pollute the
// signature. 0.08 = drop the outer 8% -> keep the centre ~84% x ~84%.
export const DEFAULT_MARGIN_RATIO = 0.08;

const HIST_BINS = 4; // per RGB channel -> 4*4*4 = 64 colour buckets
const TEXTURE_EDGE_MIN = 12; // a pixel gradient above this counts as "detail"

// Comparison weights (sum to 1). Colour histogram dominates; brightness is
// deliberately small so two similar-brightness / different-colour objects are
// still told apart.
const WEIGHTS = {
  histogram: 0.4, // strong  - overall colour distribution
  avgColor: 0.2, // medium  - mean colour
  edge: 0.15, // medium  - amount of edge detail
  texture: 0.1, // small-medium - detail density
  shape: 0.1, // small-medium - aspect ratio + relative size
  brightness: 0.05, // small   - must not dominate
};

const EPS = 1e-6;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---- Geometry helpers --------------------------------------------------------

// Normalise any supported detection shape to a pixel bbox {x, y, width, height}.
function toBBox(detection) {
  if (detection.bbox) return detection.bbox;
  if (detection.box) {
    const { x1, y1, x2, y2 } = detection.box;
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
  }
  // Already in {x, y, width, height} shape.
  return {
    x: detection.x,
    y: detection.y,
    width: detection.width,
    height: detection.height,
  };
}

// Inner (centre) crop of a bbox: drop `marginRatio` of each side.
export function getInnerBBox(bbox, marginRatio = DEFAULT_MARGIN_RATIO) {
  const m = clamp(marginRatio, 0, 0.45);
  const mx = bbox.width * m;
  const my = bbox.height * m;
  return {
    x: bbox.x + mx,
    y: bbox.y + my,
    width: Math.max(1, bbox.width - 2 * mx),
    height: Math.max(1, bbox.height - 2 * my),
  };
}

// Generic position label from a bbox centre. Nine simple areas, no zones.
export function getAreaLabel(bbox, imageWidth, imageHeight) {
  const w = imageWidth || 1;
  const h = imageHeight || 1;
  const cx = (bbox.x + bbox.width / 2) / w;
  const cy = (bbox.y + bbox.height / 2) / h;
  const col = cx < 1 / 3 ? "left" : cx < 2 / 3 ? "center" : "right";
  const row = cy < 1 / 3 ? "upper" : cy < 2 / 3 ? "center" : "lower";
  if (row === "center" && col === "center") return "center";
  return `${row}-${col}`;
}

// ---- Feature extraction ------------------------------------------------------

// Pure: compute signature features from an RGBA crop. Exported so the logic can
// be tested without a browser canvas.
export function computeCropFeatures(data, width, height) {
  const count = Math.max(width * height, 1);
  const histogram = new Array(HIST_BINS * HIST_BINS * HIST_BINS).fill(0);
  const binSize = 256 / HIST_BINS;

  const gray = new Float32Array(width * height);
  let rSum = 0, gSum = 0, bSum = 0, graySum = 0;

  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    rSum += r;
    gSum += g;
    bSum += b;
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    gray[i] = y;
    graySum += y;
    const bin =
      Math.min(HIST_BINS - 1, Math.floor(r / binSize)) * HIST_BINS * HIST_BINS +
      Math.min(HIST_BINS - 1, Math.floor(g / binSize)) * HIST_BINS +
      Math.min(HIST_BINS - 1, Math.floor(b / binSize));
    histogram[bin]++;
  }

  const avgColor = [rSum / count, gSum / count, bSum / count];
  const brightness = graySum / count;

  // Colour variance = average per-channel variance (how much the colour spreads).
  let vR = 0, vG = 0, vB = 0;
  for (let i = 0; i < width * height; i++) {
    vR += (data[i * 4] - avgColor[0]) ** 2;
    vG += (data[i * 4 + 1] - avgColor[1]) ** 2;
    vB += (data[i * 4 + 2] - avgColor[2]) ** 2;
  }
  const colorVariance = (vR + vG + vB) / (3 * count);

  // Edge / detail: mean gradient magnitude; texture: share of "busy" pixels.
  let edgeSum = 0, edgeCount = 0, detailPixels = 0, detailCount = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      let grad = 0;
      let seen = 0;
      if (x + 1 < width) {
        grad += Math.abs(gray[i] - gray[i + 1]);
        seen++;
      }
      if (y + 1 < height) {
        grad += Math.abs(gray[i] - gray[i + width]);
        seen++;
      }
      if (seen > 0) {
        const g = grad / seen;
        edgeSum += g;
        edgeCount++;
        detailCount++;
        if (g > TEXTURE_EDGE_MIN) detailPixels++;
      }
    }
  }
  const edgeScore = edgeCount ? edgeSum / edgeCount : 0;
  const textureScore = detailCount ? detailPixels / detailCount : 0; // 0..1

  for (let i = 0; i < histogram.length; i++) histogram[i] /= count; // normalise

  return {
    avgColor,
    brightness,
    colorVariance,
    edgeScore,
    textureScore,
    histogram,
  };
}

// Build a full signature for ONE object from the live canvas + its bbox.
// Uses the inner (centre) crop so shelf/background/shadows at the edges are
// ignored. Nothing is stored to disk - only these numbers are kept.
export function createObjectSignature(canvas, bbox, marginRatio = DEFAULT_MARGIN_RATIO) {
  const canvasWidth = canvas.width || 1;
  const canvasHeight = canvas.height || 1;

  const inner = getInnerBBox(bbox, marginRatio);
  const sx = clamp(Math.round(inner.x), 0, canvasWidth - 1);
  const sy = clamp(Math.round(inner.y), 0, canvasHeight - 1);
  const sw = clamp(Math.round(inner.width), 1, canvasWidth - sx);
  const sh = clamp(Math.round(inner.height), 1, canvasHeight - sy);

  const ctx = canvas.getContext("2d");
  const { data, width, height } = ctx.getImageData(sx, sy, sw, sh);
  const features = computeCropFeatures(data, width, height);

  return {
    ...features,
    width: bbox.width,
    height: bbox.height,
    aspectRatio: bbox.width / Math.max(bbox.height, EPS),
    areaRatio: (bbox.width * bbox.height) / (canvasWidth * canvasHeight),
  };
}

// Build reference signatures for a list of detected objects on the reference
// frame. Returns generic, self-describing objects (Object 1, Object 2, ...).
export function createReferenceObjectSignatures(canvas, detectedObjects = []) {
  const canvasWidth = canvas.width || 1;
  const canvasHeight = canvas.height || 1;

  return detectedObjects.map((detection, index) => {
    const bbox = toBBox(detection);
    const n = index + 1;
    const idNum = String(n).padStart(2, "0");
    return {
      objectId: `object_${idNum}`,
      label: `Object ${n}`, // user-facing generic name (no product names)
      regionId: detection.regionId || `region_${idNum}`,
      areaLabel: getAreaLabel(bbox, canvasWidth, canvasHeight),
      bbox,
      signature: createObjectSignature(canvas, bbox),
      status: "reference",
    };
  });
}

// ---- Comparison --------------------------------------------------------------

// Histogram distance: half the sum of absolute differences (0..1).
function histogramDistance(a, b) {
  let sum = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) sum += Math.abs(a[i] - b[i]);
  return Math.min(1, sum / 2);
}

// Euclidean RGB distance normalised to 0..1 (max is sqrt(3*255^2)).
function avgColorDistance(a, b) {
  const d = Math.sqrt(
    (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
  );
  return Math.min(1, d / 441.673);
}

// Relative distance for a single non-negative scalar (0..1).
function relativeDistance(a, b) {
  return Math.min(1, Math.abs(a - b) / Math.max(a, b, EPS));
}

// Compare two object signatures. Lower distance = better match; higher
// similarity / confidence = stronger match.
//   { distance: 0..100, similarity: 0..1, confidence: 0..100 }
export function compareObjectSignatures(signatureA, signatureB) {
  if (!signatureA || !signatureB) {
    return { distance: 100, similarity: 0, confidence: 0 };
  }

  const dHist = histogramDistance(signatureA.histogram, signatureB.histogram);
  const dColor = avgColorDistance(signatureA.avgColor, signatureB.avgColor);
  const dEdge = relativeDistance(signatureA.edgeScore, signatureB.edgeScore);
  const dTexture = Math.min(
    1,
    Math.abs(signatureA.textureScore - signatureB.textureScore)
  );
  const dShape =
    0.5 * relativeDistance(signatureA.aspectRatio, signatureB.aspectRatio) +
    0.5 * relativeDistance(signatureA.areaRatio, signatureB.areaRatio);
  const dBrightness = Math.min(
    1,
    Math.abs(signatureA.brightness - signatureB.brightness) / 255
  );

  const normalized =
    WEIGHTS.histogram * dHist +
    WEIGHTS.avgColor * dColor +
    WEIGHTS.edge * dEdge +
    WEIGHTS.texture * dTexture +
    WEIGHTS.shape * dShape +
    WEIGHTS.brightness * dBrightness;

  const similarity = clamp(1 - normalized, 0, 1);

  return {
    distance: Math.round(normalized * 1000) / 10, // 0..100, one decimal
    similarity: Math.round(similarity * 100) / 100, // 0..1
    confidence: Math.round(similarity * 100), // 0..100
    // Per-feature breakdown (handy for tuning later steps; ignore if unused).
    parts: {
      histogram: dHist,
      avgColor: dColor,
      edge: dEdge,
      texture: dTexture,
      shape: dShape,
      brightness: dBrightness,
    },
  };
}
