import axios, { Axios, AxiosResponse } from "axios";
import { Network } from "./constants";
import { Chain } from "@chain-registry/types";
import { URL } from "url";

interface Stats {
    endpoint: string,
    ok: number,
    fail: number
}

export enum EndpointType {
    REST = "rest",
    RPC = "rpc"
}

export class NetworkManager {
    readonly minRequestsToTest: number = 20;
    readonly minSuccessRate: number = 0.85;
    readonly network: string = "";
    endpointRankings: Map<EndpointType, Stats[]> = new Map();

    private constructor(network: string, endpoints: Map<EndpointType, URL[]>) {
        this.network = network;
        [...endpoints.entries()].forEach(([type, rpcs]) => {
            let rpcStats = rpcs.map(rpc => ({ ok: 0, fail: 0, endpoint: rpc.toString() }));
            this.endpointRankings.set(type, rpcStats);
        })
    }

    static async create(network: Network, registryUrls: URL[]): Promise<NetworkManager> {
        let chainData = await this.fetchChainsData(registryUrls, network);
        let aliveRpc = await this.filterAliveRpcs(chainData?.apis?.rpc?.map(x => new URL(x.address))!)
        let aliveRest = await this.filterAliveRest(chainData?.apis?.rest?.map(x => new URL(x.address))!)

        return new NetworkManager(network, new Map([[EndpointType.RPC, aliveRpc], [EndpointType.REST, aliveRest]]));
    }

    //todo refactor these 2 functions
    static async filterAliveRpcs(urls: URL[]): Promise<URL[]> {
        if (urls == null || urls.length === 0)
            return Promise.reject("no rpcs");

        let alive = await Promise.all(urls.map(async (url) => {
            let response;
            try {
                response = await axios({
                    method: "GET",
                    url: `${url}/status`,
                    timeout: 5000
                });
            } catch (_) {
                console.log(`${url} is dead`)
            }

            if (!response || response.status !== 200)
                return;

            let blockTime = Date.parse(response.data.result.sync_info.latest_block_time);
            let blockHeight = parseInt(response.data.result.sync_info.latest_block_height);
            let now = Date.now();

            if (Math.abs(now - blockTime) < 60000) {
                console.log(`${url} is alive, sync block ${blockHeight}`);
                return url;
            }

            console.log(`${url} is alive, but not synced`);
            return;
        }));

        return alive.filter((x) : x is URL => !!x);
    }

    static async filterAliveRest(urls: URL[]): Promise<URL[]> {
        if (urls == null || urls.length === 0)
            return Promise.reject("no rpcs");

        let alive = await Promise.all(urls.map(async (url) => {
            let response;
            try {
                response = await axios({
                    method: "GET",
                    url: `${url}/blocks/latest`,
                    timeout: 5000
                });
            } catch (_) {
                console.log(`${url} is dead`)
            }

            if (!response || response.status !== 200)
                return;

            let blockTime = Date.parse(response.data.block.header.time);
            let blockHeight = parseInt(response.data.block.header.height);
            let now = Date.now();

            if (Math.abs(now - blockTime) < 60000) {
                console.log(`${url} is alive, sync block ${blockHeight}`);
                return url;
            }

            console.log(`${url} is alive, but not synced`);
            return;
        }));

        return alive.filter((x) : x is URL => !!x);
    }

    static async fetchChainsData(registryUrls: URL[], chain: Network): Promise<Chain> {
        for (let url of registryUrls) {
            try {
                let response = await axios.get<Chain>(
                    `${url}/${chain}/chain.json`,
                    { timeout: 10000 })

                return response.data;
            }
            catch (err: any) {
                console.log(err?.message);
                continue;
            }
        }

        throw new Error("Cannot get chain info from registry");
    }

    reportStats(endpoint: string, type: EndpointType, result: boolean): void {
        let endp = this.endpointRankings.get(type)!;

        if (!endp)
            throw Error(`Endpoint ${endpoint} doesnt exist`);
        
        let el = endp.find(x => x.endpoint === endpoint)!;
        result ? ++el.ok : --el.fail;
    }

    getEndpoints(type: EndpointType): string[] {
        let result = [...this.endpointRankings.get(type)!.entries()]
            .map(([_, value]) => value)
            .sort((a, b) => a.ok + a.fail > b.ok + b.fail ? 1 : -1);

        let minRequests =
            result.reduce((prev, cur) =>
                prev > cur.ok + cur.fail ? cur.ok + cur.fail : prev, Number.POSITIVE_INFINITY);

        if (minRequests < this.minRequestsToTest)
            return result.map(x => x.endpoint);

        return result
            .filter(x => x.ok / (x.ok + x.fail) > this.minSuccessRate)
            .sort((a, b) => {
                if (a.ok / a.fail <= 1)
                    return 1;

                if (b.ok / b.fail <= 1)
                    return -1;

                return (a.ok / (a.fail || 1)) > (b.ok / (b.fail || 1)) ? 1 : 0;
            })
            .map(x => x.endpoint);
    }
}