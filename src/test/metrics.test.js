jest.mock("../config.js", () => ({
  metrics: {
    endpointUrl: "https://metrics.test",
    accountId: "account",
    apiKey: "secret",
    source: "test",
  },
}));

describe("metrics", () => {
  let metrics;

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    metrics = require("../metrics");
  });

  afterEach(() => {
    jest.useRealTimers();
    delete global.fetch;
  });

  test("records requests, authentication, and pizza outcomes", () => {
    const listeners = {};
    const response = { statusCode: 201, once: jest.fn((event, fn) => { listeners[event] = fn; }) };
    const next = jest.fn();
    metrics.requestTracker({ method: "GET", path: "/menu", user: { id: 2 } }, response, next);
    expect(next).toHaveBeenCalled();
    listeners.finish();
    metrics.recordAuthAttempt(true, 2);
    metrics.recordAuthAttempt(false);
    metrics.recordPizzaPurchase({ success: true, latencyMs: 4, pizzas: 2, revenue: 8 });
    metrics.recordPizzaPurchase({ success: false, latencyMs: 1 });
  });

  test("exports metrics periodically and handles failed exports", async () => {
    const response = { statusCode: 500, ok: false };
    global.fetch.mockResolvedValue(response);
    metrics.recordActiveUser(null);
    metrics.recordActiveUser(3);
    metrics.startPeriodicReporting(1000);
    metrics.startPeriodicReporting(1000);
    jest.advanceTimersByTime(1000);
    await Promise.resolve();
    expect(global.fetch).toHaveBeenCalledWith("https://metrics.test", expect.objectContaining({ method: "POST" }));
    expect(console.error).toBeDefined();
  });
});
