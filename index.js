const http = require("http");
const { Pool } = require("pg");

const PORT = process.env.PORT || 3000;

// 🔒 TENANT FIXO (por enquanto)
const TENANT = "andrade_teixeira";

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
async function salvarMensagem({ tenant, telefone, autor, conteudo }) {
  await pool.query(
    `
    INSERT INTO mensagens (tenant, telefone, autor, conteudo)
    VALUES ($1,$2,$3,$4)
  `,
    [tenant, telefone, autor, conteudo]
  );
}

// ================== SERVER ==================
const server = http.createServer(async (req, res) => {
  try {
    // Healthcheck (evita SIGTERM por orquestrador)
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200);
      return res.end("OK");
    }

    if (req.method === "POST" && req.url === "/webhook/digisac") {
      const body = await readJson(req);

      console.log("📦 BODY RECEBIDO:");
      console.log(JSON.stringify(body, null, 2));

      if (!body.data) {
        return res.end("ok");
      }

      const data = body.data;

      // Ignora mensagens enviadas pelo próprio sistema
      if (data.isFromMe === true) {
        return res.end("ok");
      }

      if (data.type !== "chat") {
        return res.end("ok");
      }

      const texto = data.text;
      const contactId = data.contactId;

      if (!texto || !contactId) {
        return res.end("ok");
      }

      // ⚠️ Enquanto o DigiSac não envia telefone direto,
      // usamos o contactId como fallback seguro
      const telefone = normalizeTelefone(contactId);

      const conteudoFormatado =
        `📞 Telefone: ${telefone}\n` +
        `📩 Tipo: text\n` +
        `📝 Conteúdo: ${texto}`;

      await salvarMensagem({
        tenant: TENANT,
        telefone,
        autor: "cliente",
        conteudo: conteudoFormatado,
      });

      console.log("✅ Mensagem salva no banco");

      return res.end("ok");
    }

    res.end("OK");
  } catch (err) {
    // 🔥 TRAVA DE SEGURANÇA — NUNCA MAIS CAI O PROCESSO
    console.error("💥 ERRO CAPTURADO:", err);
    res.end("ok");
  }
});

server.listen(PORT, () => {
  console.log(`🚀 Backend rodando na porta ${PORT}`);
});
