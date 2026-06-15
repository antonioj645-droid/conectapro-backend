const express = require("express");
const router = express.Router();
const getDB = require("../firebase");

let db;

try {
  db = getDB();
} catch (err) {
  console.error("❌ Erro Firebase:", err.message);
}

// ✅ DESBLOQUEAR PEDIDO (R$3)
router.post("/desbloquear", async (req, res) => {

  if (!db) {
    return res.status(500).json({
      success: false,
      error: "Banco indisponível"
    });
  }

  const { userId, pedidoId } = req.body;

  if (!userId || !pedidoId) {
    return res.status(400).json({
      success: false,
      error: "Dados inválidos"
    });
  }

  try {

    const userRef = db.collection("users").doc(userId);
    const pedidoRef = db.collection("requests").doc(pedidoId);

    await db.runTransaction(async (t) => {

      const userDoc = await t.get(userRef);
      const pedidoDoc = await t.get(pedidoRef);

      if (!userDoc.exists) {
        throw new Error("Usuário não encontrado");
      }

      if (!pedidoDoc.exists) {
        throw new Error("Pedido não encontrado");
      }

      const user = userDoc.data();
      const pedido = pedidoDoc.data();

      // ✅ VALIDAÇÃO DE ROLE
      if (user.role !== "profissional") {
        throw new Error("Somente profissional pode pegar pedido");
      }

      // ✅ EVITA DUPLICAÇÃO
      if (pedido.providerId) {
        throw new Error("Pedido já foi aceito");
      }

      const saldo = user.balance || 0;

      if (saldo < 3) {
        throw new Error("Saldo insuficiente");
      }

      // ✅ DESCONTA R$3
      t.update(userRef, {
        balance: saldo - 3
      });

      // ✅ GARANTE chatId
      let chatId = pedido.chatId;

      if (!chatId) {
        chatId = db.collection("chats").doc().id;
      }

      // ✅ ATUALIZA PEDIDO
      const admin = require("firebase-admin"); // 🔥 usa só aqui

      t.update(pedidoRef, {
        providerId: userId,
        status: "aceito",
        chatId: chatId,
        acceptedAt: admin.firestore.FieldValue.serverTimestamp()
      });

    });

    return res.json({
      success: true,
      message: "Pedido desbloqueado com sucesso"
    });

  } catch (error) {

    console.error("🔥 ERRO:", error.message);

    return res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;