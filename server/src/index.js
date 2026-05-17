const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
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
    if (url.pathname === "/api/sendCallNotification" && request.method === "POST") {
      return await handleSendCallNotification(request, env);
    }
    if (url.pathname === "/api/sendNotification" && request.method === "POST") {
      return await handleSendNotification(request, env);
    }
    if (url.pathname === "/api/setOffline" && request.method === "POST") {
      return await handleSetOffline(request, env);
    }
    if (url.pathname === "/api/download" && request.method === "GET") {
      return await handleDownload(request, env);
    }
    if (url.pathname === "/api/uploadFile" && request.method === "POST") {
      return await handleUploadFile(request, env);
    }
    if (url.pathname.startsWith("/api/file/") && request.method === "GET") {
      return await handleServeFile(request, env, url);
    }
    if (url.pathname.startsWith("/api/file/") && request.method === "DELETE") {
      return await handleDeleteFile(request, env, url);
    }
    if (url.pathname === "/api/admin/storageStats" && request.method === "GET") {
      return await handleStorageStats(request, env);
    }
    if (url.pathname === "/api/admin/bulkDeleteFiles" && request.method === "DELETE") {
      return await handleBulkDeleteFiles(request, env);
    }
    if (url.pathname === "/api/cloudinaryFile" && request.method === "DELETE") {
      return await handleDeleteCloudinaryFile(request, env, url);
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
// 着信通知送信処理
// -------------------------------------------------------------
async function handleSendCallNotification(request, env) {
  try {
    const { calleeId, callerNickname, callerAvatarUrl, callId, appId } = await request.json();
    if (!calleeId || !callId || !appId) {
      return new Response(JSON.stringify({ success: false, error: "Missing fields" }), { status: 400, headers: corsHeaders });
    }

    const workerToken = await getWorkerAuthToken(env);
    if (!workerToken) return new Response(JSON.stringify({ success: false, error: "Worker Auth failed" }), { status: 500, headers: corsHeaders });

    if (!env.SERVICE_ACCOUNT_JSON) {
      return new Response(JSON.stringify({ success: false, error: "SERVICE_ACCOUNT_JSON secret is not set" }), { status: 500, headers: corsHeaders });
    }
    const fcmAccessToken = await getFCMToken(env.SERVICE_ACCOUNT_JSON);

    const projectId = env.FIREBASE_PROJECT_ID;

    const userUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/artifacts/${appId}/users/${calleeId}`;
    const userRes = await fetch(userUrl, { headers: { "Authorization": `Bearer ${workerToken}` } });
    const userData = await userRes.json();

    if (userData.error || !userData.fields || !userData.fields.fcmTokens) {
      return new Response(JSON.stringify({ success: false, error: "No FCM tokens found for callee" }), { status: 404, headers: corsHeaders });
    }

    const tokens = userData.fields.fcmTokens.arrayValue?.values || [];
    const invalidTokens = [];
    const title = `${callerNickname || '不明なユーザー'} から着信`;
    const body = '音声通話の着信があります';

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
              type: "incoming_call",
              callId,
              callerNickname: callerNickname || '',
              callerAvatarUrl: callerAvatarUrl || '',
              title,
              body
            },
            android: {
              priority: "high",
              notification: {
                title,
                body,
                channel_id: "covo_calls",
                notification_priority: "PRIORITY_MAX",
                default_sound: true
              }
            },
            apns: {
              payload: {
                aps: {
                  alert: { title, body },
                  sound: "default",
                  "content-available": 1
                }
              },
              headers: { "apns-priority": "10" }
            },
            webpush: {
              notification: {
                title,
                body,
                icon: "/icon-192x192.png?v=5",
                badge: "/icon-192x192.png?v=5",
                tag: `call-${callId}`,
                requireInteraction: true,
                renotify: true
              },
              headers: { "Urgency": "high" },
              fcm_options: { link: "/" }
            }
          }
        })
      });

      const fcmResult = await fcmRes.json();
      if (fcmResult.error) {
        console.error("FCM Call Notification Error:", fcmResult.error);
        const errorCode = fcmResult.error.details?.[0]?.errorCode || fcmResult.error.code;
        if (errorCode === 'UNREGISTERED' || errorCode === 404 ||
            fcmResult.error.status === 'NOT_FOUND' ||
            (fcmResult.error.message && fcmResult.error.message.includes('not a valid FCM'))) {
          invalidTokens.push(tokenStr);
        }
      }
    }

    if (invalidTokens.length > 0) {
      try {
        const removeBody = {
          writes: [{
            transform: {
              document: `projects/${projectId}/databases/(default)/documents/artifacts/${appId}/users/${calleeId}`,
              fieldTransforms: [{
                fieldPath: "fcmTokens",
                removeAllFromArray: { values: invalidTokens.map(t => ({ stringValue: t })) }
              }]
            }
          }]
        };
        const commitUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:commit`;
        await fetch(commitUrl, {
          method: "POST",
          headers: { "Authorization": `Bearer ${workerToken}`, "Content-Type": "application/json" },
          body: JSON.stringify(removeBody)
        });
      } catch (cleanupErr) {
        console.error("Token cleanup error:", cleanupErr);
      }
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
            const state = statusData.fields.state?.stringValue || 'offline';
            const currentRoomId = statusData.fields.currentRoomId?.stringValue;
            
            // オンラインかつ、今そのルームを見ているなら通知不要
            if (state === 'online' && currentRoomId === roomId) {
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
                const invalidTokens = [];

                for (const t of tokens) {
                    const tokenStr = t.stringValue;
                    
                    // FCM V1 API: data ペイロードのみ送信（Service Workerでの確実な受信のため）
                    // notification ペイロードを含めると、ブラウザが自動で通知を出し
                    // Service Workerの onBackgroundMessage が呼ばれないケースがある
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
                                        tag: roomId || "simplechat",
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
                        // 無効なトークン（UNREGISTERED / NOT_FOUND）は削除対象に追加
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

// -------------------------------------------------------------
// Cloudinary ファイルダウンロードプロキシ
// ブラウザからは401になるCloudinary URLを、サーバー経由でプロキシして返す
// -------------------------------------------------------------
async function handleDownload(request, env) {
  try {
    const reqUrl = new URL(request.url);
    const fileUrl = reqUrl.searchParams.get('url');
    const fileName = reqUrl.searchParams.get('name') || 'download';

    if (!fileUrl) {
      return new Response(JSON.stringify({ error: "Missing url parameter" }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // セキュリティ: このアカウントのCloudinary URLのみ許可
    if (!fileUrl.startsWith('https://res.cloudinary.com/dhmsyvwjd/')) {
      return new Response(JSON.stringify({ error: "Invalid URL" }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const fileRes = await fetch(fileUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CovoChatProxy/1.0)',
        'Accept': '*/*',
      }
    });

    if (!fileRes.ok) {
      const cloudinaryError = await fileRes.text().catch(() => '');
      const reason = fileRes.status === 401
        ? 'Cloudinaryがこのリソースタイプ(image/upload)でのPDF配信を拒否しました。raw/uploadタイプで再アップロードが必要です。'
        : `Cloudinary returned ${fileRes.status}`;
      console.error(`[Worker/download] Cloudinary error ${fileRes.status} for: ${fileUrl}`);
      return new Response(JSON.stringify({ error: `Upstream error: ${fileRes.status}`, reason, cloudinaryResponse: cloudinaryError.slice(0, 200) }), {
        status: fileRes.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const contentType = fileRes.headers.get('Content-Type') || 'application/octet-stream';
    const isPreview = reqUrl.searchParams.get('preview') === '1';
    const responseHeaders = {
      ...corsHeaders,
      'Content-Type': contentType,
      // preview=1 のときはインライン表示（PDF viewer）、それ以外はダウンロード強制
      'Content-Disposition': isPreview
        ? `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`
        : `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'X-Content-Type-Options': 'nosniff',
    };
    const contentLength = fileRes.headers.get('Content-Length');
    if (contentLength) responseHeaders['Content-Length'] = contentLength;

    return new Response(fileRes.body, { status: 200, headers: responseHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Proxy error", details: err.toString() }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// -------------------------------------------------------------
// Workers KV を使ったファイルアップロード＆配信
// -------------------------------------------------------------
async function handleUploadFile(request, env) {
  try {
    if (!env.FILES) {
      return new Response(JSON.stringify({ error: 'KVストレージが設定されていません' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    const formData = await request.formData();
    const file = formData.get('file');
    if (!file) {
      return new Response(JSON.stringify({ error: 'ファイルが見つかりません' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    if (file.size > 25 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: 'ファイルは25MBまでです' }), {
        status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const arrayBuffer = await file.arrayBuffer();
    const key = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const uploaderId = formData.get('uploaderId') || '';
    const meta = { name: file.name, type: file.type || 'application/octet-stream', size: file.size, uploaderId };

    await env.FILES.put(key, arrayBuffer, {
      metadata: meta,
      expirationTtl: undefined // 期限なし
    });

    const fileUrl = `https://simplechat-api.astro-fray-server.workers.dev/api/file/${key}`;
    return new Response(JSON.stringify({ url: fileUrl, name: file.name }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'アップロードエラー', details: err.toString() }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

async function handleDeleteFile(request, env, url) {
  try {
    const key = url.pathname.replace('/api/file/', '');
    if (!key || !env.FILES) return new Response('Not Found', { status: 404, headers: corsHeaders });

    const requesterId = url.searchParams.get('userId') || '';

    // メタデータで所有者確認
    const listed = await env.FILES.list({ prefix: key });
    const fileEntry = listed.keys.find(k => k.name === key);
    if (!fileEntry) return new Response(JSON.stringify({ error: 'ファイルが見つかりません' }), {
      status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

    const meta = fileEntry.metadata;
    const forceDelete = url.searchParams.get('forceDelete') === '1';
    if (!forceDelete && meta && meta.uploaderId && meta.uploaderId !== requesterId) {
      return new Response(JSON.stringify({ error: '削除権限がありません' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    await env.FILES.delete(key);
    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.toString() }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

async function handleServeFile(request, env, url) {
  try {
    const key = url.pathname.replace('/api/file/', '');
    if (!key || !env.FILES) {
      return new Response('Not Found', { status: 404, headers: corsHeaders });
    }
    const { value, metadata } = await env.FILES.getWithMetadata(key, { type: 'arrayBuffer' });
    if (!value) return new Response('Not Found', { status: 404, headers: corsHeaders });

    const contentType = (metadata && metadata.type) || 'application/octet-stream';
    const fileName = (metadata && metadata.name) ? metadata.name : key;
    const isPreview = url.searchParams.get('preview') === '1';

    return new Response(value, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': contentType,
        'Content-Disposition': isPreview
          ? `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`
          : `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'Cache-Control': 'public, max-age=31536000',
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.toString() }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// -------------------------------------------------------------
// 管理者: ストレージ使用状況取得
// -------------------------------------------------------------
async function handleStorageStats(request, env) {
  try {
    const kvStats = { fileCount: 0, totalBytes: 0 };
    if (env.FILES) {
      let cursor;
      do {
        const listed = await env.FILES.list({ cursor, limit: 1000 });
        for (const key of listed.keys) {
          kvStats.fileCount++;
          if (key.metadata && key.metadata.size) {
            kvStats.totalBytes += key.metadata.size;
          }
        }
        cursor = listed.cursor;
        if (listed.list_complete) break;
      } while (cursor);
    }

    let cloudinaryStats = null;
    let cloudinaryError = null;
    if (!env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET || !env.CLOUDINARY_CLOUD_NAME) {
      cloudinaryError = 'no_credentials';
    } else {
      try {
        const auth = btoa(`${env.CLOUDINARY_API_KEY}:${env.CLOUDINARY_API_SECRET}`);
        const res = await fetch(`https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/usage`, {
          headers: { 'Authorization': `Basic ${auth}` }
        });
        const data = await res.json();
        if (res.ok) {
          cloudinaryStats = {
            storageBytes: data.storage?.usage || 0,
            storageLimitBytes: data.storage?.limit || 26843545600,
            resources: data.objects?.usage || 0,
          };
        } else {
          cloudinaryError = `api_error:${res.status}:${data.error?.message || JSON.stringify(data)}`;
          console.error('[storageStats] Cloudinary API error:', res.status, JSON.stringify(data));
        }
      } catch (e) {
        cloudinaryError = `fetch_error:${e.toString()}`;
        console.error('[storageStats] Cloudinary fetch error:', e.toString());
      }
    }

    return new Response(JSON.stringify({ kv: kvStats, cloudinary: cloudinaryStats, cloudinaryError }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.toString() }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// -------------------------------------------------------------
// 管理者: 全ファイル一括削除
// -------------------------------------------------------------
async function handleBulkDeleteFiles(request, env) {
  try {
    let kvDeleted = 0;
    if (env.FILES) {
      let cursor;
      do {
        const listed = await env.FILES.list({ cursor, limit: 1000 });
        for (const key of listed.keys) {
          await env.FILES.delete(key.name);
          kvDeleted++;
        }
        cursor = listed.cursor;
        if (listed.list_complete) break;
      } while (cursor);
    }

    let cloudinaryDeleted = false;
    if (env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET && env.CLOUDINARY_CLOUD_NAME) {
      try {
        const auth = btoa(`${env.CLOUDINARY_API_KEY}:${env.CLOUDINARY_API_SECRET}`);
        const res = await fetch(
          `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/resources/image/upload?all=true`,
          { method: 'DELETE', headers: { 'Authorization': `Basic ${auth}` } }
        );
        cloudinaryDeleted = res.ok;
      } catch (_) {}
    }

    return new Response(JSON.stringify({ success: true, kvDeleted, cloudinaryDeleted }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.toString() }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// -------------------------------------------------------------
// Cloudinary SHA-1 署名生成
// -------------------------------------------------------------
async function cloudinarySign(params, apiSecret) {
  const sortedKeys = Object.keys(params).sort();
  const paramStr = sortedKeys.map(k => `${k}=${params[k]}`).join('&') + apiSecret;
  const hashBuffer = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(paramStr));
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// -------------------------------------------------------------
// Cloudinary ファイル削除
// -------------------------------------------------------------
async function handleDeleteCloudinaryFile(request, env, url) {
  try {
    if (!env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET || !env.CLOUDINARY_CLOUD_NAME) {
      return new Response(JSON.stringify({ error: 'no_credentials' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const publicId = url.searchParams.get('publicId');
    const resourceType = url.searchParams.get('resourceType') || 'image';

    if (!publicId) {
      return new Response(JSON.stringify({ error: 'publicId is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = await cloudinarySign({ public_id: publicId, timestamp }, env.CLOUDINARY_API_SECRET);

    const formData = new FormData();
    formData.append('public_id', publicId);
    formData.append('timestamp', timestamp);
    formData.append('api_key', env.CLOUDINARY_API_KEY);
    formData.append('signature', signature);

    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/${resourceType}/destroy`,
      { method: 'POST', body: formData }
    );
    const data = await res.json();

    if (data.result === 'ok' || data.result === 'not found') {
      return new Response(JSON.stringify({ success: true, result: data.result }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.error('[Worker/cloudinaryDelete] Unexpected result:', JSON.stringify(data));
    return new Response(JSON.stringify({ error: data.error?.message || '削除に失敗しました', result: data.result }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('[Worker/cloudinaryDelete] Error:', err.toString());
    return new Response(JSON.stringify({ error: err.toString() }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// -------------------------------------------------------------
// 外部ファイル共有プロキシ（catbox.moe → 0x0.st の順で試行）
// -------------------------------------------------------------
async function handleShareFile(request, env) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!file) {
      return new Response(JSON.stringify({ error: 'ファイルが見つかりません' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // ArrayBufferとして読み込んでBlobを再構築（Worker間の転送を安定させる）
    const arrayBuffer = await file.arrayBuffer();
    const blob = new Blob([arrayBuffer], { type: file.type || 'application/octet-stream' });
    const fileName = file.name || 'file';

    // 1. catbox.moe を試す
    try {
      const f1 = new FormData();
      f1.append('reqtype', 'fileupload');
      f1.append('fileToUpload', blob, fileName);
      const r1 = await fetch('https://catbox.moe/user/api.php', { method: 'POST', body: f1 });
      const t1 = (await r1.text()).trim();
      if (t1.startsWith('https://')) {
        return new Response(JSON.stringify({ url: t1, service: 'catbox.moe' }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      console.warn('[shareFile] catbox.moe failed:', r1.status, t1.slice(0, 100));
    } catch (e1) {
      console.warn('[shareFile] catbox.moe error:', e1.toString());
    }

    // 2. 0x0.st にフォールバック
    try {
      const f2 = new FormData();
      f2.append('file', blob, fileName);
      const r2 = await fetch('https://0x0.st', { method: 'POST', body: f2 });
      const t2 = (await r2.text()).trim();
      if (t2.startsWith('https://')) {
        return new Response(JSON.stringify({ url: t2, service: '0x0.st' }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      console.warn('[shareFile] 0x0.st failed:', r2.status, t2.slice(0, 100));
    } catch (e2) {
      console.warn('[shareFile] 0x0.st error:', e2.toString());
    }

    return new Response(JSON.stringify({ error: 'すべてのアップロードサービスに失敗しました' }), {
      status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Proxy error', details: err.toString() }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}


async function verifyFirebaseIdToken(idToken, env) {
  try {
    const url = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${env.FIREBASE_API_KEY}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken })
    });
    const data = await res.json();
    if (data.error || !data.users || data.users.length === 0) return null;
    return data.users[0].localId;
  } catch (e) {
    return null;
  }
}

async function handleSetOffline(request, env) {
  try {
    const bodyText = await request.text();
    const data = JSON.parse(bodyText);
    const { userId, appId, idToken } = data;

    if (!userId || !appId || !idToken) {
      return new Response("Missing fields", { status: 400, headers: corsHeaders });
    }

    const verifiedUid = await verifyFirebaseIdToken(idToken, env);
    if (!verifiedUid || verifiedUid !== userId) {
      return new Response("Unauthorized", { status: 401, headers: corsHeaders });
    }

    const workerToken = await getWorkerAuthToken(env);
    if (!workerToken) return new Response("Worker Auth failed", { status: 500, headers: corsHeaders });

    const projectId = env.FIREBASE_PROJECT_ID;

    // state を直接 offline に設定
    const docUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/artifacts/${appId}/status/${userId}?updateMask.fieldPaths=state&updateMask.fieldPaths=last_changed`;
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
