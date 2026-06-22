vcl 4.1;

// To invalidate cached objects, exec into the Varnish container and use varnishadm ban:
//   varnishadm ban 'req.url ~ "^/thredds/wms/"'              # all WMS
//   varnishadm ban 'req.url ~ "request=GetCapabilities"'     # just capabilities
//   varnishadm ban 'req.url ~ "request=GetMap"'              # just tiles

backend thredds {
  .host = "dev-pdp-next_thredds";
  .port = "8080";
  .connect_timeout = 5s;
  // ncWMS can be slow to start rendering
  .first_byte_timeout = 120s;
  .between_bytes_timeout = 120s;
}

sub vcl_recv {
  // Only GET and HEAD are cacheable;
  if (req.method != "GET" && req.method != "HEAD") {
    return (pass);
  }

  // Only cache WMS endpoints. Catalog, fileServer, etc. go straight to thredds
  if (req.url !~ "^/thredds/wms/") {
    return (pass);
  }

  // cache three WMS request types:
  // GetMap and GetLegendGraphic are expensive renders —> cache for 24h
  // GetCapabilities changes rarely but needs to be fresh-ish —> cache for 5m
  if (req.url ~ "(?i)(\?|&)request=GetMap(&|$)" ||
      req.url ~ "(?i)(\?|&)request=GetLegendGraphic(&|$)" ||
      req.url ~ "(?i)(\?|&)request=GetCapabilities(&|$)") {
    // strip cookies so they don't fragment the cache into per-user entries
    unset req.http.Cookie;
    return (hash);
  }

  return (pass);
}

sub vcl_backend_response {
  // non-WMS responses are never cached
  if (bereq.url !~ "^/thredds/wms/") {
    set beresp.uncacheable = true;
    return (deliver);
  }

  if (bereq.url ~ "(?i)(\?|&)request=GetMap(&|$)" ||
      bereq.url ~ "(?i)(\?|&)request=GetLegendGraphic(&|$)") {
    // cache errors briefly to avoid hammering THREDDS on bad requests,
    if (beresp.status != 200) {
      set beresp.ttl = 10s;
      return (deliver);
    }
    // ncWMS returns XML error bodies with a 200 status for bad params
    // only cache actual image responses
    if (beresp.http.Content-Type !~ "^image/") {
      set beresp.uncacheable = true;
      return (deliver);
    }
    unset beresp.http.Set-Cookie;
    // tiles are stable, 24h
    // grace allows stale serving while Varnish revalidates in the background
    // keep holds the object for conditional requests even after ttl+grace
    set beresp.ttl = 24h;
    set beresp.grace = 1h;
    set beresp.keep = 24h;
    return (deliver);
  }

  if (bereq.url ~ "(?i)(\?|&)request=GetCapabilities(&|$)") {
    if (beresp.status != 200) {
      set beresp.ttl = 10s;
      return (deliver);
    }
    unset beresp.http.Set-Cookie;
    // short TTL —> capabilities can change when datasets are added/removed
    set beresp.ttl = 5m;
    set beresp.grace = 1m;
    return (deliver);
  }

  set beresp.uncacheable = true;
  return (deliver);
}

sub vcl_deliver {
  // expose cache status for debugging
  if (obj.hits > 0) {
    set resp.http.X-Cache-Status = "HIT";
  } else {
    set resp.http.X-Cache-Status = "MISS";
  }
}