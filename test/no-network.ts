/**
 * Unit-test guard: no test may open a connection to anything but this machine.
 *
 * A test once reached the real PRE gateway because a CLI path stopped being a dry run. Mocks are not
 * enough on their own, so every TCP/TLS connect to a non-loopback host fails here, for every package.
 * Gateway smoke tests (`*.gateway.test.ts`) run in a separate project without this file.
 */
import net from 'node:net';
import tls from 'node:tls';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function hostOf(args: unknown[]): string | undefined {
  const [first, second] = args;
  if (typeof first === 'object' && first !== null) {
    const options = first as { host?: string; path?: string; servername?: string };
    if (options.path !== undefined) return undefined; // Unix socket
    return options.host ?? options.servername ?? 'localhost';
  }
  if (typeof first === 'number') return typeof second === 'string' ? second : 'localhost';
  return undefined;
}

function guard<T extends (...args: never[]) => unknown>(name: string, original: T): T {
  return ((...args: unknown[]) => {
    const host = hostOf(args);
    if (host !== undefined && !LOOPBACK.has(host)) {
      throw new Error(`Network access to "${host}" is blocked in unit tests (${name}). Use a mock.`);
    }
    return (original as unknown as (...a: unknown[]) => unknown)(...args);
  }) as unknown as T;
}

net.connect = guard('net.connect', net.connect);
net.createConnection = guard('net.createConnection', net.createConnection);
tls.connect = guard('tls.connect', tls.connect);
