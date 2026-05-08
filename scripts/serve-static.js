const fs = require("fs");
const http = require("http");
const path = require("path");

const publicDir = path.join(process.cwd(), "public");
const port = Number(process.env.PORT || 3000);

const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function send(res, statusCode, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function resolveRequestPath(url) {
  const parsed = new URL(url, `http://localhost:${port}`);
  const requestPath = decodeURIComponent(parsed.pathname);
  const filePath = path.join(publicDir, requestPath === "/" ? "index.html" : requestPath);
  const relativePath = path.relative(publicDir, filePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return null;
  }

  return filePath;
}

const server = http.createServer((req, res) => {
  const filePath = resolveRequestPath(req.url || "/");
  if (!filePath) {
    send(res, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, (error, body) => {
    if (error) {
      fs.readFile(path.join(publicDir, "index.html"), (fallbackError, fallback) => {
        if (fallbackError) {
          send(res, 404, "Not found");
          return;
        }

        send(res, 200, fallback, types[".html"]);
      });
      return;
    }

    send(res, 200, body, types[path.extname(filePath)] || "application/octet-stream");
  });
});

server.listen(port, () => {
  try {
    console.log(`Status page running at http://localhost:${port}`);
  } catch {
    // Some detached Windows shells close stdio during startup.
  }
});
