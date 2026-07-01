const express = require("express");
const router = express.Router();
const getDB = require("../firebase");

// ─── HELPER: envia notificação FCM ────────────────────────────────────────────
async function enviarNotificacao(fcmToken, title, body) {
    if (!fcmToken) return;
    try {
        const admin = require("firebase-admin");
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
        // Não lança erro — falha de notificação não deve travar o fluxo
    }
}
// ──────────────────────────────────────────────────────────────────────────────

// ✅ NOVO PEDIDO — notifica profissionais da mesma categoria
router.post("/novo-pedido", async (req, res) => {

    let db;

    try {
        db = getDB();
    } catch (err) {
        return res.status(500).json({
            erro: "Erro ao conectar com banco"
        });
    }

    const { pedidoId, titulo, categoria, subcategoria } = req.body;

    if (!pedidoId || !categoria) {
        return res.status(400).json({ erro: "Dados inválidos" });
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

        res.json({ sucesso: true, notificados: envios.length });

    } catch (err) {

        console.error("🔴 ERRO novo-pedido:", err.message);

        res.status(400).json({ erro: err.message });
    }
});

// ✅ FINALIZAR SERVIÇO (COMISSÃO AUTOMÁTICA)
router.post("/finalizar-servico/:id", async (req, res) => {

    let db;

    try {
        db = getDB();
    } catch (err) {
        return res.status(500).json({
            erro: "Erro ao conectar com banco"
        });
    }

    const id = req.params.id;

    try {

        const pedidoRef = db.collection("requests").doc(id);

        await db.runTransaction(async (t) => {

            const pedidoDoc = await t.get(pedidoRef);

            if (!pedidoDoc.exists) {
                throw new Error("Pedido não encontrado");
            }

            const pedido = pedidoDoc.data();

            // 🚫 já finalizado
            if (pedido.status === "concluido" || pedido.status === "finalizado") {
                throw new Error("Pedido já finalizado");
            }

            // 🚫 ninguém aceitou
            if (!pedido.providerId) {
                throw new Error("Pedido não foi aceito ainda");
            }

            // ✅ VALOR CORRETO — aceita valorServico (novo) ou price (antigo)
            const valor = pedido.valorServico || pedido.price || 0;

            if (valor <= 0) {
                throw new Error("Valor do serviço não definido. Defina o valor no chat antes de finalizar.");
            }

            // ✅ COMISSÃO 7%
            const comissao = valor * 0.07;

            // 🔑 BUSCA PROFISSIONAL
            const userRef = db.collection("users").doc(pedido.providerId);
            const userDoc = await t.get(userRef);

            if (!userDoc.exists) {
                throw new Error("Profissional não encontrado");
            }

            const user = userDoc.data();
            const saldo = user.balance || 0;

            // 🚫 sem saldo → BLOQUEIA
            if (saldo < comissao) {
                throw new Error(
                    `Saldo insuficiente. Comissão de 7%: R$ ${comissao.toFixed(2)}. Seu saldo: R$ ${saldo.toFixed(2)}`
                );
            }

            // ✅ DESCONTA COMISSÃO DA CARTEIRA
            t.update(userRef, {
                balance: saldo - comissao
            });

            // ✅ FINALIZA PEDIDO
            const admin = require("firebase-admin");

            t.update(pedidoRef, {
                status:         "concluido",
                comissaoPaga:   true,
                comissaoValor:  comissao,
                valorServico:   valor,
                concluidoEm:    admin.firestore.FieldValue.serverTimestamp()
            });

        });

        res.json({
            sucesso: true,
            mensagem: "Serviço finalizado e comissão descontada automaticamente"
        });

    } catch (err) {

        console.error("🔴 ERRO finalizar:", err.message);

        res.status(400).json({
            erro: err.message
        });
    }
});

module.exports = router;