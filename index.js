const http = require("http");

const PORT = process.env.PORT || 3000;

// util simples pra ler body JSON
function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => (data += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch (e) {
        reject(e);
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  // health check
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("OK");
    return;
  }

  // webhook WhatsApp
  if (req.method === "POST" && req.url === "/webhook/whatsapp") {
    try {
      const body = await readJson(req);

      // LOG BRUTO (por enquanto)
      console.log("📩 Webhook recebido:");
      console.log(JSON.stringify(body, null, 2));

      // resposta obrigatória
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "received" }));
      return;
    } catch (err) {
      console.error("❌ Erro ao processar webhook", err);
      res.writeHead(400);
      res.end("Invalid JSON");
      return;
    }
  }

  // fallback
  res.writeHead(404);
  res.end("Not Found");
});

server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
