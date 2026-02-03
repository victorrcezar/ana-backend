const http = require("http");

const PORT = process.env.PORT || 3000;

// ===== util para ler JSON do body =====
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

// ===== servidor =====
const server = http.createServer(async (req, res) => {
  // -------- health check --------
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("OK");
    return;
  }

  // -------- webhook WhatsApp --------
  if (req.method === "POST" && req.url === "/webhook/whatsapp") {
    try {
      const body = await readJson(req);

      /*
        Estrutura esperada (Evolution):
        body.data.key.remoteJid
        body.data.message.conversation
      */

      const data = body.data || {};
      const message = data.message || {};

      // telefone
      const telefone =
        data.key && data.key.remoteJid
          ? data.key.remoteJid.replace("@s.whatsapp.net", "")
          : "desconhecido";

      // normalização
      let tipo = "unknown";
      let conteudoTexto = "";

      if (message.conversation) {
        tipo = "text";
        conteudoTexto = message.conversation;
      }

      // logs (fase atual)
      console.log("========== MENSAGEM NORMALIZADA ==========");
      console.log("📞 Telefone:", telefone);
      console.log("📩 Tipo:", tipo);
      console.log("📝 Conteúdo:", conteudoTexto);
      console.log("==========================================");

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "normalized" }));
      return;
    } catch (err) {
      console.error("❌ Erro ao processar webhook:", err);
      res.writeHead(400);
      res.end("Invalid payload");
      return;
    }
  }

  // -------- fallback --------
  res.writeHead(404);
  res.end("Not Found");
});

// ===== start =====
server.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
