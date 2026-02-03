const http = require("http");
const { Pool } = require("pg");

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DIGISAC_API_URL = process.env.DIGISAC_API_URL;
const DIGISAC_API_TOKEN = process.env.DIGISAC_API_TOKEN;

// ================== CONTROLES ==================
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
    systemPrompt: `
Oi, eu sou a Ana 😊
Sou a responsável pelo atendimento inicial do escritório Andrade e Teixeira Advogados.

Atendo pessoas reais, muitas vezes em momentos sensíveis.
Meu atendimento é humano, calmo, acolhedor e simples.

Não sou advogada.
Não dou parecer jurídico.
Não falo valores.
Não prometo resultados.

Atuamos apenas em:
- Direito Previdenciário
- Direito do Trabalho
- Direito de Família

Sempre faço UMA pergunta por vez.
Sempre encerro o atendimento após encaminhar para um advogado.
`
  }
};

// ================== UTIL ==================
function readJson(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", chunk => data += chunk);
    req.on("end", () => resolve(JSON.parse(data || "{}")));
  });
}

function normalizeTelefone(raw) {
  let t = raw.replace(/\D/g, "");
  if (t.length === 11) t = "55" + t;
  return t;
}

function extractTelefoneEvolution(data) {
  const raw = data?.key?.remoteJid;
  return raw ? normalizeTelefone(raw.replace("@s.whatsapp.net", "")) : null;
}

// ================== DB ==================
async function mensagemJaProcessada(messageId) {
  if (!messageId) return false;
  const { rows } = await pool.query(
    `SELECT 1 FROM mensagens WHERE message_id = $1 LIMIT 1`,
    [messageId]
  );
  return rows.length > 0;
}

async function salvarMensagem(d) {
  await pool.query(`
    INSERT INTO mensagens
    (tenant, telefone, origem, autor, tipo, conteudo, message_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
  `, [
    d.tenant,
    d.telefone,
    d.origem,
    d.autor,
    d.tipo,
    d.conteudo,
    d.message_id || null
  ]);
}

// ================== IA ==================
async function responderIA(prompt, texto) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: texto }
      ],
      temperature: 0.3
    })
  });

  const j = await r.json();
  return j?.choices?.[0]?.message?.content || "";
}

// ================== DIGISAC SEND ==================
async function sendDigisacMessage(ticketId, texto) {
  await fetch(`${DIGISAC_API_URL}/api/v1/messages`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${DIGISAC_API_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      ticket_id: ticketId,
      content: texto,
      type: "text"
    })
  });
}

// ================== SERVER ==================
const server = http.createServer(async (req, res) => {

  // 🔹 EVOLUTION → SÓ HISTÓRICO
  if (req.method === "POST" && req.url === "/webhook/whatsapp") {
    const body = await readJson(req);
    const instance = body.instance || body.instanceName;
    const tenantCfg = TENANTS[instance];
    if (!tenantCfg) return res.end("ignored");

    const texto = body?.data?.message?.conversation;
    const telefone = extractTelefoneEvolution(body.data);
    const messageId = body?.data?.key?.id;

    if (!texto || !telefone) return res.end("ignored");
    if (await mensagemJaProcessada(messageId)) return res.end("ok");

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
      message_id: messageId
    });

    return res.end("ok");
  }

  // 🔹 DIGISAC → AQUI A ANA RESPONDE
  if (req.method === "POST" && req.url === "/webhook/digisac") {
    const body = await readJson(req);

    if (body.event !== "message.created") return res.end("ok");

    const ticketId = body.ticket?.id;
    const telefone = normalizeTelefone(body.contact?.phone || "");
    const texto = body.message?.content;

    if (!ticketId || !telefone || !texto) return res.end("ok");
    if (!WHITELIST_TELEFONES.includes(telefone)) return res.end("ok");

    const tenantCfg = TENANTS["andrade-e-teixeira"];

    const resposta = await responderIA(tenantCfg.systemPrompt, texto);

    console.log(`
========== ANA (DIGISAC) ==========
🎫 Ticket: ${ticketId}
📞 Para: ${telefone}
📝 Resposta:
${resposta}
==============================
`);

    await sendDigisacMessage(ticketId, resposta);
    return res.end("ok");
  }

  res.end("OK");
});

// ================== START ==================
server.listen(PORT, () => {
  console.log(`🚀 Backend rodando na porta ${PORT}`);
});
