import fetch from "node-fetch";
import { db } from "./db";
import { initializeLnds, sendBackAndForthForever } from "./lnd";
import { initializeApi } from "./api";

async function start() {
  try {
    console.info("Fetching external IP...");
    const res = await fetch("https://api.ipify.org");
    const ip = await res.text();
    console.info(`IP address is ${ip}!`);
  } catch (err) {
    console.error("Failed to fetch IP address!", err);
  }

  console.info("Initializing database...");
  await db.sync({ force: false });
  console.info("Database initialized!");

  console.info("Initializing LND connections...");
  const { lnd1, lnd2 } = await initializeLnds();
  console.info("LND connection initialized!");

  console.info("Initializing API...");
  await initializeApi(lnd1, lnd2);
  console.info("API Initialized!");

  console.info("Beginning infinite sends...");
  await sendBackAndForthForever(lnd1, lnd2);
}

start()
  .then(() => {
    console.info("Server successfully fully started!");
  })
  .catch((err: any) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
