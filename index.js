const http = require("http");
const { Pool } = require("pg");

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL;
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;

// ================== FLAGS DE SEGURANÇA ==================
const WHITELIST_TELEFONES = ["5527992980043"];
const SEND_WHATSAPP_ENABLED = true;

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
    instanceName: "andrade-e-teixeira",
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

REGRA DE HORÁRIO:
Fora do horário comercial → triagem completa.
Durante horário comercial → acolher, identificar assunto e avisar que um advogado continuará.

REGRAS:
Nunca dê parecer jurídico.
Nunca prometa resultado.
Nunca fale valores.
Nunca use linguagem técnica.
Nunca pressione.

INÍCIO PADRÃO:
"Oi, eu sou a Ana 😊
Posso te chamar por qual nome?"

Sempre UMA pergunta por mensagem.
Sempre validar sentimentos quando sensível.
Sempre pedir consentimento para encaminhar.
Sempre encerrar de forma humanizada.
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
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
}

async function salvarMensagem(d) {
  await pool.query(
    `INSERT INTO mensagens (tenant, telefone, origem, autor, tipo, conteudo)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [d.tenant, d.telefone, d.origem, d.autor, d.tipo, d.conteudo]
  );
}

// ================== IA ==================
async function responderIA(tenantCfg, historico, ultimaMensagem) {
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
  return json.choices?.[0]?.message?.content || "";
}

// ================== WHATSAPP SEND ==================
async function sendWhatsapp(instance, telefone, texto) {
  if (!SEND_WHATSAPP_ENABLED) return;

  await fetch(`${EVOLUTION_API_URL}/message/sendText/${instance}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: EVOLUTION_API_KEY,
    },
    body: JSON.stringify({
      number: telefone,
      text: texto,
    }),
  });
}

// ================== SERVER ==================
const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/webhook/whatsapp") {
    const body = await readJson(req);
    const instance = body.instance || body.instanceName;
    const tenantCfg = TENANTS[instance];
    if (!tenantCfg) return res.end("ignored");

    const texto = body.data?.message?.conversation;
    const telefone = extractTelefoneEvolution(body.data);
    if (!texto || !telefone) return res.end("ignored");

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
    });

    if (!WHITELIST_TELEFONES.includes(telefone)) return res.end("ok");

    const resposta = await responderIA(tenantCfg, [], texto);

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

    await sendWhatsapp(tenantCfg.instanceName, telefone, resposta);

    return res.end("ok");
  }

  res.end("OK");
});

ensureTables().then(() => {
  server.listen(PORT, () =>
    console.log(`🚀 Backend rodando na porta ${PORT}`)
  );
});
