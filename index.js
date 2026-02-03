const http = require("http");
const { Pool } = require("pg");

const PORT = process.env.PORT || 3000;
const DIGISAC_API_URL = process.env.DIGISAC_API_URL;
const DIGISAC_API_TOKEN = process.env.DIGISAC_API_TOKEN;

// ================== DB ==================
const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// ================== UTIL ==================
function readJson(req) {
  return new Promise(resolve => {
    let data = "";
    req.on("data", chunk => (data += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch (e) {
        console.error("❌ ERRO PARSE JSON", data);
        resolve({});
      }
    });
  });
}

// ================== SERVER ==================
const server = http.createServer(async (req, res) => {
  console.log("➡️ REQUEST RECEBIDA");
  console.log("METHOD:", req.method);
  console.log("URL:", req.url);

  // LOG DE PROVA DE VIDA
  if (req.method === "POST") {
    const body = await readJson(req);
    console.log("📦 BODY RECEBIDO:");
    console.log(JSON.stringify(body, null, 2));
  }

  if (req.method === "POST" && req.url === "/webhook/digisac") {
    console.log("✅ ENTROU NO /webhook/digisac");

    res.end("ok");
    return;
  }

  res.end("OK");
});

server.listen(PORT, () => {
  console.log(`🚀 Backend rodando na porta ${PORT}`);
});
