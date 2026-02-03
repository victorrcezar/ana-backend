const http = require("http");
const { Pool } = require("pg");

const PORT = process.env.PORT || 3000;

const TENANT = "andrade_teixeira";
const ORIGEM = "whatsapp";
const TIPO_TEXTO = "text";

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

// ================== DIGISAC ==================
async function buscarTelefoneReal(contactId) {
  const res = await fetch(`${DIGISAC_API_URL}/api/v1/contacts/${contactId}`, {
    headers: {
      Authorization: `Bearer ${DIGISAC_API_TOKEN}`,
    },
  });

  const json = await res.json();

  return normalizeTelefone(
    json?.data?.number ||
    json?.number ||
    ""
  );
}

// ================== DB ==================
async function salvarMensagem({
  tenant,
  telefone,
  origem,
  autor,
  tipo,
  conteudo,
}) {
  await pool.query(
    `
    INSERT INTO mensagens
      (tenant, telefone, origem, autor, tipo, conteudo)
    VALUES
      ($1,$2,$3,$4,$5,$6)
  `,
    [tenant, telefone, origem, autor, tipo, conteudo]
  );
}

// ================== SERVER ==================
const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200);
      return res.end("OK");
    }

    if (req.method === "POST" && req.url === "/webhook/digisac") {
      const body = await readJson(req);

      if (!body.data) return res.end("ok");

      const data = body.data;

      // ignora mensagens enviadas pelo sistema/humano
      if (data.isFromMe === true) return res.end("ok");

      // apenas texto
      if (data.type !== "chat" || !data.text) return res.end("ok");

      const telefone = await buscarTelefoneReal(data.contactId);
      if (!telefone) return res.end("ok");

      // 🔥 LOG BONITO (SÓ NO CONSOLE)
      console.log(
        `📞 Telefone: ${telefone}\n` +
        `📩 Tipo: text\n` +
        `📝 Conteúdo: ${data.text}`
      );

      // ✅ BANCO LIMPO
      await salvarMensagem({
        tenant: TENANT,
        telefone,
        origem: ORIGEM,
        autor: "cliente",
        tipo: TIPO_TEXTO,
        conteudo: data.text,
      });

      console.log("✅ Mensagem salva corretamente");

      return res.end("ok");
    }

    res.end("OK");
  } catch (err) {
    console.error("💥 ERRO CAPTURADO:", err);
    return res.end("ok");
  }
});

server.listen(PORT, () => {
  console.log(`🚀 Backend rodando na porta ${PORT}`);
});
