// Dependencies
import Router from "@koa/router";
import Koa from "koa";
import bodyParser from "koa-bodyparser";
import serve from "koa-static";
import views from "koa-views";
import { MongoClient } from "mongodb";
import sha from "sha.js";

import remoteDataManager from "./remoteDataManager";

// Load models
import { MarketBoardHistoryEntry } from "./models/MarketBoardHistoryEntry";
import { MarketBoardItemListing } from "./models/MarketBoardItemListing";
import { MarketBoardListingsUpload } from "./models/MarketBoardListingsUpload";
import { MarketBoardSaleHistoryUpload } from "./models/MarketBoardSaleHistoryUpload";

import { HistoryTracker } from "./trackers/HistoryTracker";
import { PriceTracker } from "./trackers/PriceTracker";

// Define application and its resources
const db = MongoClient.connect(`mongodb://localhost:27017/`, { useNewUrlParser: true, useUnifiedTopology: true });

var historyTracker: HistoryTracker;
var priceTracker: PriceTracker;
const trackerInit = (async () => {
    const universalisDB = (await db).db("universalis");

    historyTracker = new HistoryTracker(
        universalisDB.collection("recentData"),
        universalisDB.collection("extendedHistory")
    );
    priceTracker = new PriceTracker(
        universalisDB.collection("recentData")
    );
})();

const universalis = new Koa();
universalis.use(bodyParser({
    enableTypes: ["json"],
    jsonLimit: "1mb"
}));

remoteDataManager.fetchAll(); // Fetch remote files asynchronously

// Logger TODO
universalis.use(async (ctx, next) => {
    await next();
    console.log(`${ctx.method} ${ctx.url}`);
});

// Set up renderer
universalis.use(views("./views", {
    extension: "pug"
}));

// Publish public resources
universalis.use(serve("./public"));

// Routing
const router = new Router();

router.get("/", async (ctx) => {
    await ctx.render("index.pug", {
        name: "Universalis - Crowdsourced Market Board Aggregator",
        version: require("../package.json").version
    });
});

router.get("/api/:world/:item", async (ctx) => { // Normal data
    const collection = (await db).db("universalis").collection("recentData");

    let query = { itemID: parseInt(ctx.params.item) };
    if (typeof ctx.params.world === "string") {
        query["dcName"] = ctx.params.world;
    } else {
        query["worldID"] = ctx.params.world;
    }

    let data = await collection.findOne(query);

    if (!data) {
        ctx.throw(404);
        return;
    }

    ctx.body = data;
});

router.get("/api/history/:world/:item", async (ctx) => { // Extended history
    const collection = (await db).db("universalis").collection("extendedHistory");

    let query = { itemID: parseInt(ctx.params.item) };
    if (typeof ctx.params.world === "string") {
        query["dcName"] = ctx.params.world;
    } else {
        query["worldID"] = ctx.params.world;
    }

    let data = await collection.findOne(query);

    if (!data) {
        ctx.throw(404);
        return;
    }

    ctx.body = data;
});

router.post("/upload/:apiKey", async (ctx) => {
    if (!ctx.params.apiKey) {
        return ctx.throw(401);
    }

    if (!ctx.is("json")) {
        return ctx.throw(415);
    }

    await trackerInit;

    // Accept identity via API key.
    const dbo = (await db).db("universalis");
    const trustedSource = await dbo.collection("trustedSources").findOne({
        apiKey: sha("sha512").update(ctx.params.apiKey).digest("hex")
    });
    if (!trustedSource) return ctx.throw(401);

    const sourceName = trustedSource.sourceName;

    // Data processing
    let marketBoardData: MarketBoardListingsUpload & MarketBoardSaleHistoryUpload = ctx.request.body;

    // You can't upload data for these worlds because you can't scrape it.
    // This does include Chinese and Korean worlds for the time being.
    if (!marketBoardData.worldID || !marketBoardData.itemID) return ctx.throw(415);
    if (marketBoardData.worldID <= 16 || marketBoardData.worldID >= 100) return ctx.throw(415);

    // TODO sanitation
    let dataArray: MarketBoardItemListing[] & MarketBoardHistoryEntry[] = [];
    if (marketBoardData.listings) {
        marketBoardData.listings.map((listing) => {
            return {
                creatorName: listing.creatorName ? listing.creatorName : undefined,
                hq: listing.hq,
                materia: listing.materia ? listing.materia : undefined,
                pricePerUnit: listing.pricePerUnit,
                quantity: listing.quantity,
                retainerCity: listing.retainerCity,
                retainerName: listing.retainerName
            };
        });

        for (let listing of marketBoardData.listings) {
            listing.total = listing.pricePerUnit * listing.quantity;
            dataArray.push(listing);
        }

        priceTracker.set(
            marketBoardData.itemID,
            marketBoardData.worldID,
            dataArray as MarketBoardItemListing[]
        );
    } else if (marketBoardData.entries) {
        marketBoardData.entries.map((entry) => {
            return {
                buyerName: entry.buyerName,
                hq: entry.hq,
                pricePerUnit: entry.pricePerUnit,
                quantity: entry.quantity,
                timestamp: entry.timestamp
            };
        });

        for (let entry of marketBoardData.entries) {
            entry.total = entry.pricePerUnit * entry.quantity;
            dataArray.push(entry);
        }

        historyTracker.set(
            marketBoardData.itemID,
            marketBoardData.worldID,
            dataArray as MarketBoardHistoryEntry[]
        );
    } else {
        ctx.throw(418);
    }
});

universalis.use(router.routes());

// Start server
universalis.listen(3000);
