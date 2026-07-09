import { useState } from "react";
import { detectShelfImage } from "../services/detectionApi";

function DetectionUpload() {
  const [image, setImage] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function handleImageChange(event) {
    const file = event.target.files[0];

    if (!file) return;

    setImage(file);
    setPreview(URL.createObjectURL(file));
    setResult(null);
    setError("");
  }

  async function handleDetect() {
    try {
      setLoading(true);
      setError("");

      const response = await detectShelfImage(image);

      setResult(response);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="detection-upload">
      <h2>AI Shelf Detection</h2>

      <input type="file" accept="image/*" onChange={handleImageChange} />

      {preview && <img src={preview} alt="Shelf preview" width="400" />}

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
