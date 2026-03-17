import type { RequestHandler } from './$types';
import { createReadStream, statSync, existsSync } from 'fs';
import { Readable } from 'stream';

const LOG_PATHS: Record<string, string> = {
  'nodyx-core':     '/root/.pm2/logs/nodyx-core-out.log',
  'nodyx-frontend': '/root/.pm2/logs/nodyx-frontend-out.log',
};

function detectLevel(line: string): 'info'|'warn'|'error' {
  const l = line.toLowerCase();
  if (l.includes('"level":50') || l.includes('error') || l.includes('err'))   return 'error';
  if (l.includes('"level":40') || l.includes('warn'))  return 'warn';
  return 'info';
}

export const GET: RequestHandler = async ({ url }) => {
  const process = url.searchParams.get('process') ?? 'nodyx-core';
  const logPath = LOG_PATHS[process] ?? LOG_PATHS['nodyx-core'];

  const stream = new ReadableStream({
    start(controller) {
      let offset = 0;

      // Seed last 50 lines from existing log
      if (existsSync(logPath)) {
        try {
          const { size } = statSync(logPath);
          const startByte = Math.max(0, size - 8000);
          const readStream = createReadStream(logPath, { start: startByte, encoding: 'utf8' });
          let buf = '';
          readStream.on('data', chunk => buf += chunk);
          readStream.on('end', () => {
            offset = size;
            const seedLines = buf.split('\n').filter(Boolean).slice(-50);
            for (const line of seedLines) {
              const payload = JSON.stringify({ text: line.trim(), level: detectLevel(line), ts: new Date().toISOString() });
              controller.enqueue(`data: ${payload}\n\n`);
            }
          });
        } catch { /* ignore */ }
      }

      // Poll for new lines every 1s
      const interval = setInterval(() => {
        if (!existsSync(logPath)) return;
        try {
          const { size } = statSync(logPath);
          if (size <= offset) return;
          const rs = createReadStream(logPath, { start: offset, encoding: 'utf8' });
          let buf = '';
          rs.on('data', (chunk: string) => buf += chunk);
          rs.on('end', () => {
            offset = size;
            for (const line of buf.split('\n').filter(Boolean)) {
              const payload = JSON.stringify({ text: line.trim(), level: detectLevel(line), ts: new Date().toISOString() });
              controller.enqueue(`data: ${payload}\n\n`);
            }
          });
        } catch { /* ignore */ }
      }, 1000);

      // Keepalive ping every 15s
      const ping = setInterval(() => {
        controller.enqueue(': ping\n\n');
      }, 15000);

      return () => { clearInterval(interval); clearInterval(ping); };
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    }
  });
};
