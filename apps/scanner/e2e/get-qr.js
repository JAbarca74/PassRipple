// Maestro script: the fixture ticket's QR text, valid now, from the mock API.
const response = http.get("http://localhost:8787/e2e/qr");
if (!response.ok) throw new Error(`mock API answered ${response.status}`);
output.qr = response.body;
