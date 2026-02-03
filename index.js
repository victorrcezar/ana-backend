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
    req.on("data", chunk => (data += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

// ================== DB HELPERS ==================
async function getContato(contactId) {
  const { rows } = await pool.query(
    "SELECT * FROM contatos WHERE contact_id = $1 LIMIT 1",
    [contactId]
  );
  return rows[0] || null;
}

async function salvarContato(contactId, status) {
  await pool.query(
    `
    INSERT INTO contatos (contact_id, status)
    VALUES ($1,$2)
    ON CONFLICT (contact_id)
    DO UPDATE SET status = $2
  `,
    [contactId, status]
  );
}

async function salvarMensagem({ contactId, autor, conteudo }) {
  await pool.query(
    `
    INSERT INTO mensagens (contact_id, autor, conteudo)
    VALUES ($1,$2,$3)
  `,
    [contactId, autor, conteudo]
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

    // Estrutura real do DigiSac
    if (!body.data) {
      return res.end("ok");
    }

    const data = body.data;

    // Ignora mensagens enviadas pela própria plataforma
    if (data.isFromMe === true) {
      return res.end("ok");
    }

    // Apenas mensagens de chat/texto
    if (data.type !== "chat") {
      return res.end("ok");
    }

    const contactId = data.contactId;
    const ticketId = data.ticketId;
    const texto = data.text;

    if (!contactId || !ticketId || !texto) {
      return res.end("ok");
    }

    // Salva mensagem do cliente
    await salvarMensagem({
      contactId,
      autor: "cliente",
      conteudo: texto,
    });

    let contato = await getContato(contactId);

    // ===== PRIMEIRO CONTATO
    if (!contato) {
      await salvarContato(contactId, "aguardando_nome");

      const resposta = "Oi 😊 Posso te chamar por qual nome?";
      await salvarMensagem({
        contactId,
        autor: "ana",
        conteudo: resposta,
      });

      await sendDigisacMessage(ticketId, resposta);
      return res.end("ok");
    }

    // ===== AGUARDANDO NOME
    if (contato.status === "aguardando_nome") {
      await salvarContato(contactId, "aguardando_assunto");

      const resposta =
        "Prazer 😊 Me conta, por favor: qual assunto você gostaria de falar com a gente?";
      await salvarMensagem({
        contactId,
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
