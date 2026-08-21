const http = require("node:http");

const platformPort = Number(process.env.PORT || 3000);
const listenPort = Number(process.env.APP_PORT || 3001);
const mismatch = platformPort !== listenPort;

const server = http.createServer((request, response) => {
  const body = JSON.stringify({
    service: "digishop-api",
    status: "ok",
    path: request.url,
    timestamp: new Date().toISOString(),
  });

  response.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(body);
});

server.listen(listenPort, "0.0.0.0", () => {
  console.log(JSON.stringify({
    level: mismatch ? "error" : "info",
    event: mismatch ? "PORT_MISMATCH" : "READY",
    service: "digishop-api",
    listenPort,
    platformPort,
    message: mismatch
      ? `Process listens on ${listenPort}, but Liara routes to ${platformPort}. Set APP_PORT=${platformPort} and restart.`
      : `Listening on the Liara platform port ${platformPort}.`,
  }));
});

if (mismatch) {
  setInterval(() => {
    console.error(JSON.stringify({
      level: "error",
      event: "PORT_MISMATCH",
      service: "digishop-api",
      listenPort,
      platformPort,
      remediation: `Set APP_PORT=${platformPort} and restart the application.`,
    }));
  }, 20_000).unref();
}

function shutdown(signal) {
  console.log(JSON.stringify({ level: "info", event: "SHUTDOWN", signal }));
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
