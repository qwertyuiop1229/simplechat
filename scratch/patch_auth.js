const fs = require('fs');
let code = fs.readFileSync('public/app.js', 'utf-8');

// The replacement for onAuthStateChanged and initializeFirebase
const newInit = `
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
                // Admin Check
                const adminDocRef = doc(db, \`artifacts/\${appId}/settings\`, "adminList");
                const adminSnap = await getDoc(adminDocRef);
                if (adminSnap.exists() && adminSnap.data().emails) {
                    isAdmin = adminSnap.data().emails.includes(user.email);
                } else {
                    isAdmin = false;
                }
              } catch (adminError) {
                isAdmin = false;
              }

              if (isAdmin) {
                adminPanelContainer.classList.remove("hidden");
                document.getElementById('globalAdminBtn').classList.remove('hidden');
              } else {
                adminPanelContainer.classList.add("hidden");
                document.getElementById('globalAdminBtn').classList.add('hidden');
              }

              authContainer.classList.add("hidden");
              nicknameContainer.classList.add("hidden");
              appContainer.classList.remove("hidden");
              
              // Load Servers
              loadServers();
              
            } else {
              // Cleanup on logout
              userId = null; userNickname = null; isAdmin = false; isAuthReady = false;
              currentServerId = null;
              currentRoomId = null;
              headerTitle.textContent = ""; 
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
          authMessage.textContent = \`エラー: \${error.message}\`;
        }
      }

      let unsubscribeServers = null;
      let serversListCache = [];

      function loadServers() {
        if (unsubscribeServers) unsubscribeServers();
        
        // Listen to servers where joinedUsers contains userId
        const serversQuery = query(
          collection(db, \`artifacts/\${appId}/servers\`),
          where("joinedUsers", "array-contains", userId)
        );
        
        unsubscribeServers = onSnapshot(serversQuery, async (snapshot) => {
          serversListCache = [];
          snapshot.forEach(doc => {
            serversListCache.push({ id: doc.id, ...doc.data() });
          });
          
          renderServers();
          
          // If we have servers and no current server selected, auto-select the first one
          if (serversListCache.length > 0 && !currentServerId) {
            await selectServer(serversListCache[0].id);
          } else if (serversListCache.length === 0) {
            // No servers. Clear UI.
            currentServerId = null;
            roomList.innerHTML = "";
            membersList.innerHTML = "";
            messagesDisplay.innerHTML = "";
            currentRoomHeader.classList.add("hidden");
            headerTitle.textContent = "サーバーがありません";
            document.getElementById('promptCreateRoomButton').classList.add('hidden');
            stopPresenceSystem();
            nicknameContainer.classList.add("hidden");
            appContainer.classList.remove("hidden");
          }
        });
      }

      function renderServers() {
        const container = document.getElementById("serverListContainer");
        container.innerHTML = "";
        
        serversListCache.forEach(server => {
          const div = document.createElement("div");
          div.className = "w-12 h-12 rounded-full bg-gray-700 hover:bg-indigo-500 text-white flex items-center justify-center cursor-pointer transition-all hover:rounded-xl shadow-md";
          if (server.id === currentServerId) {
             div.classList.replace("rounded-full", "rounded-xl");
             div.classList.replace("bg-gray-700", "bg-indigo-500");
          }
          div.title = server.name;
          div.textContent = server.name.charAt(0).toUpperCase();
          div.onclick = () => selectServer(server.id);
          container.appendChild(div);
        });
      }

      async function selectServer(serverId) {
        if (currentServerId) {
            // Leaving old server
            await updateUserStatus('offline'); // Optional, or just stop subscription
            stopPresenceSystem();
        }
        
        currentServerId = serverId;
        renderServers(); // update selection visuals
        
        document.getElementById('promptCreateRoomButton').classList.remove('hidden');
        
        // Fetch nickname for this server
        loadingOverlay.classList.remove("hidden");
        try {
            const userProfileRef = doc(db, \`artifacts/\${appId}/servers/\${currentServerId}/profiles/\${userId}\`, "nicknameDoc");
            const userProfileSnap = await getDoc(userProfileRef);

            if (userProfileSnap.exists() && userProfileSnap.data().nickname) {
                userNickname = userProfileSnap.data().nickname;
                userAvatarUrl = userProfileSnap.data().avatarUrl || null;
                
                headerTitle.textContent = \`サーバー: \${serversListCache.find(s=>s.id===serverId)?.name || ''} | ニックネーム：\${userNickname}\${isAdmin ? " (管理者)" : ""}\`;
                updateUserPanelUI();
                
                nicknameContainer.classList.add("hidden");
                appContainer.classList.remove("hidden");
                
                loadRooms();
                startPresenceSystem();
                initializeFCM();
            } else {
                // Must set nickname
                appContainer.classList.add("hidden");
                nicknameContainer.classList.remove("hidden");
                nicknameInput.value = "";
                headerTitle.textContent = "プロフィール設定";
            }
        } catch (e) {
            console.error(e);
        } finally {
            loadingOverlay.classList.add("hidden");
        }
      }
`;

// Now replace from initializeFirebase() to updateUserPanelUI()
const startIdx = code.indexOf('function initializeFirebase() {');
const endIdx = code.indexOf('// タブ切り替え処理');

if (startIdx !== -1 && endIdx !== -1) {
    code = code.substring(0, startIdx) + newInit + '\n      ' + code.substring(endIdx);
    fs.writeFileSync('public/app.js', code);
    console.log('Patch Auth complete.');
} else {
    console.log('Could not find indices.');
}
