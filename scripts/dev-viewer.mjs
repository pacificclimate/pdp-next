import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const viewerRoot = resolve(repositoryRoot, 'viewer');
const host = process.env.PDP_DEV_HOST || '127.0.0.1';
const port = Number.parseInt(process.env.PDP_DEV_PORT || '4173', 10);
const upstream = new URL(
  process.env.PDP_DEV_UPSTREAM || 'https://beehive.pacificclimate.org',
);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`Invalid PDP_DEV_PORT: ${process.env.PDP_DEV_PORT}`);
}
if (!['http:', 'https:'].includes(upstream.protocol)) {
  throw new Error('PDP_DEV_UPSTREAM must use http or https.');
}

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function localAssetPath(pathname) {
  if (pathname === '/pdp-next/' || pathname === '/pdp-next/pdp-next-viewer.html') {
    return resolve(viewerRoot, 'pdp-next-viewer.html');
  }
  if (pathname === '/pdp-next/viewer.css') return resolve(viewerRoot, 'viewer.css');
  if (pathname === '/pdp-next/favicon.ico') return resolve(viewerRoot, 'favicon.ico');

  const assetMatch = pathname.match(/^\/pdp-next\/(js|styles)\/(.+)$/);
  if (!assetMatch) return null;
  let relativePath;
  try {
    relativePath = decodeURIComponent(`${assetMatch[1]}/${assetMatch[2]}`);
  } catch {
    return null;
  }
  const assetPath = resolve(viewerRoot, relativePath);
  const viewerPrefix = `${viewerRoot}${sep}`;
  return assetPath.startsWith(viewerPrefix) ? assetPath : null;
}

async function serveFile(request, response, filePath) {
  try {
    const details = await stat(filePath);
    if (!details.isFile()) throw new Error('Not a file');
    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-length': details.size,
      'content-type': mimeTypes[extname(filePath).toLowerCase()] || 'application/octet-stream',
    });
    if (request.method === 'HEAD') response.end();
    else createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found\n');
  }
}

function proxyRequest(request, response) {
  const target = new URL(request.url, upstream);
  const requestImpl = target.protocol === 'https:' ? httpsRequest : httpRequest;
  const headers = {
    ...request.headers,
    host: target.host,
    'x-forwarded-host': request.headers.host || '',
    'x-forwarded-proto': 'http',
  };

  const proxied = requestImpl(target, {
    method: request.method,
    headers,
  }, (upstreamResponse) => {
    const responseHeaders = { ...upstreamResponse.headers };
    if (responseHeaders.location) {
      responseHeaders.location = responseHeaders.location.replace(
        upstream.origin,
        `http://${request.headers.host}`,
      );
    }
    response.writeHead(upstreamResponse.statusCode || 502, responseHeaders);
    upstreamResponse.pipe(response);
  });

  proxied.on('error', (error) => {
    if (response.headersSent) {
      response.destroy(error);
      return;
    }
    response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(`Could not reach ${upstream.origin}: ${error.message}\n`);
  });
  request.on('aborted', () => proxied.destroy());
  request.pipe(proxied);
}

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host || host}`);
  if (requestUrl.pathname === '/') {
    response.writeHead(302, { location: '/pdp-next/' });
    response.end();
    return;
  }

  const assetPath = localAssetPath(requestUrl.pathname);
  if (assetPath) {
    await serveFile(request, response, assetPath);
    return;
  }

  const isBackendRoute = [
    '/pdp-next/portal-meta/',
    '/pdp-next/thredds/',
    '/pdp-next/ncpartitioner/',
  ].some((prefix) => requestUrl.pathname.startsWith(prefix));
  if (isBackendRoute) {
    proxyRequest(request, response);
    return;
  }

  if (requestUrl.pathname.startsWith('/pdp-next/')) {
    await serveFile(request, response, resolve(viewerRoot, 'pdp-next-viewer.html'));
    return;
  }

  response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  response.end('Not found\n');
});

server.listen(port, host, () => {
  const displayHost = host === '0.0.0.0' ? 'localhost' : host;
  console.log(`PDP viewer: http://${displayHost}:${port}/pdp-next/`);
  console.log(`Backend proxy: ${upstream.origin}`);
});
