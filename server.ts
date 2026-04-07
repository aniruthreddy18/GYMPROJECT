import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import cors from "cors";
import morgan from "morgan";
import cron from "node-cron";
import { addDays, format, parseISO } from "date-fns";
import admin from "firebase-admin";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import firebaseConfig from "./firebase-applet-config.json";

// Initialize Firebase Admin
admin.initializeApp({
  projectId: firebaseConfig.projectId
});
const db = getFirestore(firebaseConfig.firestoreDatabaseId);

const app = express();
const PORT = 3000;

app.use(cors());
app.use(morgan("dev"));
app.use(express.json());

// --- API Routes (Removed, now using Firestore directly in frontend) ---

// Automation: Reminder Job for a specific user
async function runReminderJobForUser(userId: string) {
  const today = new Date();
  const todayStr = format(today, "yyyy-MM-dd");

  try {
    // Fetch settings for this user
    const settingsRef = db.collection("users").doc(userId).collection("settings").doc("config");
    const settingsDoc = await settingsRef.get();
    
    if (!settingsDoc.exists) return { success: false, message: `Settings not found for user ${userId}` };
    const config = settingsDoc.data() as any;

    const reminderDaysBefore = parseInt(config.reminder_days_before) || 2;
    const overdueFrequency = parseInt(config.overdue_reminder_frequency) || 2;
    const upcomingMessageTemplate = config.upcoming_message || "the payment for the next month is in next {days} days try to pay as soon as possible";
    const overdueMessage = config.overdue_message || "payment of gym fees is pending pay as soon as possible";
    const webhookUrl = config.whatsapp_webhook_url ? String(config.whatsapp_webhook_url).trim() : null;

    const sendWebhook = async (member: any, message: string, type: string) => {
      if (!webhookUrl || !webhookUrl.startsWith("http")) {
        console.log(`[WHATSAPP] Skipping webhook for user ${userId} (URL: ${webhookUrl})`);
        return { status: "skipped" };
      }
      try {
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId,
            memberName: member.name,
            phone: member.phone,
            message,
            type,
            timestamp: new Date().toISOString()
          })
        });
        if (response.ok) return { status: "sent_to_webhook" };
        console.error(`Webhook failed with status ${response.status}`);
        return { status: "webhook_failed" };
      } catch (e) {
        console.error(`Webhook error:`, e);
        return { status: "webhook_error" };
      }
    };

    const reminderDateStr = format(addDays(today, reminderDaysBefore), "yyyy-MM-dd");

    let processedCount = 0;
    const userMembersRef = db.collection("users").doc(userId).collection("members");
    const userPaymentsRef = db.collection("users").doc(userId).collection("payments");
    const userLogsRef = db.collection("users").doc(userId).collection("automation_logs");

    // 1. Upcoming Reminders
    const upcomingSnap = await userPaymentsRef
      .where("status", "==", "pending")
      .where("due_date", "==", reminderDateStr)
      .get();

    for (const pDoc of upcomingSnap.docs) {
      const p = pDoc.data();
      if (p.last_reminder_date === todayStr) continue;

      const memberSnap = await userMembersRef.doc(p.member_id).get();
      if (!memberSnap.exists) continue;
      const m = memberSnap.data() as any;

      const message = upcomingMessageTemplate.replace("{days}", String(reminderDaysBefore));
      console.log(`[WHATSAPP] User:${userId} To ${m.phone} (${m.name}): ${message}`);
      
      const webhookResult = await sendWebhook(m, message, "upcoming_reminder");

      await userLogsRef.add({
        type: "upcoming_reminder",
        member_id: p.member_id,
        member_name: m.name,
        phone: m.phone,
        message: message,
        timestamp: FieldValue.serverTimestamp(),
        status: webhookResult.status
      });

      await pDoc.ref.update({ last_reminder_date: todayStr });
      processedCount++;
    }

    // 2. Overdue Reminders
    const overdueSnap = await userPaymentsRef
      .where("status", "==", "pending")
      .where("due_date", "<", todayStr)
      .get();

    for (const pDoc of overdueSnap.docs) {
      const p = pDoc.data();
      const memberSnap = await userMembersRef.doc(p.member_id).get();
      if (!memberSnap.exists) continue;
      const m = memberSnap.data() as any;

      let shouldSend = false;
      if (!p.last_reminder_date) {
        shouldSend = true;
      } else {
        const lastSent = parseISO(p.last_reminder_date);
        const daysSinceLast = Math.floor((today.getTime() - lastSent.getTime()) / (1000 * 60 * 60 * 24));
        if (daysSinceLast >= overdueFrequency) {
          shouldSend = true;
        }
      }

      if (shouldSend) {
        const message = overdueMessage;
        console.log(`[WHATSAPP OVERDUE] User:${userId} To ${m.phone} (${m.name}): ${message}`);
        
        const webhookResult = await sendWebhook(m, message, "overdue_reminder");

        await userLogsRef.add({
          type: "overdue_reminder",
          member_id: p.member_id,
          member_name: m.name,
          phone: m.phone,
          message: message,
          timestamp: FieldValue.serverTimestamp(),
          status: webhookResult.status
        });

        await pDoc.ref.update({ last_reminder_date: todayStr });
        processedCount++;
      }
    }
    return { success: true, processedCount };
  } catch (err) {
    console.error(`Reminder job error for user ${userId}:`, err);
    return { success: false, error: String(err) };
  }
}

async function runAllReminders() {
  console.log("Starting global reminder job...");
  try {
    const usersSnap = await db.collection("users").get();
    let totalProcessed = 0;
    for (const userDoc of usersSnap.docs) {
      const result = await runReminderJobForUser(userDoc.id);
      if (result.success) {
        totalProcessed += result.processedCount || 0;
      }
    }
    console.log(`Global reminder job finished. Total processed: ${totalProcessed}`);
    return { success: true, totalProcessed };
  } catch (err) {
    console.error("Global reminder job error:", err);
    return { success: false, error: String(err) };
  }
}

// Runs at 08:00 AM IST (02:30 AM UTC)
cron.schedule("30 2 * * *", runAllReminders);

app.post("/api/trigger-reminders", async (req, res) => {
  // If a userId is provided in the body, run for that user only
  // Otherwise run for all (default behavior for manual trigger)
  const { userId } = req.body;
  if (userId) {
    const result = await runReminderJobForUser(userId);
    res.json(result);
  } else {
    const result = await runAllReminders();
    res.json(result);
  }
});

app.post("/api/proxy-webhook", async (req, res) => {
  let { url, data } = req.body;
  if (!url) return res.status(400).json({ success: false, error: "URL is required" });

  // Clean the URL (remove leading/trailing spaces)
  url = String(url).trim();
  
  if (!url.startsWith("http")) {
    return res.status(400).json({ 
      success: false, 
      error: "Invalid URL. It must start with http:// or https://",
      attemptedUrl: url 
    });
  }

  console.log(`[PROXY] Attempting to hit URL: "${url}"`);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(data)
    });
    
    console.log(`[PROXY] n8n responded with status: ${response.status}`);
    if (response.ok) {
      res.json({ success: true });
    } else {
      const errorText = await response.text();
      console.error(`[PROXY] n8n error body: ${errorText}`);
      // Return the URL back to the user so they can double check it
      res.status(response.status).json({ 
        success: false, 
        error: `HTTP ${response.status}: ${errorText}`,
        attemptedUrl: url 
      });
    }
  } catch (error) {
    console.error("[PROXY] Network/Fetch error:", error);
    res.status(500).json({ success: false, error: `Network error: ${String(error)}`, attemptedUrl: url });
  }
});

// --- Vite Integration ---

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
