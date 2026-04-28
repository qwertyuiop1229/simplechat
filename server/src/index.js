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
