const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

// Caminho seguro do arquivo
const serviceAccountPath = path.join(__dirname, "serviceAccountKey.json");

// Verifica se o arquivo existe
if (!fs.existsSync(serviceAccountPath)) {
  console.error("❌ serviceAccountKey.json não encontrado!");
}

const serviceAccount = require(serviceAccountPath);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

module.exports = db;