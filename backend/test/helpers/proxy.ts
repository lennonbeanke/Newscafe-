// A tiny TCP proxy placed between the API and PostgreSQL so tests can make the database "disappear" in realistic ways:
//   pass          forward everything
//   refuse        nobody is listening (connection refused)
//   blackhole     accept connections but never answer (a hung database)
//   drop-replies  the database receives and runs the request, but the answer never reaches the API and the link is cut
import net from 'node:net';

export type ProxyMode = 'pass' | 'refuse' | 'blackhole' | 'drop-replies';

export class FaultProxy {
  mode: ProxyMode = 'pass';
  port = 0;
  private server: net.Server | null = null;
  private readonly sockets = new Set<net.Socket>();
  private readonly armed = new Set<net.Socket>();
  private dropWhenSeen: string | null = null;
  private readonly targetPort: number;
  private readonly targetHost: string;

  constructor(targetPort: number, targetHost = '127.0.0.1') { this.targetPort = targetPort; this.targetHost = targetHost; }

  private listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = net.createServer((client) => this.onClient(client));
      server.once('error', reject);
      server.listen(this.port, '127.0.0.1', () => { this.port = (server.address() as net.AddressInfo).port; this.server = server; resolve(); });
    });
  }

  private onClient(client: net.Socket): void {
    this.sockets.add(client);
    client.on('close', () => this.sockets.delete(client));
    client.on('error', () => {});
    if (this.mode === 'blackhole') return;               // accepted, then silence
    const upstream = net.connect(this.targetPort, this.targetHost);
    this.sockets.add(upstream);
    upstream.on('close', () => this.sockets.delete(upstream));
    upstream.on('error', () => client.destroy());
    client.on('close', () => upstream.destroy());
    client.on('data', (d) => {
      if (this.dropWhenSeen !== null && d.includes(this.dropWhenSeen)) { this.armed.add(upstream); this.dropWhenSeen = null; }   // this request will lose its reply
      if (this.mode !== 'blackhole') upstream.write(d);
    });
    upstream.on('data', (d) => {
      if (this.armed.has(upstream)) { setTimeout(() => { client.destroy(); upstream.destroy(); }, 30); return; }
      if (this.mode === 'drop-replies') { setTimeout(() => { client.destroy(); upstream.destroy(); }, 30); return; }
      if (this.mode === 'blackhole') return;
      client.write(d);
    });
  }

  /** The next request whose SQL contains `sqlText` reaches the database and runs, but its reply is lost and the link is cut. */
  armDrop(sqlText: string): void { this.dropWhenSeen = sqlText; }

  async start(): Promise<void> { await this.listen(); }

  async setMode(mode: ProxyMode): Promise<void> {
    const was = this.mode;
    this.mode = mode;
    if (mode === 'refuse') {
      for (const s of this.sockets) s.destroy();      // cut every open connection first, or close() would wait for them forever
      this.sockets.clear();
      await new Promise<void>((r) => { if (this.server) this.server.close(() => r()); else r(); });
      this.server = null;
    } else if (was === 'refuse') {
      await this.listen();
    }
  }

  async stop(): Promise<void> {
    for (const s of this.sockets) s.destroy();
    this.sockets.clear();
    await new Promise<void>((r) => { if (this.server) this.server.close(() => r()); else r(); });
    this.server = null;
  }
}
