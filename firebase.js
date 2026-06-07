const admin = require("firebase-admin");

let db = null;

try {
  if (!process.env.FIREBASE_KEY) {
    throw new Error("Variável FIREBASE_KEY não encontrada.");
  }

  const serviceAccount = JSON.parse(process.env.FIREBASE_KEY);

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }

  db = admin.firestore();

  console.log("✅ Firebase conectado com sucesso");

} catch (error) {

  console.warn("⚠️ Firebase desativado:", error.message);

  // ✅ MOCK PRA NÃO QUEBRAR O SISTEMA
  db = {
    collection: () => ({
      doc: () => ({
        get: async () => ({ exists: false }),
        set: async () => {}
      }),
      get: async () => ({ docs: [] })
    })
  };

}

module.exports = db;