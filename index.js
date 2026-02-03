const http = require("http");
const { Pool } = require("pg");

const PORT = process.env.PORT || 3000;
const DIGISAC_API_URL = process.env.DIGISAC_API_URL;
const DIGISAC_API_TOKEN = process.env.DIGISAC_API_TOKEN;

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

// ================== DIGISAC API ==================
async function buscarTelefoneContato(contactId) {
  const res = await fetch(`${DIGISAC_API_URL}/api/v1/contacts/${contactId}`, {
    headers: {
      Authorization: `Bearer ${DIGISAC_API_TOKEN}`,
    },
  });

  const json = await res.json();

  // Número vem aqui no DigiSac
  return normalizeTelefone(
    json?.data?.number ||
    json?.number ||
    ""
  );
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

    if (!body.data) return res.end("ok");

    const data = body.data;

    if (data.isFromMe === true) return res.end("ok");
    if (data.type !== "chat") return res.end("ok");

    const contactId = data.contactId;
    const ticketId = data.ticketId;
    const texto = data.text;

    if (!contactId || !ticketId || !texto) {
      return res.end("ok");
    }

    // 🔥 BUSCA TELEFONE REAL
    const telefone = await buscarTelefoneContato(contactId);
    if (!telefone) return res.end("ok");

    // 🧾 CONTEÚDO FORMATADO (DO JEITO QUE VOCÊ PEDIU)
    const conteudoFormatado =
      `📞 Telefone: ${telefone}\n` +
      `📩 Tipo: text\n` +
      `📝 Conteúdo: ${texto}`;

    // Salva mensagem
    await salvarMensagem({
      telefone,
      autor: "cliente",
      conteudo: conteudoFormatado,
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
