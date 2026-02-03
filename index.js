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

// ================== TENANT ==================
const TENANT = {
  tenantId: "andrade_teixeira",
  systemPrompt: `
Você se chama Ana e faz parte da equipe de atendimento do escritório Andrade e Teixeira Advogados.

Você conversa com pessoas reais no WhatsApp, muitas vezes em momentos sensíveis.
Seu tom deve ser humano, calmo, educado e acolhedor.
Frases curtas. Linguagem simples. Uma pergunta por mensagem.

Você NÃO é advogada.
Nunca dê parecer jurídico.
Nunca fale valores.
Nunca prometa resultados.
Nunca use linguagem técnica.
Nunca pressione.

O escritório atua apenas em:
- Direito Previdenciário
- Direito do Trabalho
- Direito de Família

Se o assunto não for dessas áreas, explique isso com cuidado e respeito.

Você NUNCA deve dizer que é bot, IA ou assistente virtual.
Você nunca explica como o atendimento funciona internamente.

Fluxo obrigatório:
- Cumprimentar
- Pedir o nome de forma leve
- Ouvir
- Identificar o assunto
- Confirmar se é área atendida
- Fazer UMA pergunta simples por vez
- Encaminhar para advogado com consentimento
- Encerrar de forma educada e humana

Exemplo de início (use apenas uma vez):
"Oi 😊
Posso te chamar por qual nome?"
`
};

// ================== UTIL ==================
function readJson(req) {
  return new Promise(resolve => {
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

// ================== DB ==================
async function mensagemJaProcessada(messageId) {
  if (!messageId) return false;
  const { rows } = await pool.query(
    "SELECT 1 FROM mensagens WHERE message_id = $1 LIMIT 1",
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
async function responderIA(texto) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: TENANT.systemPrompt },
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
      Authorization: `Bearer ${DIGISAC_API_TOKEN}`,
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

  // 🔹 EVOLUTION → SOMENTE HISTÓRICO (NÃO RESPONDE)
  if (req.method === "POST" && req.url === "/webhook/whatsapp") {
    const body = await readJson(req);

    const texto = body?.data?.message?.conversation;
    const telefoneRaw = body?.data?.key?.remoteJid;
    const messageId = body?.data?.key?.id;

    if (!texto || !telefoneRaw) return res.end("ignored");

    const telefone = normalizeTelefone(
      telefoneRaw.replace("@s.whatsapp.net", "")
    );

    if (await mensagemJaProcessada(messageId)) return res.end("ok");

    console.log(`
========== WHATSAPP ==========
🏷️ Tenant: ${TENANT.tenantId}
📞 Telefone: ${telefone}
📝 Conteúdo: ${texto}
==============================
`);

    await salvarMensagem({
      tenant: TENANT.tenantId,
      telefone,
      origem: "whatsapp",
      autor: "cliente",
      tipo: "text",
      conteudo: texto,
      message_id: messageId
    });

    return res.end("ok");
  }

  // 🔹 DIGISAC → A ANA RESPONDE AQUI
  if (req.method === "POST" && req.url === "/webhook/digisac") {
    const body = await readJson(req);

    // Apenas mensagens novas
    if (body.event !== "message.created") return res.end("ok");

    // 🔒 FILTRO ANTI-LOOP (SÓ CLIENTE)
    const isFromClient =
      body.message?.from_me === false ||
      body.message?.author === "customer" ||
      body.message?.sender_type === "contact";

    if (!isFromClient) {
      console.log("🚫 Ignorado: mensagem não é do cliente");
      return res.end("ok");
    }

    const ticketId = body.ticket?.id;
    const telefone = normalizeTelefone(body.contact?.phone || "");
    const texto = body.message?.content;
    const messageId = body.message?.id || null;

    if (!ticketId || !telefone || !texto) return res.end("ok");
    if (!WHITELIST_TELEFONES.includes(telefone)) return res.end("ok");
    if (await mensagemJaProcessada(messageId)) return res.end("ok");

    console.log(`
========== DIGISAC ==========
🎫 Ticket: ${ticketId}
📞 Telefone: ${telefone}
📝 Conteúdo: ${texto}
=============================
`);

    await salvarMensagem({
      tenant: TENANT.tenantId,
      telefone,
      origem: "digisac",
      autor: "cliente",
      tipo: "text",
      conteudo: texto,
      message_id: messageId
    });

    const resposta = await responderIA(texto);

    await salvarMensagem({
      tenant: TENANT.tenantId,
      telefone,
      origem: "digisac",
      autor: "ana",
      tipo: "text",
      conteudo: resposta
    });

    console.log(`
========== ANA ==========
🎫 Ticket: ${ticketId}
📝 Resposta:
${resposta}
========================
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
