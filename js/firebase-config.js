// ============================================
// إعدادات مشروع Firebase
// استبدل القيم دي بإعدادات مشروعك من Firebase Console
// Project Settings → General → Your apps → SDK setup and configuration
// ============================================
const firebaseConfig = {
  apiKey: "ضع_قيمتك_هنا",
  authDomain: "ضع_قيمتك_هنا",
  projectId: "ضع_قيمتك_هنا",
  storageBucket: "ضع_قيمتك_هنا",
  messagingSenderId: "ضع_قيمتك_هنا",
  appId: "ضع_قيمتك_هنا"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
