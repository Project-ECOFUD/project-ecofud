import { performance, PerformanceObserver } from "perf_hooks";
import { Payment } from "./db";
import env from "./env";
import { LndHttpClient } from "./lndhttp";
import { LndGrpcClient } from "./lndgrpc";

export type LndClient = LndHttpClient | LndGrpcClient;

export async function initializeLnds() {
  let lnd1: LndClient;
  let lnd2: LndClient;
  if (env.LND_USE_GRPC) {
    lnd1 = new LndGrpcClient(env.LND_1_GRPC_URL, env.LND_1_MACAROON, env.LND_1_TLS_CERT);
    lnd2 = new LndGrpcClient(env.LND_1_GRPC_URL, env.LND_2_MACAROON, env.LND_1_TLS_CERT);
  } else {
    lnd1 = new LndHttpClient(env.LND_1_REST_URL, env.LND_1_MACAROON);
    lnd2 = new LndHttpClient(env.LND_2_REST_URL, env.LND_2_MACAROON);
  }

  return { lnd1, lnd2 };
}

function decodeCert(cert: string) {
  return Buffer.from(cert, "base64").toString("ascii");
}

export async function sendBackAndForthForever(lnd1: LndClient, lnd2: LndClient) {
  // Grab the channel we'll use for sending, throw if we can't find it
  const lnd2Pubkey = (await lnd2.getInfo()).identity_pubkey;
  const channel = (
    await lnd1.getChannels({ peer: pubkeyHexToUrlEncodedBase64(lnd2Pubkey) })
  ).channels[0];

  if (!channel) {
    throw new Error(
      "Unable to find channel between lnd1 and lnd2, confirm channel is open",
    );
  }
  if (!channel.active) {
    throw new Error(
      "Channel between lnd1 and lnd2 is not active, cannot send between the two",
    );
  }

  console.log(`Using channel ${channel.chan_id} for sending!`);

  const directionIdentifier = (sender: LndClient) => {
    return sender === lnd1 ? "lnd1 -> lnd2" : "lnd2 -> lnd1";
  };

  const obs = new PerformanceObserver((items) => {
    items.getEntries().forEach((entry) => {
      console.log(entry);
    });
  });
  obs.observe({ entryTypes: ["measure"], buffered: true });

  // Define the recursive send function, once it starts the party don't stop
  const send = async (sender: LndClient, receiver: LndClient) => {
    performance.mark("start");
    // Generate an invoice
    const amount = env.PAYMENT_AMOUNT;
    const invoice = await receiver.createInvoice({
      value: amount.toString(), // 0.001btc
    });
    performance.mark("invoice");

    // Save invoice in db before it's paid
    const payment = await Payment.create({
      amount,
      paymentRequest: invoice.payment_request,
      rHash: rHashBufferToStr(invoice.r_hash),
    });
    performance.mark("db-payment");

    // Pay invoice
    await sender.sendPayment({
      payment_request: invoice.payment_request,
      outgoing_chan_id: channel.chan_id,
    });
    performance.mark("payment");

    // Otherwise, save the paid at timestamp
    payment.paidAt = new Date();
    await payment.save();
    console.info(
      `[${directionIdentifier(
        sender,
      )}] Send complete for ${amount} with rHash ${payment.rHash.slice(0, 8)}...`,
    );
    performance.mark("db-payment-update");

    // Send again in reverse order, retry on failures
    const reverseSend = async () => {
      try {
        await send(receiver, sender);
      } catch (err) {
        console.error(`[${directionIdentifier(receiver)}] Failed to send:`, err);
        console.info("Re-trying failed send in 5 seconds...");
        setTimeout(reverseSend, 5000);
      }
    };
    reverseSend();
  };

  // Kick off the sending cycle, with the larger balance between the 2 sending first
  // Don't try / catch, if the initial one fails then let the whole thing fail.
  for (let i = 0; i < env.PAYMENT_CONCURRENCY; i++) {
    parseFloat(channel.local_balance || "0") > parseFloat(channel.remote_balance || "0")
      ? send(lnd1, lnd2)
      : send(lnd2, lnd1);
  }
  console.info(`Initiated ${env.PAYMENT_CONCURRENCY} concurrent payments`);
}

export function rHashBufferToStr(rHash: string | Buffer | Uint8Array): string {
  return Buffer.from(rHash as Uint8Array).toString("hex");
}

export function pubkeyHexToUrlEncodedBase64(pubkey: string) {
  return encodeURI(Buffer.from(pubkey, "hex").toString("base64"));
}

export async function deletePaymentHistory(lnd1: LndClient, lnd2: LndClient) {
  console.log("Deleting LND 1's payment history...");
  await lnd1.deletePaymentHistory();
  console.log("LND 1 payment history deleted!");

  console.log("Deleting LND 2's payment history...");
  await lnd2.deletePaymentHistory();
  console.log("LND 2 payment history deleted!");
}

export function deletePaymentHistoryForever(lnd1: LndClient, lnd2: LndClient) {
  setTimeout(async () => {
    try {
      await deletePaymentHistory(lnd1, lnd2);
    } catch (err) {
      console.error("Failed to delete payment history:", err);
    }
    deletePaymentHistoryForever(lnd1, lnd2);
  }, 1000 * 60 * 5); // every 5 minutes
}
