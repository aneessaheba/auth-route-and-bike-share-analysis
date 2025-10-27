const dayjs = require('dayjs');
const CsvSqlTool = require('./tools/csvSql');
const createPolicyRetriever = require('./tools/policyRetriever');
const createCalculator = require('./tools/calculator');
const { parsePolicy } = require('./utils/policyParser');
const { hashArgs } = require('./utils/hashArgs');

const START_CANDIDATES = [
  'started_at',
  'start_time',
  'starttime',
  'start_time_local',
  'start_timestamp',
  'start_date',
  'starttime_local'
];

const END_CANDIDATES = [
  'ended_at',
  'end_time',
  'stoptime',
  'stop_time',
  'end_time_local',
  'end_timestamp',
  'stop_timestamp',
  'end_date'
];

const DURATION_CANDIDATES = [
  'duration',
  'duration_sec',
  'duration_secs',
  'duration_seconds',
  'duration_min',
  'duration_mins',
  'duration_minutes',
  'tripduration',
  'ride_duration'
];

const RIDE_TYPE_CANDIDATES = [
  'rideable_type',
  'ride_type',
  'bike_type',
  'vehicle_type',
  'ride_category',
  'bike_class'
];

function quoteIdentifier(name) {
  return `"${name.replace(/"/g, '""')}"`;
}

async function detectSchema(csvTool) {
  const infoResult = await csvTool.query(`PRAGMA table_info(${csvTool.tableName});`);
  if (!infoResult.success) {
    throw new Error(`Failed to inspect CSV schema: ${infoResult.error}`);
  }

  const rows = infoResult.data?.rows || [];
  if (!rows.length) {
    throw new Error('Unable to inspect CSV schema (no columns reported).');
  }

  const lowerToActual = new Map();
  rows.forEach((row) => {
    if (row?.name) {
      lowerToActual.set(String(row.name).toLowerCase(), row.name);
    }
  });

  const selectColumn = (candidates) => {
    for (const candidate of candidates) {
      const actual = lowerToActual.get(candidate.toLowerCase());
      if (actual) return actual;
    }
    return null;
  };

  const startCol = selectColumn(START_CANDIDATES);
  const endCol = selectColumn(END_CANDIDATES);
  const durationCol = selectColumn(DURATION_CANDIDATES);
  const rideTypeCol = selectColumn(RIDE_TYPE_CANDIDATES);

  if (!durationCol && (!startCol || !endCol)) {
    throw new Error(
      'Trip dataset must include either a duration column (e.g., duration_sec) or both start and end timestamps.'
    );
  }

  const assumptions = [];
  if (!rideTypeCol) {
    assumptions.push(
      'Dataset lacks an explicit e-bike indicator; treated every trip as classic for cost calculations.'
    );
  }
  if (!startCol) {
    assumptions.push('No trip start timestamp detected; weekly breakdown suppressed.');
  }

  return {
    startCol,
    endCol,
    durationCol,
    rideTypeCol,
    assumptions
  };
}

function buildDurationExpression({ durationCol, startCol, endCol }) {
  if (durationCol) {
    const col = quoteIdentifier(durationCol);
    const lower = durationCol.toLowerCase();
    if (lower.includes('sec')) {
      return `GREATEST(CAST(${col} AS DOUBLE) / 60.0, 0)`;
    }
    if (lower.includes('min')) {
      return `GREATEST(CAST(${col} AS DOUBLE), 0)`;
    }
    return `GREATEST(CAST(${col} AS DOUBLE), 0)`;
  }

  const start = quoteIdentifier(startCol);
  const end = quoteIdentifier(endCol);
  return `GREATEST(CAST(DATEDIFF('second', ${start}, ${end}) AS DOUBLE) / 60.0, 0)`;
}

function buildRideTypeConditions(rideTypeCol) {
  if (!rideTypeCol) {
    return {
      ebikeCondition: 'FALSE',
      classicCondition: 'TRUE'
    };
  }

  const col = `LOWER(${quoteIdentifier(rideTypeCol)})`;
  const ebikeCondition = `${col} IN ('electric_bike', 'electric', 'electric_bicycle', 'ebike', 'e-bike')`;
  return {
    ebikeCondition,
    classicCondition: `NOT (${ebikeCondition})`
  };
}

function summarizeNumber(value, digits = 2) {
  return Number(value || 0).toFixed(digits);
}

function formatPercent(value) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function safeGet(row, key) {
  return Number(row?.[key] || 0);
}

function formatCurrency(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function citationRef(id) {
  return id ? `[${id}]` : '';
}

async function runAgent({ runId, csvPath, pricingUrl }) {
  const startTs = Date.now();
  const timeline = [];
  const stepLogs = [];
  const calculator = createCalculator();
  const csvTool = new CsvSqlTool(csvPath);
  await csvTool.init();
  const schema = await detectSchema(csvTool);
  const durationExpr = buildDurationExpression(schema);
  const { ebikeCondition, classicCondition } = buildRideTypeConditions(schema.rideTypeCol);
  const policyTool = createPolicyRetriever(pricingUrl);
  const tableName = csvTool.tableName;
  let stopReason = 'Completed';

  function logTimeline(type, content, extra = {}) {
    timeline.push({ type, content, ts: dayjs().toISOString(), ...extra });
  }

  function logStep({ tool, args, result, latencyMs }) {
    stepLogs.push({
      step: stepLogs.length + 1,
      tool,
      argsHash: hashArgs(args),
      latencyMs,
      success: Boolean(result?.success),
      error: result?.success ? null : result?.error || null,
      stopReason: result?.success ? null : 'tool_error'
    });
  }

  let statsRow = null;
  let weeklyRows = [];
  const policyOutputs = {};

  try {
    logTimeline('Thought', 'Assess ride volumes and durations to understand the rider’s usage profile.');
    const statsSql = `
      WITH trips_enriched AS (
        SELECT
          *,
          ${durationExpr} AS duration_minutes
        FROM ${tableName}
      )
      SELECT
        COUNT(*) AS total_rides,
        SUM(duration_minutes) AS total_minutes,
        AVG(duration_minutes) AS avg_minutes,
        SUM(CASE WHEN ${ebikeCondition} THEN 1 ELSE 0 END) AS ebike_rides,
        SUM(CASE WHEN ${ebikeCondition} THEN duration_minutes ELSE 0 END) AS ebike_minutes,
        SUM(CASE WHEN ${classicCondition} THEN duration_minutes ELSE 0 END) AS classic_minutes,
        SUM(CASE WHEN ${classicCondition} THEN GREATEST(duration_minutes - 30, 0) ELSE 0 END) AS classic_over_30,
        SUM(CASE WHEN ${classicCondition} THEN GREATEST(duration_minutes - 45, 0) ELSE 0 END) AS classic_over_45
      FROM trips_enriched;
    `;
    logTimeline('Action', 'csv_sql: aggregate ride metrics');
    const statsStart = Date.now();
    const statsResult = await csvTool.query(statsSql);
    const statsLatency = Date.now() - statsStart;
    logStep({ tool: 'csv_sql', args: { sql: statsSql }, result: statsResult, latencyMs: statsLatency });

    if (!statsResult.success) {
      throw new Error(`Failed to summarize trip data: ${statsResult.error}`);
    }

    statsRow = statsResult.data.rows?.[0];
    if (!statsRow) {
      throw new Error('Trip dataset returned no rows.');
    }

    const totalRides = safeGet(statsRow, 'total_rides');
    const avgMinutes = safeGet(statsRow, 'avg_minutes');
    const ebikeShare = totalRides > 0 ? safeGet(statsRow, 'ebike_rides') / totalRides : 0;

    logTimeline(
      'Observation',
      `Trips summary: ${totalRides} total rides, average duration ${summarizeNumber(avgMinutes)} minutes, e-bike share ${formatPercent(
        ebikeShare
      )}.`
    );

    if (schema.startCol) {
      const startColSql = quoteIdentifier(schema.startCol);
      const weeklySql = `
        WITH trips_enriched AS (
          SELECT
            *,
            ${durationExpr} AS duration_minutes
          FROM ${tableName}
        )
        SELECT
          CAST(date_trunc('week', ${startColSql}) AS DATE) AS week_start,
          COUNT(*) AS rides,
          AVG(duration_minutes) AS avg_minutes,
          SUM(CASE WHEN ${ebikeCondition} THEN 1 ELSE 0 END) AS ebike_rides,
          SUM(duration_minutes) AS total_minutes,
          SUM(CASE WHEN ${ebikeCondition} THEN duration_minutes ELSE 0 END) AS ebike_minutes,
          SUM(CASE WHEN ${classicCondition} THEN duration_minutes ELSE 0 END) AS classic_minutes,
          SUM(CASE WHEN ${classicCondition} THEN GREATEST(duration_minutes - 30, 0) ELSE 0 END) AS classic_over_30,
          SUM(CASE WHEN ${classicCondition} THEN GREATEST(duration_minutes - 45, 0) ELSE 0 END) AS classic_over_45
        FROM trips_enriched
        GROUP BY 1
        ORDER BY 1;
      `;
      logTimeline('Thought', 'Break the rides down by week to understand cadence.');
      logTimeline('Action', 'csv_sql: weekly ride breakdown');
      const weeklyStart = Date.now();
      const weeklyResult = await csvTool.query(weeklySql);
      const weeklyLatency = Date.now() - weeklyStart;
      logStep({ tool: 'csv_sql', args: { sql: weeklySql }, result: weeklyResult, latencyMs: weeklyLatency });

      if (!weeklyResult.success) {
        throw new Error(`Failed to compute weekly breakdown: ${weeklyResult.error}`);
      }
      weeklyRows = weeklyResult.data.rows || [];
      logTimeline('Observation', `Computed weekly breakdown with ${weeklyRows.length} rows.`);
    } else {
      logTimeline('Observation', 'Weekly breakdown skipped because start timestamp column was not found.');
    }

    logTimeline('Thought', 'Consult the official pricing page for membership fees and per-minute charges.');
    const pricingHost = (() => {
      try {
        return new URL(pricingUrl).hostname.replace('www.', '');
      } catch {
        return pricingUrl;
      }
    })();

    const policyQueries = [
      { key: 'membershipPrice', query: `${pricingHost} monthly membership price`, description: 'Monthly membership price' },
      { key: 'memberIncludedMinutes', query: `${pricingHost} member included ride minutes classic bike`, description: 'Member classic ride included minutes' },
      { key: 'memberEbikePerMinute', query: `${pricingHost} member e-bike per minute fee`, description: 'Member e-bike per minute fee' },
      { key: 'memberClassicOveragePerMinute', query: `${pricingHost} member classic bike overtime per minute`, description: 'Member classic overtime fee' },
      { key: 'memberUnlockFee', query: `${pricingHost} member unlock fee`, description: 'Member unlock fee' },
      { key: 'singleRidePrice', query: `${pricingHost} single ride price`, description: 'Single ride price' },
      { key: 'nonMemberIncludedMinutes', query: `${pricingHost} single ride included minutes`, description: 'Single ride included minutes' },
      { key: 'nonMemberEbikePerMinute', query: `${pricingHost} non member e-bike per minute fee`, description: 'Non-member e-bike fee' },
      { key: 'nonMemberClassicOveragePerMinute', query: `${pricingHost} non member classic overtime per minute`, description: 'Non-member classic overtime fee' },
      { key: 'nonMemberUnlockFee', query: `${pricingHost} non member unlock fee`, description: 'Non-member unlock fee' }
    ];

    for (const item of policyQueries) {
      logTimeline('Action', `policy_retriever: ${item.description}`);
      const policyStart = Date.now();
      const result = await policyTool({ query: item.query, k: 4 });
      const policyLatency = Date.now() - policyStart;
      logStep({ tool: 'policy_retriever', args: { query: item.query, k: 4 }, result, latencyMs: policyLatency });
      policyOutputs[item.key] = result;

      if (result.success && result.data.passages.length) {
        const snippet = result.data.passages[0].text.trim();
        logTimeline('Observation', `${item.description}: "${snippet.slice(0, 160)}${snippet.length > 160 ? '…' : ''}"`);
      } else {
        logTimeline('Observation', `${item.description}: no relevant snippet found.`);
      }
    }

    const policy = parsePolicy(pricingUrl, policyOutputs);
    logTimeline(
      'Observation',
      `Parsed policy values: membership ${formatCurrency(policy.values.membershipPrice.value)}, single ride ${formatCurrency(
        policy.values.singleRidePrice.value
      )}.`
    );

    const memberIncludedMinutes = policy.values.memberIncludedMinutes.value || 45;
    const nonMemberIncludedMinutes = policy.values.nonMemberIncludedMinutes.value || 30;

    const classicMinutes = safeGet(statsRow, 'classic_minutes');
    const ebikeMinutes = safeGet(statsRow, 'ebike_minutes');
    const classicOver30 = safeGet(statsRow, 'classic_over_30');
    const classicOver45 = safeGet(statsRow, 'classic_over_45');

    const singleRideBase = Math.max(
      policy.values.singleRidePrice.value - policy.values.nonMemberUnlockFee.value,
      0
    );
    const payPerUseBase = totalRides * singleRideBase;
    const payPerUseClassicOverage = classicOver30 * policy.values.nonMemberClassicOveragePerMinute.value;
    const payPerUseEbike = ebikeMinutes * policy.values.nonMemberEbikePerMinute.value;
    const payPerUseUnlocks = totalRides * policy.values.nonMemberUnlockFee.value;

    const payExpression = `${payPerUseBase}+${payPerUseClassicOverage}+${payPerUseEbike}+${payPerUseUnlocks}`;
    logTimeline('Action', 'calculator: sum pay-per-use costs');
    const payCalcStart = Date.now();
    const payCalc = await calculator({ expression: payExpression });
    const payLatency = Date.now() - payCalcStart;
    logStep({ tool: 'calculator', args: { expression: payExpression }, result: payCalc, latencyMs: payLatency });
    const payTotal = payCalc.success ? payCalc.data.value : payPerUseBase + payPerUseClassicOverage + payPerUseEbike + payPerUseUnlocks;

    const membershipFee = policy.values.membershipPrice.value;
    const memberClassicOverageCost = classicOver45 * policy.values.memberClassicOveragePerMinute.value;
    const memberEbikeCost = ebikeMinutes * policy.values.memberEbikePerMinute.value;
    const memberUnlockCost = totalRides * policy.values.memberUnlockFee.value;

    const memberExpr = `${membershipFee}+${memberClassicOverageCost}+${memberEbikeCost}+${memberUnlockCost}`;
    logTimeline('Action', 'calculator: sum membership costs');
    const memberCalcStart = Date.now();
    const memberCalc = await calculator({ expression: memberExpr });
    const memberLatency = Date.now() - memberCalcStart;
    logStep({ tool: 'calculator', args: { expression: memberExpr }, result: memberCalc, latencyMs: memberLatency });
    const membershipTotal = memberCalc.success
      ? memberCalc.data.value
      : membershipFee + memberClassicOverageCost + memberEbikeCost + memberUnlockCost;

    const decision = membershipTotal <= payTotal ? 'Buy Monthly Membership' : 'Pay Per Ride/Minute';

    const justificationSentences = [];
    justificationSentences.push(
      `Membership costs ${formatCurrency(policy.values.membershipPrice.value)} per month and includes roughly ${memberIncludedMinutes}-minute classic rides${citationRef(
        policy.values.membershipPrice.citationId
      )}${citationRef(policy.values.memberIncludedMinutes.citationId)}.`
    );
    justificationSentences.push(
      `You took ${totalRides} rides totaling ${summarizeNumber(classicMinutes + ebikeMinutes)} minutes; paying per ride at ${formatCurrency(
        policy.values.singleRidePrice.value
      )} with surcharges would cost ${formatCurrency(payTotal)}${citationRef(policy.values.singleRidePrice.citationId)}${citationRef(
        policy.values.nonMemberEbikePerMinute.citationId
      )}.`
    );
    justificationSentences.push(
      `With membership the month would cost ${formatCurrency(membershipTotal)}, including e-bike minute charges of ${formatCurrency(
        memberEbikeCost
      )}${citationRef(policy.values.memberEbikePerMinute.citationId)}.`
    );

    const breakEvenRides =
      policy.values.singleRidePrice.value > 0
        ? Math.ceil(policy.values.membershipPrice.value / policy.values.singleRidePrice.value)
        : null;

    const weeklyTable = weeklyRows.map((row) => {
      const rides = safeGet(row, 'rides');
      const ebikeRides = safeGet(row, 'ebike_rides');
      const ebikeShare = rides > 0 ? ebikeRides / rides : 0;

      const weekPayBase = rides * policy.values.singleRidePrice.value;
      const weekPayClassicOver = safeGet(row, 'classic_over_30') * policy.values.nonMemberClassicOveragePerMinute.value;
      const weekPayEbike = safeGet(row, 'ebike_minutes') * policy.values.nonMemberEbikePerMinute.value;
      const weekPayUnlock = rides * policy.values.nonMemberUnlockFee.value;
      const weekPayTotal = weekPayBase + weekPayClassicOver + weekPayEbike + weekPayUnlock;

      const weekMemberClassicOver = safeGet(row, 'classic_over_45') * policy.values.memberClassicOveragePerMinute.value;
      const weekMemberEbike = safeGet(row, 'ebike_minutes') * policy.values.memberEbikePerMinute.value;
      const weekMemberUnlock = rides * policy.values.memberUnlockFee.value;
      const membershipWeeks = weeklyRows.length || 4;
      const weekMemberFee = membershipFee / membershipWeeks;
      const weekMemberTotal = weekMemberFee + weekMemberClassicOver + weekMemberEbike + weekMemberUnlock;

      return {
        week_start: row.week_start,
        rides,
        avg_duration: summarizeNumber(row.avg_minutes),
        ebike_share: formatPercent(ebikeShare),
        pay_per_use_cost: formatCurrency(weekPayTotal),
        membership_cost: formatCurrency(weekMemberTotal)
      };
    });

    const assumptionList = [...schema.assumptions, ...policy.assumptions];
    const finalAnswer = [
      `Decision: ${decision}`,
      `Pay Per Use Total: ${formatCurrency(payTotal)}`,
      `Membership Total: ${formatCurrency(membershipTotal)}`,
      `Break-even rides (approx): ${breakEvenRides || 'n/a'}`,
      `Assumptions: ${assumptionList.join('; ') || 'None'}`
    ].join('\n');

    logTimeline('Final Answer', finalAnswer);

    await csvTool.close();

    return {
      runId,
      decision,
      justification: justificationSentences,
      citations: policy.citations,
      costSummary: {
        payPerUse: {
          total: payTotal,
          base: payPerUseBase,
          classicOverage: payPerUseClassicOverage,
          ebikeSurcharge: payPerUseEbike,
          unlockFees: payPerUseUnlocks
        },
        membership: {
          total: membershipTotal,
          membershipFee,
          classicOverage: memberClassicOverageCost,
          ebikeSurcharge: memberEbikeCost,
          unlockFees: memberUnlockCost
        }
      },
      breakEven: {
        rides: breakEvenRides,
        assumption: 'Break-even rides approximate membership fee divided by single-ride price.'
      },
      weeklyTable,
      timeline,
      stepLogs,
      metrics: {
        totalSteps: stepLogs.length,
        totalTimeMs: Date.now() - startTs,
        stopReason
      },
      policyMeta: {
        pricingUrl,
        capturedAt: policy.capturedAt
      },
      assumptions: assumptionList,
      stats: {
        totalRides,
        averageMinutes: avgMinutes,
        ebikeShare
      },
      finalAnswer
    };
  } catch (error) {
    stopReason = 'Error';
    logTimeline('Final Answer', `Run failed: ${error.message}`);
    await csvTool.close();
    throw error;
  }
}

module.exports = { runAgent };
