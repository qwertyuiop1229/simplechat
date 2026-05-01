const fs = require('fs');
const html = fs.readFileSync('public/index.html', 'utf-8');
const scriptStart = html.indexOf('<script type="module">');
const scriptEnd = html.lastIndexOf('</script>');
const jsCode = html.substring(scriptStart + 22, scriptEnd);
fs.writeFileSync('public/app.js', jsCode);
const newHtml = html.substring(0, scriptStart) + '<script type="module" src="./app.js"></script>\n</body>\n</html>';
fs.writeFileSync('public/index.html', newHtml);
console.log('Extraction complete');
