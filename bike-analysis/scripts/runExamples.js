/* eslint-disable no-console */
const path = require('path');
const { runAgent } = require('../agent');

const PRICING_URL = 'https://divvybikes.com/pricing';

async function runScenario(name, csvRelativePath) {
  const csvPath = path.join(__dirname, '..', csvRelativePath);
  console.log(`\n=== Scenario: ${name} ===`);
  console.log(`CSV: ${csvPath}`);

  try {
    const result = await runAgent({
      runId: name.replace(/\s+/g, '-').toLowerCase(),
      csvPath,
      pricingUrl: PRICING_URL
    });

    console.log(`Decision: ${result.decision}`);
    console.log(
      `Pay Per Use: ${result.costSummary.payPerUse.total.toFixed(2)} | Membership: ${result.costSummary.membership.total.toFixed(2)}`
    );
    console.log('Pay Per Use breakdown:', result.costSummary.payPerUse);
    console.log('Membership breakdown:', result.costSummary.membership);
    console.log(`Total Steps: ${result.metrics.totalSteps} | Stop Reason: ${result.metrics.stopReason}`);
    const paragraph = [
      `${name}: ${result.decision}.`,
      `Pay-per-use estimate ${result.costSummary.payPerUse.total.toFixed(2)}, membership ${result.costSummary.membership.total.toFixed(
        2
      )}, rides ${result.stats.totalRides}.`,
      `Assumptions: ${result.assumptions.join('; ') || 'None.'}`
    ].join(' ');
    console.log(`Summary: ${paragraph}`);
  } catch (error) {
    console.error(`Scenario failed: ${error.message}`);
    process.exitCode = 1;
  }
}

async function main() {
  const scenarios = [
    { name: 'Divvy March 2024 subset', csv: 'data/samples/divvy_202403_subset.csv' },
    { name: 'Divvy January 2024 subset', csv: 'data/samples/divvy_202401_subset.csv' }
  ];

  for (const scenario of scenarios) {
    // eslint-disable-next-line no-await-in-loop
    await runScenario(scenario.name, scenario.csv);
  }
}

main();
