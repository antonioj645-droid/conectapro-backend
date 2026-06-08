const express = require("express");
const router = express.Router();
const admin = require("firebase-admin");

const db = admin.firestore();

// ✅ DESBLOQUEAR PEDIDO (R$3 - APENAS PROFISSIONAL)
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

      // ✅ BLOQUEIA CLIENTE (CHAVE PRINCIPAL)
      if (user.tipo !== "profissional") {
        throw new Error("Somente profissional pode pegar pedido");
      }

      const saldo = user.balance || 0;

      // ✅ VALOR FIXO (R$3)
      const valor = 3;

      if (saldo < valor) {
        throw new Error("Saldo insuficiente");
      }

      // ✅ NÃO DEIXA DUPLICAR
      if (pedido.providerId) {
        throw new Error("Pedido já foi aceito");
      }

      // ✅ DESCONTA APENAS DO PROFISSIONAL
      t.update(userRef, {
        balance: saldo - valor
      });

      // ✅ ATUALIZA PEDIDO
      t.update(pedidoRef, {
        providerId: userId,
        status: "aceito",
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
