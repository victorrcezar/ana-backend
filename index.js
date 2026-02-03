const http = require("http");

const PORT = process.env.PORT || 3000;

// ================== CONFIG MULTI-TENANT ==================
const TENANTS = {
  "andrade-e-teixeira": {
    tenantId: "andrade_teixeira",
    nome: "Andrade e Teixeira Advogados"
  }
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

function extractTelefoneFromEvolution(data) {
  if (data?.key?.remoteJid)
    return data.key.remoteJid.replace("@s.whatsapp.net", "");
  if (data?.key?.participant)
    return data.key.participant.replace("@s.whatsapp.net", "");
  if (data?.from)
    return data.from.replace("@s.whatsapp.net", "");
  return "desconhecido";
}

// ================== SERVER ==================
const server = http.createServer(async (req, res) => {
  // -------- health --------
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("OK");
    return;
  }

  // ======================================================
  // =============== WEBHOOK WHATSAPP =====================
  // ======================================================
  if (req.method === "POST" && req.url === "/webhook/whatsapp") {
    try {
      const body = await readJson(req);

      const instance =
        body.instance ||
        body.instanceName ||
        body?.data?.instance ||
        null;

      if (!instance || !TENANTS[instance]) {
        console.warn("🚫 WhatsApp ignorado (instância inválida)");
        res.writeHead(200);
        res.end();
        return;
      }

      const tenant = TENANTS[instance];
      const data = body.data || {};
      const message = data.message || {};

      const telefone = extractTelefoneFromEvolution(data);

      let tipo = "unknown";
      let conteudo = "";

      if (message.conversation) {
        tipo = "text";
        conteudo = message.conversation;
      }

      console.log("========== WHATSAPP ==========");
      console.log("🏷️ Tenant:", tenant.tenantId);
      console.log("📞 Telefone:", telefone);
      console.log("📩 Tipo:", tipo);
      console.log("📝 Conteúdo:", conteudo);
      console.log("📌 Status inferido: novo_lead");
      console.log("==============================");

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end({ status: "ok" });
      return;
    } catch (err) {
      console.error("❌ Erro WhatsApp:", err);
      res.writeHead(400);
      res.end();
      return;
    }
  }

  // ======================================================
  // ================= WEBHOOK DIGISAC ====================
  // ======================================================
  if (req.method === "POST" && req.url === "/webhook/digisac") {
    try {
      const body = await readJson(req);

      const evento = body.event || "desconhecido";
      const telefone = body?.data?.contact?.phone || "desconhecido";

      let status = "desconhecido";

      if (evento === "ticket.created") {
        status = "em_atendimento_humano";
      }

      if (evento === "ticket.updated") {
        const situation = body?.data?.ticket?.status;
        if (situation === "closed") {
          status = "atendimento_encerrado";
        }
      }

      console.log("========== DIGISAC ==========");
      console.log("📞 Telefone:", telefone);
      console.log("🔔 Evento:", evento);
      console.log("📌 Status atualizado:", status);
      console.log("=============================");

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "received" }));
      return;
    } catch (err) {
      console.error("❌ Erro DigiSac:", err);
      res.writeHead(400);
      res.end();
      return;
    }
  }

  // -------- fallback --------
  res.writeHead(404);
  res.end("Not Found");
});

// ================== START ==================
server.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
