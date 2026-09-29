import http from 'node:http';
import commandApi from './secure-entry.js';
import { databaseReadiness } from './db/readiness.js';
import { staticFrontendResponse } from './static-frontend.js';

function envObject() { return { ...process.env }; }

async function bodyBuffer(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function toRequest(req) {
  const origin = process.env.SERVICE_ORIGIN || `http://${req.headers.host || 'localhost'}`;
  const url = new URL(req.url || '/', origin);
  const init = { method:req.method, headers:req.headers };
  if (!['GET','HEAD'].includes(req.method || 'GET')) init.body = await bodyBuffer(req);
  return new Request(url, init);
}

async function writeResponse(res, response) {
  res.statusCode = response.status;
  for (const [name, value] of response.headers) res.setHeader(name, value);
  const bytes = Buffer.from(await response.arrayBuffer());
  res.end(bytes);
}

const port = Number(process.env.PORT || 8080);
const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health/db') {
      const result = await databaseReadiness(envObject());
      res.statusCode = 200;
      res.setHeader('content-type','application/json; charset=utf-8');
      res.setHeader('cache-control','no-store');
      res.end(JSON.stringify(result));
      return;
    }
    const request = await toRequest(req);
    const staticResponse = await staticFrontendResponse(request);
    if (staticResponse) {
      await writeResponse(res, staticResponse);
      return;
    }
    await writeResponse(res, await commandApi.fetch(request, envObject()));
  }
  catch (error) {
    console.error(error);
    res.statusCode = Number(error?.status) || 500;
    res.setHeader('content-type','application/json; charset=utf-8');
    res.end(JSON.stringify({ error:'Command API error' }));
  }
});

server.listen(port, '0.0.0.0', () => console.log(`JSCC Command API listening on ${port}`));
