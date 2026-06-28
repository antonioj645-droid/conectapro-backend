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
    // Não lança erro — falha de notificação não deve cancelar o aceite
  }
}
// ──────────────────────────────────────────────────────────────────────────────

// ✅ DESBLOQUEAR PEDIDO (R$3)
router.post("/desbloquear", async (req, res) => {

  if (!db) {
    return res.status(500).json({ success: false, error: "Banco indisponível" });
  }

  const { userId, pedidoId } = req.body;

  if (!userId || !pedidoId) {
    return res.status(400).json({ success: false, error: "Dados inválidos" });
  }

  try {

    const userRef   = db.collection("users").doc(userId);
    const pedidoRef = db.collection("requests").doc(pedidoId);

    // Variáveis que precisamos fora da transaction para notificar depois
    let clienteId   = null;
    let nomeProfissional = null;
    let descricaoPedido  = null;

    await db.runTransaction(async (t) => {

      const userDoc   = await t.get(userRef);
      const pedidoDoc = await t.get(pedidoRef);

      if (!userDoc.exists)   throw new Error("Usuário não encontrado");
      if (!pedidoDoc.exists) throw new Error("Pedido não encontrado");

      const user   = userDoc.data();
      const pedido = pedidoDoc.data();

      if (user.role !== "profissional") throw new Error("Somente profissional pode pegar pedido");
      if (pedido.providerId)            throw new Error("Pedido já foi aceito");

      const saldo = user.balance || 0;
      if (saldo < 3) throw new Error("Saldo insuficiente");

      // Captura dados para notificação
      clienteId        = pedido.clienteId || pedido.clientId || null;
      nomeProfissional = user.nome || user.name || "Um profissional";
      descricaoPedido  = pedido.descricao || pedido.description || "seu pedido";

      // Desconta R$3
      t.update(userRef, { balance: saldo - 3 });

      // Garante chatId
      let chatId = pedido.chatId;
      if (!chatId) chatId = db.collection("chats").doc().id;

      // Atualiza pedido
      t.update(pedidoRef, {
        providerId: userId,
        status:     "aceito",
        chatId:     chatId,
        acceptedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

    });

    // 🔔 Notifica o cliente APÓS a transaction (fora do lock)
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
