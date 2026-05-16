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
  file: fs.readFileSync("patent.pdf"),
  profile: "advanced",
});
```

## Documentation

- Full API reference: <https://ocrqueen.com/docs>
- Node SDK guide: <https://ocrqueen.com/docs/sdks/node>
- Data retention & deletion: <https://ocrqueen.com/docs/data-retention>

## License

MIT — see [LICENSE](LICENSE).
