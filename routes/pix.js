const express = require("express");
const axios = require("axios");
const db = require("../firebase");

const router = express.Router();

const ASAAS_API_KEY = process.env.ASAAS_API_KEY;

if (!ASAAS_API_KEY) {
  console.error("❌ ASAAS_API_KEY não configurada.");
}

// Configuração Asaas
const api = axios.create({
  baseURL: "https://sandbox.asaas.com/api/v3",
  headers: {
    accept: "application/json",
    "Content-Type": "application/json",
    access_token: ASAAS_API_KEY,
  },
});

// =================================
// CRIAR PIX
// =================================
router.post("/criar-pix", async (req, res) => {
  try {
    const { valor, nome, email } = req.body;

    if (!valor || !nome || !email) {
      return res.status(400).json({
        success: false,
        error: "Informe valor, nome e email",
      });
    }

    // Criar cliente
    const cliente = await api.post("/customers", {
      name: nome,
      email: email,
    });

    // Criar cobrança PIX
    const pagamento = await api.post("/payments", {
      customer: cliente.data.id,
      billingType: "PIX",
      value: parseFloat(valor),
      dueDate: new Date().toISOString().split("T")[0],
    });

    // Buscar QRCode
    const pix = await api.get(
      `/payments/${pagamento.data.id}/pixQrCode`
    );

    return res.status(200).json({
      success: true,
      paymentId: pagamento.data.id,
      status: pagamento.data.status,
      pixCopiaECola: pix.data.payload,
      qrCodeBase64: pix.data.encodedImage,
    });

  } catch (error) {
    console.error(
      "❌ Erro criar PIX:",
      error.response?.data || error.message
    );

    return res.status(500).json({
      success: false,
      error: error.response?.data || error.message,
    });
  }
});

// =================================
// VERIFICAR PAGAMENTO
// =================================
router.get("/verificar-pagamento/:id", async (req, res) => {
  try {
    const response = await api.get(
      `/payments/${req.params.id}`
    );

    return res.json({
      success: true,
      paymentId: response.data.id,
      status: response.data.status,
      value: response.data.value,
    });

  } catch (error) {
    console.error(
      "❌ Erro verificar:",
      error.response?.data || error.message
    );

    return res.status(500).json({
      success: false,
      error: error.response?.data || error.message,
    });
  }
});

// =================================
// CONFIRMAR PAGAMENTO
// =================================
router.post("/confirmar-pagamento", async (req, res) => {
  try {
    const { paymentId, valor } = req.body;

    if (!paymentId || !valor) {
      return res.status(400).json({
        success: false,
        error: "paymentId e valor são obrigatórios",
      });
    }

    const pagamentoRef =
      db.collection("pagamentos").doc(paymentId);

    const pagamentoDoc =
      await pagamentoRef.get();

    if (!pagamentoDoc.exists) {
      await pagamentoRef.set({
        paymentId,
        valor,
        status: "CONFIRMADO",
        criadoEm: new Date().toISOString(),
      });

      console.log(
        `✅ Pagamento salvo: ${paymentId}`
      );
    }

    return res.json({
      success: true,
      message: "Pagamento registrado",
    });

  } catch (error) {
    console.error("❌ Firebase:", error);

    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// =================================
// LISTAR PAGAMENTOS
// =================================
router.get("/pagamentos", async (req, res) => {
  try {
    const snapshot =
      await db.collection("pagamentos").get();

    const pagamentos = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));

    return res.json({
      success: true,
      total: pagamentos.length,
      pagamentos,
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// =================================
// STATUS
// =================================
router.get("/status", (req, res) => {
  res.json({
    online: true,
    servidor: "ConectaPro Backend",
    ambiente: "Render",
    data: new Date().toISOString(),
  });
});

module.exports = router;