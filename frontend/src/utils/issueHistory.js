// Persistent shelf-issue history for the store-manager review workflow.
//
// Issues are derived from zone analysis results and change-over-time events,
// stored in localStorage (text only - never image/frame data), deduplicated
// so a problem that persists across many scans creates ONE active issue,
// and reviewed by the manager (new -> reviewing -> resolved / false alarm).

export const ISSUE_TYPE_LABELS = {
  missing: "Possible missing item",
  wrong: "Possible wrong item",
  suspicious_removal: "Suspicious removal",
  possible_replacement: "Possible replacement",
  restocked: "Restocked",
  changed: "Suspicious shelf change",
};

export const ISSUE_STATUS_LABELS = {
  new: "New",
  reviewing: "Reviewing",
  resolved: "Resolved",
  false_alarm: "False alarm",
};

const ACTIVE_STATUSES = ["new", "reviewing"];

// An active issue of any of these types covers a zone status, so the same
// physical problem is not reported twice under two names.
const COVERING_TYPES = {
  missing: ["missing", "suspicious_removal"],
  wrong: ["wrong", "possible_replacement"],
  changed: ["changed"],
};

const MAX_ISSUES = 200; // keep localStorage small

export function severityForType(type) {
  if (type === "missing" || type === "suspicious_removal") return "high";
  if (type === "wrong" || type === "possible_replacement" || type === "changed")
    return "medium";
  return "low"; // restocked / informational
}

function makeId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function createIssue({
  zone,
  expectedItem,
  type,
  message,
  matchedItem = null,
  matchedZone = null,
  confidence = null,
}) {
  return {
    id: makeId(),
    timestamp: new Date().toISOString(),
    zone,
    expectedItem,
    type,
    severity: severityForType(type),
    // Restock entries are informational - nothing for a manager to act on.
    status: type === "restocked" ? "resolved" : "new",
    message,
    matchedItem,
    matchedZone,
    confidence,
  };
}

// Merge one scan's results into the issue history.
// - zones: rows from analyzeZonesAgainstReference (skip on reference mismatch)
// - events: rows from detectZoneEvents (may be empty)
// Returns a NEW issues array (never mutates the input).
export function syncIssuesFromScan(existingIssues, zones, events = []) {
  let issues = existingIssues.map((issue) => ({ ...issue }));

  const isActive = (issue) => ACTIVE_STATUSES.includes(issue.status);
  const hasActiveCovering = (zone, zoneStatus) =>
    issues.some(
      (issue) =>
        isActive(issue) &&
        issue.zone === zone &&
        (COVERING_TYPES[zoneStatus] || [zoneStatus]).includes(issue.type)
    );

  // 1) Auto-resolve: a zone that reads OK again closes its active issues.
  //    (A manager can still mark past issues as false alarms.)
  const okZones = new Set(
    zones.filter((row) => row.status === "ok").map((row) => row.zone)
  );
  for (const issue of issues) {
    if (isActive(issue) && okZones.has(issue.zone)) {
      issue.status = "resolved";
    }
  }

  const created = [];

  // 2) Transition events first - they carry the most meaning (a zone that
  //    JUST became empty is a suspicious removal, not merely "missing").
  for (const event of events) {
    if (event.type === "removal" && !hasActiveCovering(event.zone, "missing")) {
      created.push(
        createIssue({
          zone: event.zone,
          expectedItem: event.expectedItem,
          type: "suspicious_removal",
          message: event.message,
        })
      );
    } else if (
      event.type === "replacement" &&
      !hasActiveCovering(event.zone, "wrong")
    ) {
      created.push(
        createIssue({
          zone: event.zone,
          expectedItem: event.expectedItem,
          type: "possible_replacement",
          message: event.message,
        })
      );
    } else if (event.type === "restocked") {
      created.push(
        createIssue({
          zone: event.zone,
          expectedItem: event.expectedItem,
          type: "restocked",
          message: event.message,
        })
      );
    }
  }
  issues = [...created, ...issues];
  created.length = 0;

  // 3) Zone statuses: one active issue per persisting problem.
  for (const row of zones) {
    if (!COVERING_TYPES[row.status]) continue; // ok / unknown are not issues
    if (hasActiveCovering(row.zone, row.status)) continue;

    let message;
    if (row.status === "missing") {
      message = `${row.expectedItem} may be missing from Zone ${row.zone}.`;
    } else if (row.status === "wrong") {
      message =
        `Zone ${row.zone} may contain the wrong item` +
        (row.matchedItem
          ? ` — it looks like ${row.matchedItem} from Zone ${row.matchedZone}.`
          : ".");
    } else {
      message = `Zone ${row.zone} appears changed and needs review.`;
    }

    created.push(
      createIssue({
        zone: row.zone,
        expectedItem: row.expectedItem,
        type: row.status,
        message,
        matchedItem: row.matchedItem ?? null,
        matchedZone: row.matchedZone ?? null,
        confidence: row.confidence ?? null,
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
  const isWrongType = (t) => t === "wrong" || t === "possible_replacement";
  const isSuspiciousType = (t) =>
    t === "suspicious_removal" || t === "possible_replacement" || t === "changed";

  return {
    total: issues.length,
    totalToday: issues.filter(
      (i) => new Date(i.timestamp).toDateString() === today
    ).length,
    newCount: issues.filter((i) => i.status === "new").length,
    resolvedCount: issues.filter((i) => i.status === "resolved").length,
    missingCount: issues.filter((i) => isMissingType(i.type)).length,
    wrongCount: issues.filter((i) => isWrongType(i.type)).length,
    suspiciousCount: issues.filter((i) => isSuspiciousType(i.type)).length,
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
        zone: issue.zone,
        expectedItem: issue.expectedItem,
        type: issue.type,
        typeLabel: ISSUE_TYPE_LABELS[issue.type] || issue.type,
        matchedItem: issue.matchedItem,
        matchedZone: issue.matchedZone,
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
    return Array.isArray(parsed) ? parsed : [];
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
