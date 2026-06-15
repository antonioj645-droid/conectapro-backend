const express = require("express");
const router = express.Router();
const getDB = require("../firebase");

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