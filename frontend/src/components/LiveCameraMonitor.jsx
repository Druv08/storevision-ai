import { useEffect, useRef, useState } from "react";
import { detectShelfImage } from "../services/detectionApi";
import { zonePlanogram } from "../config/zonePlanogram";
import {
  SHELF_ROWS,
  SHELF_COLUMNS,
  getZoneForBox,
  buildDisplayDetections,
  getZoneConfidence,
  getAlertPriority,
  createZoneSignatures,
  analyzeZonesAgainstReference,
  buildZoneAlerts,
  detectZoneEvents,
  loadReference,
  saveReference,
  clearStoredReference,
} from "../utils/zoneAnalysis";
import {
  loadIssues,
  saveIssues,
  clearStoredIssues,
  syncIssuesFromScan,
  updateIssueStatus,
} from "../utils/issueHistory";
import IssueReviewPanel from "./IssueReviewPanel";

const SHOW_ZONE_GRID_DEFAULT = true;

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
  const [showZoneGrid, setShowZoneGrid] = useState(SHOW_ZONE_GRID_DEFAULT);

  // Reference layout (correct shelf) + per-zone comparison of the last scan.
  const [reference, setReference] = useState(() => loadReference());
  const [zoneAnalysis, setZoneAnalysis] = useState(null);

  // Change-over-time tracking: the last trustworthy scan and recent events
  // (sudden removals, possible replacements, restocks) between scans.
  const lastStableAnalysisRef = useRef(null); // previous zone analysis
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

  // Display pipeline for the box overlay, tagged with shelf zones.
  const finalDetections = buildDisplayDetections(result?.detections).map(
    (d) => ({
      ...d,
      zone:
        imgSize.w > 0 && imgSize.h > 0
          ? getZoneForBox(d.box, imgSize.w, imgSize.h)
          : null,
    })
  );

  // Reference-based results for the latest scan (null until a reference is set).
  const analysisRows = zoneAnalysis?.zones ?? null;
  const analysisByZone = analysisRows
    ? Object.fromEntries(analysisRows.map((row) => [row.zone, row]))
    : null;
  const { missingItemAlerts, wrongItemAlerts, changedZones, unclearZones, okZones } =
    buildZoneAlerts(analysisRows ?? []);
  const okZoneCount = okZones.length;

  // The analyzer flags scans where the camera/reference clearly moved.
  const referenceWarning = Boolean(zoneAnalysis?.referenceMismatch);

  // Affected = strong statuses only (missing/wrong + confident changes).
  // On a reference mismatch nothing is shown as a real alert.
  const affectedZones = analysisRows
    ? referenceWarning
      ? []
      : [...missingItemAlerts, ...wrongItemAlerts, ...changedZones]
          .map((row) => row.zone)
          .sort()
    : [...new Set(finalDetections.map((d) => d.zone).filter(Boolean))].sort();

  // YOLO-only fallback alerts, used until a reference layout is set.
  const fallbackMissingAlerts = analysisRows
    ? []
    : affectedZones
        .map((zone) => {
          const expectedItem = zonePlanogram[zone] || "Unknown item";
          const confidence = getZoneConfidence(zone, finalDetections);

          return {
            zone,
            expectedItem,
            confidence,
            priority: getAlertPriority(confidence),
            message: `${expectedItem} may be missing from Zone ${zone}`,
          };
        })
        .sort((a, b) => b.confidence - a.confidence);

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

  // Capture the current camera frame as the correct shelf layout.
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

    const newReference = {
      savedAt: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
      signatures: createZoneSignatures(canvas),
    };

    setReference(newReference);
    saveReference(newReference);
    setZoneAnalysis(null); // the old analysis compared against the old baseline
    lastStableAnalysisRef.current = null; // events restart from the new baseline
    setChangeEvents([]);
  };

  const clearReferenceLayout = () => {
    setReference(null);
    setZoneAnalysis(null);
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

      // Zone-by-zone comparison against the saved reference layout.
      const currentReference = referenceRef.current;
      if (currentReference?.signatures) {
        const currentSignatures = createZoneSignatures(canvas);
        const analysis = analyzeZonesAgainstReference({
          currentSignatures,
          referenceSignatures: currentReference.signatures,
          planogram: zonePlanogram,
          detections: buildDisplayDetections(data.detections),
          frameWidth: canvas.width,
          frameHeight: canvas.height,
        });
        setZoneAnalysis(analysis);

        // Change-over-time events: compare with the previous trustworthy
        // scan. Mismatch scans are skipped so a camera bump does not create
        // a wall of fake removal events or fake issues.
        if (!analysis.referenceMismatch) {
          const previous = lastStableAnalysisRef.current;
          let events = [];
          if (previous) {
            events = detectZoneEvents(previous.zones, analysis.zones);
            if (events.length > 0) {
              setChangeEvents((old) => [...events, ...old].slice(0, 10));
            }
          }
          lastStableAnalysisRef.current = analysis;

          // Persistent issue history: one active issue per real problem,
          // no duplicate spam while the same zone stays broken.
          setIssues((old) => syncIssuesFromScan(old, analysis.zones, events));
        }
      } else {
        setZoneAnalysis(null);
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
          Stock the shelf correctly, start the camera, then click "Set
          Reference Layout". Keep the camera in the same position for later
          scans so zones line up.
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

              {/* Zone grid, colored by the reference comparison when available */}
              {showZoneGrid && (
                <div className="zone-grid">
                  {SHELF_ROWS.map((row) =>
                    SHELF_COLUMNS.map((col) => {
                      const zoneId = `${row}${col}`;
                      const zoneStatus = analysisByZone?.[zoneId]?.status;
                      return (
                        <div
                          key={zoneId}
                          className={`zone-cell${
                            zoneStatus ? ` zone-${zoneStatus}` : ""
                          }`}
                        >
                          <span className="zone-cell-label">{zoneId}</span>
                        </div>
                      );
                    })
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

              {analysisRows ? (
                <>
                  {referenceWarning && (
                    <p className="reference-warning">
                      ⚠ Many zones changed at once. The camera angle probably
                      moved — re-set the reference layout from the same
                      position.
                    </p>
                  )}
                  <p>
                    Reference layout: <b>Set</b>
                  </p>
                  <p>
                    Total zones: <b>{analysisRows.length}</b>
                  </p>
                  <p>
                    OK zones: <b>{okZoneCount}</b>
                  </p>
                  <p>
                    Affected zones: <b>{affectedZones.length}</b>
                  </p>
                  <p>
                    Possible missing items: <b>{missingItemAlerts.length}</b>
                  </p>
                  <p>
                    Possible wrong/replaced items:{" "}
                    <b>{wrongItemAlerts.length}</b>
                  </p>
                  <p>
                    Changed zones needing review: <b>{changedZones.length}</b>
                  </p>
                  <p>
                    Unclear zones: <b>{unclearZones.length}</b>
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
                    Affected zones: <b>{affectedZones.length}</b>
                  </p>
                  <p>
                    Possible missing items: <b>{fallbackMissingAlerts.length}</b>
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
                    Set a reference layout to enable zone-by-zone comparison —
                    it catches missing items even when the detector misses a
                    gap.
                  </p>
                </>
              )}
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

            {referenceWarning ? (
              <p className="zone-note">
                Alerts are hidden for this scan because the reference/camera
                seems to have moved. Re-set the reference layout, then scan
                again.
              </p>
            ) : affectedZones.length > 0 ? (
              <div className="zone-summary">
                {affectedZones.map((zone) => (
                  <span key={zone} className="zone-chip">
                    {zone}
                  </span>
                ))}
              </div>
            ) : (
              <p className="safe">No affected zones in this frame 🟢</p>
            )}

            <h3>Possible Missing Item Alerts</h3>

            {referenceWarning ? (
              <p className="zone-note">
                Hidden — re-set the reference layout first.
              </p>
            ) : (analysisRows ? missingItemAlerts : fallbackMissingAlerts)
                .length > 0 ? (
              <div className="suggestions-grid book-alert-list">
                {(analysisRows ? missingItemAlerts : fallbackMissingAlerts).map(
                  (alert) => {
                    const priority = getAlertPriority(alert.confidence);
                    return (
                      <div
                        key={alert.zone}
                        className={`suggestion-card priority-${priority.toLowerCase()}`}
                      >
                        <span
                          className={`priority-badge badge-${priority.toLowerCase()}`}
                        >
                          {priority.toUpperCase()} PRIORITY
                        </span>

                        <h3>Zone {alert.zone}</h3>

                        <p className="suggestion-issue">
                          Expected item: {alert.expectedItem}
                        </p>

                        <p className="suggestion-action">
                          {alert.expectedItem} may be missing from Zone{" "}
                          {alert.zone}
                        </p>

                        <p className="alert-confidence">
                          Confidence: {Math.round(alert.confidence * 100)}%
                        </p>
                      </div>
                    );
                  }
                )}
              </div>
            ) : (
              <p className="safe">
                No missing item alerts from the latest scan.
              </p>
            )}

            {analysisRows && (
              <>
                <h3>Possible Wrong Item Alerts</h3>

                {referenceWarning ? (
                  <p className="zone-note">
                    Hidden — re-set the reference layout first.
                  </p>
                ) : wrongItemAlerts.length > 0 ? (
                  <div className="suggestions-grid book-alert-list">
                    {wrongItemAlerts.map((alert) => (
                      <div
                        key={alert.zone}
                        className="suggestion-card wrong-item"
                      >
                        <span className="priority-badge badge-wrong">
                          {alert.isSwapPair
                            ? "POSSIBLE SWAP"
                            : "POSSIBLE WRONG ITEM"}
                        </span>

                        <h3>Zone {alert.zone}</h3>

                        <p className="suggestion-issue">
                          Expected item: {alert.expectedItem}
                        </p>

                        <p className="suggestion-action">
                          Zone {alert.zone} may contain the wrong item. It
                          looks like {alert.matchedItem} from Zone{" "}
                          {alert.matchedZone}.
                        </p>

                        {alert.isSwapPair && (
                          <p className="suggestion-issue">
                            Zones {alert.zone} and {alert.matchedZone} appear
                            to have exchanged items.
                          </p>
                        )}

                        <p className="alert-confidence">
                          Match score: {Math.round(alert.confidence * 100)}%
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="safe">
                    No wrong item alerts from the latest scan.
                  </p>
                )}

                <h3>Recent Shelf Events</h3>

                {changeEvents.length > 0 ? (
                  <div className="event-list">
                    {changeEvents.map((event, index) => (
                      <div
                        key={`${event.zone}-${event.time}-${index}`}
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
                    No shelf events yet — events appear when a zone's status
                    changes between scans.
                  </p>
                )}

                <h3>Zone Analysis</h3>
                <div className="zone-table-wrap">
                  <table className="zone-table">
                    <thead>
                      <tr>
                        <th>Zone</th>
                        <th>Expected item</th>
                        <th>Status</th>
                        <th>Matched item</th>
                        <th>Matched zone</th>
                        <th>Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysisRows.map((row) => (
                        <tr key={row.zone} className={`zone-row-${row.status}`}>
                          <td>{row.zone}</td>
                          <td>{row.expectedItem}</td>
                          <td>{row.statusLabel}</td>
                          <td>{row.matchedItem || "—"}</td>
                          <td>{row.matchedZone || "—"}</td>
                          <td>{Math.round(row.confidence * 100)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <p className="zone-note">
              Zone status is estimated by comparing each zone with the saved
              reference layout, with empty-space detection as supporting
              evidence. Item names come from the configured planogram — the
              system does not read titles or labels.
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
