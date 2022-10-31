import axios from "axios";
import { EndpointType, NetworkManager } from "./networkManager";
import { defaultRegistryUrls, Network } from "./constants";
import { URL } from "url";
import { Coin } from "@cosmjs/proto-signing";
import { AccountResponse } from "@tharsis/provider";
import { DeliverTxResponse, StargateClient } from "@cosmjs/stargate";

export class ApiManager {
    readonly manager: NetworkManager;

    constructor(manager: NetworkManager) {
        this.manager = manager;
    }

    static async createApiManager(network: Network, registryUrls: URL[] = defaultRegistryUrls) {
        return new ApiManager(await NetworkManager.create(network, registryUrls));
    }

    async getSenderChaindata(addr: string): Promise<any> {
        let endpoints = this.manager.getEndpoints(EndpointType.REST);
        for (const endp of endpoints) {
            try {
                let { data: { account: { base_account } } } = await axios.get<AccountResponse>(
                    `${endp}/cosmos/auth/v1beta1/accounts/${addr}`
                );

                return {
                    accountAddress: base_account.address,
                    sequence: base_account.sequence,
                    accountNumber: base_account.account_number,
                    pubkey: base_account.pub_key?.key
                };
            } catch (err: any) { console.log(`Error getting accountinfo from ${endp} err ${err?.message}`) }
        }
    }

    async getRewards(address: string): Promise<Reward[]> {
        let endpoints = this.manager.getEndpoints(EndpointType.REST);

        for (const rest of endpoints) {
            try {
                let rewardsUrl = `${rest}/cosmos/distribution/v1beta1/delegators/${address}/rewards`;
                let result = await axios.get<Rewards>(rewardsUrl)
                return result.data.rewards;
            } catch (err: any) { console.log(`Error getting rewards info from ${rest} err ${err?.message}`) }
        }

        return [];
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

    async getBalance(address: string, denom: string): Promise<string | undefined> {
        let endpoints = this.manager.getEndpoints(EndpointType.REST);

        for (let endpoint of endpoints) {
            try {
                let balanceUrl = `${endpoint}/cosmos/bank/v1beta1/balances/${address}`;
                let { data: { balances } } = await axios.get<{ balances: Coin[] }>(balanceUrl);
                return balances?.find(x => x.denom === denom)?.amount;
            } catch (err: any) { console.log(err?.message) }
        }
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

    async broadcastTx(bytes: Uint8Array, mode: string = "BROADCAST_MODE_BLOCK"): Promise<DeliverTxResponse> {
        let endpoints = this.manager.getEndpoints(EndpointType.RPC);

        for (const rpc of endpoints) {
            try {
                let client = await StargateClient.connect(rpc);
                let result = await client.broadcastTx(bytes, 5000);
                return result;
            } catch (err) { console.warn(`cannot broadcast tx to ${rpc}`) }
        }

        return Promise.reject(`error broadcasting tx with endp set ${endpoints}`);
    }
}

export interface AccountInfo {
    accountAddress: string,
    sequence: string,
    accountNumber: string,
    pubkey: string
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

export interface Reward {
    validator_address: string,
    reward: Coin[]
}

export interface Rewards { rewards: Reward[] }

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