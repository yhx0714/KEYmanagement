const http = require("http");
const fs = require("fs");
const path = require("path");
const platform = require("./platform/platformService");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "..", "frontend");

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("REQUEST_TOO_LARGE"));
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error("INVALID_JSON"));
      }
    });
    req.on("error", reject);
  });
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  const safePath = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = path.normalize(path.join(PUBLIC_DIR, safePath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    const contentType = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8"
    }[ext] || "text/plain; charset=utf-8";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
  });
}

function route(method, pathname, body) {
  if (method === "POST" && pathname === "/api/system/init") return platform.initSystem();
  if (method === "POST" && pathname === "/api/system/seed") return platform.seedDemo();
  if (method === "GET" && pathname === "/api/system/status") return platform.status();
  if (method === "GET" && pathname === "/api/connectors") return platform.listConnectors();
  if (method === "POST" && pathname === "/api/connectors/register") return platform.registerConnector(body);
  if (method === "GET" && pathname === "/api/data/resources") return platform.listResources();
  if (method === "POST" && pathname === "/api/data/encrypt") return platform.publishData(body);
  if (method === "POST" && pathname === "/api/data/decrypt") return platform.decryptData(body);
  if (method === "GET" && pathname === "/api/keys") return platform.listKeys();
  if (method === "GET" && pathname === "/api/logs") return platform.logs();

  const attrMatch = pathname.match(/^\/api\/connectors\/([^/]+)\/attributes$/);
  if (method === "PUT" && attrMatch) {
    return platform.updateConnectorAttributes(attrMatch[1], body.attributes || []);
  }

  const revokeMatch = pathname.match(/^\/api\/keys\/([^/]+)\/revoke$/);
  if (method === "POST" && revokeMatch) return platform.revokeKey(revokeMatch[1]);

  const destroyMatch = pathname.match(/^\/api\/keys\/([^/]+)\/destroy$/);
  if (method === "POST" && destroyMatch) return platform.destroyKey(destroyMatch[1]);

  const rekeyMatch = pathname.match(/^\/api\/data\/resources\/([^/]+)\/rekey$/);
  if (method === "POST" && rekeyMatch) return platform.rekeyResource(rekeyMatch[1]);

  const notFound = new Error("API_NOT_FOUND");
  notFound.statusCode = 404;
  throw notFound;
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }
  const pathname = req.url.split("?")[0];
  if (!pathname.startsWith("/api/")) {
    serveStatic(req, res);
    return;
  }
  try {
    const body = req.method === "GET" ? {} : await readBody(req);
    const data = route(req.method, pathname, body);
    sendJson(res, 200, { ok: true, data });
  } catch (error) {
    sendJson(res, error.statusCode || 400, {
      ok: false,
      error: error.message || "UNKNOWN_ERROR"
    });
  }
});

server.listen(PORT, () => {
  console.log(`Trusted data space key demo is running at http://localhost:${PORT}`);
});
