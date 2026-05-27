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

Requires Node.js 20 or newer.

## Supported formats

| Category | Formats |
|---|---|
| Documents | **PDF** |
| Presentations | **PPTX**, **PPT** (PowerPoint) |
| Images | **PNG**, **JPEG**, **WebP**, **HEIC** / **HEIF** (iPhone photos) |

The API returns structured JSON + Markdown for every supported type —
text, tables, images, math, code, diagram graphs, and reference linking
— from a single unified pipeline. No profiles, no toggles.

## Quickstart

```typescript
import { OCRQueen } from "ocrqueen";
import fs from "node:fs";

const client = new OCRQueen({ apiKey: "pk_..." });

const job = await client.extract.create({
  file: fs.readFileSync("paper.pdf"),
});

const final = await client.jobs.wait(job);
console.log(final.markdown);
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
```

### Fetching extracted images

Image blocks carry a stable proxy URL — it never expires until the
underlying object is purged by your retention window. `fetchImage()`
handles the 302 → signed-storage dance for you and returns raw bytes.

```typescript
import fs from "node:fs";

const final = await client.jobs.wait(job);
const pages = (final.document?.pages ?? []) as Array<Record<string, unknown>>;
for (const page of pages) {
  const blocks = (page.blocks ?? []) as Array<Record<string, unknown>>;
  for (const block of blocks) {
    if (block.kind === "image") {
      const bytes = await client.jobs.fetchImage(block.url as string);
      fs.writeFileSync(`${block.id}.png`, bytes);
    }
  }
}
```

## Documentation

- Full API reference: <https://ocrqueen.com/docs>
- Node SDK guide: <https://ocrqueen.com/docs/sdks/node>
- Data retention & deletion: <https://ocrqueen.com/docs/data-retention>

## License

MIT — see [LICENSE](LICENSE).
