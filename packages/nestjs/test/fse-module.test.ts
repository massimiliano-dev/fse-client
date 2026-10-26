import 'reflect-metadata';
import { Inject, Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FseConfigError, FseGatewayClient, RsaPemJwtSigner } from '@massimiliano-dev/fse-gateway-client';
import { XsdValidator, type CdaValidator } from '@massimiliano-dev/fse-validator';
import { createTestCertificate, TEST_XML_VALID, TEST_XSD } from '@massimiliano-dev/fse-fixtures';
import { describe, expect, it, vi } from 'vitest';
import {
  FSE_CDA_VALIDATOR,
  FSE_GATEWAY_CLIENT,
  FseModule,
  InjectCdaValidator,
  InjectFseGatewayClient,
} from '../src/index.js';

const CONFIG = Symbol('CONFIG');

@Module({ providers: [{ provide: CONFIG, useValue: { environment: 'pre' as const } }], exports: [CONFIG] })
class FakeConfigModule {}

@Injectable()
class DocumentsService {
  constructor(
    @InjectFseGatewayClient() readonly gateway: FseGatewayClient,
    @InjectCdaValidator() readonly validator: CdaValidator,
  ) {}
}

describe('FseModule', () => {
  it('compiles with a fake config and provides the client and the validator', async () => {
    const sign = createTestCertificate({ commonName: 'SYNTHETIC-SIGN-CN' });
    const tls = createTestCertificate({ commonName: 'SYNTHETIC-TLS-CN' });

    const moduleRef = await Test.createTestingModule({
      imports: [
        FseModule.forRootAsync({
          imports: [FakeConfigModule],
          inject: [CONFIG],
          useFactory: (config: { environment: 'pre' }) => ({
            gateway: {
              environment: config.environment,
              tls: { cert: tls.certificatePem, key: tls.privateKeyPem },
              signer: RsaPemJwtSigner.fromPem({
                certificatePem: sign.certificatePem,
                privateKeyPem: sign.privateKeyPem,
              }),
              application: { id: 'TEST', vendor: 'SYNTHETIC', version: '0.0.0' },
            },
            validator: new XsdValidator({
              entry: { fileName: 'test.xsd', contents: TEST_XSD },
              includes: [],
            }),
          }),
        }),
      ],
      providers: [{ provide: DocumentsService, useClass: DocumentsService }],
    }).compile();

    const client = moduleRef.get<FseGatewayClient>(FSE_GATEWAY_CLIENT);
    expect(client).toBeInstanceOf(FseGatewayClient);
    expect(client.baseUrl).toBe('https://modipa-val.fse.salute.gov.it/govway/rest/in/FSE/gateway/v1');

    const validator = moduleRef.get<CdaValidator>(FSE_CDA_VALIDATOR);
    await expect(validator.validate(TEST_XML_VALID)).resolves.toMatchObject({ valid: true });

    const service = moduleRef.get(DocumentsService);
    expect(service.gateway).toBe(client);
    expect(service.validator).toBe(validator);

    // Every gateway operation is available on the injected client (no request-scoped providers needed).
    for (const method of [
      'validate',
      'publish',
      'validateAndCreate',
      'replace',
      'validateAndReplace',
      'delete',
      'updateMetadata',
      'updateMetadataIti57',
      'updateMetadataOscuramentoCatena',
      'getStatus',
      'getStatusByTraceId',
      'waitForStatus',
    ] as const) {
      expect(typeof service.gateway[method]).toBe('function');
    }
    // Requests are validated locally before anything is signed or sent.
    await expect(
      service.gateway.delete({ documentId: '../status', context: {} as never }),
    ).rejects.toBeInstanceOf(FseConfigError);

    const close = vi.spyOn(client, 'close');
    await moduleRef.close();
    expect(close).toHaveBeenCalledOnce();
  });

  it('exports tokens usable with plain @Inject()', () => {
    expect(typeof FSE_GATEWAY_CLIENT).toBe('symbol');
    expect(typeof Inject(FSE_CDA_VALIDATOR)).toBe('function');
  });
});
