import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const rootDir = path.resolve(args.root);
const host = args.host;
const port = Number(args.port);

const server = http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url || "/", `http://${host}:${port}`);
    let pathname = decodeURIComponent(requestUrl.pathname);
    if (pathname === "/") {
      pathname = "/index.html";
    }

    const absolutePath = path.normalize(path.join(rootDir, pathname));
    if (!absolutePath.startsWith(rootDir)) {
      response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Forbidden");
      return;
    }

    await access(absolutePath);
    const fileStat = await stat(absolutePath);
    if (fileStat.isDirectory()) {
      response.writeHead(301, { Location: `${pathname.replace(/\/?$/, "/")}index.html` });
      response.end();
      return;
    }

    response.writeHead(200, {
      "Content-Type": resolveContentType(absolutePath),
      "Cache-Control": "no-store",
    });
    createReadStream(absolutePath).pipe(response);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.listen(port, host);

function parseArgs(argv) {
  const options = {
    root: ".",
    host: "127.0.0.1",
    port: "4173",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") {
      options.root = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--host") {
      options.host = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--port") {
      options.port = argv[index + 1];
      index += 1;
      continue;
    }
  }

  return options;
}

function resolveContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}
