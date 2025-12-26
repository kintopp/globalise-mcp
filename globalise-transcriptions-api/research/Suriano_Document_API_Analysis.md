# Suriano Document-Level API Analysis

**Date:** December 26, 2025
**Purpose:** Analyze document detail API calls from Suriano to identify features for Globalise MCP

---

## Executive Summary

Suriano's document detail view makes **4 distinct types of API calls**, revealing a hierarchical document structure not documented in the Globalise API reference:

1. **Document body retrieval** - Main content (`urn:suriano:letter_body:{id}`)
2. **File-level retrieval** - Additional metadata (`urn:suriano:file:{id}`) ⭐ **NEW!**
3. **IIIF Manifest** - Image viewer configuration (`/files/manifests/{id}.json`)
4. **IIIF Image Info** - Image metadata (`/iiif/3/pages/{filename}/info.json`)

---

## API Call Breakdown

### 1. Document Body Retrieval (Letter Body)

**Endpoint:**
```
GET /projects/suriano/urn:suriano:letter_body:1811223
```

**Query Parameters:**
```
overlapTypes=tei:Div,tei:Hi,tf:Ent,tei:Head,tei:Metamark,tei:Note,tei:Ptr,tf:File,tf:Folder,tf:Page,LetterBody
includeResults=anno,iiif,text
views=self
relativeTo=Origin
```

**Response Structure:**
```json
{
  "profile": { /* performance metrics */ },
  "request": { /* echoes request params */ },
  "anno": [ /* 41 annotations */ ],
  "views": {
    "self": {
      "lines": [ /* 20 lines of transcribed text */ ]
    }
  },
  "iiif": [ /* IIIF data - NOT IN GLOBALISE DOCS! */ ]
}
```

**Key Observations:**

1. **`iiif` key in response** - This is NOT documented in Globalise API!
   - Globalise docs show IIIF data in `anno[].target[]`
   - Suriano has a separate top-level `iiif` array

2. **Multiple overlapTypes** - 11 different annotation types requested:
   ```
   tei:Div, tei:Hi, tf:Ent, tei:Head, tei:Metamark,
   tei:Note, tei:Ptr, tf:File, tf:Folder, tf:Page, LetterBody
   ```
   - Globalise docs only show `px:Page`

3. **41 annotations returned** - Much richer structure than Globalise examples
   - First annotation type: `tf:File` (not `px:Page` like Globalise)
   - Metadata includes: `date`, `sender`, `recipient`, `shelfmark`, `summary`, `nextFile`

---

### 2. File-Level Retrieval ⭐ **NEW DISCOVERY**

**Endpoint:**
```
GET /projects/suriano/urn:suriano:file:1811223
```

**Query Parameters:**
```
overlapTypes=tei:Note
includeResults=anno,text
views=self
relativeTo=Origin
```

**Response Structure:**
```json
{
  "profile": {},
  "request": {},
  "anno": [ /* 8 annotations */ ],
  "views": {
    "self": {
      "lines": [ /* 50 lines */ ]
    }
  }
}
```

**Key Observations:**

1. **Hierarchical URN structure:**
   - Letter body: `urn:suriano:letter_body:1811223`
   - File level: `urn:suriano:file:1811223` ⭐

2. **Different overlap types:**
   - Only requests `tei:Note` (editor notes)
   - No IIIF data requested (`includeResults=anno,text` only)

3. **More text lines:**
   - Letter body: 20 lines
   - File level: 50 lines
   - File view may include metadata/headers

4. **Annotation types:**
   - 8 annotations, all type `tei:Note`
   - Metadata: `type`, `lang`

**Analysis:**
This suggests a **two-level document hierarchy**:
- **File** = Container (manuscript page/document)
- **Letter body** = Content region within file

**Question for Globalise:**
Does Globalise support `urn:globalise:file:{id}` URNs?

---

### 3. IIIF Manifest Retrieval

**Endpoint:**
```
GET https://data.suriano.huygens.knaw.nl/files/manifests/02.json
```

**Different domain!** `data.suriano.huygens.knaw.nl` (not `broccoli.suriano...`)

**Response Structure:**
```json
{
  "@context": "...",
  "manifestInventory": "...",
  "type": "Manifest",
  "label": "...",
  "metadata": [],
  "summary": "...",
  "rights": "...",
  "provider": [],
  "items": []
}
```

**Key Observations:**

1. **Standard IIIF Presentation API 3.0** format
2. Separate service domain for IIIF data
3. Manifest ID corresponds to file/folder number (`02.json`)

**Globalise Equivalent:**
Globalise documents include IIIF Canvas URLs in `anno[].target[]`:
```
"source": "https://data.globalise.huygens.knaw.nl/manifests/inventories/9966.json/canvas/p106"
```

---

### 4. IIIF Image Info

**Endpoint:**
```
GET https://data.suriano.huygens.knaw.nl/iiif/3/pages%2F02_071r.jpg/info.json
```

**Response:**
```
Content-Type: application/ld+json;charset=UTF-8;profile="http://iiif.io/api/image/3/context.json"
```

**Key Observations:**

1. **IIIF Image API 3.0** standard
2. URL-encoded image path: `pages/02_071r.jpg`
3. Returns image dimensions, tile sizes, etc.

**Globalise Equivalent:**
Globalise includes IIIF image URLs in `anno[].target[]`:
```
"source": "https://service.archief.nl/iip/..."
```

---

## Comparison: Suriano vs Globalise Document APIs

### Query Parameters

| Parameter | Suriano Letter Body | Suriano File | Globalise (Documented) |
|-----------|-------------------|--------------|------------------------|
| `overlapTypes` | 11 types (comma-separated) | `tei:Note` | `px:Page` |
| `includeResults` | `anno,iiif,text` | `anno,text` | `anno,text` |
| `views` | `self` | `self` | `self` |
| `relativeTo` | `Origin` | `Origin` | `Origin` |

**Observations:**
- Suriano requests **more annotation types**
- Suriano explicitly requests **`iiif` in includeResults** ⭐
- Globalise docs don't mention `iiif` option

---

### Response Structure

| Field | Suriano | Globalise (Documented) |
|-------|---------|------------------------|
| `profile` | ✅ Yes | ✅ Yes |
| `request` | ✅ Yes | ✅ Yes |
| `anno` | ✅ 41 items | ✅ 1-N items |
| `views.self.lines` | ✅ Yes | ✅ Yes |
| `iiif` | ✅ **Top-level array** | ❌ **Not documented** |

**Critical Finding:**
Suriano has a **separate `iiif` key** in the response, not documented in Globalise API reference.

---

### Annotation Structure

**Suriano First Annotation:**
```json
{
  "type": "Annotation",
  "body": {
    "type": "tf:File",
    "metadata": {
      "type": "...",
      "date": "1616-07-09",
      "editorNotes": "",
      "file": "...",
      "recipient": "Doge and Senate of Venice",
      "recipientLoc": "Venice",
      "sender": "Christofforo Suriano",
      "senderLoc": "Stuttgart",
      "shelfmark": "ASVe, Senato, Dispacci, Signori Stati, Filza 2, 71r-74v",
      "summary": "Reports on his audience with...",
      "nextFile": "urn:suriano:file:1811224"
    }
  }
}
```

**Globalise (Documented):**
```json
{
  "type": "Annotation",
  "body": {
    "type": "px:Page",
    "metadata": {
      "type": "PageMetadata",
      "document": "NL-HaNA_1.04.02_9966_0106",
      "file": "NL-HaNA_1.04.02_9966_0106.xml",
      "inventoryNumber": "9966",
      "n": "0106",
      "creator": "Laypa",
      "lang": [{"iso": "nld", "label": "Dutch"}],
      "prevPageId": "...",
      "nextPageId": "..."
    }
  }
}
```

**Differences:**
- Suriano: `tf:File` type, rich historical metadata (sender, recipient, date, shelfmark)
- Globalise: `px:Page` type, technical metadata (creator, language, inventory)
- Both have navigation (`nextFile` vs `nextPageId`)

---

## New Features for Globalise MCP

### 🆕 1. IIIF Data in Response (`includeResults=iiif`)

**Status:** NOT documented for Globalise

**Suriano Pattern:**
```
GET /projects/suriano/urn:...?includeResults=anno,iiif,text
```

**Potential Globalise Usage:**
```
GET /projects/globalise/urn:globalise:...?includeResults=anno,iiif,text
```

**Action Items:**
- [ ] Test if Globalise supports `includeResults=iiif` parameter
- [ ] Check if response includes top-level `iiif` array
- [ ] If supported, add to MCP server document retrieval

---

### 🆕 2. Multiple Overlap Types

**Status:** Globalise docs only show `px:Page`

**Suriano Usage:**
```
overlapTypes=tei:Div,tei:Hi,tf:Ent,tei:Head,tei:Metamark,tei:Note,tei:Ptr,tf:File,tf:Folder,tf:Page,LetterBody
```

**Question:**
What annotation types does Globalise support?

**Action Items:**
- [ ] Check `/brinta/globalise/config` or schema docs for available annotation types
- [ ] Test if Globalise supports comma-separated `overlapTypes`
- [ ] Document available types for users

---

### 🆕 3. File-Level URN Structure

**Status:** UNKNOWN if Globalise supports this

**Suriano Pattern:**
```
urn:suriano:letter_body:1811223  (content level)
urn:suriano:file:1811223         (file/page level)
```

**Potential Globalise Pattern:**
```
urn:globalise:NL-HaNA_1.04.02_9966_0106  (page level - documented)
urn:globalise:file:???                    (file level - unknown)
```

**Analysis:**
Globalise URN structure already includes the page/scan identifier (`0106` in example above). It may not have a separate "file" level because each page is individually scanned and transcribed.

**Action Items:**
- [ ] Research Globalise document hierarchy
- [ ] Check if there are container-level URNs above page level

---

### 🆕 4. Separate IIIF Manifest Endpoint

**Suriano:**
```
GET https://data.suriano.huygens.knaw.nl/files/manifests/02.json
```

**Globalise (in annotations):**
```
"source": "https://data.globalise.huygens.knaw.nl/manifests/inventories/9966.json/canvas/p106"
```

**Observation:**
Both projects have IIIF manifests, but:
- Suriano: Client fetches manifest directly
- Globalise: Manifest URL embedded in annotation response

**Action Items:**
- [ ] Consider adding helper function to extract manifest URLs from Globalise annotations
- [ ] Could offer IIIF Manifest retrieval as a convenience tool

---

## Testing Checklist

Before implementing features, test on Globalise API:

- [ ] Does `includeResults=anno,iiif,text` work with Globalise?
- [ ] Does response include top-level `iiif` array?
- [ ] What annotation types (`overlapTypes`) does Globalise support?
- [ ] Can we request multiple `overlapTypes` (comma-separated)?
- [ ] Are there file-level URNs in Globalise?
- [ ] Can we fetch IIIF manifests directly?

---

## Recommendations

### High Priority

1. **Test `includeResults=iiif`** ⭐
   - Could simplify IIIF data extraction
   - Currently have to parse `anno[].target[]` arrays
   - Top-level `iiif` array might be cleaner

2. **Document available annotation types** 📚
   - Globalise may support more than just `px:Page`
   - Users might want to filter by annotation type
   - Check Broccoli/Gloccoli schema docs

### Medium Priority

3. **IIIF manifest helper** 🖼️
   - Extract manifest URLs from annotations
   - Provide direct access to IIIF viewers
   - Could be useful for researchers

4. **Explore multi-level document structure** 🗂️
   - Investigate if Globalise has hierarchical URNs
   - May not be relevant (flat page structure)

---

## Conclusion

Suriano's document detail view reveals **significant API features not documented for Globalise**:

1. ✅ `includeResults=iiif` parameter - Returns top-level IIIF array
2. ✅ Multiple `overlapTypes` - Rich annotation filtering
3. ✅ Hierarchical URN structure - File-level vs content-level
4. ✅ Separate IIIF endpoints - Manifest and image info

**Impact on Globalise MCP Server:**

- **`includeResults=iiif`** - Needs testing, could improve IIIF data access
- **Multiple `overlapTypes`** - May not be relevant (Globalise uses `px:Page`)
- **File-level URNs** - Likely not applicable to Globalise's flat structure
- **IIIF endpoints** - Already accessible via annotation metadata

**Next Step:** Test `includeResults=iiif` parameter with Globalise API

---

**Analysis by:** Claude Code
**Methodology:** Browser automation + network monitoring
**Files captured:** `tmp/suriano-document-api-calls.json`
