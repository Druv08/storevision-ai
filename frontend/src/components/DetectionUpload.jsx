import { useState } from "react";
import { detectShelfImage } from "../services/detectionApi";
import { zonePlanogram } from "../config/zonePlanogram";

function DetectionUpload() {
  const [image, setImage] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [imageSize, setImageSize] = useState({
    width: 0,
    height: 0,
  });

  function handleImageChange(event) {
    const file = event.target.files[0];

    if (!file) return;

    setImage(file);
    setPreview(URL.createObjectURL(file));
    setResult(null);
    setError("");
  }

  const handleDetect = async () => {
    if (!image) return;

    setLoading(true);
    setError("");

    try {
      const response = await detectShelfImage(image);

      console.log("FULL AI RESPONSE:", JSON.stringify(response, null, 2));

      console.log("DETECTIONS FOR BOX DRAWING:", response.detections);

      setResult(response);
    } catch (err) {
      setError(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  function getZoneForBox(box) {
    const centerX = (box.x1 + box.x2) / 2;
    const centerY = (box.y1 + box.y2) / 2;

    let row;

    if (centerY < 341) {
      row = "A";
    } else if (centerY < 682) {
      row = "B";
    } else {
      row = "C";
    }

    let column;

    if (centerX < 205) {
      column = "1";
    } else if (centerX < 410) {
      column = "2";
    } else if (centerX < 614) {
      column = "3";
    } else if (centerX < 819) {
      column = "4";
    } else {
      column = "5";
    }

    return `${row}${column}`;
  }

  return (
    <div className="detection-upload">
      <h2>AI Shelf Detection</h2>

      <input type="file" accept="image/*" onChange={handleImageChange} />

      {preview && (
        <div className="image-container">
          <img
            src={preview}
            alt="Shelf preview"
            className="shelf-image"
            onLoad={(e) => {
              setImageSize({
                width: e.target.naturalWidth,
                height: e.target.naturalHeight,
              });
            }}
          />
          {result?.detections?.map((det, index) => {
            const displayedWidth = 700;
            const scaleX = displayedWidth / imageSize.width;
            const displayedHeight = imageSize.height * scaleX;
            const scaleY = displayedHeight / imageSize.height;

            return (
              <div
                key={index}
                className="detection-box"
                style={{
                  left: `${det.box.x1 * scaleX}px`,
                  top: `${det.box.y1 * scaleY}px`,
                  width: `${(det.box.x2 - det.box.x1) * scaleX}px`,
                  height: `${(det.box.y2 - det.box.y1) * scaleY}px`,
                }}
              >
                <span>
                  Empty space detected
                  <br />
                  Confidence: {(det.confidence * 100).toFixed(1)}%
                </span>
              </div>
            );
          })}
        </div>
      )}
      <br />

      <button onClick={handleDetect} disabled={!image || loading}>
        {loading ? "Analyzing..." : "Analyze Shelf"}
      </button>

      {error && <p>Error: {error}</p>}

      {result && (
        <div>
          <h3>Result</h3>

          <p>Message: {result.message}</p>

          <p>Detection Count: {result.detection_count}</p>

          <p>Issue Detected: {result.issue_detected ? "Yes" : "No"}</p>

          <h4>Detections</h4>

          {result.annotated_image && (
            <div>
              <h4>Annotated Result</h4>

              <img
                src={`http://127.0.0.1:8001${result.annotated_image}`}
                alt="Annotated detection"
                width="400"
              />
            </div>
          )}

          {result.detections.map((item, index) => (
            <div key={index}>
              {index + 1}. {item.class_name}
              {" - "}
              Confidence: {item.confidence}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default DetectionUpload;
