const form = document.getElementById('agent-form');
const statusEl = document.getElementById('status');
const metricsSection = document.getElementById('metrics');
const metricSteps = document.getElementById('metric-steps');
const metricTime = document.getElementById('metric-time');
const metricStop = document.getElementById('metric-stop');
const timelineList = document.getElementById('timeline');
const resultsContainer = document.getElementById('results');

function setStatus(message, type = 'info') {
  statusEl.textContent = message || '';
  statusEl.dataset.type = type;
}

function formatCurrency(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function renderTimeline(entries = []) {
  timelineList.innerHTML = '';
  entries.forEach((entry) => {
    const li = document.createElement('li');
    li.dataset.type = entry.type;
    const header = document.createElement('div');
    header.className = 'timeline-header';
    header.innerHTML = `<strong>${entry.type}</strong> <span class="ts">${new Date(entry.ts).toLocaleTimeString()}</span>`;
    const body = document.createElement('div');
    body.className = 'timeline-body';
    body.textContent = entry.content;
    li.appendChild(header);
    li.appendChild(body);
    timelineList.appendChild(li);
  });
}

function createCostTable(costSummary) {
  const wrapper = document.createElement('div');
  wrapper.className = 'cost-summary';
  const table = document.createElement('table');
  table.innerHTML = `
    <thead>
      <tr>
        <th>Plan</th>
        <th>Total</th>
        <th>Base Fare / Membership</th>
        <th>Classic Overage</th>
        <th>E-bike Surcharge</th>
        <th>Unlock Fees</th>
      </tr>
    </thead>
  `;
  const tbody = document.createElement('tbody');
  const pay = costSummary.payPerUse;
  const member = costSummary.membership;
  const rows = [
    [
      'Pay Per Use',
      formatCurrency(pay.total),
      formatCurrency(pay.base),
      formatCurrency(pay.classicOverage),
      formatCurrency(pay.ebikeSurcharge),
      formatCurrency(pay.unlockFees)
    ],
    [
      'Monthly Membership',
      formatCurrency(member.total),
      formatCurrency(member.membershipFee),
      formatCurrency(member.classicOverage),
      formatCurrency(member.ebikeSurcharge),
      formatCurrency(member.unlockFees)
    ]
  ];
  rows.forEach((cells) => {
    const tr = document.createElement('tr');
    cells.forEach((cell) => {
      const td = document.createElement('td');
      td.textContent = cell;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrapper.appendChild(table);
  return wrapper;
}

function createWeeklyTable(weeklyRows = []) {
  const wrapper = document.createElement('div');
  wrapper.className = 'weekly-table';
  const table = document.createElement('table');
  table.innerHTML = `
    <thead>
      <tr>
        <th>Week Start</th>
        <th>Rides</th>
        <th>Avg Duration (min)</th>
        <th>E-bike Share</th>
        <th>Pay Per Use Spend</th>
        <th>Membership Spend*</th>
      </tr>
    </thead>
  `;
  const tbody = document.createElement('tbody');
  weeklyRows.forEach((row) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${row.week_start}</td>
      <td>${row.rides}</td>
      <td>${row.avg_duration}</td>
      <td>${row.ebike_share}</td>
      <td>${row.pay_per_use_cost}</td>
      <td>${row.membership_cost}</td>
    `;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  const note = document.createElement('p');
  note.className = 'note';
  note.textContent = '*Membership spend allocates the monthly fee evenly across observed weeks.';
  wrapper.appendChild(table);
  wrapper.appendChild(note);
  return wrapper;
}

function createCitationsList(citations = [], policyMeta) {
  if (!citations.length) return null;
  const wrapper = document.createElement('div');
  wrapper.className = 'citations';
  const header = document.createElement('h3');
  header.textContent = `Citations (captured ${new Date(policyMeta.capturedAt).toLocaleString()})`;
  wrapper.appendChild(header);
  const list = document.createElement('ol');
  citations.forEach((item) => {
    const li = document.createElement('li');
    const link = document.createElement('a');
    link.href = item.source;
    link.textContent = item.source;
    link.target = '_blank';
    li.innerHTML = `<strong>[${item.id}]</strong> ${item.text} `;
    li.appendChild(link);
    list.appendChild(li);
  });
  wrapper.appendChild(list);
  return wrapper;
}

function createStepLogs(stepLogs = []) {
  if (!stepLogs.length) return null;
  const wrapper = document.createElement('div');
  wrapper.className = 'step-logs';
  const heading = document.createElement('h3');
  heading.textContent = 'Tool Calls';
  wrapper.appendChild(heading);
  const table = document.createElement('table');
  table.innerHTML = `
    <thead>
      <tr>
        <th>#</th>
        <th>Tool</th>
        <th>Args Hash</th>
        <th>Latency (ms)</th>
        <th>Success</th>
        <th>Error</th>
      </tr>
    </thead>
  `;
  const tbody = document.createElement('tbody');
  stepLogs.forEach((step) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${step.step}</td>
      <td>${step.tool}</td>
      <td>${step.argsHash}</td>
      <td>${step.latencyMs}</td>
      <td>${step.success ? 'Yes' : 'No'}</td>
      <td>${step.error || ''}</td>
    `;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrapper.appendChild(table);
  return wrapper;
}

function renderResults(data) {
  resultsContainer.innerHTML = '';
  if (!data) return;

  const decision = document.createElement('div');
  decision.className = 'decision';
  decision.textContent = data.decision;
  resultsContainer.appendChild(decision);

  const justification = document.createElement('div');
  justification.className = 'justification';
  data.justification.forEach((sentence) => {
    const p = document.createElement('p');
    p.textContent = sentence;
    justification.appendChild(p);
  });
  resultsContainer.appendChild(justification);

  const costTable = createCostTable(data.costSummary);
  resultsContainer.appendChild(costTable);

  const breakEven = document.createElement('p');
  breakEven.textContent = `Break-even rides (approx): ${data.breakEven.rides ?? 'n/a'} — ${data.breakEven.assumption}`;
  resultsContainer.appendChild(breakEven);

  const weekly = createWeeklyTable(data.weeklyTable);
  resultsContainer.appendChild(weekly);

  if (data.assumptions?.length) {
    const assumptions = document.createElement('div');
    assumptions.className = 'assumptions';
    const title = document.createElement('h3');
    title.textContent = 'Assumptions & Caveats';
    assumptions.appendChild(title);
    const list = document.createElement('ul');
    data.assumptions.forEach((item) => {
      const li = document.createElement('li');
      li.textContent = item;
      list.appendChild(li);
    });
    assumptions.appendChild(list);
    resultsContainer.appendChild(assumptions);
  }

  const citations = createCitationsList(data.citations, data.policyMeta);
  if (citations) {
    resultsContainer.appendChild(citations);
  }

  const stepLogs = createStepLogs(data.stepLogs);
  if (stepLogs) {
    resultsContainer.appendChild(stepLogs);
  }

  const policyLink = document.createElement('p');
  policyLink.innerHTML = `Pricing page: <a href="${data.policyMeta.pricingUrl}" target="_blank">${data.policyMeta.pricingUrl}</a>`;
  resultsContainer.appendChild(policyLink);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(form);
  const file = formData.get('tripsFile');
  const pricingUrl = formData.get('pricingUrl');

  if (!file || !file.size) {
    setStatus('Please upload a CSV file.', 'error');
    return;
  }
  if (!pricingUrl) {
    setStatus('Pricing URL is required.', 'error');
    return;
  }

  setStatus('Running agent…');
  metricsSection.hidden = true;
  timelineList.innerHTML = '';
  resultsContainer.innerHTML = '';

  try {
    const response = await fetch('/api/run-agent', {
      method: 'POST',
      body: formData
    });
    const payload = await response.json();
    if (!payload.success) {
      throw new Error(payload.error || 'Agent failed.');
    }

    renderTimeline(payload.data.timeline);
    renderResults(payload.data);
    const metrics = payload.data.metrics;
    metricsSection.hidden = false;
    metricSteps.textContent = metrics.totalSteps;
    metricTime.textContent = `${metrics.totalTimeMs} ms`;
    metricStop.textContent = metrics.stopReason;

    setStatus('Agent run complete.', 'success');
  } catch (error) {
    console.error(error);
    setStatus(error.message || 'Agent run failed.', 'error');
  }
});
