const http = require("http");
const { Pool } = require("pg");

const PORT = process.env.PORT || 3000;

// ===== CONFIG FIXA =====
const TENANT = "andrade_teixeira";
const ORIGEM = "whatsapp";
const AUTOR_CLIENTE = "cliente";
const TIPO_TEXTO = "text";

// ===== DB =====
const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// ===== UTIL =====
function readJson(req) {
  return new Promise(resolve => {
    let data = "";
    req.on("data", c => (data += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch (e) {
        console.error("❌ JSON inválido:", data);
        resolve({});
      }
    });
  });
}

function normalizeTelefone(raw) {
  if (!raw) return null;
  let t = String(raw).replace(/\D/g, "");
  if (t.length === 11) t = "55" + t;
  if (t.length < 12 || t.length > 13) return null;
  return t;
}

// ===== DB HELPERS =====
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

// ===== SERVER =====
const server = http.createServer(async (req, res) => {
  try {
    // Healthcheck
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200);
      return res.end("OK");
    }

    // Webhook DigiSac (ROBÔ)
    if (req.method === "POST" && req.url === "/webhook/digisac") {
      const body = await readJson(req);

      console.log("================================================");
      console.log("📦 WEBHOOK DIGISAC (ROBÔ)");
      console.log("🕒", new Date().toISOString());
      console.log(JSON.stringify(body, null, 2));
      console.log("================================================");

      // Espera payload do robô
      // Exemplo esperado:
      // {
      //   internalNumber: "{{contact.internalNumber}}",
      //   number: "{{contact.number}}",
      //   phone: "{{contact.phone}}",
      //   whatsapp: "{{contact.whatsapp}}",
      //   mensagem: "{{message.text}}",
      //   contactId: "{{contact.id}}",
      //   ticketId: "{{ticket.id}}"
      // }

      const rawInternal = body.internalNumber || "";
      const rawNumber = body.number || "";
      const rawPhone = body.phone || "";
      const rawWhatsapp = body.whatsapp || "";

      // Prioridade ABSOLUTA
      let telefone =
        normalizeTelefone(rawInternal) ||
        normalizeTelefone(rawNumber) ||
        normalizeTelefone(rawPhone) ||
        normalizeTelefone(rawWhatsapp);

      const texto = body.mensagem || body.texto || body.message || "";

      // 🔎 LOG CLARO (SÓ LOG)
      console.log(
        `📞 Telefone extraído: ${telefone || "NÃO ENCONTRADO"}\n` +
        `📝 Conteúdo: ${texto || "(vazio)"}`
      );

      // ❗ Se não tiver telefone, NÃO salva (debug primeiro)
      if (!telefone || !texto) {
        console.log("⚠️ Mensagem ignorada (sem telefone ou texto)");
        return res.end("ok");
      }

      // ✅ Salva no banco
      await salvarMensagem({
        tenant: TENANT,
        telefone,
        origem: ORIGEM,
        autor: AUTOR_CLIENTE,
        tipo: TIPO_TEXTO,
        conteudo: texto,
      });

      console.log("✅ Mensagem salva com sucesso");
      return res.end("ok");
    }

    res.end("OK");
  } catch (err) {
    console.error("💥 ERRO GERAL:", err);
    return res.end("ok");
  }
});

server.listen(PORT, () => {
  console.log(`🚀 Backend rodando na porta ${PORT}`);
});
