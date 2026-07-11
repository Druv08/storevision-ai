import { useEffect, useState } from "react";
import "./App.css";
import SmartSuggestions from "./components/SmartSuggestions";

const API_BASE_URL = "http://127.0.0.1:8000";

export default function App() {
  const [products, setProducts] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [shelf, setShelf] = useState({});
  const [connected, setConnected] = useState(null);
  const [loading, setLoading] = useState(false);

  const [selectedFile, setSelectedFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [aiResult, setAiResult] = useState(null);
  const [resultImage, setResultImage] = useState(null);
  const [imageSize, setImageSize] = useState({
    width: 0,
    height: 0,
  });
  const [originalSize, setOriginalSize] = useState({
    width: 1,
    height: 1,
  });

  const [lastScan, setLastScan] = useState("Not scanned yet");

  const [showAlerts, setShowAlerts] = useState(false);

  const fetchProducts = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/products`);
      const data = await res.json();

      setProducts(data.products || []);
      setConnected(true);
    } catch {
      setConnected(false);
    }
  };

  const fetchShelf = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/shelf-layout`);
      const data = await res.json();

      setShelf(data || {});
      setConnected(true);
    } catch {
      setConnected(false);
    }
  };

  const fetchAlerts = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/alerts`);
      const data = await res.json();

      setAlerts(data.alerts || []);
      setConnected(true);
    } catch {
      setConnected(false);
    }
  };

  const uploadImage = async () => {
    if (!selectedFile) {
      alert("Please select an image first");
      return;
    }
    setLoading(true);

    const formData = new FormData();
    formData.append("file", selectedFile);

    try {
      const res = await fetch(`${API_BASE_URL}/upload-image`, {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      console.log("AI RESPONSE:", data);

      setAiResult(data.ai_detection);

      setAlerts(data.alerts || []);

      if (data.ai_detection?.annotated_image) {
        const imagePath = data.ai_detection.annotated_image;

        setResultImage(`${API_BASE_URL}/${imagePath.replace(/^\/+/, "")}`);
      }

      setLastScan(
        new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );

      setConnected(true);
      setLoading(false);
    } catch (error) {
      console.log(error);

      setConnected(false);
      setLoading(false);
    }
  };

  const checkBackend = async () => {
    try {
      await fetch(`${API_BASE_URL}/health`);
      setConnected(true);
    } catch {
      setConnected(false);
    }
  };

  useEffect(() => {
    checkBackend();
    fetchProducts();
    fetchShelf();
    fetchAlerts();

    const interval = setInterval(() => {
      checkBackend();
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  const handleFile = (e) => {
    const file = e.target.files[0];

    if (file) {
      setSelectedFile(file);

      setPreview(URL.createObjectURL(file));

      setAiResult(null);

      setResultImage(null);
    }
  };

  const alertIcon = (type) => {
    if (type === "expired_product") return "🔴";
    if (type === "missing_item") return "🔴";
    if (type === "wrong_placement") return "🟡";
    return "🟢";
  };

  const isGood = (status) => {
    return status === "available" || status === "ok" || status === "healthy";
  };

  return (
    <div className="app">
      {/* HEADER */}

      <div className="header">
        <h1>StoreVision AI</h1>

        <span className="status">
          {connected === null
            ? "⏳ Connecting..."
            : connected
              ? "🟢 Backend connected"
              : "🔴 Backend offline"}
        </span>
      </div>

      {/* WELCOME MESSAGE */}
      <div className="welcome-box">
        <div className="welcome-icon"></div>

        <h2>Welcome back to the Store Vision AI</h2>
        <p>Let's make your inventory management effortless today.</p>
      </div>

      {/* DASHBOARD CARDS */}

      <div className="stats-grid">
        <div className="stat-card">
          <h3>📦 Total Items</h3>

          <p>{products.length}</p>
        </div>

        <div
          className="stat-card alert-card"
          onClick={() => setShowAlerts(true)}
        >
          <h3>🚨 Active Alerts</h3>

          <p>{alerts.length}</p>
        </div>

        <div className="stat-card">
          <h3>🕒 Last Scan</h3>

          <p className="scan-time">{lastScan}</p>
        </div>
      </div>

      {/* SMART SUGGESTIONS */}
      <SmartSuggestions />

      {/* IMAGE ANALYSIS */}
      <div className="glass-panel">
        <h2>Analyze Shelf Image</h2>
        <div className="upload-row">
          <label className="file-btn">
            Choose a file
            <input type="file" accept="image/*" onChange={handleFile} />
          </label>

          <span className="file-name">
            {selectedFile ? selectedFile.name : "No file chosen yet"}
          </span>

          <button
            className="analyze-btn"
            onClick={uploadImage}
            disabled={loading}
          >
            {loading ? "Analyzing..." : "Analyze Shelf"}
          </button>
        </div>

        {preview && (
          <div
            className={
              aiResult ? "image-result-layout analyzed" : "image-result-layout"
            }
          >
            {/* IMAGE SECTION */}
            <div className="image-section">
              <h3>Selected Image</h3>

              <div className={`image-wrapper ${loading ? "scanning" : ""}`}>
                <img
                  src={preview}
                  className="preview-image"
                  alt="shelf"
                  onLoad={(e) => {
                    setOriginalSize({
                      width: e.target.naturalWidth,
                      height: e.target.naturalHeight,
                    });

                    setImageSize({
                      width: e.target.width,
                      height: e.target.height,
                    });
                  }}
                />
                {loading && <div className="scan-line"></div>}

                {aiResult?.detections?.map((detection, index) => {
                  const [x1, y1, x2, y2] = detection.box;
                  const scaleX = imageSize.width / originalSize.width;

                  const scaleY = imageSize.height / originalSize.height;

                  return (
                    <div
                      key={index}
                      className="detection-box"
                      style={{
                        left: x1 * scaleX,

                        top: y1 * scaleY,

                        width: (x2 - x1) * scaleX,

                        height: (y2 - y1) * scaleY,
                      }}
                    />
                  );
                })}
              </div>
            </div>

            {/* AI REPORT CARD */}
            {aiResult && (
              <div className="ai-result-panel">
                <h2>AI Detection Report</h2>

                <div className="report-status">
                  <p>
                    📦 Detection Count:
                    <b> {aiResult.detection_count}</b>
                  </p>

                  <p>
                    Status:
                    {aiResult.issue_detected ? (
                      <span className="danger">🔴 Empty spaces detected</span>
                    ) : (
                      <span className="safe">🟢 Shelf looks good</span>
                    )}
                  </p>
                </div>

                <h3>Detected Areas</h3>

                <div className="detection-list">
                  {aiResult.detections?.map((detection, index) => (
                    <div key={index} className="detection-item">
                      <div className="detection-title">Empty-space</div>

                      <div className="confidence">
                        Confidence:
                        <b>{(detection.confidence * 100).toFixed(1)}%</b>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* INVENTORY */}

      <div className="glass-panel">
        <h2>Inventory</h2>

        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Category</th>
              <th>Slot</th>
              <th>Status</th>
            </tr>
          </thead>

          <tbody>
            {products.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>

                <td>{p.category}</td>

                <td>{p.slot}</td>

                <td>
                  {isGood(p.status) ? "🟢" : "🔴"} {p.status}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* SHELF */}

      <div className="glass-panel">
        <h2>Shelf Layout</h2>

        <table>
          <thead>
            <tr>
              <th>Slot</th>

              <th>Expected Product</th>
            </tr>
          </thead>

          <tbody>
            {Object.entries(shelf).map(([slot, name]) => (
              <tr key={slot}>
                <td>{slot}</td>

                <td>{name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ALERT POPUP */}

      {showAlerts && (
        <div className="overlay" onClick={() => setShowAlerts(false)}>
          <div className="popup" onClick={(e) => e.stopPropagation()}>
            <h2>System Alerts</h2>

            {alerts.map((a, i) => (
              <div key={i} className="alert-row">
                <span>{alertIcon(a.type)}</span>

                <span>{a.message}</span>
              </div>
            ))}

            <button onClick={() => setShowAlerts(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
