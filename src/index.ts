/**
 * OCRQueen — official Node.js SDK.
 *
 * Public surface is the union of every `export` in this file. Anything
 * else in `src/` is internal and may change between patch releases.
 *
 * Mirror of the Python SDK's `ocrqueen/__init__.py`.
 */

export { OCRQueen } from "./_client.js";
export type { OCRQueenOptions } from "./_client.js";

export {
  APIConnectionError,
  APIError,
  APITimeoutError,
  AuthenticationError,
  BadRequestError,
  InsufficientBalanceError,
  NotFoundError,
  OCRQueenError,
  PermissionDeniedError,
  RateLimitError,
  ServerError,
  ValidationError,
} from "./_errors.js";

export type {
  ExtractCreateOptions,
  ExtractJob,
  FileInput,
} from "./resources/extract.js";

export type {
  JobList,
  JobStatus,
  ListJobsOptions,
  WaitOptions,
} from "./resources/jobs.js";

export { VERSION } from "./version.js";
export { verifyWebhook } from "./webhooks.js";
export type { VerifyWebhookOptions } from "./webhooks.js";
