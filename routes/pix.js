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

// Remove tudo que não for número (pontos, traços, barras)
function limparCpfCnpj(valor) {
  return String(valor || "").replace(/[^\d]/g, "");
}

function validarCpfCnpj(valor) {
  const limpo = limparCpfCnpj(valor);
  return limpo.length === 11 || limpo.length === 14;
}

// Extrai uma mensagem de erro legível da resposta da Asaas
function extrairErroAsaas(error) {
  const erros = error?.response?.data?.errors;
  if (Array.isArray(erros) && erros.length > 0) {
    return erros.map((e) => e.description).join(" | ");
  }
  return error.message || "Erro desconhecido ao comunicar com a Asaas.";
}

async function buscarQr(paymentId) {
  for (let i = 0; i < 20; i++) {
    try {
      const { data } = await asaas.get(`/payments/${paymentId}/pixQrCode`);
      if (data?.encodedImage) {
        return { encodedImage: data.encodedImage, payload: data.payload };
      }
    } catch (e) {
      console.log("❌ [PIX] erro ao buscar QR:", extrairErroAsaas(e));
    }
    await sleep(1500);
  }
  return null;
}

async function getCliente(nome, email, cpfCnpj) {
  const { data } = await asaas.get("/customers", { params: { email } });

  if (data.data.length > 0) {
    const clienteExistente = data.data[0];
    const precisaAtualizar = {};

    if (!clienteExistente.notificationDisabled) {
      precisaAtualizar.notificationDisabled = true;
    }

    if (!clienteExistente.cpfCnpj && cpfCnpj) {
      precisaAtualizar.cpfCnpj = cpfCnpj;
    }

    if (Object.keys(precisaAtualizar).length > 0) {
      try {
        await asaas.post(`/customers/${clienteExistente.id}`, precisaAtualizar);
      } catch (e) {
        console.log("⚠️ [PIX] não foi possível atualizar cliente existente:", extrairErroAsaas(e));
      }
    }

    return clienteExistente.id;
  }

  const novo = await asaas.post("/customers", {
    name: nome,
    email,
    cpfCnpj,
    notificationDisabled: true,
  });
  return novo.data.id;
}

// ================================
// CRIAR PIX
// ================================
router.post("/criar-pix", async (req, res) => {
  const { valor, nome, email, userId, cpfCnpj } = req.body;

  console.log("➡️ [PIX] criar-pix chamado:", { userId, valor, temCpfCnpj: !!cpfCnpj });

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

  if (!validarCpfCnpj(cpfCnpj)) {
    return res.status(400).json({
      success: false,
      error: "Para criar esta cobrança é necessário preencher o CPF ou CNPJ do cliente.",
    });
  }

  const cpfCnpjLimpo = limparCpfCnpj(cpfCnpj);

  try {
    const cliente = await getCliente(
      nome || "Usuário ConectaPro",
      email || `${userId}@conectapro.app`,
      cpfCnpjLimpo
    );

    const response = await asaas.post("/payments", {
      customer: cliente,
      billingType: "PIX",
      value: Number(valor),
      dueDate: hoje(),
    });

    const paymentId = response.data.id;
    console.log("✅ [PIX] cobrança criada:", paymentId);

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
      console.log("⚠️ [PIX] erro ao buscar QR:", extrairErroAsaas(e));
    }

    if (!qr) {
      console.log("⚠️ [PIX] QR code não ficou pronto a tempo para", paymentId);
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
    const mensagem = extrairErroAsaas(error);
    console.error("❌ [PIX] ERRO ao criar cobrança:", mensagem);
    return res.status(500).json({
      success: false,
      error: mensagem,
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
    console.error("❌ [PIX] ERRO ao buscar QR separado:", extrairErroAsaas(error));
    return res.status(500).json({ success: false });
  }
});

// Envia push gratuito (FCM) avisando que o PIX caiu — substitui a
// notificação da Asaas, que cobraria R$0,99 por SMS/e-mail.
async function notificarPagamentoConfirmado(userId, valor) {
  try {
    const userDoc = await db.collection("users").doc(userId).get();
    const fcmToken = userDoc.data()?.fcmToken;
    if (!fcmToken) {
      console.log("⚠️ [PIX] usuário sem fcmToken, não foi possível notificar:", userId);
      return;
    }

    await admin.messaging().send({
      token: fcmToken,
      notification: {
        title: "Pagamento confirmado ✅",
        body: `Seu PIX de R$ ${Number(valor).toFixed(2).replace(".", ",")} foi confirmado e o saldo já está disponível.`,
      },
      data: {
        tipo: "pix_confirmado",
      },
    });
    console.log("🔔 [PIX] notificação push enviada para", userId);
  } catch (e) {
    console.log("⚠️ [PIX] falha ao enviar notificação push:", e.message);
  }
}

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
      let jaCreditadoAntes = true;
      let userIdParaNotificar = null;
      let valorParaNotificar = 0;

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

        jaCreditadoAntes = false;
        userIdParaNotificar = pag.userId;
        valorParaNotificar = pag.valor;
      });

      console.log("✅ [PIX] pagamento confirmado e creditado:", paymentId);

      // Só notifica na primeira vez que credita, pra não mandar push duplicado
      // caso o app chame esse endpoint várias vezes seguidas.
      if (!jaCreditadoAntes && userIdParaNotificar) {
        await notificarPagamentoConfirmado(userIdParaNotificar, valorParaNotificar);
      }
    }

    return res.json({ success: true, status });
  } catch (error) {
    console.error("❌ [PIX] erro ao verificar pagamento:", extrairErroAsaas(error));
    return res.json({ success: false });
  }
});

module.exports = router;