/**
 * Public client — what users instantiate.
 *
 *     import { OCRQueen } from "ocrqueen";
 *     const client = new OCRQueen({ apiKey: "pk_..." });
 *     const job = await client.extract.create({ file: fs.readFileSync("paper.pdf") });
 *
 * The client owns the HTTP transport and exposes resource sub-objects
 * (`client.extract`, `client.jobs`, etc.). Each resource is a separate
 * file in `resources/`. Stripe-style; reads naturally; surface area
 * is grouped by domain rather than dumped onto a single class.
 *
 * Lifecycle:
 *   - Reuse one client per process. Constructing one per call is fine
 *     in tests but wasteful in prod (TLS handshake every time).
 *   - There is no explicit close — native fetch's connection reuse is
 *     handled by Node's HTTP agent. No file descriptors leak.
 *
 * Mirror of the Python SDK's `ocrqueen/_client.py`.
 */

import { HttpClient } from "./_http.js";
import type { HttpClientOptions } from "./_http.js";
import { ExtractResource } from "./resources/extract.js";

export type OCRQueenOptions = HttpClientOptions;

export class OCRQueen {
  readonly #http: HttpClient;
  #extract: ExtractResource | null = null;

  constructor(opts: OCRQueenOptions | undefined = undefined) {
    // Resolve apiKey + baseUrl from env when not passed explicitly.
    // The env values still get validated by HttpClient — an attacker
    // who controls `OCRQUEEN_BASE_URL` cannot smuggle in `http://...`.
    const apiKey = opts?.apiKey ?? process.env["OCRQUEEN_API_KEY"] ?? "";
    const envBaseUrl = process.env["OCRQUEEN_BASE_URL"];
    const http = new HttpClient({
      apiKey,
      ...(opts?.baseUrl !== undefined
        ? { baseUrl: opts.baseUrl }
        : envBaseUrl !== undefined
          ? { baseUrl: envBaseUrl }
          : {}),
      ...(opts?.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
      ...(opts?.userAgentSuffix !== undefined ? { userAgentSuffix: opts.userAgentSuffix } : {}),
    });
    this.#http = http;
  }

  /** Document extraction — submit files, get structured data back. */
  get extract(): ExtractResource {
    // Lazy-init: customers who don't use the extract resource don't
    // pay the construction cost. Property getter caches the instance.
    if (this.#extract === null) {
      this.#extract = new ExtractResource(this.#http);
    }
    return this.#extract;
  }
}
