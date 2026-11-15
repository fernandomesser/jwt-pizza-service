const os = require('os');
const config = require('./config.js');

const metricsConfig = config.metrics || {};

const requestsByRoute = new Map();
const activeUsers = new Map();
const authAttempts = { success: 0, failure: 0 };
const requestLatency = new Map();

let pizzasSold = 0;
let pizzaCreationFailures = 0;
let pizzaRevenue = 0;
let pizzaLatencySum = 0;
let pizzaLatencyCount = 0;
let reportingTimer;

function timestampNs() {
  return (BigInt(Date.now()) * 1000000n).toString();
}

function makeAttributes(labels = {}) {
  const allLabels = {
    ...labels,
    source: metricsConfig.source || 'jwt-pizza-service',
  };

  return Object.entries(allLabels).map(([key, value]) => ({
    key,
    value: { stringValue: String(value) },
  }));
}

function sumMetric(name, value, unit, labels = {}) {
  const dataPoint = {
    timeUnixNano: timestampNs(),
    attributes: makeAttributes(labels),
  };

  if (Number.isInteger(value)) {
    dataPoint.asInt = value;
  } else {
    dataPoint.asDouble = value;
  }

  return {
    name,
    unit,
    sum: {
      aggregationTemporality: 'AGGREGATION_TEMPORALITY_CUMULATIVE',
      isMonotonic: true,
      dataPoints: [dataPoint],
    },
  };
}

function gaugeMetric(name, value, unit, labels = {}) {
  return {
    name,
    unit,
    gauge: {
      dataPoints: [
        {
          asDouble: Number(value),
          timeUnixNano: timestampNs(),
          attributes: makeAttributes(labels),
        },
      ],
    },
  };
}

function recordActiveUser(userId) {
  if (userId !== undefined && userId !== null) {
    activeUsers.set(String(userId), Date.now());
  }
}

function requestTracker(req, res, next) {
  const startedAt = process.hrtime.bigint();

  res.once('finish', () => {
    const method = req.method;
    const endpoint = req.path;
    const statusCode = res.statusCode;
    const key = `${method}|${endpoint}|${statusCode}`;

    const requestData = requestsByRoute.get(key) || {
      method,
      endpoint,
      statusCode,
      count: 0,
    };
    requestData.count += 1;
    requestsByRoute.set(key, requestData);

    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const latencyData = requestLatency.get(key) || {
      method,
      endpoint,
      sum: 0,
      count: 0,
    };
    latencyData.sum += durationMs;
    latencyData.count += 1;
    requestLatency.set(key, latencyData);

    if (req.user && req.user.id !== undefined) {
      recordActiveUser(req.user.id);
    }
  });

  next();
}

function recordAuthAttempt(success, userId) {
  authAttempts[success ? 'success' : 'failure'] += 1;

  if (success) {
    recordActiveUser(userId);
  }
}

function recordPizzaPurchase({ success, latencyMs, pizzas = 0, revenue = 0 }) {
  pizzaLatencySum += Number(latencyMs) || 0;
  pizzaLatencyCount += 1;

  if (success) {
    pizzasSold += Number(pizzas) || 0;
    pizzaRevenue += Number(revenue) || 0;
  } else {
    pizzaCreationFailures += 1;
  }
}

function cpuUsagePercent() {
  const cpuCount = os.cpus().length || 1;
  const load = os.loadavg()[0] || 0;
  return Math.min(100, (load / cpuCount) * 100);
}

function memoryUsagePercent() {
  const total = os.totalmem();
  if (!total) return 0;
  return ((total - os.freemem()) / total) * 100;
}

function buildMetrics() {
  const metrics = [];

  for (const request of requestsByRoute.values()) {
    metrics.push(
      sumMetric('http_requests', request.count, '1', {
        method: request.method,
        endpoint: request.endpoint,
        status_code: request.statusCode,
      })
    );
  }

  for (const outcome of ['success', 'failure']) {
    metrics.push(
      sumMetric('authentication_attempts', authAttempts[outcome], '1', {
        outcome,
      })
    );
  }

  const now = Date.now();
  for (const [userId, lastSeen] of activeUsers.entries()) {
    if (now - lastSeen > 5 * 60 * 1000) {
      activeUsers.delete(userId);
    }
  }

  metrics.push(gaugeMetric('active_users', activeUsers.size, '1'));
  metrics.push(gaugeMetric('system_cpu_usage_percent', cpuUsagePercent(), '%'));
  metrics.push(gaugeMetric('system_memory_usage_percent', memoryUsagePercent(), '%'));

  metrics.push(sumMetric('pizzas_sold', pizzasSold, '1'));
  metrics.push(sumMetric('pizza_creation_failures', pizzaCreationFailures, '1'));
  metrics.push(sumMetric('pizza_revenue', pizzaRevenue, 'USD'));

  for (const latency of requestLatency.values()) {
    metrics.push(
      gaugeMetric(
        'http_request_duration_ms',
        latency.sum / latency.count,
        'ms',
        {
          method: latency.method,
          endpoint: latency.endpoint,
        }
      )
    );
  }
  requestLatency.clear();

  if (pizzaLatencyCount > 0) {
    metrics.push(
      gaugeMetric(
        'pizza_factory_duration_ms',
        pizzaLatencySum / pizzaLatencyCount,
        'ms'
      )
    );
  }
  pizzaLatencySum = 0;
  pizzaLatencyCount = 0;

  return metrics;
}

async function sendMetrics() {
  if (!metricsConfig.endpointUrl || !metricsConfig.accountId || !metricsConfig.apiKey) {
    return;
  }

  const body = {
    resourceMetrics: [
      {
        scopeMetrics: [
          {
            metrics: buildMetrics(),
          },
        ],
      },
    ],
  };

  const basicAuth = Buffer.from(
    `${metricsConfig.accountId}:${metricsConfig.apiKey}`
  ).toString('base64');

  const response = await fetch(metricsConfig.endpointUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    console.error(`Grafana metric export failed: HTTP ${response.status}`);
  }
}

function startPeriodicReporting(periodMs = 10000) {
  if (reportingTimer) return;

  reportingTimer = setInterval(() => {
    sendMetrics().catch((error) => {
      console.error('Error sending metrics to Grafana:', error.message);
    });
  }, periodMs);

  reportingTimer.unref();
}

module.exports = {
  requestTracker,
  recordAuthAttempt,
  recordActiveUser,
  recordPizzaPurchase,
  startPeriodicReporting,
};