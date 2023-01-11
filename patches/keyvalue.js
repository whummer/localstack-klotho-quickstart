//@ts-nocheck
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.dMap = void 0;
const _ = require("lodash");
const moment = require("moment");
const DynamoDB = require("aws-sdk/clients/dynamodb");
/** start LocalStack patches **/
const { getAWSConfig } = require("./clients");
const docClient = new DynamoDB.DocumentClient(getAWSConfig());
/** end LocalStack patches **/
let alldMaps = [];
const electrodb_1 = require("electrodb");
const KVStore = new electrodb_1.Entity({
    model: {
        entity: 'entry',
        version: '1',
        service: 'store',
    },
    attributes: {
        map_id: {
            type: 'string',
            required: true,
        },
        kv_key: {
            type: 'string',
            required: true,
        },
        kv_value: {
            type: 'any',
        },
        expiration: {
            type: 'number',
        },
    },
    indexes: {
        kv: {
            pk: {
                field: 'pk',
                composite: ['map_id'],
            },
            sk: {
                field: 'sk',
                composite: ['kv_key'],
            },
        },
    },
    filters: {},
}, { table: 'test', client: docClient });
const localFS = require("fs-extra");
if (process.env['CLOUDCC'] != 'true') {
    localFS.ensureDirSync(`/tmp/dMapBatches/`);
}
class dMap {
    constructor(opts) {
        this.dynamoCalls = 0;
        this.nonCachedFunctionCalls = 0;
        this.allFunctionCalls = 0;
        this.deletedKeys = [];
        this.opts = {
            id: '',
            batch_write: false,
            write_on_change: true,
            ...opts,
        };
        this._cache = new Map();
        alldMaps.push(this);
    }
    emptyCache() {
        this._cache.clear();
    }
    async get(key) {
        try {
            this.allFunctionCalls += 1;
            this.nonCachedFunctionCalls += 1;
            let dbValue = (await KVStore.query.kv({ kv_key: key, map_id: this.opts.id }).go()).data;
            let value = dbValue?.[0]?.kv_value;
            if (value == '_DELETED') {
                return undefined;
            }
            // value = this._restoreUndefinedValues(value);
            this._cache.set(key, value);
            return value;
        }
        catch (error) {
            console.error('CloudCC Runtime error');
            console.error(error);
        }
    }
    async has(key) {
        return typeof (await this.get(key)) !== 'undefined';
    }
    /**
     *
     * @param key
     * @param value
     * @param ttl time-to-live, seconds
     */
    async set(key, value) {
        if (key == 'options')
            return this; // reserved keyword that functions as the constructor
        //TODO: Need to calculate and manage Deltas to avoid continued growth of what we send
        //      to be batched
        if (key != 'flush')
            this._cache.set(key, value);
        if (typeof value == 'object' && this.opts.versioned) {
            const v = value;
            let whereFunc;
            const hadVersion = '__version' in v;
            if (hadVersion) {
                v.__version++;
                whereFunc = ({ kv_value }, { eq }) => eq(kv_value.__version, v.__version - 1);
            }
            else {
                v.__version = 0;
                whereFunc = ({ kv_value }, { notExists }) => notExists(kv_value);
            }
            try {
                await KVStore.put(this.toKVObject(key, v)).where(whereFunc).go();
            }
            catch (err) {
                if (err.message.includes('conditional request failed')) {
                    if (hadVersion) {
                        throw new Error(`Conditional put failed: expected version ${v.__version - 1} did not match`);
                    }
                    else {
                        throw new Error('Conditional put failed: expected item to not exist');
                    }
                }
                else {
                    throw err;
                }
            }
            return this;
        }
        if (this.opts.batch_write == false && this.opts.write_on_change == true) {
            // Every time a change happens in the KV write to Dynamo immediately
            await this.flushEntries([[key, value]]);
        }
        else if (key == 'flush' &&
            this.opts.batch_write == false &&
            this.opts.write_on_change == false) {
            // On lambda exit, write final KV updates to Dynamo (no local intermediates)
            await this.flushEntries(Array.from(this._cache.entries()));
        }
        return this;
    }
    async flushEntries(entriesToFlush) {
        const cachedObjects = entriesToFlush.map(([key, value]) => this.toKVObject(key, value));
        try {
            await KVStore.put(cachedObjects).go();
        }
        catch (e) {
            console.log(e);
        }
    }
    expiration() {
        if (this.opts.ttl) {
            return moment().add(this.opts.ttl, 'seconds').unix();
        }
        return undefined;
    }
    toKVObject(key, value) {
        return {
            map_id: this.opts.id,
            kv_key: key,
            kv_value: value,
            expiration: this.expiration(),
        };
    }
    async delete(key) {
        if (key == 'options')
            return true; // reserved keyword that functions as the constructor
        if (key == 'flush') {
            await this._cache.delete(key);
            return true;
        }
        this.deletedKeys.push(key);
        // We don't actually delete keys - bad practice. We only allow clearing the entire set. We filter out the deleted ones later
        await this.set(key, '_DELETED');
        return await this._cache.delete(key);
    }
    async keys() {
        this.allFunctionCalls += 1;
        try {
            this.nonCachedFunctionCalls += 1;
            this.dynamoCalls += 1;
            const keyResults = (await KVStore.query.kv({ map_id: this.opts.id }).go()).data;
            const filteredKeys = _.uniq([
                ...keyResults.filter((x) => x.kv_value != '_DELETED').map((x) => x.kv_key),
                ...this._cache.keys(),
            ]);
            this.deletedKeys.forEach((key) => {
                _.remove(filteredKeys, (x) => x == key);
            });
            return filteredKeys.map((x) => x);
        }
        catch (e) {
            console.error(e);
            throw new Error(`CloudCompiler runtime error:`);
        }
    }
    async entries() {
        this.nonCachedFunctionCalls += 1;
        this.dynamoCalls += 1;
        try {
            let keyResults = (await KVStore.query.kv({ map_id: this.opts.id }).go()).data;
            this.deletedKeys.forEach((key) => {
                _.remove(keyResults, (x) => x.kv_key == key);
            });
            keyResults = keyResults.filter((x) => x.kv_value != '_DELETED'); //.map(x => [x.kv_key, this._restoreUndefinedValues(x.kv_value)])
            keyResults.map((kvPair) => {
                if (this._cache.has(kvPair.kv_key))
                    return;
                this._cache.set(kvPair.kv_key, kvPair.kv_value);
            });
            return this._cache.entries();
        }
        catch (e) {
            console.error(e);
            throw new Error(`CloudCompiler runtime error:`);
        }
    }
    async clear() {
        try {
            let entries = await KVStore.query.kv({ map_id: this.opts.id }).go();
            let result = await KVStore.delete(entries.data).go();
            this._cache.clear();
            return true;
        }
        catch (err) {
            console.log(err);
            return undefined;
        }
    }
}
exports.dMap = dMap;
