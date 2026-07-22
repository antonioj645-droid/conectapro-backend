const express = require("express");
const router = express.Router();
const admin = require("firebase-admin");
const getDB = require("../firebase");

let db;

try {
  db = getDB();
} catch (err) {
  console.error("❌ Erro Firebase:", err.message);
}

// ─── HELPER: envia notificação FCM ────────────────────────────────────────────
async function enviarNotificacao(fcmToken, title, body) {
  if (!fcmToken) return;
  try {
    await admin.messaging().send({
      token: fcmToken,
      notification: { title, body },
      android: {
        priority: "high",
        notification: {
          sound: "default",
          channelId: "conectapro_channel",
        },
      },
    });
    console.log("✅ Notificação enviada para:", fcmToken);
  } catch (err) {
    console.error("⚠️ Erro ao enviar notificação:", err.message);
  }
}

// ─── Middleware: verifica o token do Firebase Auth ────────────────────────────
// Mesmo padrão usado em routes/pix.js: sem isso, qualquer pessoa que conheça
// a URL do backend poderia chamar /desbloquear passando o userId de outra
// pessoa no corpo da requisição e gastar o saldo dela sem autorização.
async function verificarToken(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({
      success: false,
      error: "Token de autenticação ausente.",
    });
  }

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.uid = decoded.uid;
    next();
  } catch (err) {
    console.error("❌ [carteira] token inválido:", err.message);
    return res.status(401).json({
      success: false,
      error: "Token de autenticação inválido ou expirado.",
    });
  }
}

// ✅ DESBLOQUEAR PEDIDO (R$1) — cobrado via Asaas LED
router.post("/desbloquear", verificarToken, async (req, res) => {

  if (!db) {
    return res.status(500).json({ success: false, error: "Banco indisponível" });
  }

  // O userId agora vem do token verificado, não do corpo da requisição —
  // impede que alguém desbloqueie um pedido gastando o saldo de outra pessoa.
  const userId = req.uid;
  const { pedidoId } = req.body;

  if (!pedidoId) {
    return res.status(400).json({ success: false, error: "Dados inválidos" });
  }

  try {

    const userRef   = db.collection("users").doc(userId);
    const pedidoRef = db.collection("requests").doc(pedidoId);

    let clienteId        = null;
    let nomeProfissional = null;

    await db.runTransaction(async (t) => {

      // ── FASE DE LEITURA (tem que vir toda antes de qualquer escrita) ──
      const userDoc   = await t.get(userRef);
      const pedidoDoc = await t.get(pedidoRef);

      if (!userDoc.exists)   throw new Error("Usuário não encontrado");
      if (!pedidoDoc.exists) throw new Error("Pedido não encontrado");

      const user   = userDoc.data();
      const pedido = pedidoDoc.data();

      if (user.role !== "profissional") throw new Error("Somente profissional pode pegar pedido");
      if (pedido.providerId)            throw new Error("Pedido já foi aceito");

      // ✅ Verifica saldo mínimo de R$1
      const saldo = user.balance || 0;
      if (saldo < 1) throw new Error("Saldo insuficiente");

      clienteId        = pedido.clienteId || pedido.clientId || null;
      nomeProfissional = user.nome || user.name || "Um profissional";

      // Garante chatId — SEMPRE igual ao pedidoId, pra bater com a regra do
      // Firestore. NUNCA gerar um id aleatório aqui — já causou permission-
      // denied antes, exatamente por desalinhar do que a regra espera.
      const chatId  = pedido.chatId || pedidoId;
      const chatRef = db.collection("chats").doc(chatId);

      // ── FASE DE ESCRITA ──

      // ✅ Desconta R$1
      t.update(userRef, { balance: saldo - 1 });

      // Atualiza pedido
      t.update(pedidoRef, {
        providerId: userId,
        status:     "aceito",
        chatId:     chatId,
        acceptedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // ⭐ O documento do CHAT também precisa saber quem é o providerId —
      // é ele (e não o campo em "requests") que a regra do Firestore
      // confere pra liberar o profissional a ler/escrever no chat e nas
      // mensagens. Sem isso, o profissional cai em permission-denied e a
      // tela de chat trava/não abre ou não envia mensagem.
      // set com merge:true funciona tanto se o chat já existir (criado lá
      // na hora do pedido, sem profissional ainda) quanto se ainda não
      // existir nenhum documento pra esse chatId — SEMPRE atualiza,
      // diferente de uma versão anterior que só gravava se o chat fosse
      // novo.
      t.set(chatRef, {
        clienteId:  clienteId,
        providerId: userId,
        pedidoId:   pedidoId,
      }, { merge: true });

    });

    // 🔔 Notifica o cliente APÓS a transaction
    if (clienteId) {
      try {
        const clienteDoc = await db.collection("users").doc(clienteId).get();
        if (clienteDoc.exists) {
          const fcmToken = clienteDoc.data()?.fcmToken;
          await enviarNotificacao(
            fcmToken,
            "Profissional encontrado! 🎉",
            `${nomeProfissional} aceitou seu pedido. Entre no chat para combinar os detalhes.`
          );
        }
      } catch (notifErr) {
        console.error("⚠️ Erro ao buscar cliente para notificação:", notifErr.message);
      }
    }

    return res.json({ success: true, message: "Pedido desbloqueado com sucesso" });

  } catch (error) {
    console.error("🔥 ERRO:", error.message);
    return res.status(400).json({ success: false, error: error.message });
  }
});

module.exports = router;