# Archived MCP Resources

This directory contains the content of MCP resources that were removed from the GLOBALISE MCP server in version 1.17.0.

## Why Resources Were Removed

MCP resources, even when optimized, consume significant portions of the user's context window. Additionally, they are not yet properly supported by Claude Desktop. Removing them improves the user experience by:

1. **Reducing context window usage** - More context available for actual transcriptions and search results
2. **Better client compatibility** - Avoiding features not well-supported by all MCP clients
3. **Cleaner implementation** - Resources reimplemented as tools will be more functional

## Contents

### query-syntax/
Query syntax reference for the GLOBALISE search API. Originally provided as a markdown resource.

**Size:** ~2 KB
**Original URI:** `globalise://help/query-syntax`

### weights-measures/
VOC weights and measures glossary with 213 units and 385 spelling variants.

**Size:** 155 KB
**Original URI:** `globalise://reference/weights-measures`
**Source:** https://hdl.handle.net/10622/MDNVH5

### commodities/
VOC commodities thesaurus (minimal version) with 1,359 concepts and 2,481 variants.

**Size:** 202 KB
**Original URI:** `globalise://reference/commodities`
**Source:** https://hdl.handle.net/10622/YAWDOV

## Future Plans

These will be reimplemented as **MCP tools** with:

- **Query syntax** - Integrate directly into search tool descriptions or provide as a simple reference tool
- **Weights & measures** - Lookup tool backed by SQLite database for efficient variant-to-unit mapping
- **Commodities** - Search/lookup tool backed by SQLite database with full thesaurus navigation

See `TODO.md` for implementation tracking.

## License

All data from the GLOBALISE Project is licensed under CC-BY-SA-4.0.
