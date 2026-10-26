import { Inject } from '@nestjs/common';
import { FSE_CDA_VALIDATOR, FSE_GATEWAY_CLIENT } from './fse.constants.js';

/** Shorthand for `@Inject(FSE_GATEWAY_CLIENT)`. */
export const InjectFseGatewayClient = (): ParameterDecorator & PropertyDecorator =>
  Inject(FSE_GATEWAY_CLIENT);

/** Shorthand for `@Inject(FSE_CDA_VALIDATOR)`. */
export const InjectCdaValidator = (): ParameterDecorator & PropertyDecorator => Inject(FSE_CDA_VALIDATOR);
