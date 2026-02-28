import { FastifyInstance } from 'fastify';
import { randomBytes } from 'crypto';
import { lookup } from 'dns';
import { promisify } from 'util';
import https from 'https';

const dnsLookup = promisify(lookup);

const CF_BASE = 'https://api.cloudflare.com/client/v4';

async function cfRequest(method: string, path: string, body?: object) {
  const token = process.env.CF_TOKEN;
  const zoneId = process.env.CF_ZONE_ID;
  if (!token || !zoneId) throw new Error('Cloudflare credentials missing');

  const url = `${CF_BASE}/zones/${zoneId}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json() as Promise<any>;
}

async function checkUrl(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(url);
      const req = https.request({ hostname: parsed.hostname, path: '/', method: 'HEAD', timeout: 5000 }, (res) => {
        resolve((res.statusCode ?? 0) < 500);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.end();
    } catch {
      resolve(false);
    }
  });
}

async function createCloudflareSubdomain(slug: string, targetIp: string): Promise<string | null> {
  try {
    const data = await cfRequest('POST', '/dns_records', {
      type: 'A',
      name: `${slug}.nexusnode.app`,
      content: targetIp,
      ttl: 1,
      proxied: true,
    });
    if (data.success) return data.result?.id ?? null;
    console.error('[Directory] CF error:', JSON.stringify(data.errors));
    return null;
  } catch (err) {
    console.error('[Directory] CF exception:', err);
    return null;
  }
}

async function deleteCloudflareRecord(recordId: string): Promise<void> {
  try {
    await cfRequest('DELETE', `/dns_records/${recordId}`);
  } catch (err) {
    console.error('[Directory] CF delete error:', err);
  }
}

export default async function directoryRoutes(app: FastifyInstance) {
  // GET /api/directory — list active instances
  app.get('/directory', async (req, reply) => {
    const instances = await app.db.query(`
      SELECT id, name, slug, url, description, language, status,
             subdomain, member_count, last_ping, created_at
      FROM directory_instances
      WHERE status = 'active'
      ORDER BY member_count DESC, created_at ASC
    `);
    return reply.send({ instances: instances.rows });
  });

  // POST /api/directory/register — register a new instance
  app.post<{ Body: { name: string; slug: string; url: string; description?: string; language?: string } }>(
    '/directory/register',
    async (req, reply) => {
      const { name, slug, url, description, language = 'fr' } = req.body;

      if (!name || !slug || !url) {
        return reply.status(400).send({ error: 'name, slug and url are required' });
      }

      // Validate slug format
      if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(slug)) {
        return reply.status(400).send({ error: 'Invalid slug format (lowercase alphanumeric and hyphens, 3-63 chars)' });
      }

      // Validate URL
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error();
      } catch {
        return reply.status(400).send({ error: 'Invalid URL' });
      }

      // Check slug uniqueness
      const existing = await app.db.query(
        'SELECT id FROM directory_instances WHERE slug = $1',
        [slug]
      );
      if (existing.rows.length > 0) {
        return reply.status(409).send({ error: 'Slug already taken' });
      }

      const token = randomBytes(32).toString('hex');
      const subdomain = `${slug}.nexusnode.app`;

      const result = await app.db.query(
        `INSERT INTO directory_instances (name, slug, url, description, language, token, subdomain, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
         RETURNING id, name, slug, url, subdomain, token, status, created_at`,
        [name, slug, url, description ?? null, language, token, subdomain]
      );

      const instance = result.rows[0];

      // Async: verify URL + create DNS record
      setImmediate(async () => {
        try {
          const isReachable = await checkUrl(url);
          if (!isReachable) {
            console.log(`[Directory] Instance ${slug} URL not reachable, keeping pending`);
            return;
          }

          // Resolve VPS IP
          const { address } = await dnsLookup('nexusnode.app', { family: 4 });

          const recordId = await createCloudflareSubdomain(slug, address);

          await app.db.query(
            `UPDATE directory_instances
             SET status = 'active', cloudflare_record_id = $1, updated_at = NOW()
             WHERE id = $2`,
            [recordId, instance.id]
          );

          console.log(`[Directory] Instance ${slug} activated. CF record: ${recordId}`);
        } catch (err) {
          console.error(`[Directory] Activation error for ${slug}:`, err);
        }
      });

      return reply.status(201).send({
        message: 'Instance registered. DNS subdomain will be created within 30 seconds.',
        token,
        subdomain,
        instance,
      });
    }
  );

  // POST /api/directory/ping — instance heartbeat
  app.post<{ Body: { token: string; member_count?: number } }>(
    '/directory/ping',
    async (req, reply) => {
      const { token, member_count } = req.body;
      if (!token) return reply.status(400).send({ error: 'token required' });

      const result = await app.db.query(
        `UPDATE directory_instances
         SET last_ping = NOW(), member_count = COALESCE($2, member_count), updated_at = NOW()
         WHERE token = $1
         RETURNING slug, status`,
        [token, member_count ?? null]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ error: 'Unknown token' });
      }

      return reply.send({ ok: true, slug: result.rows[0].slug, status: result.rows[0].status });
    }
  );

  // DELETE /api/directory/:slug — unregister (requires token)
  app.delete<{ Params: { slug: string }; Body: { token: string } }>(
    '/directory/:slug',
    async (req, reply) => {
      const { slug } = req.params;
      const { token } = req.body;
      if (!token) return reply.status(400).send({ error: 'token required' });

      const result = await app.db.query(
        'SELECT id, cloudflare_record_id FROM directory_instances WHERE slug = $1 AND token = $2',
        [slug, token]
      );

      if (result.rows.length === 0) {
        return reply.status(403).send({ error: 'Invalid slug or token' });
      }

      const { id, cloudflare_record_id } = result.rows[0];

      if (cloudflare_record_id) {
        await deleteCloudflareRecord(cloudflare_record_id);
      }

      await app.db.query('DELETE FROM directory_instances WHERE id = $1', [id]);

      return reply.send({ ok: true });
    }
  );
}
