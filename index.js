const http = require("http");
const { Pool } = require("pg");

const PORT = process.env.PORT || 3000;

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
    req.on("data", c => (data += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch (e) {
        console.error("❌ JSON inválido:", data);
        resolve({});
      }
    });
  });
}

// ================== SERVER ==================
const server = http.createServer(async (req, res) => {
  try {
    // 🩺 HEALTHCHECK (IMPORTANTE PRA NÃO TOMAR SIGTERM)
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200);
      return res.end("OK");
    }

    console.log("➡️ REQUEST");
    console.log(req.method, req.url);

    if (req.method === "POST" && req.url === "/webhook/digisac") {
      const body = await readJson(req);

      console.log("📦 BODY RAW:");
      console.log(JSON.stringify(body, null, 2));

      // Grava QUALQUER coisa que chegar
      await pool.query(
        `
        INSERT INTO mensagens (telefone, autor, conteudo)
        VALUES ($1,$2,$3)
        `,
        [
          "DEBUG",
          "digisac",
          JSON.stringify(body)
        ]
      );

      console.log("✅ SALVO NO BANCO");

      res.end("ok");
      return;
    }

    res.end("OK");
  } catch (err) {
    console.error("💥 ERRO GERAL:", err);
    res.end("error");
  }
});

server.listen(PORT, () => {
  console.log(`🚀 Backend rodando na porta ${PORT}`);
});
