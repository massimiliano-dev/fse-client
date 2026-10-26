import { DynamicModule, Inject, Module, OnApplicationShutdown, Provider } from '@nestjs/common';
import { FseGatewayClient } from '@massimiliano-dev/fse-gateway-client';
import { createFseXsdValidator, type CdaValidator } from '@massimiliano-dev/fse-validator';
import { FSE_CDA_VALIDATOR, FSE_GATEWAY_CLIENT, FSE_MODULE_OPTIONS } from './fse.constants.js';
import type { FseCatalogsValidatorOptions, FseModuleAsyncOptions, FseModuleOptions } from './fse.options.js';

function isValidator(value: FseModuleOptions['validator']): value is CdaValidator {
  return typeof (value as CdaValidator).validate === 'function';
}

const providers: Provider[] = [
  {
    provide: FSE_GATEWAY_CLIENT,
    useFactory: (options: FseModuleOptions) => new FseGatewayClient(options.gateway),
    inject: [FSE_MODULE_OPTIONS],
  },
  {
    provide: FSE_CDA_VALIDATOR,
    useFactory: async (options: FseModuleOptions): Promise<CdaValidator> => {
      if (isValidator(options.validator)) return options.validator;
      const { catalogsDir, ...rest } = options.validator as FseCatalogsValidatorOptions;
      return createFseXsdValidator(catalogsDir, rest);
    },
    inject: [FSE_MODULE_OPTIONS],
  },
];

/**
 * Provides the FSE gateway client and the CDA validator.
 *
 * ```ts
 * FseModule.forRootAsync({
 *   inject: [ConfigService],
 *   useFactory: async (config: ConfigService) => ({
 *     gateway: {
 *       environment: 'pre',
 *       tls: { cert: await secrets.get('fse-auth-cert'), key: await secrets.get('fse-auth-key') },
 *       signer: RsaPemJwtSigner.fromPem({ certificatePem: …, privateKeyPem: … }),
 *       application: { id: 'MYAPP', vendor: 'MY VENDOR', version: '1.0.0' },
 *     },
 *     validator: { catalogsDir: config.getOrThrow('FSE_CATALOGS_DIR') },
 *   }),
 * })
 *
 * constructor(@Inject(FSE_GATEWAY_CLIENT) private readonly fse: FseGatewayClient) {}
 * ```
 */
@Module({})
export class FseModule implements OnApplicationShutdown {
  constructor(@Inject(FSE_GATEWAY_CLIENT) private readonly client: FseGatewayClient) {}

  static forRootAsync(options: FseModuleAsyncOptions): DynamicModule {
    return {
      module: FseModule,
      global: options.isGlobal ?? true,
      imports: options.imports ?? [],
      providers: [
        { provide: FSE_MODULE_OPTIONS, useFactory: options.useFactory, inject: options.inject ?? [] },
        ...providers,
      ],
      exports: [FSE_GATEWAY_CLIENT, FSE_CDA_VALIDATOR],
    };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.close();
  }
}
