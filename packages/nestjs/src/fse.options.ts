import type { InjectionToken, ModuleMetadata, OptionalFactoryDependency } from '@nestjs/common';
import type { FseGatewayClientOptions } from '@massimiliano-dev/fse-gateway-client';
import type { CdaValidator, FseCdaSchemaVariant } from '@massimiliano-dev/fse-validator';

/**
 * Builds the XSD validator from the catalogs bundled in fse-validator or, with `catalogsDir`, from a local
 * it-fse-catalogs checkout (`pnpm sync:catalogs`).
 */
export interface FseCatalogsValidatorOptions {
  catalogsDir?: string;
  variant?: FseCdaSchemaVariant;
  maxInputBytes?: number;
}

/** Options of {@link FseModule}. Load certificates and keys from a secret store in `useFactory`. */
export interface FseModuleOptions {
  gateway: FseGatewayClientOptions;
  /** A validator instance, or the options of the default XSD validator (`{}`: bundled catalogs). */
  validator: CdaValidator | FseCatalogsValidatorOptions;
}

/** Options of {@link FseModule.forRootAsync}. */
export interface FseModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  inject?: Array<InjectionToken | OptionalFactoryDependency>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Nest factory signature
  useFactory: (...args: any[]) => FseModuleOptions | Promise<FseModuleOptions>;
  /** Register the module globally. Default true. */
  isGlobal?: boolean;
}
