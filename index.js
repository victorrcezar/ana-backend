const http = require("http");

const PORT = process.env.PORT || 3000;

// ================== UTIL ==================
function readJson(req) {
  return new Promise(resolve => {
    let data = "";
    req.on("data", c => (data += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch (e) {
        console.error("❌ JSON INVALIDO:", data);
        resolve({});
      }
    });
  });
}

// ================== SERVER ==================
const server = http.createServer(async (req, res) => {
  // Healthcheck
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200);
    return res.end("OK");
  }

  if (req.method === "POST" && req.url === "/webhook/digisac") {
    const body = await readJson(req);

    console.log("================================================");
    console.log("📦 WEBHOOK DIGISAC RECEBIDO (CRU)");
    console.log("🕒 DATA:", new Date().toISOString());
    console.log("🔗 HEADERS:");
    console.log(req.headers);
    console.log("📦 BODY COMPLETO:");
    console.log(JSON.stringify(body, null, 2));
    console.log("================================================");

    return res.end("ok");
  }

  res.end("OK");
});

server.listen(PORT, () => {
  console.log(`🚀 Backend CRU rodando na porta ${PORT}`);
});
