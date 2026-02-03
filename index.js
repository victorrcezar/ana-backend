const http = require("http");
const { Pool } = require("pg");

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DIGISAC_API_URL = process.env.DIGISAC_API_URL;
const DIGISAC_API_TOKEN = process.env.DIGISAC_API_TOKEN;

const WHITELIST_TELEFONES = ["5527992980043"];

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
    req.on("data", c => data += c);
    req.on("end", () => resolve(JSON.parse(data || "{}")));
  });
}

function normalizeTelefone(raw) {
  let t = raw.replace(/\D/g, "");
  if (t.length === 11) t = "55" + t;
  return t;
}

// ================== DB HELPERS ==================
async function getContato(telefone) {
  const { rows } = await pool.query(
    "SELECT * FROM contatos WHERE telefone = $1 LIMIT 1",
    [telefone]
  );
  return rows[0] || null;
}

async function salvarContato(telefone, estado) {
  await pool.query(`
    INSERT INTO contatos (telefone, status)
    VALUES ($1,$2)
    ON CONFLICT (telefone)
    DO UPDATE SET status = $2
  `, [telefone, estado]);
}

async function salvarMensagem({ telefone, autor, conteudo }) {
  await pool.query(`
    INSERT INTO mensagens (telefone, autor, conteudo)
    VALUES ($1,$2,$3)
  `, [telefone, autor, conteudo]);
}

async function ultimaMensagemAna(telefone) {
  const { rows } = await pool.query(
    `SELECT conteudo FROM mensagens
     WHERE telefone = $1 AND autor = 'ana'
     ORDER BY id DESC LIMIT 1`,
    [telefone]
  );
  return rows[0]?.conteudo || null;
}

// ================== IA ==================
async function responderIA(mensagem) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
Você é Ana, do atendimento inicial do escritório Andrade e Teixeira.
Você é humana. Nunca diga que é bot.
Seja educada, simples e direta.
Faça UMA pergunta por vez.
Nunca repita perguntas já feitas.
`
        },
        { role: "user", content: mensagem }
      ],
      temperature: 0.3
    })
  });

  const j = await r.json();
  return j.choices?.[0]?.message?.content || "";
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

  // EVOLUTION → SOMENTE SALVAR (NUNCA RESPONDE)
  if (req.method === "POST" && req.url === "/webhook/whatsapp") {
    const body = await readJson(req);
    const texto = body?.data?.message?.conversation;
    const raw = body?.data?.key?.remoteJid;
    if (!texto || !raw) return res.end("ok");

    const telefone = normalizeTelefone(raw.replace("@s.whatsapp.net", ""));
    await salvarMensagem({ telefone, autor: "cliente", conteudo: texto });
    return res.end("ok");
  }

  // DIGISAC → ÚNICO CANAL DE RESPOSTA
  if (req.method === "POST" && req.url === "/webhook/digisac") {
    const body = await readJson(req);
    if (body.event !== "message.created") return res.end("ok");

    if (body.message?.from_me === true) return res.end("ok");

    const telefone = normalizeTelefone(body.contact?.phone || "");
    const texto = body.message?.content;
    const ticketId = body.ticket?.id;

    if (!WHITELIST_TELEFONES.includes(telefone)) return res.end("ok");

    const ultimaAna = await ultimaMensagemAna(telefone);
    if (ultimaAna && ultimaAna.trim() === texto.trim()) {
      return res.end("ok");
    }

    let contato = await getContato(telefone);

    if (!contato) {
      await salvarContato(telefone, "aguardando_nome");
      const msg = "Oi 😊 Posso te chamar por qual nome?";
      await salvarMensagem({ telefone, autor: "ana", conteudo: msg });
      await sendDigisacMessage(ticketId, msg);
      return res.end("ok");
    }

    if (contato.status === "aguardando_nome") {
      await salvarContato(telefone, "aguardando_assunto");
      const msg = `Prazer 😊 Me conta, por favor: qual assunto você gostaria de falar com a gente?`;
      await salvarMensagem({ telefone, autor: "ana", conteudo: msg });
      await sendDigisacMessage(ticketId, msg);
      return res.end("ok");
    }

    return res.end("ok");
  }

  res.end("OK");
});

server.listen(PORT, () => {
  console.log(`🚀 Backend rodando na porta ${PORT}`);
});
