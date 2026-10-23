import http from 'node:http';
const port = Number(process.env.PORT || 3000);
const revision = 'healthy-v1';
const failure = false;
http.createServer((req, res) => {
  const health = req.url === '/api/health';
  const status = failure ? 500 : 200;
  if (failure) console.error(JSON.stringify({level:'error',code:'RELEASE_CONFIG_INVALID',message:'The deployed revision enables the controlled invalid configuration. Redeploy the known-good revision; restarting cannot change this source constant.',path:req.url,revision}));
  res.writeHead(status, {'content-type': health ? 'application/json' : 'text/html; charset=utf-8','cache-control':'no-store'});
  res.end(health ? JSON.stringify({status:failure?'failed':'healthy',revision,service:'recovery-lab'}) : `<!doctype html><html><meta charset="utf-8"><title>Recovery Lab</title><body style="font:24px system-ui;background:#181818;color:${failure?'#fca5a5':'#87fcc4'};padding:8vw"><h1>Recovery Lab · ${failure?'Configuration failure':'Healthy'}</h1><p>Real Liara application · ${revision}</p><p>This disposable service validates approved deployment and evidence-based recovery.</p><a style="color:#28c1f5" href="/api/health">Health evidence</a></body></html>`);
}).listen(port,'0.0.0.0',()=>console.log(JSON.stringify({level:'info',event:'service_started',revision,port,configuration:failure?'invalid':'valid'})));
