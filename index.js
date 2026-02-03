const http = require("http");

const PORT = process.env.PORT || 3000;

// ================== CONFIG MULTI-TENANT ==================
// Lista branca de instâncias permitidas
const TENANTS = {
  "andrade-e-teixeira": {
    tenantId: "andrade_teixeira",
    nome: "Andrade e Teixeira Advogados"
  }
  // futuramente:
  // "up-company": { tenantId: "up_company", nome: "UP Company" }
};

// ================== UTIL ==================
function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => (data += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch (e) {
        reject(e);
      }
    });
  });
}

// ================== SERVER ==================
const server = http.createServer(async (req, res) => {
  // -------- health --------
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("OK");
    return;
  }

  // -------- webhook --------
  if (req.method === "POST" && req.url === "/webhook/whatsapp") {
    try {
      const body = await readJson(req);

      // ===== IDENTIFICA INSTÂNCIA =====
      const instance =
        body.instance ||
        body.instanceName ||
        body?.data?.instance ||
        null;

      if (!instance) {
        console.warn("⚠️ Mensagem sem instância. Ignorada.");
        res.writeHead(200);
        res.end();
        return;
      }

      // ===== VALIDA TENANT =====
      const tenant = TENANTS[instance];

      if (!tenant) {
        console.warn(`🚫 Instância não autorizada: ${instance}`);
        res.writeHead(200);
        res.end();
        return;
      }

      // ===== NORMALIZA MENSAGEM =====
      const data = body.data || {};
      const message = data.message || {};

      const telefone =
        data.key && data.key.remoteJid
          ? data.key.remoteJid.replace("@s.whatsapp.net", "")
          : "desconhecido";

      let tipo = "unknown";
      let conteudoTexto = "";

      if (message.conversation) {
        tipo = "text";
        conteudoTexto = message.conversation;
      }

      // ===== LOG SEGURO =====
      console.log("========== MENSAGEM RECEBIDA ==========");
      console.log("🏷️ Tenant:", tenant.tenantId);
      console.log("🏢 Empresa:", tenant.nome);
      console.log("📞 Telefone:", telefone);
      console.log("📩 Tipo:", tipo);
      console.log("📝 Conteúdo:", conteudoTexto);
      console.log("======================================");

      // ⚠️ AINDA NÃO RESPONDE
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    } catch (err) {
      console.error("❌ Erro no webhook:", err);
      res.writeHead(400);
      res.end("Invalid payload");
      return;
    }
  }

  res.writeHead(404);
  res.end("Not Found");
});

// ================== START ==================
server.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
