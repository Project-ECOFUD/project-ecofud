import fetch, { Headers } from "node-fetch";
import { stringify } from "query-string";
import * as T from "./lndtypes";

export type ApiMethod = "GET" | "POST" | "PUT" | "DELETE";

export class LndHttpClient {
  url: string;
  macaroon: undefined | T.Macaroon;

  constructor(url: string, macaroon?: T.Macaroon) {
    // Remove trailing slash for consistency
    this.url = url.replace(/\/$/, "");
    this.macaroon = macaroon;
  }

  // Public API methods
  getInfo = () => {
    return this.request<T.GetInfoResponse>("GET", "/v1/getinfo", undefined, {
      uris: [],
      num_active_channels: 0,
      num_peers: 0,
      synced_to_chain: false,
      block_height: 0,
      num_pending_channels: 0,
      testnet: false,
      chains: [],
    }).then((res) => {
      // API can return chain as { chain: 'bitcoin', network: 'testnet' }
      res.chains = res.chains.map((chain: any) => {
        return chain.chain || chain;
      });
      return res;
    });
  };

  getChannels = (args?: T.GetChannelsArguments) => {
    return this.request<T.GetChannelsResponse, T.GetChannelsArguments>(
      "GET",
      "/v1/channels",
      args,
      {
        channels: [],
      },
    ).then((res) => {
      // Default attributes for channels
      res.channels = res.channels.map((channel) => {
        return Object.assign(
          {
            status: T.CHANNEL_STATUS.OPEN,
            csv_delay: 0,
            num_updates: 0,
            private: false,
            pending_htlcs: [],
            remote_balance: "0",
            commit_weight: "0",
            capacity: "0",
            local_balance: "0",
            total_satoshis_received: "0",
            active: false,
            commit_fee: "0",
            fee_per_kw: "0",
            unsettled_balance: "0",
            total_satoshis_sent: "0",
            remote_node_pub: (channel as any).remote_pubkey,
          },
          channel,
        );
      });
      return res;
    });
  };

  getChannelsBalance = () => {
    return this.request<T.GetChannelsBalanceResponse>(
      "GET",
      "/v1/balance/channels",
      undefined,
      {
        pending_open_balance: "0",
        balance: "0",
      },
    );
  };

  createInvoice = (args: T.CreateInvoiceArguments) => {
    return this.request<T.CreateInvoiceResponse, T.CreateInvoiceArguments>(
      "POST",
      "/v1/invoices",
      args,
    );
  };

  sendPayment = (args: T.SendPaymentArguments) => {
    return this.request<any, T.SendPaymentArguments>(
      "POST",
      "/v1/channels/transactions",
      args,
    ).then((res) => {
      if (res.payment_error) {
        // Make it easy to convert on the other side
        throw new Error(`SendTransactionError: ${res.payment_error}`);
      }
      return {
        ...res,
        payment_preimage: new Buffer(res.payment_preimage, "base64").toString("hex"),
      } as T.SendPaymentResponse;
    });
  };

  // Internal fetch function
  protected async request<R extends object, A extends object | undefined = undefined>(
    method: ApiMethod,
    path: string,
    args?: A,
    defaultValues?: Partial<R>,
  ): Promise<R> {
    let body = undefined;
    let query = "";
    const headers = new Headers();
    headers.append("Accept", "application/json");

    if (method === "POST") {
      body = JSON.stringify(args);
      headers.append("Content-Type", "application/json");
    } else if (args !== undefined) {
      // TS Still thinks it might be undefined(?)
      query = `?${stringify(args as any)}`;
    }

    if (this.macaroon) {
      headers.append("Grpc-Metadata-macaroon", this.macaroon);
    }

    try {
      const res = await fetch(this.url + path + query, {
        method,
        headers,
        body,
      });
      if (!res.ok) {
        let errBody: any;
        try {
          errBody = await res.json();
          if (!errBody.error) {
            throw new Error();
          }
        } catch (err) {
          throw {
            statusText: res.statusText,
            status: res.status,
          } as T.LndAPIResponseError;
        }
        console.log("errBody", errBody);
        throw errBody as T.LndAPIResponseError;
      }
      const json = await res.json();
      if (defaultValues) {
        // TS can't handle generic spreadables
        return { ...(defaultValues as any), ...(json as any) } as R;
      }
      return json as R;
    } catch (err) {
      console.error(`API error calling ${method} ${path}`, err);
      // Thrown errors must be JSON serializable, so include metadata if possible
      if (err.code || err.status || !err.message) {
        throw err;
      }
      throw err.message;
    }
  }
}
