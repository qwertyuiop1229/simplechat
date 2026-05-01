const fs = require('fs');
let appJs = fs.readFileSync('public/app.js', 'utf-8');

// 1. Add currentServerId to variables
appJs = appJs.replace('let currentRoomId = null;', 'let currentServerId = null;\n      let currentRoomId = null;');

// 2. Change path replacements (except settings and users)
appJs = appJs.replace(/artifacts\/\$\{appId\}\/public\/data\/rooms/g, 'artifacts/${appId}/servers/${currentServerId}/rooms');
appJs = appJs.replace(/artifacts\/\$\{appId\}\/status/g, 'artifacts/${appId}/servers/${currentServerId}/status');
appJs = appJs.replace(/artifacts\/\$\{appId\}\/users\/\$\{userId\}\/profile/g, 'artifacts/${appId}/servers/${currentServerId}/profiles/${userId}');
appJs = appJs.replace(/artifacts\/\$\{appId\}\/users\/\$\{rid\}\/profile/g, 'artifacts/${appId}/servers/${currentServerId}/profiles/${rid}'); // if any
appJs = appJs.replace(/artifacts\/\$\{appId\}\/readReceipts/g, 'artifacts/${appId}/servers/${currentServerId}/readReceipts');

// 3. Cloudflare worker setOffline
appJs = appJs.replace(/JSON\.stringify\(\{\s*userId,\s*appId\s*\}\)/g, 'JSON.stringify({ userId, appId, serverId: currentServerId })');

// 4. Cloudflare worker sendNotification
appJs = appJs.replace(/body: JSON\.stringify\(\{\s*receiverIds,\s*title,\s*body,\s*roomId,\s*appId,\s*senderId\s*\}\)/g, 'body: JSON.stringify({ receiverIds, title, body, roomId, serverId: currentServerId, appId, senderId })');

// 5. Cloudflare worker joinRoom -> joinServer
// We need to keep joinRoom modal for rooms? No, rooms don't have passwords anymore in this new design, or do they?
// The user said: "サーバーにはいるにはサーバーのidを入力してそのサーバーのパスワードを入力しないと入れないようにして"
// So server has password. Rooms don't need passwords anymore because the server is protected.
// Let's modify handleJoinRoom to handleJoinServer.
appJs = appJs.replace(/\/api\/joinRoom/g, '/api/joinServer');
appJs = appJs.replace(/const { roomId, password/g, 'const { serverId: roomId, password'); // quick hack to send serverId instead of roomId in the JSON if we reuse the UI

// We need a script to inject the server list fetching and rendering logic.
// We'll write it to scratch/inject_servers.js and then append it to appJs or inject it.

fs.writeFileSync('public/app.js', appJs);
console.log('Replacements complete');
