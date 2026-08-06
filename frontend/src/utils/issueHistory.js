// Persistent shelf-issue history for the store-manager review workflow.
//
// Issues are derived from reference-image analysis regions and
// change-over-time events, stored in localStorage (text only - never
// image/frame data), deduplicated so a problem that persists across many
// scans creates ONE active issue, and reviewed by the manager
// (new -> reviewing -> resolved / false alarm).
//
// Generic by design: no fixed zones, no item names - issues describe AREAS
// of the reference layout ("lower-right", "center-left").

export const ISSUE_TYPE_LABELS = {
  missing: "Possible missing object",
  moved: "Possible moved object",
  swapped: "Possible swap",
  changed: "Changed area",
  suspicious_removal: "Suspicious removal",
  restored: "Restored",
};

export const ISSUE_STATUS_LABELS = {
  new: "New",
  reviewing: "Reviewing",
  resolved: "Resolved",
  false_alarm: "False alarm",
};

const ACTIVE_STATUSES = ["new", "reviewing"];

// An active issue of any of these types covers a region status, so the same
// physical problem is not reported twice under two names.
const COVERING_TYPES = {
  missing: ["missing", "suspicious_removal"],
  moved: ["moved", "swapped"],
  swapped: ["moved", "swapped"],
  changed: ["changed"],
};

const MAX_ISSUES = 200; // keep localStorage small

export function severityForType(type) {
  if (type === "missing" || type === "suspicious_removal") return "high";
  if (type === "moved" || type === "swapped") return "medium";
  if (type === "changed") return "medium";
  return "low"; // restored / informational
}

function makeId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function createIssue({
  regionId,
  areaLabel,
  type,
  message,
  matchedAreaLabel = null,
  confidence = null,
}) {
  return {
    id: makeId(),
    timestamp: new Date().toISOString(),
    regionId,
    areaLabel,
    type,
    severity: severityForType(type),
    // Restored entries are informational - nothing for a manager to act on.
    status: type === "restored" ? "resolved" : "new",
    message,
    matchedAreaLabel,
    confidence,
  };
}

// Merge one scan's results into the issue history.
// - analysis: result of analyzeCurrentAgainstReference (skip on mismatch)
// - events: rows from detectReferenceEvents (may be empty)
// Returns a NEW issues array (never mutates the input).
// Dedupe key: type group + areaLabel while an issue is still active.
export function syncIssuesFromScan(existingIssues, analysis, events = []) {
  let issues = existingIssues.map((issue) => ({ ...issue }));
  const regions = analysis?.regions ?? [];

  const isActive = (issue) => ACTIVE_STATUSES.includes(issue.status);
  const hasActiveCovering = (areaLabel, type) =>
    issues.some(
      (issue) =>
        isActive(issue) &&
        issue.areaLabel === areaLabel &&
        (COVERING_TYPES[type] || [type]).includes(issue.type)
    );

  // 1) Auto-resolve: an area with no changed region at all is back to normal.
  const changedAreas = new Set(regions.map((r) => r.areaLabel));
  for (const issue of issues) {
    if (isActive(issue) && !changedAreas.has(issue.areaLabel)) {
      issue.status = "resolved";
    }
  }

  const created = [];

  // 2) Transition events first - a region that JUST became empty is a
  //    suspicious removal, not merely "missing".
  for (const event of events) {
    if (event.type === "removal" && !hasActiveCovering(event.areaLabel, "missing")) {
      created.push(
        createIssue({
          regionId: null,
          areaLabel: event.areaLabel,
          type: "suspicious_removal",
          message: event.message,
        })
      );
    } else if (event.type === "restored") {
      created.push(
        createIssue({
          regionId: null,
          areaLabel: event.areaLabel,
          type: "restored",
          message: event.message,
        })
      );
    }
  }
  issues = [...created, ...issues];
  created.length = 0;

  // 3) Region statuses: one active issue per persisting problem.
  for (const region of regions) {
    if (!COVERING_TYPES[region.status]) continue;
    if (hasActiveCovering(region.areaLabel, region.status)) continue;

    created.push(
      createIssue({
        regionId: region.id,
        areaLabel: region.areaLabel,
        type: region.status,
        message: region.message,
        matchedAreaLabel: region.matchedAreaLabel ?? null,
        confidence: region.confidence ?? null,
      })
    );
  }

  return [...created, ...issues].slice(0, MAX_ISSUES);
}

export function updateIssueStatus(issues, id, status) {
  return issues.map((issue) =>
    issue.id === id ? { ...issue, status } : issue
  );
}

// Summary counts for the dashboard cards.
export function computeIssueStats(issues) {
  const today = new Date().toDateString();
  const isMissingType = (t) => t === "missing" || t === "suspicious_removal";
  const isMovedType = (t) => t === "moved" || t === "swapped";

  return {
    total: issues.length,
    totalToday: issues.filter(
      (i) => new Date(i.timestamp).toDateString() === today
    ).length,
    newCount: issues.filter((i) => i.status === "new").length,
    resolvedCount: issues.filter((i) => i.status === "resolved").length,
    missingCount: issues.filter((i) => isMissingType(i.type)).length,
    movedCount: issues.filter((i) => isMovedType(i.type)).length,
    changedCount: issues.filter((i) => i.type === "changed").length,
  };
}

// Text-only report for download. No images, no frames.
export function buildIssueReportJson(issues) {
  return JSON.stringify(
    {
      report: "StoreVision shelf issue report",
      generatedAt: new Date().toISOString(),
      totalIssues: issues.length,
      issues: issues.map((issue) => ({
        timestamp: issue.timestamp,
        regionId: issue.regionId,
        areaLabel: issue.areaLabel,
        type: issue.type,
        typeLabel: ISSUE_TYPE_LABELS[issue.type] || issue.type,
        matchedAreaLabel: issue.matchedAreaLabel,
        severity: issue.severity,
        status: issue.status,
        message: issue.message,
        confidence: issue.confidence,
      })),
    },
    null,
    2
  );
}

// ---- Persistence (localStorage, text only) ----------------------------------

const ISSUE_STORAGE_KEY = "storevision-issue-history";

export function loadIssues() {
  try {
    const raw = localStorage.getItem(ISSUE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    // Entries from the old fixed-zone format have no areaLabel - drop them.
    return parsed.filter((issue) => typeof issue.areaLabel === "string");
  } catch {
    return [];
  }
}

export function saveIssues(issues) {
  try {
    localStorage.setItem(ISSUE_STORAGE_KEY, JSON.stringify(issues));
  } catch {
    // Storage full or blocked - history stays in memory for this session.
  }
}

export function clearStoredIssues() {
  try {
    localStorage.removeItem(ISSUE_STORAGE_KEY);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}
