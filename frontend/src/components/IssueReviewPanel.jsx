import { useState } from "react";
import {
  ISSUE_TYPE_LABELS,
  ISSUE_STATUS_LABELS,
  computeIssueStats,
  buildIssueReportJson,
} from "../utils/issueHistory";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "new", label: "New" },
  { id: "reviewing", label: "Reviewing" },
  { id: "resolved", label: "Resolved" },
  { id: "false_alarm", label: "False Alarm" },
  { id: "missing", label: "Missing/Empty" },
  { id: "moved", label: "Moved/Swapped" },
  { id: "added", label: "Added" },
  { id: "changed", label: "Changed" },
];

function matchesFilter(issue, filter) {
  switch (filter) {
    case "all":
      return true;
    case "new":
    case "reviewing":
    case "resolved":
    case "false_alarm":
      return issue.status === filter;
    case "missing":
      return (
        issue.type === "empty_space" ||
        issue.type === "missing" ||
        issue.type === "suspicious_removal"
      );
    case "moved":
      return issue.type === "moved" || issue.type === "swapped";
    case "added":
      return issue.type === "added";
    case "changed":
      return issue.type === "changed";
    default:
      return true;
  }
}

export default function IssueReviewPanel({
  issues,
  lastScanTime,
  onUpdateStatus,
  onClearHistory,
}) {
  const [filter, setFilter] = useState("all");

  const stats = computeIssueStats(issues);
  const visibleIssues = issues.filter((issue) => matchesFilter(issue, filter));

  const handleExport = () => {
    const blob = new Blob([buildIssueReportJson(issues)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "storevision-issue-report.json";
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleClear = () => {
    const sure = window.confirm(
      "Clear the entire issue history? The reference layout is NOT affected."
    );
    if (sure) {
      onClearHistory();
    }
  };

  return (
    <div className="glass-panel issue-panel">
      <h2>Shelf Issue Review</h2>
      <p className="monitor-subtitle">
        Issues found by the live monitor. Review each one and mark it
        resolved or a false alarm.
      </p>

      {/* SUMMARY STATS */}
      <div className="status-grid">
        <div className="status-item">
          <span className="status-label">Issues today</span>
          <span className="status-value">{stats.totalToday}</span>
        </div>
        <div className="status-item">
          <span className="status-label">New</span>
          <span className="status-value">{stats.newCount}</span>
        </div>
        <div className="status-item">
          <span className="status-label">Resolved</span>
          <span className="status-value">{stats.resolvedCount}</span>
        </div>
        <div className="status-item">
          <span className="status-label">Missing objects</span>
          <span className="status-value">{stats.missingCount}</span>
        </div>
        <div className="status-item">
          <span className="status-label">Moved/Swapped</span>
          <span className="status-value">{stats.movedCount}</span>
        </div>
        <div className="status-item">
          <span className="status-label">Changed areas</span>
          <span className="status-value">{stats.changedCount}</span>
        </div>
        <div className="status-item">
          <span className="status-label">Last scan</span>
          <span className="status-value">{lastScanTime || "—"}</span>
        </div>
      </div>

      {/* FILTERS */}
      <div className="issue-filters">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            className={`filter-chip${filter === f.id ? " active" : ""}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* ISSUE CARDS */}
      {visibleIssues.length > 0 ? (
        <div className="issue-list">
          {visibleIssues.map((issue) => (
            <div
              key={issue.id}
              className={`issue-card severity-${issue.severity}`}
            >
              <div className="issue-card-header">
                <span className={`priority-badge issue-type-${issue.type}`}>
                  {(ISSUE_TYPE_LABELS[issue.type] || issue.type).toUpperCase()}
                </span>
                <span className={`issue-status-badge status-${issue.status}`}>
                  {ISSUE_STATUS_LABELS[issue.status] || issue.status}
                </span>
              </div>

              <h3>
                {issue.areaLabel} area
                {issue.regionId ? ` (${issue.regionId})` : ""}
              </h3>

              <p className="issue-message">{issue.message}</p>

              <p className="issue-meta">
                {new Date(issue.timestamp).toLocaleString()}
                {issue.matchedAreaLabel
                  ? ` · looks like the ${issue.matchedAreaLabel} area`
                  : ""}
                {typeof issue.confidence === "number"
                  ? ` · score ${Math.round(issue.confidence * 100)}%`
                  : ""}
              </p>

              <div className="issue-actions">
                {issue.status !== "reviewing" && (
                  <button
                    className="issue-btn"
                    onClick={() => onUpdateStatus(issue.id, "reviewing")}
                  >
                    Mark Reviewing
                  </button>
                )}
                {issue.status !== "resolved" && (
                  <button
                    className="issue-btn resolve"
                    onClick={() => onUpdateStatus(issue.id, "resolved")}
                  >
                    Mark Resolved
                  </button>
                )}
                {issue.status !== "false_alarm" && (
                  <button
                    className="issue-btn dismiss"
                    onClick={() => onUpdateStatus(issue.id, "false_alarm")}
                  >
                    Mark False Alarm
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="safe">
          {issues.length === 0
            ? "No issues recorded yet — they appear here as the monitor finds changes."
            : "No issues match this filter."}
        </p>
      )}

      {/* PANEL ACTIONS */}
      <div className="issue-panel-actions">
        <button className="analyze-btn" onClick={handleExport}>
          Export Issue Report
        </button>
        <button className="stop-btn" onClick={handleClear}>
          Clear Issue History
        </button>
      </div>
    </div>
  );
}
