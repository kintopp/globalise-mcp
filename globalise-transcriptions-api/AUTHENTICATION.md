# Access & Authentication

The GLOBALISE Transcriptions API is a **public API** with no authentication required.

## No Authentication Required

- **No API keys** - Access is open to everyone
- **No registration** - No account needed
- **No tokens** - No OAuth or bearer tokens
- **No rate limit headers** - No documented rate limiting

Simply make requests directly to the API endpoints. Both `gloccoli.tt.di.huc.knaw.nl` and
`transcriptions.globalise.huygens.knaw.nl` are reachable directly from ordinary client networks
(verified 2026-08-03 from a local CLI for search, document retrieval, `/config`, index
discovery, and CORS preflight).

## CORS Policy

The API supports Cross-Origin Resource Sharing (CORS) for browser-based applications.
CORS headers are returned **only when the request includes an `Origin` header** (i.e. real
browser requests and preflight `OPTIONS`); a plain server-to-server request without `Origin`
receives none.

The server **reflects the caller's `Origin`** rather than returning a literal `*`, and allows credentials:

```
Access-Control-Allow-Origin: <your request's Origin>
Access-Control-Allow-Credentials: true
```

A preflight `OPTIONS` additionally returns:

```
Access-Control-Allow-Methods: OPTIONS,GET,PUT,POST,DELETE,HEAD
Access-Control-Allow-Headers: X-Requested-With,Content-Type,Accept,Origin
Access-Control-Max-Age: 1800
```

In practice any origin is accepted, so you can call the API directly from JavaScript running in any web browser without proxy servers or backend intermediaries. (Note: because the response sets `Allow-Credentials: true`, the server must echo a specific origin — the CORS spec forbids combining a literal `*` with credentials.)

**Example Browser Usage:**

```javascript
// Works directly in the browser - no CORS issues
const response = await fetch(
  "https://gloccoli.tt.di.huc.knaw.nl/projects/globalise/search?indexName=globalise-2024.03.18-test&size=10",
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "schip", terms: {}, aggs: {} })
  }
);
```

## Rate Limiting

**Currently:** No documented rate limits exist.

**Best Practices:**
- Add reasonable delays between bulk requests (e.g., 100-500ms)
- Use pagination instead of requesting very large result sets
- Cache responses when appropriate
- Avoid parallel requests to the same endpoint

**Example with Delay:**

```javascript
async function bulkSearch(queries) {
  const results = [];

  for (const query of queries) {
    const response = await searchTranscriptions(query);
    results.push(response);

    // Be respectful - add delay between requests
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  return results;
}
```

## Request Timeouts

The API may timeout for complex queries or large result sets:

- **Recommended client timeout:** 30 seconds
- **Timeout mitigation:**
  - Reduce `size` parameter (use smaller page sizes)
  - Use more specific search terms
  - Add filters to narrow results

**Example with Timeout Handling:**

```javascript
async function searchWithTimeout(query, timeoutMs = 30000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(
      "https://gloccoli.tt.di.huc.knaw.nl/projects/globalise/search?indexName=globalise-2024.03.18-test&size=10",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: query, terms: {}, aggs: {} }),
        signal: controller.signal
      }
    );

    clearTimeout(timeoutId);
    return response.json();
  } catch (error) {
    clearTimeout(timeoutId);

    if (error.name === "AbortError") {
      throw new Error("Request timed out. Try reducing result size or narrowing your search.");
    }
    throw error;
  }
}
```

```javascript
// Node.js with axios
const axios = require("axios");

const response = await axios.post(
  "https://gloccoli.tt.di.huc.knaw.nl/projects/globalise/search",
  { text: "schip", terms: {}, aggs: {} },
  {
    params: { indexName: "globalise-2024.03.18-test", size: 10 },
    timeout: 30000 // 30 second timeout
  }
);
```

## Content Types

**Request Content-Type:**

| Endpoint | Content-Type |
|----------|--------------|
| POST endpoints | `application/json` |
| GET endpoints | Not required |

**Response Content-Type:**

All endpoints return: `application/json; charset=utf-8`

## Usage Guidelines

While there are no technical restrictions, please use the API responsibly:

1. **Cache responses** - Document content rarely changes
2. **Use pagination** - Don't request thousands of results at once
3. **Be respectful** - This is a research infrastructure service
4. **Cite properly** - Credit the GLOBALISE project when using data

## License

All transcriptions are available under **CC0 (Creative Commons Zero)** license, meaning:

- Free to use for any purpose
- No attribution legally required
- Can be modified, distributed, and used commercially

**However,** academic citation is expected when using the data in research:

```
NL-HaNA, VOC, [inv.nr.], [scan nr.], transcription GLOBALISE project
(https://globalise.huygens.knaw.nl/), March 2024
```

## Security Considerations

Since the documented API surface is read-only and does not use application credentials:

- **No sensitive data** - All content is historical public records
- **No write operations** - API is read-only
- **No user data** - No personal information is collected
- **HTTPS only** - All endpoints use TLS encryption

## Service Availability

The API is hosted by KNAW Humanities Cluster (HuC) infrastructure:

- **No SLA** - This is a research service, not a commercial API
- **Maintenance windows** - May occur without notice
- **Best effort** - Service is provided as-is

For production applications, consider:
- Implementing retry logic with exponential backoff
- Caching responses locally
- Handling service unavailability gracefully
