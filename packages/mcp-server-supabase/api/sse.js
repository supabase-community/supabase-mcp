
export default function handler(req, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const timer = setInterval(() => {
    res.write(`event: ping\ndata: ${Date.now()}\n\n`);
  }, 5000);
  req.on('close', () => clearInterval(timer));
  res.write(`retry: 10000\n\n`);
}
