import type { InjectionToken, ModuleMetadata, OptionalFactoryDependency } from '@nestjs/common';
import type { FseGatewayClientOptions } from '@massimiliano-dev/fse-gateway-client';
import type { CdaValidator, FseCdaSchemaVariant } from '@massimiliano-dev/fse-validator';

/** Builds the XSD validator from a local it-fse-catalogs checkout (`pnpm sync:catalogs`). */
export interface FseCatalogsValidatorOptions {
  catalogsDir: string;
  variant?: FseCdaSchemaVariant;
  maxInputBytes?: number;
}

/** Options of {@link FseModule}. Load certificates and keys from a secret store in `useFactory`. */
export interface FseModuleOptions {
  gateway: FseGatewayClientOptions;
  /** A validator instance, or the catalogs folder to build the default XSD validator. */
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
