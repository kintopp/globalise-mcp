# Error Reference

Complete documentation of HTTP status codes and error handling for the GLOBALISE Transcriptions API.

## HTTP Status Codes

| Code | Status | Description |
|------|--------|-------------|
| 200 | OK | Request successful |
| 400 | Bad Request | Invalid request syntax or parameters |
| 404 | Not Found | Document or resource not found |
| 429 | Too Many Requests | Rate limit exceeded (if applicable) |
| 500 | Internal Server Error | Server-side error |
| 502 | Bad Gateway | Upstream service unavailable |
| 503 | Service Unavailable | Service temporarily unavailable |
| 504 | Gateway Timeout | Request took too long |

---

## Success Response (200 OK)

All successful requests return HTTP 200 with a JSON response body.

**Search Response:**
```json
{
  "total": { "value": 755310, "relation": "eq" },
  "results": [...],
  "aggs": {...}
}
```

**Document Response:**
```json
{
  "anno": [...],
  "views": { "self": { "lines": [...] } }
}
```

---

## Error Responses

### 400 Bad Request

Returned when the request is malformed or contains invalid parameters.

**Common Causes:**
- Invalid JSON in request body
- Malformed search query syntax
- Invalid query parameters

**Example Response:**
```json
{
  "error": "Invalid query syntax",
  "details": "Boolean operator 'AND' requires terms on both sides",
  "query": "AND schip"
}
```

**Solutions:**

| Problem | Solution |
|---------|----------|
| Invalid JSON | Validate JSON syntax before sending |
| Malformed query | Check [Query Syntax](./QUERY_SYNTAX.md) documentation |
| Missing required field | Ensure `text`, `terms`, and `aggs` are all present |

**Example - Handling 400 Errors:**

```javascript
async function search(query) {
  const response = await fetch(
    "https://gloccoli.tt.di.huc.knaw.nl/projects/globalise/search?indexName=globalise-2024.03.18-test",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: query, terms: {}, aggs: {} })
    }
  );

  if (response.status === 400) {
    const error = await response.json();
    throw new Error(`Invalid query: ${error.details || error.error}`);
  }

  return response.json();
}
```

---

### 404 Not Found

Returned when the requested document does not exist.

**Common Causes:**
- Invalid document URN
- Document ID typo
- Document removed from index

**Example Response:**
```json
{
  "error": "Document not found",
  "documentId": "urn:globalise:NL-HaNA_1.04.02_9966_9999"
}
```

**Solutions:**

| Problem | Solution |
|---------|----------|
| Typo in document ID | Verify the document ID format |
| Invalid URN format | Use format `urn:globalise:NL-HaNA_{archive}_{inventory}_{scan}` |
| Document doesn't exist | Search to find valid documents first |

**Example - Handling 404 Errors:**

```javascript
async function getDocument(documentId) {
  const response = await fetch(
    `https://gloccoli.tt.di.huc.knaw.nl/projects/globalise/urn:globalise:${documentId}?overlapTypes=px:Page&includeResults=anno,text&views=self&relativeTo=Origin`
  );

  if (response.status === 404) {
    throw new Error(`Document not found: ${documentId}. Verify the document ID is correct.`);
  }

  if (!response.ok) {
    throw new Error(`Failed to retrieve document: ${response.status}`);
  }

  return response.json();
}
```

---

### 429 Too Many Requests

Returned when rate limits are exceeded (if rate limiting is enabled).

**Note:** As of the current API version, no rate limiting is documented. However, implement handling for future compatibility.

**Example Response:**
```json
{
  "error": "Rate limit exceeded",
  "retryAfter": 60,
  "message": "Too many requests. Please wait before trying again."
}
```

**Solutions:**

| Problem | Solution |
|---------|----------|
| Too many requests | Add delays between requests |
| Bulk operations | Implement exponential backoff |

**Example - Handling 429 Errors:**

```javascript
async function searchWithRetry(query, maxRetries = 3) {
  let lastError;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(
        "https://gloccoli.tt.di.huc.knaw.nl/projects/globalise/search?indexName=globalise-2024.03.18-test",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: query, terms: {}, aggs: {} })
        }
      );

      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After") || 60;
        console.log(`Rate limited. Waiting ${retryAfter} seconds...`);
        await new Promise(r => setTimeout(r, retryAfter * 1000));
        continue;
      }

      return response.json();
    } catch (error) {
      lastError = error;
      // Exponential backoff
      await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
    }
  }

  throw lastError;
}
```

---

### 500 Internal Server Error

Returned when the server encounters an unexpected error.

**Common Causes:**
- Server-side bug
- Database connection issues
- Unexpected query patterns

**Example Response:**
```json
{
  "error": "Internal server error",
  "message": "An unexpected error occurred while processing your request"
}
```

**Solutions:**

| Problem | Solution |
|---------|----------|
| Transient error | Retry the request after a short delay |
| Persistent error | Report to GLOBALISE project maintainers |
| Complex query | Simplify query and try again |

---

### 502 Bad Gateway / 503 Service Unavailable

Returned when upstream services are unavailable.

**Common Causes:**
- Scheduled maintenance
- Infrastructure issues
- High load

**Solutions:**
- Retry after a delay
- Check if the service is under maintenance
- Implement circuit breaker pattern for production apps

---

### 504 Gateway Timeout

Returned when the request takes too long to process.

**Common Causes:**
- Very broad search queries
- Large result set requests
- Complex aggregations
- Server under heavy load

**Example Response:**
```json
{
  "error": "Request timeout",
  "suggestion": "Try reducing result set size or narrowing search scope"
}
```

**Solutions:**

| Problem | Solution |
|---------|----------|
| Large result set | Reduce `size` parameter |
| Broad query | Use more specific search terms |
| Complex filters | Simplify aggregation requests |
| High load | Retry after a delay |

**Example - Timeout Prevention:**

```javascript
// Instead of requesting many results at once
// BAD: size=1000
const badRequest = { text: "*", terms: {}, aggs: {}, size: 1000 };

// GOOD: Use pagination with smaller pages
async function getAllResults(query, maxResults = 1000) {
  const pageSize = 50;
  const results = [];

  for (let from = 0; from < maxResults; from += pageSize) {
    const response = await fetch(
      `https://gloccoli.tt.di.huc.knaw.nl/projects/globalise/search?indexName=globalise-2024.03.18-test&from=${from}&size=${pageSize}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: query, terms: {}, aggs: {} })
      }
    );

    const data = await response.json();
    results.push(...data.results);

    if (results.length >= data.total.value) break;

    // Add delay between requests
    await new Promise(r => setTimeout(r, 100));
  }

  return results;
}
```

---

## Error Handling Best Practices

### 1. Always Check Response Status

```javascript
async function apiRequest(url, options) {
  const response = await fetch(url, options);

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new ApiError(response.status, error.message || error.error);
  }

  return response.json();
}

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}
```

### 2. Implement Retry Logic

```javascript
async function withRetry(fn, maxRetries = 3, delay = 1000) {
  let lastError;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Don't retry client errors (4xx)
      if (error.status >= 400 && error.status < 500) {
        throw error;
      }

      // Exponential backoff for server errors
      await new Promise(r => setTimeout(r, delay * Math.pow(2, i)));
    }
  }

  throw lastError;
}

// Usage
const results = await withRetry(() => search("schip"));
```

### 3. Set Appropriate Timeouts

```javascript
// Browser with AbortController
async function searchWithTimeout(query, timeoutMs = 30000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal, ...options });
    return response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

// Node.js with axios
const axios = require("axios");
const client = axios.create({ timeout: 30000 });
```

### 4. Provide User-Friendly Error Messages

```javascript
function getUserMessage(error) {
  switch (error.status) {
    case 400:
      return "Invalid search query. Please check your syntax.";
    case 404:
      return "Document not found. It may have been removed.";
    case 429:
      return "Too many requests. Please wait a moment and try again.";
    case 500:
    case 502:
    case 503:
      return "Service temporarily unavailable. Please try again later.";
    case 504:
      return "Search took too long. Try a more specific query.";
    default:
      return "An unexpected error occurred. Please try again.";
  }
}
```

---

## Troubleshooting Guide

| Symptom | Likely Cause | Solution |
|---------|--------------|----------|
| 400 on every request | Malformed JSON | Validate JSON before sending |
| 400 on search | Invalid query syntax | Use simpler query, check [Query Syntax](./QUERY_SYNTAX.md) |
| 404 on document | Wrong document ID | Search first to find valid IDs |
| 504 frequently | Too many results | Use smaller `size`, add filters |
| 502/503 errors | Service down | Wait and retry later |
| CORS errors | Missing headers | API supports CORS; check your code |
| Empty results | Overly specific query | Broaden search terms |
