const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    if (url.pathname === "/api/signup" && request.method === "POST") {
      return await handleSignup(request, env);
    }
    if (url.pathname === "/api/joinServer" && request.method === "POST") {
      return await handleJoinServer(request, env);
    }
    // 旧フロントエンド互換: /api/joinRoom
    if (url.pathname === "/api/joinRoom" && request.method === "POST") {
      return await handleJoinRoomLegacy(request, env);
    }
    if (url.pathname === "/api/sendNotification" && request.method === "POST") {
      return await handleSendNotification(request, env);
    }
    if (url.pathname === "/api/setOffline" && request.method === "POST") {
      return await handleSetOffline(request, env);
    }

    return new Response(JSON.stringify({ error: "Not Found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  },
};

// サインアップ処理（誰でも登録可能に変更）
async function handleSignup(request, env) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return new Response(JSON.stringify({ error: "Email and password are required" }), { status: 400, headers: corsHeaders });
    }
    
    const cleanEmail = email.trim().toLowerCase();

    // Firebase Identity Toolkit APIでユーザーを作成
    const signUpResult = await signUpWithFirebase(cleanEmail, password, env);

    if (signUpResult.error) {
      return new Response(JSON.stringify({ error: signUpResult.error.message }), { status: 400, headers: corsHeaders });
    }

    return new Response(JSON.stringify({ success: true, message: "Account created successfully" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ error: "Internal Server Error", details: error.toString() }), { status: 500, headers: corsHeaders });
  }
}

// Worker専用のFirebaseアカウントでログインし、IDトークンを取得
async function getWorkerAuthToken(env) {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${env.FIREBASE_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: env.WORKER_AUTH_EMAIL,
      password: env.WORKER_AUTH_PASSWORD,
      returnSecureToken: true
    })
  });
  const data = await res.json();
  return data.idToken || null;
}

// Identity Toolkit APIを使ってアカウント作成
async function signUpWithFirebase(email, password, env) {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${env.FIREBASE_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password,
      returnSecureToken: true
    })
  });
  return await res.json();
}

// -------------------------------------------------------------
// サーバー参加処理
// -------------------------------------------------------------
async function handleJoinServer(request, env) {
  try {
    const { serverId, password, userId, appId } = await request.json();
    if (!serverId || !password || !userId || !appId) {
      return new Response(JSON.stringify({ success: false, error: "Missing required fields" }), { status: 400, headers: corsHeaders });
    }

    // Workerトークン取得
    const workerToken = await getWorkerAuthToken(env);
    if (!workerToken) return new Response(JSON.stringify({ success: false, error: "Worker Auth failed" }), { status: 500, headers: corsHeaders });

    // Firestoreからパスワードを取得
    const projectId = env.FIREBASE_PROJECT_ID;
    const pwdUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/artifacts/${appId}/servers/${serverId}/secrets/password`;
    
    const pwdRes = await fetch(pwdUrl, {
      method: "GET",
      headers: { "Authorization": `Bearer ${workerToken}` }
    });
    const pwdData = await pwdRes.json();
    
    if (pwdData.error) {
      return new Response(JSON.stringify({ success: false, error: "サーバーが見つからないか、パスワードが設定されていません。" }), { status: 404, headers: corsHeaders });
    }

    const actualPassword = pwdData.fields?.password?.stringValue;
    if (password !== actualPassword) {
      return new Response(JSON.stringify({ success: false, error: "Incorrect password" }), { status: 401, headers: corsHeaders });
    }

    // パスワードが一致したので、該当サーバーの joinedUsers 配列に userId を追加
    // Firestore REST APIで arrayUnion を実行するためのリクエスト
    const transformUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/artifacts/${appId}/servers/${serverId}:commit`;
    const transformBody = {
      writes: [
        {
          transform: {
            document: `projects/${projectId}/databases/(default)/documents/artifacts/${appId}/servers/${serverId}`,
            fieldTransforms: [
              {
                fieldPath: "joinedUsers",
                appendMissingElements: {
                  values: [{ stringValue: userId }]
                }
              }
            ]
          }
        }
      ]
    };

    const updateRes = await fetch(transformUrl, {
      method: "POST",
      headers: { 
        "Authorization": `Bearer ${workerToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(transformBody)
    });

    const updateData = await updateRes.json();
    if (updateData.error) {
       console.error("Firestore Update Error:", updateData.error);
       return new Response(JSON.stringify({ success: false, error: "Failed to update joinedUsers" }), { status: 500, headers: corsHeaders });
    }

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ success: false, error: error.toString() }), { status: 500, headers: corsHeaders });
  }
}

// -------------------------------------------------------------
// FCM プッシュ通知送信処理
// -------------------------------------------------------------
async function handleSendNotification(request, env) {
  try {
    // サーバーの構造に合わせてserverIdも受け取る（旧フロントは送らないのでオプション）
    const { receiverIds, title, body, roomId, serverId, appId, senderId } = await request.json();
    if (!receiverIds || !title || !appId) {
      return new Response(JSON.stringify({ success: false, error: "Missing fields" }), { status: 400, headers: corsHeaders });
    }

    const workerToken = await getWorkerAuthToken(env);
    if (!workerToken) return new Response(JSON.stringify({ success: false, error: "Worker Auth failed" }), { status: 500, headers: corsHeaders });

    const projectId = env.FIREBASE_PROJECT_ID;

    // Service Account から FCM OAuth2 トークンを取得
    if (!env.SERVICE_ACCOUNT_JSON) {
        return new Response(JSON.stringify({ success: false, error: "SERVICE_ACCOUNT_JSON secret is not set" }), { status: 500, headers: corsHeaders });
    }
    const fcmAccessToken = await getFCMToken(env.SERVICE_ACCOUNT_JSON);

    const results = [];

    // 各受信者について処理
    for (const rid of receiverIds) {
        if (rid === senderId) continue; // 自分には送らない

        // 1. 相手のステータスを取得（サーバーベース or 旧パス）
        const statusPath = serverId 
          ? `artifacts/${appId}/servers/${serverId}/status/${rid}`
          : `artifacts/${appId}/status/${rid}`;
        const statusUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${statusPath}`;
        const statusRes = await fetch(statusUrl, { headers: { "Authorization": `Bearer ${workerToken}` } });
        const statusData = await statusRes.json();
        
        let shouldSend = true;
        if (!statusData.error && statusData.fields) {
            const state = statusData.fields.state?.stringValue || 'offline';
            const currentRoomId = statusData.fields.currentRoomId?.stringValue;
            
            // オンラインかつ、今そのルームを見ているなら通知不要
            if (state === 'online' && currentRoomId === roomId) {
                shouldSend = false;
            }
        }

        if (shouldSend) {
            // 2. 相手の FCM トークンを取得（グローバルユーザー情報から）
            const userUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/artifacts/${appId}/users/${rid}`;
            const userRes = await fetch(userUrl, { headers: { "Authorization": `Bearer ${workerToken}` } });
            const userData = await userRes.json();
            
            if (!userData.error && userData.fields && userData.fields.fcmTokens) {
                const tokens = userData.fields.fcmTokens.arrayValue?.values || [];
                const invalidTokens = [];

                for (const t of tokens) {
                    const tokenStr = t.stringValue;
                    
                    const fcmRes = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
                        method: "POST",
                        headers: {
                            "Authorization": `Bearer ${fcmAccessToken}`,
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({
                            message: {
                                token: tokenStr,
                                data: {
                                    title: title,
                                    body: body,
                                    roomId: roomId || "",
                                    serverId: serverId || "",
                                    senderId: senderId || "",
                                    type: "chat_message"
                                },
                                // Androidの通知チャンネル設定
                                android: {
                                    priority: "high",
                                    notification: {
                                        title: title,
                                        body: body,
                                        channel_id: "simplechat_messages",
                                        default_sound: true,
                                        notification_priority: "PRIORITY_HIGH"
                                    }
                                },
                                // Apple Push Notification Service設定
                                apns: {
                                    payload: {
                                        aps: {
                                            alert: { title: title, body: body },
                                            sound: "default",
                                            badge: 1,
                                            "content-available": 1
                                        }
                                    },
                                    headers: {
                                        "apns-priority": "10"
                                    }
                                },
                                // Web Push設定
                                webpush: {
                                    notification: {
                                        title: title,
                                        body: body,
                                        icon: "/icon-192x192.png",
                                        badge: "/icon-192x192.png",
                                        tag: `${serverId}_${roomId}`,
                                        renotify: true
                                    },
                                    headers: {
                                        "Urgency": "high"
                                    },
                                    fcm_options: {
                                        link: "/"
                                    }
                                }
                            }
                        })
                    });
                    
                    const fcmResult = await fcmRes.json();
                    if (fcmResult.error) {
                        console.error("FCM Send Error:", fcmResult.error);
                        const errorCode = fcmResult.error.details?.[0]?.errorCode || fcmResult.error.code;
                        if (errorCode === 'UNREGISTERED' || errorCode === 404 || 
                            fcmResult.error.status === 'NOT_FOUND' ||
                            (fcmResult.error.message && fcmResult.error.message.includes('not a valid FCM'))) {
                            invalidTokens.push(tokenStr);
                        }
                    } else {
                        results.push({ token: tokenStr, success: true });
                    }
                }

                // 無効なトークンをFirestoreから削除
                if (invalidTokens.length > 0) {
                    try {
                        const removeBody = {
                            writes: [{
                                transform: {
                                    document: `projects/${projectId}/databases/(default)/documents/artifacts/${appId}/users/${rid}`,
                                    fieldTransforms: [{
                                        fieldPath: "fcmTokens",
                                        removeAllFromArray: {
                                            values: invalidTokens.map(t => ({ stringValue: t }))
                                        }
                                    }]
                                }
                            }]
                        };
                        const commitUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:commit`;
                        await fetch(commitUrl, {
                            method: "POST",
                            headers: {
                                "Authorization": `Bearer ${workerToken}`,
                                "Content-Type": "application/json"
                            },
                            body: JSON.stringify(removeBody)
                        });
                        console.log(`Removed ${invalidTokens.length} invalid token(s) for user ${rid}`);
                    } catch (cleanupErr) {
                        console.error("Token cleanup error:", cleanupErr);
                    }
                }
            }
        }
    }

    return new Response(JSON.stringify({ success: true, results }), { status: 200, headers: corsHeaders });
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ success: false, error: error.toString() }), { status: 500, headers: corsHeaders });
  }
}

// Service Account JSON を用いて JWT を署名し OAuth トークンを取得する関数
async function getFCMToken(serviceAccountJsonStr) {
  const serviceAccount = JSON.parse(serviceAccountJsonStr);
  const header = { alg: 'RS256', typ: 'JWT' };
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 3600;
  const payload = {
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    iat,
    exp,
    scope: 'https://www.googleapis.com/auth/firebase.messaging'
  };

  const encodeBase64Url = (obj) => btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const unsignedToken = `${encodeBase64Url(header)}.${encodeBase64Url(payload)}`;

  const privateKey = serviceAccount.private_key;
  const pemHeader = "-----BEGIN PRIVATE KEY-----";
  const pemFooter = "-----END PRIVATE KEY-----";
  const pemContents = privateKey.substring(pemHeader.length, privateKey.length - pemFooter.length - 1).replace(/\s/g, '');
  const binaryDer = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryDer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(unsignedToken)
  );

  const signatureBase64Url = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const jwt = `${unsignedToken}.${signatureBase64Url}`;

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
  });
  
  const data = await response.json();
  return data.access_token;
}

// 確実なオフライン状態変更（navigator.sendBeacon用）
async function handleSetOffline(request, env) {
  try {
    const bodyText = await request.text();
    const data = JSON.parse(bodyText);
    const { userId, serverId, appId } = data;
    
    if (!userId || !appId) {
      return new Response("Missing fields", { status: 400, headers: corsHeaders });
    }

    const workerToken = await getWorkerAuthToken(env);
    if (!workerToken) return new Response("Worker Auth failed", { status: 500, headers: corsHeaders });

    const projectId = env.FIREBASE_PROJECT_ID;

    // サーバーベースの場合は servers/{serverId}/status, 旧パスは status/{userId}
    const statusPath = serverId
      ? `artifacts/${appId}/servers/${serverId}/status/${userId}`
      : `artifacts/${appId}/status/${userId}`;

    const docUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${statusPath}?updateMask.fieldPaths=state&updateMask.fieldPaths=last_changed`;
    await fetch(docUrl, {
      method: "PATCH",
      headers: {
        "Authorization": `Bearer ${workerToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        fields: {
          state: { stringValue: "offline" },
          last_changed: { timestampValue: new Date().toISOString() }
        }
      })
    });

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
  } catch (error) {
    console.error("setOffline Error:", error);
    return new Response(JSON.stringify({ success: false, error: error.toString() }), { status: 500, headers: corsHeaders });
  }
}

// -------------------------------------------------------------
// 旧フロントエンド互換: ルーム参加処理
// -------------------------------------------------------------
async function handleJoinRoomLegacy(request, env) {
  try {
    const { roomId, password, userId, appId } = await request.json();
    if (!roomId || !password || !userId || !appId) {
      return new Response(JSON.stringify({ success: false, error: "Missing fields" }), { status: 400, headers: corsHeaders });
    }

    const workerToken = await getWorkerAuthToken(env);
    if (!workerToken) return new Response(JSON.stringify({ success: false, error: "Worker Auth failed" }), { status: 500, headers: corsHeaders });

    const projectId = env.FIREBASE_PROJECT_ID;
    const pwdUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/artifacts/${appId}/public/data/rooms/${roomId}/secrets/password`;
    
    const pwdRes = await fetch(pwdUrl, {
      method: "GET",
      headers: { "Authorization": `Bearer ${workerToken}` }
    });
    const pwdData = await pwdRes.json();
    
    if (pwdData.error) {
      return new Response(JSON.stringify({ success: false, error: "Room not found" }), { status: 404, headers: corsHeaders });
    }

    const actualPassword = pwdData.fields?.password?.stringValue;
    if (password !== actualPassword) {
      return new Response(JSON.stringify({ success: false, error: "Incorrect password" }), { status: 401, headers: corsHeaders });
    }

    const transformUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:commit`;
    const transformBody = {
      writes: [{
        transform: {
          document: `projects/${projectId}/databases/(default)/documents/artifacts/${appId}/public/data/rooms/${roomId}`,
          fieldTransforms: [{
            fieldPath: "joinedUsers",
            appendMissingElements: { values: [{ stringValue: userId }] }
          }]
        }
      }]
    };

    await fetch(transformUrl, {
      method: "POST",
      headers: { 
        "Authorization": `Bearer ${workerToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(transformBody)
    });

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.toString() }), { status: 500, headers: corsHeaders });
  }
}
