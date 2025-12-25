// firebase-config.js - Versión segura y reutilizable

if (typeof window.firebaseInitialized === 'undefined') {
  const firebaseConfig = {
    apiKey: "AIzaSyAYHZftBXmGaXtiOSU-JAnUbNX3-KHanS0",
    authDomain: "prestamista-a920e.firebaseapp.com",
    projectId: "prestamista-a920e",
    storageBucket: "prestamista-a920e.firebasestorage.app",
    messagingSenderId: "791375364048",
    appId: "1:791375364048:web:96ff9b6d4ab444437f43d5",
    measurementId: "G-G15S8R50E4"
  };

  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }

  const auth = firebase.auth();
  const db = firebase.firestore();

  // Persistencia LOCAL = "Recordar sesión" (sesión sobrevive al cerrar el navegador)
  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
    .catch(err => console.error('Error configurando persistencia:', err));

  window.auth = auth;
  window.db = db;
  window.firebaseInitialized = true;
}