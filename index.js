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

// -------- TELEFONE EVOLUTION --------
function extractTelefoneEvolution(data) {
  if (data?.key?.remoteJid)
    return data.key.remoteJid.replace("@s.whatsapp.net", "");
  if (data?.key?.participant)
    return data.key.participant.replace("@s.whatsapp.net", "");
  if (data?.from)
    return data.from.replace("@s.whatsapp.net", "");
  return null;
}

// -------- TELEFONE DIGISAC --------
function extractTelefoneDigisac(body) {
  return (
    body?.data?.message?.contact?.phone ||
    body?.data?.ticket?.contact?.phone ||
    body?.data?.contact?.phone ||
    null
  );
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
  // ================= WEBHOOK WHATSAPP ===================
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
        res.writeHead(200);
        res.end("ignored");
        return;
      }

      const tenant = TENANTS[instance];
      const data = body.data || {};
      const message = data.message || {};

      // só texto real
      if (!message.conversation) {
        res.writeHead(200);
        res.end("ignored");
        return;
      }

      const telefone = extractTelefoneEvolution(data);
      if (!telefone) {
        res.writeHead(200);
        res.end("ignored");
        return;
      }

      console.log("========== WHATSAPP ==========");
      console.log("🏷️ Tenant:", tenant.tenantId);
      console.log("📞 Telefone:", telefone);
      console.log("📩 Tipo: text");
      console.log("📝 Conteúdo:", message.conversation);
      console.log("📌 Status inferido: novo_lead");
      console.log("==============================");

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    } catch (err) {
      console.error("❌ Erro WhatsApp:", err);
      res.writeHead(200);
      res.end("error");
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
      const telefone = extractTelefoneDigisac(body);

      let status = null;

      if (evento === "ticket.created") {
        status = "em_atendimento_humano";
      }

      if (evento === "ticket.updated") {
        if (body?.data?.ticket?.status === "closed") {
          status = "atendimento_encerrado";
        }
      }

      console.log("========== DIGISAC ==========");
      console.log("📞 Telefone:", telefone || "desconhecido");
      console.log("🔔 Evento:", evento);
      if (status) console.log("📌 Status atualizado:", status);
      console.log("=============================");

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "received" }));
      return;
    } catch (err) {
      console.error("❌ Erro DigiSac:", err);
      res.writeHead(200);
      res.end("error");
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
