# ocrqueen-node

Official Node.js SDK for the [OCRQueen](https://ocrqueen.com) document and image extraction API.

> 🚧 **Status:** Pre-release. APIs and surface area will change before `v1.0.0`.

## Installation

```bash
npm install ocrqueen
# or
pnpm add ocrqueen
# or
yarn add ocrqueen
```

Requires Node.js 18 or newer.

## Supported formats

| Category | Formats |
|---|---|
| Documents | **PDF** |
| Presentations | **PPTX**, **PPT** (PowerPoint) |
| Images | **PNG**, **JPEG**, **WebP**, **HEIC** / **HEIF** (iPhone photos) |

The API returns structured JSON + Markdown for every supported type —
text, tables, images, and (with `profile: "advanced"`) diagram graph
extraction and image alt-text.

## Quickstart

```typescript
import { OCRQueen } from "ocrqueen";
import fs from "node:fs";

const client = new OCRQueen({ apiKey: "pk_..." });

const job = await client.extract.create({
  file: fs.readFileSync("paper.pdf"),
});

const result = await client.jobs.wait(job);
console.log(result.result?.markdown);
```

Get an API key from [dashboard.ocrqueen.com](https://ocrqueen.com/dashboard/keys).

### Other file types

```typescript
// Slide decks — speaker notes are preserved
await client.extract.create({ file: fs.readFileSync("pitch.pptx") });

// iPhone photos — HEIC handled natively, no conversion needed
await client.extract.create({ file: fs.readFileSync("receipt.heic") });

// Scanned document images
await client.extract.create({ file: fs.readFileSync("invoice.png") });

// Deeper extraction profile — diagrams, image alt-text, OCR on
// embedded text
await client.extract.create({
  file: fs.readFileSync("paper.pdf"),
  profile: "advanced",
});
```

### Patent extraction (`domain: "patent"`)

Route a PPTX or PDF through the patent-specific pipeline: region
classification (cover / abstract / drawings / claims / references),
Gemini cover parser, LibreOffice rasterisation for EMF/WMF figures,
cross-figure numeral resolution, and an honest per-stage
`faithfulness_score`. Billed flat at $0.05/page regardless of profile.

```typescript
import fs from "node:fs";

const job = await client.extract.create({
  file: fs.readFileSync("invention-disclosure.pptx"),
  options: { domain: "patent" },
});
const done = await client.jobs.wait(job);
const patent = done.result as Record<string, unknown>; // PatentExtractionResponse shape

console.log((patent.source as any).input_kind);        // "invention_disclosure" | "published_patent" | "unknown"
console.log((patent.extraction as any).faithfulness_score);

// Figures carry a stable proxy URL — never expires until the underlying
// object is purged by your retention window. fetchImage() handles the
// 302 → signed-storage dance and returns a Uint8Array.
for (const fig of patent.drawings as Array<Record<string, unknown>>) {
  const bytes = await client.jobs.fetchImage(fig.image_url as string);
  fs.writeFileSync(
    `${String(fig.figure_number).replace(/\s+/g, "_")}.png`,
    bytes,
  );
}
```

The same `fetchImage()` helper works for general-domain `ImageBlock`
URLs (`pages[].blocks[].url`) — useful for snapshotting all figures
from a job into your own pipeline.

## Documentation

- Full API reference: <https://ocrqueen.com/docs>
- Node SDK guide: <https://ocrqueen.com/docs/sdks/node>
- Data retention & deletion: <https://ocrqueen.com/docs/data-retention>

## License

MIT — see [LICENSE](LICENSE).
