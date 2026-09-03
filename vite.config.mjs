import { defineConfig, loadEnv } from 'vite';

function runtimeConfigSource(environment) {
  return `window.PDP_RUNTIME_CONFIG = ${JSON.stringify({
    enabledPortals: environment.ENABLED_PORTALS || '',
    defaultPortal: environment.DEFAULT_PORTAL_ID || '',
  })};\n`;
}

function runtimeConfigPlugin(base, source) {
  const runtimeConfigPath = `${base}runtime-config.js`;
  const serveRuntimeConfig = (request, response, next) => {
    if (request.url?.split('?')[0] !== runtimeConfigPath) return next();
    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-type': 'text/javascript; charset=utf-8',
    });
    response.end(request.method === 'HEAD' ? undefined : source);
  };

  return {
    name: 'runtime-config',
    transformIndexHtml: {
      order: 'post',
      handler() {
        return [{
          tag: 'script',
          attrs: { src: runtimeConfigPath },
          injectTo: 'body',
        }];
      },
    },
    configureServer(server) {
      server.middlewares.use(serveRuntimeConfig);
    },
    configurePreviewServer(server) {
      server.middlewares.use(serveRuntimeConfig);
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'runtime-config.js',
        source,
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), '');
  const rawBase = environment.PDP_VITE_BASE || '/pdp-next/';
  const base = rawBase.endsWith('/') ? rawBase : `${rawBase}/`;
  const upstream = environment.PDP_DEV_UPSTREAM || 'https://beehive.pacificclimate.org';
  const host = environment.PDP_DEV_HOST || '127.0.0.1';
  const port = Number.parseInt(environment.PDP_DEV_PORT || '4173', 10);
  const backendProxy = { target: upstream, changeOrigin: true };
  const proxy = {
    '/pdp-next/portal-meta/': backendProxy,
    '/pdp-next/thredds/': backendProxy,
    '/pdp-next/ncpartitioner/': backendProxy,
  };

  return {
    root: 'viewer',
    base,
    plugins: [runtimeConfigPlugin(base, runtimeConfigSource(environment))],
    server: {
      host,
      port,
      strictPort: true,
      proxy,
    },
    preview: {
      host,
      port,
      strictPort: true,
      proxy,
    },
    build: {
      outDir: '../dist',
      emptyOutDir: true,
    },
  };
});
