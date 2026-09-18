/* ★ Onboarding vocabulary — the single browser-side source of truth for the onboarding record
 * signup.html collects and client_profiles now stores (Task A, 2026-09-18, register row 242).
 *
 * Every surface that shows or edits an onboarding field reads THIS: settings.html (display +
 * the Request Change modal's group bodies), admin-client-profile.js (the Onboarding panel),
 * admin-approvals-page.js (the client-application panel). Before this module each surface
 * would have needed its own copy of the labels — the same drift this project has already
 * closed once for formatFieldDisplay() (format-helpers.js).
 *
 * The VOCAB literal between the START/END markers is duplicated VERBATIM in
 * supabase/functions/_shared/onboarding-vocab.ts, which submit-onboarding and
 * request-profile-change validate against server-side. A Deno function cannot import a file
 * outside supabase/functions, so the two copies are kept identical by a verification assertion
 * that extracts both blocks and compares them byte-for-byte — edit one, and the suite tells you
 * to edit the other.
 *
 * Values are the form's own option values (read from signup.html, not invented); labels are the
 * form's own option text. `type: 'text'` fields are free text.
 */
(function () {
  'use strict';

  /* VOCAB-START */
  var VOCAB = {
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

  var GROUP_ORDER = ['countryOfResidence', 'financialProfile', 'goalsPreferences', 'riskQuestionnaire', 'entityDetails', 'jointHolder'];

  // The stored value for a group. countryOfResidence is a bare string column; the rest are
  // jsonb objects keyed by each field's `key`.
  function groupValueFromProfile(groupKey, profileRow) {
    if (!profileRow) return null;
    var g = VOCAB[groupKey];
    if (!g) return null;
    var v = profileRow[g.column];
    if (v === undefined || v === null || v === '') return null;
    return v;
  }

  function labelFor(field, raw) {
    if (raw === undefined || raw === null || raw === '') return null;
    if (field.enum) return field.enum[raw] || String(raw);
    return String(raw);
  }

  // [{ key, label, text }] for display — every field of the group, in order, text null when
  // that field was not answered. Never invents a value.
  function describe(groupKey, value) {
    var g = VOCAB[groupKey];
    if (!g) return [];
    return g.fields.map(function (f) {
      var raw = g.scalar ? value : (value && typeof value === 'object' ? value[f.key] : null);
      return { key: f.key, label: f.label, text: labelFor(f, raw) };
    });
  }

  // True when the stored value carries at least one answered field.
  function hasAnyValue(groupKey, value) {
    return describe(groupKey, value).some(function (d) { return d.text !== null; });
  }

  // Which groups apply to an account type: entity/joint groups only for their own type.
  function groupsForAccountType(accountType) {
    return GROUP_ORDER.filter(function (k) {
      var g = VOCAB[k];
      return !g.accountType || g.accountType === accountType;
    });
  }

  // null when valid, else a message. Mirrors _shared/onboarding-vocab.ts's validateGroup()
  // exactly; the server is authoritative, this is what lets the settings modal refuse an empty
  // request before the round trip.
  function validateGroup(groupKey, value) {
    var g = VOCAB[groupKey];
    if (!g) return 'Unknown group.';
    if (g.scalar) {
      var f0 = g.fields[0];
      if (typeof value !== 'string' || !value) return f0.label + ' is required.';
      if (f0.enum && !Object.prototype.hasOwnProperty.call(f0.enum, value)) return f0.label + ' is not a recognised value.';
      return null;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return g.label + ' must be an object.';
    var any = false;
    for (var i = 0; i < g.fields.length; i++) {
      var f = g.fields[i];
      var raw = value[f.key];
      if (raw === undefined || raw === null || raw === '') continue;
      if (typeof raw !== 'string') return f.label + ' must be text.';
      if (f.enum && !Object.prototype.hasOwnProperty.call(f.enum, raw)) return f.label + ' is not a recognised value.';
      any = true;
    }
    var known = g.fields.map(function (f) { return f.key; });
    for (var k in value) if (known.indexOf(k) === -1) return 'Unexpected field: ' + k + '.';
    if (!any) return 'Answer at least one field of ' + g.label.toLowerCase() + '.';
    return null;
  }

  function dateOfBirthDisplay(iso) {
    if (!iso) return null;
    var d = new Date(iso + 'T00:00:00Z');
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  }

  window.OnboardingVocab = {
    VOCAB: VOCAB,
    GROUP_ORDER: GROUP_ORDER,
    groupValueFromProfile: groupValueFromProfile,
    describe: describe,
    hasAnyValue: hasAnyValue,
    groupsForAccountType: groupsForAccountType,
    validateGroup: validateGroup,
    dateOfBirthDisplay: dateOfBirthDisplay
  };
})();
