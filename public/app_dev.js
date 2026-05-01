
      import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
      import {
        getAuth,
        signInWithEmailAndPassword,
        signOut,
        onAuthStateChanged,
      } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
      import {
        getFirestore,
        doc,
        getDoc,
        addDoc,
        setDoc,
        updateDoc,
        deleteDoc,
        onSnapshot,
        collection,
        query,
        where,
        serverTimestamp,
        orderBy,
        getDocs,
        writeBatch,
        limit,
        arrayUnion,
        arrayRemove,
      } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
      import {
        getMessaging,
        getToken,
        onMessage
      } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-messaging.js";

      // Firebase設定
      const firebaseConfig = {
        apiKey: "AIzaSyDxGdHwHnJYhBErKcQHZs0H9JpwcSN-huY",
        authDomain: "simplechat-65a0d.firebaseapp.com",
        projectId: "simplechat-65a0d",
        storageBucket: "simplechat-65a0d.firebasestorage.app",
        messagingSenderId: "611067360180",
        appId: "1:611067360180:web:5c43144af3ccc4988878e1",
        measurementId: "G-2JMHWNMG4R",
      };

      const appId = "simplechat-65a0d";

      let app;
      let db;
      let auth;
      let messaging;
      let userId = null;
      let userNickname = null;
      let isAdmin = false;
      const isTauri = window.__TAURI__ !== undefined;
      
      let currentServerId = null;
      let currentRoomId = null;
      let unsubscribeMessages = null;
      let unsubscribeUserStatus = null;

      let isAuthReady = false;
      let pendingRoomJoin = null;
      let pendingRoomDelete = null;

      let lastMessagesData = [];
      let attachedFile = null;
      let replyingToMessage = null;

      let readReceiptsUnsubscribe = null;
      let roomReadReceipts = {};
      let messagesIndexMap = {};

      // 未読バッジ用
      let unreadCounts = {};
      let unreadListeners = {};

      let awayTimer = null;
      const AWAY_TIMEOUT = 5 * 60 * 1000;

      // ★ メンバーリストのキャッシュと更新用インターバル
      let cachedUsers = [];
      let memberListRefreshInterval = null;
      let userAvatarUrl = null;
      let messageLimit = 20;
      let isScrollingUpLoad = false;

      // DOM Elements
      const loadingOverlay = document.getElementById("loadingOverlay");
      const authContainer = document.getElementById("authContainer");
      
      const tabLogin = document.getElementById("tabLogin");
      const tabSignup = document.getElementById("tabSignup");
      const loginFormArea = document.getElementById("loginFormArea");
      const signupFormArea = document.getElementById("signupFormArea");

      const emailInput = document.getElementById("emailInput");
      const passwordInput = document.getElementById("passwordInput");
      const authButton = document.getElementById("authButton");
      
      const signupEmailInput = document.getElementById("signupEmailInput");
      const signupPasswordInput = document.getElementById("signupPasswordInput");
      const signupButton = document.getElementById("signupButton");
      
      const authMessage = document.getElementById("authMessage");

      const nicknameContainer = document.getElementById("nicknameContainer");
      const nicknameInput = document.getElementById("nicknameInput");
      const setNicknameButton = document.getElementById("setNicknameButton");
      const nicknameMessage = document.getElementById("nicknameMessage");

      // Header Title
      const headerTitle = document.getElementById("headerTitle");

      // Settings Modal
      const settingsModal = document.getElementById("settingsModal");
      const closeSettingsButton = document.getElementById("closeSettingsButton");
      const settingsNicknameInput = document.getElementById("settingsNicknameInput");
      const saveSettingsButton = document.getElementById("saveSettingsButton");
      const logoutButtonInModal = document.getElementById("logoutButtonInModal");
      const settingsMessage = document.getElementById("settingsMessage");
      const settingsAvatarText = document.getElementById("settingsAvatarText");
      const adminPanelContainer = document.getElementById("adminPanelContainer");
      const openAdminModalButton = document.getElementById("openAdminModalButton");

      // Admin Modal
      const adminModal = document.getElementById("adminModal");
      const closeAdminModalButton = document.getElementById("closeAdminModalButton");
      const newAllowedEmailInput = document.getElementById("newAllowedEmailInput");
      const addAllowedEmailButton = document.getElementById("addAllowedEmailButton");
      const allowedEmailsList = document.getElementById("allowedEmailsList");
      const newAdminEmailInput = document.getElementById("newAdminEmailInput");
      const addAdminEmailButton = document.getElementById("addAdminEmailButton");
      const adminEmailsList = document.getElementById("adminEmailsList");
      const adminMessage = document.getElementById("adminMessage");

      // User Panel
      const userPanel = document.getElementById("userPanel");
      const userPanelAvatar = document.getElementById("userPanelAvatar");
      const userPanelName = document.getElementById("userPanelName");
      const userPanelId = document.getElementById("userPanelId");

      const createRoomPasswordModal = document.getElementById("createRoomPasswordModal");
      const newRoomPasswordInput = document.getElementById("newRoomPasswordInput");
      const confirmCreateRoomButton = document.getElementById("confirmCreateRoomButton");
      const cancelCreateRoomButton = document.getElementById("cancelCreateRoomButton");
      const createRoomPasswordMessage = document.getElementById("createRoomPasswordMessage");

      const joinRoomPasswordModal = document.getElementById("joinRoomPasswordModal");
      const joinRoomTitle = document.getElementById("joinRoomTitle");
      const joinRoomPasswordInput = document.getElementById("joinRoomPasswordInput");
      const confirmJoinRoomButton = document.getElementById("confirmJoinRoomButton");
      const cancelJoinRoomButton = document.getElementById("cancelJoinRoomButton");
      const joinRoomPasswordMessage = document.getElementById("joinRoomPasswordMessage");

      const deleteRoomConfirmModal = document.getElementById("deleteRoomConfirmModal");
      const roomToDeleteNameSpan = document.getElementById("roomToDeleteName");
      const confirmDeleteButton = document.getElementById("confirmDeleteButton");
      const cancelDeleteButton = document.getElementById("cancelDeleteButton");
      const deleteConfirmErrorMessage = document.getElementById("deleteConfirmErrorMessage");

      const deleteRoomPasswordModal = document.getElementById("deleteRoomPasswordModal");
      const roomToDeletePasswordNameSpan = document.getElementById("roomToDeletePasswordName");
      const deleteRoomPasswordInput = document.getElementById("deleteRoomPasswordInput");
      const confirmDeletePasswordButton = document.getElementById("confirmDeletePasswordButton");
      const cancelDeletePasswordButton = document.getElementById("cancelDeletePasswordButton");
      const deletePasswordErrorMessage = document.getElementById("deletePasswordErrorMessage");

      const appContainer = document.getElementById("appContainer");
      const roomList = document.getElementById("roomList");
      const promptCreateRoomButton = document.getElementById("promptCreateRoomButton");
      
      const membersSidebar = document.getElementById("membersSidebar");
      const membersList = document.getElementById("membersList");
      const bottomSheetOverlay = document.getElementById("bottomSheetOverlay");
      const bottomSheetHandle = document.getElementById("bottomSheetHandle");

      const currentRoomHeader = document.getElementById("currentRoomHeader");
      const messagesDisplay = document.getElementById("messagesDisplay");
      const messageInput = document.getElementById("messageInput");

      const filePreviewContainer = document.getElementById("filePreviewContainer");
      const filePreviewName = document.getElementById("filePreviewName");
      const clearFileButton = document.getElementById("clearFileButton");

      const replyingToContainer = document.getElementById("replyingToContainer");
      const replyingToNickname = document.getElementById("replyingToNickname");
      const replyingToText = document.getElementById("replyingToText");
      const cancelReplyButton = document.getElementById("cancelReplyButton");

      const messageContextMenu = document.getElementById("messageContextMenu");
      const copyMessageButton = document.getElementById("copyMessageButton");
      const deleteMessageButton = document.getElementById("deleteMessageButton");
      const toggleSearchButton = document.getElementById("toggleSearchButton");
      const searchContainer = document.getElementById("searchContainer");
      const searchInput = document.getElementById("searchInput");
      const closeSearchBtn = document.getElementById("closeSearchBtn");
      const pinnedMessagesArea = document.getElementById("pinnedMessagesArea");
      const currentRoomTitleText = document.getElementById("currentRoomTitleText");
      const pinMessageButton = document.getElementById("pinMessageButton");
      const mobileBackButton = document.getElementById("mobileBackButton");
      const sidebar = document.getElementById("sidebar");
      
      let searchQuery = "";
      let isInitialMessageLoad = true;
      // Web Audio API による洗練された通知チャイム
      function playNotificationSound() {
        try {
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          const now = ctx.currentTime;
          const notes = [659.25, 783.99, 1046.50]; // E5, G5, C6 の和音チャイム
          notes.forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now + i * 0.09);
            gain.gain.setValueAtTime(0, now + i * 0.09);
            gain.gain.linearRampToValueAtTime(0.18, now + i * 0.09 + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.09 + 0.5);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now + i * 0.09);
            osc.stop(now + i * 0.09 + 0.5);
          });
          setTimeout(() => ctx.close(), 1500);
        } catch(e) {}
      }
      let selectedMessageForContext = null;

      // =========================================================================
      // Initialization & Auth
      // =========================================================================
      function initializeFirebase() {
        try {
          if (!app) {
            app = initializeApp(firebaseConfig);
            db = getFirestore(app);
            auth = getAuth(app);
          }

          onAuthStateChanged(auth, async (user) => {
            loadingOverlay.classList.add("hidden");

            if (user) {
              userId = user.uid;
              userAuthEmail = user.email;
              isAuthReady = true;

              try {
                // Firestoreの adminList から自身のメールアドレスがあるかチェック
                const adminDocRef = doc(db, `artifacts/${appId}/settings`, "adminList");
                const adminSnap = await getDoc(adminDocRef);
                if (adminSnap.exists() && adminSnap.data().emails) {
                    isAdmin = adminSnap.data().emails.includes(user.email);
                } else {
                    isAdmin = false;
                }
              } catch (adminError) {
                console.error("Admin check error:", adminError);
                isAdmin = false;
              }

              // 管理者であれば「管理者設定」ボタンを表示
              if (isAdmin) {
                adminPanelContainer.classList.remove("hidden");
              } else {
                adminPanelContainer.classList.add("hidden");
              }

              const userProfileRef = doc(db, `artifacts/${appId}/servers/${currentServerId}/profiles/${userId}`, "nicknameDoc");
              const userProfileSnap = await getDoc(userProfileRef);

              if (userProfileSnap.exists() && userProfileSnap.data().nickname) {
                userNickname = userProfileSnap.data().nickname;
                userAvatarUrl = userProfileSnap.data().avatarUrl || null;
                
                // ★ヘッダータイトルの更新
                headerTitle.textContent = `ニックネーム：${userNickname}${isAdmin ? " (管理者)" : ""}`;
                updateUserPanelUI();
                
                authContainer.classList.add("hidden");
                nicknameContainer.classList.add("hidden");
                appContainer.classList.remove("hidden");
                loadRooms();
                startPresenceSystem();
                initializeFCM();
              } else {
                authContainer.classList.add("hidden");
                appContainer.classList.add("hidden");
                nicknameContainer.classList.remove("hidden");
                nicknameInput.value = "";
              }
            } else {
              // Cleanup on logout
              userId = null; userNickname = null; isAdmin = false; isAuthReady = false;
              currentRoomId = null;
              headerTitle.textContent = ""; // Reset header
              currentRoomHeader.classList.add("hidden");
              messagesDisplay.innerHTML = "";
              messageInput.disabled = true;
              stopPresenceSystem();
              
              authContainer.classList.remove("hidden");
              appContainer.classList.add("hidden");
              nicknameContainer.classList.add("hidden");
              membersSidebar.classList.add("hidden");
            }
          });
        } catch (error) {
          console.error("Firebase Init Error:", error);
          authMessage.textContent = `エラー: ${error.message}`;
        }
      }

      function updateUserPanelUI() {
        if(userNickname) {
            userPanelName.textContent = userNickname;
            userPanelId.textContent = `#${userId.substring(0, 4)}`;
            
            if (userAvatarUrl) {
                userPanelAvatar.innerHTML = `<img src="${userAvatarUrl}" class="w-full h-full rounded-full object-cover">`;
            } else {
                userPanelAvatar.innerHTML = userNickname.charAt(0).toUpperCase();
            }
            
            const stat = document.createElement('div');
            stat.id = 'userPanelStatus';
            stat.className = 'status-indicator status-online';
            userPanelAvatar.appendChild(stat);
        }
      }

      // タブ切り替え処理
      tabLogin.addEventListener("click", () => {
          tabLogin.classList.replace("text-gray-400", "text-gray-800");
          tabLogin.classList.replace("border-transparent", "border-gray-800");
          tabSignup.classList.replace("text-gray-800", "text-gray-400");
          tabSignup.classList.replace("border-gray-800", "border-transparent");
          loginFormArea.classList.remove("hidden");
          signupFormArea.classList.add("hidden");
          authMessage.textContent = "";
      });

      tabSignup.addEventListener("click", () => {
          tabSignup.classList.replace("text-gray-400", "text-gray-800");
          tabSignup.classList.replace("border-transparent", "border-gray-800");
          tabLogin.classList.replace("text-gray-800", "text-gray-400");
          tabLogin.classList.replace("border-gray-800", "border-transparent");
          signupFormArea.classList.remove("hidden");
          loginFormArea.classList.add("hidden");
          authMessage.textContent = "";
      });

      authButton.addEventListener("click", async () => {
        const email = emailInput.value;
        const password = passwordInput.value;
        authMessage.textContent = "";
        loadingOverlay.classList.remove("hidden");
        try {
          await signInWithEmailAndPassword(auth, email, password);
        } catch (error) {
          authMessage.textContent = `メールアドレスまたはパスワードが違います。`;
        } finally {
          loadingOverlay.classList.add("hidden");
        }
      });

      // サインアップ処理 (Cloudflare Workers API経由)
      signupButton.addEventListener("click", async () => {
          const email = signupEmailInput.value;
          const password = signupPasswordInput.value;
          authMessage.textContent = "";
          
          if (!email || !password) {
              authMessage.textContent = "メールアドレスとパスワードを入力してください。";
              return;
          }
          if (password.length < 6) {
              authMessage.textContent = "パスワードは6文字以上で設定してください。";
              return;
          }

          loadingOverlay.classList.remove("hidden");
          try {
              // Workers API へのリクエスト
              const apiUrl = "https://simplechat-api.astro-fray-server.workers.dev/api/signup";
              
              const res = await fetch(apiUrl, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ email, password })
              });
              
              const data = await res.json();
              
              if (res.ok) {
                  // サインアップ成功時はそのままログインを試行
                  await signInWithEmailAndPassword(auth, email, password);
              } else {
                  authMessage.textContent = data.error || "アカウント作成に失敗しました。";
              }
          } catch (err) {
              console.error("Signup error:", err);
              authMessage.textContent = "通信エラーが発生しました。サーバーが起動していない可能性があります。";
          } finally {
              loadingOverlay.classList.add("hidden");
          }
      });

      // --- 管理者パネルの処理 ---
      openAdminModalButton.addEventListener("click", async () => {
          if (!isAdmin) return;
          adminMessage.textContent = "読み込み中...";
          adminModal.classList.remove("hidden");
          
          try {
              // 許可リストと管理者リストを取得
              const allowedRef = doc(db, `artifacts/${appId}/settings`, "allowedEmails");
              const adminRef = doc(db, `artifacts/${appId}/settings`, "adminList");
              
              const [allowedSnap, adminSnap] = await Promise.all([getDoc(allowedRef), getDoc(adminRef)]);
              
              const allowedData = allowedSnap.exists() ? allowedSnap.data().emails || [] : [];
              const adminData = adminSnap.exists() ? adminSnap.data().emails || [] : [];
              
              renderAllowedEmails(allowedData);
              renderAdminEmails(adminData);
              adminMessage.textContent = "";
          } catch (e) {
              console.error(e);
              adminMessage.textContent = "データの取得に失敗しました。";
          }
      });

      closeAdminModalButton.addEventListener("click", () => {
          adminModal.classList.add("hidden");
      });

      function renderAllowedEmails(emails) {
          allowedEmailsList.innerHTML = "";
          emails.forEach(e => {
              const div = document.createElement("div");
              div.className = "flex justify-between items-center p-2 bg-white rounded border border-gray-100";
              const span = document.createElement("span");
              span.textContent = e;
              span.className = "text-sm text-gray-800";
              const btn = document.createElement("button");
              btn.innerHTML = `<i class="fas fa-trash text-red-500"></i>`;
              btn.className = "hover:bg-red-50 p-1 rounded";
              btn.onclick = () => removeAllowedEmail(e);
              div.appendChild(span);
              div.appendChild(btn);
              allowedEmailsList.appendChild(div);
          });
      }

      function renderAdminEmails(emails) {
          adminEmailsList.innerHTML = "";
          emails.forEach(e => {
              const div = document.createElement("div");
              div.className = "flex justify-between items-center p-2 bg-white rounded border border-gray-100";
              const span = document.createElement("span");
              span.textContent = e;
              span.className = "text-sm text-gray-800";
              div.appendChild(span);
              
              // 自分自身は削除できないようにする
              if (e !== userAuthEmail) {
                  const btn = document.createElement("button");
                  btn.innerHTML = `<i class="fas fa-trash text-red-500"></i>`;
                  btn.className = "hover:bg-red-50 p-1 rounded";
                  btn.onclick = () => removeAdminEmail(e);
                  div.appendChild(btn);
              } else {
                  const b = document.createElement("span");
                  b.textContent = "(あなた)";
                  b.className = "text-xs text-gray-400";
                  div.appendChild(b);
              }
              adminEmailsList.appendChild(div);
          });
      }
      // authEmail を保持するための変数
      let userAuthEmail = "";

      // 許可リストへの追加と削除
      addAllowedEmailButton.addEventListener("click", async () => {
          const email = newAllowedEmailInput.value.trim();
          if (!email) return;
          adminMessage.textContent = "追加中...";
          try {
              const ref = doc(db, `artifacts/${appId}/settings`, "allowedEmails");
              const snap = await getDoc(ref);
              let emails = snap.exists() ? snap.data().emails || [] : [];
              if (!emails.includes(email)) {
                  emails.push(email);
                  await setDoc(ref, { emails }, { merge: true });
                  newAllowedEmailInput.value = "";
                  renderAllowedEmails(emails);
                  adminMessage.textContent = "追加しました。";
              } else {
                  adminMessage.textContent = "すでに追加されています。";
              }
          } catch(e) {
              console.error(e);
              adminMessage.textContent = "エラーが発生しました。";
          }
      });
      
      async function removeAllowedEmail(email) {
          if(!confirm(`「${email}」を許可リストから削除しますか？`)) return;
          adminMessage.textContent = "削除中...";
          try {
              const ref = doc(db, `artifacts/${appId}/settings`, "allowedEmails");
              const snap = await getDoc(ref);
              let emails = snap.exists() ? snap.data().emails || [] : [];
              emails = emails.filter(e => e !== email);
              await setDoc(ref, { emails }, { merge: true });
              renderAllowedEmails(emails);
              adminMessage.textContent = "削除しました。";
          } catch(e) {
              adminMessage.textContent = "エラーが発生しました。";
          }
      }

      // 管理者リストへの追加と削除
      addAdminEmailButton.addEventListener("click", async () => {
          const email = newAdminEmailInput.value.trim();
          if (!email) return;
          adminMessage.textContent = "追加中...";
          try {
              const ref = doc(db, `artifacts/${appId}/settings`, "adminList");
              const snap = await getDoc(ref);
              let emails = snap.exists() ? snap.data().emails || [] : [];
              if (!emails.includes(email)) {
                  emails.push(email);
                  await setDoc(ref, { emails }, { merge: true });
                  newAdminEmailInput.value = "";
                  renderAdminEmails(emails);
                  adminMessage.textContent = "追加しました。";
              } else {
                  adminMessage.textContent = "すでに追加されています。";
              }
          } catch(e) {
              console.error(e);
              adminMessage.textContent = "エラーが発生しました。";
          }
      });

      async function removeAdminEmail(email) {
          if(!confirm(`「${email}」を管理者から削除しますか？`)) return;
          adminMessage.textContent = "削除中...";
          try {
              const ref = doc(db, `artifacts/${appId}/settings`, "adminList");
              const snap = await getDoc(ref);
              let emails = snap.exists() ? snap.data().emails || [] : [];
              emails = emails.filter(e => e !== email);
              await setDoc(ref, { emails }, { merge: true });
              renderAdminEmails(emails);
              adminMessage.textContent = "削除しました。";
          } catch(e) {
              adminMessage.textContent = "エラーが発生しました。";
          }
      }

      let pendingAvatarUrl = null;
      const avatarUploadTrigger = document.getElementById("avatarUploadTrigger");
      const avatarUploadInput = document.getElementById("avatarUploadInput");
      const settingsAvatarPreview = document.getElementById("settingsAvatarPreview");

      avatarUploadTrigger.addEventListener("click", () => avatarUploadInput.click());
      
      avatarUploadInput.addEventListener("change", (e) => {
          const file = e.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = function(ev) {
              const img = new Image();
              img.onload = function() {
                  const canvas = document.createElement('canvas');
                  const size = 150; // 最大サイズ
                  let width = img.width, height = img.height;
                  if (width > height) { if (width > size) { height *= size / width; width = size; } }
                  else { if (height > size) { width *= size / height; height = size; } }
                  canvas.width = width; canvas.height = height;
                  const ctx = canvas.getContext('2d');
                  ctx.drawImage(img, 0, 0, width, height);
                  pendingAvatarUrl = canvas.toDataURL('image/jpeg', 0.8); // 圧縮
                  settingsAvatarPreview.src = pendingAvatarUrl;
                  settingsAvatarPreview.classList.remove("hidden");
                  document.getElementById("resetAvatarButton").classList.remove("hidden");
              };
              img.src = ev.target.result;
          };
          reader.readAsDataURL(file);
      });

      // Settings Modal Logic
      const resetAvatarButton = document.getElementById("resetAvatarButton");
      
      userPanel.addEventListener("click", () => {
        if(!userNickname) return;
        settingsNicknameInput.value = userNickname;
        settingsAvatarText.textContent = userNickname.charAt(0).toUpperCase();
        pendingAvatarUrl = null;
        if (userAvatarUrl) {
            settingsAvatarPreview.src = userAvatarUrl;
            settingsAvatarPreview.classList.remove("hidden");
            resetAvatarButton.classList.remove("hidden");
        } else {
            settingsAvatarPreview.classList.add("hidden");
            resetAvatarButton.classList.add("hidden");
        }
        settingsMessage.textContent = "";
        settingsModal.classList.remove("hidden");
      });

      // アイコンリセットボタン
      resetAvatarButton.addEventListener("click", async () => {
        loadingOverlay.classList.remove("hidden");
        try {
            const userProfileRef = doc(db, `artifacts/${appId}/servers/${currentServerId}/profiles/${userId}`, "nicknameDoc");
            await updateDoc(userProfileRef, { avatarUrl: null });
            userAvatarUrl = null;
            pendingAvatarUrl = null;
            settingsAvatarPreview.classList.add("hidden");
            settingsAvatarText.textContent = userNickname.charAt(0).toUpperCase();
            resetAvatarButton.classList.add("hidden");
            updateUserPanelUI();
            await updateUserStatus(document.visibilityState === 'hidden' ? 'offline' : 'online');
            settingsMessage.textContent = "アイコンをリセットしました";
            settingsMessage.className = "text-center mt-2 text-sm text-green-600";
        } catch (e) {
            console.error(e);
            settingsMessage.textContent = "リセットに失敗しました";
            settingsMessage.className = "text-center mt-2 text-sm text-red-600";
        } finally {
            loadingOverlay.classList.add("hidden");
        }
      });

      closeSettingsButton.addEventListener("click", () => {
        settingsModal.classList.add("hidden");
      });
      
      // ★ モーダルの背景クリックで閉じる処理
      settingsModal.addEventListener("click", (e) => {
        if (e.target === settingsModal) {
            settingsModal.classList.add("hidden");
        }
      });

      saveSettingsButton.addEventListener("click", async () => {
        const newName = settingsNicknameInput.value.trim();
        if(newName.length < 1 || newName.length > 20) {
            settingsMessage.textContent = "1〜20文字で入力してください。";
            settingsMessage.className = "text-center mt-2 text-sm text-red-600";
            return;
        }
        loadingOverlay.classList.remove("hidden");
        try {
            const userProfileRef = doc(db, `artifacts/${appId}/servers/${currentServerId}/profiles/${userId}`, "nicknameDoc");
            const updateData = { nickname: newName, createdAt: serverTimestamp() };
            if (pendingAvatarUrl) { updateData.avatarUrl = pendingAvatarUrl; }
            await setDoc(userProfileRef, updateData, {merge: true});
            userNickname = newName;
            if (pendingAvatarUrl) { userAvatarUrl = pendingAvatarUrl; }
            
            // ★ヘッダータイトルの更新
            headerTitle.textContent = `${userNickname}${isAdmin ? " (管理者)" : ""}`;
            updateUserPanelUI();
            
            await updateUserStatus(document.visibilityState === 'hidden' ? 'offline' : 'online');

            settingsMessage.textContent = "保存しました";
            settingsMessage.className = "text-center mt-2 text-sm text-green-600";
            setTimeout(() => settingsModal.classList.add("hidden"), 1000);
        } catch(e) {
            settingsMessage.textContent = "エラーが発生しました";
            settingsMessage.className = "text-center mt-2 text-sm text-red-600";
        } finally {
            loadingOverlay.classList.add("hidden");
        }
      });

      logoutButtonInModal.addEventListener("click", async () => {
        settingsModal.classList.add("hidden");
        loadingOverlay.classList.remove("hidden");
        try {
          await updateUserStatus('offline');
          await signOut(auth);
        } catch (error) {
          console.error("Logout Error:", error);
        } finally {
          loadingOverlay.classList.add("hidden");
        }
      });


      setNicknameButton.addEventListener("click", async () => {
        const nickname = nicknameInput.value.trim();
        if (nickname.length < 1 || nickname.length > 20) {
          nicknameMessage.textContent = "1〜20文字で入力してください。";
          return;
        }
        loadingOverlay.classList.remove("hidden");
        try {
          const userProfileRef = doc(db, `artifacts/${appId}/servers/${currentServerId}/profiles/${userId}`, "nicknameDoc");
          await setDoc(userProfileRef, { nickname: nickname, createdAt: serverTimestamp() });
          userNickname = nickname;
          
          // ★ヘッダータイトルの更新
          headerTitle.textContent = `${userNickname}${isAdmin ? " (管理者)" : ""}`;
          updateUserPanelUI();
          
          nicknameContainer.classList.add("hidden");
          appContainer.classList.remove("hidden");
          loadRooms();
          startPresenceSystem();
        } catch (error) {
          nicknameMessage.textContent = `エラー: ${error.message}`;
        } finally {
          loadingOverlay.classList.add("hidden");
        }
      });

      // =========================================================================
      // Presence System (Online/Offline Status)
      // =========================================================================
      
      function resetAwayTimer() {
        if (awayTimer) clearTimeout(awayTimer);
        awayTimer = setTimeout(() => {
            updateUserStatus('away');
        }, AWAY_TIMEOUT);
      }

      function stopAwayTimer() {
        if (awayTimer) {
            clearTimeout(awayTimer);
            awayTimer = null;
        }
      }
      
      function startPresenceSystem() {
        updateUserStatus('online');
        resetAwayTimer();
        document.addEventListener("visibilitychange", handleVisibilityChange);
        window.addEventListener("beforeunload", handlePageClose);
        window.addEventListener("pagehide", handlePageClose);  // Safari/iPad対応
        window.addEventListener('focus', handleFocus);
        window.addEventListener('blur', handleBlur);
        subscribeToUserStatus();
        
        if(memberListRefreshInterval) clearInterval(memberListRefreshInterval);
        memberListRefreshInterval = setInterval(() => {
            renderMembersList(cachedUsers);
        }, 60000);
      }

      function stopPresenceSystem() {
        stopAwayTimer();
        if(memberListRefreshInterval) {
            clearInterval(memberListRefreshInterval);
            memberListRefreshInterval = null;
        }
        document.removeEventListener("visibilitychange", handleVisibilityChange);
        window.removeEventListener("beforeunload", handlePageClose);
        window.removeEventListener("pagehide", handlePageClose);
        window.removeEventListener('focus', handleFocus);
        window.removeEventListener('blur', handleBlur);
        if (unsubscribeUserStatus) {
          unsubscribeUserStatus();
          unsubscribeUserStatus = null;
        }
      }
      
      const handleFocus = () => {
        updateUserStatus('online');
        resetAwayTimer();
      };
      const handleBlur = () => {
        updateUserStatus('offline');
        stopAwayTimer();
      };
      const handleVisibilityChange = () => {
        if (document.visibilityState === 'hidden') {
            // hidden時もsendBeaconで確実にオフライン化
            sendOfflineBeacon();
            updateUserStatus('offline');
            stopAwayTimer();
        } else {
            updateUserStatus('online');
            resetAwayTimer();
        }
      };

      // タブ閉じ・ページ離脱時の確実なオフライン化
      // beforeunload (Chrome/Firefox) + pagehide (Safari/iPad) の両方をリスン
      const handlePageClose = (e) => {
        sendOfflineBeacon();
      };

      // navigator.sendBeacon でCloudflare Worker経由で確実にオフライン化
      function sendOfflineBeacon() {
        if (!userId) return;
        const url = 'https://simplechat-api.astro-fray-server.workers.dev/api/setOffline';
        const data = JSON.stringify({ userId, appId, serverId: currentServerId });
        try {
          if (navigator.sendBeacon) {
            navigator.sendBeacon(url, new Blob([data], { type: 'application/json' }));
          } else {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', url, false);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.send(data);
          }
        } catch (e) {
          console.error('sendOfflineBeacon error:', e);
        }
      }

      async function updateUserStatus(state) {
        if (!userId || !userNickname) return;
        
        const statusRef = doc(db, `artifacts/${appId}/servers/${currentServerId}/status`, userId);
        try {
          let updateData = {
            state: state,
            last_changed: serverTimestamp(),
            nickname: userNickname,
            avatarUrl: userAvatarUrl || null,
            currentRoomId: currentRoomId,
          };
          await setDoc(statusRef, updateData, { merge: true });
        } catch (error) {
          console.error("Status update error:", error);
        }
      }

      // Rust側(Tauri)から呼べるようにwindowにエクスポート
      window.blockingUpdateCheck = blockingUpdateCheck;
      window.sendOfflineBeacon = sendOfflineBeacon;
      window.updateUserStatus = updateUserStatus;

      function subscribeToUserStatus() {
        if (unsubscribeUserStatus) unsubscribeUserStatus();
        
        const statusQuery = query(collection(db, `artifacts/${appId}/servers/${currentServerId}/status`));
        unsubscribeUserStatus = onSnapshot(statusQuery, (snapshot) => {
            cachedUsers = [];
            snapshot.forEach((doc) => {
                cachedUsers.push({ id: doc.id, ...doc.data() });
            });
            renderMembersList(cachedUsers);
        }, (error) => {
            console.error("メンバーリストの購読エラー:", error);
            membersList.innerHTML = `<div class="p-4 text-xs text-red-600">メンバーを読み込めません。</div>`;
        });
      }
      
      function renderMembersList(users) {
        if (!membersList) return;
        membersList.innerHTML = "";
        
        const processedUsers = users.map(u => {
            const computedState = u.state || 'offline';
            
            // update own UI status indicator here
            if (u.id === userId) {
                const statusElement = document.getElementById('userPanelStatus');
                if (statusElement) statusElement.className = `status-indicator status-${computedState}`;
            }
            return { ...u, computedState };
        });
        
        const onlineMembers = processedUsers.filter(u => u.computedState === 'online');
        const awayMembers = processedUsers.filter(u => u.computedState === 'away');
        const offlineMembers = processedUsers.filter(u => u.computedState === 'offline');

        onlineMembers.sort((a, b) => (a.nickname || "").localeCompare(b.nickname || ""));
        awayMembers.sort((a, b) => (a.nickname || "").localeCompare(b.nickname || ""));
        offlineMembers.sort((a, b) => (a.nickname || "").localeCompare(b.nickname || ""));

        const createGroup = (title, members) => {
          if (members.length === 0) return;
          
          const titleDiv = document.createElement("div");
          titleDiv.className = "member-group-title";
          titleDiv.textContent = `${title} — ${members.length}`;
          membersList.appendChild(titleDiv);

          members.forEach(member => {
            const item = document.createElement("div");
            item.className = "member-item";

            const avatar = document.createElement("div");
            avatar.className = "avatar-placeholder";
            if (member.avatarUrl) {
                const avatarImg = document.createElement("img");
                avatarImg.src = member.avatarUrl;
                avatarImg.alt = member.nickname || "";
                avatar.appendChild(avatarImg);
            } else {
                avatar.textContent = (member.nickname || " ").charAt(0).toUpperCase();
            }

            const statusDot = document.createElement("div");
            statusDot.className = `status-indicator status-${member.computedState}`;
            avatar.appendChild(statusDot);

            const info = document.createElement("div");
            info.className = "member-info";

            const name = document.createElement("div");
            name.className = "member-name";
            name.textContent = member.nickname || "不明なユーザー";
            info.appendChild(name);

            if (member.computedState === 'away') {
                const statusText = document.createElement("div");
                statusText.className = "member-status-text";
                statusText.textContent = "離席中";
                info.appendChild(statusText);
            } else if (member.computedState === 'offline') {
                const statusText = document.createElement("div");
                statusText.className = "member-status-text";
                statusText.textContent = formatTimeAgo(member.last_changed);
                info.appendChild(statusText);
            }

            item.appendChild(avatar);
            item.appendChild(info);
            membersList.appendChild(item);
          });
        };

        createGroup("Online", onlineMembers);
        createGroup("Away", awayMembers);
        createGroup("Offline", offlineMembers);
      }

      function formatTimeAgo(timestamp) {
        if (!timestamp || !timestamp.toDate) return "";
        const now = new Date();
        const past = timestamp.toDate();
        const diffInSeconds = Math.floor((now - past) / 1000);

        if (diffInSeconds < 60) return `数秒前`;
        const diffInMinutes = Math.floor(diffInSeconds / 60);
        if (diffInMinutes < 60) return `${diffInMinutes}分前`;
        const diffInHours = Math.floor(diffInMinutes / 60);
        if (diffInHours < 24) return `${diffInHours}時間前`;
        const diffInDays = Math.floor(diffInHours / 24);
        return `${diffInDays}日前`;
      }


      // =========================================================================
      // Room Features
      // =========================================================================
      async function loadRooms() {
        const roomsQuery = query(collection(db, `artifacts/${appId}/servers/${currentServerId}/rooms`));
        onSnapshot(roomsQuery, (snapshot) => {
          roomList.innerHTML = "";
          // 既存のリスナーを解除し、現在のルームIDを記録
          const currentRoomIds = new Set();
          snapshot.forEach((doc) => {
            currentRoomIds.add(doc.id);
            const room = doc.data();
            const div = document.createElement("div");
            div.className = "flex items-center justify-between p-3 mb-2 bg-gray-50 hover:bg-gray-200 rounded-lg cursor-pointer";
            div.id = `room-item-${doc.id}`;
            const isRoomJoined = !room.hasPassword || isAdmin || (room.joinedUsers && room.joinedUsers.includes(userId));
            div.addEventListener("click", () => handleRoomSelection(doc.id, room.name, room.hasPassword, isRoomJoined));
            
            const nameDiv = document.createElement("div");
            nameDiv.className = "flex-1 truncate";
            nameDiv.textContent = room.name;
            
            // 未読バッジ
            const badgeSpan = document.createElement("span");
            badgeSpan.className = "unread-badge";
            badgeSpan.id = `unread-badge-${doc.id}`;
            const count = unreadCounts[doc.id] || 0;
            badgeSpan.textContent = count > 99 ? "99+" : count;
            badgeSpan.style.display = (count > 0 && doc.id !== currentRoomId) ? "flex" : "none";
            
            const dropDiv = document.createElement("div");
            dropDiv.className = "dropdown-container";
            const btn = document.createElement("button");
            btn.textContent = "⋮";
            // 当たり判定を大きくするため w-10 h-10 にしつつ、レイアウトが崩れないようネガティブマージンを入れる
            btn.className = "text-gray-700 w-10 h-10 text-lg hover:bg-gray-200 rounded-full flex items-center justify-center -mr-2 -my-2";
            btn.onclick = (e) => {
              e.stopPropagation();
              const content = dropDiv.querySelector(".dropdown-content");
              document.querySelectorAll(".dropdown-content").forEach(d => { if(d!==content) d.style.display="none"; });
              content.style.display = content.style.display === "block" ? "none" : "block";
            };
            const content = document.createElement("div");
            content.className = "dropdown-content";
            const delBtn = document.createElement("button");
            delBtn.textContent = "削除";
            delBtn.onclick = (e) => {
               e.stopPropagation();
               content.style.display = "none";
               handleDeleteRoomClick(doc.id, room.name, !!room.password, room.password);
            };
            content.appendChild(delBtn);
            dropDiv.appendChild(btn);
            dropDiv.appendChild(content);

            div.appendChild(nameDiv);
            div.appendChild(badgeSpan);
            div.appendChild(dropDiv);
            roomList.appendChild(div);
            
            // 未読リスナーを設定
            if (!unreadListeners[doc.id]) {
              setupUnreadListener(doc.id);
            }
          });
          // 削除されたルームのリスナーを解除
          Object.keys(unreadListeners).forEach(rid => {
            if (!currentRoomIds.has(rid)) {
              unreadListeners[rid]();
              delete unreadListeners[rid];
              delete unreadCounts[rid];
            }
          });
        });

        document.addEventListener("click", (e) => {
            if(!e.target.closest(".dropdown-container")) {
                document.querySelectorAll(".dropdown-content").forEach(d => d.style.display="none");
            }
        });
      }

      function setupUnreadListener(roomId) {
        const q = query(
          collection(db, `artifacts/${appId}/servers/${currentServerId}/rooms/${roomId}/messages`),
          orderBy("timestamp", "desc"),
          limit(1)
        );
        let isFirst = true;
        unreadListeners[roomId] = onSnapshot(q, (snapshot) => {
          if (isFirst) { isFirst = false; return; } // 初回は無視
          snapshot.docChanges().forEach(change => {
            if (change.type === "added") {
              const msgData = change.doc.data();
              if (roomId !== currentRoomId && msgData.senderId !== userId) {
                unreadCounts[roomId] = (unreadCounts[roomId] || 0) + 1;
                updateUnreadBadge(roomId);
              }
            }
          });
        });
      }

      function updateUnreadBadge(roomId) {
        const badge = document.getElementById(`unread-badge-${roomId}`);
        if (!badge) return;
        const count = unreadCounts[roomId] || 0;
        badge.textContent = count > 99 ? "99+" : count;
        badge.style.display = (count > 0 && roomId !== currentRoomId) ? "flex" : "none";
      }

      function subscribeToMessages() {
          if(unsubscribeMessages) unsubscribeMessages();
          
          const oldScrollHeight = messagesDisplay.scrollHeight;
          // 最新のメッセージから limit 件取得するために desc を使用
          const q = query(collection(db, `artifacts/${appId}/servers/${currentServerId}/rooms/${currentRoomId}/messages`), orderBy("timestamp", "desc"), limit(messageLimit));
          
          unsubscribeMessages = onSnapshot(q, (snapshot) => {
              snapshot.docChanges().forEach(change => {
                  if(change.type === "added" && !isInitialMessageLoad && !isScrollingUpLoad) {
                      const msgData = change.doc.data();
                      if(msgData.senderId !== userId) {
                          const isMentioned = msgData.text && msgData.text.includes(`@${userNickname}`);
                          if (!document.hasFocus() || isMentioned) {
                              showNotification("チャット通知", `${msgData.senderNickname}: ${msgData.text || "画像・ファイルを送信しました"}`, currentRoomId);
                          }
                      }
                  }
              });

              messagesDisplay.innerHTML = "";
              const newMessages = [];
              snapshot.forEach(doc => {
                  const d = doc.data(); d.id = doc.id;
                  newMessages.push(d);
              });
              // 取得したリスト（新しい順）を反転させて、古い順（通常表示）にする
              lastMessagesData = newMessages.reverse();
              
              messagesIndexMap = {};
              lastMessagesData.forEach((m, i) => messagesIndexMap[m.id] = i);
              
              renderPinnedMessages();
              renderMessagesWithReadReceipts();
              
              if (isInitialMessageLoad) {
                  messagesDisplay.scrollTop = messagesDisplay.scrollHeight;
                  isInitialMessageLoad = false;
              } else if (isScrollingUpLoad) {
                  // スクロールで過去を読み込んだ場合、位置をキープする
                  messagesDisplay.scrollTop = messagesDisplay.scrollHeight - oldScrollHeight;
                  isScrollingUpLoad = false;
              }
              updateReadReceiptForCurrentUser();
          });
      }

      function selectRoom(roomId, roomName) {
        // スマホの場合、同じルームをタップしてもチャット画面に遷移（サイドバーを隠す）させる
        if (window.innerWidth < 768 && currentRoomId === roomId) {
          sidebar.classList.add("mobile-hidden");
          currentRoomHeader.classList.remove("hidden");
          return;
        }
        
        if(currentRoomId === roomId) return;
        currentRoomId = roomId;
        updateUserStatus('online'); // Sync room selection for notifications
        currentRoomTitleText.textContent = roomName;
        currentRoomHeader.classList.remove("hidden");
        messagesDisplay.innerHTML = "";
        lastMessagesData = [];
        messageInput.disabled = false;
        fileAttachButton.disabled = false;
        mentionButton.disabled = false;
        messageLimit = 20; // ルームに入り直したらリミットをリセット
        clearAttachedFile();
        cancelReply();
        
        // 未読バッジをクリア
        unreadCounts[roomId] = 0;
        updateUnreadBadge(roomId);

        // スマホ: サイドバーを隠してチャットを表示
        if (window.innerWidth < 768) {
          sidebar.classList.add("mobile-hidden");
        }
        
        if(readReceiptsUnsubscribe) readReceiptsUnsubscribe();

        isInitialMessageLoad = true;
        isScrollingUpLoad = false;
        
        subscribeToMessages();

        const rrRef = collection(db, `artifacts/${appId}/servers/${currentServerId}/rooms/${currentRoomId}/readReceipts`);
        readReceiptsUnsubscribe = onSnapshot(rrRef, (snap) => {
            roomReadReceipts = {};
            snap.forEach(d => roomReadReceipts[d.id] = d.data());
            renderMessagesWithReadReceipts();
        });
        
        membersSidebar.classList.remove("hidden");
      }

      // スクロールを検知して過去のメッセージを読み込むリスナー
      messagesDisplay.addEventListener("scroll", () => {
          if (messagesDisplay.scrollTop === 0 && lastMessagesData.length >= messageLimit) {
              messageLimit += 20;
              isScrollingUpLoad = true;
              subscribeToMessages();
          }
      });

      promptCreateRoomButton.addEventListener("click", () => {
         document.getElementById("modalNewRoomNameInput").value = "";
         newRoomPasswordInput.value = "";
         createRoomPasswordModal.classList.remove("hidden");
      });
      confirmCreateRoomButton.addEventListener("click", async () => {
         const name = document.getElementById("modalNewRoomNameInput").value.trim();
         const pass = newRoomPasswordInput.value.trim();
         if(!name) return;
         loadingOverlay.classList.remove("hidden");
         createRoomPasswordModal.classList.add("hidden");
         try {
             const data = { name, createdAt: serverTimestamp(), createdBy: userId, createdByNickname: userNickname };
             
             let roomRef;
             if(pass) {
                 data.hasPassword = true;
                 data.joinedUsers = [userId]; // Creator is automatically joined
                 roomRef = await addDoc(collection(db, `artifacts/${appId}/servers/${currentServerId}/rooms`), data);
                 // 秘密のサブコレクションにパスワードを保存
                 await setDoc(doc(db, `artifacts/${appId}/servers/${currentServerId}/rooms/${roomRef.id}/secrets`, "password"), { password: pass });
             } else {
                 roomRef = await addDoc(collection(db, `artifacts/${appId}/servers/${currentServerId}/rooms`), data);
             }
             alertMessage("ルームを作成しました", "success");
         } catch(e) { console.error(e); }
         finally { loadingOverlay.classList.add("hidden"); }
      });
      cancelCreateRoomButton.addEventListener("click", () => createRoomPasswordModal.classList.add("hidden"));

      function handleRoomSelection(id, name, hasPass, isRoomJoined) {
          if(hasPass && !isRoomJoined) {
              pendingRoomJoin = { roomId: id, roomName: name };
              joinRoomPasswordInput.value = "";
              joinRoomTitle.textContent = `${name}に参加`;
              joinRoomPasswordModal.classList.remove("hidden");
              joinRoomPasswordMessage.textContent = "";
          } else {
              selectRoom(id, name);
          }
      }

      confirmJoinRoomButton.addEventListener("click", async () => {
          const pass = joinRoomPasswordInput.value.trim();
          if(!pass) return;
          
          joinRoomPasswordMessage.textContent = "確認中...";
          try {
              // サーバーにパスワード確認を依頼
              const response = await fetch("https://simplechat-api.astro-fray-server.workers.dev/api/joinServer", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                      roomId: pendingRoomJoin.roomId,
                      password: pass,
                      userId: userId,
                      appId: appId
                  })
              });
              
              const result = await response.json();
              
              if(response.ok && result.success) {
                  selectRoom(pendingRoomJoin.roomId, pendingRoomJoin.roomName);
                  joinRoomPasswordModal.classList.add("hidden");
              } else {
                  joinRoomPasswordMessage.textContent = "パスワードが違います";
              }
          } catch(e) {
              console.error(e);
              joinRoomPasswordMessage.textContent = "エラーが発生しました";
          }
      });
      cancelJoinRoomButton.addEventListener("click", () => joinRoomPasswordModal.classList.add("hidden"));

      function handleDeleteRoomClick(id, name) {
          pendingRoomDelete = { roomId: id, roomName: name };
          deleteRoomConfirmModal.classList.remove("hidden");
          roomToDeleteNameSpan.textContent = name;
      }
      confirmDeleteButton.addEventListener("click", async () => {
          deleteRoomConfirmModal.classList.add("hidden");
          await deleteRoomAndMessages(pendingRoomDelete.roomId);
      });
      cancelDeleteButton.addEventListener("click", () => deleteRoomConfirmModal.classList.add("hidden"));

      async function deleteRoomAndMessages(roomId) {
        if (currentRoomId === roomId) {
          currentRoomId = null;
          updateUserStatus('online');
          currentRoomHeader.classList.add("hidden");
          messagesDisplay.innerHTML = "";
          messageInput.disabled = true;
          if (unsubscribeMessages) unsubscribeMessages();
          if (readReceiptsUnsubscribe) readReceiptsUnsubscribe();
        }

        try {
          const batch = writeBatch(db);

          // 1. messages サブコレクションの全削除
          const messagesRef = collection(db, `artifacts/${appId}/servers/${currentServerId}/rooms/${roomId}/messages`);
          const messagesSnap = await getDocs(messagesRef);
          messagesSnap.forEach((docSnap) => {
            batch.delete(docSnap.ref);
          });

          // 2. readReceipts サブコレクションの全削除
          const readReceiptsRef = collection(db, `artifacts/${appId}/servers/${currentServerId}/rooms/${roomId}/readReceipts`);
          const readReceiptsSnap = await getDocs(readReceiptsRef);
          readReceiptsSnap.forEach((docSnap) => {
            batch.delete(docSnap.ref);
          });

          // 3. ルーム本体の削除
          const roomRef = doc(db, `artifacts/${appId}/servers/${currentServerId}/rooms`, roomId);
          batch.delete(roomRef);

          await batch.commit();
          console.log(`Successfully deleted room document and all its subcollections for ${roomId}.`);
        } catch (error) {
          console.error("Error during room deletion process:", error);
          throw error;
        }
      }
      const executeDeleteRoom = async () => {
        if (!pendingRoomDelete) return;
        loadingOverlay.classList.remove("hidden");
        try {
          await deleteRoomAndMessages(pendingRoomDelete.roomId);
          alertMessage(`ルーム「${pendingRoomDelete.roomName}」を削除しました。`, "success");
        } catch (error) {
          alertMessage("ルームの削除に失敗しました。", "error");
        } finally {
          loadingOverlay.classList.add("hidden");
          pendingRoomDelete = null;
        }
      };
      
      async function sendMessage() {
          const text = messageInput.value.trim();
          if((!text && !attachedFile) || !currentRoomId) return;
          
          loadingOverlay.classList.remove("hidden");
          try {
              const data = { text, senderId: userId, senderNickname: userNickname, timestamp: serverTimestamp() };
              if(attachedFile) {
                  Object.assign(data, { fileData: attachedFile.data, fileName: attachedFile.name, fileType: attachedFile.type, fileSize: attachedFile.size });
              }
              if(replyingToMessage) {
                  data.replyTo = { messageId: replyingToMessage.id, senderNickname: replyingToMessage.senderNickname, text: replyingToMessage.text || "（ファイル）" };
              }
              await addDoc(collection(db, `artifacts/${appId}/servers/${currentServerId}/rooms/${currentRoomId}/messages`), data);

              // 通知を送信
              try {
                  const roomDoc = await getDoc(doc(db, `artifacts/${appId}/servers/${currentServerId}/rooms`, currentRoomId));
                  let receiverIds = [];
                  if (roomDoc.exists()) {
                      const roomData = roomDoc.data();
                      if (roomData.hasPassword && roomData.joinedUsers) {
                          receiverIds = roomData.joinedUsers;
                      } else {
                          // 全てのユーザーを取得
                          const allUsersSnap = await getDocs(collection(db, `artifacts/${appId}/users`));
                          receiverIds = allUsersSnap.docs.map(d => d.id);
                      }
                  }
                  
                  if (receiverIds.length > 0) {
                      fetch("https://simplechat-api.astro-fray-server.workers.dev/api/sendNotification", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                              receiverIds: receiverIds,
                              title: `${roomDoc.data()?.name || 'Room'}`,
                              body: `${userNickname}: ${text || (attachedFile ? '（ファイル）' : '')}`,
                              roomId: currentRoomId,
                              appId: appId,
                              senderId: userId
                          })
                      }).catch(e => console.error("Notification trigger error:", e));
                  }
              } catch (notifyErr) {
                  console.error("Failed to trigger notification:", notifyErr);
              }

              messageInput.value = ""; messageInput.style.height="auto";
              clearAttachedFile(); cancelReply();
              
              // ★ メッセージ送信時にオンラインにし、タイマーをリセット
              updateUserStatus('online');
              resetAwayTimer();

          } catch(e) { 
              console.error(e);
              alertMessage("送信に失敗しました", "error");
          } finally {
              loadingOverlay.classList.add("hidden");
          }
      }
      messageInput.addEventListener("keydown", (e) => {
          if(e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
      });
      messageInput.addEventListener("input", () => {
          messageInput.style.height = "auto";
          messageInput.style.height = messageInput.scrollHeight + "px";
      });
      
      messageInput.addEventListener("paste", (e) => {
          const items = (e.clipboardData || e.originalEvent.clipboardData).items;
          for(let i=0; i<items.length; i++) {
              if(items[i].kind === 'file') {
                  const f = items[i].getAsFile();
                  if(f.size > 1024*1024) { alertMessage("ファイルは1MBまでです", "error"); return; }
                  const reader = new FileReader();
                  reader.onload = (ev) => {
                      attachedFile = { data: ev.target.result, name: f.name, type: f.type, size: f.size };
                      updateFilePreview();
                  };
                  reader.readAsDataURL(f);
                  e.preventDefault();
                  return;
              }
          }
      });
      function updateFilePreview() {
        if(attachedFile) {
          filePreviewName.textContent = `${attachedFile.name} (${(attachedFile.size / 1024).toFixed(2)} KB)`;
          filePreviewContainer.classList.remove("hidden");
        } else {
          filePreviewContainer.classList.add("hidden");
        }
      }
      clearFileButton.addEventListener("click", clearAttachedFile);
      function clearAttachedFile() { attachedFile = null; updateFilePreview(); }

      // --- ファイル添付ボタン ---
      const fileAttachButton = document.getElementById("fileAttachButton");
      const fileAttachInput = document.getElementById("fileAttachInput");
      fileAttachButton.disabled = true;
      fileAttachButton.addEventListener("click", () => {
          if (!currentRoomId) return;
          fileAttachInput.click();
      });
      fileAttachInput.addEventListener("change", (e) => {
          const f = e.target.files[0];
          if (!f) return;
          if (f.size > 1024 * 1024) { alertMessage("ファイルは1MBまでです", "error"); return; }
          const reader = new FileReader();
          reader.onload = (ev) => {
              attachedFile = { data: ev.target.result, name: f.name, type: f.type, size: f.size };
              updateFilePreview();
          };
          reader.readAsDataURL(f);
          fileAttachInput.value = "";
      });

      // --- ドラッグ＆ドロップ ---
      const dropOverlay = document.getElementById("dropOverlay");
      const messageInputArea = document.getElementById("messageInputArea");
      let dragCounter = 0;
      messageInputArea.addEventListener("dragenter", (e) => {
          e.preventDefault(); dragCounter++;
          dropOverlay.classList.add("active");
      });
      messageInputArea.addEventListener("dragleave", (e) => {
          e.preventDefault(); dragCounter--;
          if (dragCounter <= 0) { dragCounter = 0; dropOverlay.classList.remove("active"); }
      });
      messageInputArea.addEventListener("dragover", (e) => e.preventDefault());
      messageInputArea.addEventListener("drop", (e) => {
          e.preventDefault(); dragCounter = 0;
          dropOverlay.classList.remove("active");
          const f = e.dataTransfer.files[0];
          if (!f) return;
          if (f.size > 1024 * 1024) { alertMessage("ファイルは1MBまでです", "error"); return; }
          const reader = new FileReader();
          reader.onload = (ev) => {
              attachedFile = { data: ev.target.result, name: f.name, type: f.type, size: f.size };
              updateFilePreview();
          };
          reader.readAsDataURL(f);
      });

      // --- メンションボタン ---
      const mentionButton = document.getElementById("mentionButton");
      const mentionPopup = document.getElementById("mentionPopup");
      mentionButton.disabled = true;
      mentionButton.addEventListener("click", () => {
          if (!currentRoomId) return;
          if (!mentionPopup.classList.contains("hidden")) {
              mentionPopup.classList.add("hidden"); return;
          }
          mentionPopup.innerHTML = "";
          const users = cachedUsers.filter(u => u.id !== userId);
          if (users.length === 0) {
              mentionPopup.innerHTML = '<div class="p-2 text-sm text-gray-500">ユーザーがいません</div>';
          } else {
              users.forEach(u => {
                  const opt = document.createElement("div");
                  opt.className = "mention-option";
                  opt.textContent = u.nickname || "不明";
                  opt.addEventListener("click", () => {
                      const pos = messageInput.selectionStart || messageInput.value.length;
                      const before = messageInput.value.substring(0, pos);
                      const after = messageInput.value.substring(pos);
                      const prefix = (before.length > 0 && !before.endsWith(" ") && !before.endsWith("\n")) ? " " : "";
                      messageInput.value = before + prefix + "@" + u.nickname + " " + after;
                      mentionPopup.classList.add("hidden");
                      messageInput.focus();
                  });
                  mentionPopup.appendChild(opt);
              });
          }
          mentionPopup.classList.remove("hidden");
      });
      document.addEventListener("click", (e) => {
          if (!mentionPopup.contains(e.target) && e.target !== mentionButton && !mentionButton.contains(e.target)) {
              mentionPopup.classList.add("hidden");
          }
      });

      function escapeHtmlAndLinkUrls(text) {
        if (!text) return "";
        let escapedText = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        escapedText = escapedText.replace(urlRegex, `<a href="$1" target="_blank" rel="noopener noreferrer" style="color: black; text-decoration: underline;">$1</a>`);
        // メンションの置換 (@ユーザー名)
        const mentionRegex = /@([^\s]+)/g;
        escapedText = escapedText.replace(mentionRegex, (match, p1) => {
            return `<span class="mention-text">@${p1}</span>`;
        });
        return escapedText;
      }
      
      function displayMessage(message, messageId, readByCount = 0) {
        const isMyMessage = message.senderId === userId;
        const messageRow = document.createElement("div");
        messageRow.className = "message-row w-full flex " + (isMyMessage ? "justify-end" : "justify-start");
        const messageElement = document.createElement("div");
        messageElement.className = `message-bubble ${isMyMessage ? "my-message" : "other-message"} flex flex-col`;
        messageElement.dataset.messageId = messageId;
        const senderNicknameSpan = document.createElement("span");
        senderNicknameSpan.className = `text-xs text-gray-600 mb-1 ${isMyMessage ? "text-right" : "text-left"}`;
        senderNicknameSpan.textContent = message.senderNickname || "不明なユーザー";
        messageElement.appendChild(senderNicknameSpan);
        if (message.replyTo && message.replyTo.messageId) {
          const replyQuoteDiv = document.createElement("div");
          replyQuoteDiv.className = "reply-quote";
          replyQuoteDiv.dataset.replyToId = message.replyTo.messageId;
          const replyNicknameSpan = document.createElement("div");
          replyNicknameSpan.className = "reply-quote-nickname";
          replyNicknameSpan.textContent = `返信先: ${message.replyTo.senderNickname || "不明"}`;
          const replyTextSpan = document.createElement("div");
          replyTextSpan.className = "reply-quote-text";
          replyTextSpan.textContent = message.replyTo.text || "（ファイル）";
          replyQuoteDiv.appendChild(replyNicknameSpan);
          replyQuoteDiv.appendChild(replyTextSpan);
          messageElement.appendChild(replyQuoteDiv);
        }
        if (message.text) {
          const messageTextSpan = document.createElement("span");
          messageTextSpan.className = `message-content text-gray-900 ${isMyMessage ? "text-right" : "text-left"}`;
          messageTextSpan.innerHTML = escapeHtmlAndLinkUrls(message.text);
          // 自分がメンションされていたらハイライト
          if (message.text.includes(`@${userNickname}`)) {
              messageElement.classList.add("mention-highlight");
          }
          messageElement.appendChild(messageTextSpan);
        }
        if (message.fileData && message.fileName) {
          if (message.fileType && message.fileType.startsWith('image/')) {
              const img = document.createElement('img');
              img.src = message.fileData;
              img.className = 'mt-2 rounded-lg max-w-full h-auto cursor-pointer object-contain';
              img.style.maxHeight = '250px';
              img.addEventListener("click", () => downloadFile(message.fileData, message.fileName, message.fileType));
              messageElement.appendChild(img);
          } else if (message.fileType && message.fileType.startsWith('video/')) {
              const video = document.createElement('video');
              video.src = message.fileData;
              video.controls = true;
              video.className = 'mt-2 rounded-lg max-w-full h-auto';
              video.style.maxHeight = '250px';
              messageElement.appendChild(video);
          } else {
              const fileAttachmentDiv = document.createElement("div");
              fileAttachmentDiv.className = `mt-2 p-2 rounded-lg border border-gray-300 ${isMyMessage ? "bg-gray-200" : "bg-gray-100"} flex items-center space-x-2 cursor-pointer`;
              fileAttachmentDiv.style.color = "#333";
              fileAttachmentDiv.innerHTML = `<span class="flex-1 text-sm font-semibold truncate">${message.fileName}</span><span>▼</span>`;
              fileAttachmentDiv.addEventListener("click", () => downloadFile(message.fileData, message.fileName, message.fileType));
              messageElement.appendChild(fileAttachmentDiv);
          }
        }
        const timestampSpan = document.createElement("span");
        timestampSpan.className = `text-xs text-gray-500 mt-1 ${isMyMessage ? "text-right" : "text-left"}`;
        if (message.timestamp && message.timestamp.toDate) {
          const date = message.timestamp.toDate();
          timestampSpan.textContent = `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
        } else {
          timestampSpan.textContent = "送信中...";
        }
        messageElement.appendChild(timestampSpan);
        if (isMyMessage) {
          const readSpan = document.createElement("span");
          readSpan.className = "read-receipt";
          if (readByCount > 0) {
            readSpan.textContent = `既読${readByCount > 1 ? `（${readByCount}）` : ""}`;
          } else {
            readSpan.style.display = "none";
          }
          messageElement.appendChild(readSpan);
        }
        messageRow.appendChild(messageElement);
        messagesDisplay.appendChild(messageRow);
      }

      function renderMessagesWithReadReceipts() {
        const isScrolledToBottom = messagesDisplay.scrollHeight - messagesDisplay.clientHeight <= messagesDisplay.scrollTop + 1;
        messagesDisplay.innerHTML = "";
        
        const filteredMessages = lastMessagesData.filter(msg => {
            if (!searchQuery) return true;
            return (msg.text && msg.text.toLowerCase().includes(searchQuery)) || 
                   (msg.senderNickname && msg.senderNickname.toLowerCase().includes(searchQuery));
        });

        filteredMessages.forEach((msg) => {
          const idx = messagesIndexMap[msg.id];
          const readCount = computeReadByCount(msg, idx);
          displayMessage(msg, msg.id, readCount);
        });
        
        // 検索中でなければ、一番下までスクロールを維持
        if (isScrolledToBottom && !searchQuery) {
          messagesDisplay.scrollTop = messagesDisplay.scrollHeight;
        }
      }

      function computeReadByCount(message, msgIndex) {
        let count = 0;
        Object.entries(roomReadReceipts).forEach(([rid, receipt]) => {
          if (!rid || rid === message.senderId) return;
          if (receipt.lastReadMessageId && messagesIndexMap[receipt.lastReadMessageId] >= msgIndex) count++;
          else if (receipt.lastReadAt && message.timestamp && receipt.lastReadAt.toMillis() >= message.timestamp.toMillis()) count++;
        });
        return count;
      }

      async function updateReadReceiptForCurrentUser() {
        if (!currentRoomId || !userId) return;
        // バックグラウンド・最小化・非フォーカス時は既読にしない
        if (document.visibilityState === 'hidden' || !document.hasFocus()) return;
        try {
          const lastMsgId = lastMessagesData.length ? lastMessagesData[lastMessagesData.length - 1].id : null;
          const myReceiptRef = doc(db, `artifacts/${appId}/servers/${currentServerId}/rooms/${currentRoomId}/readReceipts`, userId);
          await setDoc(myReceiptRef, { lastReadAt: serverTimestamp(), lastReadMessageId: lastMsgId }, { merge: true });
        } catch (error) {}
      }
      
      document.addEventListener("visibilitychange", () => { if (!document.hidden && document.hasFocus()) updateReadReceiptForCurrentUser(); });
      window.addEventListener("focus", () => { if (!document.hidden) updateReadReceiptForCurrentUser(); });

      let longPressTimer;
      messagesDisplay.addEventListener("touchstart", (e) => {
          const bubble = e.target.closest(".message-bubble");
          if (!bubble) return;
          const touch = e.touches[0];
          const clientX = touch.clientX;
          const clientY = touch.clientY;
          
          longPressTimer = setTimeout(() => {
              showContextMenu(bubble, clientX, clientY);
              // 長押し時にテキスト選択を解除して、選択UIが邪魔しないようにする
              if (window.getSelection) {
                  window.getSelection().removeAllRanges();
              }
          }, 600);
      }, { passive: true });

      messagesDisplay.addEventListener("touchend", () => clearTimeout(longPressTimer));
      messagesDisplay.addEventListener("touchmove", () => clearTimeout(longPressTimer));
      messagesDisplay.addEventListener("touchcancel", () => clearTimeout(longPressTimer));

      function showContextMenu(bubble, clientX, clientY) {
          const msgData = lastMessagesData.find(m => m.id === bubble.dataset.messageId);
          if(!msgData) return;
          selectedMessageForContext = msgData;
          
          messageContextMenu.classList.remove("hidden");
          
          let menuWidth = messageContextMenu.offsetWidth;
          let menuHeight = messageContextMenu.offsetHeight;
          
          let left = clientX;
          let top = clientY;
          
          // 画面外に見切れないように位置を調整
          if (left + menuWidth > window.innerWidth) {
              left = window.innerWidth - menuWidth - 5;
          }
          if (top + menuHeight > window.innerHeight) {
              top = window.innerHeight - menuHeight - 5;
          }
          
          messageContextMenu.style.left = `${left}px`;
          messageContextMenu.style.top = `${top}px`;
      }

      messagesDisplay.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          const bubble = e.target.closest(".message-bubble");
          if(bubble) {
              showContextMenu(bubble, e.clientX, e.clientY);
          } else {
              messageContextMenu.classList.add("hidden");
          }
      });
      document.addEventListener("click", (e) => { if(!messageContextMenu.contains(e.target)) messageContextMenu.classList.add("hidden"); });
      
      copyMessageButton.addEventListener("click", () => {
          if(selectedMessageForContext && selectedMessageForContext.text) {
              navigator.clipboard.writeText(selectedMessageForContext.text);
              alertMessage("コピーしました", "success");
          }
          messageContextMenu.classList.add("hidden");
      });
      deleteMessageButton.addEventListener("click", async () => {
          if(selectedMessageForContext && (selectedMessageForContext.senderId === userId || isAdmin)) {
              await deleteDoc(doc(db, `artifacts/${appId}/servers/${currentServerId}/rooms/${currentRoomId}/messages`, selectedMessageForContext.id));
              alertMessage("削除しました", "success");
          } else {
              alertMessage("権限がありません", "warning");
          }
          messageContextMenu.classList.add("hidden");
      });

      messagesDisplay.addEventListener("dblclick", (e) => {
          const bubble = e.target.closest(".message-bubble");
          if(bubble) {
              const m = lastMessagesData.find(msg => msg.id === bubble.dataset.messageId);
              if(m) {
                  replyingToMessage = m;
                  replyingToNickname.textContent = m.senderNickname;
                  replyingToText.textContent = m.text || (m.fileName ? "ファイル" : "...");
                  replyingToContainer.classList.remove("hidden");
                  messageInput.focus();
              }
          }
      });
      cancelReplyButton.addEventListener("click", cancelReply);
      function cancelReply() { replyingToMessage=null; replyingToContainer.classList.add("hidden"); }
      messagesDisplay.addEventListener("click", (e) => {
        const q = e.target.closest(".reply-quote");
        if(q) {
            const el = messagesDisplay.querySelector(`.message-bubble[data-message-id="${q.dataset.replyToId}"]`);
            if(el) {
                el.scrollIntoView({behavior:"smooth", block:"center"});
                el.classList.add("message-highlight");
                setTimeout(()=>el.classList.remove("message-highlight"), 1200);
            }
        }
      });
      
      function downloadFile(base64Data, fileName, mimeType) {
        try {
          const parts = base64Data.split(';base64,');
          const byteCharacters = atob(parts[1]);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const blob = new Blob([byteArray], {type: mimeType});
          const link = document.createElement('a');
          link.href = URL.createObjectURL(blob);
          link.download = fileName;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        } catch(e) { console.error(e); }
      }

      function alertMessage(msg, type="info") {
          const box = document.createElement("div");
          let colorClass = "bg-gray-800 text-white";
          if (type === "error") colorClass = "bg-red-600 text-white";
          else if (type === "success") colorClass = "bg-gray-200 text-gray-800 border border-gray-300";
          
          box.className = `fixed bottom-4 right-4 p-4 rounded-lg shadow-lg z-50 ${colorClass}`;
          box.textContent = msg;
          document.body.appendChild(box);
          setTimeout(()=>box.remove(), 3000);
      }


      // --- 検索機能 ---
      toggleSearchButton.addEventListener("click", () => {
          searchContainer.classList.toggle("hidden");
          if (!searchContainer.classList.contains("hidden")) {
            searchInput.focus();
            // 検索開始時は全メッセージを読み込む
            messageLimit = 9999;
            subscribeToMessages();
          } else {
            searchQuery = ""; searchInput.value = "";
            // 検索終了時は通常の20件に戻す
            messageLimit = 20;
            subscribeToMessages();
          }
      });
      closeSearchBtn.addEventListener("click", () => {
          searchContainer.classList.add("hidden");
          searchQuery = ""; searchInput.value = "";
          // 通常の20件に戻す
          messageLimit = 20;
          subscribeToMessages();
      });
      searchInput.addEventListener("input", (e) => {
          searchQuery = e.target.value.toLowerCase();
          renderMessagesWithReadReceipts();
      });

      // --- スマホ用戻るボタン ---
      mobileBackButton.addEventListener("click", () => {
          sidebar.classList.remove("mobile-hidden");
          currentRoomHeader.classList.add("hidden");
          
          // ルーム退出処理（開いている判定を解除する）
          currentRoomId = null;
          if (unsubscribeMessages) { unsubscribeMessages(); unsubscribeMessages = null; }
          if (readReceiptsUnsubscribe) { readReceiptsUnsubscribe(); readReceiptsUnsubscribe = null; }
          messagesDisplay.innerHTML = "";
          lastMessagesData = [];
          messageInput.disabled = true;
          fileAttachButton.disabled = true;
          mentionButton.disabled = true;
          clearAttachedFile();
          cancelReply();
      });

      // --- スマホ用メンバー一覧（ボトムシート） ---
      function openBottomSheet() {
          if (window.innerWidth >= 768) return; // PCでは何もしない
          bottomSheetOverlay.classList.add("show");
          membersSidebar.classList.add("bottom-sheet-open");
          membersSidebar.style.transform = ""; // JSのインラインスタイルをリセット
      }
      
      function closeBottomSheet() {
          bottomSheetOverlay.classList.remove("show");
          membersSidebar.classList.remove("bottom-sheet-open");
          membersSidebar.style.transform = "";
      }

      currentRoomTitleText.addEventListener("click", openBottomSheet);
      bottomSheetOverlay.addEventListener("click", closeBottomSheet);

      // スワイプダウンで閉じる処理
      let touchStartY = 0;
      let touchCurrentY = 0;
      let isDraggingSheet = false;

      membersSidebar.addEventListener("touchstart", (e) => {
          if (window.innerWidth >= 768) return;
          // メンバーリストが一番上にある時だけスワイプを検知
          if (membersList.scrollTop === 0) {
              touchStartY = e.touches[0].clientY;
              isDraggingSheet = true;
              membersSidebar.style.transition = "none"; // ドラッグ中はアニメーションを切る
          }
      }, { passive: true });

      membersSidebar.addEventListener("touchmove", (e) => {
          if (!isDraggingSheet) return;
          touchCurrentY = e.touches[0].clientY;
          const deltaY = touchCurrentY - touchStartY;
          if (deltaY > 0) {
              // 下に引っ張っている時
              membersSidebar.style.transform = `translateY(${deltaY}px)`;
          }
      }, { passive: true });

      membersSidebar.addEventListener("touchend", () => {
          if (!isDraggingSheet) return;
          isDraggingSheet = false;
          membersSidebar.style.transition = "transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)";
          
          const deltaY = touchCurrentY - touchStartY;
          if (deltaY > 100) {
              // 100px以上下にスワイプしたら閉じる
              closeBottomSheet();
          } else {
              // 元に戻す
              membersSidebar.style.transform = "translateY(0)";
          }
          touchStartY = 0;
          touchCurrentY = 0;
      });

      // --- ピン留め機能 ---
      pinMessageButton.addEventListener("click", async () => {
          if(selectedMessageForContext) {
              const msgRef = doc(db, `artifacts/${appId}/servers/${currentServerId}/rooms/${currentRoomId}/messages`, selectedMessageForContext.id);
              const isPinned = !selectedMessageForContext.isPinned;
              await updateDoc(msgRef, { isPinned: isPinned }, { merge: true });
              alertMessage(isPinned ? "ピン留めしました" : "ピン留めを解除しました", "success");
          }
          messageContextMenu.classList.add("hidden");
      });

      function renderPinnedMessages() {
          const pinnedMessages = lastMessagesData.filter(m => m.isPinned);
          if (pinnedMessages.length > 0) {
              pinnedMessagesArea.innerHTML = '<div class="text-xs font-bold text-gray-500 mb-1"><i class="fas fa-thumbtack mr-1"></i>ピン留めされたメッセージ</div>';
              pinnedMessages.forEach(msg => {
                  const div = document.createElement("div");
                  div.className = "pinned-message-item truncate";
                  div.innerHTML = `<span class="font-bold mr-2 text-gray-800">${msg.senderNickname}:</span><span class="text-gray-600">${msg.text || (msg.fileType?.startsWith('image') ? "画像" : "ファイル")}</span>`;
                  div.addEventListener("click", () => {
                      const el = messagesDisplay.querySelector(`.message-bubble[data-message-id="${msg.id}"]`);
                      if(el) {
                          el.scrollIntoView({behavior:"smooth", block:"center"});
                          el.classList.add("message-highlight");
                          setTimeout(()=>el.classList.remove("message-highlight"), 1200);
                      }
                  });
                  pinnedMessagesArea.appendChild(div);
              });
              pinnedMessagesArea.classList.remove("hidden");
          } else {
              pinnedMessagesArea.classList.add("hidden");
          }
      }

      // =========================================================================
      // Keyboard Shortcuts (Enter for Confirm, Shift for Cancel) - ★追加
      // =========================================================================
      document.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          if (
            !authContainer.classList.contains("hidden") &&
            (document.activeElement === emailInput || document.activeElement === passwordInput)
          ) {
            e.preventDefault(); authButton.click();
          } else if (
            !nicknameContainer.classList.contains("hidden") && document.activeElement === nicknameInput
          ) {
            e.preventDefault(); setNicknameButton.click();
          } else if (
            !createRoomPasswordModal.classList.contains("hidden") &&
            (document.activeElement === document.getElementById("modalNewRoomNameInput") || document.activeElement === newRoomPasswordInput)
          ) {
            e.preventDefault(); confirmCreateRoomButton.click();
          } else if (
            !joinRoomPasswordModal.classList.contains("hidden") && document.activeElement === joinRoomPasswordInput
          ) {
            e.preventDefault(); confirmJoinRoomButton.click();
          } else if (!deleteRoomConfirmModal.classList.contains("hidden")) {
            e.preventDefault(); confirmDeleteButton.click();
          } else if (
            !deleteRoomPasswordModal.classList.contains("hidden") && document.activeElement === deleteRoomPasswordInput
          ) {
            e.preventDefault(); confirmDeletePasswordButton.click();
          } else if(
            !settingsModal.classList.contains("hidden") && document.activeElement === settingsNicknameInput
          ) {
            e.preventDefault(); saveSettingsButton.click();
          }
        }

        if (e.key === "Shift") {
          if (!createRoomPasswordModal.classList.contains("hidden")) {
            cancelCreateRoomButton.click();
          } else if (!joinRoomPasswordModal.classList.contains("hidden")) {
            cancelJoinRoomButton.click();
          } else if (!deleteRoomConfirmModal.classList.contains("hidden")) {
            cancelDeleteButton.click();
          } else if (!deleteRoomPasswordModal.classList.contains("hidden")) {
            cancelDeletePasswordButton.click();
          } else if (!settingsModal.classList.contains("hidden")) {
            closeSettingsButton.click();
          }
        }
      });

      // =========================================================================
      // FCM Initialization (全プラットフォーム対応)
      // =========================================================================
      async function initializeFCM() {
        try {
          // Service Worker を明示的に登録
          if ('serviceWorker' in navigator) {
            const swRegistration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' });
            console.log('Service Worker registered:', swRegistration);
          }

          if (!messaging) messaging = getMessaging(app);

          // 通知権限の取得
          if ('Notification' in window) {
            const permission = await Notification.requestPermission();
            if (permission === 'granted') {
              try {
                const swReg = await navigator.serviceWorker.ready;
                const token = await getToken(messaging, { 
                    vapidKey: "BCe5ICJmyyuurq1DsPBXY6AsQcSsIDuXPieZ-c4L1_5zcNwyq2HC3DBhMBND0g9oTwPmEzUhiLqsAjLrnmVlxj0",
                    serviceWorkerRegistration: swReg
                });
                if (token && userId) {
                  console.log('FCM Token obtained:', token.substring(0, 20) + '...');
                  const userRef = doc(db, `artifacts/${appId}/users`, userId);
                  await setDoc(userRef, { fcmTokens: arrayUnion(token) }, { merge: true });
                }
              } catch (tokenErr) {
                console.error('FCM Token error:', tokenErr);
              }
            }
          }

          // フォアグラウンドメッセージ受信（data + notification 両対応）
          onMessage(messaging, (payload) => {
            console.log('Foreground message received:', payload);
            const title = payload.data?.title || payload.notification?.title || 'SimpleChat';
            const body = payload.data?.body || payload.notification?.body || '新しいメッセージ';
            const roomId = payload.data?.roomId || null;
            showNotification(title, body, roomId);
          });
        } catch (error) {
          console.error('FCM Initialization Error:', error);
        }
      }

      // =========================================================================
      // Sidebar Resizing Feature - ★改善版に置き換え
      // =========================================================================
      function initializeResizer() {
      const sidebar = document.getElementById("sidebar");
      const resizer = document.getElementById("resizer");
        const SIDEBAR_WIDTH_KEY = "chatAppSidebarWidth";

        const savedWidth = localStorage.getItem(SIDEBAR_WIDTH_KEY);
        if (savedWidth) {
          sidebar.style.width = savedWidth;
        }

      let isResizing = false;

        resizer.addEventListener("mousedown", (e) => {
          isResizing = true;
          document.body.style.userSelect = "none";
          document.addEventListener("mousemove", handleMouseMove);
          document.addEventListener("mouseup", handleMouseUp);
        });

        function handleMouseMove(e) {
          if (isResizing) {
            const newWidth = Math.max(180, Math.min(600, e.clientX));
            sidebar.style.width = `${newWidth}px`;
          }
        }

        function handleMouseUp() {
          isResizing = false;
          document.body.style.userSelect = "";
          document.removeEventListener("mousemove", handleMouseMove);
          document.removeEventListener("mouseup", handleMouseUp);
          localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebar.style.width);
        }
      }

      // =========================================================================
      // Notifications & Updater
      // =========================================================================

      // --- 統合通知関数 ---
      async function showNotification(title, body, roomId) {
        // 設定チェック
        const soundEnabled = localStorage.getItem('simplechat_sound') !== 'false';
        const desktopEnabled = localStorage.getItem('simplechat_desktop_notif') !== 'false';
        
        if (!desktopEnabled) return;

        if (soundEnabled) {
          playNotificationSound();
        }

        if (isTauri) {
          if (window.__TAURI__?.core?.invoke) {
            try {
              await window.__TAURI__.core.invoke('show_notification_window', {
                title: title,
                body: body,
                roomId: roomId || ""
              });
            } catch(e) {
              console.error("Failed to show notification window", e);
            }
          }
        } else if ('Notification' in window) {
          // Web/PWA版: ブラウザ標準通知
          if (Notification.permission === 'granted') {
            new Notification(title, { body: body, icon: '/icon-192x192.png', tag: roomId || 'simplechat' });
          } else if (Notification.permission !== 'denied') {
            const permission = await Notification.requestPermission();
            if (permission === 'granted') {
              new Notification(title, { body: body, icon: '/icon-192x192.png', tag: roomId || 'simplechat' });
            }
          }
        }
      }

      // --- ブロッキングアップデートチェック ---
      let pendingUpdate = null;

      async function blockingUpdateCheck() {
        if (!isTauri) return false;
        // Tauri v2 updater API
        const updater = window.__TAURI__?.updater;
        if (!updater) return false;

        try {
          console.log('Checking for updates...');
          const update = await updater.check();
          if (update) {
            console.log('Update available:', update.version);
            pendingUpdate = update;

            // アップデートオーバーレイを表示
            const overlay = document.getElementById('updateOverlay');
            const versionText = document.getElementById('updateVersionText');
            const bodyText = document.getElementById('updateBodyText');
            
            versionText.textContent = `v${update.version} が利用可能です`;
            bodyText.textContent = update.body || 'バグ修正とパフォーマンス改善が含まれています。';
            overlay.classList.add('show');

            return true; // アプリ起動をブロック
          }
          console.log('No updates available.');
        } catch (error) {
          console.error('Update check failed:', error);
          const errorDetail = error instanceof Error ? error.message : (typeof error === 'object' ? JSON.stringify(error) : String(error));
          alert("アップデートの確認中にエラーが発生しました。\nネットワーク接続を確認するか、しばらく待ってから再度お試しください。\n\n【エラー詳細】\n" + errorDetail);
        }
        return false;
      }

      // アップデート実行（HTMLのonclickから呼ばれる）
      window.performUpdate = async function() {
        if (!pendingUpdate) return;
        const btn = document.getElementById('updateButton');
        const progress = document.getElementById('updateProgress');
        const progressText = document.getElementById('updateProgressText');

        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>&nbsp;&nbsp;ダウンロード中...';
        progress.classList.add('show');
        progressText.textContent = 'ダウンロードしてインストール中...';

        try {
          await pendingUpdate.downloadAndInstall();
          progressText.textContent = 'インストール完了！アプリを再起動してください。';
          btn.innerHTML = '<i class="fas fa-redo"></i>&nbsp;&nbsp;再起動が必要です';
          // 少し待ってからリロード（Tauri v2ではprocess pluginがないとrestartできないので）
          setTimeout(() => {
            window.location.reload();
          }, 2000);
        } catch (error) {
          console.error('Update failed:', error);
          progressText.textContent = 'アップデートに失敗しました。後でもう一度お試しください。';
          btn.disabled = false;
          btn.innerHTML = '<i class="fas fa-download"></i>&nbsp;&nbsp;もう一度試す';
        }
      };

      // =========================================================================
      // PWA & Settings Management
      // =========================================================================
      
      let deferredPrompt;
      const pwaBanner = document.getElementById('pwaInstallBanner');
      const pwaInstallBtn = document.getElementById('pwaInstallButton');
      const pwaCloseBtn = document.getElementById('pwaInstallClose');

      window.addEventListener('beforeinstallprompt', (e) => {
        // デフォルトのプロンプトを防止
        e.preventDefault();
        deferredPrompt = e;
        
        // すでにPWAとして起動しているかチェック
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
        
        if (!isStandalone && !isTauri) {
          pwaBanner.classList.add('show');
        }
      });

      pwaInstallBtn.addEventListener('click', async () => {
        if (deferredPrompt) {
          deferredPrompt.prompt();
          const { outcome } = await deferredPrompt.userChoice;
          if (outcome === 'accepted') {
            pwaBanner.classList.remove('show');
          }
          deferredPrompt = null;
        } else if (/iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream) {
          // iOS Safariの場合
          alert("Safariの「共有」ボタンから「ホーム画面に追加」を選択してください。\\n追加すると通知を受け取れるようになります。");
        }
      });

      pwaCloseBtn.addEventListener('click', () => {
        pwaBanner.classList.remove('show');
      });

      // iOS向けヒント表示
      if (/iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream && !window.navigator.standalone) {
        document.getElementById('pwaInstallHint').textContent = "共有ボタンから「ホーム画面に追加」してください";
        if (!isTauri) pwaBanner.classList.add('show');
      }
      
      function initSettings() {
        if (!isTauri) return;
        
        document.getElementById('desktopSettingsContainer').classList.remove('hidden');
        
        const toggleNotifSound = document.getElementById('toggleNotifSound');
        const toggleDesktopNotif = document.getElementById('toggleDesktopNotif');
        const toggleAutoStart = document.getElementById('toggleAutoStart');
        
        // Load initial state
        toggleNotifSound.checked = localStorage.getItem('simplechat_sound') !== 'false';
        toggleDesktopNotif.checked = localStorage.getItem('simplechat_desktop_notif') !== 'false';
        
        if (window.__TAURI__?.autostart) {
          window.__TAURI__.autostart.isEnabled().then(enabled => {
            toggleAutoStart.checked = enabled;
          }).catch(console.error);
        }
        
        // Event Listeners
        toggleNotifSound.addEventListener('change', (e) => {
          localStorage.setItem('simplechat_sound', e.target.checked);
        });
        
        toggleDesktopNotif.addEventListener('change', (e) => {
          localStorage.setItem('simplechat_desktop_notif', e.target.checked);
        });
        
        toggleAutoStart.addEventListener('change', async (e) => {
          if (!window.__TAURI__?.autostart) return;
          try {
            if (e.target.checked) {
              await window.__TAURI__.autostart.enable();
            } else {
              await window.__TAURI__.autostart.disable();
            }
          } catch(err) {
            console.error("Autostart toggle failed", err);
            e.target.checked = !e.target.checked; // revert UI on failure
          }
        });
      }

      // =========================================================================
      // Application Startup
      // =========================================================================
      window.onload = async () => {
          loadingOverlay.classList.remove('hidden');
          
          initSettings();

          // Tauri 通知からのルーム遷移イベントリッスン
          if (isTauri && window.__TAURI__?.event?.listen) {
            window.__TAURI__.event.listen('open-room', (event) => {
              const rId = event.payload?.roomId;
              if (rId) {
                // Focus main window
                window.__TAURI__.webviewWindow.getCurrentWebviewWindow().unminimize();
                window.__TAURI__.webviewWindow.getCurrentWebviewWindow().show();
                window.__TAURI__.webviewWindow.getCurrentWebviewWindow().setFocus();
                const roomItem = document.getElementById(`room-item-${rId}`);
                if (roomItem) roomItem.click();
              }
            });
          }

          // Tauri版: まずアップデートチェック（ブロッキング）
          const hasUpdate = await blockingUpdateCheck();
          if (hasUpdate) {
            // アップデートがある場合、オーバーレイを表示したまま
            // Firebase初期化はしない（ユーザーにアプデを促す）
            loadingOverlay.classList.add('hidden');
            return;
          }

          // アップデートがない場合、通常起動
          initializeFirebase();
          if ('Notification' in window) Notification.requestPermission();
          initializeResizer();
      };
    