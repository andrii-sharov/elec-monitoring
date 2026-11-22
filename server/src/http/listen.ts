import { createServer, type Server } from 'node:http';
import type { Express } from 'express';

export function listen(app: Express, port: number, host?: string): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer(app);
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}
