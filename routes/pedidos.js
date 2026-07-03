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
// ──────────────────────────────────────────────────────────────────────────────

// ✅ NOVO PEDIDO — notifica profissionais da categoria/subcategoria
router.post("/novo-pedido", async (req, res) => {

  if (!db) {
    return res.status(500).json({ success: false, erro: "Banco indisponível" });
  }

  const { pedidoId, titulo, categoria, subcategoria } = req.body;

  if (!pedidoId || !categoria) {
    return res.status(400).json({ success: false, erro: "Dados inválidos" });
  }

  try {
    const snap = await db
      .collection("users")
      .where("role", "==", "profissional")
      .where("categoria", "==", categoria)
      .get();

    const envios = [];
    snap.forEach((doc) => {
      const fcmToken = doc.data()?.fcmToken;
      if (fcmToken) {
        envios.push(
          enviarNotificacao(
            fcmToken,
            "Novo pedido disponível! 🔔",
            `${titulo || "Novo serviço"} — ${subcategoria || categoria}`
          )
        );
      }
    });

    await Promise.all(envios);

    return res.json({ success: true, notificados: envios.length });

  } catch (error) {
    console.error("🔥 ERRO novo-pedido:", error.message);
    return res.status(400).json({ success: false, erro: error.message });
  }
});

// ✅ FINALIZAR SERVIÇO — desconta comissão de 7% da carteira do profissional
router.post("/finalizar-servico/:pedidoId", async (req, res) => {

  if (!db) {
    return res.status(500).json({ success: false, erro: "Banco indisponível" });
  }

  const { pedidoId } = req.params;
  const { codigo } = req.body;

  if (!pedidoId) {
    return res.status(400).json({ success: false, erro: "Pedido inválido" });
  }

  if (!codigo || String(codigo).trim().length !== 4) {
    return res.status(400).json({ success: false, erro: "Código de confirmação inválido" });
  }

  try {

    let clienteId  = null;
    let comissao   = 0;

    await db.runTransaction(async (t) => {

      const pedidoRef = db.collection("requests").doc(pedidoId);
      const pedidoDoc = await t.get(pedidoRef);

      if (!pedidoDoc.exists) throw new Error("Pedido não encontrado");

      const pedido = pedidoDoc.data();

      if (pedido.status === "concluido") throw new Error("Pedido já foi finalizado");
      if (!pedido.providerId)            throw new Error("Pedido ainda não tem profissional");

      const codigoEsperado = String(pedido.codigoConfirmacao || "").trim();
      if (!codigoEsperado || String(codigo).trim() !== codigoEsperado) {
        throw new Error("Código de confirmação incorreto");
      }

      const valorServico = pedido.valorServico || pedido.valor || 0;
      if (!valorServico || valorServico <= 0) throw new Error("Valor do serviço não definido");

      comissao = Math.round(valorServico * 0.07 * 100) / 100;

      const providerRef = db.collection("users").doc(pedido.providerId);
      const providerDoc = await t.get(providerRef);

      if (!providerDoc.exists) throw new Error("Profissional não encontrado");

      const provider = providerDoc.data();
      const saldo = provider.balance || 0;

      if (saldo < comissao) throw new Error("Saldo insuficiente para pagar a comissão");

      clienteId = pedido.clienteId || pedido.clientId || null;

      // Desconta a comissão do profissional
      t.update(providerRef, { balance: saldo - comissao });

      // Marca o pedido como concluído
      t.update(pedidoRef, {
        status:        "concluido",
        comissaoPaga:  true,
        comissaoValor: comissao,
        concluidoEm:   admin.firestore.FieldValue.serverTimestamp(),
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
            "Serviço finalizado! ✅",
            "O profissional marcou o serviço como concluído."
          );
        }
      } catch (notifErr) {
        console.error("⚠️ Erro ao notificar cliente:", notifErr.message);
      }
    }

    return res.json({ success: true, comissao });

  } catch (error) {
    console.error("🔥 ERRO finalizar-servico:", error.message);
    return res.status(400).json({ success: false, erro: error.message });
  }
});

module.exports = router;