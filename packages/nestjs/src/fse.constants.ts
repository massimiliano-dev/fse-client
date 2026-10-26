/** Injection token of the resolved {@link FseModuleOptions}. */
export const FSE_MODULE_OPTIONS = Symbol('FSE_MODULE_OPTIONS');

/** Injection token of the `FseGatewayClient`. Use with `@Inject(FSE_GATEWAY_CLIENT)` or `@InjectFseGatewayClient()`. */
export const FSE_GATEWAY_CLIENT = Symbol('FSE_GATEWAY_CLIENT');

/** Injection token of the `CdaValidator`. Use with `@Inject(FSE_CDA_VALIDATOR)` or `@InjectCdaValidator()`. */
export const FSE_CDA_VALIDATOR = Symbol('FSE_CDA_VALIDATOR');
