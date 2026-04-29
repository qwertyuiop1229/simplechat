importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

const firebaseConfig = {
  apiKey: "AIzaSyDxGdHwHnJYhBErKcQHZs0H9JpwcSN-huY",
  authDomain: "simplechat-65a0d.firebaseapp.com",
  projectId: "simplechat-65a0d",
  storageBucket: "simplechat-65a0d.firebasestorage.app",
  messagingSenderId: "611067360180",
  appId: "1:611067360180:web:5c43144af3ccc4988878e1"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/icon-192x192.png'
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});
