import { useEffect, useRef, useState } from "react";
import { detectShelfImage } from "../services/detectionApi";
<<<<<<< HEAD
import {
  buildDisplayDetections,
  captureReferenceSignature,
  analyzeCurrentAgainstReference,
  buildReferenceAlerts,
  detectReferenceEvents,
  loadReference,
  saveReference,
  clearStoredReference,
} from "../utils/referenceImageAnalysis";
import {
  loadIssues,
  saveIssues,
  clearStoredIssues,
  syncIssuesFromScan,
  updateIssueStatus,
} from "../utils/issueHistory";
import IssueReviewPanel from "./IssueReviewPanel";

const SHOW_REGIONS_DEFAULT = true;
=======
import { zonePlanogram } from "../config/zonePlanogram";

// Display-only tuning (same values chosen in the Day 18/19 threshold tests).
const DISPLAY_CONFIDENCE_THRESHOLD = 0.35; // hide weak/noisy boxes
const IOU_SUPPRESSION_THRESHOLD = 0.4; // overlapping boxes above this are duplicates

// Shelf zone grid: rows are shelf levels (A = top), columns split each level.
const SHELF_ROWS = ["A", "B", "C"];
const SHELF_COLUMNS = [1, 2, 3, 4, 5];
const SHOW_ZONE_GRID_DEFAULT = true;

// Intersection-over-Union of two boxes ({x1, y1, x2, y2}). Returns 0..1.
function calculateIoU(boxA, boxB) {
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
function removeDuplicateDetections(detections) {
  const sorted = [...detections].sort((a, b) => b.confidence - a.confidence);
  const kept = [];
  for (const det of sorted) {
    const overlapsKept = kept.some(
      (k) => calculateIoU(det.box, k.box) > IOU_SUPPRESSION_THRESHOLD,
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
  const avgWidth = (boxA.x2 - boxA.x1 + (boxB.x2 - boxB.x1)) / 2;

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
function mergeNearbyDetections(detections) {
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

// Map a detection box to a shelf zone like "B3" using the box center.
// Must be given the ORIGINAL image size, not the displayed (scaled) size.
function getZoneForBox(box, imageWidth, imageHeight) {
  const centerX = (box.x1 + box.x2) / 2;
  const centerY = (box.y1 + box.y2) / 2;

  const colIndex = Math.min(
    SHELF_COLUMNS.length - 1,
    Math.max(0, Math.floor((centerX / imageWidth) * SHELF_COLUMNS.length)),
  );

  const rowIndex = Math.min(
    SHELF_ROWS.length - 1,
    Math.max(0, Math.floor((centerY / imageHeight) * SHELF_ROWS.length)),
  );

  return `${SHELF_ROWS[rowIndex]}${SHELF_COLUMNS[colIndex]}`;
}
>>>>>>> 67a7ea4 (Implement detection improvements and UI updates)

function getPriority(confidence) {
  if (confidence >= 0.6) return "High";

  if (confidence >= 0.4) return "Medium";

  return "Low";
}

export default function LiveCameraMonitor() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const intervalRef = useRef(null); // auto-scan timer
  const isScanningRef = useRef(false); // prevents two scans at the same time
  const referenceRef = useRef(null);   // reference visible to the scan timer

  const [stream, setStream] = useState(null);
  // Prefer the BACK camera on phones; laptops fall back to their webcam.
  const [facingMode, setFacingMode] = useState("environment");
  const [capturedImage, setCapturedImage] = useState(null);
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [isMonitoring, setIsMonitoring] = useState(false);
  const [scanIntervalSeconds, setScanIntervalSeconds] = useState(5);
  const [lastScanTime, setLastScanTime] = useState(null);
  const [scanCount, setScanCount] = useState(0);
  const [showRegions, setShowRegions] = useState(SHOW_REGIONS_DEFAULT);

<<<<<<< HEAD
  // Reference layout (a saved photo of the correct arrangement) and the
  // change analysis of the latest scan against it.
  const [reference, setReference] = useState(() => loadReference());
  const [analysis, setAnalysis] = useState(null);

  // Change-over-time tracking: the last trustworthy scan and recent events
  // (sudden removals, movements, restores) between scans.
  const lastStableAnalysisRef = useRef(null);
  const [changeEvents, setChangeEvents] = useState([]);

  // Persistent issue history for the manager review workflow.
  const [issues, setIssues] = useState(() => loadIssues());

  useEffect(() => {
    saveIssues(issues);
  }, [issues]);

  // The auto-scan interval callback must always see the latest reference.
  useEffect(() => {
    referenceRef.current = reference;
  }, [reference]);

  // YOLO display pipeline for the box overlay (supporting evidence).
  const finalDetections = buildDisplayDetections(result?.detections);

  // Region-level results for the latest scan (null until a reference is set).
  const regions = analysis?.regions ?? null;
  const referenceWarning = Boolean(analysis?.referenceMismatch);
  const { missingAlerts, movedAlerts, changedAlerts } = buildReferenceAlerts(
    analysis
  );

  // Affected areas: strong statuses only. Nothing during a mismatch.
  const affectedAreas = regions
    ? referenceWarning
      ? []
      : [...missingAlerts, ...movedAlerts, ...changedAlerts].map(
          (r) => r.areaLabel
        )
    : [];
  const uniqueAffectedAreas = [...new Set(affectedAreas)];

  // Open the camera with the requested facing mode. "ideal" (not "exact")
  // lets devices without a matching camera fall back to whatever they have.
  const openCamera = async (mode) => {
    const cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: mode } },
    });
    setStream(cameraStream);
    if (videoRef.current) {
      videoRef.current.srcObject = cameraStream;
      // Some browsers need an explicit play() even with autoPlay.
      try {
        await videoRef.current.play();
      } catch {
        // autoPlay will usually take over; ignore play() interruptions
      }
    }
  };
=======
  // Final display pipeline: filter weak boxes, drop duplicates, merge gaps,
  // then tag each remaining detection with its shelf zone (A1..C5).
  const confidentDetections =
    result?.detections?.filter(
      (d) => d.confidence >= DISPLAY_CONFIDENCE_THRESHOLD,
    ) ?? [];
  const finalDetections = mergeNearbyDetections(
    removeDuplicateDetections(confidentDetections),
  ).map((d) => ({
    ...d,
    zone:
      imgSize.w > 0 && imgSize.h > 0
        ? getZoneForBox(d.box, imgSize.w, imgSize.h)
        : null,
  }));

  // Each zone listed once, in shelf order (A1..C5).
  const affectedZones = [
    ...new Set(finalDetections.map((d) => d.zone).filter(Boolean)),
  ].sort((a, b) => {
    const rowA = a.charCodeAt(0);
    const rowB = b.charCodeAt(0);
    if (rowA !== rowB) return rowA - rowB;

    return Number(a[1]) - Number(b[1]);
  });

  const missingBookAlerts = affectedZones.map((zone) => {
    const detection = finalDetections.find((d) => d.zone === zone);

    const confidence = detection?.confidence || 0;

    return {
      zone,
      expectedBook: zonePlanogram[zone] || "Unknown book",
      confidence,
      priority: getPriority(confidence),
      message: `${zonePlanogram[zone]} may be missing from Zone ${zone}`,
    };
  });
>>>>>>> 67a7ea4 (Implement detection improvements and UI updates)

  const startCamera = async () => {
    setError("");

    // Camera API only exists on secure pages (localhost and HTTPS count).
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
<<<<<<< HEAD
        "Camera API not available in this browser. Open the site via HTTPS (tunnel link) or http://localhost:5175."
=======
        "Camera API not available in this browser. Open the site via http://localhost:5175 in Chrome or Edge.",
>>>>>>> 67a7ea4 (Implement detection improvements and UI updates)
      );
      return;
    }

    try {
      await openCamera(facingMode);
    } catch {
      setError("Camera permission denied or camera not available");
    }
  };

  // Flip between the back and front camera (phones have both).
  const switchCamera = async () => {
    const nextMode = facingMode === "environment" ? "user" : "environment";
    setError("");

    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }

    try {
      await openCamera(nextMode);
      setFacingMode(nextMode);
    } catch {
      // Could not open the other camera - try to restore the previous one.
      try {
        await openCamera(facingMode);
        setError("Could not switch camera - kept the current one");
      } catch {
        setStream(null);
        setError("Camera not available");
      }
    }
  };

  const stopMonitoring = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsMonitoring(false);
  };

  const stopCamera = () => {
    stopMonitoring(); // never leave the auto-scan running without a camera
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    setStream(null);
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  // Stop the timer and camera when the component is removed from the page.
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [stream]);

  // Save the current camera frame as the correct reference layout.
  const setReferenceLayout = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    setError("");

    if (!video || !canvas || !video.srcObject) {
      setError("Start the camera before setting a reference layout");
      return;
    }
    if (!video.videoWidth || !video.videoHeight) {
      setError("Camera is still starting - wait a second and try again");
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);

    const newReference = captureReferenceSignature(canvas);
    setReference(newReference);
    saveReference(newReference);
    setAnalysis(null); // old analysis compared against the old baseline
    lastStableAnalysisRef.current = null; // events restart from the new baseline
    setChangeEvents([]);
  };

  const clearReferenceLayout = () => {
    setReference(null);
    setAnalysis(null);
    lastStableAnalysisRef.current = null;
    setChangeEvents([]);
    clearStoredReference();
  };

  const analyzeCurrentFrame = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.srcObject) return;

    // Skip this tick if the previous scan is still running.
    if (isScanningRef.current) return;
    isScanningRef.current = true;

    setError("");
    setLoading(true);

    try {
      // If the camera has not delivered a frame yet, the video size is 0.
      if (!video.videoWidth || !video.videoHeight) {
        throw new Error(
          "Camera is still starting - wait a second and try again",
        );
      }

      // Draw the current video frame onto the hidden canvas.
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d").drawImage(video, 0, 0);

      // Turn the canvas into an image file the backend can accept.
      // Nothing is saved to disk - it all stays in browser memory.
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.9),
      );
      if (!blob) {
        throw new Error("Could not capture a frame from the camera");
      }
      const file = new File([blob], "camera_frame.jpg", { type: "image/jpeg" });

      const data = await detectShelfImage(file);
      alert("Detection API returned successfully");

      console.log("RAW DATA FROM API:", data);
      console.log("FULL JSON:", JSON.stringify(data, null, 2));
      console.log("AI RESULT:", JSON.stringify(data, null, 2));
      setResult(data);

      setResult({
        ...data,
        message:
          data.detection_count > 0
            ? "Empty shelf space detected"
            : "No empty spaces detected",
      });

      setCapturedImage((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(blob);
      });

<<<<<<< HEAD
      const data = await detectShelfImage(file);
      setResult(data);

      // Compare the frame against the saved reference layout.
      const currentReference = referenceRef.current;
      if (currentReference?.image) {
        const scanAnalysis = analyzeCurrentAgainstReference(
          currentReference,
          canvas,
          buildDisplayDetections(data.detections)
        );
        setAnalysis(scanAnalysis);

        // Change-over-time events + persistent issues. Mismatch scans are
        // skipped so a camera bump does not create fake alerts.
        if (!scanAnalysis.referenceMismatch) {
          const previous = lastStableAnalysisRef.current;
          let events = [];
          if (previous) {
            events = detectReferenceEvents(previous, scanAnalysis);
            if (events.length > 0) {
              setChangeEvents((old) => [...events, ...old].slice(0, 10));
            }
          }
          lastStableAnalysisRef.current = scanAnalysis;

          setIssues((old) => syncIssuesFromScan(old, scanAnalysis, events));
        }
      } else {
        setAnalysis(null);
      }

=======
>>>>>>> 67a7ea4 (Implement detection improvements and UI updates)
      setScanCount((count) => count + 1);
      setLastScanTime(
        new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      );
    } catch (err) {
      // Show the error but keep monitoring alive - the next tick may succeed.
      setError(err.message || "Something went wrong");
    } finally {
      setLoading(false);
      isScanningRef.current = false;
    }
  };

  const startMonitoring = () => {
    if (!stream) {
      setError("Start camera before monitoring");
      return;
    }

    setIsMonitoring(true);
    analyzeCurrentFrame(); // first scan right away, then repeat on the timer

    intervalRef.current = setInterval(() => {
      analyzeCurrentFrame();
    }, scanIntervalSeconds * 1000);
  };

  const latestResultText = result
    ? result.message ||
      (result.detection_count > 0
        ? "Empty shelf space detected"
        : "Shelf looks normal")
    : "No scans yet";

  return (
    <div className="glass-panel">
      <h2>Live Shelf Monitor</h2>
      <p className="monitor-subtitle">
        Save a reference photo of the correct layout, then scan to find
        missing or moved objects.
      </p>

      {/* CONTROLS */}
      <div className="camera-controls">
        {!stream ? (
          <button className="analyze-btn" onClick={startCamera}>
            Start Camera
          </button>
        ) : (
          <>
            <button className="stop-btn" onClick={stopCamera}>
              Stop Camera
            </button>

            <button className="analyze-btn" onClick={switchCamera}>
              Switch Camera 🔄
            </button>

            <button
              className="analyze-btn"
              onClick={analyzeCurrentFrame}
              disabled={loading}
            >
              {loading ? "Analyzing..." : "Analyze Current Frame"}
            </button>

            {!isMonitoring ? (
              <button className="monitor-btn" onClick={startMonitoring}>
                Start Monitoring
              </button>
            ) : (
              <button className="stop-btn" onClick={stopMonitoring}>
                Stop Monitoring
              </button>
            )}

            <label className="interval-label">
              Scan every:{" "}
              <select
                value={scanIntervalSeconds}
                onChange={(e) => setScanIntervalSeconds(Number(e.target.value))}
                disabled={isMonitoring}
              >
                <option value={3}>3 seconds</option>
                <option value={5}>5 seconds</option>
                <option value={10}>10 seconds</option>
              </select>
            </label>
          </>
        )}
      </div>

      {/* REFERENCE LAYOUT CONTROLS */}
      <div className="reference-controls">
        <span className="reference-status">
          Reference layout:{" "}
          {reference ? (
            <b className="safe">Set ✓ ({reference.savedAt})</b>
          ) : (
            <b className="danger">Not set</b>
          )}
        </span>

        {stream && (
          <button
            className="analyze-btn"
            onClick={setReferenceLayout}
            disabled={loading}
          >
            Set Reference Layout
          </button>
        )}

        {reference && (
          <button className="stop-btn" onClick={clearReferenceLayout}>
            Clear Reference Layout
          </button>
        )}
      </div>

      {!reference && (
        <p className="reference-hint">
          Arrange the shelf/desk correctly, start the camera, then click "Set
          Reference Layout". Any layout works — no fixed boxes. Keep the
          camera in the same position for later scans.
        </p>
      )}

      {/* MONITORING STATUS */}
      <div className="status-grid">
        <div className="status-item">
          <span className="status-label">Camera</span>
          <span className="status-value">{stream ? "On" : "Off"}</span>
        </div>
        <div className="status-item">
          <span className="status-label">Monitoring</span>
          <span className="status-value">
            {isMonitoring ? "🟢 Active" : "Stopped"}
          </span>
        </div>
        <div className="status-item">
          <span className="status-label">Reference</span>
          <span className="status-value">{reference ? "Set" : "Not set"}</span>
        </div>
        <div className="status-item">
          <span className="status-label">Scan interval</span>
          <span className="status-value">{scanIntervalSeconds} seconds</span>
        </div>
        <div className="status-item">
          <span className="status-label">Total scans</span>
          <span className="status-value">{scanCount}</span>
        </div>
        <div className="status-item">
          <span className="status-label">Last scan</span>
          <span className="status-value">{lastScanTime || "—"}</span>
        </div>
        <div className="status-item">
          <span className="status-label">Latest result</span>
          <span className="status-value">{latestResultText}</span>
        </div>
      </div>

      {error && <p className="danger">Error: {error}</p>}

      {/* LIVE PREVIEW */}
      <div className="camera-stage">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="camera-video"
          style={{ display: stream ? "block" : "none" }}
        />
        {!stream && (
          <p className="camera-hint">
            Camera is off. Click "Start Camera" to begin monitoring.
          </p>
        )}
      </div>

      {/* Hidden canvas used only for capturing frames */}
      <canvas ref={canvasRef} style={{ display: "none" }} />

      {/* CAPTURED FRAME + REPORT */}
      {capturedImage && result && (
        <div className="image-result-layout analyzed">
          <div className="image-section">
            <h3>Captured Frame</h3>

            <label className="zone-toggle">
              <input
                type="checkbox"
                checked={showRegions}
                onChange={(e) => setShowRegions(e.target.checked)}
              />
              Show Changed Areas
            </label>

            <div style={{ position: "relative", display: "inline-block" }}>
              <img
                src={capturedImage}
                alt="Captured shelf frame"
                className="preview-image"
                onLoad={(e) =>
                  setImgSize({
                    w: e.target.naturalWidth,
                    h: e.target.naturalHeight,
                  })
                }
                style={{ display: "block" }}
              />

<<<<<<< HEAD
              {/* Changed regions from the reference comparison */}
              {showRegions &&
                regions &&
                !referenceWarning &&
                regions.map((region) => (
                  <div
                    key={region.id}
                    className={`region-box region-${region.status}`}
                    style={{
                      left: `${region.box.x1 * 100}%`,
                      top: `${region.box.y1 * 100}%`,
                      width: `${(region.box.x2 - region.box.x1) * 100}%`,
                      height: `${(region.box.y2 - region.box.y1) * 100}%`,
                    }}
                  >
                    <span className="region-label">
                      {region.id} · {region.statusLabel}
                    </span>
                  </div>
                ))}
=======
              {/* Visual-only zone grid so people can see how boxes map to zones */}
              {showZoneGrid && (
                <div className="zone-grid">
                  {SHELF_ROWS.map((row) =>
                    SHELF_COLUMNS.map((col) => (
                      <div key={`${row}${col}`} className="zone-cell">
                        <span className="zone-cell-label">
                          {row}
                          {col}
                        </span>
                      </div>
                    )),
                  )}
                </div>
              )}
>>>>>>> 67a7ea4 (Implement detection improvements and UI updates)

              {/* YOLO empty-space boxes (supporting evidence) */}
              {imgSize.w > 0 &&
                finalDetections.map((d, index) => {
                  const { x1, y1, x2, y2 } = d.box;
                  return (
                    <div
                      key={index}
                      className="detection-box"
                      style={{
                        left: `${(x1 / imgSize.w) * 100}%`,
                        top: `${(y1 / imgSize.h) * 100}%`,
                        width: `${((x2 - x1) / imgSize.w) * 100}%`,
                        height: `${((y2 - y1) / imgSize.h) * 100}%`,
                      }}
                    >
                      <span className="box-label">
<<<<<<< HEAD
                        {d.class_name} {Number(d.confidence).toFixed(2)}
=======
                        {d.zone ? `${d.zone} · ` : ""}
                        {d.class_name} {(d.confidence * 100).toFixed(1)}%
>>>>>>> 67a7ea4 (Implement detection improvements and UI updates)
                      </span>
                    </div>
                  );
                })}
            </div>
          </div>

          <div className="ai-result-panel">
            <div className="report-header">
              <h2>AI Detection Report</h2>

<<<<<<< HEAD
            <div className="report-status">
              <p>{result.message}</p>

              {regions ? (
                <>
                  {referenceWarning && (
                    <p className="reference-warning">
                      ⚠ Camera/reference mismatch detected. Re-set the
                      reference layout from the same camera angle.
                    </p>
                  )}
                  <p>
                    Reference layout: <b>Set</b>
                  </p>
                  <p>
                    Changed areas: <b>{referenceWarning ? "—" : regions.length}</b>
                  </p>
                  <p>
                    Frame changed:{" "}
                    <b>{Math.round(analysis.changedFraction * 100)}%</b>
                  </p>
                  <p>
                    Possible missing objects: <b>{missingAlerts.length}</b>
                  </p>
                  <p>
                    Possible moved/replaced: <b>{movedAlerts.length}</b>
                  </p>
                  <p>
                    Changed areas needing review: <b>{changedAlerts.length}</b>
                  </p>
                  <p>
                    YOLO raw detections: <b>{result.detection_count}</b>
                  </p>
                </>
              ) : (
                <>
                  <p>
                    Reference layout: <b>Not set</b>
                  </p>
                  <p>
                    Displayed detections: <b>{finalDetections.length}</b>
                  </p>
                  <p>
                    Raw detections from backend: <b>{result.detection_count}</b>
                  </p>
                  <p>
                    Issue detected:{" "}
                    {result.issue_detected ? (
                      <span className="danger">Yes</span>
                    ) : (
                      <span className="safe">No</span>
                    )}
                  </p>
                  <p className="zone-note">
                    Set a reference layout to enable change detection — the
                    app will compare every scan against your saved photo of
                    the correct arrangement.
                  </p>
                </>
              )}
            </div>

            {regions && (
              <>
                <h3>Changed Areas</h3>

                {referenceWarning ? (
                  <p className="zone-note">
                    Alerts are hidden for this scan because the camera or
                    reference seems to have moved. Re-set the reference
                    layout, then scan again.
                  </p>
                ) : uniqueAffectedAreas.length > 0 ? (
                  <div className="zone-summary">
                    {uniqueAffectedAreas.map((area) => (
                      <span key={area} className="zone-chip">
                        {area}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="safe">
                    No changes compared to the reference 🟢
                  </p>
                )}

                <h3>Possible Missing Object Alerts</h3>

                {referenceWarning ? (
                  <p className="zone-note">
                    Hidden — re-set the reference layout first.
                  </p>
                ) : missingAlerts.length > 0 ? (
                  <div className="suggestions-grid book-alert-list">
                    {missingAlerts.map((region) => (
                      <div
                        key={region.id}
                        className="suggestion-card priority-high"
                      >
                        <span className="priority-badge badge-high">
                          POSSIBLE MISSING OBJECT
                        </span>

                        <h3>
                          {region.id} — {region.areaLabel} area
                        </h3>

                        <p className="suggestion-action">{region.message}</p>

                        <p className="alert-confidence">
                          Confidence: {Math.round(region.confidence * 100)}%
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="safe">
                    No missing object alerts from the latest scan.
                  </p>
                )}

                <h3>Possible Moved/Replaced Object Alerts</h3>

                {referenceWarning ? (
                  <p className="zone-note">
                    Hidden — re-set the reference layout first.
                  </p>
                ) : movedAlerts.length > 0 ? (
                  <div className="suggestions-grid book-alert-list">
                    {movedAlerts.map((region) => (
                      <div
                        key={region.id}
                        className="suggestion-card wrong-item"
                      >
                        <span className="priority-badge badge-wrong">
                          {region.status === "swapped"
                            ? "POSSIBLE SWAP"
                            : "POSSIBLE MOVED OBJECT"}
                        </span>

                        <h3>
                          {region.id} — {region.areaLabel} area
                        </h3>

                        <p className="suggestion-action">{region.message}</p>

                        <p className="alert-confidence">
                          Match score: {Math.round(region.confidence * 100)}%
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="safe">
                    No moved/replaced object alerts from the latest scan.
                  </p>
                )}

                <h3>Recent Shelf Events</h3>

                {changeEvents.length > 0 ? (
                  <div className="event-list">
                    {changeEvents.map((event, index) => (
                      <div
                        key={`${event.areaLabel}-${event.time}-${index}`}
                        className={`event-item event-${event.type}`}
                      >
                        <div className="event-header">
                          <span className="event-type">{event.typeLabel}</span>
                          <span className="event-time">{event.time}</span>
                        </div>
                        <p className="event-message">{event.message}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="safe">
                    No shelf events yet — events appear when an area's status
                    changes between scans.
                  </p>
                )}

                <h3>Reference Change Analysis</h3>
                {referenceWarning ? (
                  <p className="zone-note">
                    Analysis hidden — camera/reference mismatch.
                  </p>
                ) : regions.length > 0 ? (
                  <div className="zone-table-wrap">
                    <table className="zone-table">
                      <thead>
                        <tr>
                          <th>Region</th>
                          <th>Area</th>
                          <th>Status</th>
                          <th>Looks like area</th>
                          <th>Score</th>
                        </tr>
                      </thead>
                      <tbody>
                        {regions.map((region) => (
                          <tr
                            key={region.id}
                            className={`zone-row-${region.status}`}
                          >
                            <td>{region.id}</td>
                            <td>{region.areaLabel}</td>
                            <td>{region.statusLabel}</td>
                            <td>{region.matchedAreaLabel || "—"}</td>
                            <td>{Math.round(region.confidence * 100)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="safe">
                    All areas match the reference layout 🟢
                  </p>
                )}
              </>
            )}

            <p className="zone-note">
              Changes are estimated by comparing each scan with the saved
              reference photo, with empty-space detection as supporting
              evidence. The system reports areas, not item names — it does
              not read titles or labels.
            </p>
=======
              <span
                className={result.issue_detected ? "alert-badge" : "safe-badge"}
              >
                {result.issue_detected ? "Issue Found" : "Shelf Normal"}
              </span>
            </div>

            <div className="report-summary">
              <div className="summary-card">
                <span>Detections</span>
                <b>{finalDetections.length}</b>
              </div>

              <div className="summary-card">
                <span>Raw Results</span>
                <b>{result.detection_count}</b>
              </div>

              <div className="summary-card">
                <span>Status</span>
                <b>{result.issue_detected ? "Empty Space" : "Normal"}</b>
              </div>
            </div>
            {/* MISSING BOOK ALERTS */}
            <div className="missing-book-section">
              <h3>Possible Missing Book Alerts</h3>

              {missingBookAlerts.length > 0 ? (
                <div className="missing-alert-list">
                  {missingBookAlerts.map((alert, index) => (
                    <div
                      key={index}
                      className={`missing-alert-card ${alert.priority.toLowerCase()}`}
                    >
                      <div className="alert-top">
                        <span className="alert-priority">
                          {alert.priority} PRIORITY
                        </span>

                        <span className="alert-zone">Zone {alert.zone}</span>
                      </div>

                      <p>
                        <strong>Expected book:</strong> {alert.expectedBook}
                      </p>

                      <p>{alert.message}</p>

                      <small>
                        Confidence: {(alert.confidence * 100).toFixed(1)}%
                      </small>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="no-alerts">
                  No missing book alerts from the latest scan.
                </p>
              )}
            </div>
            <div className="missing-alert-section">
              <h3>Possible Missing Book Alerts</h3>

              {missingBookAlerts.length > 0 ? (
                missingBookAlerts.map((alert, index) => (
                  <div
                    key={index}
                    className={`missing-alert ${alert.priority.toLowerCase()}`}
                  >
                    <h4>{alert.priority} Priority</h4>

                    <p>
                      <b>Zone:</b> {alert.zone}
                    </p>

                    <p>
                      <b>Expected Book:</b> {alert.expectedBook}
                    </p>

                    <p>{alert.message}</p>

                    <p>Confidence: {(alert.confidence * 100).toFixed(1)}%</p>
                  </div>
                ))
              ) : (
                <p>No possible missing books detected.</p>
              )}
            </div>
>>>>>>> 67a7ea4 (Implement detection improvements and UI updates)
          </div>
        </div>
      )}

      {/* ISSUE REVIEW WORKFLOW */}
      <IssueReviewPanel
        issues={issues}
        lastScanTime={lastScanTime}
        onUpdateStatus={(id, status) =>
          setIssues((old) => updateIssueStatus(old, id, status))
        }
        onClearHistory={() => {
          setIssues([]);
          clearStoredIssues();
        }}
      />
    </div>
  );
}
