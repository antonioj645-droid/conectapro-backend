const admin = require("firebase-admin");

let db = null;

function getDB() {
    if (!admin.apps.length) {

        if (!process.env.FIREBASE_KEY) {
            throw new Error("FIREBASE_KEY não configurada no .env");
        }

        const serviceAccount = JSON.parse(process.env.FIREBASE_KEY);

        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
        });

        console.log("✅ Firebase inicializado");
    }

    db = admin.firestore();
    return db;
}

module.exports = getDB;
