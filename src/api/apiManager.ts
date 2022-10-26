import axios from "axios";
import { EndpointType, NetworkManager } from "./networkManager";
import { Int53 } from "@cosmjs/math";
import { defaultRegistryUrls, Network } from "./constants";
import { URL } from "url";

export class ApiManager {
    readonly manager: NetworkManager;

    constructor(manager: NetworkManager) {
        this.manager = manager;
    }

    static async createApiManager(network: Network, registryUrls: URL[] = defaultRegistryUrls) {
        return new ApiManager(await NetworkManager.create(network, registryUrls));
    }

    async getActiveProposals(): Promise<Proposal[] | null> {
        let endpoints = this.manager.getEndpoints(EndpointType.REST);
        let result: Proposal[] = [];

        for (const rest of endpoints) {
            try {
                let paginationKey = "";
                do {
                    let url = rest + `/cosmos/gov/v1beta1/proposals?proposal_status=2&pagination.key=${paginationKey}`;
                    let { data } = await axios.get<ProposalsDTO>(url);
                    result.push(...data.proposals);
                    paginationKey = data.pagination.next_key;
                }
                while (paginationKey !== null);

                return result;
            } catch (err) { console.warn(`cannot fetch proposals from ${rest}`) }
        }

        console.error(`error fetching proposals with endp set ${endpoints}`)
        return null;
    }

    async getVoteTally(propId: number | string): Promise<TallyResult | null> {
        let endpoints = this.manager.getEndpoints(EndpointType.REST);

        for (const rest of endpoints) {
            try {
                let url = rest + `/cosmos/gov/v1beta1/proposals/${propId}/tally`;
                let { data } = await axios.get<{ tally: TallyResult }>(url);
                return data.tally;
            } catch (err) { console.warn(`cannot fetch tally from ${rest}`) }
        }

        console.error(`error fetching tally with endp set ${endpoints}`)
        return null;
    }

    async broadcastTx(bytes: string, mode: string = "BROADCAST_MODE_BLOCK"): Promise<boolean> {
        let endpoints = this.manager.getEndpoints(EndpointType.REST);

        for (const rest of endpoints) {
            try {
                let url = rest + `/cosmos/tx/v1beta1/txs`;
                let { data } = await axios.post<{ tx_response: { height: number } }>(url, { tx_bytes: bytes, mode });
                return data.tx_response.height > 0;
            } catch (err) { console.warn(`cannot broadcast tx to ${rest}`) }
        }

        console.error(`error broadcasting tx with endp set ${endpoints}`)
        return false;
    }

    async getLatestHeight(lastKnownHeight: number = 0): Promise<number> {
        let endpoints = this.manager.getEndpoints(EndpointType.RPC);

        let results = await Promise.all(endpoints.map(endp => {
            return (async () => {
                try {
                    let url = `${endp}/status`
                    let { data } = await axios({
                        method: "GET",
                        url,
                        timeout: 5000
                    });

                    return parseInt(data.result.sync_info.latest_block_height);
                } catch (err: any) { console.log(err?.message) }
            })();
        }));

        let success = results.map(x => x) as number[];
        let syncHeight = Math.max(...success);
        return Math.max(syncHeight, lastKnownHeight);
    }

    async getBlockHeader(height: number): Promise<BlockHeader> {
        let endpoints = this.manager.getEndpoints(EndpointType.RPC);
        for (const rpc of endpoints) {
            try {
                let url = `${rpc}/block?height=${height}`
                let { data } = await axios({
                    method: "GET",
                    url,
                    timeout: 5000
                });

                this.manager.reportStats(rpc, EndpointType.RPC, true);
                let header = data.result.block.header;
                return {
                    height: parseInt(header.height),
                    time: new Date(header.time),
                    hash: data.result.block_id.hash
                }
            } catch (err: any) {
                console.log(`Error fetching height in ${this.manager.network} rpc ${rpc} error : ${err?.message} stack: ${err?.stack}`);
                this.manager.reportStats(rpc, EndpointType.RPC, false);
            }
        }

        throw Error(`Couldn't get new height for network ${this.manager.network} with endpoints set ${JSON.stringify(endpoints)}`);

    }

    fromBase64(decoded?: string): string | undefined {
        if (decoded)
            return Buffer.from(decoded, 'base64').toString();
    }

    apiToSmallInt(input: string | number) {
        const asInt = Int53.fromString(input.toString());
        return asInt.toNumber();
    }

    tryParseJson(data: string): any {
        try {
            return JSON.parse(data);
        } catch (err: any) { }
    }

    async getTxsInBlock(height: number): Promise<Tx[]> {
        let endpoints = this.manager.getEndpoints(EndpointType.RPC)
        for (const rpc of endpoints) {
            try {
                let allTxs: RawTx[] = [];
                let totalTxs: number;
                let page = 1;

                do {
                    let url = `${rpc}/tx_search?query="tx.height%3D${height}"&page=${page++}`
                    let { data: { result } }: { data: { result: TxsResponse } } =
                        await axios({
                            method: "GET",
                            url,
                            timeout: 5000
                        });

                    totalTxs = result.total_count;
                    allTxs.push(...result.txs);
                }
                while (allTxs.length < totalTxs)

                let result: Tx[] = allTxs.map(data => {
                    return {
                        tx: this.fromBase64(data.tx),
                        code: this.apiToSmallInt(data.tx_result.code) || 0,
                        events: data.tx_result.events.map(ev => {
                            return {
                                type: ev.type,
                                attributes: ev.attributes.map(attr => {
                                    return {
                                        key: this.fromBase64(attr.key),
                                        value: this.fromBase64(attr.value)
                                    }
                                })
                            }
                        }),
                        log: this.tryParseJson(data.tx_result.log),
                        hash: data.hash,
                        data: this.fromBase64(data.tx_result.data),
                        height: data.height,
                        index: data.index
                    }
                });

                if (result.length !== 0)
                    return result;

            } catch (err: any) {
                console.log(`Error fetching txs in ${this.manager.network}/${height} rpc ${rpc} error : ${err?.message} stack: ${err?.stack}`);
                this.manager.reportStats(rpc, EndpointType.RPC, false);
            }
        }

        return [];
    }
}

interface ProposalsDTO {
    proposals: Proposal[],
    pagination: {
        next_key: string,
        total: string
    }
}

export enum ProposalStatus {
    DEPOSIT = "PROPOSAL_STATUS_DEPOSIT_PERIOD",
    VOTING = "PROPOSAL_STATUS_VOTING_PERIOD",
    PASSED = "PROPOSAL_STATUS_PASSED",
    REJECTED = "PROPOSAL_STATUS_REJECTED"
}

export interface TallyResult {
    yes: number,
    abstain: number,
    no: number,
    no_with_veto: number
}

export interface Proposal {
    proposal_id: string,
    status: ProposalStatus,
    final_tally_result: TallyResult,
    voting_end_time: Date,
}

export interface Tx {
    tx?: string;
    code: number;
    log: string;
    data?: string;
    events: {
        type: string,
        attributes: {
            key?: string,
            value?: string
        }[]
    }[];
    height: string;
    index: number;
    hash: string;
}

interface TxsResponse {
    txs: RawTx[],
    total_count: number
}

export interface BlockHeader {
    height: number,
    time: Date,
    hash: string
}

interface RawTx {
    tx?: string;
    tx_result: {
        code: number;
        log: string;
        data?: string;
        events: {
            type: string,
            attributes: {
                key?: string,
                value?: string
            }[]
        }[];
    };
    height: string;
    index: number;
    hash: string;
}