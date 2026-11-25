import Redis from 'ioredis';
import { config } from './config.js';
const options={maxRetriesPerRequest:2,retryStrategy:(times)=>Math.min(times*500,2000)};
export const redis=new Redis(config.redis,options), publisher=new Redis(config.redis,options), subscriber=new Redis(config.redis,options);
for(const client of [redis,publisher,subscriber])client.on('error',(error)=>console.error('redis connection error',error.message));
