import { useEffect, useState } from "react";
import { fetchSmartSuggestions } from "../services/suggestionsApi";

export default function SmartSuggestions() {
  const [suggestions, setSuggestions] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchSmartSuggestions()
      .then((data) => setSuggestions(data.suggestions || []))
      .catch((err) => setError(err.message || "Failed to load suggestions"));
  }, []);

  return (
    <div className="glass-panel">
      <h2>Smart Suggestions</h2>

      {error && <p className="danger">Error: {error}</p>}

      {!error && suggestions.length === 0 && (
        <p className="safe">All good — no suggestions right now 🟢</p>
      )}

      <div className="suggestions-grid">
        {suggestions.map((s, index) => (
          <div
            key={index}
            className={`suggestion-card priority-${s.priority.toLowerCase()}`}
          >
            <span className={`priority-badge badge-${s.priority.toLowerCase()}`}>
              {s.priority.toUpperCase()} PRIORITY
            </span>

            <h3>{s.product}</h3>

            <p className="suggestion-issue">{s.issue}</p>

            <p className="suggestion-action">{s.action}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
