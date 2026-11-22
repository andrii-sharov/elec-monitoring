import { createServer, type Server } from 'node:http';
import type { Express } from 'express';

export function listen(app: Express, port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer(app);
    server.once('error', reject);
    server.listen(port, () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}
