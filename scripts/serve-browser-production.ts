import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { createServer } from "node:https";

// Playwright-only loopback TLS transport. Next still runs its actual production
// server, secure cookies and origin checks; no app security flag is bypassed.
const port = Number(process.env.E2E_PORT ?? "3100");
if (!Number.isInteger(port) || port < 1024 || port > 65534)
  throw new Error("Invalid Playwright port.");
const directory = mkdtempSync(join(tmpdir(), "seedee-browser-tls-"));
const key = join(directory, "key.pem");
const cert = join(directory, "cert.pem");
try {
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      key,
      "-out",
      cert,
      "-days",
      "1",
      "-subj",
      "/CN=127.0.0.1",
    ],
    { stdio: "pipe" },
  );
} catch (error) {
  rmSync(directory, { recursive: true, force: true });
  throw error;
}
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port + 1),
  ],
  { stdio: "inherit" },
);
const server = createServer(
  { key: readFileSync(key), cert: readFileSync(cert) },
  (incoming, outgoing) => {
    const upstream = request(
      {
        hostname: "127.0.0.1",
        port: port + 1,
        method: incoming.method,
        path: incoming.url,
        headers: incoming.headers,
      },
      (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(outgoing);
      },
    );
    upstream.on("error", () => {
      outgoing.writeHead(502);
      outgoing.end();
    });
    incoming.on("aborted", () => upstream.destroy());
    incoming.pipe(upstream);
  },
);
let stopping = false;
function stop(code: number) {
  if (stopping) return;
  stopping = true;
  server.close();
  server.closeAllConnections();
  child.kill("SIGTERM");
  rmSync(directory, { recursive: true, force: true });
  process.exitCode = code;
}
process.once("SIGTERM", () => stop(0));
process.once("SIGINT", () => stop(0));
child.once("error", () => stop(1));
child.once("exit", (code) => stop(code ?? 1));
server.once("error", () => stop(1));
server.listen(port, "127.0.0.1");
