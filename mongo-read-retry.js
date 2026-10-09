const { MongoNetworkError } = require('mongodb');
const { AsyncLocalStorage } = require('node:async_hooks');
const { performance } = require('node:perf_hooks');

const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [150, 300];
const requestMetricsStorage = new AsyncLocalStorage();
const RETRYABLE_READ_METHODS = new Set([
  'countDocuments',
  'distinct',
  'estimatedDocumentCount',
  'findOne'
]);

function isRetryableReadError(error) {
  return error instanceof MongoNetworkError
    || error?.hasErrorLabel?.('RetryableReadError') === true;
}

function getRetryDelay(attempt) {
  const baseDelay = RETRY_DELAYS_MS[attempt - 1];
  return Math.round(baseDelay * (0.8 + Math.random() * 0.4));
}

async function withMongoReadRetry(operationName, operation) {
  const operationStartedAt = performance.now();
  let totalBackoffWaitMs = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const attemptStartedAt = performance.now();
    try {
      const result = await operation();
      if (attempt > 1) {
        const operationElapsedMs = Math.round(performance.now() - operationStartedAt);
        const requestMetrics = requestMetricsStorage.getStore();
        if (requestMetrics) {
          requestMetrics.mongoRetryRecoveredOperations += 1;
          requestMetrics.mongoRetryOperationElapsedMs += operationElapsedMs;
        }
        console.info('[MongoDB read retry]', JSON.stringify({
          event: 'recovered',
          requestId: requestMetrics?.requestId || null,
          operation: operationName,
          attempts: attempt,
          maxAttempts: MAX_ATTEMPTS,
          operationElapsedMs,
          backoffWaitMs: totalBackoffWaitMs
        }));
      }
      return result;
    } catch (error) {
      const retryable = isRetryableReadError(error);
      if (!retryable || attempt === MAX_ATTEMPTS) {
        if (attempt > 1) {
          const operationElapsedMs = Math.round(performance.now() - operationStartedAt);
          const requestMetrics = requestMetricsStorage.getStore();
          if (error && typeof error === 'object') {
            error.mongoReadRetry = {
              operationName,
              attempts: attempt,
              maxAttempts: MAX_ATTEMPTS,
              operationElapsedMs,
              backoffWaitMs: totalBackoffWaitMs
            };
          }
          if (requestMetrics) {
            requestMetrics.mongoRetryFailedOperations += 1;
            requestMetrics.mongoRetryOperationElapsedMs += operationElapsedMs;
          }
          console.error('[MongoDB read retry]', JSON.stringify({
            event: 'failed',
            requestId: requestMetrics?.requestId || null,
            operation: operationName,
            attempts: attempt,
            maxAttempts: MAX_ATTEMPTS,
            operationElapsedMs,
            backoffWaitMs: totalBackoffWaitMs,
            errorName: error.name || 'Error',
            error: String(error.message || error).slice(0, 500)
          }));
        }
        throw error;
      }

      const now = performance.now();
      const delayMs = getRetryDelay(attempt);
      const requestMetrics = requestMetricsStorage.getStore();
      if (requestMetrics) {
        requestMetrics.mongoRetryCount += 1;
        requestMetrics.mongoRetryWaitMs += delayMs;
        requestMetrics.mongoRetryOperations.add(operationName);
      }
      totalBackoffWaitMs += delayMs;
      console.warn('[MongoDB read retry]', JSON.stringify({
        event: 'retrying',
        requestId: requestMetrics?.requestId || null,
        operation: operationName,
        attempt,
        maxAttempts: MAX_ATTEMPTS,
        attemptElapsedMs: Math.round(now - attemptStartedAt),
        operationElapsedMs: Math.round(now - operationStartedAt),
        nextRetryDelayMs: delayMs,
        cumulativeBackoffWaitMs: totalBackoffWaitMs,
        errorName: error.name || 'Error',
        error: String(error.message || error).slice(0, 500)
      }));
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

function createRetryingCursor(operationName, createCursor) {
  const cursorOperations = [];
  const draftCursor = createCursor();
  let proxy;

  function buildCursor() {
    let cursor = createCursor();
    for (const [method, args] of cursorOperations) {
      const result = cursor[method](...args);
      if (result && typeof result === 'object') cursor = result;
    }
    return cursor;
  }

  proxy = new Proxy({}, {
    get(_target, property) {
      if (property === 'toArray') {
        return (...args) => withMongoReadRetry(operationName, () => buildCursor().toArray(...args));
      }

      const value = Reflect.get(draftCursor, property, draftCursor);
      if (typeof value !== 'function') return value;

      return (...args) => {
        const result = value.apply(draftCursor, args);
        if (result === draftCursor) {
          cursorOperations.push([property, args]);
          return proxy;
        }
        return result;
      };
    }
  });

  return proxy;
}

function createRetryingCollection(collection) {
  return new Proxy(collection, {
    get(target, property) {
      if (property === 'find' || property === 'aggregate') {
        return (...args) => createRetryingCursor(
          `${target.collectionName}.${String(property)}`,
          () => target[property](...args)
        );
      }

      if (RETRYABLE_READ_METHODS.has(property)) {
        return (...args) => withMongoReadRetry(
          `${target.collectionName}.${String(property)}`,
          () => target[property](...args)
        );
      }

      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

function createRetryingDatabase(database) {
  return new Proxy(database, {
    get(target, property) {
      if (property === 'collection') {
        return (...args) => createRetryingCollection(target.collection(...args));
      }

      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

module.exports = { createRetryingDatabase, requestMetricsStorage, withMongoReadRetry };