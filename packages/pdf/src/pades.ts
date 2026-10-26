/**
 * Applies a PAdES signature to a PDF that already contains the `cda.xml` attachment.
 *
 * The gateway requires the PDF to be signed in PAdES format by the author (README §2 and accreditation
 * process, "verifica della corretta apposizione della firma PADES"). Signing keys of physicians usually
 * live in smart cards, HSMs or remote signing services ("firma remota"), so this package defines only the
 * hook: implement it with your signing provider. The order matters: `injectCda()` first, then `sign()`,
 * because any change after signing invalidates the signature.
 *
 * Implementations must:
 * - produce a PAdES-B (or higher) signature over the whole document;
 * - never log the PDF or the CDA, and keep the signing credentials outside the application when possible.
 *
 * Status: interface only. TODO(verify): required PAdES level (B-B / B-T) and signature policy.
 */
export interface PadesSigner {
  sign(pdf: Uint8Array): Promise<Uint8Array>;
}
