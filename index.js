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

function extractTelefoneDigisac(body) {
  return (
    body?.data?.message?.contact?.phone ||
    body?.data?.ticket?.contact?.phone ||
    body?.data?.contact?.phone ||
    null
  );
}

// ================== DB HELPERS ==================
async function ensureTable() {
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
}

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

// ================== SERVER ==================
const server = http.createServer(async (req, res) => {
  // -------- HEALTH --------
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("OK");
    return;
  }

  // -------- DEBUG DB --------
  if (req.method === "GET" && req.url === "/debug/db") {
    try {
      await upsertContato(
        "andrade_teixeira",
        "559999999999",
        "teste_manual"
      );

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "insert_ok" }));
      return;
    } catch (err) {
      console.error("❌ ERRO DB:", err);
      res.writeHead(500);
      res.end("db_error");
      return;
    }
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

      await upsertContato(tenant, telefone, "novo_lead");

      console.log("WHATSAPP:", tenant, telefone, "novo_lead");

      res.end("ok");
      return;
    } catch (err) {
      console.error("❌ Erro WhatsApp:", err);
      res.end("error");
      return;
    }
  }

  // ================= DIGISAC =================
  if (req.method === "POST" && req.url === "/webhook/digisac") {
    try {
      const body = await readJson(req);
      const evento = body.event;
      const telefone = extractTelefoneDigisac(body);

      if (!telefone) {
        res.end("ignored");
        return;
      }

      let status = null;

      if (evento === "ticket.created") {
        status = "em_atendimento_humano";
      }

      if (
        evento === "ticket.updated" &&
        body?.data?.ticket?.status === "closed"
      ) {
        status = "atendimento_encerrado";
      }

      if (status) {
        await upsertContato("andrade_teixeira", telefone, status);
        console.log("DIGISAC:", telefone, status);
      }

      res.end("ok");
      return;
    } catch (err) {
      console.error("❌ Erro DigiSac:", err);
      res.end("error");
      return;
    }
  }

  // -------- FALLBACK --------
  res.writeHead(404);
  res.end("Not Found");
});

// ================== START ==================
ensureTable()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`🚀 Backend rodando na porta ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("❌ ERRO AO INICIAR DB:", err);
    process.exit(1);
  });
