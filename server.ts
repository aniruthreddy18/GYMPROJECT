import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import cors from "cors";
import morgan from "morgan";
import cron from "node-cron";
import { addDays, format, parseISO } from "date-fns";
import admin from "firebase-admin";

// Initialize Firebase Admin
// In Cloud Run, it will use the default service account
admin.initializeApp();
const db = admin.firestore();

const app = express();
const PORT = 3000;

app.use(cors());
app.use(morgan("dev"));
app.use(express.json());

// --- API Routes (Removed, now using Firestore directly in frontend) ---

// Automation: Daily Reminder Job
async function runReminderJob() {
  console.log("Running payment check...");
  const today = new Date();
  const todayStr = format(today, "yyyy-MM-dd");

  try {
    // Fetch settings
    const settingsSnap = await db.collection("settings").doc("config").get();
    if (!settingsSnap.exists) return { success: false, message: "Settings not found" };
    const config = settingsSnap.data() as any;

    const reminderDaysBefore = parseInt(config.reminder_days_before) || 2;
    const overdueFrequency = parseInt(config.overdue_reminder_frequency) || 2;
    const upcomingMessageTemplate = config.upcoming_message || "the payment for the next month is in next {days} days try to pay as soon as possible";
    const overdueMessage = config.overdue_message || "payment of gym fees is pending pay as soon as possible";

    const reminderDateStr = format(addDays(today, reminderDaysBefore), "yyyy-MM-dd");

    let processedCount = 0;

    // 1. Upcoming Reminders
    const upcomingSnap = await db.collection("payments")
      .where("status", "==", "pending")
      .where("due_date", "==", reminderDateStr)
      .get();

    for (const pDoc of upcomingSnap.docs) {
      const p = pDoc.data();
      
      // Prevent duplicate reminders on the same day
      if (p.last_reminder_date === todayStr) continue;

      const memberSnap = await db.collection("members").doc(p.member_id).get();
      if (!memberSnap.exists) continue;
      const m = memberSnap.data() as any;

      const message = upcomingMessageTemplate.replace("{days}", String(reminderDaysBefore));
      console.log(`[WHATSAPP] To ${m.phone} (${m.name}): ${message}`);
      
      // Log to Firestore
      await db.collection("automation_logs").add({
        type: "upcoming_reminder",
        member_id: p.member_id,
        member_name: m.name,
        phone: m.phone,
        message: message,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        status: "simulated"
      });

      // Update last reminder date
      await pDoc.ref.update({ last_reminder_date: todayStr });
      processedCount++;
    }

    // 2. Overdue Reminders
    const overdueSnap = await db.collection("payments")
      .where("status", "==", "pending")
      .where("due_date", "<", todayStr)
      .get();

    for (const pDoc of overdueSnap.docs) {
      const p = pDoc.data();
      const memberSnap = await db.collection("members").doc(p.member_id).get();
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
        console.log(`[WHATSAPP OVERDUE] To ${m.phone} (${m.name}): ${message}`);
        
        // Log to Firestore
        await db.collection("automation_logs").add({
          type: "overdue_reminder",
          member_id: p.member_id,
          member_name: m.name,
          phone: m.phone,
          message: message,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          status: "simulated"
        });

        await pDoc.ref.update({ last_reminder_date: todayStr });
        processedCount++;
      }
    }
    return { success: true, processedCount };
  } catch (err) {
    console.error("Reminder job error:", err);
    return { success: false, error: String(err) };
  }
}

// Runs at 08:00 AM IST (02:30 AM UTC)
cron.schedule("30 2 * * *", runReminderJob);

app.post("/api/trigger-reminders", async (req, res) => {
  const result = await runReminderJob();
  res.json(result);
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
