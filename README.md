# ocrqueen-node

Official Node.js SDK for the [OCRQueen](https://ocrqueen.com) document extraction API.

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

## Quickstart

```typescript
import { OCRQueen } from "ocrqueen";
import fs from "node:fs";

const client = new OCRQueen({ apiKey: "pk_..." });

const job = await client.extract.create({
  file: fs.createReadStream("paper.pdf"),
});

const result = await job.wait();
console.log(result.markdown);
```

Get an API key from [dashboard.ocrqueen.com](https://ocrqueen.com/dashboard/keys).

## Documentation

- Full API reference: <https://ocrqueen.com/docs>
- Node SDK guide: <https://ocrqueen.com/docs/sdks/node>

## License

MIT — see [LICENSE](LICENSE).
