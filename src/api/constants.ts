import { URL } from "url";

export enum Network {
    COSMOS = "cosmoshub",
    OSMOSIS = "osmosis",
    JUNO = "juno",
    EVMOS = "evmos"
}

export enum RecieveData { 
    HEIGHT,
    HEADERS,
    HEADERS_AND_TRANSACTIONS
}

export const defaultRegistryUrls = [
    new URL("https://registry.ping.pub/"),
    new URL("https://proxy.atomscan.com/directory/")
]

export enum IndexerEvents {
    BLOCK_RECIEVED = "block-recieved"
}