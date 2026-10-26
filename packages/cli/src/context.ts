import { z } from 'zod';
import type { FseApplicationInfo, FseRequestContext } from '@massimiliano-dev/fse-gateway-client';
import { CliError, readLimitedFile } from './files.js';
import type { CliIo } from './io.js';

/**
 * Operator/organisation context for the JWT claims, read from a JSON file (`--context` or
 * `FSE_CONTEXT_FILE`). The patient (`person_id`) and the document type (`resource_hl7_type`) are taken from
 * the CDA itself, so a patient's fiscal code never has to be typed on the command line.
 */
const contextSchema = z.strictObject({
  subject: z.string().min(1),
  subjectRole: z.enum([
    'AAS',
    'APR',
    'PSS',
    'INF',
    'FAR',
    'DSA',
    'DAM',
    'OAM',
    'ASS',
    'TUT',
    'ING',
    'GEN',
    'NOR',
    'DRS',
    'RSA',
    'MRP',
    'INI',
    'OGC',
    'OPI',
    'MDS',
    'GTW',
    'DAP',
  ]),
  subjectOrganizationId: z.string().min(1),
  subjectOrganization: z.string().min(1),
  locality: z.string().min(1),
  patientConsent: z.boolean(),
  purposeOfUse: z.enum(['TREATMENT', 'UPDATE', 'ACCESS UPDATE', 'SYSADMIN']).optional(),
  useSubjectAsAuthor: z.boolean().optional(),
  application: z.strictObject({
    id: z.string().min(1),
    vendor: z.string().min(1),
    version: z.string().min(1),
  }),
});

/** Parsed context file. */
export type CliContextFile = z.infer<typeof contextSchema>;

/** Loads and validates the context file. Error messages name the fields, never their values. */
export async function loadContextFile(io: CliIo, path: string | undefined): Promise<CliContextFile> {
  const file = path ?? io.env.FSE_CONTEXT_FILE;
  if (!file) throw new CliError('A context file is required: --context <file.json> or FSE_CONTEXT_FILE');
  const raw = await readLimitedFile(io.cwd, file, 64 * 1024, 'Context file');
  let json: unknown;
  try {
    json = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new CliError('The context file is not valid JSON');
  }
  const parsed = contextSchema.safeParse(json);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join('.') || '(root)').join(', ');
    throw new CliError(`Invalid context file, check fields: ${fields}`);
  }
  return parsed.data;
}

/** Combines the context file with values extracted from the CDA. */
export function buildRequestContext(
  file: CliContextFile,
  fromCda: { personId: string; resourceHl7Type: string },
): { context: FseRequestContext; application: FseApplicationInfo } {
  const { application, ...rest } = file;
  return {
    application,
    context: {
      ...rest,
      personId: fromCda.personId,
      resourceHl7Type: fromCda.resourceHl7Type,
    },
  };
}
