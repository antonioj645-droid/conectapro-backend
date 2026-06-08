const express = require("express");
const router = express.Router();
const admin = require("firebase-admin");

const db = admin.firestore();

// ✅ DESBLOQUEAR PEDIDO (R$3)
router.post("/desbloquear", async (req, res) => {

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

      // ✅ AGORA USA "role"
      if (user.role !== "profissional") {
        throw new Error("Somente profissional pode pegar pedido");
      }

      // ✅ evita duplicar
      if (pedido.providerId) {
        throw new Error("Pedido já foi aceito");
      }

      const saldo = user.balance || 0;

      if (saldo < 3) {
        throw new Error("Saldo insuficiente");
      }

      // ✅ desconta R$3
      t.update(userRef, {
        balance: saldo - 3
      });

      // ✅ garante chatId
      let chatId = pedido.chatId;

      if (!chatId) {
        chatId = db.collection("chats").doc().id;
      }

      // ✅ atualiza pedido
      t.update(pedidoRef, {
        providerId: userId,
        status: "aceito",
        chatId: chatId,
        acceptedAt: admin.firestore.FieldValue.serverTimestamp()
      });

    });

    return res.json({
      success: true
    });

  } catch (error) {

    console.log("🔥 ERRO:", error);

    return res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;