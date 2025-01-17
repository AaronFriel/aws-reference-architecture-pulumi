import { Pinecone } from '@pinecone-database/pinecone'
import { query } from '../../../utils/db'
import PipelineSingleton from './pipeline.js';
import { NextResponse } from 'next/server'
import logger from '../../logger';
import worker_id from '../../workerIdSingleton'

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
  environment: process.env.PINECONE_ENVIRONMENT,
});
const limit = 10;

async function handler(req) {
  const { searchTerm, currentPage } = await req.json();

  console.log(`searchTerm: ${searchTerm}, currentPage: ${currentPage}`);

  logger.info({
    message: "Products route hit",
    service: "frontend",
    worker_id,
    action: "products_route_handler",
  });

  const offset = currentPage > 1 ? (currentPage - 1) * limit : 0;

  const indexName = process.env.PINECONE_INDEX;

  await pinecone.createIndex({
    name: indexName,
    dimension: 384,
    suppressConflicts: true,
    waitUntilReady: true,
  });

  const index = pinecone.index(indexName);
  // Intentionally use the default namespace for Pinecone
  // The Emu microservice correlatively upserts to the default namespace, 
  // signified by ''
  const namespace = index.namespace('')

  const classifier = await PipelineSingleton.getInstance();

  const embeddedSearchTerm = await classifier(searchTerm, { pooling: 'mean', normalize: true })

  logger.info({
    message: "Search term converted to embedding",
    service: "frontend",
    embeddedSearchTerm,
    worker_id,
    action: "search_term_embedded",
  });

  const result = await namespace.query({
    vector: Array.from(embeddedSearchTerm.data),
    topK: 100,
    includeMetadata: true
  });

  logger.info({
    message: "Pinecone query results received",
    result,
    length: result.matches.length,
    service: "frontend",
    worker_id,
    action: "pinecone_query_results",
  });

  const ids = result ? result.matches?.map((match) => match.metadata?.id) : [];

  console.log(`ids before query: ${ids}`)

  logger.info({
    message: "Filtered Postgres Ids from Pinecone results metadata",
    ids,
    service: "frontend",
    worker_id,
    action: "postgres_ids_filtered",
  });

  const productsQuery = `
    SELECT * FROM products_with_increment
    ${ids.length > 0 ? `WHERE id IN (${ids.map((id) => `'${id}'`).join(',')})` : ''}
    LIMIT ${limit} OFFSET ${offset}    
  `;

  logger.info({
    message: "Products query formed",
    productsQuery,
    service: "frontend",
    worker_id,
    action: "products_query_formed",
  });

  const products = await query(productsQuery);

  return NextResponse.json(products.rows);
}

export {
  handler as POST
};

