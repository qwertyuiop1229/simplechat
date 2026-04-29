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
    if (url.pathname === "/api/joinRoom" && request.method === "POST") {
      return await handleJoinRoom(request, env);
    }
    if (url.pathname === "/api/sendNotification" && request.method === "POST") {
      return await handleSendNotification(request, env);
    }

    return new Response(JSON.stringify({ error: "Not Found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  },
};

// サインアップ処理（許可リストの検証を含む）
async function handleSignup(request, env) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return new Response(JSON.stringify({ error: "Email and password are required" }), { status: 400, headers: corsHeaders });
    }
    
    const cleanEmail = email.trim().toLowerCase();

    // 1. 特権ワーカーとしてFirebase Authにログインし、IDトークンを取得
    const workerToken = await getWorkerAuthToken(env);
    if (!workerToken) {
      return new Response(JSON.stringify({ error: "Internal Server Error: Worker Auth failed" }), { status: 500, headers: corsHeaders });
    }

    // 2. Firestoreから許可リストを取得
    const result = await getAllowedEmails(workerToken, env);
    if (result.error) {
       return new Response(JSON.stringify({ error: `Firestore Error: ${result.error}` }), { status: 500, headers: corsHeaders });
    }
    const allowedEmails = result.emails.map(e => e.trim().toLowerCase());
    
    if (!allowedEmails.includes(cleanEmail)) {
      return new Response(JSON.stringify({ error: "招待されたメールアドレスではありません。管理者にお問い合わせください。" }), { status: 403, headers: corsHeaders });
    }

    // 3. 許可されている場合、Firebase Identity Toolkit APIでユーザーを作成
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

// Firestore REST APIを使って allowedEmails ドキュメントを取得
async function getAllowedEmails(idToken, env) {
  const projectId = env.FIREBASE_PROJECT_ID;
  const appId = env.FIREBASE_APP_ID;
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/artifacts/${appId}/settings/allowedEmails`;
  
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${idToken}`
    }
  });

  const data = await res.json();
  if (data.error) {
    // ドキュメントが存在しない（まだ誰も許可されていない）場合はエラーにせず空配列を返す
    if (data.error.code === 404 || data.error.status === "NOT_FOUND") {
      return { emails: [], error: null };
    }
    console.error("Firestore Error:", data.error);
    return { emails: [], error: data.error.message || "Unknown Firestore Error" };
  }

  // Firestoreの配列データ構造のパース: data.fields.emails.arrayValue.values
  if (data.fields && data.fields.emails && data.fields.emails.arrayValue && data.fields.emails.arrayValue.values) {
    const emails = data.fields.emails.arrayValue.values.map(v => v.stringValue);
    return { emails, error: null };
  }
  return { emails: [], error: null };
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
// ルーム参加処理
// -------------------------------------------------------------
async function handleJoinRoom(request, env) {
  try {
    const { roomId, password, userId, appId } = await request.json();
    if (!roomId || !password || !userId || !appId) {
      return new Response(JSON.stringify({ success: false, error: "Missing required fields" }), { status: 400, headers: corsHeaders });
    }

    // Workerトークン取得
    const workerToken = await getWorkerAuthToken(env);
    if (!workerToken) return new Response(JSON.stringify({ success: false, error: "Worker Auth failed" }), { status: 500, headers: corsHeaders });

    // Firestoreからパスワードを取得
    const projectId = env.FIREBASE_PROJECT_ID;
    const pwdUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/artifacts/${appId}/public/data/rooms/${roomId}/secrets/password`;
    
    const pwdRes = await fetch(pwdUrl, {
      method: "GET",
      headers: { "Authorization": `Bearer ${workerToken}` }
    });
    const pwdData = await pwdRes.json();
    
    if (pwdData.error) {
      return new Response(JSON.stringify({ success: false, error: "パスワード設定が見つかりません" }), { status: 404, headers: corsHeaders });
    }

    const actualPassword = pwdData.fields?.password?.stringValue;
    if (password !== actualPassword) {
      return new Response(JSON.stringify({ success: false, error: "Incorrect password" }), { status: 401, headers: corsHeaders });
    }

    // パスワードが一致したので、該当ルームの joinedUsers 配列に userId を追加
    // Firestore REST APIで arrayUnion を実行するためのリクエスト
    const transformUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/artifacts/${appId}/public/data/rooms/${roomId}:commit`;
    const transformBody = {
      writes: [
        {
          transform: {
            document: `projects/${projectId}/databases/(default)/documents/artifacts/${appId}/public/data/rooms/${roomId}`,
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
    const { receiverIds, title, body, roomId, appId, senderId } = await request.json();
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

        // 1. 相手のステータスを取得
        const statusUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/artifacts/${appId}/status/${rid}`;
        const statusRes = await fetch(statusUrl, { headers: { "Authorization": `Bearer ${workerToken}` } });
        const statusData = await statusRes.json();
        
        let shouldSend = true;
        if (!statusData.error && statusData.fields) {
            const activeSessions = statusData.fields.activeSessions?.arrayValue?.values || [];
            const isOnline = activeSessions.length > 0;
            const currentRoomId = statusData.fields.currentRoomId?.stringValue;
            
            // オンラインかつ、今そのルームを見ているなら通知不要
            if (isOnline && currentRoomId === roomId) {
                shouldSend = false;
            }
        }

        if (shouldSend) {
            // 2. 相手の FCM トークンを取得
            const userUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/artifacts/${appId}/users/${rid}`;
            const userRes = await fetch(userUrl, { headers: { "Authorization": `Bearer ${workerToken}` } });
            const userData = await userRes.json();
            
            if (!userData.error && userData.fields && userData.fields.fcmTokens) {
                const tokens = userData.fields.fcmTokens.arrayValue?.values || [];
                for (const t of tokens) {
                    const tokenStr = t.stringValue;
                    
                    // FCM V1 API を叩く
                    const fcmRes = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
                        method: "POST",
                        headers: {
                            "Authorization": `Bearer ${fcmAccessToken}`,
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({
                            message: {
                                token: tokenStr,
                                notification: { title, body },
                                data: { roomId: roomId || "" }
                            }
                        })
                    });
                    
                    const fcmResult = await fcmRes.json();
                    if (fcmResult.error) {
                        console.error("FCM Send Error:", fcmResult.error);
                        // もし無効なトークンなら Firestore から削除する処理をここに入れることも可能
                    } else {
                        results.push({ token: tokenStr, success: true });
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
