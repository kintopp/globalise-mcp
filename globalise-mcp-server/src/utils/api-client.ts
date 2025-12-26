/**
 * API client utilities for GLOBALISE Transcriptions Viewer API
 */

import { LRUCache } from './cache.js';

export const API_CONFIG = {
  BROCCOLI_BASE_URL: 'https://gloccoli.tt.di.huc.knaw.nl',
  FRONTEND_BASE_URL: 'https://transcriptions.globalise.huygens.knaw.nl',
  DEFAULT_INDEX: 'globalise-2024.03.18-test',
  TIMEOUT_MS: 30000, // 30 seconds default timeout
  RETRY_MAX_ATTEMPTS: 3,
  RETRY_BASE_DELAY_MS: 1000, // 1 second base delay (1s, 2s, 4s)
};

/**
 * Error types for better error classification
 */
export enum ErrorType {
  TIMEOUT = 'TIMEOUT',
  NETWORK = 'NETWORK',
  HTTP_CLIENT = 'HTTP_CLIENT',    // 4xx errors
  HTTP_SERVER = 'HTTP_SERVER',    // 5xx errors
  RATE_LIMIT = 'RATE_LIMIT',      // 429
  NOT_FOUND = 'NOT_FOUND',        // 404
  UNKNOWN = 'UNKNOWN'
}

/**
 * Enhanced API error with detailed context
 */
export interface ApiError {
  type: ErrorType;
  error: string;
  details?: string;
  status?: number;
  suggestion?: string;  // Actionable guidance for users
  retryAfterMs?: number;  // For 429 responses with Retry-After header
}

/**
 * Parse Retry-After header value to milliseconds
 * Supports both seconds (integer) and HTTP-date formats
 */
function parseRetryAfter(response: Response): number | undefined {
  const retryAfter = response.headers.get('Retry-After');
  if (!retryAfter) return undefined;

  // Try parsing as seconds (integer)
  const seconds = parseInt(retryAfter, 10);
  if (!isNaN(seconds)) {
    return seconds * 1000;
  }

  // Try parsing as HTTP-date
  const date = Date.parse(retryAfter);
  if (!isNaN(date)) {
    const delayMs = date - Date.now();
    return delayMs > 0 ? delayMs : undefined;
  }

  return undefined;
}

/**
 * Create a detailed HTTP error based on response status
 */
function createHttpError(response: Response, url: string): ApiError {
  const status = response.status;

  // 404 Not Found
  if (status === 404) {
    const isDocument = url.includes('/urn:globalise:');
    return {
      type: ErrorType.NOT_FOUND,
      error: isDocument ? 'Document not found' : 'Resource not found',
      details: isDocument
        ? 'Verify the document ID format (NL-HaNA_archive_inventory_scan) or check if it exists in the current index.'
        : `The requested resource at ${url} could not be found.`,
      status: 404,
      suggestion: 'Check the document ID or search for similar documents.'
    };
  }

  // 429 Rate Limit
  if (status === 429) {
    const retryAfterMs = parseRetryAfter(response);
    return {
      type: ErrorType.RATE_LIMIT,
      error: 'Rate limit exceeded',
      details: 'Too many requests to the GLOBALISE API.',
      status: 429,
      suggestion: retryAfterMs
        ? `Wait ${Math.ceil(retryAfterMs / 1000)} seconds before retrying.`
        : 'Wait a moment before retrying.',
      retryAfterMs
    };
  }

  // 4xx Client Errors
  if (status >= 400 && status < 500) {
    return {
      type: ErrorType.HTTP_CLIENT,
      error: `HTTP ${status}: ${response.statusText}`,
      status,
      suggestion: 'Check your request parameters.'
    };
  }

  // 5xx Server Errors
  if (status >= 500) {
    return {
      type: ErrorType.HTTP_SERVER,
      error: `HTTP ${status}: ${response.statusText}`,
      details: 'The GLOBALISE API server encountered an error.',
      status,
      suggestion: 'This is a server-side issue. Try again in a moment.'
    };
  }

  return {
    type: ErrorType.UNKNOWN,
    error: `HTTP ${status}: ${response.statusText}`,
    status
  };
}

/**
 * Create a timeout error
 */
function createTimeoutError(url: string): ApiError {
  return {
    type: ErrorType.TIMEOUT,
    error: 'Request timeout after 30 seconds',
    details: `The API request to ${url} took too long to complete.`,
    suggestion: 'Try reducing the result set size or search scope.'
  };
}

/**
 * Create a network error
 */
function createNetworkError(url: string, error: TypeError): ApiError {
  return {
    type: ErrorType.NETWORK,
    error: 'Network error',
    details: `Unable to reach ${url}. ${error.message}`,
    suggestion: 'Check your internet connection.'
  };
}

/**
 * Create an unknown error
 */
function createUnknownError(error: unknown): ApiError {
  return {
    type: ErrorType.UNKNOWN,
    error: 'Unknown error occurred',
    details: error instanceof Error ? error.message : JSON.stringify(error)
  };
}

/**
 * Determine if an error is retryable
 * Retryable: TIMEOUT, NETWORK, HTTP_SERVER (5xx), RATE_LIMIT (429)
 * Not retryable: HTTP_CLIENT (4xx except 429), NOT_FOUND, UNKNOWN
 */
function isRetryableError(error: ApiError): boolean {
  return [
    ErrorType.TIMEOUT,
    ErrorType.NETWORK,
    ErrorType.HTTP_SERVER,
    ErrorType.RATE_LIMIT
  ].includes(error.type);
}

/**
 * Calculate delay for retry attempt using exponential backoff
 * Uses error's retryAfterMs if available (from Retry-After header)
 */
function calculateRetryDelay(attempt: number, error?: ApiError): number {
  // Respect Retry-After header if present
  if (error?.retryAfterMs) {
    return error.retryAfterMs;
  }
  // Exponential backoff: 1s, 2s, 4s (baseDelay * 2^attempt)
  return API_CONFIG.RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry wrapper with exponential backoff for transient failures
 *
 * @param fn - Async function to execute with retry
 * @param maxAttempts - Maximum number of attempts (default: 3)
 * @returns Result of successful function execution
 * @throws Last error after all retries exhausted
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = API_CONFIG.RETRY_MAX_ATTEMPTS
): Promise<T> {
  let lastError: ApiError | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const apiError = error as ApiError;

      // If it's not a retryable error, throw immediately
      if (!apiError.type || !isRetryableError(apiError)) {
        throw error;
      }

      lastError = apiError;

      // If we've exhausted all attempts, throw
      if (attempt === maxAttempts - 1) {
        throw error;
      }

      // Calculate delay and wait before retrying
      const delayMs = calculateRetryDelay(attempt, apiError);
      await sleep(delayMs);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError;
}

/**
 * Execute a single GET request without retry
 */
async function apiGetOnce<T>(url: string, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw createHttpError(response, url);
    }

    return await response.json() as T;
  } catch (error) {
    clearTimeout(timeoutId);

    // Handle AbortError (timeout)
    if ((error as Error).name === 'AbortError') {
      throw createTimeoutError(url);
    }

    // Handle TypeError (network errors)
    if (error instanceof TypeError) {
      throw createNetworkError(url, error);
    }

    // Re-throw ApiError as-is
    if ((error as ApiError).type) {
      throw error;
    }

    // Unknown error
    throw createUnknownError(error);
  }
}

/**
 * Make a GET request to the API with timeout and automatic retry
 * Retries on transient failures (network errors, timeouts, 5xx, 429)
 */
export async function apiGet<T>(url: string, timeoutMs = API_CONFIG.TIMEOUT_MS): Promise<T> {
  return withRetry(() => apiGetOnce<T>(url, timeoutMs));
}

/**
 * Execute a single POST request without retry
 */
async function apiPostOnce<T>(url: string, body: unknown, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw createHttpError(response, url);
    }

    return await response.json() as T;
  } catch (error) {
    clearTimeout(timeoutId);

    // Handle AbortError (timeout)
    if ((error as Error).name === 'AbortError') {
      throw createTimeoutError(url);
    }

    // Handle TypeError (network errors)
    if (error instanceof TypeError) {
      throw createNetworkError(url, error);
    }

    // Re-throw ApiError as-is
    if ((error as ApiError).type) {
      throw error;
    }

    // Unknown error
    throw createUnknownError(error);
  }
}

/**
 * Make a POST request to the API with timeout and automatic retry
 * Retries on transient failures (network errors, timeouts, 5xx, 429)
 */
export async function apiPost<T>(url: string, body: unknown, timeoutMs = API_CONFIG.TIMEOUT_MS): Promise<T> {
  return withRetry(() => apiPostOnce<T>(url, body, timeoutMs));
}

/**
 * Build a URL with query parameters
 */
export function buildUrl(baseUrl: string, params: Record<string, string | number | boolean | undefined>): string {
  const url = new URL(baseUrl);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) {
      url.searchParams.append(key, String(value));
    }
  });

  return url.toString();
}

/**
 * Cache instances for different data types
 */
export const documentCache = new LRUCache<unknown>(100, 300000);  // 100 docs, 5 min TTL
export const configCache = new LRUCache<unknown>(10, 3600000);    // 10 items, 1 hour TTL
export const indicesCache = new LRUCache<unknown>(10, 3600000);   // 10 items, 1 hour TTL

/**
 * Make a cached GET request to the API
 * Checks cache first, falls back to API call if not found
 *
 * @param url The URL to fetch
 * @param cacheKey The key to use for caching
 * @param cache The cache instance to use
 * @param timeoutMs Optional timeout in milliseconds
 */
export async function getCachedApiGet<T>(
  url: string,
  cacheKey: string,
  cache: LRUCache<unknown>,
  timeoutMs?: number
): Promise<T> {
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached as T;
  }

  const result = await apiGet<T>(url, timeoutMs);
  cache.set(cacheKey, result);

  return result;
}

/**
 * Fetch indexed fields for a given index
 * Returns field names and their types (keyword, text, date)
 */
export async function getIndexedFields(indexName: string): Promise<string[]> {
  const url = `${API_CONFIG.BROCCOLI_BASE_URL}/brinta/globalise/indices`;

  const response = await getCachedApiGet<Record<string, Record<string, string>>>(
    url,
    'globalise-indices',
    indicesCache
  );

  const fields = response[indexName];
  if (!fields) {
    throw {
      type: ErrorType.UNKNOWN,
      error: `Index ${indexName} not found`,
      details: `Available indices: ${Object.keys(response).join(', ')}`,
      suggestion: 'Use a valid index name or check the API configuration.'
    } as ApiError;
  }

  return Object.keys(fields);
}

/**
 * Validate that field names are indexed and searchable
 * Throws an error if any field is invalid
 */
export async function validateSearchFields(
  fields: string[],
  indexName: string
): Promise<void> {
  const validFields = await getIndexedFields(indexName);
  const invalidFields = fields.filter(f => !validFields.includes(f));

  if (invalidFields.length > 0) {
    throw {
      type: ErrorType.HTTP_CLIENT,
      error: `Invalid search field${invalidFields.length > 1 ? 's' : ''}: ${invalidFields.join(', ')}`,
      details: `These fields are not indexed for search. They may exist in document metadata but cannot be used for filtering or aggregations.`,
      suggestion: `Valid searchable fields: ${validFields.join(', ')}`,
      status: 400
    } as ApiError;
  }
}
