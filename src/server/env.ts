import dotenv from "dotenv";
dotenv.config();

const env = {
  PORT: process.env.PORT || "3000",
  DATABASE_URL: process.env.DATABASE_URL as string,
  DATABASE_SSL: !!process.env.DATABASE_SSL,

  LND_1_GRPC_URL: process.env.LND_1_GRPC_URL as string,
  LND_1_MACAROON: process.env.LND_1_MACAROON as string,
  LND_1_TLS_CERT: process.env.LND_1_TLS_CERT as string,

  LND_2_GRPC_URL: process.env.LND_2_GRPC_URL as string,
  LND_2_MACAROON: process.env.LND_2_MACAROON as string,
  LND_2_TLS_CERT: process.env.LND_2_TLS_CERT as string,

  PAYMENT_AMOUNT: process.env.PAYMENT_AMOUNT
    ? parseInt(process.env.PAYMENT_AMOUNT, 10)
    : 1000,
  PAYMENT_CONCURRENCY: process.env.PAYMENT_CONCURRENCY
    ? parseInt(process.env.PAYMENT_CONCURRENCY, 10)
    : 10,
};

Object.entries(env).forEach(([key, value]) => {
  if (value === undefined || value === "" || value === NaN) {
    throw new Error(`Missing or invalid environment variable ${key}: ${value}`);
  }
});

export default env;
