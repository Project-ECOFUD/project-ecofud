import express from "express";
import expressWs from "express-ws";
import env from "./env";
import { Payment } from "./db";
import sequelize from "sequelize";
import { LndHttpClient } from "./lndhttp";
import { pubkeyHexToUrlEncodedBase64 } from "./lnd";

const expressApp = express();
const wsApp = expressWs(expressApp);
const app = wsApp.app;
app.set("port", env.PORT);

export function initializeApi(lnd1: LndHttpClient, lnd2: LndHttpClient) {
  // Returns an array of the node's info
  app.get("/info", async (_, res, next) => {
    try {
      const lnd1Info = await lnd1.getInfo();
      const lnd2Info = await lnd2.getInfo();
      const channel = (
        await lnd1.getChannels({
          peer: pubkeyHexToUrlEncodedBase64(lnd2Info.identity_pubkey),
        })
      ).channels[0];
      res.json({ lnd1Info, lnd2Info, channel });
    } catch (err) {
      next(err);
    }
  });

  // Returns the number of transactions and total value in the db
  app.get("/payments", (_, res, next) => {
    getPaymentsInfo().then(res.json).catch(next);
  });

  // Socket for getting regular updates about transaction info
  app.ws("/payments", (ws) => {
    ws.on("open", () => {
      console.info("Payments socket opened");
      // Send once immediately, let the interval do all subsequent updating
      getPaymentsInfo().then((pi) => ws.send(JSON.stringify(pi)));
    });
    ws.on("close", () => {
      console.info("Payments socket closed");
    });
  });

  // Send an update to all socket listeners whenever the cache expires
  const sendPaymentsUpdate = async () => {
    const { clients } = wsApp.getWss();
    if (clients.size > 0) {
      const piJson = JSON.stringify(await getPaymentsInfo());
      console.debug(
        `Sending update to ${clients.size} sockets with payment info ${piJson}`,
      );
      wsApp.getWss().clients.forEach((client) => client.send(piJson));
    }
    setTimeout(sendPaymentsUpdate, CACHED_TX_INTERVAL + 1);
  };
  sendPaymentsUpdate();

  return new Promise((resolve, reject) => {
    try {
      app.listen(env.PORT, () => {
        resolve(app);
      });
    } catch (err) {
      reject(err);
    }
  });
}

interface CachedPaymentsInfo {
  count: number;
  totalAmount: number;
  cachedAt: number;
}

let cachedPaymentsInfo: CachedPaymentsInfo | null = null;
const CACHED_TX_INTERVAL = 3000; // 3s
async function getPaymentsInfo() {
  if (
    cachedPaymentsInfo &&
    Date.now() - cachedPaymentsInfo.cachedAt < CACHED_TX_INTERVAL
  ) {
    return Promise.resolve({
      count: cachedPaymentsInfo.count,
      amount: cachedPaymentsInfo.totalAmount,
    });
  }

  const txCountPromise = Payment.count();
  const txAmountPromise = Payment.findAll({
    attributes: [[sequelize.fn("sum", sequelize.col("amount")), "amount"]],
  });
  return Promise.all([txCountPromise, txAmountPromise]).then(([count, amount]) => {
    cachedPaymentsInfo = {
      count: count,
      totalAmount: amount.reduce((prev, amt) => prev + amt.amount, 0),
      cachedAt: Date.now(),
    };
    return {
      count: cachedPaymentsInfo.count,
      amount: cachedPaymentsInfo.totalAmount,
    };
  });
}
