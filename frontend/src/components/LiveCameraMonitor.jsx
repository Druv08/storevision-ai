import { useEffect, useRef, useState } from "react";
import { detectShelfImage } from "../services/detectionApi";
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

// One report section of alert cards (presentation only). Kept tiny so the heavy
// image logic stays in referenceImageAnalysis.js.
function AlertSection({
  title,
  badge,
  badgeClass,
  cardClass,
  alerts,
  emptyText,
  scoreLabel = "Confidence",
  hidden,
}) {
  return (
    <>
      <h3>{title}</h3>
      {hidden ? (
        <p className="zone-note">Hidden — re-set the reference layout first.</p>
      ) : alerts.length > 0 ? (
        <div className="suggestions-grid book-alert-list">
          {alerts.map((region) => (
            <div key={region.id} className={`suggestion-card ${cardClass}`}>
              <span className={`priority-badge ${badgeClass}`}>{badge}</span>
              <h3>
                {region.id} — {region.areaLabel} area
              </h3>
              <p className="suggestion-action">{region.message}</p>
              <p className="alert-confidence">
                {scoreLabel}: {Math.round(region.confidence * 100)}%
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="safe">{emptyText}</p>
      )}
    </>
  );
}

export default function LiveCameraMonitor() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const intervalRef = useRef(null);   // auto-scan timer
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
  const {
    emptySpaceAlerts,
    missingAlerts,
    movedAlerts,
    swapAlerts,
    addedAlerts,
    changedAlerts,
  } = buildReferenceAlerts(analysis);

  // Affected areas: strong statuses only. Nothing during a mismatch.
  // (missingAlerts already includes empty spaces, so they are not double-added.)
  const affectedAreas = regions
    ? referenceWarning
      ? []
      : [
          ...missingAlerts,
          ...addedAlerts,
          ...movedAlerts,
          ...swapAlerts,
          ...changedAlerts,
        ].map((r) => r.areaLabel)
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

  const startCamera = async () => {
    setError("");

    // Camera API only exists on secure pages (localhost and HTTPS count).
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        "Camera API not available in this browser. Open the site via HTTPS (tunnel link) or http://localhost:5175."
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
        Save a reference photo of the correct layout, then scan to find empty
        spaces, missing, moved, swapped, or newly added objects — for any shelf,
        desk, or rack. No fixed boxes, no item names.
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

      {/* REAL-STORE INSTRUCTIONS (keep phone angle stable) */}
      <p className="reference-instructions">
        📌 Set the reference from the same camera angle before scanning. Keep the
        phone steady and the angle stable. If the whole layout changes too much,
        re-set the reference layout.
      </p>

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
                    Empty spaces: <b>{emptySpaceAlerts.length}</b>
                  </p>
                  <p>
                    Possible missing objects: <b>{missingAlerts.length}</b>
                  </p>
                  <p>
                    Added / new objects: <b>{addedAlerts.length}</b>
                  </p>
                  <p>
                    Possible moved: <b>{movedAlerts.length}</b>
                  </p>
                  <p>
                    Possible swaps: <b>{swapAlerts.length}</b>
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

                <AlertSection
                  title="Empty Space Alerts"
                  badge="EMPTY SPACE"
                  badgeClass="badge-high"
                  cardClass="priority-high"
                  alerts={emptySpaceAlerts}
                  emptyText="No empty-space alerts from the latest scan."
                  hidden={referenceWarning}
                />

                <AlertSection
                  title="Possible Missing Object Alerts"
                  badge="POSSIBLE MISSING OBJECT"
                  badgeClass="badge-high"
                  cardClass="priority-high"
                  alerts={missingAlerts}
                  emptyText="No missing object alerts from the latest scan."
                  hidden={referenceWarning}
                />

                <AlertSection
                  title="Added / New Object Alerts"
                  badge="ADDED OBJECT"
                  badgeClass="badge-added"
                  cardClass="added-item"
                  alerts={addedAlerts}
                  emptyText="No added-object alerts from the latest scan."
                  hidden={referenceWarning}
                />

                <AlertSection
                  title="Possible Moved Object Alerts"
                  badge="POSSIBLE MOVED OBJECT"
                  badgeClass="badge-wrong"
                  cardClass="wrong-item"
                  alerts={movedAlerts}
                  emptyText="No moved-object alerts from the latest scan."
                  scoreLabel="Match score"
                  hidden={referenceWarning}
                />

                <AlertSection
                  title="Possible Swap / Replacement Alerts"
                  badge="POSSIBLE SWAP"
                  badgeClass="badge-wrong"
                  cardClass="wrong-item"
                  alerts={swapAlerts}
                  emptyText="No swap/replacement alerts from the latest scan."
                  scoreLabel="Match score"
                  hidden={referenceWarning}
                />

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
                          <th>Change type</th>
                          <th>Confidence</th>
                          <th>Message</th>
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
                            <td>{Math.round(region.confidence * 100)}%</td>
                            <td>{region.message}</td>
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
