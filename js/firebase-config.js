// ============================================
// إعدادات مشروع Firebase
// استبدل القيم دي بإعدادات مشروعك من Firebase Console
// Project Settings → General → Your apps → SDK setup and configuration
// ============================================
const firebaseConfig = {
  apiKey: "AIzaSyAUbcrNCCB2Y6kLTVeRv5ZscMgbrfUct3M",
  authDomain: "tools-72703.firebaseapp.com",
  projectId: "tools-72703",
  storageBucket: "tools-72703.firebasestorage.app",
  messagingSenderId: "609973046760",
  appId: "1:609973046760:web:1f6a1432bc1c74d935285d"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
