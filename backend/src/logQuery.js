/**
 * Lightweight, no-vector-DB retrieval for natural-language questions about
 * previously ingested logs/anomalies. Scores stored log lines and anomalies
 * by keyword overlap with the question and hands the top matches to the LLM
 * as context - intentionally simple (no embeddings/ChromaDB) so it works
 * with either AI service backend.
 */
const store = require('./store');

const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'of', 'in', 'on', 'at', 'to', 'for', 'and', 'or',
  'what', 'why', 'how', 'did', 'do', 'does', 'when', 'which', 'with', 'has', 'have', 'had', 'be',
  'been', 'it', 'its', 'this', 'that', 'there', 'any', 'all', 'from', 'by', 'me', 'my', 'you',
]);

const MAX_ANALYSES_SCANNED = 100;
const MAX_LOG_MATCHES = 30;
const MAX_ANOMALY_MATCHES = 8;
const MAX_ACTION_MATCHES = 8;

function tokenize(text) {
  return (text || '').toLowerCase().match(/[a-z0-9_]+/g) || [];
}

function questionTerms(question) {
  return [...new Set(tokenize(question).filter(t => t.length > 2 && !STOPWORDS.has(t)))];
}

function scoreText(text, terms) {
  const lower = (text || '').toLowerCase();
  return terms.reduce((score, term) => score + (lower.includes(term) ? 1 : 0), 0);
}

/**
 * Finds the log lines, anomalies and related healing actions most relevant
 * to `searchText` (the current question, optionally broadened with recent
 * conversation history so follow-ups like "how can I fix that" still
 * resolve to the right anomaly), optionally scoped to a single target_host.
 * Falls back to "most recent" ordering when there are no usable keywords.
 */
function gatherContext(searchText, targetHost) {
  const terms = questionTerms(searchText);

  const analyses = [...store.analyses.values()]
    .filter(a => !targetHost || a.target_host === targetHost)
    .sort((a, b) => new Date(b.uploadedAt || b.ingestedAt) - new Date(a.uploadedAt || a.ingestedAt))
    .slice(0, MAX_ANALYSES_SCANNED);

  const logMatches = [];
  for (const analysis of analyses) {
    for (const line of analysis.logs || []) {
      const score = terms.length ? scoreText(line, terms) : 0;
      if (terms.length && score === 0) continue;
      logMatches.push({
        line,
        score,
        target_host: analysis.target_host,
        source: analysis.source,
        timestamp: analysis.uploadedAt || analysis.ingestedAt,
      });
    }
  }
  logMatches.sort((a, b) => b.score - a.score || new Date(b.timestamp) - new Date(a.timestamp));
  const topLogs = logMatches.slice(0, MAX_LOG_MATCHES);

  const anomalies = [...store.anomalies.values()].filter(a => !targetHost || a.target_host === targetHost);
  const scoredAnomalies = anomalies.map(a => ({
    anomaly: a,
    score: terms.length ? scoreText([a.title, a.description, a.root_cause].join(' '), terms) : 0,
  }));
  scoredAnomalies.sort((a, b) => b.score - a.score || new Date(b.anomaly.created_at) - new Date(a.anomaly.created_at));
  const topAnomalies = (terms.length ? scoredAnomalies.filter(x => x.score > 0) : scoredAnomalies)
    .slice(0, MAX_ANOMALY_MATCHES)
    .map(x => x.anomaly);

  // Healing actions already generated for those anomalies - this is where
  // the actual "how do I fix it" answer lives, not just the anomaly title.
  const anomalyIds = new Set(topAnomalies.map(a => a.id));
  const topActions = [...store.actions.values()]
    .filter(a => anomalyIds.has(a.anomaly_id))
    .slice(0, MAX_ACTION_MATCHES);

  return { topLogs, topAnomalies, topActions, scannedAnalyses: analyses.length };
}

function buildContextText({ topLogs, topAnomalies, topActions }) {
  const anomalyText = topAnomalies.length
    ? topAnomalies.map(a => `- [${a.severity}] ${a.title} (host: ${a.target_host || 'n/a'}, status: ${a.status}): ${a.root_cause || a.description}`).join('\n')
    : 'None found.';

  const actionText = topActions.length
    ? topActions.map(a => `- ${a.title} (type: ${a.action_type}, approval: ${a.approval_level}, status: ${a.status}): ${a.description || ''}${(a.commands || []).length ? ` Suggested commands: ${a.commands.join(' && ')}` : ''}`).join('\n')
    : 'None found.';

  const logText = topLogs.length
    ? topLogs.map(l => `- (${l.target_host || l.source || 'unknown'}) ${l.line}`).join('\n')
    : 'None found.';

  return `=== RELEVANT ANOMALIES ===\n${anomalyText}\n\n=== SUGGESTED/EXISTING HEALING ACTIONS ===\n${actionText}\n\n=== RELEVANT LOG LINES ===\n${logText}`;
}

/**
 * Deterministic fallback answer (no LLM) used when the AI service is
 * unreachable, so the query box still returns something useful - same
 * "never fully break" resilience pattern as the mock analyzer. Dedupes by
 * title (the same anomaly type often recurs many times) and surfaces
 * suggested fixes, not just anomaly names, so "how do I fix that" gets a
 * real answer even without the LLM.
 */
function answerQueryMock(question, context) {
  const { topLogs, topAnomalies, topActions } = context;
  if (!topAnomalies.length && !topLogs.length) {
    return `I couldn't find any stored logs or anomalies matching "${question}".`;
  }

  const uniqueAnomalyTitles = [...new Set(topAnomalies.map(a => a.title))];
  const uniqueActionTitles = [...new Set(topActions.map(a => a.title))];

  const parts = [];
  if (uniqueAnomalyTitles.length) {
    const countNote = topAnomalies.length > uniqueAnomalyTitles.length ? ` (${topAnomalies.length} occurrences)` : '';
    parts.push(`Found issue(s): ${uniqueAnomalyTitles.join('; ')}${countNote}.`);
  }
  if (uniqueActionTitles.length) {
    parts.push(`Suggested fix(es): ${uniqueActionTitles.join('; ')}.`);
  } else if (uniqueAnomalyTitles.length) {
    parts.push('No healing action is on record for this yet - review the anomaly manually.');
  }
  if (!uniqueAnomalyTitles.length && topLogs.length) {
    parts.push(`Found ${topLogs.length} matching log line(s), e.g.: "${topLogs[0].line}"`);
  }
  parts.push('(AI service unavailable - showing raw keyword matches only.)');
  return parts.join(' ');
}

module.exports = { gatherContext, buildContextText, answerQueryMock };
