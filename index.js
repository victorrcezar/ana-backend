const http = require("http");
const { Pool } = require("pg");

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ================== FLAGS DE SEGURANÇA ==================
const WHITELIST_TELEFONES = ["5527992980043"];
const SEND_WHATSAPP_ENABLED = false; // 🔒 IMPORTANTE: NÃO ENVIAR WHATSAPP AGORA

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
    systemPrompt: `
🤖 AGENTE “ANA” — ATENDIMENTO INICIAL 24H ASSISTIDO
Andrade e Teixeira Advogados

Você se chama Ana e é a responsável pelo Atendimento Inicial do escritório Andrade e Teixeira Advogados.
Você conversa com pessoas reais, muitas vezes em momentos sensíveis.
Seu atendimento deve ser humano, calmo, acolhedor e respeitoso, como uma conversa educada no WhatsApp.

Você NÃO é advogada.

OBJETIVO:
Acolher o cliente, entender o assunto de forma simples, organizar as informações básicas e preparar o caso para um advogado.

ÁREAS ATENDIDAS:
Direito Previdenciário
Direito do Trabalho
Direito de Família

Se não for dessas áreas, explique com educação.

REGRAS:
Nunca dê parecer jurídico.
Nunca prometa resultado.
Nunca fale valores.
Nunca pressione.
Sempre UMA pergunta por mensagem.

INÍCIO PADRÃO:
"Oi, eu sou a Ana 😊
Posso te chamar por qual nome?"
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

  return raw ? normalizeTelefone(raw.replace("@s.whatsapp.net", "")) : null;
}

// ================== DB ==================
async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS contatos (
      id SERIAL PRIMARY KEY,
      tenant TEXT,
      telefone TEXT,
      status TEXT,
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (tenant, telefone)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS mensagens (
      id SERIAL PRIMARY KEY,
      tenant TEXT,
      telefone TEXT,
      origem TEXT,
      autor TEXT,
      tipo TEXT,
      conteudo TEXT,
      message_id TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
}

async function mensagemJaProcessada(messageId) {
  if (!messageId) return false;
  const { rows } = await pool.query(
    `SELECT 1 FROM mensagens WHERE message_id = $1 LIMIT 1`,
    [messageId]
  );
  return rows.length > 0;
}

async function salvarMensagem(d) {
  await pool.query(
    `
    INSERT INTO mensagens
    (tenant, telefone, origem, autor, tipo, conteudo, message_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    `,
    [
      d.tenant,
      d.telefone,
      d.origem,
      d.autor,
      d.tipo,
      d.conteudo,
      d.message_id || null,
    ]
  );
}

// ================== IA ==================
async function responderIA(tenantCfg, texto) {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: tenantCfg.systemPrompt },
        { role: "user", content: texto },
      ],
      temperature: 0.3,
    }),
  });

  const json = await resp.json();
  return json?.choices?.[0]?.message?.content || "";
}

// ================== SERVER ==================
const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/webhook/whatsapp") {
    const body = await readJson(req);

    const instance = body.instance || body.instanceName;
    const tenantCfg = TENANTS[instance];
    if (!tenantCfg) return res.end("ignored");

    const texto = body?.data?.message?.conversation;
    const telefone = extractTelefoneEvolution(body.data);
    const messageId = body?.data?.key?.id || null;

    if (!texto || !telefone) return res.end("ignored");

    if (await mensagemJaProcessada(messageId)) {
      console.log("🔁 Mensagem duplicada ignorada:", messageId);
      return res.end("ok");
    }

    console.log(`
========== WHATSAPP ==========
🏷️ Tenant: ${tenantCfg.tenantId}
📞 Telefone: ${telefone}
📝 Conteúdo: ${texto}
==============================
`);

    await salvarMensagem({
      tenant: tenantCfg.tenantId,
      telefone,
      origem: "whatsapp",
      autor: "cliente",
      tipo: "text",
      conteudo: texto,
      message_id: messageId,
    });

    if (!WHITELIST_TELEFONES.includes(telefone)) return res.end("ok");

    const resposta = await responderIA(tenantCfg, texto);

    await salvarMensagem({
      tenant: tenantCfg.tenantId,
      telefone,
      origem: "whatsapp",
      autor: "ia",
      tipo: "text",
      conteudo: resposta,
    });

    console.log(`
========== ANA ==========
🤖 Para: ${telefone}
📝 Resposta:
${resposta}
========================
`);

    // 🔒 NÃO ENVIAMOS WHATSAPP AGORA (EVITA CONFLITO COM DIGISAC)

    return res.end("ok");
  }

  res.end("OK");
});

// ================== START ==================
ensureTables().then(() => {
  server.listen(PORT, () =>
    console.log(`🚀 Backend rodando na porta ${PORT}`)
  );
});
