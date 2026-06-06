const admin = require("firebase-admin");

let serviceAccount;

try {
  if (!process.env.FIREBASE_KEY) {
    throw new Error("Variável FIREBASE_KEY não encontrada.");
  }

  serviceAccount = JSON.parse(process.env.FIREBASE_KEY);

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }

  console.log("✅ Firebase conectado com sucesso");
} catch (error) {
  console.error("❌ Erro ao iniciar Firebase:", error.message);
  process.exit(1);
}

const db = admin.firestore();

module.exports = db;