import { randomUUID } from 'node:crypto';

// An unref'd listener must also remain reachable while the runner is alive.
let owner: { port: number; token: string; server: Bun.TCPSocketListener<undefined> } | undefined;
function lifetimePipe() {
  if (owner) return owner;
  const token = randomUUID();
  const sockets = new Set<Bun.Socket<undefined>>();
  // The kernel closes every connection on runner death, including SIGKILL and unreaped exits.
  // Neither the listener nor its connections should keep a finished runner alive.
  const server = Bun.listen({
    hostname: '127.0.0.1', port: 0,
    socket: {
      open(socket) { sockets.add(socket); socket.write(token); socket.unref(); },
      close(socket) { sockets.delete(socket); },
      data() {},
    },
  });
  server.unref();
  owner = { port: server.port, token, server };
  return owner;
}

/**
 * Code for a disposable Bun subprocess, including detached grandchildren. Generate it in the
 * test runner, before embedding it in other subprocess code: all helpers watch that runner,
 * not their immediate parent (whose death may be what the test is exercising).
 * Spawn asynchronously: the helper first connects to the runner's unique lifetime pipe.
 * Keep ordinary finally cleanup too, so helpers end promptly between tests.
 */
export function testProcessCode(code = 'setInterval(() => {}, 1000);'): string {
  const { port, token } = lifetimePipe();
  return `{
    const { connect } = await import('node:net');
    await new Promise((resolve) => {
      // Authenticate a late connection too: the port might have been reused after runner death.
      const deadline = setTimeout(() => process.exit(0), 30000);
      const testOwner = connect({ host: '127.0.0.1', port: ${port} });
      testOwner.on('error', () => process.exit(0));
      testOwner.on('close', () => process.exit(0));
      let greeting = '';
      testOwner.on('data', (chunk) => {
        greeting += chunk.toString();
        if (greeting.length < ${token.length}) return;
        if (greeting !== ${JSON.stringify(token)}) process.exit(0);
        clearTimeout(deadline);
        testOwner.removeAllListeners('data');
        testOwner.unref();
        resolve();
      });
    });
  }\n${code}`;
}
