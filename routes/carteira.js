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
      const pedidoDoc = await t.get(pedidoRef); // ✅ FALTAVA ISSO

      // ✅ valida usuário
      if (!userDoc.exists) {
        throw new Error("Usuário não encontrado");
      }

      // ✅ valida pedido (ESSENCIAL)
      if (!pedidoDoc.exists) {
        throw new Error("Pedido não encontrado");
      }

      const user = userDoc.data();
      const saldo = user.balance || 0;

      if (saldo < 3) {
        throw new Error("Saldo insuficiente");
      }

      // ✅ desconta saldo
      t.update(userRef, {
        balance: saldo - 3
      });

      // ✅ libera pedido
      t.update(pedidoRef, {
        providerId: userId
      });

    });

    return res.json({
      success: true
    });

  } catch (error) {

    console.log("🔥 ERRO BACKEND REAL:", error);

    return res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;