import { useEffect, useRef, useState } from "react";
import { detectShelfImage } from "../services/detectionApi";

// Display-only tuning (same values chosen in the Day 18/19 threshold tests).
const DISPLAY_CONFIDENCE_THRESHOLD = 0.35; // hide weak/noisy boxes
const IOU_SUPPRESSION_THRESHOLD = 0.4;     // overlapping boxes above this are duplicates

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
    Math.max(0, Math.floor((centerX / imageWidth) * SHELF_COLUMNS.length))
  );

  const rowIndex = Math.min(
    SHELF_ROWS.length - 1,
    Math.max(0, Math.floor((centerY / imageHeight) * SHELF_ROWS.length))
  );

  return `${SHELF_ROWS[rowIndex]}${SHELF_COLUMNS[colIndex]}`;
}

export default function LiveCameraMonitor() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const intervalRef = useRef(null);   // auto-scan timer
  const isScanningRef = useRef(false); // prevents two scans at the same time

  const [stream, setStream] = useState(null);
  const [capturedImage, setCapturedImage] = useState(null);
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [isMonitoring, setIsMonitoring] = useState(false);
  const [scanIntervalSeconds, setScanIntervalSeconds] = useState(5);
  const [lastScanTime, setLastScanTime] = useState(null);
  const [scanCount, setScanCount] = useState(0);
  const [showZoneGrid, setShowZoneGrid] = useState(SHOW_ZONE_GRID_DEFAULT);

  // Final display pipeline: filter weak boxes, drop duplicates, merge gaps,
  // then tag each remaining detection with its shelf zone (A1..C5).
  const confidentDetections =
    result?.detections?.filter(
      (d) => d.confidence >= DISPLAY_CONFIDENCE_THRESHOLD
    ) ?? [];
  const finalDetections = mergeNearbyDetections(
    removeDuplicateDetections(confidentDetections)
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
  ].sort();

  const startCamera = async () => {
    setError("");

    // Camera API only exists on secure pages (localhost counts as secure).
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        "Camera API not available in this browser. Open the site via http://localhost:5175 in Chrome or Edge."
      );
      return;
    }

    try {
      const cameraStream = await navigator.mediaDevices.getUserMedia({
        video: true,
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
    } catch {
      setError("Camera permission denied or camera not available");
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
        throw new Error("Camera is still starting - wait a second and try again");
      }

      // Draw the current video frame onto the hidden canvas.
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d").drawImage(video, 0, 0);

      // Turn the canvas into an image file the backend can accept.
      // Nothing is saved to disk - it all stays in browser memory.
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.9)
      );
      if (!blob) {
        throw new Error("Could not capture a frame from the camera");
      }
      const file = new File([blob], "camera_frame.jpg", { type: "image/jpeg" });

      setCapturedImage((old) => {
        if (old) URL.revokeObjectURL(old); // free the previous frame's memory
        return URL.createObjectURL(blob);
      });

      const data = await detectShelfImage(file);
      setResult(data);
      setScanCount((count) => count + 1);
      setLastScanTime(
        new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
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
    ? result.message
    : "No scans yet";

  return (
    <div className="glass-panel">
      <h2>Live Shelf Monitor</h2>
      <p className="monitor-subtitle">
        Turn on the camera and scan the shelf for empty spaces.
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
                checked={showZoneGrid}
                onChange={(e) => setShowZoneGrid(e.target.checked)}
              />
              Show Shelf Zones
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
                    ))
                  )}
                </div>
              )}

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
                        {d.zone ? `${d.zone} · ` : ""}
                        {d.class_name} {Number(d.confidence).toFixed(2)}
                      </span>
                    </div>
                  );
                })}
            </div>
          </div>

          <div className="ai-result-panel">
            <h2>Detection Report</h2>

            <div className="report-status">
              <p>{result.message}</p>
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
            </div>

            {finalDetections.length > 0 && (
              <>
                <h3>Detected Areas</h3>
                <div className="detection-list">
                  {finalDetections.map((d, index) => (
                    <div key={index} className="detection-item">
                      <div className="detection-title">
                        {index + 1}. {d.zone ? `Zone ${d.zone} — ` : ""}
                        {d.class_name}
                      </div>
                      <div className="confidence">
                        {Number(d.confidence).toFixed(2)} confidence
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            <h3>Affected Shelf Zones</h3>
            <p>
              Affected zones: <b>{affectedZones.length}</b>
            </p>

            {affectedZones.length > 0 ? (
              <div className="zone-summary">
                {affectedZones.map((zone) => (
                  <span key={zone} className="zone-chip">
                    {zone}
                  </span>
                ))}
              </div>
            ) : (
              <p className="safe">No empty zones in this frame 🟢</p>
            )}

            <p className="zone-note">
              Zone mapping is estimated using the position of detected empty
              spaces in the camera frame.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
