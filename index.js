const http = require("http");
const { Pool } = require("pg");

const PORT = process.env.PORT || 3000;
const DIGISAC_API_URL = process.env.DIGISAC_API_URL;
const DIGISAC_API_TOKEN = process.env.DIGISAC_API_TOKEN;

const WHITELIST_TELEFONES = ["5527992980043"];

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
      } catch {
        resolve({});
      }
    });
  });
}

function normalizeTelefone(raw) {
  let t = String(raw || "").replace(/\D/g, "");
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

async function salvarContato(telefone, status) {
  await pool.query(
    `
    INSERT INTO contatos (telefone, status)
    VALUES ($1,$2)
    ON CONFLICT (telefone)
    DO UPDATE SET status = $2
  `,
    [telefone, status]
  );
}

async function salvarMensagem({ telefone, autor, conteudo }) {
  await pool.query(
    `
    INSERT INTO mensagens (telefone, autor, conteudo)
    VALUES ($1,$2,$3)
  `,
    [telefone, autor, conteudo]
  );
}

// ================== DIGISAC SEND ==================
async function sendDigisacMessage(ticketId, texto) {
  await fetch(`${DIGISAC_API_URL}/api/v1/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${DIGISAC_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ticket_id: ticketId,
      content: texto,
      type: "text",
    }),
  });
}

// ================== SERVER ==================
const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/webhook/digisac") {
    const body = await readJson(req);

    // 🔎 Validação estrutural (DigiSac não envia "event" fixo)
    if (!body.message || !body.ticket || !body.contact) {
      return res.end("ok");
    }

    const msg = body.message;

    // Ignora mensagens enviadas pela própria plataforma
    if (msg.from_me === true) {
      return res.end("ok");
    }

    // Apenas mensagens de texto
    if (msg.type !== "text") {
      return res.end("ok");
    }

    const telefone = normalizeTelefone(
      body.contact.phone || body.contact.number || ""
    );

    const texto =
      msg.content ||
      msg.text ||
      msg.body ||
      "";

    const ticketId = body.ticket.id;

    if (!telefone || !texto || !ticketId) {
      return res.end("ok");
    }

    if (!WHITELIST_TELEFONES.includes(telefone)) {
      return res.end("ok");
    }

    // Salva mensagem do cliente
    await salvarMensagem({
      telefone,
      autor: "cliente",
      conteudo: texto,
    });

    let contato = await getContato(telefone);

    // ===== PRIMEIRO CONTATO
    if (!contato) {
      await salvarContato(telefone, "aguardando_nome");

      const resposta = "Oi 😊 Posso te chamar por qual nome?";
      await salvarMensagem({
        telefone,
        autor: "ana",
        conteudo: resposta,
      });

      await sendDigisacMessage(ticketId, resposta);
      return res.end("ok");
    }

    // ===== AGUARDANDO NOME
    if (contato.status === "aguardando_nome") {
      await salvarContato(telefone, "aguardando_assunto");

      const resposta =
        "Prazer 😊 Me conta, por favor: qual assunto você gostaria de falar com a gente?";
      await salvarMensagem({
        telefone,
        autor: "ana",
        conteudo: resposta,
      });

      await sendDigisacMessage(ticketId, resposta);
      return res.end("ok");
    }

    return res.end("ok");
  }

  res.end("OK");
});

server.listen(PORT, () => {
  console.log(`🚀 Backend rodando na porta ${PORT}`);
});
