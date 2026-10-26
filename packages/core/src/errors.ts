import { redact } from './redact.js';

/**
 * Base class of every error thrown by the FSE packages. The message is always passed through
 * {@link redact}, so tokens, keys, fiscal codes and CDA bodies cannot leak through `error.message`,
 * `error.stack` or `JSON.stringify(error)`.
 */
export class FseError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(
      redact(message),
      options?.cause === undefined ? undefined : { cause: sanitizeCause(options.cause) },
    );
    this.name = new.target.name;
  }

  /** Safe serialisation for structured loggers. */
  toJSON(): Record<string, unknown> {
    return { name: this.name, message: this.message };
  }
}

/**
 * Keeps only the type and code of an underlying error. Library errors (TLS, sockets, parsers) can embed
 * request data in their message or properties, so the original object is never attached.
 */
function sanitizeCause(cause: unknown): Error {
  if (cause instanceof Error) {
    const safe = new Error(redact(cause.message));
    safe.name = cause.name;
    const code = (cause as { code?: unknown }).code;
    if (typeof code === 'string') (safe as Error & { code?: string }).code = code;
    // The original stack may contain request data in frames' messages: drop it.
    safe.stack = `${safe.name}: ${safe.message}`;
    return safe;
  }
  return new Error('non-Error cause');
}

/** Reason an XML document was refused before parsing. */
export type UnsafeXmlReason = 'too-large' | 'encoding' | 'doctype';

/** Thrown by {@link assertSafeXml} when an XML input is refused before any parsing happens. */
export class UnsafeXmlError extends FseError {
  constructor(
    readonly reason: UnsafeXmlReason,
    message: string,
  ) {
    super(message);
  }
}

/** Thrown by API methods that are typed but not implemented yet in this release. */
export class NotImplementedError extends FseError {
  constructor(readonly feature: string) {
    super(`${feature} is not implemented yet in this release of fse-client`);
  }
}

/** Thrown when an optional peer dependency (for example `saxon-js`) is needed but not installed. */
export class OptionalDependencyMissingError extends FseError {
  constructor(
    readonly dependency: string,
    purpose: string,
  ) {
    super(
      `${purpose} requires the optional peer dependency "${dependency}". Install it to enable this feature.`,
    );
  }
}
