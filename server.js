require("dotenv").config();
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const app = express();

/// ✅ 🔒 RATE LIMIT (ANTI-ATAQUE)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // limite por IP
});
app.use(limiter);

/// ✅ 🔒 CORS RESTRITO (SÓ SEU APP)
app.use(cors({
  origin: [
    "https://conectapro-ff6d5.web.app"
  ],
  methods: ["GET", "POST"],
}));

/// ✅ 🔒 LIMITAR TAMANHO DO BODY (anti ataque)
app.use(express.json({ limit: "1mb" }));

/// ✅ 🔒 BLOQUEIO DE HEADERS SUSPEITOS
app.use((req, res, next) => {
  if (!req.headers["user-agent"]) {
    return res.status(403).json({ error: "Requisição inválida" });
  }
  next();
});

/// ✅ IMPORTAR ROTAS PIX
const pixRoutes = require("./routes/pix");
app.use("/", pixRoutes);

/// ✅ 🔒 WEBHOOK ASAAS (APENAS ASAAS)
app.post("/webhook/asaas", async (req, res) => {

  try {

    const token = req.headers["asaas-access-token"];

    /// 🔐 valida token do ASAAS
    if (token !== process.env.ASAAS_API_KEY) {
      console.log("🚫 tentativa inválida de webhook");
      return res.sendStatus(403);
    }

    const data = req.body;

    if (!data || !data.event) {
      return res.sendStatus(400);
    }

    console.log("✅ webhook recebido:", data.event);

    // 👉 aqui você chama sua lógica (ex: salvar pagamento)
    // importante manter isso separado (routes/pix ou service)

    return res.sendStatus(200);

  } catch (error) {
    console.error("Erro webhook:", error);
    return res.sendStatus(500);
  }
});

/// ✅ ROTA TESTE SEGURA
app.get("/", (req, res) => {
  res.json({
    success: true,
    status: "ONLINE 🚀",
    security: "NÍVEL NASA 🛡️",
    timestamp: new Date().toISOString(),
  });
});

/// ✅ 🔒 404 PROTEÇÃO
app.use((req, res) => {
  res.status(404).json({ error: "Rota não encontrada" });
});

/// ✅ 🔒 TRATAMENTO GLOBAL DE ERRO
app.use((err, req, res, next) => {
  console.error("Erro global:", err);
  res.status(500).json({ error: "Erro interno do servidor" });
});

/// ✅ PORTA (Render usa ENV)
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});