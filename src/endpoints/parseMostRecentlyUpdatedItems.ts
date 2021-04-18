/**
 * @name most-Recently-Updated Items
 * @url /api/extra/stats/most-recently-updated
 * @param world string | number The world or DC to retrieve data from.
 * @param entries number The number of entries to return.
 * @returns items WorldItemPairList[] An array of world-item pairs for the most-recently-updated items.
 */

import { Redis } from "ioredis";
import { ParameterizedContext } from "koa";

import { ExtraDataManager } from "../db/ExtraDataManager";

import { WorldItemPairList } from "../models/WorldItemPairList";

export async function parseMostRecentlyUpdatedItems(
	ctx: ParameterizedContext,
	worldMap: Map<string, number>,
	edm: ExtraDataManager,
	redis: Redis,
) {
	let worldID = ctx.queryParams.world;
	let dcName = ctx.queryParams.dcName;

	if (worldID && !parseInt(worldID)) {
		console.log(worldID);
		worldID = worldMap.get(worldID);
		if (!worldID && typeof worldID === "string")  {
			worldID = worldMap.get(worldID.charAt(0).toLocaleUpperCase() + worldID.substr(1).toLocaleLowerCase())
		}
	} else if (parseInt(worldID)) {
		worldID = parseInt(worldID);
	}

	if (worldID && dcName && worldID !== 0) {
		dcName = null;
	} else if (worldID && dcName && worldID === 0) {
		worldID = null;
	}

	let entriesToReturn: any = ctx.queryParams.entries;
	if (entriesToReturn)
		entriesToReturn = parseInt(entriesToReturn.replace(/[^0-9]/g, ""));
	
	const redisKey = "mru-" + worldID || dcName + "-" + entriesToReturn;
	const existing = await redis.get(redisKey);
	if (existing) {
		ctx.body = JSON.parse(existing);
		return;
	}

	const data: WorldItemPairList = await edm.getMostRecentlyUpdatedItems(
		worldID || dcName,
		entriesToReturn,
	);

	if (!data) {
		ctx.body = {
			items: [],
		} as WorldItemPairList;
		return;
	}

	await redis.set(redisKey, JSON.stringify(data), "EX", 60);

	ctx.body = data;
}
