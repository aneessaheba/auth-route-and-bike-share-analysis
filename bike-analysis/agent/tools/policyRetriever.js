const fetch = require('node-fetch');
const cheerio = require('cheerio');
const dayjs = require('dayjs');

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function scorePassage(text, queryTokens) {
  const tokens = tokenize(text);
  if (!tokens.length) return 0;
  let score = 0;
  for (const token of queryTokens) {
    const occurrences = tokens.filter((t) => t === token).length;
    if (occurrences > 0) {
      score += 2 * occurrences;
    }
  }
  // Bonus for containing key tokens like 'per', 'minute', '$'
  if (/\$[0-9]/.test(text)) score += 1.5;
  if (/minute/i.test(text)) score += 1;
  if (/member/i.test(text)) score += 0.5;
  return score;
}

function extractPassages(html, url) {
  const $ = cheerio.load(html);
  const segments = [];
  const seen = new Set();

  $('p, li, h1, h2, h3, h4, h5, h6, span, strong, div, table td, table th, dd, dt')
    .toArray()
    .forEach((el) => {
      const text = $(el).text().replace(/\s+/g, ' ').trim();
      if (!text) return;
      if (text.length < 25 || text.length > 600) return;
      if (seen.has(text)) return;
      seen.add(text);
      segments.push({ text, source: url });
    });

  return segments;
}

function createPolicyRetriever(pricingUrl) {
  let cached = null;
  let fetchedAt = null;

  async function ensureLoaded() {
    if (cached) {
      return;
    }

    const res = await fetch(pricingUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:115.0) Gecko/20100101 Firefox/115.0',
        Accept: 'text/html,application/xhtml+xml'
      },
      timeout: 20000
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch pricing page (status ${res.status}).`);
    }

    const html = await res.text();
    cached = extractPassages(html, pricingUrl);
    fetchedAt = dayjs().toISOString();
  }

  return async function policyRetrieverTool(input) {
    const ts = dayjs().toISOString();
    const { query, k = 3 } = input || {};
    if (!query) {
      return { success: false, error: 'Query text is required.', ts, source: pricingUrl };
    }

    try {
      await ensureLoaded();
    } catch (error) {
      return { success: false, error: error.message, ts, source: pricingUrl };
    }

    const queryTokens = tokenize(query);
    const scored = cached
      .map((seg) => ({ ...seg, score: scorePassage(seg.text, queryTokens) }))
      .filter((seg) => seg.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);

    return {
      success: true,
      data: {
        passages: scored
      },
      source: pricingUrl,
      fetchedAt,
      ts
    };
  };
}

module.exports = createPolicyRetriever;
