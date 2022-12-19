/** @format */

import 'https://deno.land/x/dotenv/load.ts';
import { connect } from 'https://deno.land/x/redis/mod.ts';
import { gql } from 'https://deno.land/x/oak_graphql/mod.ts';
import { print, visit } from 'https://deno.land/x/graphql_deno/mod.ts';

let redis;
const context = window.Deno ? 'server' : 'client';

if (context === 'server') {
  redis = await connect({
    hostname: Deno.env.get('REDIS_HOST'),
    port: 6379,
  });
}
//this is being exported so we can flush db in invalidateCacheCheck

export const redisdb = redis;
export class Cache {
  constructor(
    initialCache = {
      ROOT_QUERY: {},
      ROOT_MUTATION: {},
    }
  ) {
    this.storage = initialCache;
    this.context = window.Deno ? 'server' : 'client';
  }

  // set cache configurations
  async configSet(parameter, value) {
    return await redis.configSet(parameter, value);
  }

  // Main functionality methods
  // for reading the inital query
  async read(queryStr) {
    //the queryStr it gets is the JSON stringified
    const returnedValue = await this.cacheRead(queryStr);

    if (('returnedValue', returnedValue)) {
      return JSON.parse(returnedValue);
    } else {
      return undefined;
    }
  }
  async write(queryStr, respObj, deleteFlag) {
    // update the original cache with same reference
    await this.cacheWrite(queryStr, JSON.stringify(respObj));
  }

  //will overwrite a list at the given hash by default
  //if you pass a false value to overwrite, it will append the list items to the end

  //Probably be used in normalize
  cacheWriteList = async (hash, array, overwrite = true) => {
    if (overwrite) {
      await redis.del(hash);
    }
    array = array.map((element) => JSON.stringify(element));
    await redis.rpush(hash, ...array);
  };

  cacheReadList = async (hash) => {
    let cachedArray = await redis.lrange(hash, 0, -1);
    cachedArray = cachedArray.map((element) => JSON.parse(element));

    return cachedArray;
  };

  cacheWriteObject = async (hash, obj) => {
    let entries = Object.entries(obj).flat();
    entries = entries.map((entry) => JSON.stringify(entry));

    await redis.hset(hash, ...entries);
  };

  cacheReadObject = async (hash, field = false) => {
    if (field) {
      let returnValue = await redisdb.hget(hash, JSON.stringify(field));

      if (returnValue === undefined) return undefined;
      return JSON.parse(returnValue);
    } else {
      let objArray = await redisdb.hgetall(hash);
      if (objArray.length == 0) return undefined;
      let parsedArray = objArray.map((entry) => JSON.parse(entry));

      if (parsedArray.length % 2 !== 0) {
        return undefined;
      }
      let returnObj = {};
      for (let i = 0; i < parsedArray.length; i += 2) {
        returnObj[parsedArray[i]] = parsedArray[i + 1];
      }

      return returnObj;
    }
  };

  createBigHash(inputfromQuery) {
    let ast = gql(inputfromQuery);

    let returned = visit(ast, { enter: print(ast) });
    let finalReturn = print(returned);
    return JSON.stringify(finalReturn);
  }

  async cacheRead(hash) {
    if (this.context === 'client') {
      return this.storage[hash];
    } else {
      let ast = gql(value.query);
      console.log('ast from restructure', ast);
      console.log(
        ast.definitions[0].selectionSet.selections[0].name,
        ast.definitions[0].selectionSet.selections[0].name.value
      );
      const name = ast.definitions[0].selectionSet.selections[0].name.value;
      const fieldsArray =
        ast.definitions[0].selectionSet.selections[0].arguments[0].value.fields;
      const resultsObj = {};
      fieldsArray.forEach((el) => {
        const name = el.name.value;
        const value = el.value.value;
        resultsObj[name] = value;
      });
      console.log(resultsObj);
      let cacheHash = `${name}`;
      for (let key in resultsObj) {
        cacheHash += `:${key}:${resultsObj[key]}`;
      }
      console.log('cacheHash: ', cacheHash);
      console.log(
        ast.definitions[0].selectionSet.selections[0].arguments[0].value
          .fields[0],
        ast.definitions[0].selectionSet.selections[0].arguments[0].value
          .fields[0].name.value,
        ast.definitions[0].selectionSet.selections[0].arguments[0].value
          .fields[0].value.value
      );
      // if (hash === 'ROOT_QUERY' || hash === 'ROOT_MUTATION') {
      //   const hasRootQuery = await redis.get('ROOT_QUERY');

      //   if (!hasRootQuery) {
      //     await redis.set('ROOT_QUERY', JSON.stringify({}));
      //   }
      //   const hasRootMutation = await redis.get('ROOT_MUTATION');

      //   if (!hasRootMutation) {
      //     await redis.set('ROOT_MUTATION', JSON.stringify({}));
      //   }
      // }
      // let hashedQuery = await redis.hget('ROOT_QUERY', hash);

      // if (hashedQuery === undefined) return undefined;
      // return JSON.parse(hashedQuery);
    }
  }
  async cacheWrite(hash, value) {
    // writes value to object cache or JSON.stringified value to redis cache
    if (this.context === 'client') {
      this.storage[hash] = value;
    } else {
      value = JSON.stringify(value);
      await redis.hset('ROOT_QUERY', hash, value);
      let hashedQuery = await redis.hget('ROOT_QUERY', hash);
    }
  }

  async cacheWriteList(hash, array) {
    await redis.rpush(hash, ...array);
  }

  async cacheReadList(hash) {
    let cachedArray = await redis.lrange(hash, 0, -1);
    return cachedArray;
  }

  async cacheDelete(hash) {
    // deletes the hash/value pair on either object cache or redis cache
    if (this.context === 'client') {
      delete this.storage[hash];
    } else await redis.del(hash);
  }
  async cacheClear() {
    // erases either object cache or redis cache
    if (this.context === 'client') {
      this.storage = { ROOT_QUERY: {}, ROOT_MUTATION: {} };
    } else {
      await redis.flushdb((err, successful) => {
        if (err) console.log('redis error', err);
        console.log(successful, 'clear');
      });
      await redis.hset('ROOT_QUERY', 'blank', JSON.stringify({}));
      await redis.set('ROOT_MUTATION', 'blank', JSON.stringify({}));
    }
  }

  // functionality to stop polling
  stopPollInterval(interval) {
    clearInterval(interval);
  }
}
