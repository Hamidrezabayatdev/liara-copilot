const http = require("node:http");

const port = Number(process.env.PORT || 3000);
let jobsProcessed = 0;

const server = http.createServer((request, response) => {
  if (request.url !== "/health") {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
    return;
  }

  response.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify({ service: "digishop-worker", status: "ok", jobsProcessed }));
});

server.listen(port, "0.0.0.0", () => {
  console.log(JSON.stringify({ level: "info", event: "READY", service: "digishop-worker", port }));
});

setInterval(() => {
  jobsProcessed += 1;
  console.log(JSON.stringify({
    level: "info",
    event: "HEARTBEAT",
    service: "digishop-worker",
    jobsProcessed,
    timestamp: new Date().toISOString(),
  }));
}, 15_000).unref();

function shutdown(signal) {
  console.log(JSON.stringify({ level: "info", event: "SHUTDOWN", signal }));
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
