/**
 * Pure (browser-free) extraction of the document payload from a tool result,
 * split out of viewer.ts so it can be unit-tested under node — viewer.ts pulls
 * in OpenSeadragon and the ext-apps SDK and can't load outside a DOM.
 * test-viewer-protocol.ts feeds a payload built from the server's zod schema
 * through here, cross-checking that the server↔viewer contract — and the
 * `id`-based detection — still agree (CODE-REVIEW finding 10).
 */

// The wire type is the server's own zod-inferred type, so the contract is
// defined once. `import type` is erased by esbuild, so zod and the rest of the
// server graph never enter the viewer bundle.
import type { ViewDocumentUiOutput } from '../../../src/tools/document-viewer.js';

/** The slice of an MCP tool result the viewer reads. */
export interface ParseableToolResult {
  structuredContent?: unknown;
  content?: Array<{ type: string; text?: string }>;
}

/**
 * Extract the document payload. Primary channel (R19) is structuredContent,
 * detected by the presence of `id`; the dual-content branch survives only for
 * STRUCTURED_CONTENT=false servers. Returns null if nothing parses.
 *
 * (A third "first content item if it starts with `{`" fallback was dropped as
 * unreachable: in STRUCTURED_CONTENT=true mode content[0] is the human-readable
 * summary, and in =false mode the JSON is content[1], caught below — CODE-REVIEW
 * finding 18.)
 */
export function parseDocumentResult(result: ParseableToolResult): ViewDocumentUiOutput | null {
  // Primary channel: the server mirrors the document as structuredContent.
  const structured = result.structuredContent;
  if (structured && typeof structured === 'object' && 'id' in structured) {
    return structured as ViewDocumentUiOutput;
  }

  // Fallback: legacy dual-content shape [human-readable text, JSON data].
  if (result.content && result.content.length >= 2) {
    const jsonContent = result.content[1];
    if (jsonContent?.type === 'text' && jsonContent.text) {
      try {
        return JSON.parse(jsonContent.text) as ViewDocumentUiOutput;
      } catch {
        // not JSON — fall through to null
      }
    }
  }

  return null;
}
