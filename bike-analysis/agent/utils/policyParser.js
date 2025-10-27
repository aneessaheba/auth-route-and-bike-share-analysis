const dayjs = require('dayjs');

function splitSentences(text) {
  return text
    .split(/(?<=[.?!])\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function findPassage(passages = [], keywords = []) {
  if (!Array.isArray(passages) || !passages.length) return null;
  const loweredKeywords = keywords.map((k) => k.toLowerCase());
  let best = null;
  let bestScore = -Infinity;

  for (const passage of passages) {
    const text = passage.text || '';
    const lower = text.toLowerCase();
    let score = passage.score || 0;
    for (const keyword of loweredKeywords) {
      if (lower.includes(keyword)) {
        score += 4;
      } else {
        score -= 2;
      }
    }
    if (lower.includes('per minute') || /\/\s*minute/.test(lower)) score += 1.5;
    if (/\$[0-9]/.test(lower)) score += 1;
    if (score > bestScore) {
      best = passage;
      bestScore = score;
    }
  }

  return best;
}

function extractPerMinute(text) {
  const regex = /\$([0-9]+(?:\.[0-9]+)?)\s*(?:\/|\bper\b)\s*(?:minute|min)/i;
  const match = text.match(regex);
  if (match) {
    return { value: parseFloat(match[1]), snippet: text.trim() };
  }
  return null;
}

function extractMinutes(text) {
  const regex = /(\d+)\s*(?:minute|min)/i;
  const match = text.match(regex);
  if (match) {
    return { value: parseInt(match[1], 10), snippet: text.trim() };
  }
  return null;
}

function makeCitationRegistrar(citations, capturedAtDefault) {
  const cache = new Map();
  return (passage) => {
    if (!passage) return null;
    const key = `${(passage.text || '').trim()}`;
    if (cache.has(key)) {
      return cache.get(key);
    }
    const id = `C${citations.length + 1}`;
    citations.push({
      id,
      text: (passage.text || '').trim(),
      source: passage.source,
      capturedAt: passage.capturedAt || capturedAtDefault || dayjs().toISOString()
    });
    cache.set(key, id);
    return id;
  };
}

function parsePolicy(pricingUrl, queryResults) {
  const citations = [];
  const assumptions = [];
  const values = {};

  const outputs = Object.values(queryResults).filter((item) => item?.success);
  const capturedAt = outputs.length ? outputs[0].fetchedAt || outputs[0].ts : dayjs().toISOString();
  const registerCitation = makeCitationRegistrar(citations, capturedAt);

  function extractCurrencyCandidates(text) {
    const regex = /\$[0-9]+(?:\.[0-9]+)?/g;
    const candidates = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
      const value = parseFloat(match[0].replace('$', ''));
      const windowStart = Math.max(0, match.index - 60);
      const windowEnd = Math.min(text.length, regex.lastIndex + 60);
      const snippet = text.slice(windowStart, windowEnd).trim();
      const context = snippet.toLowerCase();
      let unit = null;
      if (/(per|\/)\s*(minute|min)/.test(context)) unit = 'minute';
      else if (context.includes('monthly')) unit = 'month';
      else if (context.includes('month')) unit = 'month';
      else if (context.includes('annual')) unit = 'year';
      else if (context.includes('year')) unit = 'year';
      else if (context.includes('unlock')) unit = 'unlock';
      else if (context.includes('ride')) unit = 'ride';
      else if (context.includes('scooter')) unit = unit || 'scooter';
      candidates.push({ value, unit, snippet });
    }
    return candidates;
  }

  function selectCandidate(candidates, preferredUnits = [], fallbackUnits = []) {
    for (const unit of preferredUnits) {
      const candidate = candidates.find((c) => c.unit === unit);
      if (candidate) return candidate;
    }
    for (const unit of fallbackUnits) {
      const candidate = candidates.find((c) => c.unit === unit);
      if (candidate) return candidate;
    }
    return candidates[0] || null;
  }

  function handleCurrency(key, queryKey, keywords, options = {}) {
    const {
      preferredUnits = [],
      fallbackUnits = [],
      defaultValue = 0,
      convertYearToMonth = false,
      assumptionNote,
      minValue,
      maxValue,
      excludePhrases = []
    } = options;

    const passages = (queryResults[queryKey]?.data?.passages || [])
      .slice()
      .sort((a, b) => (b.score || 0) - (a.score || 0));

    const exclusions = excludePhrases.map((phrase) =>
      phrase instanceof RegExp ? phrase : new RegExp(phrase, 'i')
    );

    for (const passage of passages) {
      const lower = (passage.text || '').toLowerCase();
      if (exclusions.some((pattern) => pattern.test(lower))) {
        continue;
      }
      const keywordHits = keywords.filter((kw) => lower.includes(kw.toLowerCase()));
      if (!keywordHits.length) {
        continue;
      }

      const candidates = extractCurrencyCandidates(passage.text);
      if (!candidates.length) continue;

      let filtered = candidates;
      if (typeof minValue === 'number') {
        filtered = filtered.filter((c) => c.value >= minValue);
      }
      if (typeof maxValue === 'number') {
        filtered = filtered.filter((c) => c.value <= maxValue);
      }
      if (!filtered.length) {
        filtered = candidates;
      }

      const selected = selectCandidate(filtered, preferredUnits, fallbackUnits);
      if (!selected) continue;

      let value = selected.value;
      if (convertYearToMonth && selected.unit === 'year') {
        value = value / 12;
        assumptions.push('Converted published annual membership price to a monthly equivalent.');
      }

      const citationId = registerCitation({ ...passage, text: selected.snippet });
      values[key] = { value, citationId };
      return;
    }

    assumptions.push(
      assumptionNote || `Unable to locate ${key} in pricing text; treated as ${defaultValue}.`
    );
    values[key] = { value: defaultValue, citationId: null };
  }

  function handlePerMinute(key, queryKey, keywords) {
    const passages = queryResults[queryKey]?.data?.passages || [];
    const passage = findPassage(passages, keywords);
    if (!passage) {
      assumptions.push(`Unable to locate per-minute rate for ${key}; treated as 0.`);
      values[key] = { value: 0, citationId: null };
      return;
    }
    const extraction = extractPerMinute(passage.text);
    if (!extraction) {
      assumptions.push(`No per-minute rate found for ${key}; treated as 0.`);
      values[key] = { value: 0, citationId: registerCitation(passage) };
      return;
    }
    const citationId = registerCitation({ ...passage, text: extraction.snippet });
    values[key] = { value: extraction.value, citationId };
  }

  function handleMinutes(key, queryKey, keywords) {
    const passages = queryResults[queryKey]?.data?.passages || [];
    const passage = findPassage(passages, keywords);
    if (!passage) {
      assumptions.push(`Unable to locate included minutes for ${key}; defaulted to 30 minutes.`);
      values[key] = { value: 30, citationId: null };
      return;
    }
    const extraction = extractMinutes(passage.text);
    if (!extraction) {
      assumptions.push(`No explicit minutes mentioned for ${key}; defaulted to 30 minutes.`);
      values[key] = { value: 30, citationId: registerCitation(passage) };
      return;
    }
    const citationId = registerCitation({ ...passage, text: extraction.snippet });
    values[key] = { value: extraction.value, citationId };
  }

  handleCurrency('membershipPrice', 'membershipPrice', ['member', 'membership'], {
    preferredUnits: ['month'],
    fallbackUnits: ['year'],
    convertYearToMonth: true,
    defaultValue: 0,
    minValue: 10,
    excludePhrases: ['divvy for everyone', 'd4e']
  });
  handleMinutes('memberIncludedMinutes', 'memberIncludedMinutes', ['member', 'classic', 'minute']);
  handlePerMinute('memberEbikePerMinute', 'memberEbikePerMinute', ['member', 'e-bike']);
  handlePerMinute('memberClassicOveragePerMinute', 'memberClassicOveragePerMinute', ['member', 'classic', 'additional']);
  handleCurrency('memberUnlockFee', 'memberUnlockFee', ['member', 'unlock'], {
    preferredUnits: ['unlock', 'ride'],
    defaultValue: 0,
    maxValue: 10
  });

  handleCurrency('singleRidePrice', 'singleRidePrice', ['single', 'ride'], {
    preferredUnits: ['ride'],
    fallbackUnits: ['unlock'],
    defaultValue: 0,
    assumptionNote: 'Could not find an explicit single-ride base fare; treated as 0.',
    minValue: 2,
    maxValue: 10,
    excludePhrases: ['capped']
  });
  handleMinutes('nonMemberIncludedMinutes', 'nonMemberIncludedMinutes', ['single', 'ride', 'minute']);
  handlePerMinute('nonMemberEbikePerMinute', 'nonMemberEbikePerMinute', ['non', 'member', 'e-bike']);
  handlePerMinute('nonMemberClassicOveragePerMinute', 'nonMemberClassicOveragePerMinute', ['non', 'member', 'classic', 'additional']);
  handleCurrency('nonMemberUnlockFee', 'nonMemberUnlockFee', ['unlock', 'fee'], {
    preferredUnits: ['unlock', 'ride'],
    defaultValue: 0,
    maxValue: 10
  });

  return {
    pricingUrl,
    capturedAt,
    citations,
    assumptions,
    values
  };
}

module.exports = { parsePolicy };
