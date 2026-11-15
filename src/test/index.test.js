describe("pizza service startup", () => {
  const originalPortArgument = process.argv[2];
  const originalConsoleLog = console.log;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.argv[2] = "4567";
    console.log = jest.fn();

    jest.doMock("../service.js", () => ({
      listen: jest.fn(),
    }));
    jest.doMock("../metrics.js", () => ({
      startPeriodicReporting: jest.fn(),
    }));
  });

  afterAll(() => {
    process.argv[2] = originalPortArgument;
    console.log = originalConsoleLog;
    jest.restoreAllMocks();
  });

  test("starts the service on the requested port and reports startup", () => {
    require("../index.js");

    const app = require("../service.js");
    const metrics = require("../metrics.js");
    const startupCallback = app.listen.mock.calls[0][1];

    expect(metrics.startPeriodicReporting).toHaveBeenCalledTimes(1);
    expect(app.listen).toHaveBeenCalledWith("4567", expect.any(Function));

    startupCallback();

    expect(console.log).toHaveBeenCalledWith("Server started on port 4567");
  });

  test("uses port 3000 when no port argument is supplied", () => {
    delete process.argv[2];

    require("../index.js");

    const app = require("../service.js");

    expect(app.listen).toHaveBeenCalledWith(3000, expect.any(Function));
  });
});
