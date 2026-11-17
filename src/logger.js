const { AsyncLocalStorage } = require('node:async_hooks');
const config = require('./config.js');

class Logger {
  requestContext = new AsyncLocalStorage();

  httpLogger = (req, res, next) => {
    const logger = this;
    const startedAt = Date.now();
    const user = req.user
      ? {
          id: req.user.id,
          roles: Array.isArray(req.user.roles)
            ? req.user.roles.map((role) => role.role)
            : [],
        }
      : null;

    this.requestContext.run({ user }, () => {
      let responseBody;
      const originalSend = res.send;

      res.send = function (body) {
        responseBody = body;
        return originalSend.call(this, body);
      };

      res.once('finish', () => {
        const statusCode = res.statusCode;

        logger.log(logger.statusToLogLevel(statusCode), 'http', {
          method: req.method,
          path: req.path,
          statusCode,
          hasAuthorizationHeader: Boolean(req.headers.authorization),
          durationMs: Date.now() - startedAt,
          requestBody: req.body,
          responseBody: logger.parseBody(responseBody),
        });
      });

      next();
    });
  };

  currentUser() {
    return this.requestContext.getStore()?.user ?? null;
  }

  log(level, type, data) {
    const logging = config.logging;

    if (
      process.env.NODE_ENV === 'test' ||
      !logging?.endpointUrl ||
      !logging?.accountId ||
      !logging?.apiKey
    ) {
      return;
    }

    const entry = this.sanitize({
      ...data,
      user: data.user ?? this.currentUser(),
    });

    const event = {
      streams: [
        {
          stream: {
            component: logging.source,
            level,
            type,
          },
          values: [
            [
              (BigInt(Date.now()) * 1000000n).toString(),
              JSON.stringify(entry),
            ],
          ],
        },
      ],
    };

    fetch(logging.endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${logging.accountId}:${logging.apiKey}`,
      },
      body: JSON.stringify(event),
    })
      .then(async (response) => {
        if (!response.ok) {
          console.error(
            `Grafana log push failed: ${response.status}`,
            await response.text()
          );
        }
      })
      .catch((error) => {
        console.error('Error sending log to Grafana:', error.message);
      });
  }

  logDatabase(sql, parameterCount, durationMs, error) {
    this.log(error ? 'error' : 'info', 'database', {
      query: this.sanitizeSql(sql),
      parameterCount,
      durationMs,
      ...(error ? { error: error.message } : {}),
    });
  }

  async factoryRequest(url, options, requestBody) {
    const startedAt = Date.now();

    try {
      const response = await fetch(url, options);
      const responseText = await response.clone().text();

      let responseBody = responseText;
      try {
        responseBody = JSON.parse(responseText);
      } catch {
        // Keep a non-JSON response as text.
      }

      this.log(this.statusToLogLevel(response.status), 'factory', {
        method: options.method ?? 'GET',
        path: new URL(url).pathname,
        statusCode: response.status,
        durationMs: Date.now() - startedAt,
        requestBody,
        responseBody,
      });

      return response;
    } catch (error) {
      this.log('error', 'factory', {
        method: options.method ?? 'GET',
        path: new URL(url).pathname,
        durationMs: Date.now() - startedAt,
        requestBody,
        error: error.message,
      });
      throw error;
    }
  }

  logException(error, req) {
    this.log('error', 'exception', {
      message: error?.message,
      stack: error?.stack,
      method: req?.method,
      path: req?.path,
    });
  }

  statusToLogLevel(statusCode) {
    if (statusCode >= 500) return 'error';
    if (statusCode >= 400) return 'warn';
    return 'info';
  }

  parseBody(body) {
    if (body === undefined || body === null) return body;
    if (Buffer.isBuffer(body)) body = body.toString();

    if (typeof body === 'string') {
      try {
        return JSON.parse(body);
      } catch {
        return body;
      }
    }

    return body;
  }

  sanitize(value, key = '') {
    if (/password|passphrase|secret|token|authorization|api.?key|email/i.test(key)) {
      return '[REDACTED]';
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.sanitize(item));
    }

    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([childKey, childValue]) => [
          childKey,
          this.sanitize(childValue, childKey),
        ])
      );
    }

    return value;
  }

  sanitizeSql(sql) {
    return String(sql).replace(/'(?:''|\\.|[^'])*'/g, "'[REDACTED]'");
  }
}

module.exports = new Logger();