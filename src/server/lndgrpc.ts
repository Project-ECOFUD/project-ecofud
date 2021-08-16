import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "path";
import * as T from "./lndtypes";

// Due to updated ECDSA generated tls.cert we need to let gprc know that
// we need to use that cipher suite otherwise there will be a handhsake
// error when we communicate with the lnd rpc server.
process.env.GRPC_SSL_CIPHER_SUITES = "HIGH+ECDSA:ECDHE-RSA-AES128-GCM-SHA256";

// We need to give the proto loader some extra options, otherwise the code won't
// fully work with lnd.
const loaderOptions = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
};
const packageDefinition = protoLoader.loadSync(
  path.resolve(__dirname, "lightning.proto"),
  loaderOptions,
);
const lnrpcDescriptor = grpc.loadPackageDefinition(packageDefinition);
const lnrpc = lnrpcDescriptor.lnrpc as any;

export class LndGrpcClient {
  rpc: any;
  requestMetadata?: object;

  constructor(host: string, macaroonHex: string, certb64?: string) {
    // const sslCreds = grpc.credentials.createSsl(lndCert);
    let creds: grpc.ChannelCredentials;
    if (certb64) {
      const lndCert = Buffer.from(certb64, "base64");
      const sslCreds = grpc.credentials.createSsl(lndCert);
      const macaroonCreds = grpc.credentials.createFromMetadataGenerator((_, cb) => {
        const metadata = new grpc.Metadata();
        metadata.add("macaroon", macaroonHex);
        cb(null, metadata);
      });
      creds = grpc.credentials.combineChannelCredentials(sslCreds, macaroonCreds);
    } else {
      creds = grpc.credentials.createInsecure();
      const metadata = new grpc.Metadata();
      metadata.add("macaroon", macaroonHex);
      this.requestMetadata = metadata;
      console.log(metadata);
    }
    this.rpc = new lnrpc.Lightning(host, creds);
  }

  // Public API methods
  getInfo = () => {
    return this.request<T.GetInfoResponse>(this.rpc.getInfo);
  };

  getChannels = (args: T.GetChannelsArguments = {}) => {
    return this.request<T.GetChannelsResponse, T.GetChannelsArguments>(
      this.rpc.listChannels,
      args,
    );
  };

  getChannelsBalance = () => {
    return this.request<T.GetChannelsBalanceResponse>(this.rpc.channelBalance);
  };

  createInvoice = (args: T.CreateInvoiceArguments) => {
    return this.request<T.CreateInvoiceResponse, T.CreateInvoiceArguments>(
      this.rpc.addInvoice,
    );
  };

  sendPayment = (args: T.SendPaymentArguments) => {
    return this.request<any, T.SendPaymentArguments>(this.rpc.sendPaymentSync, args).then(
      (res) => {
        if (res.payment_error) {
          // Make it easy to convert on the other side
          throw new Error(`SendPaymentSync: ${res.payment_error}`);
        }
        return {
          ...res,
          payment_preimage: Buffer.from(res.payment_preimage, "base64").toString("hex"),
        } as T.SendPaymentResponse;
      },
    );
  };

  deletePaymentHistory = () => {
    return this.request<{}>("deleteAllPayments");
  };

  // Wraps around RPC requests, promisifies and types
  protected async request<R extends object, A extends object | undefined = undefined>(
    method: any,
    args?: A,
  ): Promise<R> {
    return new Promise((resolve, reject) => {
      this.rpc[method](
        args || {},
        (err: Error | undefined, data: R) => {
          err ? reject(err) : resolve(data);
        },
        this.requestMetadata,
      );
    });
  }
}
