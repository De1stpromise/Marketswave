// ★ Onboarding vocabulary — the Deno twin of onboarding-vocab.js (Task A, 2026-09-18, register
// row 242). The VOCAB literal between the markers is duplicated VERBATIM from the browser
// module: a Deno function cannot import a file outside supabase/functions, so a verification
// assertion extracts both blocks and compares them byte-for-byte. Edit one, edit the other —
// the suite will tell you which. submit-onboarding and request-profile-change validate against
// THIS copy; the browser copy is only what lets a form refuse an obviously-empty request before
// the round trip. The server is authoritative.

export interface VocabField { key: string; label: string; enum?: Record<string, string>; type?: string }
export interface VocabGroup { label: string; column: string; scalar?: boolean; accountType?: string; fields: VocabField[] }

/* VOCAB-START */
export const VOCAB: Record<string, VocabGroup> = {
    "countryOfResidence": {
      "label": "Country of residence",
      "column": "country_of_residence",
      "scalar": true,
      "fields": [
        { "key": "value", "label": "Country of residence", "enum": {
          "SE": "Sweden", "NO": "Norway", "DK": "Denmark", "FI": "Finland", "DE": "Germany",
          "GB": "United Kingdom", "US": "United States", "CH": "Switzerland", "NL": "Netherlands",
          "FR": "France", "OTHER": "Other" } }
      ]
    },
    "financialProfile": {
      "label": "Financial profile",
      "column": "financial_profile",
      "fields": [
        { "key": "investableAssets", "label": "Approximate investable assets", "enum": {
          "under-250k": "Under $250,000", "250k-1m": "$250,000 \u2013 $1M",
          "1m-5m": "$1M \u2013 $5M", "5m-plus": "$5M+" } },
        { "key": "sourceOfWealth", "label": "Primary source of wealth", "enum": {
          "employment": "Employment / Salary", "business": "Business Ownership",
          "inheritance": "Inheritance / Gift", "investments": "Investment Returns", "other": "Other" } },
        { "key": "employment", "label": "Employment status / industry", "type": "text" }
      ]
    },
    "goalsPreferences": {
      "label": "Goals & preferences",
      "column": "goals_preferences",
      "fields": [
        { "key": "investmentGoal", "label": "Primary investment goal", "enum": {
          "growth": "Long-term Growth", "income": "Steady Income",
          "preservation": "Capital Preservation", "retirement": "Retirement Planning" } },
        { "key": "timeHorizon", "label": "Investment time horizon", "enum": {
          "under-3": "Less than 3 years", "3-7": "3 \u2013 7 years", "7-15": "7 \u2013 15 years", "15-plus": "More than 15 years" } },
        { "key": "riskComfort", "label": "Comfort with risk", "enum": {
          "low": "Low \u2013 Prefer stability", "moderate": "Moderate \u2013 Balanced approach",
          "high": "High \u2013 Comfortable with larger swings" } }
      ]
    },
    "riskQuestionnaire": {
      "label": "Risk questionnaire",
      "column": "risk_questionnaire",
      "fields": [
        { "key": "knowledge", "label": "Knowledge of financial markets", "enum": {
          "beginner": "Beginner", "intermediate": "Intermediate", "advanced": "Advanced" } },
        { "key": "reaction", "label": "If your portfolio dropped 15% in a short period", "enum": {
          "sell-all": "Sell everything", "sell-some": "Sell some", "hold": "Hold", "buy-more": "Buy more" } },
        { "key": "objective", "label": "Primary investment objective", "enum": {
          "preservation": "Capital preservation", "income": "Steady income",
          "balanced": "Balanced growth", "aggressive": "Aggressive growth" } },
        { "key": "horizon", "label": "How long you expect to keep this money invested", "enum": {
          "under-3": "Less than 3 years", "3-7": "3\u20137 years", "7-15": "7\u201315 years", "15-plus": "More than 15 years" } },
        { "key": "liquidity", "label": "Importance of quick access to this money", "enum": {
          "very": "Very important", "somewhat": "Somewhat important", "not": "Not important" } },
        { "key": "experience", "label": "Invested in stocks, bonds or funds before", "enum": {
          "never": "Never", "occasionally": "Occasionally", "regularly": "Regularly" } }
      ]
    },
    "entityDetails": {
      "label": "Entity details",
      "column": "entity_details",
      "accountType": "Business Account",
      "fields": [
        { "key": "name", "label": "Entity name", "type": "text" },
        { "key": "registrationNumber", "label": "Registration number", "type": "text" },
        { "key": "incorporationCountry", "label": "Country of incorporation", "type": "text" },
        { "key": "role", "label": "Your role", "type": "text" }
      ]
    },
    "jointHolder": {
      "label": "Joint account holder",
      "column": "joint_holder",
      "accountType": "Joint Account",
      "fields": [
        { "key": "name", "label": "Full name", "type": "text" },
        { "key": "email", "label": "Email address", "type": "text" },
        { "key": "phone", "label": "Phone number", "type": "text" }
      ]
    }
  };
/* VOCAB-END */

export const GROUP_ORDER = ['countryOfResidence', 'financialProfile', 'goalsPreferences', 'riskQuestionnaire', 'entityDetails', 'jointHolder'];
export const ACCOUNT_TYPES = ['Individual Account', 'Joint Account', 'Business Account'];

// null when valid, else a message. Byte-for-byte the same rules as the browser twin.
export function validateGroup(groupKey: string, value: unknown): string | null {
  const g = VOCAB[groupKey];
  if (!g) return 'Unknown group.';
  if (g.scalar) {
    const f0 = g.fields[0];
    if (typeof value !== 'string' || !value) return f0.label + ' is required.';
    if (f0.enum && !Object.prototype.hasOwnProperty.call(f0.enum, value)) return f0.label + ' is not a recognised value.';
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return g.label + ' must be an object.';
  const obj = value as Record<string, unknown>;
  let any = false;
  for (const f of g.fields) {
    const raw = obj[f.key];
    if (raw === undefined || raw === null || raw === '') continue;
    if (typeof raw !== 'string') return f.label + ' must be text.';
    if (f.enum && !Object.prototype.hasOwnProperty.call(f.enum, raw)) return f.label + ' is not a recognised value.';
    any = true;
  }
  const known = g.fields.map((f) => f.key);
  for (const k of Object.keys(obj)) if (known.indexOf(k) === -1) return 'Unexpected field: ' + k + '.';
  if (!any) return 'Answer at least one field of ' + g.label.toLowerCase() + '.';
  return null;
}

// A group that only applies to one account type may not be submitted for another.
export function groupAppliesTo(groupKey: string, accountType: string | null): boolean {
  const g = VOCAB[groupKey];
  if (!g) return false;
  return !g.accountType || g.accountType === accountType;
}

// Human-readable label for a stored value, for emails. Never invents a value.
export function labelFor(groupKey: string, fieldKey: string, raw: unknown): string | null {
  const g = VOCAB[groupKey];
  if (!g) return null;
  const f = g.fields.find((x) => x.key === fieldKey);
  if (!f || raw === undefined || raw === null || raw === '') return null;
  if (f.enum) return f.enum[String(raw)] || String(raw);
  return String(raw);
}
