const http = require("http");
const { Pool } = require("pg");

const PORT = process.env.PORT || 3000;

// 🔒 FIXOS DO SEU PROJETO
const TENANT = "andrade_teixeira";
const ORIGEM = "whatsapp";
const TIPO_TEXTO = "text";

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
    // 🩺 Healthcheck
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200);
      return res.end("OK");
    }

    if (req.method === "POST" && req.url === "/webhook/digisac") {
      const body = await readJson(req);

      console.log("📦 BODY RECEBIDO:");
      console.log(JSON.stringify(body, null, 2));

      if (!body.data) return res.end("ok");

      const data = body.data;

      // ❌ Ignora mensagens enviadas pelo sistema / humano
      if (data.isFromMe === true) return res.end("ok");

      // ❌ Ignora tudo que não for texto
      if (data.type !== "chat") return res.end("ok");
      if (!data.text) return res.end("ok");

      const telefone = normalizeTelefone(data.contactId);

      const conteudoFormatado =
        `📞 Telefone: ${telefone}\n` +
        `📩 Tipo: text\n` +
        `📝 Conteúdo: ${data.text}`;

      await salvarMensagem({
        tenant: TENANT,
        telefone,
        origem: ORIGEM,
        autor: "cliente",
        tipo: TIPO_TEXTO,
        conteudo: conteudoFormatado,
      });

      console.log("✅ Mensagem salva com sucesso");

      return res.end("ok");
    }

    res.end("OK");
  } catch (err) {
    // 🔥 Nunca derruba o processo
    console.error("💥 ERRO CAPTURADO:", err);
    return res.end("ok");
  }
});

server.listen(PORT, () => {
  console.log(`🚀 Backend rodando na porta ${PORT}`);
});
