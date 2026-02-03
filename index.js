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

// ================== TENANTS ==================
const TENANTS = {
  "andrade-e-teixeira": {
    tenantId: "andrade_teixeira",
    nome: "Andrade e Teixeira Advogados",
  },
};

// ================== UTIL ==================
function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch (e) {
        reject(e);
      }
    });
  });
}

function extractTelefoneEvolution(data) {
  return (
    data?.key?.remoteJid?.replace("@s.whatsapp.net", "") ||
    data?.key?.participant?.replace("@s.whatsapp.net", "") ||
    data?.from?.replace("@s.whatsapp.net", "") ||
    null
  );
}

// ================== DB SETUP ==================
async function ensureTables() {
  // contatos
  await pool.query(`
    CREATE TABLE IF NOT EXISTS contatos (
      id SERIAL PRIMARY KEY,
      tenant TEXT NOT NULL,
      telefone TEXT NOT NULL,
      status TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (tenant, telefone)
    );
  `);

  // mensagens
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mensagens (
      id SERIAL PRIMARY KEY,
      tenant TEXT NOT NULL,
      telefone TEXT NOT NULL,
      origem TEXT NOT NULL,
      autor TEXT NOT NULL,
      tipo TEXT NOT NULL,
      conteudo TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
}

// ================== DB HELPERS ==================
async function upsertContato(tenant, telefone, status) {
  await pool.query(
    `
    INSERT INTO contatos (tenant, telefone, status)
    VALUES ($1, $2, $3)
    ON CONFLICT (tenant, telefone)
    DO UPDATE SET status = $3, updated_at = NOW();
    `,
    [tenant, telefone, status]
  );
}

async function salvarMensagem({
  tenant,
  telefone,
  origem,
  autor,
  tipo,
  conteudo,
}) {
  await pool.query(
    `
    INSERT INTO mensagens
    (tenant, telefone, origem, autor, tipo, conteudo)
    VALUES ($1, $2, $3, $4, $5, $6);
    `,
    [tenant, telefone, origem, autor, tipo, conteudo]
  );
}

// ================== SERVER ==================
const server = http.createServer(async (req, res) => {
  // -------- HEALTH --------
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200);
    res.end("OK");
    return;
  }

  // ================= WHATSAPP =================
  if (req.method === "POST" && req.url === "/webhook/whatsapp") {
    try {
      const body = await readJson(req);

      const instance =
        body.instance ||
        body.instanceName ||
        body?.data?.instance ||
        null;

      if (!instance || !TENANTS[instance]) {
        res.end("ignored");
        return;
      }

      const data = body.data || {};
      const message = data.message || {};

      if (!message.conversation) {
        res.end("ignored");
        return;
      }

      const telefone = extractTelefoneEvolution(data);
      if (!telefone) {
        res.end("ignored");
        return;
      }

      const tenant = TENANTS[instance].tenantId;
      const texto = message.conversation;

      // 1️⃣ salvar mensagem
      await salvarMensagem({
        tenant,
        telefone,
        origem: "whatsapp",
        autor: "cliente",
        tipo: "text",
        conteudo: texto,
      });

      // 2️⃣ garantir status
      await upsertContato(tenant, telefone, "novo_lead");

      console.log("WHATSAPP MSG:", tenant, telefone, texto);

      res.end("ok");
      return;
    } catch (err) {
      console.error("❌ Erro WhatsApp:", err);
      res.end("error");
      return;
    }
  }

  res.writeHead(404);
  res.end("Not Found");
});

// ================== START ==================
ensureTables()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`🚀 Backend rodando na porta ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("❌ ERRO AO INICIAR:", err);
    process.exit(1);
  });
