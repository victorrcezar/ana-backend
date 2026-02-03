const http = require("http");
const { Pool } = require("pg");

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ================== WHITELIST ==================
const WHITELIST_TELEFONES = ["5527992980043"];

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
    systemPrompt: `
Você é a ANA, assistente de atendimento inicial do escritório Andrade e Teixeira Advogados.
Seu papel é acolher, entender a demanda e orientar os próximos passos.
Seja clara, educada e profissional.
Não prometa resultados, não informe valores e não dê parecer jurídico definitivo.
`,
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

function normalizeTelefone(raw) {
  if (!raw) return null;
  let tel = raw.replace(/\D/g, "");
  if (tel.length === 11) tel = "55" + tel;
  return tel;
}

function extractTelefoneEvolution(data) {
  const raw =
    data?.key?.remoteJid ||
    data?.key?.participant ||
    data?.from ||
    null;

  if (!raw) return null;
  return normalizeTelefone(raw.replace("@s.whatsapp.net", ""));
}

// ================== DB SETUP ==================
async function ensureTables() {
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

async function getStatusContato(tenant, telefone) {
  const { rows } = await pool.query(
    `SELECT status FROM contatos WHERE tenant = $1 AND telefone = $2`,
    [tenant, telefone]
  );
  return rows[0]?.status || null;
}

async function salvarMensagem({ tenant, telefone, origem, autor, tipo, conteudo }) {
  await pool.query(
    `
    INSERT INTO mensagens
    (tenant, telefone, origem, autor, tipo, conteudo)
    VALUES ($1, $2, $3, $4, $5, $6);
    `,
    [tenant, telefone, origem, autor, tipo, conteudo]
  );
}

async function buscarHistorico(tenant, telefone, limite = 10) {
  const { rows } = await pool.query(
    `
    SELECT autor, conteudo
    FROM mensagens
    WHERE tenant = $1 AND telefone = $2
    ORDER BY created_at DESC
    LIMIT $3
    `,
    [tenant, telefone, limite]
  );
  return rows.reverse();
}

// ================== IA ==================
async function responderIA({ tenantCfg, historico, ultimaMensagem }) {
  const messages = [
    { role: "system", content: tenantCfg.systemPrompt },
    ...historico.map((m) => ({
      role: m.autor === "cliente" ? "user" : "assistant",
      content: m.conteudo,
    })),
    { role: "user", content: ultimaMensagem },
  ];

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages,
      temperature: 0.3,
    }),
  });

  const json = await resp.json();
  return json?.choices?.[0]?.message?.content || "";
}

// ================== SERVER ==================
const server = http.createServer(async (req, res) => {
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
        body.instance || body.instanceName || body?.data?.instance || null;

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

      const tenantCfg = TENANTS[instance];
      const tenant = tenantCfg.tenantId;
      const texto = message.conversation;

      // 🔹 LOG COMPLETO DA MENSAGEM RECEBIDA
      console.log(`
========== WHATSAPP ==========
🏷️ Tenant: ${tenant}
📞 Telefone: ${telefone}
📩 Tipo: text
📝 Conteúdo: ${texto}
==============================
`);

      // 1️⃣ salvar mensagem do cliente
      await salvarMensagem({
        tenant,
        telefone,
        origem: "whatsapp",
        autor: "cliente",
        tipo: "text",
        conteudo: texto,
      });

      // 2️⃣ garantir contato
      await upsertContato(tenant, telefone, "novo_lead");

      // 🔒 WHITELIST
      if (!WHITELIST_TELEFONES.includes(telefone)) {
        console.log("ANA BLOQUEADA (WHITELIST)");
        res.end("ok");
        return;
      }

      // 3️⃣ status
      const status = await getStatusContato(tenant, telefone);
      if (status !== "novo_lead") {
        console.log("ANA BLOQUEADA (STATUS)");
        res.end("ok");
        return;
      }

      // 4️⃣ histórico
      const historico = await buscarHistorico(tenant, telefone, 10);

      // 5️⃣ IA responde
      const resposta = await responderIA({
        tenantCfg,
        historico,
        ultimaMensagem: texto,
      });

      if (!resposta) {
        res.end("ok");
        return;
      }

      // 6️⃣ salvar resposta da IA
      await salvarMensagem({
        tenant,
        telefone,
        origem: "whatsapp",
        autor: "ia",
        tipo: "text",
        conteudo: resposta,
      });

      // 🔹 LOG COMPLETO DA RESPOSTA DA ANA
      console.log(`
========== ANA ==========
🤖 Para: ${telefone}
📝 Resposta:
${resposta}
========================
`);

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
