"use strict";

const express = require("express");
const axios = require("axios");
const admin = require("firebase-admin");
const getDB = require("../firebase");

const router = express.Router();

let db;
try {
  db = getDB();
} catch (err) {
  console.error("❌ Erro Firebase:", err.message);
}

const ASAAS_BASE_URL =
  process.env.ASAAS_BASE_URL ?? "https://api.asaas.com/v3";

const ASAAS_API_KEY = process.env.ASAAS_API_KEY;

const asaas = axios.create({
  baseURL: ASAAS_BASE_URL,
  headers: {
    "Content-Type": "application/json",
    access_token: ASAAS_API_KEY,
  },
});

function hoje() {
  return new Date().toISOString().split("T")[0];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function buscarQr(paymentId) {
  for (let i = 0; i < 20; i++) {
    try {
      const { data } = await asaas.get(`/payments/${paymentId}/pixQrCode`);
      if (data?.encodedImage) {
        return { encodedImage: data.encodedImage, payload: data.payload };
      }
    } catch (e) {
      console.log("❌ erro QR:", e.response?.data || e.message);
    }
    await sleep(1500);
  }
  return null;
}

async function getCliente(nome, email) {
  const { data } = await asaas.get("/customers", { params: { email } });

  if (data.data.length > 0) {
    const clienteExistente = data.data[0];

    // Cliente já existe (criado antes desta mudança). Se ainda não tiver
    // as notificações desativadas, atualiza agora para parar de gerar
    // cobrança de R$0,99 por SMS/e-mail em cobranças futuras.
    if (!clienteExistente.notificationDisabled) {
      try {
        await asaas.post(`/customers/${clienteExistente.id}`, {
          notificationDisabled: true,
        });
      } catch (e) {
        console.log("⚠️ não foi possível desativar notificações do cliente existente:", e.response?.data || e.message);
      }
    }

    return clienteExistente.id;
  }

  // Cliente novo: já cria com notificações (SMS/e-mail) desativadas.
  // Isso evita a cobrança de R$0,99 por mensagem que a Asaas envia por padrão.
  // A confirmação do PIX e o crédito do saldo continuam acontecendo normalmente
  // pelo endpoint /verificar-pagamento, então nada muda no fluxo interno do app.
  const novo = await asaas.post("/customers", {
    name: nome,
    email,
    notificationDisabled: true,
  });
  return novo.data.id;
}

// ================================
// CRIAR PIX
// ================================
// Agora exige o userId de quem está pagando de verdade — sem isso
// não tem como saber de quem é o dinheiro nem creditar o saldo certo.
router.post("/criar-pix", async (req, res) => {
  const { valor, nome, email, userId } = req.body;

  if (!userId) {
    return res.status(400).json({
      success: false,
      error: "userId é obrigatório para identificar quem está pagando.",
    });
  }

  if (!valor || Number(valor) < 5) {
    return res.status(400).json({
      success: false,
      error: "Valor mínimo para PIX é R$ 5,00 (limite do Asaas).",
    });
  }

  try {
    const cliente = await getCliente(nome || "Usuário ConectaPro", email || `${userId}@conectapro.app`);

    const response = await asaas.post("/payments", {
      customer: cliente,
      billingType: "PIX",
      value: Number(valor),
      dueDate: hoje(),
    });

    const paymentId = response.data.id;

    // Registra o pagamento pendente vinculado ao usuário, pra poder
    // creditar o saldo certo quando confirmar — e não creditar 2x.
    await db.collection("pix_payments").doc(paymentId).set({
      userId,
      valor: Number(valor),
      status: "PENDING",
      criadoEm: admin.firestore.FieldValue.serverTimestamp(),
    });

    let qr = null;
    try {
      qr = await buscarQr(paymentId);
    } catch (e) {
      console.log("⚠️ erro ao buscar QR");
    }

    return res.json({
      success: true,
      paymentId,
      pixCopiaECola: qr?.payload ?? "",
      qrCodeBase64: qr?.encodedImage
        ? `data:image/png;base64,${qr.encodedImage}`
        : "",
      qrDisponivel: !!qr,
    });
  } catch (error) {
    console.error("❌ ERRO PIX:", error.response?.data || error.message);
    return res.status(500).json({
      success: false,
      error: error.response?.data || error.message,
    });
  }
});

// ================================
// BUSCAR QR SEPARADO
// ================================
router.get("/pix-qrcode/:id", async (req, res) => {
  try {
    const qr = await buscarQr(req.params.id);
    if (!qr) {
      return res.json({ success: false, qrCodeBase64: "", pixCopiaECola: "" });
    }
    return res.json({
      success: true,
      qrCodeBase64: `data:image/png;base64,${qr.encodedImage}`,
      pixCopiaECola: qr.payload,
    });
  } catch (error) {
    console.error("❌ ERRO QR:", error.response?.data || error.message);
    return res.status(500).json({ success: false });
  }
});

// ================================
// VERIFICAR STATUS (e creditar saldo, uma única vez)
// ================================
router.get("/verificar-pagamento/:id", async (req, res) => {
  const paymentId = req.params.id;

  try {
    const { data } = await asaas.get(`/payments/${paymentId}`);
    const status = data.status;

    const confirmado = status === "CONFIRMED" || status === "RECEIVED";

    if (confirmado) {
      await db.runTransaction(async (t) => {
        const pagRef = db.collection("pix_payments").doc(paymentId);
        const pagDoc = await t.get(pagRef);

        if (!pagDoc.exists) {
          throw new Error("Pagamento não encontrado no registro interno.");
        }

        const pag = pagDoc.data();

        if (pag.status === "CREDITADO") {
          return;
        }

        const userRef = db.collection("users").doc(pag.userId);
        const userDoc = await t.get(userRef);
        const saldoAtual = (userDoc.data()?.balance || 0);

        t.update(userRef, { balance: saldoAtual + pag.valor });
        t.update(pagRef, {
          status: "CREDITADO",
          creditadoEm: admin.firestore.FieldValue.serverTimestamp(),
        });
      });
    }

    return res.json({ success: true, status });
  } catch (error) {
    console.error("Erro verificar:", error.response?.data || error.message);
    return res.json({ success: false });
  }
});

module.exports = router;
