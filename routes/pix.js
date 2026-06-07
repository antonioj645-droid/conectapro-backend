"use strict";

const express = require("express");
const axios = require("axios");

const router = express.Router();

// ✅ PRODUÇÃO (CORRIGIDO)
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

// ================================
// HELPERS
// ================================

function hoje() {
  return new Date().toISOString().split("T")[0];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 🔥 BUSCAR QR COM DEBUG
async function buscarQr(paymentId) {

  for (let i = 0; i < 20; i++) {

    try {

      const { data } =
        await asaas.get(`/payments/${paymentId}/pixQrCode`);

      console.log("=== QR RESPONSE ===");
      console.log(JSON.stringify(data, null, 2));

      if (data?.encodedImage) {
        console.log(`✅ QR pronto (${i + 1})`);

        return {
          encodedImage: data.encodedImage,
          payload: data.payload,
        };
      }

      console.log(`⏳ aguardando QR... (${i + 1})`);

    } catch (e) {
      console.log(
        "❌ erro QR:",
        e.response?.data || e.message
      );
    }

    await sleep(1500);
  }

  console.log("⚠️ QR não ficou pronto");

  return null;
}

// CLIENTE
async function getCliente(nome, email) {

  const { data } = await asaas.get("/customers", {
    params: { email },
  });

  if (data.data.length > 0) {
    return data.data[0].id;
  }

  const novo = await asaas.post("/customers", {
    name: nome,
    email,
  });

  return novo.data.id;
}

// ================================
// CRIAR PIX
// ================================

router.post("/criar-pix", async (req, res) => {

  const { valor, nome, email } = req.body;

  try {

    const cliente = await getCliente(nome, email);

    const response = await asaas.post("/payments", {
      customer: cliente,
      billingType: "PIX",
      value: Number(valor),
      dueDate: hoje(),
    });

    const paymentId = response.data.id;

    console.log("✅ PIX criado:", paymentId);

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

    console.error(
      "❌ ERRO PIX:",
      error.response?.data || error.message
    );

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
      return res.json({
        success: false,
        qrCodeBase64: "",
        pixCopiaECola: "",
      });
    }

    return res.json({
      success: true,
      qrCodeBase64: `data:image/png;base64,${qr.encodedImage}`,
      pixCopiaECola: qr.payload,
    });

  } catch (error) {

    console.error(
      "❌ ERRO QR:",
      error.response?.data || error.message
    );

    return res.status(500).json({
      success: false,
    });
  }
});

// ================================
// VERIFICAR STATUS
// ================================

router.get("/verificar-pagamento/:id", async (req, res) => {

  try {

    const { data } =
      await asaas.get(`/payments/${req.params.id}`);

    return res.json({
      success: true,
      status: data.status,
    });

  } catch (error) {

    console.error(
      "Erro verificar:",
      error.response?.data || error.message
    );

    return res.json({
      success: false,
    });
  }
});

module.exports = router;
